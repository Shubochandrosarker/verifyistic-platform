/**
 * Scopes for API keys (doc 06 §4). Keys grant narrow scopes; endpoints declare
 * the scope they require. Capability checks (user roles) live in capabilities.ts.
 */
export const SCOPES = [
	"sites:read",
	"sites:write",
	"customers:read",
	"customers:write",
	"templates:read",
	"templates:write",
	"api_keys:read",
	"api_keys:write",
	"audit:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
	return (SCOPES as readonly string[]).includes(value);
}

/** Parse the stored JSON scopes column; unknown scopes are dropped (fail-closed). */
export function parseScopes(json: string): Scope[] {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is Scope => typeof entry === "string" && isScope(entry),
		);
	} catch {
		return [];
	}
}

export function hasScopes(granted: Scope[], required: Scope[]): boolean {
	return required.every((scope) => granted.includes(scope));
}
