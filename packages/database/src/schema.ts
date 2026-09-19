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

export interface Database {
	organizations: OrganizationsTable;
	sites: SitesTable;
	api_keys: ApiKeysTable;
}
