import { createHmac } from "node:crypto";
import {
	type VerifyisticApiError,
	VerifyisticClient,
	verifyWebhookSignature,
} from "@verifyistic/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 8 exit criterion (doc 21): a third-party test integration creates a
 * signing session and receives the completion webhook — plus idempotency
 * replay/conflict, rate limits, and the OpenAPI contract surface.
 */
let world: TestWorld;
let orgA: SeededKey;

const SCHEMA = {
	blocks: [
		{
			type: "field",
			field_key: "legal_name",
			label: "Name",
			field_type: "text",
			required: true,
		},
		{ type: "signature", field_key: "signature", label: "Signature" },
	],
};

/** Deliberately-invalid key for negative SDK tests — never a real credential. */
function invalidTestKey(): string {
	return `vfy_live_${"x".repeat(32)}`;
}

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
});

describe("OpenAPI contract surface", () => {
	it("serves /v1/openapi.json covering every contracted resource", async () => {
		const res = await world.app.request("/v1/openapi.json");
		expect(res.status).toBe(200);
		const spec = (await res.json()) as {
			openapi: string;
			paths: Record<string, unknown>;
		};
		expect(spec.openapi).toBe("3.1.0");
		for (const path of [
			"/health",
			"/sites",
			"/customers",
			"/templates",
			"/signing-sessions",
			"/sign/{token}/complete",
			"/documents",
			"/checkin/search",
			"/checkins",
			"/webhooks",
			"/api-keys",
			"/audit-events",
		]) {
			expect(spec.paths[path], `missing contract path ${path}`).toBeDefined();
		}
	});

	it("serves human /v1/docs", async () => {
		const res = await world.app.request("/v1/docs");
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Verifyistic API — v1 Reference");
	});
});

describe("Idempotency-Key framework (doc 05 §6)", () => {
	it("same key + same payload replays the stored response without a second session", async () => {
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Idem",
				last_name: "Potent",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: SCHEMA,
			})
		).json()) as { data: { template: { id: string } } };
		const versions = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/templates/${tpl.data.template.id}/versions`,
				orgA.keyRaw,
			)
		).json()) as { data: { id: string }[] };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${versions.data[0]!.id}/publish`,
			orgA.keyRaw,
		);

		const payload = {
			template_id: tpl.data.template.id,
			customer_id: customer.data.id,
		};
		const first = (await (
			await world.app.request("/v1/signing-sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgA.keyRaw}`,
					"Content-Type": "application/json",
					"Idempotency-Key": "key-create-session-01",
				},
				body: JSON.stringify(payload),
			})
		).json()) as {
			data: { id: string; token: string };
			meta: { created?: boolean };
		};
		expect(first.meta.created).toBe(true);

		const replay = (await (
			await world.app.request("/v1/signing-sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgA.keyRaw}`,
					"Content-Type": "application/json",
					"Idempotency-Key": "key-create-session-01",
				},
				body: JSON.stringify(payload),
			})
		).json()) as { data: { id: string; token: string } };
		expect(replay.data.id).toBe(first.data.id);
		expect(replay.data.token).toBe(first.data.token); // same raw token replayed, not re-minted

		const sessions = (await (
			await authedRequest(world.app, "GET", "/v1/signing-sessions", orgA.keyRaw)
		).json()) as { data: unknown[] };
		expect(sessions.data).toHaveLength(1);
	});

	it("same key + different payload → 409 idempotency_conflict", async () => {
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "A",
				last_name: "B",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: SCHEMA,
			})
		).json()) as { data: { template: { id: string } } };
		const versions = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/templates/${tpl.data.template.id}/versions`,
				orgA.keyRaw,
			)
		).json()) as { data: { id: string }[] };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${versions.data[0]!.id}/publish`,
			orgA.keyRaw,
		);

		const base = {
			template_id: tpl.data.template.id,
			customer_id: customer.data.id,
		};
		await world.app.request("/v1/signing-sessions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${orgA.keyRaw}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "key-conflict-test-1",
			},
			body: JSON.stringify(base),
		});
		const conflict = await world.app.request("/v1/signing-sessions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${orgA.keyRaw}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "key-conflict-test-1",
			},
			body: JSON.stringify({ ...base, metadata: { booking_id: "different" } }),
		});
		expect(conflict.status).toBe(409);
		expect(
			((await conflict.json()) as { error: { code: string } }).error.code,
		).toBe("idempotency_conflict");
	});
});

describe("rate limits (doc 05 §7)", () => {
	it("rejects reads past the per-key limit with 429 rate_limited", async () => {
		const limited = await makeTestApp({
			rateLimits: { readPerMin: 3, writePerMin: 100 },
		});
		const org = await seedOrganization(limited, "org_r", "range-r");

		let last = 0;
		for (let i = 0; i < 5; i++) {
			last = (await authedRequest(limited.app, "GET", "/v1/sites", org.keyRaw))
				.status;
		}
		expect(last).toBe(429);
		const body = (await (
			await authedRequest(limited.app, "GET", "/v1/sites", org.keyRaw)
		).json()) as {
			error: { code: string };
		};
		expect(body.error.code).toBe("rate_limited");
	});
});

