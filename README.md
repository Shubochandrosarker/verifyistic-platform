# Verifyistic Platform

Digital waivers, age verification, e-signatures, and check-in — built for shooting ranges first, vertical-neutral by design.

One domain model, two deployment modes:

| Mode | Compute | Database | Storage | Identity |
|---|---|---|---|---|
| **Cloud** | Cloudflare Workers (Hono) | Cloudflare D1 | Cloudflare R2 (private) | WPistic SSO |
| **Self-Hosted** | Node 22 (Docker Compose) | SQLite (Postgres later) | Local / S3 / R2 / MinIO | Local accounts (Argon2id) |

## Layout

```text
apps/           Deployable applications (api, dashboard, signer, worker)
packages/       Shared domain modules (core, database, storage, ...)
integrations/   WordPress / WooCommerce / import clients
deployments/    Environment configs (cloud wrangler, self-hosted compose)
docs/           ADRs and contracts (route contract, data model)
```

Full blueprint: `~/.wpistic/verifyistic-complete-project-docs/verifyistic-project-docs/`
(README, 01-CURRENT-STATE-AUDIT, … 24-CODING-AGENT-INSTRUCTIONS, 21-IMPLEMENTATION-ROADMAP).

## Golden rules (from project docs)

1. Cloud API (`api.verifyistic.com/v1`) is authoritative for cloud records.
2. Signed legal artifacts are immutable — never rewrite a completed document.
3. Every business record carries `organization_id`; every query is tenant-scoped.
4. Signer tokens: ≥256-bit, stored hashed, expiring, revocable — raw token never logged or stored.
5. R2/document buckets are private; downloads are authorized + short-lived.
6. No universal legal-compliance claims; no NICS/bound-book/4473 scope in v1.

## Commands

```bash
pnpm install
pnpm lint        # Biome — lint + format
pnpm typecheck   # all workspaces
pnpm test        # vitest across packages
pnpm migrate     # apply migrations to local/dev.db (node:sqlite; Node >= 22.13)
pnpm dev:api     # API on http://localhost:8787/v1/health
```

Requires Node >= 22.13 (node:sqlite) and pnpm 11 (Corepack).

## Phase status

- [x] **Phase 0** — Architecture freeze: ADRs, layout, data model v1, route contract, naming map
- [x] **Phase 1** — Foundation: migration framework + CLI (checksum-locked journal), Biome coding standards, CI (lint/typecheck/test/secret-scan), local dev run verified, env templates, compose preview, versioning policy
- [x] **Phase 2** — Tenancy & authentication: organizations/sites/memberships, tenant-scoped repositories, API keys (`vfy_live_`/`vfy_test_`, hash-at-rest, scopes), role→capability presets, hash-chained audit events, WPistic SSO boundary, cross-tenant authorization matrix green
- [x] **Phase 3** — Customers & templates: customer records with normalized contact columns + guardian relationships (cursor-paginated), structured block schema with validation, draft→publish→**immutable version** engine with re-consent flags, firearm range preset library
- [x] **Phase 4** — Signing engine: secure sessions, 256-bit signer tokens (hash-at-rest), token-authed `/v1/sign/{token}` transport with rate limiting, hosted signer page at `/s/{token}`, server-side field/conditional/consent validation, drawn + typed signatures, server-side guardian branch (DOB × policy), decline/cancel/expiry, **idempotent completion transaction**
- [x] **Phase 5** — Document evidence: private storage adapters (local + R2 binding + S3-compatible, contract-tested), evidence snapshot, in-core fallback PDF (Chromium seam ready), audit certificate with **non-circular hashes**, manifest, hash-verified artifacts, short-lived authorized downloads, void-without-rewrite, public `/verify/{uuid}` page
- [x] **Phase 6** — Async platform: DB-backed job queues (D1/SQLite portable), webhook engine (SSRF-guarded endpoints, AES-GCM secrets at rest, HMAC-SHA256 delivery, bounded backoff → dead-letter), email outbox + sender adapter, worker app (`apps/worker`: pdf-finalize, webhook pump, email pump, expiry sweeper) — finalization moved out of the request path
- [x] **Phase 7** — Range operations: check-in search with **status card** (age / waiver currency / re-consent / guardian / attention flags), same-day idempotent check-ins, kiosk source support, QR targets (public, PII-free) for walk-in waiver starts
- [x] **Phase 8** — Public API: OpenAPI 3.1 contract at `/v1/openapi.json` + human `/v1/docs`, **Idempotency-Key** framework (replay + conflict) on create endpoints, per-key rate limits (reads 300/min, writes 120/min), `@verifyistic/sdk` (typed client + webhook signature helper), webhook fanout (`signing_session.created/completed`, `document.generated`) — exit proven: third-party SDK integration receives HMAC-valid completion webhooks
- [x] **Phase 9** — WordPress: **Verifyistic Connector** plugin (`integrations/wordpress/verifyistic-connector`) — site-scoped server-side credentials with **API-enforced site restrictions** (single-site keys auto-stamp `site_id`; foreign sites → 403), settings page with masked secrets + connection test, HMAC webhook receiver (10-min replay window, event dedupe, `verifyistic_document_completed`/`verifyistic_status_changed` actions), idempotent user waiver flow + status shortcode, WooCommerce category checkout guard. Live-proven against the local WP bench + staging API (signed delivery ✓, dedupe ✓, tamper 401 ✓)
- [ ] **Phase 10** — Self-hosted packaging: hardened compose, install wizard, license certificate, backup/restore
- [ ] Phase 11–14 — per `21-IMPLEMENTATION-ROADMAP.md`
