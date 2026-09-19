# ADR-003 — Authentication, Tenancy, and Authorization Model

**Status:** accepted (2026-09-19)
**Date:** 2026-09-19

## Context

Doc 06 defines the requirements; two auth surfaces (cloud, self-hosted) and three credential types (dashboard user, API key, signer token) must coexist. Cross-tenant leakage is risk R3 (doc 25) and a P0 launch blocker.

## Decision

### Cloud dashboard identity
WPistic is the identity provider: OIDC from `account.wpistic.com` → Verifyistic session → organization membership + product-role claims. Verifyistic never trusts a client-supplied `organization_id` (doc 24 "never do"); the effective organization comes from the authenticated session's membership, or the API key's owning organization.

### API keys
Format `vfy_live_<prefix><secret>` / `vfy_test_<prefix><secret>`. At rest: SHA-256 hash of the full key, display prefix, scopes, optional site restrictions, expiry, last-used, revoked-at. Raw secret shown exactly once at creation. Requests authenticate via `Authorization: Bearer`.

### Signer tokens
32 random bytes (256-bit), base64url in the URL `sign.verifyistic.com/s/{token}`. Stored only as SHA-256 hash with expiry + revocation. Constant-time comparison. Signer routes are token-authenticated, aggressively rate-limited, strict `Referrer-Policy: no-referrer`, no third-party scripts.

### Roles → capabilities
Roles from doc 06 §2 (Owner, Admin, Compliance Manager, Front Desk, Template Manager, Auditor/Viewer, Developer) are presets mapped to capability strings. Authorization checks capabilities, not role names.

### Tenant enforcement mechanism
- Every business table carries `organization_id` (and `site_id` where meaningful) — data model v1.
- Repository layer requires a `TenantContext` (organization id + actor) argument; there is no repository API that queries "by id only".
- Service handlers derive TenantContext from auth, never from the request body.
- Automated adversarial test matrix (doc 16 §7) runs per protected resource: other-org denial, role denial, scope denial, cross-tenant API-key denial.

### Self-hosted
Local accounts: Argon2id password hashing, secure session cookies, CSRF protection, login rate limiting/backoff, optional MFA for admins, permission-change audit events. Works with zero WPistic connectivity; OIDC/SAML is a later enterprise add-on.

### Licensing (separate from auth)
Cloud entitlements from WPistic/Paddle; self-hosted perpetual = signed license certificate verified with an embedded public key only. Licensing can gate updates/support/add-ons, never historical document access (doc 06 §8–9).

## Alternatives considered

- Single shared auth service for both editions — rejected: self-hosted must survive outages of any external identity provider.
- JWT-only dashboard sessions — rejected for v1: OIDC code flow + server session gives simpler revocation for a staff-facing product.
- Row-level-security-enforced tenancy — deferred: repository-level enforcement is testable now; RLS is a defense-in-depth add-on once the dialect story settles.

## Security impact

This ADR is the primary control for R3. Consequences: no endpoint may read `organization_id` from request payloads; all audit events record actor + organization; API keys never appear in logs (prefix only); signer tokens never logged (hash id only).

## Commercial impact

WPistic SSO keeps one account system across products (Shuvo's ecosystem); self-hosted local auth is a hard requirement of the perpetual-license promise.

## Migration impact

Existing sign-platform WP REST API keys migrate via the importer (Phase 12); plugin v2 site credentials map to site-scoped API keys (doc 06 §5).
