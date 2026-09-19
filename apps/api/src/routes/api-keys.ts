import { type Scope, isScope } from "@verifyistic/auth";
import { ApiError } from "@verifyistic/core";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

/** Public shape of an API key — never includes key_hash or any secret material. */
function toPublicApiKey(record: {
	id: string;
	name: string;
	key_prefix: string;
	scopes: string;
	site_restrictions: string | null;
	last_used_at: string | null;
	expires_at: string | null;
	revoked_at: string | null;
	created_at: string;
}) {
	return {
		id: record.id,
		name: record.name,
		key_prefix: record.key_prefix,
		scopes: JSON.parse(record.scopes),
		site_restrictions: record.site_restrictions
			? JSON.parse(record.site_restrictions)
			: null,
		last_used_at: record.last_used_at,
		expires_at: record.expires_at,
		revoked_at: record.revoked_at,
		created_at: record.created_at,
	};
}

export function apiKeysRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/", async (c) => {
		const { tenant } = requireScope(c, "api_keys:read");
		const keys = await deps.apiKeys.list(tenant);
		return ok(c, keys.map(toPublicApiKey));
	});

	routes.post("/", async (c) => {
		const { tenant, keyMode } = requireScope(c, "api_keys:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { name, scopes, mode, siteRestrictions, expiresInDays } =
			body as Record<string, unknown>;
		if (
			typeof name !== "string" ||
			name.trim().length === 0 ||
			name.length > 100
		) {
			throw ApiError.validation("name is required (1-100 characters).", {
				name: ["required"],
			});
		}
		if (
			!Array.isArray(scopes) ||
			scopes.length === 0 ||
			!scopes.every((entry) => typeof entry === "string" && isScope(entry))
		) {
			throw ApiError.validation(
				`scopes must be a non-empty array of: ${["sites:read", "sites:write", "api_keys:read", "api_keys:write", "audit:read"].join(", ")}`,
				{ scopes: ["invalid"] },
			);
		}
		if (mode !== undefined && mode !== "live" && mode !== "test") {
			throw ApiError.validation("mode must be live or test.", {
				mode: ["invalid"],
			});
		}
		// A test key may only mint test keys — no test-to-live escalation.
		const effectiveMode =
			keyMode === "test" ? "test" : ((mode as "live" | "test") ?? "live");

		const { record, raw } = await deps.apiKeys.create(tenant, {
			name: name.trim(),
			mode: effectiveMode,
			scopes: scopes as Scope[],
			siteRestrictions: Array.isArray(siteRestrictions)
				? (siteRestrictions as string[])
				: undefined,
			expiresInDays:
				typeof expiresInDays === "number" && Number.isFinite(expiresInDays)
					? expiresInDays
					: undefined,
		});
		await deps.audit.record(tenant, {
			eventType: "api_key.created",
			entityType: "api_key",
			entityId: record.id,
			data: {
				name: record.name,
				mode: effectiveMode,
				scopes: JSON.parse(record.scopes),
			},
		});
		// The raw key appears exactly once, in this response, and is never stored or logged.
		return ok(c, { ...toPublicApiKey(record), key: raw }, { created: true });
	});

	routes.delete("/:id", async (c) => {
		const { tenant } = requireScope(c, "api_keys:write");
		const revoked = await deps.apiKeys.revoke(tenant, c.req.param("id"));
		if (!revoked) throw ApiError.notFound("API key not found.");
		await deps.audit.record(tenant, {
			eventType: "api_key.revoked",
			entityType: "api_key",
			entityId: revoked.id,
			data: { name: revoked.name },
		});
		return ok(c, toPublicApiKey(revoked));
	});

	routes.post("/:id/rotate", async (c) => {
		const { tenant } = requireScope(c, "api_keys:write");
		const rotated = await deps.apiKeys.rotate(tenant, c.req.param("id"));
		if (!rotated) throw ApiError.notFound("API key not found.");
		await deps.audit.record(tenant, {
			eventType: "api_key.rotated",
			entityType: "api_key",
			entityId: rotated.record.id,
			data: { rotated_from: c.req.param("id") },
		});
		return ok(c, { ...toPublicApiKey(rotated.record), key: rotated.raw });
	});

	return routes;
}
