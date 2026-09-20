-- 0010_auth — dashboard signup/login (email + password, PBKDF2).
-- One dashboard user per email; owner of exactly one organization (v1).

CREATE TABLE dashboard_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_dashboard_users_email ON dashboard_users (email);
