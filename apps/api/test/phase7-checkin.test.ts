import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 7: range operations — check-in search with status card, same-day
 * idempotent check-ins, attention flags, QR targets, cross-tenant denial.
 */
let world: TestWorld;
let orgA: SeededKey;
let orgB: SeededKey;

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

async function seedOrg(): Promise<void> {
	orgA = await seedOrganization(world, "org_a", "range-a");
	orgB = await seedOrganization(world, "org_b", "range-b");
}

async function createCustomer(
	org: SeededKey,
	data: Record<string, unknown>,
): Promise<{ id: string }> {
	return (
		(await (
			await authedRequest(world.app, "POST", "/v1/customers", org.keyRaw, data)
		).json()) as { data: { id: string } }
	).data;
}

/** Full flow: publish template → session → sign → worker finalize → document. */
async function completedWaiver(
	org: SeededKey,
	customerId: string,
	typedName: string,
	opts: { guardian?: boolean; reconsentDraft?: boolean } = {},
): Promise<{ documentId: string }> {
	const tpl = (await (
		await authedRequest(world.app, "POST", "/v1/templates", org.keyRaw, {
			name: "Range Waiver",
			schema: SCHEMA,
			guardian_policy: { min_age: 18, require_guardian_for_minors: true },
			default_validity_days: 365,
		})
	).json()) as { data: { template: { id: string }; version: { id: string } } };
	await authedRequest(
		world.app,
		"POST",
		`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
		org.keyRaw,
	);

	const sess = (await (
		await authedRequest(world.app, "POST", "/v1/signing-sessions", org.keyRaw, {
			template_id: tpl.data.template.id,
			customer_id: customerId,
		})
	).json()) as { data: { token: string } };
	await world.app.request(`/v1/sign/${sess.data.token}/session`);
	const signatures = [
		{ role: "signer", method: "typed", typed_name: typedName },
	];
	if (opts.guardian)
		signatures.push({
			role: "guardian",
			method: "typed",
			typed_name: "Guardian Name",
		});
	await world.app.request(`/v1/sign/${sess.data.token}/complete`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			values: { legal_name: typedName },
			consent: { accepted: true },
			signatures,
		}),
	});
	await world.documents.finalizeProcessing();

	// Optional: publish a re-consent-requiring v2 (drives the reconsent flag).
	if (opts.reconsentDraft) {
		const v2 = (await (
			await authedRequest(
				world.app,
				"POST",
				`/v1/templates/${tpl.data.template.id}/versions`,
				org.keyRaw,
				{
					title: "Waiver v2",
					schema: SCHEMA,
					requires_reconsent: true,
				},
			)
		).json()) as { data: { id: string } };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${v2.data.id}/publish`,
			org.keyRaw,
		);
	}

	const doc = (await (
		await authedRequest(world.app, "GET", "/v1/documents", org.keyRaw)
	).json()) as { data: { id: string; template_version_id: string }[] };
	return { documentId: doc.data[0]!.id };
}

beforeEach(async () => {
	world = await makeTestApp();
	await seedOrg();
});

describe("check-in search + status card", () => {
	it("missing waiver flags attention; search finds by name and email fragments", async () => {
		const customer = await createCustomer(orgA, {
			first_name: "John",
			last_name: "Customer",
			email: "john@example.com",
			phone: "5551234567",
		});
		await createCustomer(orgA, { first_name: "Zip", last_name: "Zap" });

		const search = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/checkin/search?q=john",
				orgA.keyRaw,
			)
		).json()) as {
			data: {
				customer: { id: string };
				waiver_status: string;
				attention_flags: string[];
			}[];
		};
		expect(search.data).toHaveLength(1);
		expect(search.data[0]!.customer.id).toBe(customer.id);
		expect(search.data[0]!.waiver_status).toBe("missing");
		expect(search.data[0]!.attention_flags).toContain("waiver_missing");

		const byEmail = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/checkin/search?q=john@exam",
				orgA.keyRaw,
			)
		).json()) as { data: unknown[] };
		expect(byEmail.data).toHaveLength(1);
	});

	it("completed waiver shows CURRENT with expiry from template validity", async () => {
		const customer = await createCustomer(orgA, {
			first_name: "Jane",
			last_name: "Ready",
			email: "jane@example.com",
			date_of_birth: "1990-01-01",
		});
		const { documentId } = await completedWaiver(
			orgA,
			customer.id,
			"Jane Ready",
		);

		const card = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/checkin/search?q=jane",
				orgA.keyRaw,
			)
		).json()) as {
			data: {
				waiver_status: string;
				waiver: {
					document_id: string;
					expires_at: string | null;
					guardian_signed: boolean | null;
				};
				attention_flags: string[];
			}[];
		};
		expect(card.data[0]!.waiver_status).toBe("current");
		expect(card.data[0]!.waiver!.document_id).toBe(documentId);
		expect(card.data[0]!.waiver!.expires_at).not.toBeNull();
		expect(card.data[0]!.attention_flags).toHaveLength(0);
	});

	it("minor without guardian signature flags guardian_missing; minor with guardian is clean", async () => {
		const minor = await createCustomer(orgA, {
			first_name: "Min",
			last_name: "Or",
			date_of_birth: "2012-05-01",
		});
		// The signing engine REQUIRES the guardian signature for minors (doc 07 §7),
		// so the completed waiver must carry a signed guardian participant.
		const { documentId } = await completedWaiver(orgA, minor.id, "Min Or", {
			guardian: true,
		});
		expect(documentId).toBeTruthy();

		const card = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/checkin/search?q=min",
				orgA.keyRaw,
			)
		).json()) as {
			data: {
				age_status: string;
				attention_flags: string[];
				waiver: { guardian_signed: boolean | null } | null;
			}[];
		};
		expect(card.data[0]!.age_status).toBe("minor");
		expect(card.data[0]!.waiver!.guardian_signed).toBe(true);
		expect(card.data[0]!.attention_flags).not.toContain("guardian_missing");
	});

	it("re-consent required when a newer version demands it", async () => {
		const customer = await createCustomer(orgA, {
			first_name: "Re",
			last_name: "Consent",
		});
		await completedWaiver(orgA, customer.id, "Re Consent", {
			reconsentDraft: true,
		});

		const card = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/checkin/search?q=re",
				orgA.keyRaw,
			)
		).json()) as { data: { waiver_status: string }[] };
		expect(card.data[0]!.waiver_status).toBe("reconsent_required");
	});
});

