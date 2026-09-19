-- 0004_signing — Phase 4 (signing engine).
-- Data model v1 §4: sessions, participants, field responses, signatures.
-- Raw signer tokens are NEVER stored — sessions carry token_hash only.

CREATE TABLE signing_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  site_id TEXT REFERENCES sites (id),
  template_version_id TEXT NOT NULL REFERENCES template_versions (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'sent', 'viewed', 'in_progress', 'processing',
    'completed', 'declined', 'cancelled', 'expired', 'failed'
  )),
  token_hash TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  token_revoked_at TEXT,
  delivery_method TEXT NOT NULL DEFAULT 'link',
  requested_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  declined_at TEXT,
  expires_at TEXT,
  -- JSON: request metadata + evaluated shown_conditionals at completion
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_signing_sessions_token_hash ON signing_sessions (token_hash);
CREATE INDEX idx_signing_sessions_org_status ON signing_sessions (organization_id, status);
CREATE INDEX idx_signing_sessions_org_customer ON signing_sessions (organization_id, customer_id);

CREATE TABLE signing_participants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  session_id TEXT NOT NULL REFERENCES signing_sessions (id),
  customer_id TEXT REFERENCES customers (id),
  role TEXT NOT NULL CHECK (role IN ('signer', 'guardian', 'witness', 'staff')),
  email_snapshot TEXT,
  phone_snapshot TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'declined', 'skipped')),
  signed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_signing_participants_session ON signing_participants (session_id);

CREATE TABLE field_responses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  session_id TEXT NOT NULL REFERENCES signing_sessions (id),
  participant_id TEXT REFERENCES signing_participants (id),
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_field_responses_session_key ON field_responses (session_id, field_key);

CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  session_id TEXT NOT NULL REFERENCES signing_sessions (id),
  participant_id TEXT NOT NULL REFERENCES signing_participants (id),
  method TEXT NOT NULL CHECK (method IN ('drawn', 'typed')),
  -- Phase 5: artifact bytes move to object storage; key recorded here.
  storage_key TEXT,
  signature_hash TEXT NOT NULL,
  typed_name TEXT,
  captured_at TEXT NOT NULL,
  ip TEXT,
  -- Safe device snapshot only (platform/browser class) — never a raw long UA string
  user_agent_safe_snapshot TEXT,
  metadata TEXT
);

CREATE INDEX idx_signatures_session ON signatures (session_id);
