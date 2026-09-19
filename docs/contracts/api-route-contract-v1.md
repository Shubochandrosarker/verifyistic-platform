# API Route Contract v1 (Phase 0)

Authoritative source: project doc `05-API-SPECIFICATION.md`. This file records the frozen v1 surface for implementation and OpenAPI generation. Base: `https://api.verifyistic.com/v1`.

## Conventions

- Auth: `Authorization: Bearer vfy_live_...|vfy_test_...` (dashboard: WPistic session/cookie).
- Success envelope: `{"data": ..., "meta": {"request_id": "req_..."}}`.
- Error envelope: `{"error": {"code", "message", "fields?", "request_id"}}`.
- Codes: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `idempotency_conflict`, `internal_error`.
- Cursor pagination (`limit`, `after` → `next_cursor`, `has_more`) on all growing collections.
- `Idempotency-Key` required on: create signing session, customer create-from-booking, check-in writes, import commit, provisioning writes. Reuse with a different request fingerprint → `idempotency_conflict`.
- Rate limits (initial): health 60/min/key, reads 300/min/key, writes 120/min/key, signer token routes adaptive per IP+token.

## Routes

```text
GET    /health

GET    /sites                         POST /sites                GET|PATCH /sites/{id}

GET    /customers                     POST /customers
GET    /customers/{id}                PATCH /customers/{id}
GET    /customers/{id}/documents      GET /customers/{id}/verifications
GET    /customers/{id}/checkins

GET    /templates                     POST /templates
GET    /templates/{id}                PATCH /templates/{id}
POST   /templates/{id}/versions       GET  /templates/{id}/versions
GET    /templates/{id}/versions/{version_id}
POST   /templates/{id}/versions/{version_id}/publish
POST   /templates/{id}/archive        # published versions are immutable once referenced

GET    /signing-sessions              POST /signing-sessions
GET    /signing-sessions/{id}
POST   /signing-sessions/{id}/resend  POST /signing-sessions/{id}/cancel
POST   /signing-sessions/{id}/expire

# token-authenticated, rate-limited, no-referrer
GET    /sign/{token}/session
POST   /sign/{token}/progress
POST   /sign/{token}/complete
POST   /sign/{token}/decline

GET    /documents                     GET  /documents/{id}
POST   /documents/{id}/download-token          # short-lived, authorized
GET    /documents/{id}/certificate
GET    /documents/{id}/audit-events
POST   /documents/{id}/void                     # status/audit only, never rewrites bytes

GET    /checkin/search?q=             POST /checkins    GET /checkins

POST   /verifications                 GET  /verifications/{id}
POST   /verifications/{id}/submit     POST /verifications/{id}/approve
POST   /verifications/{id}/reject

GET    /api-keys                      POST /api-keys
DELETE /api-keys/{id}                 POST /api-keys/{id}/rotate

GET    /webhooks                      POST /webhooks
PATCH  /webhooks/{id}                 DELETE /webhooks/{id}
GET    /webhooks/{id}/deliveries      POST /webhooks/{id}/deliveries/{delivery_id}/retry

POST   /imports                       POST /imports/{id}/dry-run
GET    /imports/{id}/report           POST /imports/{id}/commit
```

## Webhooks

Headers: `Verifyistic-Event-ID: evt_...`, `Verifyistic-Timestamp`, `Verifyistic-Signature: v1=<hmac_sha256(secret, timestamp + "." + raw_body)>`. Receivers verify timestamp window + dedupe event ID.

Events: `signing_session.created|viewed|completed|declined`, `document.generated|voided`, `verification.approved|rejected`, `checkin.created`.

## OpenAPI

`openapi.json` is generated/tested in CI from this contract once Phase 2 endpoints exist; it becomes the product contract (additive changes only within v1).
