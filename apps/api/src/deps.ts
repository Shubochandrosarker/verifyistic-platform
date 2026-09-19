import { AuditService } from "@verifyistic/audit";
import { type ApiKeyMode, ApiKeyService, type Scope } from "@verifyistic/auth";
import { CustomersRepository } from "@verifyistic/customers";
import type { Database } from "@verifyistic/database";
import { DocumentService } from "@verifyistic/documents";
import { SigningService } from "@verifyistic/signing";
import {
	LocalStorageProvider,
	MemoryStorageProvider,
	type StorageProvider,
} from "@verifyistic/storage";
import { TemplateService } from "@verifyistic/templates";
import type { TenantContext } from "@verifyistic/tenancy";
import { TenantRepositories } from "@verifyistic/tenancy";
import {
	ConsoleEmailSender,
	type DeliveryFetcher,
	EmailOutbox,
	type EmailSender,
	WebhookService,
} from "@verifyistic/webhooks";
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
	documents: DocumentService;
	storage: StorageProvider;
	webhooks: WebhookService;
	emailOutbox: EmailOutbox;
	emailSender: EmailSender;
}

export interface ServiceOptions {
	/** Defaults to a local filesystem store under ./local/documents (self-hosted/dev). */
	storage?: StorageProvider;
	verifyBaseUrl?: string;
	/** Runtime secret for webhook-signing-secret encryption at rest (doc 06 §10). */
	webhookEncryptionKey?: string;
	fetcher?: DeliveryFetcher;
	emailSender?: EmailSender;
}

export function createServices(
	db: Kysely<Database>,
	options: ServiceOptions = {},
): AppServices {
	const audit = new AuditService(db);
	const customers = new CustomersRepository(db);
	const templates = new TemplateService(db);
	const storage =
		options.storage ??
		(process.env.STORAGE_PROVIDER === "memory"
			? new MemoryStorageProvider()
			: new LocalStorageProvider(
					process.env.STORAGE_LOCAL_PATH ?? "local/documents",
				));
	const documents = new DocumentService(db, {
		storage,
		audit,
		verifyBaseUrl: options.verifyBaseUrl ?? process.env.VERIFY_BASE_URL,
	});
	const webhookEncryptionKey =
		options.webhookEncryptionKey ?? process.env.WEBHOOK_ENCRYPTION_KEY ?? "";
	const webhooks = new WebhookService(db, {
		encryptionKey: webhookEncryptionKey || "insecure-dev-key",
		fetcher: options.fetcher,
	});
	const emailSender = options.emailSender ?? new ConsoleEmailSender();
	return {
		db,
		apiKeys: new ApiKeyService(db),
		repos: new TenantRepositories(db),
		audit,
		customers,
		templates,
		signing: new SigningService(db, { templates, customers, audit }),
		documents,
		storage,
		webhooks,
		emailOutbox: new EmailOutbox(db),
		emailSender,
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
