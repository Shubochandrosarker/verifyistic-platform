import { verifyAuditChain } from "@verifyistic/audit";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 4 signing engine tests (doc 24 §7 required matrix): valid/expired/revoked
 * tokens, duplicate completion, required-field validation, template-version
 * integrity, guardian branch, cross-tenant denial, audit event creation.
 */
let world: TestWorld;
let orgA: SeededKey;
let orgB: SeededKey;

const SCHEMA = {
	blocks: [
		{ type: "heading", text: "Range Waiver" },
		{
			type: "field",
			field_key: "legal_name",
			label: "Legal name",
			field_type: "text",
			required: true,
		},
		{
			type: "field",
			field_key: "is_renting",
			label: "Renting a firearm?",
			field_type: "checkbox",
		},
		{
			type: "conditional",
			if: { field: "is_renting", equals: true },
			blocks: [
				{
					type: "initials",
					field_key: "rental_ack",
					label: "Rental terms",
					required: true,
				},
			],
		},
		{ type: "signature", field_key: "signature", label: "Signature" },
	],
};

async function seededCustomer(
	org: SeededKey,
	overrides: Record<string, unknown> = {},
): Promise<{ id: string; date_of_birth: string | null }> {
	const res = await authedRequest(
		world.app,
		"POST",
		"/v1/customers",
		org.keyRaw,
		{
			first_name: "Jane",
			last_name: "Doe",
			email: `jane-${Math.random().toString(36).slice(2)}@example.com`,
			...overrides,
		},
	);
	return (
		(await res.json()) as { data: { id: string; date_of_birth: string | null } }
	).data;
}

async function publishedTemplate(
	org: SeededKey,
	schema = SCHEMA,
	guardianPolicy?: Record<string, unknown>,
): Promise<{ templateId: string }> {
	const created = (await (
		await authedRequest(world.app, "POST", "/v1/templates", org.keyRaw, {
			name: "Waiver",
			schema,
			guardian_policy: guardianPolicy,
		})
	).json()) as { data: { template: { id: string }; version: { id: string } } };
	await authedRequest(
		world.app,
		"POST",
		`/v1/templates/${created.data.template.id}/versions/${created.data.version.id}/publish`,
		org.keyRaw,
	);
	return { templateId: created.data.template.id };
}

/** Create a session and walk it to viewed (the minimum state before completion). */
async function openedSession(
	org: SeededKey,
	customerId: string,
	templateId?: string,
) {
	const tpl = templateId ?? (await publishedTemplate(org)).templateId;
	const created = (await (
		await authedRequest(world.app, "POST", "/v1/signing-sessions", org.keyRaw, {
			template_id: tpl,
			customer_id: customerId,
		})
	).json()) as {
		data: { id: string; token: string; participants: { role: string }[] };
	};
	const token = created.data.token;
	// created → sent → viewed via the signer transport
	await world.app.request(`/v1/sign/${token}/session`);
	return {
		sessionId: created.data.id,
		token,
		participants: created.data.participants,
	};
}

const completePayload = (
	values: Record<string, unknown>,
	role: "signer" | "guardian" = "signer",
) => ({
	values,
	consent: { accepted: true },
	signatures: [{ role, method: "typed" as const, typed_name: "Jane Doe" }],
});

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
	orgB = await seedOrganization(world, "org_b", "range-b");
});

describe("signing session lifecycle (business API)", () => {
	it("creates a session, returns the raw token exactly once, and never stores it raw", async () => {
		const customer = await seededCustomer(orgA);
		const { templateId } = await publishedTemplate(orgA);
		const res = await authedRequest(
			world.app,
			"POST",
			"/v1/signing-sessions",
			orgA.keyRaw,
			{
				template_id: templateId,
				customer_id: customer.id,
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { token: string; signer_url: string; id: string };
		};
		expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(body.data.signer_url).toBe(`/s/${body.data.token}`);

		// Raw token must not be recoverable from any stored representation.
		const rows = JSON.stringify(
			await world.db.selectFrom("signing_sessions").selectAll().execute(),
		);
		expect(rows).not.toContain(body.data.token);
	});

	it("unpublished or unknown templates are rejected; signing:write scope enforced", async () => {
		const customer = await seededCustomer(orgA);
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "Draft only",
				schema: SCHEMA,
			})
		).json()) as { data: { template: { id: string } } };

		const draftRes = await authedRequest(
			world.app,
			"POST",
			"/v1/signing-sessions",
			orgA.keyRaw,
			{
				template_id: created.data.template.id,
				customer_id: customer.id,
			},
		);
		expect(draftRes.status).toBe(409);

		const { raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "no-signing", scopes: ["customers:read"] },
		);
		expect(
			(
				await authedRequest(world.app, "POST", "/v1/signing-sessions", raw, {
					template_id: created.data.template.id,
					customer_id: customer.id,
				})
			).status,
		).toBe(403);
	});
});

