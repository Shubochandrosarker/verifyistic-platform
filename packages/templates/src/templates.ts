/**
 * Template engine (doc 07 §9, doc 02 §3 "Templates"):
 *   draft → publish → Version N immutable; edit → new draft → Version N+1.
 * A published version is frozen at publish time: source_hash fixed, row immutable
 * (the repository exposes NO update path for published versions). If a newer version
 * requires re-consent, historical evidence stays intact — operational status can
 * become reconsent_required (handled by the signing engine in Phase 4).
 */
import { canonicalJson, newId, sha256Hex } from "@verifyistic/core";
import type {
	Database,
	Template,
	TemplateVersion,
} from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import { type DocumentSchema, validateDocumentSchema } from "./schema.js";

const nowIso = () => new Date().toISOString();

export class TemplateVersionImmutableError extends Error {
	constructor(versionId: string) {
		super(
			`Template version ${versionId} is published and immutable. Create a new draft version instead.`,
		);
		this.name = "TemplateVersionImmutableError";
	}
}

export class InvalidSchemaError extends Error {
	readonly errors: string[];
	constructor(errors: string[]) {
		super(`Invalid document schema: ${errors.join("; ")}`);
		this.name = "InvalidSchemaError";
		this.errors = errors;
	}
}

export interface CreateTemplateInput {
	name: string;
	category?: string;
	schema: unknown;
	title?: string;
	defaultValidityDays?: number | null;
	guardianPolicy?: Record<string, unknown> | null;
}

export interface NewVersionInput {
	title: string;
	schema: unknown;
	requiresReconsent?: boolean;
	effectiveFrom?: string | null;
}

export class TemplateService {
	constructor(private readonly db: Kysely<Database>) {}

	async create(
		tenant: TenantContext,
		input: CreateTemplateInput,
	): Promise<{ template: Template; version: TemplateVersion }> {
		const timestamp = nowIso();
		const templateId = newId();
		const template: Template = {
			id: templateId,
			organization_id: tenant.organizationId,
			name: input.name.trim(),
			category: input.category ?? "general",
			status: "draft",
			current_version_id: null,
			default_validity_days: input.defaultValidityDays ?? null,
			guardian_policy_json: input.guardianPolicy
				? JSON.stringify(input.guardianPolicy)
				: null,
			created_by: tenant.actor.id,
			created_at: timestamp,
			updated_at: timestamp,
		};
		await this.db.insertInto("templates").values(template).execute();

		const version = await this.createDraftVersion(
			tenant,
			templateId,
			{ title: input.title ?? input.name, schema: input.schema },
			1,
		);
		return { template, version };
	}

	/** Drafts are created as version rows with published_at = null; number = max+1. */
	async createDraftVersion(
		tenant: TenantContext,
		templateId: string,
		input: NewVersionInput,
		forcedVersionNumber?: number,
	): Promise<TemplateVersion> {
		const template = await this.get(tenant, templateId);
		if (!template) throw new TemplateNotFoundError();
		if (template.status === "archived")
			throw new TemplateArchivedError(templateId);

		const head = await this.db
			.selectFrom("template_versions")
			.select(({ fn }) => [fn.max("version_number").as("max")])
			.where("organization_id", "=", tenant.organizationId)
			.where("template_id", "=", templateId)
			.executeTakeFirst();
		const versionNumber =
			forcedVersionNumber ?? ((head?.max as number | null) ?? 0) + 1;

		const version: TemplateVersion = {
			id: newId(),
			organization_id: tenant.organizationId,
			template_id: templateId,
			version_number: versionNumber,
			title: input.title.trim(),
			document_schema_json: JSON.stringify(input.schema),
			rendered_source_html: null,
			source_hash_sha256: "",
			consent_text_version: "v1",
			effective_from: input.effectiveFrom ?? null,
			requires_reconsent: input.requiresReconsent ? 1 : 0,
			published_by: null,
			published_at: null,
			immutable_at: null,
			created_at: nowIso(),
		};
		await this.db.insertInto("template_versions").values(version).execute();
		return version;
	}

