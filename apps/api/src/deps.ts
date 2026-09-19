import { AuditService } from "@verifyistic/audit";
import { type ApiKeyMode, ApiKeyService, type Scope } from "@verifyistic/auth";
import type { Database } from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import { TenantRepositories } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";

/**
 * Runtime-injected services (ADR-001): domain packages are runtime-agnostic;
 * the app binds them to an engine — Kysely over D1 (cloud) or node:sqlite (self-hosted/tests).
 */
export interface AppServices {
	db: Kysely<Database>;
	apiKeys: ApiKeyService;
	repos: TenantRepositories;
	audit: AuditService;
}

export function createServices(db: Kysely<Database>): AppServices {
	return {
		db,
		apiKeys: new ApiKeyService(db),
		repos: new TenantRepositories(db),
		audit: new AuditService(db),
	};
}

export interface AuthContext {
	tenant: TenantContext;
	scopes: Scope[];
	keyMode: ApiKeyMode;
}

declare module "hono" {
	interface ContextVariableMap {
		requestId: string;
		tenant?: TenantContext;
		scopes?: Scope[];
		keyMode?: ApiKeyMode;
	}
}
