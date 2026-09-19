/**
 * Cloudflare Workers entry (cloud edition, ADR-001).
 * Bindings: DB (D1), VAULT (R2 private bucket). Secrets injected at runtime.
 * Services are memoized per isolate — the bindings are stable across requests.
 */
import { type D1DatabaseLike, createD1Kysely } from "@verifyistic/database/d1";
import { type R2BucketBinding, R2StorageProvider } from "@verifyistic/storage";
import { type AppServices, createApp, createServices } from "./index.js";

export interface Env {
	DB: D1DatabaseLike;
	VAULT: R2BucketBinding;
	WEBHOOK_ENCRYPTION_KEY?: string;
	VERIFY_BASE_URL?: string;
}

let cached: AppServices | undefined;

function getServices(env: Env): AppServices {
	if (!cached) {
		const db = createD1Kysely(env.DB);
		cached = createServices(db, {
			storage: new R2StorageProvider(env.VAULT),
			verifyBaseUrl: env.VERIFY_BASE_URL ?? "https://verifyistic.com",
			webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY ?? "",
		});
	}
	return cached;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return createApp(getServices(env)).fetch(request);
	},
};
