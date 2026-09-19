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
- [ ] **Phase 3** — Customers & templates (template schema, draft/publish/version immutability, re-consent, builder MVP)
- [ ] Phase 4–14 — per `21-IMPLEMENTATION-ROADMAP.md`
