import { ApiError } from "@verifyistic/core";
import type { SigningSessionStatus } from "@verifyistic/core";
import {
	FieldValidationError,
	SessionStateError,
	TokenExpiredError,
	TokenNotFoundError,
	TokenRevokedError,
} from "@verifyistic/signing";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import {
	resolveIdempotency,
	storeIdempotentResponse,
} from "../lib/idempotency.js";
import { requireScope } from "../middleware/auth.js";

/** Domain errors → API error envelope (used by index.ts onError). */
export function signingErrorStatus(error: unknown): {
	code: "not_found" | "validation_error" | "conflict" | "gone";
	status: 404 | 400 | 409;
} | null {
	if (error instanceof TokenNotFoundError)
		return { code: "not_found", status: 404 };
	if (error instanceof TokenRevokedError)
		return { code: "not_found", status: 404 };
	if (error instanceof TokenExpiredError)
		return { code: "not_found", status: 404 };
	if (error instanceof FieldValidationError)
		return { code: "validation_error", status: 400 };
	if (error instanceof SessionStateError)
		return { code: "conflict", status: 409 };
	return null;
}

/** Public session shape — token material never leaves the creation response. */
function toPublicSession(record: {
	id: string;
	status: string;
	template_version_id: string;
	customer_id: string;
	site_id: string | null;
	delivery_method: string;
	started_at: string | null;
	completed_at: string | null;
	declined_at: string | null;
	expires_at: string | null;
	created_at: string;
}) {
	return {
		id: record.id,
		status: record.status,
		template_version_id: record.template_version_id,
		customer_id: record.customer_id,
		site_id: record.site_id,
		delivery_method: record.delivery_method,
		started_at: record.started_at,
		completed_at: record.completed_at,
		declined_at: record.declined_at,
		expires_at: record.expires_at,
		created_at: record.created_at,
	};
}

export function signingRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "signing:write");
		// Read the raw body ONCE — Idempotency-Key fingerprinting and JSON parsing
		// share it (Request.clone() throws once the stream is disturbed).
		const rawBody = await c.req.text();
		const idem = await resolveIdempotency(
			deps.idempotencyStore,
			tenant,
			c,
			rawBody,
		);
		if (idem?.replay) {
			return c.json(
				JSON.parse(idem.replay.body),
				idem.replay.status as ContentfulStatusCode,
			);
		}
		const body = JSON.parse(rawBody) as unknown;
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const {
			template_id,
			customer_id,
			site_id,
			expires_in_seconds,
			delivery_method,
			metadata,
		} = body as Record<string, unknown>;
		if (typeof template_id !== "string" || template_id.length === 0) {
			throw ApiError.validation("template_id is required.", {
				template_id: ["required"],
			});
		}
		if (typeof customer_id !== "string" || customer_id.length === 0) {
			throw ApiError.validation("customer_id is required.", {
				customer_id: ["required"],
			});
		}
		if (
			expires_in_seconds !== undefined &&
			(typeof expires_in_seconds !== "number" ||
				expires_in_seconds < 300 ||
				expires_in_seconds > 2_592_000)
		) {
			throw ApiError.validation(
				"expires_in_seconds must be between 300 and 2592000 (30 days).",
				{
					expires_in_seconds: ["invalid"],
				},
			);
		}

		const { session, participants, token } = await deps.signing.createSession(
			tenant,
			{
				template_id,
				customer_id,
				site_id: (site_id as string | null) ?? null,
				expires_in_seconds,
				delivery_method:
					typeof delivery_method === "string" ? delivery_method : undefined,
				metadata:
					(metadata as Record<string, unknown> | undefined) ?? undefined,
			},
		);

		// Email delivery: queue the invitation (worker pumps the outbox — Phase 6).
		if (session.delivery_method === "email") {
			const customer = await deps.customers.get(tenant, customer_id);
			if (customer?.email) {
				await deps.emailOutbox.enqueue({
					to: customer.email,
					template: "signing_session_invitation",
					payload: {
						signer_url: `/s/${token}`,
						business: (await deps.repos.getOrganization(tenant))?.name ?? "",
						document_title: session.template_version_id,
					},
					organizationId: tenant.organizationId,
				});
			}
		}
		// Webhook fanout (composition layer — doc 05 §5).
		await deps.webhooks.enqueueEvent(
			tenant.organizationId,
			"signing_session.created",
			{
				session_id: session.id,
				template_id,
				customer_id,
				guardian_required: participants.some((p) => p.role === "guardian"),
			},
		);
		const envelope = {
			data: {
				...toPublicSession(session),
				participants: participants.map((p) => ({
					role: p.role,
					required: p.required === 1,
				})),
				// The raw signer URL is returned exactly once — never stored, never logged.
				signer_url: `/s/${token}`,
				token,
			},
			meta: { request_id: c.get("requestId"), created: true },
		};
		if (idem)
			await storeIdempotentResponse(
				deps.idempotencyStore,
				idem,
				200,
				JSON.stringify(envelope),
			);
		return c.json(envelope);
	});

	routes.get("/", async (c) => {
		requireScope(c, "signing:read");
		const status = c.req.query("status");
		const sessions = await deps.signing.list(
			c.get("tenant")!,
			(status as SigningSessionStatus) || undefined,
		);
		return ok(c, sessions.map(toPublicSession));
	});

	routes.get("/:id", async (c) => {
		requireScope(c, "signing:read");
		const session = await deps.signing.get(c.get("tenant")!, c.req.param("id"));
		if (!session) throw ApiError.notFound("Signing session not found.");
		return ok(c, toPublicSession(session));
	});

	routes.post("/:id/resend", async (c) => {
		const { tenant } = requireScope(c, "signing:write");
		const session = await deps.signing.resend(tenant, c.req.param("id"));
		if (!session) throw ApiError.notFound("Signing session not found.");
		return ok(c, toPublicSession(session));
	});

	routes.post("/:id/cancel", async (c) => {
		const { tenant } = requireScope(c, "signing:write");
		const session = await deps.signing.cancel(tenant, c.req.param("id"));
		if (!session) throw ApiError.notFound("Signing session not found.");
		return ok(c, toPublicSession(session));
	});

	return routes;
}
