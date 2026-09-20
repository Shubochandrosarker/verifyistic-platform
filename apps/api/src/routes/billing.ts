import { ApiError } from "@verifyistic/core";
/**
 * Phase 11/14 routes: Paddle webhook ingestion, entitlement reads, license
 * issuance + license-gated plugin download (R2, Phase 10). Commerce secrets
 * (PADDLE_WEBHOOK_SECRET, LICENSE_SIGNING_SECRET) are runtime-only.
 */
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { BillingService, verifyPaddleSignature } from "../lib/billing.js";
import { requireScope } from "../middleware/auth.js";

export function paddleWebhookRoutes(deps: AppServices) {
	const routes = new Hono();

	// Paddle delivery — public URL, authenticated by HMAC (doc 14 §9 step 1).
	routes.post("/paddle/webhook", async (c) => {
		const secret = deps.billingSecrets.paddleWebhookSecret;
		const body = await c.req.text();
		const timestamp =
			c.req
				.header("Paddle-Signature")
				?.split(",")
				?.find((p) => p.startsWith("ts="))
				?.slice(3) ?? "";
		const signature =
			c.req
				.header("Paddle-Signature")
				?.split(",")
				?.find((p) => p.startsWith("h1="))
				?.slice(3) ?? "";
		if (!secret) {
			// Not configured yet: accept nothing rather than trusting unsigned events.
			throw new ApiError(
				"internal_error",
				"Billing webhooks are not configured.",
			);
		}
		if (!verifyPaddleSignature({ secret, timestamp, body, signature })) {
			throw new ApiError("unauthorized", "Invalid Paddle signature.");
		}
		const event = JSON.parse(body) as import("../lib/billing.js").PaddleEvent;
		const result = await deps.billing.applyPaddleEvent(event);
		return c.json({
			received: true,
			applied: result.applied,
			plan: result.plan ?? null,
		});
	});

	return routes;
}

export function billingRoutes(deps: AppServices) {
	const routes = new Hono();

	// Entitlements for the authenticated organization.
	routes.get("/entitlements", async (c) => {
		const { tenant } = requireScope(c, "audit:read");
		const rows = await deps.db
			.selectFrom("entitlements")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("status", "=", "active")
			.execute();
		return ok(c, rows);
	});

	// Issue a self-hosted license (api key with api_keys:write = admin trust).
	routes.post("/licenses", async (c) => {
		const { tenant } = requireScope(c, "api_keys:write");
		const body = (await c.req.json().catch(() => ({}))) as {
			plan?: unknown;
			email?: unknown;
		};
		const plan = typeof body.plan === "string" ? body.plan : "";
		if (!plan)
			throw new ApiError("validation_error", "plan is required.", undefined);
		const secret = deps.billingSecrets.licenseSigningSecret;
		if (!secret)
			throw new ApiError(
				"internal_error",
				"License signing is not configured.",
			);
		const { license, rawKey } = await deps.billing.issueLicense({
			plan,
			organizationId: tenant.organizationId,
			issuedToEmail: typeof body.email === "string" ? body.email : null,
			signingSecret: secret,
		});
		// Raw key returned exactly once — hash at rest (doc 06 §4 discipline).
		return ok(c, {
			id: license.id,
			plan: license.plan,
			license_key_hint: license.license_key_hint,
			key: rawKey,
			download_url: "/v1/downloads/verifyistic-connector.zip",
		});
	});

	return routes;
}

function ok(
	c: import("hono").Context,
	data: unknown,
	extra: Record<string, unknown> = {},
) {
	return c.json({ data, meta: { request_id: c.get("requestId"), ...extra } });
}

/** License-gated download (Phase 10): public URL, license key as the credential. */
export function downloadRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/downloads/:file", async (c) => {
		const licenseKey = c.req.query("license_key") ?? "";
		const license = licenseKey
			? await deps.billing.verifyLicense(licenseKey)
			: undefined;
		if (!license)
			throw new ApiError(
				"unauthorized",
				"A valid license key is required for this download.",
			);

		const file = c.req.param("file");
		if (!/^[\w.-]+\.zip$/.test(file))
			throw new ApiError("not_found", "Unknown download.");
		const stored = await deps.storage.get(`downloads/${file}`);
		if (!stored) throw new ApiError("not_found", "Download not available yet.");
		return c.body(stored.body.slice().buffer as ArrayBuffer, {
			status: 200,
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${file}"`,
			},
		});
	});

	return routes;
}
