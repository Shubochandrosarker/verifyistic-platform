/**
 * TenantContext — the mandatory carrier of "who is acting, on which organization".
 * Derived from authentication (API key ownership / session membership), never from
 * request payloads (doc 24: never trust organization ID from the request body alone).
 */
export type ActorType = "api_key" | "user" | "system" | "signer";

export interface Actor {
	type: ActorType;
	id: string;
}

export interface TenantContext {
	organizationId: string;
	actor: Actor;
}

export class MissingTenantContextError extends Error {
	constructor() {
		super(
			"Tenant context is required — authenticate before calling tenant-scoped operations.",
		);
		this.name = "MissingTenantContextError";
	}
}

export function requireTenant(
	context: TenantContext | undefined | null,
): TenantContext {
	if (!context || !context.organizationId) {
		throw new MissingTenantContextError();
	}
	return context;
}
