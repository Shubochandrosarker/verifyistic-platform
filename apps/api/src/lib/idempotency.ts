/**
 * Idempotency-Key framework (doc 05 §6). Required on create signing session,
 * customer create, check-in writes, import commit, provisioning writes.
 *
 * Replay semantics: same key + same request fingerprint (SHA-256 of the raw body)
 * → the stored response is replayed verbatim. Same key + different fingerprint
 * → 409 idempotency_conflict. Keys expire after 24h.
 */
import { ApiError, newId, sha256Hex } from "@verifyistic/core";
import type { Database } from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Context } from "hono";
import type { Kysely } from "kysely";

const TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyStore {
	constructor(private readonly db: Kysely<Database>) {}

	async lookup(
		organizationId: string,
		key: string,
		method: string,
		path: string,
	): Promise<
		{ fingerprint: string; status: number; body: string } | undefined
	> {
		const record = await this.db
			.selectFrom("idempotency_keys")
			.selectAll()
			.where("organization_id", "=", organizationId)
			.where("idempotency_key", "=", key)
			.where("method", "=", method)
			.where("path", "=", path)
			.where("expires_at", ">", new Date().toISOString())
			.executeTakeFirst();
		if (!record) return undefined;
		return {
			fingerprint: record.request_fingerprint,
			status: record.response_status,
			body: record.response_body,
		};
	}

	async save(
		organizationId: string,
		key: string,
		method: string,
		path: string,
		fingerprint: string,
		status: number,
		body: string,
	): Promise<void> {
		await this.db
			.insertInto("idempotency_keys")
			.values({
				id: newId(),
				organization_id: organizationId,
				idempotency_key: key,
				method,
				path,
				request_fingerprint: fingerprint,
				response_status: status,
				response_body: body,
				created_at: new Date().toISOString(),
				expires_at: new Date(Date.now() + TTL_MS).toISOString(),
			})
			.execute();
	}
}

export interface IdempotentContext {
	tenant: TenantContext;
	key: string;
	method: string;
	path: string;
	fingerprint: string;
	/** When set: replay this stored response immediately and skip the handler. */
	replay?: { status: number; body: string };
}

/**
 * Resolve an incoming Idempotency-Key against the store.
 * - missing/blank key → undefined (route decides whether it is mandatory)
 * - replay hit → IdempotentContext with replay payload
 * - fingerprint mismatch → throws idempotency_conflict
 *
 * IMPORTANT: pass the RAW request body text — routes must read it once via
 * `await c.req.text()` and hand it here BEFORE parsing; Request.clone() throws
 * "unusable" once the body stream has been disturbed.
 */
export async function resolveIdempotency(
	store: IdempotencyStore,
	tenant: TenantContext,
	c: Context,
	rawBody: string,
): Promise<IdempotentContext | undefined> {
	const key = c.req.header("Idempotency-Key")?.trim();
	if (!key || key.length < 8 || key.length > 255) return undefined;

	const fingerprint = await sha256Hex(rawBody);
	const path = c.req.path;

	const hit = await store.lookup(
		tenant.organizationId,
		key,
		c.req.method,
		path,
	);
	if (hit) {
		if (hit.fingerprint !== fingerprint) {
			throw new ApiError(
				"idempotency_conflict",
				"Idempotency-Key was already used with a different request payload.",
			);
		}
		return {
			tenant,
			key,
			method: c.req.method,
			path,
			fingerprint,
			replay: { status: hit.status, body: hit.body },
		};
	}
	return { tenant, key, method: c.req.method, path, fingerprint };
}

/** Persist a response for an idempotent request (call after the handler produces a 2xx). */
export async function storeIdempotentResponse(
	store: IdempotencyStore,
	ctx: IdempotentContext,
	status: number,
	body: string,
): Promise<void> {
	await store.save(
		ctx.tenant.organizationId,
		ctx.key,
		ctx.method,
		ctx.path,
		ctx.fingerprint,
		status,
		body,
	);
}
