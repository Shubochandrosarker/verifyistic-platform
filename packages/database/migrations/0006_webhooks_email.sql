-- 0006_webhooks_email — Phase 6 (async platform).
-- Data model v1 §9: webhook endpoints + deliveries. Email outbox: DB-backed queue
-- (works identically on D1 and SQLite, doc 13 §6 discipline — unique job ids, bounded
-- retries, next-retry scheduling, dead-letter visibility).

CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  url TEXT NOT NULL,
  -- AES-256-GCM ciphertext of the per-endpoint signing secret (doc 06 §10)
  secret_ciphertext TEXT NOT NULL,
  -- JSON array of subscribed event types; ["*"] = all
  subscribed_events TEXT NOT NULL DEFAULT '["*"]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_webhook_endpoints_org ON webhook_endpoints (organization_id, status);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints (id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
  request_id TEXT,
  response_status INTEGER,
  next_retry_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (status, next_retry_at);
CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations (id),
  to_email TEXT NOT NULL,
  template TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_email_outbox_due ON email_outbox (status, next_attempt_at);
