import { verifyAuditChain } from "@verifyistic/audit";
import { renderSimplePdf } from "@verifyistic/documents";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 5 exit criterion: a completed signing creates verifiable protected artifacts —
 * evidence snapshot + signed.pdf + audit certificate + manifest, hash-verified,
 * authorized-download only, publicly verifiable with safe metadata.
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
		{ type: "signature", field_key: "signature", label: "Signature" },
	],
};

async function completedDocument(): Promise<{
	documentId: string;
	sessionId: string;
}> {
	const customer = (await (
		await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
			first_name: "Jane",
			last_name: "Doe",
			email: "jane@example.com",
		})
	).json()) as { data: { id: string } };

	const tpl = (await (
		await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
			name: "Waiver",
			schema: SCHEMA,
		})
	).json()) as { data: { template: { id: string }; version: { id: string } } };
	await authedRequest(
		world.app,
		"POST",
		`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
		orgA.keyRaw,
	);

	const sess = (await (
		await authedRequest(
			world.app,
			"POST",
			"/v1/signing-sessions",
			orgA.keyRaw,
			{
				template_id: tpl.data.template.id,
				customer_id: customer.data.id,
			},
		)
	).json()) as { data: { id: string; token: string } };
	await world.app.request(`/v1/sign/${sess.data.token}/session`);
	const complete = await world.app.request(
		`/v1/sign/${sess.data.token}/complete`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 (iPhone) Safari",
			},
			body: JSON.stringify({
				values: { legal_name: "Jane Doe" },
				consent: { accepted: true },
				signatures: [
					{ role: "signer", method: "typed", typed_name: "Jane Doe" },
				],
			}),
		},
	);
	const completeBody = (await complete.json()) as {
		data: { document_id: string | null; status: string };
	};
	expect(completeBody.data.status).toBe("completed");
	expect(completeBody.data.document_id).toBeTruthy();
	return {
		documentId: completeBody.data.document_id!,
		sessionId: sess.data.id,
	};
}

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
	orgB = await seedOrganization(world, "org_b", "range-b");
});

describe("finalization → verifiable protected artifacts (phase exit)", () => {
	it("creates all four artifacts in storage, hash-verified, with a document row", async () => {
		const { documentId } = await completedDocument();
		const doc = (await world.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentId)
			.executeTakeFirst())!;

		// Every artifact exists in private storage and hashes to the recorded value.
		for (const [key, expected] of [
			[doc.storage_key_signed_pdf, doc.signed_pdf_sha256],
			[doc.storage_key_certificate_pdf, doc.certificate_sha256],
		] as const) {
			const stored = await world.storage.get(key);
			expect(stored).not.toBeNull();
			const { sha256Hex } = await import("@verifyistic/core");
			expect(await sha256Hex(stored!.body)).toBe(expected);
			// Actual PDF magic bytes.
			expect(String.fromCharCode(...stored!.body.slice(0, 5))).toBe("%PDF-");
		}
		expect(
			await world.storage.get(doc.storage_key_source_snapshot),
		).not.toBeNull();
		expect(await world.storage.get(doc.storage_key_manifest)).not.toBeNull();

		// Session finalized.
		const session = (await world.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("id", "=", doc.session_id!)
			.executeTakeFirst())!;
		expect(session.status).toBe("completed");
	});

	it("non-circular hashing: certificate contains the signed-pdf hash, signed pdf does not contain its own", async () => {
		const { documentId } = await completedDocument();
		const doc = (await world.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentId)
			.executeTakeFirst())!;

		const signed = new TextDecoder().decode(
			(await world.storage.get(doc.storage_key_signed_pdf))!.body,
		);
		const certificate = new TextDecoder().decode(
			(await world.storage.get(doc.storage_key_certificate_pdf))!.body,
		);
		expect(certificate).toContain(doc.signed_pdf_sha256);
		expect(signed).not.toContain(doc.signed_pdf_sha256);
		expect(doc.certificate_sha256).not.toBe(doc.signed_pdf_sha256);
	});

	it("manifest references all artifact hashes and the audit chain stays valid", async () => {
		const { documentId } = await completedDocument();
		const doc = (await world.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentId)
			.executeTakeFirst())!;
		const manifest = JSON.parse(
			new TextDecoder().decode(
				(await world.storage.get(doc.storage_key_manifest))!.body,
			),
		);
		expect(manifest.artifacts["signed.pdf"].sha256).toBe(doc.signed_pdf_sha256);
		expect(manifest.artifacts["certificate.pdf"].sha256).toBe(
			doc.certificate_sha256,
		);
		expect(manifest.agreement_sha256).toBe(doc.agreement_sha256);

		const chain = await verifyAuditChain(world.db, "org_a");
		expect(chain.valid).toBe(true);
	});

	it("fallback PDF is multi-page safe with unicode content", () => {
		const lines = Array.from(
			{ length: 80 },
			(_, i) => `Line ${i} — üñïçødé 日本語 ✓`,
		);
		const pdf = renderSimplePdf({
			title: "Ünïcödé Waiver",
			sections: [{ heading: "Terms", lines }],
			footer: "test",
		});
		const text = new TextDecoder("latin1").decode(pdf);
		expect(text.startsWith("%PDF-1.4")).toBe(true);
		expect(text.endsWith("%%EOF\n")).toBe(true);
		expect(text).toContain("/Count 2"); // flowed to a second page
	});
});

describe("authorized downloads", () => {
	it("download-token → download roundtrip; bad tokens are 404; access is audited", async () => {
		const { documentId } = await completedDocument();

		const issued = (await (
			await authedRequest(
				world.app,
				"POST",
				`/v1/documents/${documentId}/download-token`,
				orgA.keyRaw,
			)
		).json()) as { data: { download_url: string } };

		const download = await world.app.request(issued.data.download_url);
		expect(download.status).toBe(200);
		expect(download.headers.get("Content-Type")).toBe("application/pdf");
		const bytes = new Uint8Array(await download.arrayBuffer());
		expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");

		expect(
			(
				await world.app.request(
					`/v1/documents/${documentId}/download?dt=forged-token`,
				)
			).status,
		).toBe(404);

		// Access events live in document_access_events (the audit chain holds chain events).
		const access = await world.db
			.selectFrom("document_access_events")
			.selectAll()
			.where("document_id", "=", documentId)
			.execute();
		const actions = access.map((e) => e.action);
		expect(actions).toContain("download_token_issued");
		expect(actions).toContain("downloaded");
	});

	it("documents:read scope enforced and cross-tenant documents invisible", async () => {
		const { documentId } = await completedDocument();

		const { raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "no-docs", scopes: ["sites:read"] },
		);
		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/documents/${documentId}`,
					raw,
				)
			).status,
		).toBe(403);

		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/documents/${documentId}`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
		const bList = (await (
			await authedRequest(world.app, "GET", "/v1/documents", orgB.keyRaw)
		).json()) as { data: unknown[] };
		expect(bList.data).toHaveLength(0);
	});
});

describe("void + verification page", () => {
	it("void flips status and records reason WITHOUT touching the bytes", async () => {
		const { documentId } = await completedDocument();
		const docBefore = (await world.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentId)
			.executeTakeFirst())!;

		const voided = await authedRequest(
			world.app,
			"POST",
			`/v1/documents/${documentId}/void`,
			orgA.keyRaw,
			{
				reason: "Duplicate submission",
			},
		);
		expect(voided.status).toBe(200);
		const body = (await voided.json()) as {
			data: { status: string; void_reason: string };
		};
		expect(body.data.status).toBe("void");
		expect(body.data.void_reason).toBe("Duplicate submission");

		const docAfter = (await world.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentId)
			.executeTakeFirst())!;
		expect(docAfter.signed_pdf_sha256).toBe(docBefore.signed_pdf_sha256);
		const stored = await world.storage.get(docAfter.storage_key_signed_pdf);
		expect(stored).not.toBeNull();
	});

	it("verification page shows safe metadata only — no DOB, responses, or signatures", async () => {
		const { documentId } = await completedDocument();
		const res = await world.app.request(`/verify/${documentId}`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Document verification");
		expect(html).toContain("PASSED");
		expect(html).not.toContain("2012"); // no DOB
		expect(html).not.toContain("legal_name");
		expect(html).not.toContain("typed_name");
		expect(html).not.toContain("Jane Doe");
	});
});