describe("PHASE EXIT: third-party integration → completion webhook", () => {
	it("integrator registers webhook → creates session via SDK → signer completes → worker runs → HMAC-valid deliveries received", async () => {
		// 1. The integrator registers a webhook endpoint; secret shown once.
		const hook = (await (
			await authedRequest(world.app, "POST", "/v1/webhooks", orgA.keyRaw, {
				url: "https://integrator.example/verifyistic",
				events: [
					"signing_session.created",
					"signing_session.completed",
					"document.generated",
				],
			})
		).json()) as { data: { id: string; secret: string } };

		// 2. Create customer + published template.
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Third",
				last_name: "Party",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: SCHEMA,
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
			orgA.keyRaw,
		);

		// 3. Third-party creates the session via the SDK with an idempotency key.
		const client = new VerifyisticClient({
			apiKey: orgA.keyRaw,
			baseUrl: "https://internal.test/v1",
			fetch: world.app.request as unknown as typeof fetch,
		});
		const session = await client.createSigningSession(
			{ template_id: tpl.data.template.id, customer_id: customer.data.id },
			{ idempotencyKey: "exit-test-session-1" },
		);
		expect(session.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

		// signing_session.created was queued for the integrator — the worker pump delivers it.
		await world.webhooks.processDueDeliveries();
		let createdDelivery = world.webhookCalls.find(
			(c) => c.headers["Verifyistic-Event-Type"] === "signing_session.created",
		);
		expect(createdDelivery).toBeDefined();

		// 4. Signer completes on the public transport.
		await world.app.request(`/v1/sign/${session.data.token}/session`);
		const complete = await world.app.request(
			`/v1/sign/${session.data.token}/complete`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					values: { legal_name: "Third Party" },
					consent: { accepted: true },
					signatures: [
						{ role: "signer", method: "typed", typed_name: "Third Party" },
					],
				}),
			},
		);
		expect(complete.status).toBe(200);

		// 5. Worker: finalize PDF + document.generated event + delivery pump.
		const jobs = await world.documents.finalizeProcessing();
		expect(jobs.finalized).toHaveLength(1);
		const doc = (await world.db
			.selectFrom("documents")
			.selectAll()
			.executeTakeFirst())!;
		expect(doc).toBeDefined();
		await world.webhooks.enqueueEvent("org_a", "document.generated", {
			document_id: doc.id,
			document_number: doc.document_number,
			session_id: session.data.id,
		});
		await world.webhooks.processDueDeliveries();

		// 6. The integrator RECEIVED signing_session.completed AND document.generated,
		//    both HMAC-verifiable with their registration secret.
		createdDelivery = world.webhookCalls.find(
			(c) =>
				c.headers["Verifyistic-Event-Type"] === "signing_session.completed",
		);
		expect(createdDelivery).toBeDefined();
		const generatedDelivery = world.webhookCalls.find(
			(c) => c.headers["Verifyistic-Event-Type"] === "document.generated",
		);
		expect(generatedDelivery).toBeDefined();

		for (const delivery of [createdDelivery!, generatedDelivery!]) {
			const verdict = await verifyWebhookSignature({
				secret: hook.data.secret,
				timestamp: delivery.headers["Verifyistic-Timestamp"],
				body: delivery.body,
				signature: delivery.headers["Verifyistic-Signature"],
			});
			expect(verdict).toEqual({ valid: true });
		}
		expect(JSON.parse(generatedDelivery!.body).data.document_id).toBe(doc.id);
	});

	it("SDK surfaces typed errors from the API envelope", async () => {
		const client = new VerifyisticClient({
			apiKey: invalidTestKey(),
			baseUrl: "https://internal.test/v1",
			fetch: world.app.request as unknown as typeof fetch,
		});
		await expect(client.listDocuments()).rejects.toMatchObject({
			code: "unauthorized",
			status: 401,
		} satisfies Partial<VerifyisticApiError>);
	});
});

describe("webhook signature helper", () => {
	it("rejects tampered bodies and stale timestamps", async () => {
		const secret = "whsec_test";
		const timestamp = String(Math.floor(Date.now() / 1000));
		const body = '{"event":"x"}';
		const mac = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		expect(
			(
				await verifyWebhookSignature({
					secret,
					timestamp,
					body,
					signature: `v1=${mac}`,
				})
			).valid,
		).toBe(true);
		expect(
			(
				await verifyWebhookSignature({
					secret,
					timestamp,
					body: '{"event":"tampered"}',
					signature: `v1=${mac}`,
				})
			).valid,
		).toBe(false);
		expect(
			(
				await verifyWebhookSignature({
					secret,
					timestamp: String(Number(timestamp) - 3600),
					body,
					signature: `v1=${mac}`,
				})
			).valid,
		).toBe(false);
	});
});
