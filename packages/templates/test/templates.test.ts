import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import { validateDocumentSchema } from "../src/schema.js";
import {
	InvalidSchemaError,
	TemplateArchivedError,
	TemplateNotFoundError,
	TemplateService,
	TemplateVersionImmutableError,
} from "../src/templates.js";

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "system", id: "admin_1" },
};
const orgB: TenantContext = {
	organizationId: "org_b",
	actor: { type: "system", id: "seed" },
};

const simpleSchema = {
	blocks: [
		{ type: "heading", text: "Waiver" },
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

async function makeService() {
	const db = await createInMemoryDatabase();
	await db
		.insertInto("organizations")
		.values(
			["org_a", "org_b"].map((id) => ({
				id,
				name: `Org ${id}`,
				slug: id,
				billing_email: null,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active" as const,
				metadata: null,
				created_at: "2026-09-20T00:00:00Z",
				updated_at: "2026-09-20T00:00:00Z",
			})),
		)
		.execute();
	return { db, templates: new TemplateService(db) };
}

describe("validateDocumentSchema", () => {
	it("accepts a valid schema with conditionals referencing defined fields", () => {
		const result = validateDocumentSchema({
			blocks: [
				{
					type: "field",
					field_key: "is_renting",
					label: "Renting?",
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
			],
		});
		expect(result).toEqual({ valid: true, errors: [] });
	});

	it("rejects unknown block types, empty labels, bad field types, missing options", () => {
		const result = validateDocumentSchema({
			blocks: [
				{ type: "video", text: "nope" },
				{ type: "field", field_key: "f1", field_type: "text" },
				{ type: "field", field_key: "f2", label: "Pick", field_type: "select" },
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("unknown block type"))).toBe(
			true,
		);
		expect(result.errors.some((e) => e.includes("$.blocks[1]"))).toBe(true);
		expect(result.errors.some((e) => e.includes("options"))).toBe(true);
	});

	it("rejects conditionals referencing unknown fields (even nested)", () => {
		const result = validateDocumentSchema({
			blocks: [
				{
					type: "conditional",
					if: { field: "does_not_exist", equals: true },
					blocks: [{ type: "paragraph", text: "x" }],
				},
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("unknown field");
	});
});

describe("TemplateService — draft → publish → immutable (Phase 3 exit)", () => {
	it("creates a draft, publishes an immutable version, and freezes the source hash", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "Range Waiver",
			schema: simpleSchema,
		});
		expect(template.status).toBe("draft");
		expect(version.version_number).toBe(1);
		expect(version.published_at).toBeNull();

		const published = await templates.publishVersion(
			orgA,
			template.id,
			version.id,
		);
		expect(published.published_at).not.toBeNull();
		expect(published.immutable_at).not.toBeNull();
		expect(published.source_hash_sha256).toMatch(/^[0-9a-f]{64}$/);

		const after = (await templates.get(orgA, template.id))!;
		expect(after.status).toBe("published");
		expect(after.current_version_id).toBe(version.id);
	});

	it("forbids editing a published version; drafts stay editable", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "T",
			schema: simpleSchema,
		});

		const editedDraft = await templates.updateDraft(orgA, version.id, {
			title: "Renamed draft",
		});
		expect(editedDraft!.title).toBe("Renamed draft");

		await templates.publishVersion(orgA, template.id, version.id);
		await expect(
			templates.updateDraft(orgA, version.id, { title: "Rewrite history" }),
		).rejects.toThrow(TemplateVersionImmutableError);
	});

	it("editing a used template creates Version 2, not a mutation (doc 02 acceptance)", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "T",
			schema: simpleSchema,
		});
		const v1 = await templates.publishVersion(orgA, template.id, version.id);

		const draft2 = await templates.createDraftVersion(orgA, template.id, {
			title: "T — updated rules",
			schema: simpleSchema,
			requiresReconsent: true,
		});
		const v2 = await templates.publishVersion(orgA, template.id, draft2.id);

		expect(v2.version_number).toBe(2);
		expect(v2.requires_reconsent).toBe(1);
		const versions = await templates.getVersions(orgA, template.id);
		expect(versions).toHaveLength(2);
		// Version 1 evidence stays intact with its original hash.
		const frozen = (await templates.getVersion(orgA, v1.id))!;
		expect(frozen.source_hash_sha256).toBe(v1.source_hash_sha256);
		expect(frozen.immutable_at).not.toBeNull();
		const after = (await templates.get(orgA, template.id))!;
		expect(after.current_version_id).toBe(v2.id);
	});

	it("double publish is rejected (already immutable)", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "T",
			schema: simpleSchema,
		});
		await templates.publishVersion(orgA, template.id, version.id);
		await expect(
			templates.publishVersion(orgA, template.id, version.id),
		).rejects.toThrow(TemplateVersionImmutableError);
	});

	it("publish validates the schema — invalid drafts cannot become immutable", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "Broken",
			schema: {
				blocks: [
					{ type: "field", field_key: "f", field_type: "nope", label: "x" },
				],
			},
		});
		await expect(
			templates.publishVersion(orgA, template.id, version.id),
		).rejects.toThrow(InvalidSchemaError);
		// Still unpublished after the failed attempt.
		expect(
			(await templates.getVersion(orgA, version.id))!.published_at,
		).toBeNull();
	});

	it("cross-tenant templates and versions read as missing", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "Secret",
			schema: simpleSchema,
		});
		await templates.publishVersion(orgA, template.id, version.id);

		expect(await templates.get(orgB, template.id)).toBeUndefined();
		expect(await templates.getVersion(orgB, version.id)).toBeUndefined();
		expect(await templates.getVersions(orgB, template.id)).toHaveLength(0);
		expect(await templates.list(orgB)).toHaveLength(0);
		await expect(
			templates.publishVersion(orgB, template.id, version.id),
		).rejects.toThrow(TemplateNotFoundError);
	});

	it("archived templates refuse new versions and publishes", async () => {
		const { templates } = await makeService();
		const { template, version } = await templates.create(orgA, {
			name: "Old",
			schema: simpleSchema,
		});
		await templates.archive(orgA, template.id);

		await expect(
			templates.createDraftVersion(orgA, template.id, {
				title: "x",
				schema: simpleSchema,
			}),
		).rejects.toThrow(TemplateArchivedError);
		await expect(
			templates.publishVersion(orgA, template.id, version.id),
		).rejects.toThrow(TemplateArchivedError);
	});
});