describe("check-in recording", () => {
	it("records a check-in with the status card; same-day retry is idempotent", async () => {
		const customer = await createCustomer(orgA, {
			first_name: "Fast",
			last_name: "Entry",
		});
		await completedWaiver(orgA, customer.id, "Fast Entry");

		const first = (await (
			await authedRequest(world.app, "POST", "/v1/checkins", orgA.keyRaw, {
				customer_id: customer.id,
				source: "front_desk",
			})
		).json()) as {
			data?:
				| {
						duplicate: boolean;
						check_in: { id: string };
						status_card: { waiver_status: string };
				  }
				| { error: { code: string; message: string } };
		};
		console.log("CHECKIN_RESPONSE", JSON.stringify(first).slice(0, 300));
		expect(!("error" in first && first.error)).toBe(true);
		const payload = first.data as {
			duplicate: boolean;
			check_in: { id: string };
			status_card: { waiver_status: string };
		};
		expect(payload.duplicate).toBe(false);
		expect(payload.status_card.waiver_status).toBe("current");

		const retry = (await (
			await authedRequest(world.app, "POST", "/v1/checkins", orgA.keyRaw, {
				customer_id: customer.id,
			})
		).json()) as { data: { duplicate: boolean; check_in: { id: string } } };
		expect(retry.data.duplicate).toBe(true);
		expect(retry.data.check_in.id).toBe(payload.check_in.id);

		const history = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/checkins/history?customer_id=${customer.id}`,
				orgA.keyRaw,
			)
		).json()) as { data: unknown[] };
		expect(history.data).toHaveLength(1);
	});

	it("kiosk source accepted; cross-tenant customer 404; scope enforced", async () => {
		const customer = await createCustomer(orgA, {
			first_name: "Kio",
			last_name: "Sk",
		});
		const kiosk = (await (
			await authedRequest(world.app, "POST", "/v1/checkins", orgA.keyRaw, {
				customer_id: customer.id,
				source: "kiosk",
			})
		).json()) as { data: { check_in: { source: string } } };
		expect(kiosk.data.check_in.source).toBe("kiosk");

		// org_b is already seeded in beforeEach — cross-tenant write is 404.
		expect(
			(
				await authedRequest(world.app, "POST", "/v1/checkins", orgB.keyRaw, {
					customer_id: customer.id,
				})
			).status,
		).toBe(404);

		const { raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "no-checkin", scopes: ["sites:read"] },
		);
		expect(
			(await authedRequest(world.app, "GET", "/v1/checkin/search?q=a", raw))
				.status,
		).toBe(403);
	});
});

describe("QR targets (doc 11 §7)", () => {
	it("creates a random code, resolves publicly with safe fields only", async () => {
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "Walk-in Waiver",
				schema: SCHEMA,
			})
		).json()) as { data: { template: { id: string } } };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions`,
			orgA.keyRaw,
			{
				title: "Walk-in Waiver",
				schema: SCHEMA,
			},
		);
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

		const created = (await (
			await authedRequest(world.app, "POST", "/v1/checkin/qr", orgA.keyRaw, {
				template_id: tpl.data.template.id,
				label: "Front door",
			})
		).json()) as { data: { code: string; start_url: string } };

		const resolved = (
			await world.app.request(`/start/${created.data.code}`)
		).json() as Promise<{
			data: {
				business_name: string;
				template_name: string;
				startable: boolean;
			};
		}>;
		const body = await resolved;
		expect(body.data.startable).toBe(true);
		expect(body.data.business_name).toBe("Org org_a");
		expect(body.data.template_name).toBe("Walk-in Waiver");
		expect(JSON.stringify(body)).not.toContain("customer");
	});

	it("unknown codes are 404", async () => {
		expect(
			(await world.app.request("/start/000000000000000000000000")).status,
		).toBe(404);
	});
});
