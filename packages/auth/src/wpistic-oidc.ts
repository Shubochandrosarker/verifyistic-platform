/**
 * WPistic SSO boundary (doc 06 §1): account.wpistic.com is the OIDC provider for the
 * cloud dashboard; Verifyistic consumes identity and maps it to organization membership.
 *
 * Phase 2 defines the contract and verifies the membership-mapping logic. The live OIDC
 * round-trip (discovery, authorization-code exchange, JWKS validation) activates when the
 * client is registered at api.wpistic.com — the flow below is the integration point and is
 * intentionally fail-closed: no session is issued without a verified ID token.
 */
import type { Role } from "./capabilities.js";

export interface WpisticOidcConfig {
	issuer: string; // e.g. https://account.wpistic.com
	clientId: string;
	/** Injected at runtime — never in config files or code (doc 06 §10). */
	clientSecret: string;
	redirectUri: string;
	scopes: string[]; // ["openid", "profile", "email"]
}

export interface WpisticIdentity {
	/** Stable WPistic account id — the organization_users.user_id. */
	userId: string;
	email: string;
	emailVerified: boolean;
	displayName: string | null;
}

export interface MembershipClaim {
	organizationId: string;
	role: Role;
	status: "active" | "invited" | "suspended" | "removed";
}

/**
 * Build the authorization-request URL. Only ever https (or http for explicit local dev).
 */
export function buildAuthorizationUrl(
	config: WpisticOidcConfig,
	state: string,
	nonce: string,
): string {
	const url = new URL("/authorize", config.issuer);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("WPistic OIDC issuer must be http(s)");
	}
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", config.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", config.scopes.join(" "));
	url.searchParams.set("state", state);
	url.searchParams.set("nonce", nonce);
	return url.toString();
}

/**
 * Map verified ID-token claims to the Verifyistic membership view.
 * Fail-closed: an identity without any active membership in the requested organization
 * yields an empty list — callers must treat that as "no access", never default to a role.
 */
export function mapMemberships(
	identity: WpisticIdentity,
	claims: MembershipClaim[],
): MembershipClaim[] {
	if (!identity.emailVerified) return [];
	return claims.filter((claim) => claim.status === "active");
}
