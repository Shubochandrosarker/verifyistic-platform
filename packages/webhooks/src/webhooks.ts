/**
 * Webhook engine (doc 05 §5, doc 13 §6): per-endpoint signing secrets (AES-256-GCM at
 * rest), HMAC-SHA256 delivery signatures (v1=<hex> over "timestamp.body"), DB-backed
 * queue with bounded exponential-backoff retries and dead-letter visibility.
 * Delivery uses an injected fetcher — the domain never touches runtime networking.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
} from "node:crypto";
import { newId } from "@verifyistic/core";
import type {
	Database,
	WebhookDelivery,
	WebhookEndpoint,
} from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import { isWebhookUrlAllowed } from "./url-guard.js";

const nowIso = () => new Date().toISOString();
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600]; // 1m, 5m, 30m, 2h, 6h — then dead-letter

// --- secret encryption (application-level, doc 09 §11) -----------------------

function encryptionKey(secretEnv: string): Buffer {
	return createHash("sha256").update(secretEnv).digest();
}

import { createHash } from "node:crypto";

/** AES-256-GCM: output = v1.<iv-b64>.<tag-b64>.<ciphertext-b64> */
export function encryptSecret(plaintext: string, keyEnv: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyEnv), iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(ciphertext: string, keyEnv: string): string {
	const [version, ivB64, tagB64, dataB64] = ciphertext.split(".");
	if (version !== "v1" || !ivB64 || !tagB64 || !dataB64)
		throw new Error("Malformed secret ciphertext.");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(keyEnv),
		Buffer.from(ivB64, "base64"),
	);
	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, "base64")),
		decipher.setAuthTag(Buffer.from(tagB64, "base64")).final(),
	]).toString("utf8");
}

/** Signature per route contract v1: Verifyistic-Signature: v1=hex(hmac_sha256(secret, timestamp + "." + body)) */
export function signPayload(
	secret: string,
	timestamp: number,
	body: string,
): string {
	const mac = createHmac("sha256", secret)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	return `v1=${mac}`;
}

