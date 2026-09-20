import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPaddleSignature } from "../src/lib/billing.js";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phases 10-12: Paddle webhook → entitlements, license issuance + gated
 * download, CSV import (dry-run + commit).
 */
let world: TestWorld;
let orgA: SeededKey;

const SECRET = "launch-proof-secret-not-a-real-credential";

function paddleSignature(body: string): {
	timestamp: string;
	signature: string;
} {
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac("sha256", SECRET)
		.update(`${timestamp}:${body}`)
		.digest("hex");
	return { timestamp, signature };
}

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
});

describe("Paddle webhook → entitlements (Phase 11)", () => {
	it("applies a signed subscription.activated with plan from price custom_data", async () => {
		const body = JSON.stringify({
			event_type: "subscription.activated",
			data: {
				id: "sub_123",
				customer_id: "ctm_abc",
				status: "active",
				current_billing_period: { ends_at: "2026-10-20T00:00:00Z" },
				items: [
					{ price: { id: "pri_range", custom_data: { plan: "cloud_range" } } },
				],
				custom_data: { organization_id: "org_a" },
			},
		});
		const { timestamp, signature } = paddleSignature(body);
		const res = await world.app.request("/v1/paddle/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Paddle-Signature": `ts=${timestamp},h1=${signature}`,
			},
			body,
		});
		expect(res.status).toBe(200);
		const result = (await res.json()) as { applied: boolean; plan: string };
		expect(result.applied).toBe(true);
		expect(result.plan).toBe("cloud_range");

		const entitlements = (await (
			await authedRequest(world.app, "GET", "/v1/entitlements", orgA.keyRaw)
		).json()) as { data: { plan: string; status: string }[] };
		expect(entitlements.data).toHaveLength(1);
		expect(entitlements.data[0]!.plan).toBe("cloud_range");
		expect(entitlements.data[0]!.status).toBe("active");
	});

	it("rejects unsigned deliveries with 401", async () => {
		const res = await world.app.request("/v1/paddle/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Paddle-Signature": "ts=123,h1=deadbeef",
			},
			body: "{}",
		});
		expect(res.status).toBe(401);
	});

	it("cancel flips the entitlement to canceled", async () => {
		const activate = JSON.stringify({
			event_type: "subscription.activated",
			data: {
				id: "sub_c",
				customer_id: "ctm_c",
				status: "active",
				items: [{ price: { custom_data: { plan: "cloud_starter" } } }],
				custom_data: { organization_id: "org_a" },
			},
		});
		const sig1 = paddleSignature(activate);
		await world.app.request("/v1/paddle/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Paddle-Signature": `ts=${sig1.timestamp},h1=${sig1.signature}`,
			},
			body: activate,
		});
		const cancel = JSON.stringify({
			event_type: "subscription.canceled",
			data: {
				id: "sub_c",
				customer_id: "ctm_c",
				items: [{ price: { custom_data: { plan: "cloud_starter" } } }],
			},
		});
		const sig2 = paddleSignature(cancel);
		await world.app.request("/v1/paddle/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Paddle-Signature": `ts=${sig2.timestamp},h1=${sig2.signature}`,
			},
			body: cancel,
		});
		const entitlements = (await (
			await authedRequest(world.app, "GET", "/v1/entitlements", orgA.keyRaw)
		).json()) as { data: unknown[] };
		expect(entitlements.data).toHaveLength(0); // only active listed
	});
});

describe("license issuance + gated download (Phase 10)", () => {
	it("issues a key (hash at rest), verifies, and gates the connector download", async () => {
		const issued = (await (
			await authedRequest(world.app, "POST", "/v1/licenses", orgA.keyRaw, {
				plan: "self_hosted_range",
				email: "buyer@example.com",
			})
		).json()) as { data: { key: string; license_key_hint: string } };
		expect(issued.data.key).toMatch(/^vfylic_self_hosted_range_/);
		expect(issued.data.key.length).toBeGreaterThan(30);

		const stored = JSON.stringify(
			await world.db.selectFrom("licenses").selectAll().execute(),
		);
		expect(stored).not.toContain(issued.data.key);

		const license = await world.billing.verifyLicense(issued.data.key);
		expect(license?.plan).toBe("self_hosted_range");
		expect(
			await world.billing.verifyLicense("vfylic_self_hosted_range_forged"),
		).toBeUndefined();

		// Gated download: needs a license; without one → 401.
		const denied = await world.app.request(
			"/v1/downloads/verifyistic-connector-1.0.0.zip",
		);
		expect(denied.status).toBe(401);
		await world.storage.put(
			"downloads/verifyistic-connector-1.0.0.zip",
			new TextEncoder().encode("PK-zip-bytes"),
		);
		const download = await world.app.request(
			`/v1/downloads/verifyistic-connector-1.0.0.zip?license_key=${encodeURIComponent(issued.data.key)}`,
		);
		expect(download.status).toBe(200);
	});

	it("verifyPaddleSignature is stable for receivers", () => {
		const body = "{}";
		const ts = "1727000000";
		const mac = createHmac("sha256", SECRET)
			.update(`${ts}:${body}`)
			.digest("hex");
		expect(
			verifyPaddleSignature({
				secret: SECRET,
				timestamp: ts,
				body,
				signature: mac,
			}),
		).toBe(true);
		expect(
			verifyPaddleSignature({
				secret: SECRET,
				timestamp: ts,
				body: "{}2",
				signature: mac,
			}),
		).toBe(false);
	});
});

describe("CSV import (Phase 12)", () => {
	const CSV = [
		"first_name,last_name,email,phone,date_of_birth",
		"Jane,Doe,Jane@Example.com,+1 555 000 1111,1990-01-01",
		"John,Dohn,john@example.com,,",
		"Bad,Row,not-an-email,,",
	].join("\r\n");

	it("dry-run by default counts without writing; commit imports idempotently", async () => {
		const dry = (await (
			await world.app.request("/v1/imports/customers/csv", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgA.keyRaw}`,
					"Content-Type": "text/csv",
				},
				body: CSV,
			})
		).json()) as { data: { mode: string; created: number; invalid: number } };
		expect(dry.data.mode).toBe("dry_run");
		expect(dry.data.created).toBe(2);
		expect(dry.data.invalid).toBe(1);

		const before = (await (
			await authedRequest(world.app, "GET", "/v1/customers", orgA.keyRaw)
		).json()) as {
			data: unknown[];
		};
		expect(before.data).toHaveLength(0);

		const commit = (await (
			await world.app.request("/v1/imports/customers/csv", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgA.keyRaw}`,
					"Content-Type": "text/csv",
					"X-Import-Mode": "commit=true",
				},
				body: CSV,
			})
		).json()) as { data: { mode: string; created: number } };
		expect(commit.data.mode).toBe("commit");
		expect(commit.data.created).toBe(2);

		// Re-commit: idempotent by normalized email — updates, never duplicates.
		const again = (await (
			await world.app.request("/v1/imports/customers/csv", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgA.keyRaw}`,
					"Content-Type": "text/csv",
					"X-Import-Mode": "commit=true",
				},
				body: CSV,
			})
		).json()) as { data: { updated: number; created: number } };
		expect(again.data.created).toBe(0);
		expect(again.data.updated).toBe(2);

		const after = (await (
			await authedRequest(world.app, "GET", "/v1/customers", orgA.keyRaw)
		).json()) as {
			data: unknown[];
		};
		expect(after.data).toHaveLength(2);
	});
});
