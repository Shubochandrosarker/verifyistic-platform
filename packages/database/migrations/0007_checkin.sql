-- 0007_checkin — Phase 7 (range operations).
-- checkins: one per customer per day per organization (unique index = natural
-- idempotency for retrying check-in writes, doc 15 §11). qr_targets map printed
-- QR codes to a business/template — codes are random, never contain customer PII
-- (doc 11 §7).

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  site_id TEXT REFERENCES sites (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  document_id TEXT REFERENCES documents (id),
  source TEXT NOT NULL DEFAULT 'front_desk' CHECK (source IN ('front_desk', 'kiosk', 'api', 'qr')),
  checked_in_at TEXT NOT NULL,
  checked_in_date TEXT NOT NULL,
  staff_actor_type TEXT NOT NULL,
  staff_actor_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_checkins_org_customer_date ON checkins (organization_id, customer_id, checked_in_date);
CREATE INDEX idx_checkins_org_date ON checkins (organization_id, checked_in_date);

CREATE TABLE qr_targets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  site_id TEXT REFERENCES sites (id),
  template_id TEXT NOT NULL REFERENCES templates (id),
  code TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_qr_targets_code ON qr_targets (code);
