import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireAuth, requireScope } from "../middleware/auth.js";

export function organizationRoutes(deps: AppServices) {
	const routes = new Hono();

	// Any authenticated key may read its own organization — the only one it can ever see.
	routes.get("/", async (c) => {
		requireAuth(c);
		const org = await deps.repos.getOrganization(c.get("tenant")!);
		if (!org) {
			// Authenticated key whose organization row is gone — treat as gone, not as a leak.
			return c.json(
				{
					error: {
						code: "not_found",
						message: "Organization not found.",
						request_id: c.get("requestId"),
					},
				},
				404,
			);
		}
		return ok(c, org);
	});

	// Memberships of the organization (doc 06 §2 presets live in @verifyistic/auth).
	routes.get("/members", async (c) => {
		requireScope(c, "sites:read");
		const members = await deps.repos.listMembers(c.get("tenant")!);
		return ok(
			c,
			members.map(({ id, user_id, role, status, created_at }) => ({
				id,
				user_id,
				role,
				status,
				created_at,
			})),
		);
	});

	return routes;
}
