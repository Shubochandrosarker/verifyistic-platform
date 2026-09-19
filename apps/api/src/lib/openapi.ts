/**
 * OpenAPI 3.1 document for the Verifyistic public API (doc 05).
 * Programmatic single source: CI asserts every contract path is present.
 * Served at /v1/openapi.json; /v1/docs renders a viewer linking it.
 */
export const OPENAPI_SPEC = {
	openapi: "3.1.0",
	info: {
		title: "Verifyistic API",
		version: "1.0.0",
		description:
			"Digital waivers, age verification, e-signatures, and check-in. " +
			"All list endpoints are cursor-paginated; all business endpoints are tenant-scoped " +
			"to the authenticated API key. Idempotency-Key is honored on create endpoints.",
	},
	servers: [{ url: "https://api.verifyistic.com/v1" }, { url: "/v1" }],
	security: [{ bearerAuth: [] }],
	tags: [
		{ name: "health" },
		{ name: "organization" },
		{ name: "sites" },
		{ name: "customers" },
		{ name: "templates" },
		{ name: "signing" },
		{ name: "documents" },
		{ name: "checkin" },
		{ name: "webhooks" },
		{ name: "api-keys" },
		{ name: "audit" },
	],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "vfy_live_… / vfy_test_… API key",
			},
		},
		schemas: {
			Error: {
				type: "object",
				properties: {
					error: {
						type: "object",
						properties: {
							code: {
								type: "string",
								enum: [
									"validation_error",
									"unauthorized",
									"forbidden",
									"not_found",
									"idempotency_conflict",
									"conflict",
									"rate_limited",
									"internal_error",
								],
							},
							message: { type: "string" },
							fields: {
								type: "object",
								additionalProperties: {
									type: "array",
									items: { type: "string" },
								},
							},
							request_id: { type: "string" },
						},
						required: ["code", "message", "request_id"],
					},
				},
			},
			SuccessEnvelope: {
				type: "object",
				properties: {
					data: {},
					meta: {
						type: "object",
						properties: { request_id: { type: "string" } },
					},
				},
			},
			Site: {
				type: "object",
				properties: {
					id: { type: "string" },
					organization_id: { type: "string" },
					name: { type: "string" },
					domain: { type: "string", nullable: true },
					timezone: { type: "string" },
					status: { type: "string" },
					branding_config: { type: "string", nullable: true },
				},
			},
			Customer: {
				type: "object",
				properties: {
					id: { type: "string" },
					first_name: { type: "string" },
					last_name: { type: "string" },
					email: { type: "string", nullable: true },
					phone: { type: "string", nullable: true },
					date_of_birth: { type: "string", nullable: true },
					status: { type: "string" },
					source: { type: "string" },
				},
			},
			Template: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					category: { type: "string" },
					status: { type: "string", enum: ["draft", "published", "archived"] },
					current_version_id: { type: "string", nullable: true },
				},
			},
			TemplateVersion: {
				type: "object",
				properties: {
					id: { type: "string" },
					version_number: { type: "number" },
					title: { type: "string" },
					document_schema_json: { type: "string" },
					source_hash_sha256: { type: "string" },
					requires_reconsent: { type: "number" },
					published_at: { type: "string", nullable: true },
					immutable_at: { type: "string", nullable: true },
				},
			},
			SigningSession: {
				type: "object",
				properties: {
					id: { type: "string" },
					status: {
						type: "string",
						enum: [
							"created",
							"sent",
							"viewed",
							"in_progress",
							"processing",
							"completed",
							"declined",
							"cancelled",
							"expired",
							"failed",
						],
					},
					template_version_id: { type: "string" },
					customer_id: { type: "string" },
					expires_at: { type: "string", nullable: true },
				},
			},
			Document: {
				type: "object",
				properties: {
					id: { type: "string" },
					status: { type: "string", enum: ["completed", "void"] },
					document_number: { type: "string" },
					signed_at: { type: "string" },
					hashes: { type: "object" },
					legal_hold: { type: "boolean" },
				},
			},
			StatusCard: {
				type: "object",
				properties: {
					customer: { type: "object" },
					age_status: { type: "string", enum: ["minor", "adult", "unknown"] },
					waiver_status: {
						type: "string",
						enum: [
							"current",
							"expired",
							"reconsent_required",
							"missing",
							"void",
						],
					},
					waiver: { type: "object", nullable: true },
					last_check_in: { type: "string", nullable: true },
					attention_flags: { type: "array", items: { type: "string" } },
				},
			},
			WebhookEndpoint: {
				type: "object",
				properties: {
					id: { type: "string" },
					url: { type: "string" },
					subscribed_events: { type: "array", items: { type: "string" } },
					status: { type: "string" },
				},
			},
			ApiKey: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					key_prefix: { type: "string" },
					scopes: { type: "array", items: { type: "string" } },
					last_used_at: { type: "string", nullable: true },
					revoked_at: { type: "string", nullable: true },
				},
			},
		},
	},
	paths: {
		"/health": {
			get: {
				tags: ["health"],
				summary: "Liveness",
				security: [],
				responses: { "200": { description: "OK" } },
			},
		},
		"/organization": {
			get: {
				tags: ["organization"],
				summary: "Read the authenticated organization",
				responses: {
					"200": { description: "OK" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/organization/members": {
			get: {
				tags: ["organization"],
				summary: "List memberships",
				responses: { "200": { description: "OK" } },
			},
		},
		"/sites": {
			get: {
				tags: ["sites"],
				summary: "List sites (sites:read)",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["sites"],
				summary: "Create a site (sites:write)",
				responses: {
					"200": { description: "Created" },
					"400": { description: "Validation error" },
				},
			},
		},
		"/sites/{id}": {
			get: {
				tags: ["sites"],
				summary: "Read a site",
				responses: {
					"200": { description: "OK" },
					"404": { description: "Not found (or other tenant)" },
				},
			},
			patch: {
				tags: ["sites"],
				summary: "Update a site",
				responses: {
					"200": { description: "OK" },
					"404": { description: "Not found" },
				},
			},
		},
		"/customers": {
			get: {
				tags: ["customers"],
				summary: "List customers (cursor pagination)",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["customers"],
				summary: "Create a customer (Idempotency-Key honored)",
				responses: { "200": { description: "Created" } },
			},
		},
		"/customers/{id}": {
			get: {
				tags: ["customers"],
				summary: "Read a customer",
				responses: {
					"200": { description: "OK" },
					"404": { description: "Not found" },
				},
			},
			patch: {
				tags: ["customers"],
				summary: "Update a customer",
				responses: { "200": { description: "OK" } },
			},
		},
		"/customers/{id}/relationships": {
			get: {
				tags: ["customers"],
				summary: "List guardian/household relationships",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["customers"],
				summary: "Create a relationship",
				responses: { "200": { description: "Created" } },
			},
		},
		"/templates": {
			get: {
				tags: ["templates"],
				summary: "List templates",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["templates"],
				summary: "Create a template (inline schema or preset_key)",
				responses: { "200": { description: "Created" } },
			},
		},
		"/templates/{id}": {
			get: {
				tags: ["templates"],
				summary: "Read a template",
				responses: {
					"200": { description: "OK" },
					"404": { description: "Not found" },
				},
			},
			patch: {
				tags: ["templates"],
				summary: "Update template metadata",
				responses: { "200": { description: "OK" } },
			},
		},
		"/templates/{id}/versions": {
			get: {
				tags: ["templates"],
				summary: "List versions",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["templates"],
				summary: "Create a new draft version",
				responses: { "200": { description: "Created" } },
			},
		},
		"/templates/{id}/versions/{versionId}/publish": {
			post: {
				tags: ["templates"],
				summary: "Publish an immutable version (freezes source hash)",
				responses: {
					"200": { description: "Published" },
					"409": { description: "Already published" },
				},
			},
		},
		"/templates/{id}/archive": {
			post: {
				tags: ["templates"],
				summary: "Archive a template",
				responses: { "200": { description: "OK" } },
			},
		},
		"/signing-sessions": {
			get: {
				tags: ["signing"],
				summary: "List signing sessions",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["signing"],
				summary:
					"Create a signing session (Idempotency-Key honored; signer token returned once)",
				responses: {
					"200": { description: "Created" },
					"409": { description: "Template has no published version" },
				},
			},
		},
		"/signing-sessions/{id}": {
			get: {
				tags: ["signing"],
				summary: "Read a signing session",
				responses: { "200": { description: "OK" } },
			},
		},
		"/signing-sessions/{id}/resend": {
			post: {
				tags: ["signing"],
				summary: "Resend the signer link",
				responses: { "200": { description: "OK" } },
			},
		},
		"/signing-sessions/{id}/cancel": {
			post: {
				tags: ["signing"],
				summary: "Cancel a session (token revoked)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/sign/{token}/session": {
			get: {
				tags: ["signing"],
				summary: "Signer: open the session view (token auth)",
				security: [],
				responses: {
					"200": { description: "OK" },
					"404": { description: "Unknown/expired/revoked token" },
				},
			},
		},
		"/sign/{token}/progress": {
			post: {
				tags: ["signing"],
				summary: "Signer: save partial progress (token auth)",
				security: [],
				responses: { "200": { description: "OK" } },
			},
		},
		"/sign/{token}/complete": {
			post: {
				tags: ["signing"],
				summary: "Signer: submit completion (idempotent; token auth)",
				security: [],
				responses: {
					"200": { description: "Processing" },
					"400": { description: "Validation error" },
				},
			},
		},
		"/sign/{token}/decline": {
			post: {
				tags: ["signing"],
				summary: "Signer: decline (token auth)",
				security: [],
				responses: { "200": { description: "OK" } },
			},
		},
		"/documents": {
			get: {
				tags: ["documents"],
				summary: "List documents",
				responses: { "200": { description: "OK" } },
			},
		},
		"/documents/{id}": {
			get: {
				tags: ["documents"],
				summary: "Read a document (hash set included)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/documents/{id}/download-token": {
			post: {
				tags: ["documents"],
				summary: "Issue a 5-minute download token",
				responses: { "200": { description: "OK" } },
			},
		},
		"/documents/{id}/download": {
			get: {
				tags: ["documents"],
				summary: "Download the signed PDF (token auth via dt=)",
				security: [],
				responses: { "200": { description: "PDF bytes" } },
			},
		},
		"/documents/{id}/void": {
			post: {
				tags: ["documents"],
				summary: "Void a document (bytes never rewritten)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/documents/{id}/audit-events": {
			get: {
				tags: ["documents"],
				summary: "Audit chain events for a document",
				responses: { "200": { description: "OK" } },
			},
		},
		"/checkin/search": {
			get: {
				tags: ["checkin"],
				summary: "Front-desk search with status cards",
				responses: { "200": { description: "OK" } },
			},
		},
		"/checkins": {
			get: {
				tags: ["checkin"],
				summary: "Check-in history",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["checkin"],
				summary: "Record a check-in (same-day idempotent)",
				responses: { "200": { description: "OK" } },
			},
		},
		"/webhooks": {
			get: {
				tags: ["webhooks"],
				summary: "List webhook endpoints",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["webhooks"],
				summary: "Register a webhook endpoint (signing secret shown once)",
				responses: { "200": { description: "Created" } },
			},
		},
		"/webhooks/{id}": {
			delete: {
				tags: ["webhooks"],
				summary: "Disable a webhook endpoint",
				responses: { "200": { description: "OK" } },
			},
		},
		"/webhooks/{id}/deliveries": {
			get: {
				tags: ["webhooks"],
				summary: "Delivery log with retry state",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api-keys": {
			get: {
				tags: ["api-keys"],
				summary: "List API keys (never returns secrets)",
				responses: { "200": { description: "OK" } },
			},
			post: {
				tags: ["api-keys"],
				summary:
					"Create an API key (raw key returned once; test keys cannot mint live keys)",
				responses: { "200": { description: "Created" } },
			},
		},
		"/api-keys/{id}": {
			delete: {
				tags: ["api-keys"],
				summary: "Revoke an API key",
				responses: { "200": { description: "OK" } },
			},
		},
		"/api-keys/{id}/rotate": {
			post: {
				tags: ["api-keys"],
				summary: "Rotate an API key",
				responses: { "200": { description: "OK" } },
			},
		},
		"/audit-events": {
			get: {
				tags: ["audit"],
				summary: "Hash-chained audit events (tenant-scoped)",
				responses: { "200": { description: "OK" } },
			},
		},
	},
} as const;
