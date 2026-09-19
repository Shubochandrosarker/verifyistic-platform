-- 0003_customers_templates — Phase 3 (customers & templates).
-- Data model v1 §2/§3: normalized contact columns, guardian relationships,
-- templates with immutable published versions. Forward-fix only.

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  primary_site_id TEXT REFERENCES sites (id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  email_normalized TEXT,
  phone TEXT,
  phone_normalized TEXT,
  -- ISO date; sensitive value — never expose in public surfaces (doc 08 §7)
  date_of_birth TEXT,
  address_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  source TEXT NOT NULL DEFAULT 'api',
  external_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_customers_org_email ON customers (organization_id, email_normalized);
CREATE INDEX idx_customers_org_phone ON customers (organization_id, phone_normalized);
CREATE INDEX idx_customers_org_status ON customers (organization_id, status);

CREATE TABLE customer_relationships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  related_customer_id TEXT NOT NULL REFERENCES customers (id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('guardian_of', 'guarded_by', 'household')),
  effective_from TEXT,
  effective_to TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_customer_rel_pair ON customer_relationships (organization_id, customer_id, related_customer_id, relationship_type);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version_id TEXT,
  default_validity_days INTEGER,
  -- JSON: { "min_age": 18, "require_guardian_for_minors": true } (doc 07 §7)
  guardian_policy_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_templates_org_status ON templates (organization_id, status);

CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  template_id TEXT NOT NULL REFERENCES templates (id),
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  -- Structured block schema (doc 19 §4) — validated before publish
  document_schema_json TEXT NOT NULL,
  rendered_source_html TEXT,
  -- SHA-256 of the canonical schema, fixed at publish
  source_hash_sha256 TEXT NOT NULL,
  consent_text_version TEXT NOT NULL DEFAULT 'v1',
  effective_from TEXT,
  requires_reconsent INTEGER NOT NULL DEFAULT 0,
  published_by TEXT,
  published_at TEXT,
  immutable_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_template_versions_tpl_ver ON template_versions (organization_id, template_id, version_number);
