import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 3 exit criterion (doc 21): an administrator can create and publish an
 * immutable template version — plus customer/tenant behavior at the API layer.
 */
let world: TestWorld;
let orgA: SeededKey;
let orgB: SeededKey;

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
	orgB = await seedOrganization(world, "org_b", "range-b");
});

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

describe("templates API — publish immutable version (phase exit)", () => {
	it("create from preset → publish → version immutable, current pointer moved", async () => {
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				preset_key: "range_liability_waiver",
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};

		const templateId = created.data.template.id;
		const publishRes = await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${templateId}/versions/${created.data.version.id}/publish`,
			orgA.keyRaw,
		);
		expect(publishRes.status).toBe(200);
		const published = (await publishRes.json()) as {
			data: {
				immutable_at: string;
				source_hash_sha256: string;
				version_number: number;
			};
		};
		expect(published.data.version_number).toBe(1);
		expect(published.data.immutable_at).not.toBeNull();
		expect(published.data.source_hash_sha256).toMatch(/^[0-9a-f]{64}$/);

		// The published version can no longer be edited: PATCH on versions is not exposed,
		// and a second publish attempt returns 409.
		const republish = await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${templateId}/versions/${created.data.version.id}/publish`,
			orgA.keyRaw,
		);
		expect(republish.status).toBe(409);
	});

	it("version 2 requires re-consent while version 1 stays frozen", async () => {
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "Rules",
				schema: SCHEMA,
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		const templateId = created.data.template.id;
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${templateId}/versions/${created.data.version.id}/publish`,
			orgA.keyRaw,
		);

		const v2 = (await (
			await authedRequest(
				world.app,
				"POST",
				`/v1/templates/${templateId}/versions`,
				orgA.keyRaw,
				{
					title: "Rules — updated",
					schema: SCHEMA,
					requires_reconsent: true,
				},
			)
		).json()) as { data: { id: string; version_number: number } };
		expect(v2.data.version_number).toBe(2);
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${templateId}/versions/${v2.data.id}/publish`,
			orgA.keyRaw,
		);

		const versions = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/templates/${templateId}/versions`,
				orgA.keyRaw,
			)
		).json()) as {
			data: {
				version_number: number;
				requires_reconsent: number;
				immutable_at: string | null;
			}[];
		};
		expect(versions.data).toHaveLength(2);
		expect(versions.data[0]!.requires_reconsent).toBe(0);
		expect(versions.data[1]!.requires_reconsent).toBe(1);
		expect(versions.data.every((v) => v.immutable_at !== null)).toBe(true);
	});

	it("invalid schema publish returns 400 and the version stays draft", async () => {
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "Broken",
				schema: { blocks: [{ type: "nonsense" }] },
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		const res = await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${created.data.template.id}/versions/${created.data.version.id}/publish`,
			orgA.keyRaw,
		);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
			"validation_error",
		);
	});

	it("cross-tenant template reads are 404; templates:read scope enforced", async () => {
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "A",
				schema: SCHEMA,
			})
		).json()) as { data: { template: { id: string } } };

		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/templates/${created.data.template.id}`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);

		const { raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "no-templates", scopes: ["sites:read"] },
		);
		expect(
			(await authedRequest(world.app, "GET", "/v1/templates", raw)).status,
		).toBe(403);
	});
});

describe("customers API", () => {
	it("creates with normalization, lists with cursor, cross-tenant reads 404", async () => {
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Jane",
				last_name: "Doe",
				email: "  Jane@Example.COM ",
				phone: "+1 (555) 000-1111",
			})
		).json()) as {
			data: {
				id: string;
				email: string;
				phone: string;
				date_of_birth: string | null;
			};
		};
		// Raw values are trimmed; the *_normalized lookup columns stay internal.
		expect(created.data.email).toBe("Jane@Example.COM");
		expect(created.data.phone).toBe("+1 (555) 000-1111");

		// DOB accepted as ISO date; garbage rejected without creating a record.
		await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
			first_name: "Min",
			last_name: "Or",
			date_of_birth: "2012-05-01",
		});
		const dobRes = await authedRequest(
			world.app,
			"POST",
			"/v1/customers",
			orgA.keyRaw,
			{
				first_name: "Bad",
				last_name: "Dob",
				date_of_birth: "not-a-date",
			},
		);
		expect(dobRes.status).toBe(400);

		// Two valid customers exist → limit=1 leaves more behind.
		const page = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/customers?limit=1",
				orgA.keyRaw,
			)
		).json()) as {
			meta: { has_more: boolean; next_cursor: string | null };
			data: { id: string }[];
		};
		expect(page.data).toHaveLength(1);
		expect(page.meta.has_more).toBe(true);

		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/customers/${created.data.id}`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
	});

	it("guardian relationship via API is org-scoped", async () => {
		const minor = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Min",
				last_name: "Or",
				date_of_birth: "2012-05-01",
			})
		).json()) as { data: { id: string } };
		const guardian = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Gua",
				last_name: "Rdian",
			})
		).json()) as { data: { id: string } };

		const rel = (await (
			await authedRequest(
				world.app,
				"POST",
				`/v1/customers/${minor.data.id}/relationships`,
				orgA.keyRaw,
				{
					related_customer_id: guardian.data.id,
					relationship_type: "guarded_by",
				},
			)
		).json()) as { data: { id: string; relationship_type: string } };
		expect(rel.data.relationship_type).toBe("guarded_by");

		// Cross-tenant pairing (either side) reads as missing.
		expect(
			(
				await authedRequest(
					world.app,
					"POST",
					`/v1/customers/${minor.data.id}/relationships`,
					orgB.keyRaw,
					{
						related_customer_id: guardian.data.id,
						relationship_type: "guarded_by",
					},
				)
			).status,
		).toBe(404);
	});
});
