import { ApiError } from "@verifyistic/core";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import {
	resolveIdempotency,
	storeIdempotentResponse,
} from "../lib/idempotency.js";
import { requireScope } from "../middleware/auth.js";

/** Public customer shape — DOB and address are readable only through scoped API responses, never public surfaces. */
function toPublicCustomer(record: {
	id: string;
	first_name: string;
	last_name: string;
	email: string | null;
	phone: string | null;
	date_of_birth: string | null;
	address_json: string | null;
	status: string;
	source: string;
	external_ref: string | null;
	primary_site_id: string | null;
	created_at: string;
	updated_at: string;
}) {
	return {
		id: record.id,
		first_name: record.first_name,
		last_name: record.last_name,
		email: record.email,
		phone: record.phone,
		date_of_birth: record.date_of_birth,
		address: record.address_json ? JSON.parse(record.address_json) : null,
		status: record.status,
		source: record.source,
		external_ref: record.external_ref,
		primary_site_id: record.primary_site_id,
		created_at: record.created_at,
		updated_at: record.updated_at,
	};
}

export function customersRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "customers:write");
		// Read the raw body ONCE — Idempotency-Key fingerprinting and JSON parsing
		// share it (Request.clone() throws once the stream is disturbed).
		const rawBody = await c.req.text();
		const idem = await resolveIdempotency(
			deps.idempotencyStore,
			tenant,
			c,
			rawBody,
		);
		if (idem?.replay) {
			return c.json(
				JSON.parse(idem.replay.body),
				idem.replay.status as ContentfulStatusCode,
			);
		}
		const body = JSON.parse(rawBody) as unknown;
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const {
			first_name,
			last_name,
			email,
			phone,
			date_of_birth,
			address,
			primary_site_id,
			external_ref,
			source,
		} = body as Record<string, unknown>;
		const fields: Record<string, string[]> = {};
		if (typeof first_name !== "string" || first_name.trim().length === 0)
			fields.first_name = ["required"];
		if (typeof last_name !== "string" || last_name.trim().length === 0)
			fields.last_name = ["required"];
		if (email !== undefined && email !== null && typeof email !== "string")
			fields.email = ["invalid"];
		if (phone !== undefined && phone !== null && typeof phone !== "string")
			fields.phone = ["invalid"];
		if (
			date_of_birth !== undefined &&
			date_of_birth !== null &&
			!/^\d{4}-\d{2}-\d{2}$/.test(String(date_of_birth))
		) {
			fields.date_of_birth = ["must be YYYY-MM-DD"];
		}
		if (Object.keys(fields).length > 0) {
			throw ApiError.validation("One or more fields are invalid.", fields);
		}

		const customer = await deps.customers.create(tenant, {
			firstName: first_name as string,
			lastName: last_name as string,
			email: (email as string | null) ?? null,
			phone: (phone as string | null) ?? null,
			dateOfBirth: (date_of_birth as string | null) ?? null,
			address: (address as Record<string, unknown> | null) ?? null,
			primarySiteId: (primary_site_id as string | null) ?? null,
			externalRef: (external_ref as string | null) ?? null,
			source: typeof source === "string" ? source : undefined,
		});
		await deps.audit.record(tenant, {
			eventType: "customer.created",
			entityType: "customer",
			entityId: customer.id,
			data: { source: customer.source },
		});
		const envelope = {
			data: toPublicCustomer(customer),
			meta: { request_id: c.get("requestId"), created: true },
		};
		if (idem)
			await storeIdempotentResponse(
				deps.idempotencyStore,
				idem,
				200,
				JSON.stringify(envelope),
			);
		return c.json(envelope);
	});

	routes.get("/", async (c) => {
		requireScope(c, "customers:read");
		const limitRaw = c.req.query("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
		if (
			limitRaw !== undefined &&
			(!Number.isFinite(limit) ||
				(limit as number) < 1 ||
				(limit as number) > 100)
		) {
			throw ApiError.validation("limit must be between 1 and 100.", {
				limit: ["invalid"],
			});
		}
		const page = await deps.customers.list(c.get("tenant")!, {
			limit,
			after: c.req.query("after") ?? undefined,
		});
		return ok(c, page.items.map(toPublicCustomer), {
			next_cursor: page.nextCursor,
			has_more: page.hasMore,
		});
	});

	routes.get("/:id", async (c) => {
		requireScope(c, "customers:read");
		const customer = await deps.customers.get(
			c.get("tenant")!,
			c.req.param("id"),
		);
		if (!customer) throw ApiError.notFound("Customer not found.");
		return ok(c, toPublicCustomer(customer));
	});

	routes.patch("/:id", async (c) => {
		const { tenant } = requireScope(c, "customers:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const b = body as Record<string, unknown>;
		const patch: Parameters<typeof deps.customers.update>[2] = {};
		if (b.first_name !== undefined) {
			if (
				typeof b.first_name !== "string" ||
				b.first_name.trim().length === 0
			) {
				throw ApiError.validation("first_name must be a non-empty string.", {
					first_name: ["invalid"],
				});
			}
			patch.firstName = b.first_name;
		}
		if (b.last_name !== undefined) {
			if (typeof b.last_name !== "string" || b.last_name.trim().length === 0) {
				throw ApiError.validation("last_name must be a non-empty string.", {
					last_name: ["invalid"],
				});
			}
			patch.lastName = b.last_name;
		}
		if (b.email !== undefined) patch.email = (b.email as string | null) ?? null;
		if (b.phone !== undefined) patch.phone = (b.phone as string | null) ?? null;
		if (b.date_of_birth !== undefined)
			patch.dateOfBirth = (b.date_of_birth as string | null) ?? null;
		if (b.address !== undefined)
			patch.address = (b.address as Record<string, unknown> | null) ?? null;
		if (b.status !== undefined) {
			if (
				b.status !== "active" &&
				b.status !== "inactive" &&
				b.status !== "archived"
			) {
				throw ApiError.validation(
					"status must be active, inactive, or archived.",
					{ status: ["invalid"] },
				);
			}
			patch.status = b.status;
		}
		if (b.external_ref !== undefined)
			patch.externalRef = (b.external_ref as string | null) ?? null;
		if (b.primary_site_id !== undefined)
			patch.primarySiteId = (b.primary_site_id as string | null) ?? null;
		if (Object.keys(patch).length === 0) {
			throw ApiError.validation("No editable fields supplied.", {
				body: ["empty"],
			});
		}

		const customer = await deps.customers.update(
			tenant,
			c.req.param("id"),
			patch,
		);
		if (!customer) throw ApiError.notFound("Customer not found.");
		await deps.audit.record(tenant, {
			eventType: "customer.updated",
			entityType: "customer",
			entityId: customer.id,
			data: { fields: Object.keys(patch) },
		});
		return ok(c, toPublicCustomer(customer));
	});

	routes.get("/:id/relationships", async (c) => {
		requireScope(c, "customers:read");
		const relationships = await deps.customers.listRelationships(
			c.get("tenant")!,
			c.req.param("id"),
		);
		return ok(c, relationships);
	});

	routes.post("/:id/relationships", async (c) => {
		const { tenant } = requireScope(c, "customers:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { related_customer_id, relationship_type, metadata } = body as Record<
			string,
			unknown
		>;
		if (
			typeof related_customer_id !== "string" ||
			related_customer_id.length === 0
		) {
			throw ApiError.validation("related_customer_id is required.", {
				related_customer_id: ["required"],
			});
		}
		if (
			relationship_type !== "guardian_of" &&
			relationship_type !== "guarded_by" &&
			relationship_type !== "household"
		) {
			throw ApiError.validation(
				"relationship_type must be guardian_of, guarded_by, or household.",
				{
					relationship_type: ["invalid"],
				},
			);
		}
		// Both customers must exist inside THIS organization (cross-tenant ids read as missing).
		const customer = await deps.customers.get(tenant, c.req.param("id"));
		const related = await deps.customers.get(tenant, related_customer_id);
		if (!customer || !related) throw ApiError.notFound("Customer not found.");

		const relationship = await deps.customers.addRelationship(tenant, {
			customerId: customer.id,
			relatedCustomerId: related.id,
			relationshipType: relationship_type,
			metadata: (metadata as Record<string, unknown> | undefined) ?? undefined,
		});
		await deps.audit.record(tenant, {
			eventType: "customer.relationship_created",
			entityType: "customer",
			entityId: customer.id,
			data: { relationship_type, related_customer_id: related.id },
		});
		return ok(c, relationship, { created: true });
	});

	routes.delete("/:id/relationships/:relationshipId", async (c) => {
		const { tenant } = requireScope(c, "customers:write");
		const removed = await deps.customers.removeRelationship(
			tenant,
			c.req.param("relationshipId"),
		);
		if (!removed) throw ApiError.notFound("Relationship not found.");
		return ok(c, { removed: true });
	});

	return routes;
}