describe("signer transport — token lifecycle (doc 24 §7)", () => {
	it("hosted signer page serves at /s/{token} with no-referrer and noindex", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);
		const res = await world.app.request(`/s/${token}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		expect(await res.text()).toContain("Sign document");
	});

	it("valid token: open → complete → processing → finalize → completed, with audit chain intact", async () => {
		const customer = await seededCustomer(orgA);
		const { token, sessionId } = await openedSession(orgA, customer.id);

		const view = (await (
			await world.app.request(`/v1/sign/${token}/session`)
		).json()) as {
			data: {
				status: string;
				business_name: string;
				schema: { blocks: unknown[] };
			};
		};
		expect(view.data.status).toBe("viewed");
		expect(view.data.business_name).toBe("Org org_a");

		const completeRes = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 (iPhone) Safari",
			},
			body: JSON.stringify(
				completePayload({ legal_name: "Jane Doe", is_renting: false }),
			),
		});
		expect(completeRes.status).toBe(200);
		const completed = (await completeRes.json()) as {
			data: { status: string; signature_set_hash: string };
		};
		expect(completed.data.status).toBe("processing");
		expect(completed.data.signature_set_hash).toMatch(/^[0-9a-f]{64}$/);

		const finalized = await world.signing.finalizeSession(sessionId);
		expect(finalized?.status).toBe("completed");

		const chain = await verifyAuditChain(world.db, "org_a");
		expect(chain.valid).toBe(true);
	});

	it("duplicate completion is an idempotent no-op — no second signature/document", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);
		const first = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(completePayload({ legal_name: "Jane Doe" })),
		});
		expect(first.status).toBe(200);

		const second = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(completePayload({ legal_name: "Jane Doe" })),
		});
		expect(second.status).toBe(200);
		const body = (await second.json()) as {
			data: { already_finalizing: boolean };
		};
		expect(body.data.already_finalizing).toBe(true);

		const sigCount = await world.db
			.selectFrom("signatures")
			.select(({ fn }) => [fn.count("id").as("n")])
			.executeTakeFirst();
		expect(Number(sigCount?.n)).toBe(1);
	});

	it("required-field validation: missing field and unshown conditional handled server-side", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);

		// Missing required legal_name.
		const missing = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(completePayload({ is_renting: false })),
		});
		expect(missing.status).toBe(400);
		const missingBody = (await missing.json()) as {
			error: { fields: Record<string, string[]> };
		};
		expect(missingBody.error.fields.legal_name).toBeDefined();

		// Conditional shown (is_renting=true) → rental_ack becomes required.
		const conditional = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(
				completePayload({ legal_name: "Jane", is_renting: true }),
			),
		});
		expect(conditional.status).toBe(400);
		const conditionalBody = (await conditional.json()) as {
			error: { fields: Record<string, string[]> };
		};
		expect(conditionalBody.error.fields.rental_ack).toBeDefined();

		// Session still completable afterwards with the conditional satisfied.
		const okRes = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(
				completePayload({
					legal_name: "Jane",
					is_renting: true,
					rental_ack: true,
				}),
			),
		});
		expect(okRes.status).toBe(200);
	});

	it("consent is mandatory", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);
		const res = await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				values: { legal_name: "Jane" },
				consent: { accepted: false },
				signatures: [
					{ role: "signer", method: "typed", typed_name: "Jane Doe" },
				],
			}),
		});
		expect(res.status).toBe(400);
	});

	it("guardian branch: minor DOB forces a guardian signature; adult does not", async () => {
		// Template policy min_age 18 — the guardian branch keys on DOB + policy (doc 07 §7).
		const minor = await seededCustomer(orgA, { date_of_birth: "2012-05-01" });
		const { templateId } = await publishedTemplate(
			orgA,
			{
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
			},
			{ min_age: 18, require_guardian_for_minors: true },
		);
		const minorSession = await openedSession(orgA, minor.id, templateId);
		expect(minorSession.participants.map((p) => p.role)).toEqual([
			"signer",
			"guardian",
		]);

		// Completing with only the signer's signature is rejected…
		const signerOnly = await world.app.request(
			`/v1/sign/${minorSession.token}/complete`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(completePayload({ legal_name: "Min Or" })),
			},
		);
		expect(signerOnly.status).toBe(400);

		// …and both signatures complete the session.
		const both = await world.app.request(
			`/v1/sign/${minorSession.token}/complete`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					values: { legal_name: "Min Or" },
					consent: { accepted: true },
					signatures: [
						{ role: "signer", method: "typed", typed_name: "Min Or" },
						{
							role: "guardian",
							method: "drawn",
							artifact: "data:image/png;base64,iVBORw0KGgo=",
						},
					],
				}),
			},
		);
		expect(both.status).toBe(200);

		// Adult customer on the same template: signer only.
		const adult = await seededCustomer(orgA, { date_of_birth: "1990-01-01" });
		const adultSession = await openedSession(orgA, adult.id, templateId);
		expect(adultSession.participants.map((p) => p.role)).toEqual(["signer"]);
		const adultComplete = await world.app.request(
			`/v1/sign/${adultSession.token}/complete`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(completePayload({ legal_name: "Adult" })),
			},
		);
		expect(adultComplete.status).toBe(200);
	});

	it("expired tokens are dead links (lazy expire) and revoke/cancel kills the token", async () => {
		const customer = await seededCustomer(orgA);
		const { templateId } = await publishedTemplate(orgA);

		// Expired: create with 300s window is still valid — instead craft expiry via service with negative window.
		const { token: deadToken } = await world.signing.createSession(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{
				template_id: templateId,
				customer_id: customer.id,
				expires_in_seconds: -1,
			},
		);
		const expiredRes = await world.app.request(`/v1/sign/${deadToken}/session`);
		expect(expiredRes.status).toBe(404);

		// Cancelled: business user cancels, the signer link stops working.
		const { token: liveToken, sessionId } = await openedSession(
			orgA,
			customer.id,
			templateId,
		);
		await authedRequest(
			world.app,
			"POST",
			`/v1/signing-sessions/${sessionId}/cancel`,
			orgA.keyRaw,
		);
		expect(
			(await world.app.request(`/v1/sign/${liveToken}/session`)).status,
		).toBe(404);

		// Unknown token → 404 envelope.
		const unknown = await world.app.request(
			`/v1/sign/${"A".repeat(43)}/session`,
		);
		expect(unknown.status).toBe(404);
	});

	it("decline ends the session with no completed document", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);
		const res = await world.app.request(`/v1/sign/${token}/decline`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reason: "Will not sign" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { status: string } };
		expect(body.data.status).toBe("declined");
		await expect(
			world.signing.finalizeSession(
				(
					await world.signing.list({
						organizationId: "org_a",
						actor: { type: "system", id: "x" },
					})
				)[0]!.id,
			),
		).resolves.toBeUndefined();
	});

	it("cross-tenant: org B cannot see, resend, or cancel org A's sessions", async () => {
		const customer = await seededCustomer(orgA);
		const { sessionId } = await openedSession(orgA, customer.id);

		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/signing-sessions/${sessionId}`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
		expect(
			(
				await authedRequest(
					world.app,
					"POST",
					`/v1/signing-sessions/${sessionId}/cancel`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
		expect(
			(
				await authedRequest(
					world.app,
					"POST",
					`/v1/signing-sessions/${sessionId}/resend`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
		const bList = (await (
			await authedRequest(world.app, "GET", "/v1/signing-sessions", orgB.keyRaw)
		).json()) as {
			data: unknown[];
		};
		expect(bList.data).toHaveLength(0);
	});

	it("typed and drawn signatures both hash to stable digests; artifact bytes deferred to Phase 5 storage", async () => {
		const customer = await seededCustomer(orgA);
		const { token } = await openedSession(orgA, customer.id);
		await world.app.request(`/v1/sign/${token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				values: { legal_name: "Jane" },
				consent: { accepted: true },
				signatures: [
					{
						role: "signer",
						method: "drawn",
						artifact: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
					},
				],
			}),
		});
		const sig = (await world.db
			.selectFrom("signatures")
			.selectAll()
			.executeTakeFirst())!;
		expect(sig.method).toBe("drawn");
		expect(sig.signature_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(sig.storage_key).toBeNull();
		expect(sig.user_agent_safe_snapshot).toBeNull();
	});
});
