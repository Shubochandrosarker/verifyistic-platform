import { ApiError } from "@verifyistic/core";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireAuth, requireScope } from "../middleware/auth.js";

const SITE_STATUSES = ["active", "inactive"] as const;

export function sitesRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/", async (c) => {
		requireScope(c, "sites:read");
		const sites = await deps.repos.listSites(c.get("tenant")!);
		return ok(c, sites);
	});

	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "sites:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { name, domain, address, timezone } = body as Record<string, unknown>;
		if (
			typeof name !== "string" ||
			name.trim().length === 0 ||
			name.length > 255
		) {
			throw ApiError.validation("name is required (1-255 characters).", {
				name: ["required"],
			});
		}
		if (domain !== undefined && domain !== null && typeof domain !== "string") {
			throw ApiError.validation("domain must be a string or null.", {
				domain: ["invalid"],
			});
		}
		// organization_id from the body is ignored by design — the tenant comes from the key.
		const site = await deps.repos.createSite(tenant, {
			name: name.trim(),
			domain: typeof domain === "string" ? domain : null,
			address: typeof address === "string" ? address : null,
			timezone: typeof timezone === "string" ? timezone : undefined,
		});
		await deps.audit.record(tenant, {
			eventType: "site.created",
			entityType: "site",
			entityId: site.id,
			data: { name: site.name },
		});
		return ok(c, site, { created: true });
	});

	routes.get("/:id", async (c) => {
		requireScope(c, "sites:read");
		const site = await deps.repos.getSite(c.get("tenant")!, c.req.param("id"));
		if (!site) throw ApiError.notFound("Site not found.");
		return ok(c, site);
	});

	routes.patch("/:id", async (c) => {
		const { tenant } = requireScope(c, "sites:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const patch: Record<string, unknown> = {};
		const { name, domain, address, timezone, status } = body as Record<
			string,
			unknown
		>;
		if (name !== undefined) {
			if (
				typeof name !== "string" ||
				name.trim().length === 0 ||
				name.length > 255
			) {
				throw ApiError.validation("name must be 1-255 characters.", {
					name: ["invalid"],
				});
			}
			patch.name = name.trim();
		}
		if (domain !== undefined)
			patch.domain = typeof domain === "string" ? domain : null;
		if (address !== undefined)
			patch.address = typeof address === "string" ? address : null;
		if (timezone !== undefined) {
			if (typeof timezone !== "string")
				throw ApiError.validation("timezone must be a string.", {
					timezone: ["invalid"],
				});
			patch.timezone = timezone;
		}
		if (status !== undefined) {
			if (
				typeof status !== "string" ||
				!(SITE_STATUSES as readonly string[]).includes(status)
			) {
				throw ApiError.validation("status must be active or inactive.", {
					status: ["invalid"],
				});
			}
			patch.status = status;
		}
		if (Object.keys(patch).length === 0) {
			throw ApiError.validation("No editable fields supplied.", {
				body: ["empty"],
			});
		}
		const site = await deps.repos.updateSite(tenant, c.req.param("id"), patch);
		// Cross-tenant or missing ids are indistinguishable: not_found either way.
		if (!site) throw ApiError.notFound("Site not found.");
		await deps.audit.record(tenant, {
			eventType: "site.updated",
			entityType: "site",
			entityId: site.id,
			data: patch,
		});
		return ok(c, site);
	});

	return routes;
}
