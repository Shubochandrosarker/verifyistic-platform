import { ApiError } from "@verifyistic/core";
/**
 * Public signer transport (doc 05 §4): token-authenticated, aggressively rate-limited,
 * no-referrer. The token IS the credential — the tenant derives from the session row,
 * never from any request parameter. Mounted at /v1/sign; the hosted page lives at /s/{token}.
 */
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { fail, ok } from "../lib/envelope.js";
import { signerPageHtml } from "./signer-page.js";
import { signingErrorStatus } from "./signing.js";

/** In-memory per-token rate limiter (KV-based in cloud later). 60 requests / 5 min / token. */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(token: string): void {
	const now = Date.now();
	const bucket = buckets.get(token);
	if (!bucket || bucket.resetAt <= now) {
		buckets.set(token, { count: 1, resetAt: now + WINDOW_MS });
		if (buckets.size > 10_000) {
			for (const [key, value] of buckets) {
				if (value.resetAt <= now) buckets.delete(key);
			}
		}
		return;
	}
	bucket.count += 1;
	if (bucket.count > MAX_REQUESTS) {
		throw new ApiError(
			"rate_limited",
			"Too many requests for this signing link. Try again later.",
		);
	}
}

/** Hosted signer entry page — mounted at app root: GET /s/{token} (doc 07 §3). */
export function signerEntryRoutes() {
	const routes = new Hono();
	routes.get("/s/:token", (c) => {
		c.header("Referrer-Policy", "no-referrer");
		c.header("X-Robots-Tag", "noindex, nofollow");
		c.header(
			"Content-Security-Policy",
			"default-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
		);
		return c.html(signerPageHtml());
	});
	return routes;
}

export function signerTransportRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.use("*", async (c, next) => {
		rateLimit(c.req.param("token") ?? "unknown");
		await next();
		c.header("Referrer-Policy", "no-referrer");
	});

	routes.get("/:token/session", async (c) => {
		const { view } = await deps.signing.openByToken(c.req.param("token"));
		return ok(c, view);
	});

	routes.post("/:token/progress", async (c) => {
		const body = await c.req.json().catch(() => null);
		const values =
			(body as { values?: Record<string, unknown> } | null)?.values ?? {};
		const result = await deps.signing.saveProgress(
			c.req.param("token"),
			values,
		);
		return ok(c, result);
	});

	routes.post("/:token/complete", async (c) => {
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const payload = body as {
			values?: Record<string, unknown>;
			consent?: { accepted: boolean };
			signatures?: {
				role: "signer" | "guardian";
				method: "drawn" | "typed";
				typed_name?: string;
				artifact?: string;
			}[];
		};
		const result = await deps.signing.complete(
			c.req.param("token"),
			{
				values: payload.values ?? {},
				consent: payload.consent ?? { accepted: false },
				signatures: payload.signatures ?? [],
			},
			{
				ip:
					c.req.header("CF-Connecting-IP") ??
					c.req.header("X-Forwarded-For")?.split(",")[0]?.trim(),
				userAgent: c.req.header("User-Agent"),
			},
		);
		return ok(c, {
			session_id: result.session.id,
			status: result.session.status,
			already_finalizing: result.already_finalizing,
			signature_set_hash: result.signature_set_hash,
		});
	});

	routes.post("/:token/decline", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
		const session = await deps.signing.decline(
			c.req.param("token"),
			body.reason,
			{
				ip:
					c.req.header("CF-Connecting-IP") ??
					c.req.header("X-Forwarded-For")?.split(",")[0]?.trim(),
			},
		);
		return ok(c, { session_id: session.id, status: session.status });
	});

	routes.onError((error, c) => {
		const mapped = signingErrorStatus(error);
		if (mapped) {
			const fields = (error as { fields?: Record<string, string[]> }).fields;
			return c.json(
				{
					error: {
						code: mapped.code,
						message: (error as Error).message,
						...(fields ? { fields } : {}),
						request_id: c.get("requestId"),
					},
				},
				mapped.status,
			);
		}
		if (error instanceof ApiError) {
			return fail(c, error);
		}
		console.error("signer_transport_error", {
			request_id: c.get("requestId"),
			message: (error as Error).message,
		});
		return c.json(
			{
				error: {
					code: "internal_error",
					message: "Internal server error.",
					request_id: c.get("requestId"),
				},
			},
			500,
		);
	});

	return routes;
}
