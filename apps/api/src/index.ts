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
import { createAuthMiddleware } from "./middleware/auth.js";
import { apiKeysRoutes } from "./routes/api-keys.js";
import { auditRoutes } from "./routes/audit.js";
import { customersRoutes } from "./routes/customers.js";
import {
	documentsErrorStatus,
	documentsRoutes,
	verificationRoutes,
} from "./routes/documents.js";
import { organizationRoutes } from "./routes/organization.js";
import {
	signerEntryRoutes,
	signerTransportRoutes,
} from "./routes/signer-transport.js";
import { signingErrorStatus, signingRoutes } from "./routes/signing.js";
import { sitesRoutes } from "./routes/sites.js";
import { templateErrorStatus, templatesRoutes } from "./routes/templates.js";

export { createServices, type AppServices } from "./deps.js";

const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[\w.-]{8,128}$/;

export function createApp(services: AppServices) {
	const app = new Hono();

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

	v1.route("/organization", organizationRoutes(services));
	v1.route("/sites", sitesRoutes(services));
	v1.route("/customers", customersRoutes(services));
	v1.route("/templates", templatesRoutes(services));
	v1.route("/signing-sessions", signingRoutes(services));
	v1.route("/sign", signerTransportRoutes(services));
	v1.route("/documents", documentsRoutes(services));
	v1.route("/api-keys", apiKeysRoutes(services));
	v1.route("/audit-events", auditRoutes(services));

	app.route("/", v1);
	app.route("/", verificationRoutes(services));

	return app;
}
