# Data Model v1 (Phase 0)

Authoritative source: project doc `04-DATA-MODEL.md`. Records the frozen entity set, naming, and invariants for the migration set in `packages/database/migrations/`.

## Rules

1. Externally visible identifiers are UUIDs (`crypto.randomUUID()`), stored as TEXT.
2. Every cloud business record has `organization_id`; site-specific records add `site_id`.
3. Timestamps stored as ISO-8601 TEXT with timezone (UTC normalized).
4. Binaries in object storage only — DB stores `storage_key` + hashes + metadata.
5. Published template versions referenced by signed records are immutable.
6. All queries tenant-scoped; no `WHERE id = ?` without `organization_id`.

## Entities (snake_case)

| Table | Purpose / key columns beyond tenant + timestamps |
|---|---|
| `organizations` | name, slug, billing_email, timezone, default_retention_policy_id, status, metadata |
| `sites` | organization_id, name, domain, address, timezone, status, branding_config |
| `organization_users` | organization_id, user_id, role, status |
| `customers` | organization_id, primary_site_id, first/last name, email(_normalized), phone(_normalized), date_of_birth, address_json, status, source, external_ref |
| `customer_relationships` | customer_id, related_customer_id, relationship_type (guardian/minor), effective_from/to |
| `templates` | name, category, status, current_version_id, default_validity_days, guardian_policy_json, created_by |
| `template_versions` | template_id, version_number, title, document_schema_json, rendered_source_html, source_hash_sha256, consent_text_version, effective_from, requires_reconsent, published_at, immutable_at |
| `signing_sessions` | site_id, template_version_id, customer_id, status, token_hash, token_expires_at, token_revoked_at, delivery_method, requested_by, started/completed/declined/expires_at, metadata |
| `signing_participants` | session_id, customer_id, role (signer/guardian/witness/staff), email/phone snapshot, required, status, signed_at |
| `field_responses` | session_id, participant_id, field_key, field_type, value_json, value_hash |
| `signatures` | session_id, participant_id, method (drawn/typed), storage_key, signature_hash, typed_name, captured_at, ip, user_agent_safe_snapshot |
| `documents` | site_id, customer_id, session_id, template_version_id, status, document_number, signed_at, expires_at, storage_key_signed_pdf/certificate_pdf/manifest, signed_pdf_sha256, certificate_sha256, agreement_sha256, signature_set_sha256, audit_chain_hash, retention_until, legal_hold |
| `document_access_events` | document_id, actor_type, actor_id, action, ip |
| `audit_events` | entity_type, entity_id, event_type, actor_type, actor_id, canonical_payload_json, previous_hash, event_hash |
| `verification_policies` | site_id, name, minimum_age, mode, credential_ttl, identity_review_required |
| `verification_attempts` | customer_id, policy_id, status, method, dob_snapshot, provider, provider_reference, reviewer_id, reviewed_at |
| `identity_artifacts` | verification_attempt_id, artifact_type, storage_key, sha256, retention_until, status |
| `checkins` | site_id, customer_id, document_id, verification_attempt_id, staff_user_id, source, checked_in_at |
| `api_keys` | name, key_prefix, key_hash, scopes, site_restrictions, last_used_at, expires_at, revoked_at |
| `webhook_endpoints` | url, secret_ciphertext, subscribed_events, status |
| `webhook_deliveries` | endpoint_id, event_id, attempt, request_id, response_status, next_retry_at, delivered_at, error_summary |
| `imports` / `import_rows` | provider, status, totals_json, dry_run_report_json / source_ref, target_type, target_id, result, warning_code, source_hash |

## Indexes (minimum)

- customers: `(organization_id, email_normalized)`, `(organization_id, phone_normalized)`, `(organization_id, status)`
- documents: `(organization_id, status, signed_at)`, `(organization_id, customer_id)`
- signing_sessions: `(organization_id, status)`, unique `(token_hash)`
- audit_events: `(organization_id, entity_type, entity_id)`, `(organization_id, created_at)`
- api_keys: unique `(key_hash)`
- webhook_deliveries: `(endpoint_id, event_id, attempt)`

## Audit chain

```
event_hash = SHA256(previous_hash || canonical_json(event))
```

Canonical JSON = stable recursive key sort, no whitespace (implementation: `packages/core/src/canonical.ts`). One implementation only; tamper-evident, not magical immutability (doc 08 §5).

## Statuses

Signing session: `created, sent, viewed, in_progress, processing, completed, declined, cancelled, expired, failed` — transitions enforced by `packages/core/src/signing/status.ts` (mirrors doc 07 §2). `completed` is terminal for artifact content; void/revoke is separate metadata + audit.
