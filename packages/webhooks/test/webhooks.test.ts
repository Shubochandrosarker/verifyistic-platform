import { createHmac } from "node:crypto";
import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import {
	WebhookService,
	decryptSecret,
	encryptSecret,
	isWebhookUrlAllowed,
	signPayload,
} from "../src/index.js";

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "api_key", id: "key_1" },
};

describe("url-guard (SSRF, doc 16 §5)", () => {
	it("allows public https URLs", () => {
		expect(isWebhookUrlAllowed("https://example.com/hook")).toEqual({
			allowed: true,
		});
	});

	it("rejects non-http schemes, localhost, private, link-local, and metadata ranges", () => {
		const rejected = [
			"file:///etc/passwd",
			"ftp://example.com",
			"http://localhost/hook",
			"http://api.localhost/hook",
			"http://127.0.0.1/hook",
			"http://10.0.0.5/hook",
			"http://172.16.1.1/hook",
			"http://192.168.1.1/hook",
			"http://169.254.169.254/latest/meta-data",
			"http://100.64.0.1/hook",
			"http://[::1]/hook",
			"http://[fd00::1]/hook",
		];
		for (const url of rejected) {
			expect(isWebhookUrlAllowed(url).allowed).toBe(false);
		}
	});
});

describe("secret encryption at rest (doc 06 §10)", () => {
	it("encrypt → decrypt roundtrip; ciphertext never contains the plaintext", () => {
		const ciphertext = encryptSecret("whsec_supersecret", "test-key-env");
		expect(ciphertext).not.toContain("supersecret");
		expect(decryptSecret(ciphertext, "test-key-env")).toBe("whsec_supersecret");
		expect(() => decryptSecret(ciphertext, "wrong-key")).toThrow();
	});
});

describe("HMAC signature (route contract v1)", () => {
	it("matches a receiver-side verification", () => {
		const secret = "whsec_abc";
		const timestamp = 1727000000;
		const body = '{"event":"document.generated"}';
		const signature = signPayload(secret, timestamp, body);
		const expected = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		expect(signature).toBe(`v1=${expected}`);
	});
});

describe("WebhookService delivery engine", () => {
	async function makeService(
		fetcher?: ConstructorParameters<typeof WebhookService>[1]["fetcher"],
	) {
		const db = await createInMemoryDatabase();
		await db
			.insertInto("organizations")
			.values({
				id: "org_a",
				name: "Org A",
				slug: "range-a",
				billing_email: null,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active" as const,
				metadata: null,
				created_at: "2026-09-20T00:00:00Z",
				updated_at: "2026-09-20T00:00:00Z",
			})
			.execute();
		const service = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher,
		});
		return { db, service };
	}

	it("registers endpoint (secret shown once), enqueues matching events, delivers with HMAC headers", async () => {
		let captured: {
			url: string;
			headers: Record<string, string>;
			body: string;
		} | null = null;
		const { db, service } = await makeService(async (url, init) => {
			captured = { url, headers: init.headers, body: init.body };
			return { ok: true, status: 200 };
		});
		const { record, secret } = await service.registerEndpoint(orgA, {
			url: "https://hooks.example.com/vf",
		});

		// Secret stored encrypted — raw absent from storage.
		const stored = JSON.stringify(
			await db.selectFrom("webhook_endpoints").selectAll().execute(),
		);
		expect(stored).not.toContain(secret);

		const queued = await service.enqueueEvent("org_a", "document.generated", {
			document_id: "doc_1",
		});
		expect(queued).toBe(1);
		const processed = await service.processDueDeliveries();
		expect(processed).toBe(1);

		// Receiver-side verification of the signature contract.
		const body = captured!.body;
		const timestamp = Number(captured!.headers["Verifyistic-Timestamp"]);
		const expected = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		expect(captured!.headers["Verifyistic-Signature"]).toBe(`v1=${expected}`);
		expect(captured!.headers["Verifyistic-Event-Type"]).toBe(
			"document.generated",
		);

		const deliveries = await service.listDeliveries(orgA, record.id);
		expect(deliveries[0]!.status).toBe("delivered");
		expect(deliveries[0]!.attempt).toBe(1);
	});

	it("subscribed event filter skips non-matching events", async () => {
		const { service } = await makeService(async () => ({
			ok: true,
			status: 200,
		}));
		await service.registerEndpoint(orgA, {
			url: "https://hooks.example.com/x",
			subscribedEvents: ["document.generated"],
		});
		expect(await service.enqueueEvent("org_a", "checkin.created", {})).toBe(0);
		expect(await service.enqueueEvent("org_a", "document.generated", {})).toBe(
			1,
		);
	});

	it("failed delivery schedules bounded retries with backoff, then dead-letters", async () => {
		let now = new Date("2026-09-20T12:00:00Z");
		const { db } = await makeService();
		const failing = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher: async () => ({ ok: false, status: 500 }),
			now: () => now,
		});
		await failing.registerEndpoint(orgA, {
			url: "https://hooks.example.com/y",
		});
		await failing.enqueueEvent("org_a", "document.generated", {});

		// max_attempts = 6 (5 retry delays + first attempt): each sweep advances the
		// clock past the scheduled backoff before the next try.
		for (let attempt = 1; attempt <= 6; attempt++) {
			const processed = await failing.processDueDeliveries();
			expect(processed).toBe(1);
			const delivery = (await db
				.selectFrom("webhook_deliveries")
				.selectAll()
				.executeTakeFirst())!;
			expect(delivery.attempt).toBe(attempt);
			if (attempt < 6) {
				expect(delivery.status).toBe("pending");
				expect(delivery.next_retry_at).not.toBeNull();
				now = new Date(now.getTime() + 7 * 60 * 60 * 1000); // past the longest backoff
			}
		}
		const final = (await db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.executeTakeFirst())!;
		expect(final.status).toBe("dead_letter");
		expect(final.next_retry_at).toBeNull();
		expect(final.attempt).toBe(6);
	});

	it("successful delivery after failures marks delivered", async () => {
		let now = new Date("2026-09-20T12:00:00Z");
		let calls = 0;
		const { db } = await makeService();
		const flaky = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher: async () => {
				calls += 1;
				return calls >= 2
					? { ok: true, status: 200 }
					: { ok: false, status: 503 };
			},
			now: () => now,
		});
		await flaky.registerEndpoint(orgA, { url: "https://hooks.example.com/z" });
		await flaky.enqueueEvent("org_a", "document.generated", {});
		await flaky.processDueDeliveries();
		now = new Date(now.getTime() + 2 * 60 * 1000);
		await flaky.processDueDeliveries();
		const delivery = (await db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.executeTakeFirst())!;
		expect(delivery.status).toBe("delivered");
		expect(delivery.attempt).toBe(2);
	});
});
