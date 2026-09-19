# ADR-002 — Monorepo Layout and Package Boundaries

**Status:** accepted (2026-09-19)
**Date:** 2026-09-19

## Context

Doc 03 §1 recommends a logical monorepo with domain packages. We need concrete tooling and boundary rules so domain logic stays runtime-agnostic (ADR-001) and the WordPress plugin stays a thin client (golden rule 2).

## Decision

pnpm workspaces, TypeScript project references later if build times demand. Layout follows doc 03 exactly:

```text
verifyistic-platform/
├── apps/
│   ├── api/          Hono app — api.verifyistic.com/v1 (cloud) + self-hosted API
│   ├── dashboard/    app.verifyistic.com (SPA; migrated from current Worker SPA)
│   ├── signer/       sign.verifyistic.com — hosted signer UI (mobile-first)
│   └── worker/       async jobs: PDF finalize, email, webhooks, imports, retention
├── packages/
│   ├── core/         ids, canonical hashing, error envelope, signing state machine, tokens
│   ├── database/     Kysely schema types + portable migrations (single source of truth)
│   ├── auth/         API keys, WPistic SSO client, local accounts (Phase 2)
│   ├── tenancy/      tenant-scoped repository base; org context required (Phase 2)
│   ├── customers/    customers, relationships (Phase 3)
│   ├── templates/    templates, versions, publish/immutability (Phase 3)
│   ├── signing/      sessions, participants, responses, consent, completion txn (Phase 4)
│   ├── documents/    documents, manifests, audit chain, verification page data (Phase 5)
│   ├── audit/        append-only audit events (Phase 2+)
│   ├── storage/      StorageProvider interface + Local/S3/R2/MinIO implementations (Phase 5)
│   ├── pdf/          PdfRenderer interface; Chromium renderer + simple fallback (Phase 5)
│   ├── webhooks/     endpoints, deliveries, HMAC signing, retries (Phase 6/8)
│   ├── firearms/     range presets: template library, field blocks (Phase 3/7)
│   └── sdk/          TS SDK after the v1 contract stabilizes (Phase 8)
├── integrations/
│   ├── wordpress/    plugin connector (existing v2 security work preserved, Phase 9)
│   ├── woocommerce/
│   └── imports/      Otter/Smartwaiver/CSV importers (Phase 12)
└── deployments/
    ├── cloud/        wrangler configs per environment (staging/production)
    └── self-hosted/  Docker Compose, install wizard assets
```

Boundary rules:

1. `packages/*` never import Cloudflare/Node-specific SDKs. Bindings/injection happen in `apps/*`.
2. Cross-package imports go through the package's public entry (`src/index.ts`) only.
3. Every domain package owns its tests; integration tests live in the owning app.
4. `packages/database/migrations/` is the only place schema is defined. Generated schema types are produced from migrations — never edited directly.
5. The WordPress plugin lives in `integrations/wordpress/` and talks only to the public API — it must not embed core domain logic.

## Security impact

Boundary rule 1 keeps audit scope small: only `apps/*` and `packages/storage`/`packages/pdf` touch external systems. Tenant enforcement (rule: all repositories require organization context) lives in `packages/tenancy`, so it cannot be bypassed package-by-package.

## Commercial impact

One repo, one CI, shared versioning; integration clients version independently at release time.

## Migration impact

Phase 1 ports sign-platform domain logic into `packages/signing`/`packages/templates` following these boundaries (see `docs/REUSABLE-CODE-INVENTORY.md`).
