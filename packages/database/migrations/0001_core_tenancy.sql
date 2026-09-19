-- 0001_core_tenancy — Phase 2 foundation subset of data model v1 (docs/contracts/data-model-v1.md).
-- Portable SQLite dialect: runs unmodified on Cloudflare D1 (cloud) and libsql/better-sqlite3 (self-hosted, ADR-001).
-- Rules: TEXT UUID ids, ISO-8601 UTC timestamps, organization_id on every business record.
-- Rollback: forward-fix migrations only in production; D1 point-in-time restore for disasters (doc 13 §8).

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  billing_email TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  default_retention_policy_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_organizations_slug ON organizations (slug);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  domain TEXT,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  branding_config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sites_organization ON sites (organization_id);
CREATE INDEX idx_sites_organization_status ON sites (organization_id, status);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  -- JSON array of scope strings
  scopes TEXT NOT NULL DEFAULT '[]',
  -- JSON array of site ids; NULL = all sites of the organization
  site_restrictions TEXT,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_organization ON api_keys (organization_id);
