-- 0009_billing_launch — Phases 10/11 (billing entitlements + license distribution).
-- entitlements: Paddle webhook results, keyed by organization (from checkout
-- custom_data.organization_id) with paddle ids for reconciliation (doc 14 §9).
-- licenses: self-hosted perpetual license keys (HMAC-signed, doc 06 §7; Ed25519
-- upgrade tracked) gating the licensed plugin download in R2.

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  paddle_customer_id TEXT NOT NULL,
  paddle_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_end TEXT,
  source TEXT NOT NULL DEFAULT 'paddle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_entitlements_org ON entitlements (organization_id, status);
CREATE INDEX idx_entitlements_paddle_customer ON entitlements (paddle_customer_id);

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  plan TEXT NOT NULL,
  license_key_hash TEXT NOT NULL,
  license_key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  seats TEXT,
  issued_to_email TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_licenses_key_hash ON licenses (license_key_hash);
CREATE INDEX idx_licenses_org ON licenses (organization_id);
