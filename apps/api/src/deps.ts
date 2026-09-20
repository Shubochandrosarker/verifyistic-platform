import { AuditService } from "@verifyistic/audit";
import { type ApiKeyMode, ApiKeyService, type Scope } from "@verifyistic/auth";
import { CheckInService, CustomersRepository } from "@verifyistic/customers";
import type { Database } from "@verifyistic/database";
import { DocumentService } from "@verifyistic/documents";
import { SigningService } from "@verifyistic/signing";
import {
	MemoryStorageProvider,
	type StorageProvider,
} from "@verifyistic/storage";
import { LocalStorageProvider } from "@verifyistic/storage/local";
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
import { BillingService } from "./lib/billing.js";
import { IdempotencyStore } from "./lib/idempotency.js";

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
	checkin: CheckInService;
	templates: TemplateService;
	signing: SigningService;
	documents: DocumentService;
	storage: StorageProvider;
	webhooks: WebhookService;
	emailOutbox: EmailOutbox;
	emailSender: EmailSender;
	idempotencyStore: IdempotencyStore;
	billing: BillingService;
	billingSecrets: { paddleWebhookSecret: string; licenseSigningSecret: string };
}

export interface ServiceOptions {
	/** Defaults to a local filesystem store under ./local/documents (self-hosted/dev). */
	storage?: StorageProvider;
	verifyBaseUrl?: string;
	/** Runtime secret for webhook-signing-secret encryption at rest (doc 06 §10). */
	webhookEncryptionKey?: string;
	fetcher?: DeliveryFetcher;
	emailSender?: EmailSender;
	paddleWebhookSecret?: string;
	licenseSigningSecret?: string;
}

export function createServices(
	db: Kysely<Database>,
	options: ServiceOptions = {},
): AppServices {
	const audit = new AuditService(db);
	const customers = new CustomersRepository(db);
	const templates = new TemplateService(db);
	// Node-only local filesystem default — only evaluated when no storage is injected
	// AND a Node runtime is present (Workers callers always inject R2 storage).
	const storage =
		options.storage ??
		(typeof process !== "undefined" &&
		process.env?.STORAGE_PROVIDER === "memory"
			? new MemoryStorageProvider()
			: new LocalStorageProvider(
					typeof process !== "undefined"
						? (process.env?.STORAGE_LOCAL_PATH ?? "local/documents")
						: "local/documents",
				));
	const documents = new DocumentService(db, {
		storage,
		audit,
		verifyBaseUrl:
			options.verifyBaseUrl ??
			(typeof process !== "undefined"
				? process.env?.VERIFY_BASE_URL
				: undefined),
	});
	const webhookEncryptionKey =
		options.webhookEncryptionKey ??
		(typeof process !== "undefined"
			? (process.env?.WEBHOOK_ENCRYPTION_KEY ?? "")
			: "");
	const webhooks = new WebhookService(db, {
		encryptionKey: webhookEncryptionKey || "insecure-dev-key",
		fetcher: options.fetcher,
	});
	const emailSender = options.emailSender ?? new ConsoleEmailSender();
	const idempotencyStore = new IdempotencyStore(db);
	return {
		db,
		apiKeys: new ApiKeyService(db),
		repos: new TenantRepositories(db),
		audit,
		customers,
		checkin: new CheckInService(db),
		templates,
		signing: new SigningService(db, { templates, customers, audit }),
		documents,
		storage,
		webhooks,
		emailOutbox: new EmailOutbox(db),
		emailSender,
		idempotencyStore,
		billing: new BillingService(db),
		billingSecrets: {
			paddleWebhookSecret:
				options.paddleWebhookSecret ??
				(typeof process !== "undefined"
					? (process.env?.PADDLE_WEBHOOK_SECRET ?? "")
					: ""),
			licenseSigningSecret:
				options.licenseSigningSecret ??
				(typeof process !== "undefined"
					? (process.env?.LICENSE_SIGNING_SECRET ?? "")
					: ""),
		},
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
		siteRestrictions?: string[] | null;
	}
}
