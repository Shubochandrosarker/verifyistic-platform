import { ApiError, newRequestId } from "@verifyistic/core";
/**
 * Verifyistic API entry — Hono app, runtime-agnostic (ADR-001):
 * runs on Cloudflare Workers (cloud) and Node 22 (self-hosted).
 * Route contract: docs/contracts/api-route-contract-v1.md
 *
 * Tenant rule: the organization always comes from the authenticated credential,
 * never from request payloads (ADR-003). Cross-tenant ids read as not-found.
 */
import { Hono } from "hono";
import { type AppServices, createServices } from "./deps.js";
import { fail, failInternal, failNotFound, ok } from "./lib/envelope.js";
import { OPENAPI_SPEC } from "./lib/openapi.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { apiKeysRoutes } from "./routes/api-keys.js";
import { auditRoutes } from "./routes/audit.js";
import {
	billingRoutes,
	downloadRoutes,
	paddleWebhookRoutes,
} from "./routes/billing.js";
import { checkinRoutes, qrStartRoutes } from "./routes/checkin.js";
import { customersRoutes } from "./routes/customers.js";
import {
	documentsErrorStatus,
	documentsRoutes,
	verificationRoutes,
} from "./routes/documents.js";
import { importsRoutes } from "./routes/imports.js";
import { organizationRoutes } from "./routes/organization.js";
import {
	signerEntryRoutes,
	signerTransportRoutes,
} from "./routes/signer-transport.js";
import { signingErrorStatus, signingRoutes } from "./routes/signing.js";
import { sitesRoutes } from "./routes/sites.js";
import { templateErrorStatus, templatesRoutes } from "./routes/templates.js";
import { webhookRoutes } from "./routes/webhooks.js";

export { createServices, type AppServices } from "./deps.js";

const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[\w.-]{8,128}$/;

export interface RateLimitOptions {
	readPerMin?: number;
	writePerMin?: number;
}

/** In-memory per-key rate limiter (doc 05 §7 baselines). KV-backed in cloud later. */
function createRateLimiter(limits: Required<RateLimitOptions>) {
	const buckets = new Map<
		string,
		{ reads: number; writes: number; resetAt: number }
	>();
	return (c: import("hono").Context, isWrite: boolean): boolean => {
		const key =
			c.get("tenant")?.actor.id ?? c.req.header(REQUEST_ID_HEADER) ?? "anon";
		const nowMinute = Math.floor(Date.now() / 60_000);
		const bucket = buckets.get(key);
		if (!bucket || bucket.resetAt !== nowMinute) {
			buckets.set(key, { reads: 0, writes: 0, resetAt: nowMinute });
			return true;
		}
		const used = isWrite ? bucket.writes++ : bucket.reads++;
		return used < (isWrite ? limits.writePerMin : limits.readPerMin);
	};
}

