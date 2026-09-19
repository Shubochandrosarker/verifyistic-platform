# Reusable Code Inventory (Phase 0 deliverable)

Audited heads (verified 2026-09-19 via git ls-remote, both match doc 01):

- `Shubochandrosarker/verifyistic` @ `sign-platform` `f2d3fa7b5a0049520dc0b2895650cade130d9d63` — local reference clone: `~/.wpistic/verifyistic-ref/verifyistic-sign-platform`
- `Shubochandrosarker/Verifyistic-Advanced-Age-Verification-Plugin` @ `claude/verifyistic-v2-public-release-bjc15a` `95b76d2043480393c4adff9537819deb30f566e6` — local reference clone: `~/.wpistic/verifyistic-ref/verifyistic-plugin-v2`

## sign-platform → porting map (Phase 1+)

Port the *domain logic*, not the WP runtime coupling (doc 21 Phase 1: "do not blindly copy old architecture").

| sign-platform class | Port into | Notes |
|---|---|---|
| `class-verifyistic-signing-service.php` | `packages/signing` | session lifecycle, token creation/validation (hash-at-rest pattern already correct — preserve) |
| `class-verifyistic-template-service.php` | `packages/templates` | draft/publish/version; add immutability enforcement missing in WP impl |
| `class-verifyistic-document-service.php` | `packages/documents` | metadata/checksums port as-is; storage calls → StorageProvider |
| `class-verifyistic-api-keys.php` | `packages/auth` | hash/scope model → vfy_live_/vfy_test_ format |
| `class-verifyistic-audit.php` | `packages/audit` | add hash-chained events (canonical JSON) |
| `class-verifyistic-customers.php` | `packages/customers` | add normalization columns |
| `class-verifyistic-webhook(s).php` | `packages/webhooks` | HMAC + retry discipline from doc 05 §5 |
| `class-verifyistic-pdf-generator.php` | `packages/pdf` (fallback) | dependency-free renderer stays as SimplePdfFallback only (D4) |
| `class-verifyistic-rest-api.php` | `apps/api` routes | route shapes reusable; namespace moves `verifyistic/v1` → `/v1` |
| `class-verifyistic-schema.php` | `packages/database/migrations` | table definitions re-expressed per data model v1 |
| `class-verifyistic-otter-{import-service,matcher,schema}.php`, `pdf-migrator` | `integrations/imports` | direct port candidates for Phase 12 (keep tests) |
| `class-verifyistic-kiosk-service.php`, `waiver-service.php`, `notification-service.php` | apps/packages per phase | Phase 6–7 |
| `providers/class-verifyistic-native-signature-provider.php` | `packages/signing` | signature provider interface pattern carries over |
| `docs/otter_csv_validator.php`, tests (`test-otter-*`, `test-api-keys.php`, `test-pdf-generator.php`) | test suites | port expectations as TS tests |

## plugin v2 → preserve (do not regress)

HMAC age-verification credentials, policy fingerprint binding, identity upload state flow (uploaded → pending review → approved), reviewer requirement, SSRF defenses (redirect restrictions, A/AAAA validation), honeypot/timing/rate limits, trusted proxy handling, retention pruning, WP-CLI, WPistic SDK/entitlement integration (doc 01 §2). These live in `integrations/wordpress` lineage at Phase 9; the v2 branch stays the reference.

## Explicitly NOT reused

- WP-local `.htaccess` private storage (doc 01 §8) → StorageProvider + private R2.
- Any acceptance of an arbitrary age-gate cookie as waiver proof (never-do list).
- The current standalone signer template as final UX (redesign per doc 07 §4 / doc 19 §5).
