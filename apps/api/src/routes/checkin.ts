import { ApiError } from "@verifyistic/core";
import { CustomerNotFoundError } from "@verifyistic/customers";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

/** QR codes: random url-safe token mapped to a business/template — never contains PII (doc 11 §7). */
function newQrCode(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function checkinRoutes(deps: AppServices) {
	const routes = new Hono();

	// Front-desk / kiosk search: "JOHN", "jane@example.com", "555-1234" (doc 11 §5).
	routes.get("/search", async (c) => {
		requireScope(c, "checkin:read");
		const q = c.req.query("q");
		if (!q || q.trim().length < 2) {
			throw ApiError.validation("q is required (minimum 2 characters).", {
				q: ["required"],
			});
		}
		const cards = await deps.checkin.search(c.get("tenant")!, q);
		return ok(c, cards);
	});

	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "checkin:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { customer_id, site_id, document_id, source, metadata } =
			body as Record<string, unknown>;
		if (typeof customer_id !== "string" || customer_id.length === 0) {
			throw ApiError.validation("customer_id is required.", {
				customer_id: ["required"],
			});
		}
		if (
			source !== undefined &&
			!["front_desk", "kiosk", "api", "qr"].includes(source as string)
		) {
			throw ApiError.validation(
				"source must be front_desk, kiosk, api, or qr.",
				{ source: ["invalid"] },
			);
		}
		const ip =
			c.req.header("CF-Connecting-IP") ??
			c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
		try {
			const { checkIn, duplicate } = await deps.checkin.checkIn(tenant, {
				customerId: customer_id,
				siteId: (site_id as string | null) ?? null,
				documentId: (document_id as string | null) ?? null,
				source: (source as "front_desk" | "kiosk" | "api" | "qr") ?? undefined,
				metadata: {
					...(metadata as Record<string, unknown> | undefined),
					...(ip ? { ip } : {}),
				},
			});
			const card = await deps.checkin.statusCard(tenant, customer_id);
			return ok(c, { check_in: checkIn, status_card: card, duplicate });
		} catch (error) {
			if (error instanceof CustomerNotFoundError)
				throw ApiError.notFound("Customer not found.");
			throw error;
		}
	});

	routes.get("/history", async (c) => {
		requireScope(c, "checkin:read");
		const customerId = c.req.query("customer_id");
		if (!customerId)
			throw ApiError.validation("customer_id is required.", {
				customer_id: ["required"],
			});
		const history = await deps.checkin.history(c.get("tenant")!, customerId);
		return ok(c, history);
	});

	// QR targets: printed codes resolve to a business/template start flow (no PII in the code).
	routes.post("/qr", async (c) => {
		const { tenant } = requireScope(c, "checkin:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { template_id, site_id, label } = body as Record<string, unknown>;
		if (typeof template_id !== "string" || template_id.length === 0) {
			throw ApiError.validation("template_id is required.", {
				template_id: ["required"],
			});
		}
		const template = await deps.templates.get(tenant, template_id);
		if (!template) throw ApiError.notFound("Template not found.");

		const code = newQrCode();
		const row = {
			id: crypto.randomUUID(),
			organization_id: tenant.organizationId,
			site_id: (site_id as string | null) ?? null,
			template_id,
			code,
			label: typeof label === "string" ? label.slice(0, 200) : null,
			status: "active" as const,
			created_at: new Date().toISOString(),
		};
		await deps.db.insertInto("qr_targets").values(row).execute();
		return ok(
			c,
			{ id: row.id, code, start_url: `/start/${code}`, label: row.label },
			{ created: true },
		);
	});

	return routes;
}

/** Public QR start endpoint — mounted at app root: GET /start/{code} (doc 11 §7). */
export function qrStartRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/start/:code", async (c) => {
		const code = c.req.param("code");
		if (!/^[0-9a-f]{24}$/.test(code))
			throw ApiError.notFound("QR code not found.");
		const target = await deps.db
			.selectFrom("qr_targets")
			.selectAll()
			.where("code", "=", code)
			.where("status", "=", "active")
			.executeTakeFirst();
		if (!target) throw ApiError.notFound("QR code not found.");
		const org = await deps.db
			.selectFrom("organizations")
			.select(["name"])
			.where("id", "=", target.organization_id)
			.executeTakeFirst();
		const template = await deps.db
			.selectFrom("templates")
			.select(["name", "status"])
			.where("id", "=", target.template_id)
			.executeTakeFirst();
		if (!template || template.status !== "published") {
			return ok(c, {
				business_name: org?.name ?? "",
				template_name: null,
				startable: false,
			});
		}
		// Safe output only — business name and template name, no customer data.
		return ok(c, {
			business_name: org?.name ?? "",
			template_name: template.name,
			template_id: target.template_id,
			site_id: target.site_id,
			startable: true,
		});
	});

	return routes;
}
