import { AuditService } from "@verifyistic/audit";
import { type ApiKeyMode, ApiKeyService, type Scope } from "@verifyistic/auth";
import { CustomersRepository } from "@verifyistic/customers";
import type { Database } from "@verifyistic/database";
import { SigningService } from "@verifyistic/signing";
import { TemplateService } from "@verifyistic/templates";
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
	customers: CustomersRepository;
	templates: TemplateService;
	signing: SigningService;
}

export function createServices(db: Kysely<Database>): AppServices {
	const audit = new AuditService(db);
	const customers = new CustomersRepository(db);
	const templates = new TemplateService(db);
	return {
		db,
		apiKeys: new ApiKeyService(db),
		repos: new TenantRepositories(db),
		audit,
		customers,
		templates,
		signing: new SigningService(db, { templates, customers, audit }),
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