export type DeliveryFetcher = (
	url: string,
	init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{
	ok: boolean;
	status: number;
	requestId?: string;
}>;

export interface WebhookServiceDeps {
	/** Runtime-injected secret (WEBHOOK_ENCRYPTION_KEY) — required, fail-closed. */
	encryptionKey: string;
	fetcher?: DeliveryFetcher;
	now?: () => Date;
}

export class WebhookService {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly deps: WebhookServiceDeps,
	) {}

	private nowIso(): string {
		return (this.deps.now ?? (() => new Date()))().toISOString();
	}

	async registerEndpoint(
		tenant: TenantContext,
		input: { url: string; subscribedEvents?: string[] },
	): Promise<{ record: WebhookEndpoint; secret: string }> {
		const guard = isWebhookUrlAllowed(input.url);
		if (!guard.allowed)
			throw new Error(`Webhook URL rejected: ${guard.reason}`);

		const secret = randomBytes(32).toString("base64");
		const now = this.nowIso();
		const record: WebhookEndpoint = {
			id: newId(),
			organization_id: tenant.organizationId,
			url: input.url,
			secret_ciphertext: encryptSecret(secret, this.deps.encryptionKey),
			subscribed_events: JSON.stringify(input.subscribedEvents ?? ["*"]),
			status: "active",
			created_at: now,
			updated_at: now,
		};
		await this.db.insertInto("webhook_endpoints").values(record).execute();
		// The raw secret is shown exactly once — receivers verify HMACs with it.
		return { record, secret };
	}

	async listEndpoints(tenant: TenantContext): Promise<WebhookEndpoint[]> {
		return this.db
			.selectFrom("webhook_endpoints")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "asc")
			.execute();
	}

	async removeEndpoint(
		tenant: TenantContext,
		endpointId: string,
	): Promise<boolean> {
		const result = await this.db
			.updateTable("webhook_endpoints")
			.set({ status: "disabled", updated_at: this.nowIso() })
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", endpointId)
			.executeTakeFirst();
		return Number(result.numUpdatedRows) > 0;
	}

	/** Queue an event: creates one delivery per matching active endpoint. */
	async enqueueEvent(
		organizationId: string,
		eventType: string,
		payload: Record<string, unknown>,
	): Promise<number> {
		const endpoints = await this.db
			.selectFrom("webhook_endpoints")
			.selectAll()
			.where("organization_id", "=", organizationId)
			.where("status", "=", "active")
			.execute();
		const now = this.nowIso();
		const eventId = `evt_${newId()}`;
		let queued = 0;
		for (const endpoint of endpoints) {
			const subscribed: string[] = JSON.parse(endpoint.subscribed_events);
			if (!subscribed.includes("*") && !subscribed.includes(eventType))
				continue;
			await this.db
				.insertInto("webhook_deliveries")
				.values({
					id: newId(),
					organization_id: organizationId,
					endpoint_id: endpoint.id,
					event_id: eventId,
					event_type: eventType,
					// Include the stable event id in the signed body as well as the
					// transport header. Receivers can deduplicate without trusting headers.
					payload_json: JSON.stringify({
						event_id: eventId,
						event: eventType,
						data: payload,
					}),
					attempt: 0,
					max_attempts: RETRY_DELAYS_SECONDS.length + 1,
					status: "pending",
					request_id: null,
					response_status: null,
					next_retry_at: now, // due immediately
					delivered_at: null,
					last_error: null,
					created_at: now,
					updated_at: now,
				})
				.execute();
			queued += 1;
		}
		return queued;
	}

	/** Worker: process up to `limit` due deliveries. Returns processed count. */
	async processDueDeliveries(limit = 20): Promise<number> {
		const now = this.nowIso();
		const due = await this.db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.where("status", "=", "pending")
			.where("next_retry_at", "<=", now)
			.orderBy("next_retry_at", "asc")
			.limit(limit)
			.execute();

		const fetcher = this.deps.fetcher;
		let processed = 0;
		for (const delivery of due) {
			const endpoint = (await this.db
				.selectFrom("webhook_endpoints")
				.selectAll()
				.where("id", "=", delivery.endpoint_id)
				.executeTakeFirst())!;
			if (!endpoint || endpoint.status !== "active") {
				await this.db
					.updateTable("webhook_deliveries")
					.set({
						status: "failed",
						last_error: "endpoint disabled",
						updated_at: nowIso(),
					})
					.where("id", "=", delivery.id)
					.execute();
				continue;
			}
			const attempt = delivery.attempt + 1;
			const secret = decryptSecret(
				endpoint.secret_ciphertext,
				this.deps.encryptionKey,
			);
			const timestamp = Math.floor(new Date(this.nowIso()).getTime() / 1000);
			const signature = signPayload(secret, timestamp, delivery.payload_json);
			const requestId = `whr_${newId()}`;

			let ok = false;
			let status: number | null = null;
			let error: string | null = null;
			if (!fetcher) {
				error = "no fetcher configured";
			} else {
				try {
					const response = await fetcher(endpoint.url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Verifyistic-Event-ID": delivery.event_id,
							"Verifyistic-Event-Type": delivery.event_type,
							"Verifyistic-Timestamp": String(timestamp),
							"Verifyistic-Signature": signature,
							"X-Request-ID": requestId,
						},
						body: delivery.payload_json,
					});
					ok = response.ok;
					status = response.status;
					if (!ok) error = `HTTP ${response.status}`;
				} catch (fetchError) {
					error = (fetchError as Error).message.slice(0, 300);
				}
			}

			const dead = !ok && attempt >= delivery.max_attempts;
			const nextDelay =
				RETRY_DELAYS_SECONDS[
					Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)
				] ?? 21600;
			const nextRetryAt = new Date(
				new Date(this.nowIso()).getTime() + nextDelay * 1000,
			).toISOString();

			await this.db
				.updateTable("webhook_deliveries")
				.set({
					attempt,
					status: ok ? "delivered" : dead ? "dead_letter" : "pending",
					request_id: requestId,
					response_status: status,
					delivered_at: ok ? this.nowIso() : null,
					next_retry_at: ok || dead ? null : nextRetryAt,
					last_error: error,
					updated_at: this.nowIso(),
				})
				.where("id", "=", delivery.id)
				.execute();
			processed += 1;
		}
		return processed;
	}

	async listDeliveries(
		tenant: TenantContext,
		endpointId: string,
	): Promise<WebhookDelivery[]> {
		return this.db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("endpoint_id", "=", endpointId)
			.orderBy("created_at", "desc")
			.limit(100)
			.execute();
	}
}
