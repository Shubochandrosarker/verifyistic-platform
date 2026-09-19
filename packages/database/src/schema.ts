/**
 * Kysely schema types — Phase 2 subset (tenancy + API keys).
 * These types mirror packages/database/migrations/*.sql; migrations are the source of truth.
 * Every table: TEXT UUID ids, ISO-8601 UTC timestamps, organization_id tenant key (data model v1).
 */
import type { Selectable } from "kysely";

export interface OrganizationsTable {
	id: string;
	name: string;
	slug: string;
	billing_email: string | null;
	timezone: string;
	default_retention_policy_id: string | null;
	status: "active" | "suspended" | "closed";
	/** JSON object; free-form tenant settings. */
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

export interface SitesTable {
	id: string;
	organization_id: string;
	name: string;
	domain: string | null;
	address: string | null;
	timezone: string;
	status: "active" | "inactive";
	/** JSON object: logo key, accent color, display name, contact (doc 19 §8). */
	branding_config: string | null;
	created_at: string;
	updated_at: string;
}

export interface ApiKeysTable {
	id: string;
	organization_id: string;
	name: string;
	/** Display prefix only, e.g. vfy_live_ab12 — the secret portion is never stored (doc 06 §4). */
	key_prefix: string;
	/** SHA-256 hex of the full raw key; unique lookup index. */
	key_hash: string;
	/** JSON array of scope strings. */
	scopes: string;
	/** JSON array of site ids this key may act on; null = all sites in the organization. */
	site_restrictions: string | null;
	last_used_at: string | null;
	expires_at: string | null;
	revoked_at: string | null;
	created_at: string;
}

export type Organization = Selectable<OrganizationsTable>;
export type Site = Selectable<SitesTable>;
export type ApiKey = Selectable<ApiKeysTable>;

export interface OrganizationUsersTable {
	id: string;
	organization_id: string;
	/** WPistic account id (cloud) or local account id (self-hosted). */
	user_id: string;
	/** Role preset — authorization checks capabilities, never raw role names (ADR-003). */
	role:
		| "owner"
		| "admin"
		| "compliance_manager"
		| "front_desk"
		| "template_manager"
		| "auditor"
		| "developer";
	status: "active" | "invited" | "suspended" | "removed";
	created_at: string;
	updated_at: string;
}

export interface AuditEventsTable {
	id: string;
	organization_id: string;
	entity_type: string;
	entity_id: string;
	event_type: string;
	actor_type: string;
	actor_id: string;
	/** Canonical JSON of the event exactly as hashed. */
	canonical_payload_json: string;
	/** Per-organization monotonic sequence — chain order. */
	sequence: number;
	previous_hash: string;
	event_hash: string;
	created_at: string;
}

export type OrganizationUser = Selectable<OrganizationUsersTable>;
export type AuditEvent = Selectable<AuditEventsTable>;

export interface CustomersTable {
	id: string;
	organization_id: string;
	primary_site_id: string | null;
	first_name: string;
	last_name: string;
	email: string | null;
	/** Lowercased, trimmed — the dedupe/lookup column. */
	email_normalized: string | null;
	phone: string | null;
	/** Digits with optional leading + — the lookup column. */
	phone_normalized: string | null;
	/** ISO date (YYYY-MM-DD); sensitive — public surfaces never expose it. */
	date_of_birth: string | null;
	/** JSON object. */
	address_json: string | null;
	status: "active" | "inactive" | "archived";
	source: string;
	external_ref: string | null;
	created_at: string;
	updated_at: string;
}

export interface CustomerRelationshipsTable {
	id: string;
	organization_id: string;
	customer_id: string;
	related_customer_id: string;
	relationship_type: "guardian_of" | "guarded_by" | "household";
	effective_from: string | null;
	effective_to: string | null;
	/** JSON object. */
	metadata: string | null;
	created_at: string;
}

export interface TemplatesTable {
	id: string;
	organization_id: string;
	name: string;
	category: string;
	status: "draft" | "published" | "archived";
	current_version_id: string | null;
	default_validity_days: number | null;
	/** JSON: { min_age, require_guardian_for_minors } (doc 07 §7). */
	guardian_policy_json: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface TemplateVersionsTable {
	id: string;
	organization_id: string;
	template_id: string;
	version_number: number;
	title: string;
	/** Structured block schema (doc 19 §4) — validated before publish. */
	document_schema_json: string;
	rendered_source_html: string | null;
	/** SHA-256 of the canonical schema, fixed at publish. */
	source_hash_sha256: string;
	consent_text_version: string;
	effective_from: string | null;
	requires_reconsent: number;
	published_by: string | null;
	published_at: string | null;
	immutable_at: string | null;
	created_at: string;
}

export type Customer = Selectable<CustomersTable>;
export type CustomerRelationship = Selectable<CustomerRelationshipsTable>;
export type Template = Selectable<TemplatesTable>;
export type TemplateVersion = Selectable<TemplateVersionsTable>;

export interface SigningSessionsTable {
	id: string;
	organization_id: string;
	site_id: string | null;
	template_version_id: string;
	customer_id: string;
	/** Enforced by packages/core/src/signing/status.ts state machine. */
	status:
		| "created"
		| "sent"
		| "viewed"
		| "in_progress"
		| "processing"
		| "completed"
		| "declined"
		| "cancelled"
		| "expired"
		| "failed";
	/** SHA-256 of the raw signer token — raw token never stored. */
	token_hash: string;
	token_expires_at: string;
	token_revoked_at: string | null;
	delivery_method: string;
	requested_by: string | null;
	started_at: string | null;
	completed_at: string | null;
	declined_at: string | null;
	expires_at: string | null;
	/** JSON: request metadata + evaluated shown_conditionals. */
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

export interface SigningParticipantsTable {
	id: string;
	organization_id: string;
	session_id: string;
	customer_id: string | null;
	role: "signer" | "guardian" | "witness" | "staff";
	email_snapshot: string | null;
	phone_snapshot: string | null;
	required: number;
	status: "pending" | "signed" | "declined" | "skipped";
	signed_at: string | null;
	created_at: string;
}

export interface FieldResponsesTable {
	id: string;
	organization_id: string;
	session_id: string;
	participant_id: string | null;
	field_key: string;
	field_type: string;
	value_json: string;
	value_hash: string;
	created_at: string;
}

export interface SignaturesTable {
	id: string;
	organization_id: string;
	session_id: string;
	participant_id: string;
	method: "drawn" | "typed";
	/** Phase 5: artifact bytes move to object storage; key recorded here. */
	storage_key: string | null;
	signature_hash: string;
	typed_name: string | null;
	captured_at: string;
	ip: string | null;
	/** Safe device snapshot only (platform/browser class). */
	user_agent_safe_snapshot: string | null;
	metadata: string | null;
}

export type SigningSession = Selectable<SigningSessionsTable>;
export type SigningParticipant = Selectable<SigningParticipantsTable>;
export type FieldResponse = Selectable<FieldResponsesTable>;
export type Signature = Selectable<SignaturesTable>;

export interface DocumentsTable {
	id: string;
	organization_id: string;
	site_id: string | null;
	customer_id: string | null;
	session_id: string | null;
	template_version_id: string;
	status: "completed" | "void";
	/** Human-facing sequential number, e.g. DOC-2026-000001 (org-scoped counter). */
	document_number: string;
	signed_at: string;
	expires_at: string | null;
	storage_key_signed_pdf: string;
	storage_key_certificate_pdf: string;
	storage_key_manifest: string;
	storage_key_source_snapshot: string;
	signed_pdf_sha256: string;
	certificate_sha256: string;
	/** SHA-256 of the published template schema (frozen at publish). */
	agreement_sha256: string;
	signature_set_sha256: string;
	audit_chain_hash: string;
	retention_until: string | null;
	legal_hold: number;
	voided_at: string | null;
	voided_by: string | null;
	void_reason: string | null;
	created_at: string;
}

export interface DocumentAccessEventsTable {
	id: string;
	organization_id: string;
	document_id: string;
	actor_type: string;
	actor_id: string;
	action:
		| "viewed"
		| "downloaded"
		| "download_token_issued"
		| "voided"
		| "metadata_read";
	ip: string | null;
	created_at: string;
}

export interface DownloadTokensTable {
	id: string;
	organization_id: string;
	document_id: string;
	token_hash: string;
	expires_at: string;
	used_at: string | null;
	created_by_actor_type: string;
	created_by_actor_id: string;
	created_at: string;
}

export type Document = Selectable<DocumentsTable>;
export type DocumentAccessEvent = Selectable<DocumentAccessEventsTable>;
export type DownloadToken = Selectable<DownloadTokensTable>;

export interface Database {
	organizations: OrganizationsTable;
	sites: SitesTable;
	api_keys: ApiKeysTable;
	organization_users: OrganizationUsersTable;
	audit_events: AuditEventsTable;
	customers: CustomersTable;
	customer_relationships: CustomerRelationshipsTable;
	templates: TemplatesTable;
	template_versions: TemplateVersionsTable;
	signing_sessions: SigningSessionsTable;
	signing_participants: SigningParticipantsTable;
	field_responses: FieldResponsesTable;
	signatures: SignaturesTable;
	documents: DocumentsTable;
	document_access_events: DocumentAccessEventsTable;
	download_tokens: DownloadTokensTable;
}
