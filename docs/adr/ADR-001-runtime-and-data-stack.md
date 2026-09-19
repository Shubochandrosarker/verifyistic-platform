# ADR-001 — Runtime and Data Stack

**Status:** accepted (2026-09-19)
**Supersedes:** open questions "final framework/language for central API", "initial compute location" (doc 25 §2)
**Date:** 2026-09-19

## Context

The project docs left the runtime/stack open (doc 25 §2). Constraints that drive the decision:

- Cloud artifacts must live in private Cloudflare R2 (decided, doc 25 D3).
- Self-hosted must run on customer infrastructure via Docker Compose with zero cloud dependency for core signing (doc 12).
- Cloud and self-hosted share one domain model and as much application logic as possible (doc 03 §1, golden rule 1).
- The operator's existing live infrastructure is already Cloudflare-centric (api gateway + dashboard SPA deployed as Workers; 13 zones / 26 workers in the org) and cost-sensitive.
- PDF rendering needs a real HTML engine (Chromium) which cannot run inside a Worker (doc 08 §6).

## Decision

- **Language/framework:** TypeScript everywhere. **Hono** for HTTP (runs identically on Workers and Node). Runtime-agnostic domain packages — no Cloudflare SDK imports inside `packages/*` domain code (storage/PDF behind adapters per doc 03 §8–9).
- **Cloud edition:** Cloudflare Workers + **D1** (SQLite) + R2 + Queues + KV. Kysely as the query layer.
- **Self-hosted edition:** Node 22 containers (api + worker + dashboard/signer static) + **SQLite** database + local/S3/R2/MinIO storage + queue via the same worker process.
- **Migrations:** one portable SQL migration set written for the SQLite dialect, applied by the same runner on D1 (cloud) and libsql/better-sqlite3 (self-hosted).
- **PDF:** Chromium renderer runs as a dedicated container (self-hosted + initial cloud VPS worker) or Cloudflare Browser Rendering when adopted; `SimplePdfFallback` ships in-core. Never render customer HTML with network access (SSRF, doc 08 §6).
- **Metadata only in D1/SQLite.** Binaries (signed.pdf, certificate.pdf, signature.png, manifests) live in object storage per doc 04 rule 5.

## Alternatives considered

1. **PostgreSQL everywhere (doc 03's illustrative topology):** strongest general choice, but forces the operator to run/manage Postgres for the cloud edition too and splits the migration set from D1. Rejected for v1 economics; see revisit trigger.
2. **Hono + Postgres on Hostinger VPS for cloud:** matches doc 13 §3 as an "initial VPS deployment" option; rejected for v1 because the operator already runs a Cloudflare-native estate and D1 removes a server class. The VPS container stack remains the PDF-worker host.
3. **PHP (port sign-platform as-is):** largest reuse but ties cloud to WordPress runtime; contradicts D2 (central cloud API authoritative, WP is an integration client).

## Security impact

- D1/SQLite access is parameter-bound via Kysely (no string-concatenated SQL anywhere — enforced in review checklist).
- Secrets only via Worker bindings / runtime env — no secrets in wrangler.toml (template is placeholder-only).
- Fewer moving parts in cloud = smaller breach surface; the browser container is the main new attack surface and is network-restricted.

## Commercial impact

Lowest marginal cloud cost (Workers/D1/R2 free tiers + flat pricing) supports the transparent-pricing positioning; self-hosted gets a single-binary-friendly SQLite dependency (simpler install wizard step 2, doc 12 §5).

## Migration impact

One portable migration set; `migrations/` is the single source of truth — no hand-edited generated schema files.

## Revisit triggers

- D1 limits bind (per-org DB size / throughput for tenants at scale) → move cloud to Postgres (Neon/Supabase/Hyperdrive) behind the Kysely dialect — application code unchanged, migration set gains a Postgres variant.
- A self-hosted enterprise customer requires Postgres in-v1 scope → add dialect-split migrations at that point, not before.
