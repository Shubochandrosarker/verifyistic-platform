import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import { AuditService, verifyAuditChain } from "../src/audit.js";

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "api_key", id: "key_1" },
};
const orgB: TenantContext = {
	organizationId: "org_b",
	actor: { type: "api_key", id: "key_2" },
};

async function makeAudit() {
	const db = await createInMemoryDatabase();
	return { db, audit: new AuditService(db) };
}

describe("AuditService", () => {
	it("chains events per organization with monotonic sequences", async () => {
		const { audit } = await makeAudit();
		const first = await audit.record(orgA, {
			eventType: "site.created",
			entityType: "site",
			entityId: "site_1",
			data: { name: "Main Range" },
		});
		const second = await audit.record(orgA, {
			eventType: "site.updated",
			entityType: "site",
			entityId: "site_1",
			data: { status: "inactive" },
		});

		expect(first.sequence).toBe(1);
		expect(first.previous_hash).toBe("genesis");
		expect(second.sequence).toBe(2);
		expect(second.previous_hash).toBe(first.event_hash);

		// Other organizations chain independently.
		const other = await audit.record(orgB, {
			eventType: "site.created",
			entityType: "site",
			entityId: "site_b1",
			data: {},
		});
		expect(other.sequence).toBe(1);
		expect(other.previous_hash).toBe("genesis");
	});

	it("records the canonical payload and actor snapshot", async () => {
		const { audit } = await makeAudit();
		const event = await audit.record(orgA, {
			eventType: "api_key.created",
			entityType: "api_key",
			entityId: "key_9",
			data: { scopes: ["sites:read"] },
		});
		expect(event.actor_type).toBe("api_key");
		expect(event.actor_id).toBe("key_1");
		const payload = JSON.parse(event.canonical_payload_json);
		expect(payload.event_type).toBe("api_key.created");
		expect(payload.data.scopes).toEqual(["sites:read"]);
	});

	it("tenant-scoped listing hides other organizations' events", async () => {
		const { audit } = await makeAudit();
		await audit.record(orgA, {
			eventType: "site.created",
			entityType: "site",
			entityId: "site_a",
			data: {},
		});
		await audit.record(orgB, {
			eventType: "site.created",
			entityType: "site",
			entityId: "site_b",
			data: {},
		});

		const aEvents = await audit.listForOrganization(orgA);
		expect(aEvents).toHaveLength(1);
		expect(aEvents[0]!.entity_id).toBe("site_a");
		expect(await audit.listForEntity(orgB, "site", "site_a")).toHaveLength(0);
	});

	it("verifyAuditChain validates an intact chain and detects tampering", async () => {
		const { db, audit } = await makeAudit();
		await audit.record(orgA, {
			eventType: "e1",
			entityType: "site",
			entityId: "s1",
			data: { step: 1 },
		});
		await audit.record(orgA, {
			eventType: "e2",
			entityType: "site",
			entityId: "s1",
			data: { step: 2 },
		});
		await audit.record(orgA, {
			eventType: "e3",
			entityType: "site",
			entityId: "s1",
			data: { step: 3 },
		});

		expect(await verifyAuditChain(db, "org_a")).toEqual({ valid: true });
		expect(await verifyAuditChain(db, "org_b")).toEqual({ valid: true });

		// Tamper with a stored payload without recomputing hashes.
		await db
			.updateTable("audit_events")
			.set({
				canonical_payload_json:
					'{"sequence":2,"event_type":"forged","data":{}}',
			})
			.where("organization_id", "=", "org_a")
			.where("sequence", "=", 2)
			.execute();

		const verdict = await verifyAuditChain(db, "org_a");
		expect(verdict.valid).toBe(false);
		expect(verdict.brokenAtSequence).toBe(2);
		expect(verdict.reason).toBe("event_hash_mismatch");
	});
});
