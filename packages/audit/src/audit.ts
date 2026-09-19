/**
 * Audit events — per-organization hash chain:
 *   event_hash = SHA256(previous_hash || canonical_json(event))
 * Chain heads are per organization; the first event's previous hash is "genesis".
 * Tamper-evident, not magical immutability (doc 08 §5). Events are append-only —
 * this module exposes no update or delete path.
 */
import { canonicalJson, chainEventHash, newId } from "@verifyistic/core";
import type { AuditEvent, Database } from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";

export interface AuditEventInput {
	eventType: string;
	entityType: string;
	entityId: string;
	/** Structured event data — serialized canonically before hashing. */
	data: Record<string, unknown>;
}

export class AuditService {
	constructor(private readonly db: Kysely<Database>) {}

	async record(
		tenant: TenantContext,
		input: AuditEventInput,
	): Promise<AuditEvent> {
		const head = await this.db
			.selectFrom("audit_events")
			.select(["sequence", "event_hash"])
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("sequence", "desc")
			.limit(1)
			.executeTakeFirst();

		const sequence = (head?.sequence ?? 0) + 1;
		const previousHash = head?.event_hash ?? "genesis";
		const canonicalEvent = {
			sequence,
			event_type: input.eventType,
			entity_type: input.entityType,
			entity_id: input.entityId,
			actor_type: tenant.actor.type,
			actor_id: tenant.actor.id,
			data: input.data,
		};
		const canonicalPayload = canonicalJson(canonicalEvent);
		const eventHash = await chainEventHash(previousHash, canonicalEvent);

		const row: AuditEvent = {
			id: newId(),
			organization_id: tenant.organizationId,
			entity_type: input.entityType,
			entity_id: input.entityId,
			event_type: input.eventType,
			actor_type: tenant.actor.type,
			actor_id: tenant.actor.id,
			canonical_payload_json: canonicalPayload,
			sequence,
			previous_hash: previousHash,
			event_hash: eventHash,
			created_at: new Date().toISOString(),
		};
		await this.db.insertInto("audit_events").values(row).execute();
		return row;
	}

	/** Tenant-scoped read: events for one entity inside the authenticated organization. */
	async listForEntity(
		tenant: TenantContext,
		entityType: string,
		entityId: string,
	): Promise<AuditEvent[]> {
		return this.db
			.selectFrom("audit_events")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("entity_type", "=", entityType)
			.where("entity_id", "=", entityId)
			.orderBy("sequence", "asc")
			.execute();
	}

	async listForOrganization(
		tenant: TenantContext,
		limit = 100,
	): Promise<AuditEvent[]> {
		return this.db
			.selectFrom("audit_events")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("sequence", "desc")
			.limit(limit)
			.execute();
	}
}

export interface ChainVerification {
	valid: boolean;
	/** Sequence number where the chain broke, when invalid. */
	brokenAtSequence?: number;
	reason?: "previous_hash_mismatch" | "event_hash_mismatch" | "sequence_gap";
}

/** Recompute the full chain for an organization and report the first break, if any. */
export async function verifyAuditChain(
	db: Kysely<Database>,
	organizationId: string,
): Promise<ChainVerification> {
	const events = await db
		.selectFrom("audit_events")
		.selectAll()
		.where("organization_id", "=", organizationId)
		.orderBy("sequence", "asc")
		.execute();

	let previousHash = "genesis";
	let expectedSequence = 1;

	for (const event of events) {
		if (event.sequence !== expectedSequence) {
			return {
				valid: false,
				brokenAtSequence: event.sequence,
				reason: "sequence_gap",
			};
		}
		if (event.previous_hash !== previousHash) {
			return {
				valid: false,
				brokenAtSequence: event.sequence,
				reason: "previous_hash_mismatch",
			};
		}
		const recomputed = await chainEventHash(
			previousHash,
			JSON.parse(event.canonical_payload_json),
		);
		if (recomputed !== event.event_hash) {
			return {
				valid: false,
				brokenAtSequence: event.sequence,
				reason: "event_hash_mismatch",
			};
		}
		previousHash = event.event_hash;
		expectedSequence += 1;
	}

	return { valid: true };
}