export function createApp(
	services: AppServices,
	options: { rateLimits?: RateLimitOptions } = {},
) {
	const app = new Hono();
	const limiter = createRateLimiter({
		readPerMin: options.rateLimits?.readPerMin ?? 300,
		writePerMin: options.rateLimits?.writePerMin ?? 120,
	});

	// Request id: honor a well-formed client id, else mint one. Always echoed back.
	app.use("*", async (c, next) => {
		const incoming = c.req.header(REQUEST_ID_HEADER);
		c.set(
			"requestId",
			incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newRequestId(),
		);
		await next();
		c.header(REQUEST_ID_HEADER, c.get("requestId"));
	});

	app.use("*", createAuthMiddleware(services.apiKeys));

	// Per-key rate limiting (doc 05 §7): reads 300/min, writes 120/min by default.
	app.use("*", async (c, next) => {
		const method = c.req.method;
		if (method === "GET") {
			if (!limiter(c, false)) {
				throw new ApiError(
					"rate_limited",
					"Rate limit exceeded for reads. Try again shortly.",
				);
			}
		} else if (method !== "OPTIONS") {
			if (!limiter(c, true)) {
				throw new ApiError(
					"rate_limited",
					"Rate limit exceeded for writes. Try again shortly.",
				);
			}
		}
		await next();
	});

	app.onError((err, c) => {
		if (err instanceof ApiError) {
			return fail(c, err);
		}
		// Domain errors → API error envelope (404/409/400) without leaking internals.
		const mapped =
			templateErrorStatus(err) ??
			signingErrorStatus(err) ??
			documentsErrorStatus(err);
		if (mapped) {
			const fields = (err as { fields?: Record<string, string[]> }).fields;
			return c.json(
				{
					error: {
						code: mapped.code,
						message: err.message,
						...(fields ? { fields } : {}),
						request_id: c.get("requestId"),
					},
				},
				mapped.status,
			);
		}
		// Never leak internals; log safe fields only. Raw tokens/keys must never reach logs (doc 06 §10).
		console.error("unhandled_error", {
			request_id: c.get("requestId"),
			message: err.message,
			stack: err.stack?.split("\n").slice(0, 8).join(" | "),
		});
		return failInternal(c);
	});

	app.notFound((c) => failNotFound(c));

	// Hosted signer page — /s/{token} (doc 07 §3), public by design.
	app.route("/", signerEntryRoutes());

	const v1 = new Hono().basePath("/v1");

	v1.get("/health", (c) =>
		ok(c, {
			status: "ok",
			service: "verifyistic-api",
			time: new Date().toISOString(),
		}),
	);

	// Machine contract (doc 05 §1) — public.
	v1.get("/openapi.json", (c) => c.json(OPENAPI_SPEC));

	// Human docs — branded Swagger UI over the machine contract.
	v1.get("/docs", (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
				`<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
				"<title>Verifyistic API — v1 Reference</title>" +
				`<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"/>` +
				"<style>" +
				":root{--vfy-acc:#2fbf71}" +
				"body{margin:0;background:#f6f8fa}" +
				".swagger-ui,.swagger-ui .wrapper{background:#fff}" +
				".topbar{background:#0e1f31;border-bottom:2px solid var(--vfy-acc);padding:14px 24px;display:flex;align-items:center;gap:14px}" +
				".topbar .logo{color:#e8f0f7;font:800 20px -apple-system,Segoe UI,sans-serif}.topbar .logo b{color:var(--vfy-acc)}" +
				".topbar a{color:#8fd6b2;font:600 14px -apple-system,sans-serif;margin-left:auto}" +
				".swagger-ui .topbar{display:none}" +
				".swagger-ui .scheme-container{background:#f4f7fa;box-shadow:none;border-bottom:1px solid #dbe4ec}" +
				".swagger-ui .btn.authorize{background-color:var(--vfy-acc);border-color:var(--vfy-acc)}" +
				"</style></head><body>" +
				`<div class="topbar"><span class="logo">Verify<b>istic</b> API &#183; v1</span>` +
				`<a href="https://verifyistic.com">verifyistic.com</a></div>` +
				`<div id="swagger-ui"></div>` +
				`<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin><` +
				"/script>" +
				"<script>" +
				"window.onload=function(){window.ui=SwaggerUIBundle({" +
				`url:"/v1/openapi.json",dom_id:"#swagger-ui",deepLinking:true,` +
				"persistAuthorization:true,tryItOutEnabled:true," +
				`presets:[SwaggerUIBundle.presets.apis],layout:"BaseLayout"});};` +
				"<" +
				"/script></body></html>",
		),
	);

	v1.route("/organization", organizationRoutes(services));
	v1.route("/sites", sitesRoutes(services));
	v1.route("/customers", customersRoutes(services));
	v1.route("/templates", templatesRoutes(services));
	v1.route("/signing-sessions", signingRoutes(services));
	v1.route("/sign", signerTransportRoutes(services));
	v1.route("/documents", documentsRoutes(services));
	// Doc 05 mixes prefixes: search lives at /checkin/search, writes at /checkins.
	// The same router serves both prefixes.
	v1.route("/checkin", checkinRoutes(services));
	v1.route("/checkins", checkinRoutes(services));
	v1.route("/webhooks", webhookRoutes(services));
	v1.route("/api-keys", apiKeysRoutes(services));
	v1.route("/audit-events", auditRoutes(services));
	v1.route("/", billingRoutes(services));
	v1.route("/", paddleWebhookRoutes(services));
	v1.route("/imports", importsRoutes(services));

	app.route("/", v1);
	app.route("/", verificationRoutes(services));
	app.route("/", qrStartRoutes(services));
	app.route("/v1", downloadRoutes(services));

	return app;
}
