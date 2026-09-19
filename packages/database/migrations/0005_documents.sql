-- 0005_documents — Phase 5 (document evidence).
-- Data model v1 §5: documents + access events; download tokens are short-lived and
-- hashed at rest (same discipline as API keys and signer tokens).

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  site_id TEXT REFERENCES sites (id),
  customer_id TEXT REFERENCES customers (id),
  session_id TEXT REFERENCES signing_sessions (id),
  template_version_id TEXT NOT NULL REFERENCES template_versions (id),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
  document_number TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  expires_at TEXT,
  storage_key_signed_pdf TEXT NOT NULL,
  storage_key_certificate_pdf TEXT NOT NULL,
  storage_key_manifest TEXT NOT NULL,
  storage_key_source_snapshot TEXT NOT NULL,
  signed_pdf_sha256 TEXT NOT NULL,
  certificate_sha256 TEXT NOT NULL,
  agreement_sha256 TEXT NOT NULL,
  signature_set_sha256 TEXT NOT NULL,
  audit_chain_hash TEXT NOT NULL,
  retention_until TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_documents_org_number ON documents (organization_id, document_number);
CREATE INDEX idx_documents_org_customer ON documents (organization_id, customer_id);
CREATE INDEX idx_documents_org_status ON documents (organization_id, status);

CREATE TABLE document_access_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  document_id TEXT NOT NULL REFERENCES documents (id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('viewed', 'downloaded', 'download_token_issued', 'voided', 'metadata_read')),
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_document_access_events_doc ON document_access_events (document_id);

CREATE TABLE download_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  document_id TEXT NOT NULL REFERENCES documents (id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by_actor_type TEXT NOT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_download_tokens_hash ON download_tokens (token_hash);
CREATE INDEX idx_download_tokens_doc ON download_tokens (document_id);
