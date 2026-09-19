import { ApiError } from "@verifyistic/core";
import { PRESET_KEYS, instantiatePreset } from "@verifyistic/firearms";
import {
	InvalidSchemaError,
	TemplateArchivedError,
	TemplateNotFoundError,
	TemplateVersionImmutableError,
} from "@verifyistic/templates";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

export function templatesRoutes(deps: AppServices) {
	const routes = new Hono();

	// Create from scratch or from a range preset (doc 11 §3 — editable starting points).
	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "templates:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const {
			name,
			category,
			preset_key,
			schema,
			default_validity_days,
			guardian_policy,
		} = body as Record<string, unknown>;

		if (preset_key !== undefined) {
			if (typeof preset_key !== "string" || !PRESET_KEYS.includes(preset_key)) {
				throw ApiError.validation(
					`preset_key must be one of: ${PRESET_KEYS.join(", ")}`,
					{
						preset_key: ["invalid"],
					},
				);
			}
			const preset = instantiatePreset(
				preset_key,
				typeof name === "string" ? name : undefined,
			);
			if (!preset)
				throw ApiError.validation("Unknown preset.", {
					preset_key: ["invalid"],
				});
			const created = await deps.templates.create(tenant, preset);
			await deps.audit.record(tenant, {
				eventType: "template.created",
				entityType: "template",
				entityId: created.template.id,
				data: { from_preset: preset_key },
			});
			return ok(c, created, { created: true });
		}

		if (
			typeof name !== "string" ||
			name.trim().length === 0 ||
			name.length > 200
		) {
			throw ApiError.validation("name is required (1-200 characters).", {
				name: ["required"],
			});
		}
		if (schema === undefined) {
			throw ApiError.validation("schema (or preset_key) is required.", {
				schema: ["required"],
			});
		}

		const created = await deps.templates.create(tenant, {
			name,
			category: typeof category === "string" ? category : undefined,
			schema,
			defaultValidityDays:
				typeof default_validity_days === "number" &&
				Number.isFinite(default_validity_days)
					? default_validity_days
					: null,
			guardianPolicy:
				(guardian_policy as Record<string, unknown> | null) ?? null,
		});
		await deps.audit.record(tenant, {
			eventType: "template.created",
			entityType: "template",
			entityId: created.template.id,
			data: { name: created.template.name },
		});
		return ok(c, created, { created: true });
	});

	routes.get("/", async (c) => {
		requireScope(c, "templates:read");
		const templates = await deps.templates.list(c.get("tenant")!);
		return ok(c, templates);
	});

	routes.get("/:id", async (c) => {
		requireScope(c, "templates:read");
		const template = await deps.templates.get(
			c.get("tenant")!,
			c.req.param("id"),
		);
		if (!template) throw ApiError.notFound("Template not found.");
		return ok(c, template);
	});

	routes.patch("/:id", async (c) => {
		const { tenant } = requireScope(c, "templates:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { name, default_validity_days, guardian_policy } = body as Record<
			string,
			unknown
		>;
		const existing = await deps.templates.get(tenant, c.req.param("id"));
		if (!existing) throw ApiError.notFound("Template not found.");

		const { db } = deps;
		const set: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};
		if (name !== undefined) {
			if (
				typeof name !== "string" ||
				name.trim().length === 0 ||
				name.length > 200
			) {
				throw ApiError.validation("name must be 1-200 characters.", {
					name: ["invalid"],
				});
			}
			set.name = name.trim();
		}
		if (default_validity_days !== undefined) {
			set.default_validity_days =
				default_validity_days === null ? null : Number(default_validity_days);
		}
		if (guardian_policy !== undefined) {
			set.guardian_policy_json =
				guardian_policy === null ? null : JSON.stringify(guardian_policy);
		}
		const updated = await db
			.updateTable("templates")
			.set(set)
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", existing.id)
			.returningAll()
			.executeTakeFirst();
		return ok(c, updated);
	});

	// New draft version — never mutates an existing (possibly published) version.
	routes.post("/:id/versions", async (c) => {
		const { tenant } = requireScope(c, "templates:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { title, schema, requires_reconsent, effective_from } =
			body as Record<string, unknown>;
		if (typeof title !== "string" || title.trim().length === 0) {
			throw ApiError.validation("title is required.", { title: ["required"] });
		}
		if (schema === undefined) {
			throw ApiError.validation("schema is required.", {
				schema: ["required"],
			});
		}
		const version = await deps.templates.createDraftVersion(
			tenant,
			c.req.param("id"),
			{
				title,
				schema,
				requiresReconsent: requires_reconsent === true,
				effectiveFrom: (effective_from as string | null) ?? null,
			},
		);
		await deps.audit.record(tenant, {
			eventType: "template.version_created",
			entityType: "template",
			entityId: c.req.param("id"),
			data: { version_id: version.id, version_number: version.version_number },
		});
		return ok(c, version, { created: true });
	});

	routes.get("/:id/versions", async (c) => {
		requireScope(c, "templates:read");
		const versions = await deps.templates.getVersions(
			c.get("tenant")!,
			c.req.param("id"),
		);
		return ok(c, versions);
	});

	routes.get("/:id/versions/:versionId", async (c) => {
		requireScope(c, "templates:read");
		const version = await deps.templates.getVersion(
			c.get("tenant")!,
			c.req.param("versionId"),
		);
		if (!version || version.template_id !== c.req.param("id"))
			throw ApiError.notFound("Template version not found.");
		return ok(c, version);
	});

	routes.post("/:id/versions/:versionId/publish", async (c) => {
		const { tenant } = requireScope(c, "templates:write");
		const published = await deps.templates.publishVersion(
			tenant,
			c.req.param("id"),
			c.req.param("versionId"),
		);
		await deps.audit.record(tenant, {
			eventType: "template.published",
			entityType: "template",
			entityId: c.req.param("id"),
			data: {
				version_id: published.id,
				version_number: published.version_number,
				source_hash: published.source_hash_sha256,
				requires_reconsent: published.requires_reconsent === 1,
			},
		});
		return ok(c, published);
	});

	routes.post("/:id/archive", async (c) => {
		const { tenant } = requireScope(c, "templates:write");
		const archived = await deps.templates.archive(tenant, c.req.param("id"));
		if (!archived) throw ApiError.notFound("Template not found.");
		await deps.audit.record(tenant, {
			eventType: "template.archived",
			entityType: "template",
			entityId: archived.id,
			data: {},
		});
		return ok(c, archived);
	});

	return routes;
}

/** Shared mapping so onError can translate domain errors (used by index.ts). */
export function templateErrorStatus(error: unknown): {
	code: "not_found" | "validation_error" | "conflict";
	status: 404 | 400 | 409;
} | null {
	if (error instanceof TemplateNotFoundError)
		return { code: "not_found", status: 404 };
	if (
		error instanceof TemplateVersionImmutableError ||
		error instanceof TemplateArchivedError
	) {
		return { code: "conflict", status: 409 };
	}
	if (error instanceof InvalidSchemaError)
		return { code: "validation_error", status: 400 };
	return null;
}
