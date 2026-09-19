import type { ApiKeyMode, ApiKeyService, Scope } from "@verifyistic/auth";
import { ApiError } from "@verifyistic/core";
import type { TenantContext } from "@verifyistic/tenancy";
/**
 * Bearer authentication → TenantContext (ADR-003).
 * The organization ALWAYS comes from the verified API key record — never from a
 * request body or query parameter. Routes declare required scopes; without a
 * matching scope the answer is forbidden, and cross-tenant ids read as not-found.
 */
import type { Context, Next } from "hono";
import type { AuthContext } from "../deps.js";

const BEARER_PREFIX = "Bearer ";

/** Attaches tenant/scopes when a valid bearer key is present; leaves them unset otherwise. */
export function createAuthMiddleware(apiKeys: ApiKeyService) {
	return async (c: Context, next: Next) => {
		const header = c.req.header("Authorization");
		if (header?.startsWith(BEARER_PREFIX)) {
			const record = await apiKeys.verify(
				header.slice(BEARER_PREFIX.length).trim(),
			);
			if (record) {
				c.set("tenant", {
					organizationId: record.organization_id,
					actor: { type: "api_key", id: record.id },
				});
				c.set("scopes", parseScopesSafe(record.scopes));
				c.set(
					"keyMode",
					record.key_prefix.startsWith("vfy_test_") ? "test" : "live",
				);
			}
		}
		await next();
	};
}

function parseScopesSafe(json: string): Scope[] {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is Scope => typeof entry === "string");
	} catch {
		return [];
	}
}

/** Throws 401 when there is no authenticated tenant context. */
export function requireAuth(c: Context): AuthContext {
	const tenant = c.get("tenant");
	const scopes = c.get("scopes") ?? [];
	const keyMode = c.get("keyMode");
	if (!tenant || !keyMode) {
		throw new ApiError(
			"unauthorized",
			"Missing or invalid API key. Use: Authorization: Bearer vfy_live_...",
		);
	}
	return { tenant, scopes, keyMode } as AuthContext;
}

/** requireAuth + scope gate. Throws 403 when the key lacks any required scope. */
export function requireScope(c: Context, ...required: Scope[]): AuthContext {
	const auth = requireAuth(c);
	const missing = required.filter((scope) => !auth.scopes.includes(scope));
	if (missing.length > 0) {
		throw new ApiError(
			"forbidden",
			`API key is missing required scope(s): ${missing.join(", ")}`,
		);
	}
	return auth;
}

export type { TenantContext };
