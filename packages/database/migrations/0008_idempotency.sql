-- 0008_idempotency — Phase 8 (public API).
-- Idempotency-Key replay store (doc 05 §6): key + request fingerprint + stored response.
-- Same key + same fingerprint → replay stored response; same key + different
-- fingerprint → 409 idempotency_conflict. Keys expire after 24h.

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_idempotency_org_key ON idempotency_keys (organization_id, idempotency_key, method, path);
CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
