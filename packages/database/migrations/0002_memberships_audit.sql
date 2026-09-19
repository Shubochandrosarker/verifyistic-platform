-- 0002_memberships_audit — Phase 2 (tenancy & authentication).
-- organization_users: memberships/role presets; audit_events: per-org hash chain.
-- See docs/contracts/data-model-v1.md. Forward-fix only; applied migrations are checksum-locked.

CREATE TABLE organization_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  -- WPistic account id (cloud) or local account id (self-hosted)
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'owner', 'admin', 'compliance_manager', 'front_desk',
    'template_manager', 'auditor', 'developer'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_organization_users_org_user ON organization_users (organization_id, user_id);
CREATE INDEX idx_organization_users_user ON organization_users (user_id);
CREATE INDEX idx_organization_users_org_status ON organization_users (organization_id, status);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  -- canonical JSON of the event exactly as hashed (one serializer: @verifyistic/core)
  canonical_payload_json TEXT NOT NULL,
  -- per-organization monotonic sequence defining the chain order
  sequence INTEGER NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_events_org_entity ON audit_events (organization_id, entity_type, entity_id);
CREATE INDEX idx_audit_events_org_created ON audit_events (organization_id, created_at);
CREATE INDEX idx_audit_events_org_seq ON audit_events (organization_id, sequence);
