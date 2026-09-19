# Versioning and Release Policy (Phase 1)

## Semantic version

`MAJOR.MINOR.PATCH` across the whole monorepo — packages release together (one product, two deployment modes).

- **MAJOR** — breaking API contract change (new `/v2`), irreversible schema change, license model change.
- **MINOR** — new features, additive API fields, new migrations.
- **PATCH** — bug fixes, security fixes, dependency bumps.

## Trunk and branches

- `main` is protected: required status checks (CI: lint, typecheck, test, secret scan), no force-push, no deletion.
- Feature work in short-lived `feat|fix|chore/<topic>` branches → PR → checks green → merge (doc 24 §12 commit style).
- Release branches `release/x.y` only when a hotfix stream is needed.

## Tags and releases

- Every release is tagged `vX.Y.Z` on `main` after staging smoke passes (doc 13 §7 pipeline).
- A release MUST ship (doc 17 §9): changelog, migration list, checksums, compatibility notes, rollback notes.
- Self-hosted customers default to the `stable` channel; `beta` is opt-in; `internal` never ships outside CI artifacts.

## Self-hosted major-version rule

A perpetual license covers the purchased MAJOR. A MAJOR release therefore requires: frozen `/v1` contract (or new version), expand/contract migration plan, and a documented downgrade path before announcement (doc 12 §6–7).
