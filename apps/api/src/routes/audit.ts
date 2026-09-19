import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

export function auditRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/", async (c) => {
		const { tenant } = requireScope(c, "audit:read");
		const entityType = c.req.query("entity_type");
		const entityId = c.req.query("entity_id");

		const events =
			entityType && entityId
				? await deps.audit.listForEntity(tenant, entityType, entityId)
				: await deps.audit.listForOrganization(tenant);

		return ok(c, events);
	});

	return routes;
}