	/** Only drafts are editable — a published version can never change (immutability invariant). */
	async updateDraft(
		tenant: TenantContext,
		versionId: string,
		patch: {
			title?: string;
			schema?: unknown;
			requiresReconsent?: boolean;
			effectiveFrom?: string | null;
		},
	): Promise<TemplateVersion | undefined> {
		const version = await this.getVersion(tenant, versionId);
		if (!version) return undefined;
		if (version.published_at !== null)
			throw new TemplateVersionImmutableError(versionId);

		const set: Partial<TemplateVersion> = {};
		if (patch.title !== undefined) set.title = patch.title.trim();
		if (patch.schema !== undefined)
			set.document_schema_json = JSON.stringify(patch.schema);
		if (patch.requiresReconsent !== undefined)
			set.requires_reconsent = patch.requiresReconsent ? 1 : 0;
		if (patch.effectiveFrom !== undefined)
			set.effective_from = patch.effectiveFrom;

		return this.db
			.updateTable("template_versions")
			.set(set)
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", versionId)
			.returningAll()
			.executeTakeFirst();
	}

	/** Validate → hash → freeze → point the template at the published version. */
	async publishVersion(
		tenant: TenantContext,
		templateId: string,
		versionId: string,
	): Promise<TemplateVersion> {
		const template = await this.get(tenant, templateId);
		if (!template) throw new TemplateNotFoundError();
		if (template.status === "archived")
			throw new TemplateArchivedError(templateId);

		const version = await this.getVersion(tenant, versionId);
		if (!version || version.template_id !== templateId)
			throw new TemplateNotFoundError();

		const schema = JSON.parse(version.document_schema_json) as unknown;
		const validation = validateDocumentSchema(schema);
		if (!validation.valid) throw new InvalidSchemaError(validation.errors);

		const sourceHash = await sha256Hex(canonicalJson(schema));
		const timestamp = nowIso();
		const published = await this.db
			.updateTable("template_versions")
			.set({
				published_at: timestamp,
				immutable_at: timestamp,
				published_by: tenant.actor.id,
				source_hash_sha256: sourceHash,
			})
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", versionId)
			.where("published_at", "is", null)
			.returningAll()
			.executeTakeFirst();
		if (!published) throw new TemplateVersionImmutableError(versionId);

		await this.db
			.updateTable("templates")
			.set({
				status: "published",
				current_version_id: published.id,
				updated_at: timestamp,
			})
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", templateId)
			.execute();

		return published;
	}

	async get(
		tenant: TenantContext,
		templateId: string,
	): Promise<Template | undefined> {
		return this.db
			.selectFrom("templates")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", templateId)
			.executeTakeFirst();
	}

	async list(tenant: TenantContext): Promise<Template[]> {
		return this.db
			.selectFrom("templates")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "desc")
			.execute();
	}

	async getVersions(
		tenant: TenantContext,
		templateId: string,
	): Promise<TemplateVersion[]> {
		return this.db
			.selectFrom("template_versions")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("template_id", "=", templateId)
			.orderBy("version_number", "asc")
			.execute();
	}

	async getVersion(
		tenant: TenantContext,
		versionId: string,
	): Promise<TemplateVersion | undefined> {
		return this.db
			.selectFrom("template_versions")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", versionId)
			.executeTakeFirst();
	}

	async archive(
		tenant: TenantContext,
		templateId: string,
	): Promise<Template | undefined> {
		return this.db
			.updateTable("templates")
			.set({ status: "archived", updated_at: nowIso() })
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", templateId)
			.returningAll()
			.executeTakeFirst();
	}
}

export class TemplateNotFoundError extends Error {
	constructor() {
		super("Template not found.");
		this.name = "TemplateNotFoundError";
	}
}

export class TemplateArchivedError extends Error {
	constructor(templateId: string) {
		super(`Template ${templateId} is archived.`);
		this.name = "TemplateArchivedError";
	}
}

export type { DocumentSchema };
