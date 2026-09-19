import { ApiError, newRequestId } from "@verifyistic/core";
/**
 * Verifyistic API entry — Hono app, runtime-agnostic (ADR-001):
 * runs on Cloudflare Workers (cloud) and Node 22 (self-hosted).
 * Route contract: docs/contracts/api-route-contract-v1.md
 */
import { Hono } from "hono";
import { fail, failInternal, failNotFound, ok } from "./lib/envelope.js";

export type ApiEnv = {
	Variables: {
		requestId: string;
	};
	// Bindings are added per runtime in Phase 2 (D1, VAULT R2, CACHE KV, QUEUE_*).
};

const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[\w.-]{8,128}$/;

export function createApp() {
	const app = new Hono<ApiEnv>();

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

	app.onError((err, c) => {
		if (err instanceof ApiError) {
			return fail(c, err);
		}
		// Never leak internals; log safe fields only. Raw tokens/keys must never reach logs (doc 06 §10).
		console.error("unhandled_error", {
			request_id: c.get("requestId"),
			message: err.message,
		});
		return failInternal(c);
	});

	app.notFound((c) => failNotFound(c));

	const v1 = new Hono<ApiEnv>().basePath("/v1");

	v1.get("/health", (c) =>
		ok(c, {
			status: "ok",
			service: "verifyistic-api",
			time: new Date().toISOString(),
		}),
	);

	app.route("/", v1);

	return app;
}
