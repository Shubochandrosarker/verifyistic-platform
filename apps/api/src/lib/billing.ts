/**
 * Billing glue (Phase 11, doc 14 §9): Paddle webhook ingestion → entitlements,
 * and self-hosted license issuance/gating (Phase 10). This is the composition
 * root for external commerce — Paddle specifics stay in the app layer per ADR-002.
 *
 * Paddle webhook auth: HMAC-SHA256 over `timestamp:body` with the notification
 * secret, 5-second-tolerance replay window per Paddle docs.
 */
import { createHmac } from "node:crypto";
import { newId, sha256Hex } from "@verifyistic/core";
import type { Database, License } from "@verifyistic/database";
import type { Kysely } from "kysely";

const nowIso = () => new Date().toISOString();

export function verifyPaddleSignature(options: {
	secret: string;
	timestamp: string;
	body: string;
	signature: string;
}): boolean {
	if (!options.timestamp || !options.signature) return false;
	const expected = createHmac("sha256", options.secret)
		.update(`${options.timestamp}:${options.body}`)
		.digest("hex");
	const a = Buffer.from(expected);
	const b = Buffer.from(options.signature);
	return a.length === b.length && a.equals(b);
}

export interface PaddleEvent {
	event_type: string;
	data: {
		id?: string;
		customer_id?: string;
		status?: string;
		current_billing_period?: { ends_at?: string };
		custom_data?: { organization_id?: string; plan?: string };
		items?: { price?: { id?: string; custom_data?: { plan?: string } } }[];
	};
}

/** Map plan → default entitlement period for one-time (self-hosted) purchases. */
const ONE_TIME_PLANS = new Set([
	"self_hosted_range",
	"self_hosted_pro",
	"self_hosted_multi",
]);

function planFromEvent(event: PaddleEvent): string | null {
	const fromItem = event.data.items?.[0]?.price?.custom_data?.plan;
	if (fromItem) return fromItem;
	return event.data.custom_data?.plan ?? null;
}

export class BillingService {
	constructor(private readonly db: Kysely<Database>) {}

	/** Apply a verified Paddle event to entitlements. Returns the applied plan or null if ignored. */
	async applyPaddleEvent(
		event: PaddleEvent,
	): Promise<{ applied: boolean; plan?: string }> {
		const relevant = [
			"transaction.completed",
			"subscription.activated",
			"subscription.resumed",
			"subscription.canceled",
			"subscription.past_due",
		];
		if (!relevant.includes(event.event_type)) return { applied: false };

		const customerId = event.data.customer_id ?? "";
		if (!customerId) return { applied: false };
		const plan = planFromEvent(event);
		if (!plan) return { applied: false };

		const organizationId = event.data.custom_data?.organization_id ?? null;
		const subscriptionId = event.event_type.startsWith("subscription.")
			? (event.data.id ?? null)
			: null;
		const periodEnd = event.data.current_billing_period?.ends_at ?? null;

		const status = event.event_type.includes("canceled")
			? "canceled"
			: event.event_type.includes("past_due")
				? "past_due"
				: "active";

		// Reconcile by subscription id (subscriptions) or paddle customer + plan (one-time).
		const existing = subscriptionId
			? await this.db
					.selectFrom("entitlements")
					.selectAll()
					.where("paddle_subscription_id", "=", subscriptionId)
					.executeTakeFirst()
			: await this.db
					.selectFrom("entitlements")
					.selectAll()
					.where("paddle_customer_id", "=", customerId)
					.where("plan", "=", plan)
					.executeTakeFirst();

		if (existing) {
			await this.db
				.updateTable("entitlements")
				.set({ status, current_period_end: periodEnd, updated_at: nowIso() })
				.where("id", "=", existing.id)
				.execute();
			return { applied: true, plan };
		}

		// New purchase: one-time self-hosted plans also issue a license key.
		const row = {
			id: newId(),
			organization_id: organizationId,
			paddle_customer_id: customerId,
			paddle_subscription_id: subscriptionId,
			plan,
			status: status as "active" | "canceled" | "past_due" | "trialing",
			current_period_end: periodEnd,
			source: "paddle",
			created_at: nowIso(),
			updated_at: nowIso(),
		};
		await this.db.insertInto("entitlements").values(row).execute();
		return { applied: true, plan };
	}

	// --- licenses (Phase 10) ---------------------------------------------------

	/** Issue a license: returns the raw key once (vfylic_…), stores hash + hint. */
	async issueLicense(input: {
		plan: string;
		organizationId?: string | null;
		issuedToEmail?: string | null;
		signingSecret: string;
	}): Promise<{ license: License; rawKey: string }> {
		const payload = `${input.plan}.${Date.now()}.${newId()}`;
		const mac = createHmac("sha256", input.signingSecret)
			.update(payload)
			.digest("hex");
		const rawKey = `vfylic_${input.plan}_${mac.slice(0, 40)}`;
		const row = {
			id: newId(),
			organization_id: input.organizationId ?? null,
			plan: input.plan,
			license_key_hash: await sha256Hex(rawKey),
			license_key_hint: `${rawKey.slice(0, 16)}…${rawKey.slice(-4)}`,
			status: "active" as const,
			seats: null,
			issued_to_email: input.issuedToEmail ?? null,
			expires_at: null,
			revoked_at: null,
			created_at: nowIso(),
		};
		await this.db.insertInto("licenses").values(row).execute();
		return { license: row, rawKey };
	}

	/** Offline-verifiable license check for the self-hosted app (same secret). */
	async verifyLicense(rawKey: string): Promise<License | undefined> {
		const keyHash = await sha256Hex(rawKey);
		const license = await this.db
			.selectFrom("licenses")
			.selectAll()
			.where("license_key_hash", "=", keyHash)
			.executeTakeFirst();
		if (!license || license.status !== "active") return undefined;
		if (license.expires_at !== null && license.expires_at <= nowIso())
			return undefined;
		return license;
	}
}
