import { type AppServices, createServices } from "@verifyistic/api";
/**
 * Cloudflare scheduled worker for asynchronous Verifyistic jobs.
 *
 * The API and worker share the same D1/R2 resources. Cron delivery is
 * at-least-once, so the domain services remain idempotent and retryable.
 */
import { type D1DatabaseLike, createD1Kysely } from "@verifyistic/database/d1";
import { type R2BucketBinding, R2StorageProvider } from "@verifyistic/storage";
import { ResendEmailSender, SmtpEmailSender } from "@verifyistic/webhooks";
import { runJobsOnce } from "./index.js";
import { CloudflareSmtpConnector } from "./smtp.js";

interface Env {
	DB: D1DatabaseLike;
	VAULT: R2BucketBinding;
	ENVIRONMENT?: string;
	VERIFY_BASE_URL?: string;
	SIGNER_BASE_URL?: string;
	WEBHOOK_ENCRYPTION_KEY?: string;
	RESEND_API_KEY?: string;
	RESEND_FROM?: string;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_MODE?: "tls" | "starttls";
	SMTP_USER?: string;
	SMTP_PASSWORD?: string;
	SMTP_FROM?: string;
	SMTP_HELO?: string;
}

interface WorkerExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

function createCloudServices(env: Env): AppServices {
	const db = createD1Kysely(env.DB);
	return createServices(db, {
		storage: new R2StorageProvider(env.VAULT),
		verifyBaseUrl: env.VERIFY_BASE_URL ?? "https://api.verifyistic.com",
		signerBaseUrl: env.SIGNER_BASE_URL ?? "https://api.verifyistic.com",
		webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY ?? "",
		fetcher: async (url, init) => {
			const response = await fetch(url, init);
			return {
				ok: response.ok,
				status: response.status,
				requestId: response.headers.get("X-Request-ID") ?? undefined,
			};
		},
		emailSender: env.SMTP_HOST
			? new SmtpEmailSender({
					connector: new CloudflareSmtpConnector(),
					host: env.SMTP_HOST,
					port: Number(env.SMTP_PORT ?? "465"),
					mode: env.SMTP_MODE ?? "tls",
					username: env.SMTP_USER ?? "",
					password: env.SMTP_PASSWORD ?? "",
					from:
						env.SMTP_FROM ??
						env.RESEND_FROM ??
						"Verifyistic <noreply@verifyistic.com>",
					heloName: env.SMTP_HELO,
				})
			: new ResendEmailSender(
					env.RESEND_API_KEY ?? "",
					env.RESEND_FROM ?? "Verifyistic <noreply@verifyistic.com>",
				),
	});
}

export default {
	async scheduled(
		_controller: unknown,
		env: Env,
		ctx: WorkerExecutionContext,
	): Promise<void> {
		ctx.waitUntil(
			runJobsOnce(createCloudServices(env)).catch((error) => {
				console.error("verifyistic_worker_tick_failed", {
					message: (error as Error).message,
					environment: env.ENVIRONMENT ?? "unknown",
				});
			}),
		);
	},

	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		// Do not expose Wrangler's local cron trigger in production.
		if (url.pathname === "/__scheduled" && env.ENVIRONMENT === "production") {
			return new Response("Not Found", { status: 404 });
		}
		return new Response("Verifyistic worker is running.", {
			status: 200,
			headers: { "Cache-Control": "no-store" },
		});
	},
};
