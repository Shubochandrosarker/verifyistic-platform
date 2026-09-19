import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import { ApiKeyService } from "../src/api-keys.js";
import {
	ROLES,
	type Role,
	capabilitiesForRole,
	hasCapability,
} from "../src/capabilities.js";
import {
	SCOPES,
	type Scope,
	hasScopes,
	isScope,
	parseScopes,
} from "../src/scopes.js";
import { buildAuthorizationUrl, mapMemberships } from "../src/wpistic-oidc.js";

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "system", id: "seed" },
};
const orgB: TenantContext = {
	organizationId: "org_b",
	actor: { type: "system", id: "seed" },
};

describe("scopes", () => {
	it("recognizes known scopes and rejects unknown ones (fail-closed parsing)", () => {
		expect(isScope("sites:read")).toBe(true);
		expect(isScope("org:delete-everything")).toBe(false);
		expect(parseScopes('["sites:read","bogus:scope"]')).toEqual(["sites:read"]);
		expect(parseScopes("not json")).toEqual([]);
		expect(parseScopes('{"a":1}')).toEqual([]);
	});

	it("requires every requested scope", () => {
		const granted: Scope[] = ["sites:read", "sites:write"];
		expect(hasScopes(granted, ["sites:read"])).toBe(true);
		expect(hasScopes(granted, ["sites:read", "audit:read"])).toBe(false);
	});
});

describe("role → capability matrix (doc 06 §2)", () => {
	it("owner holds every capability", () => {
		for (const capability of [
			"org:manage",
			"api_keys:manage",
			"retention:manage",
		] as const) {
			expect(hasCapability("owner", capability)).toBe(true);
		}
		expect(capabilitiesForRole("owner")).toHaveLength(11);
	});

	it("auditor is read-only", () => {
		expect(hasCapability("auditor", "audit:read")).toBe(true);
		expect(hasCapability("auditor", "templates:manage")).toBe(false);
		expect(hasCapability("auditor", "checkin:use")).toBe(false);
	});

	it("front desk can check in but not manage api keys", () => {
		expect(hasCapability("front_desk", "checkin:use")).toBe(true);
		expect(hasCapability("front_desk", "api_keys:manage")).toBe(false);
	});

	it("every defined role resolves the capability engine", () => {
		for (const role of ROLES) {
			expect(capabilitiesForRole(role as Role).length).toBeGreaterThan(0);
		}
	});
});

describe("ApiKeyService", () => {
	/** api_keys.organization_id references organizations — seed the parents like production data. */
	async function makeService(now?: () => Date) {
		const db = await createInMemoryDatabase();
		await db
			.insertInto("organizations")
			.values(
				["org_a", "org_b"].map((id) => ({
					id,
					name: `Org ${id}`,
					slug: id,
					billing_email: null,
					timezone: "UTC",
					default_retention_policy_id: null,
					status: "active" as const,
					metadata: null,
					created_at: "2026-09-19T00:00:00Z",
					updated_at: "2026-09-19T00:00:00Z",
				})),
			)
			.execute();
		return { db, service: new ApiKeyService(db, { now }) };
	}

	it("creates a vfy_live_ key, verifies it by raw value, and never stores the raw secret", async () => {
		const { service } = await makeService();
		const { record, raw } = await service.create(orgA, {
			name: "integration",
			scopes: ["sites:read", "sites:write"],
		});

		expect(raw).toMatch(/^vfy_live_[A-Za-z0-9]{32}$/);
		expect(record.key_prefix).toMatch(/^vfy_live_[A-Za-z0-9]{8}$/);
		expect(JSON.stringify(record)).not.toContain(raw);
		expect(record.key_prefix).not.toBe(raw.slice(0, raw.length));

		const verified = await service.verify(raw);
		expect(verified?.id).toBe(record.id);
		expect(verified?.organization_id).toBe("org_a");
	});

	it("rejects garbage, wrong-hash, revoked, and expired keys", async () => {
		let now = new Date("2026-09-19T12:00:00Z");
		const { service } = await makeService(() => now);
		const { raw } = await service.create(orgA, {
			name: "k",
			scopes: ["sites:read"],
			expiresInDays: 1,
		});

		expect(await service.verify("not-a-key")).toBeUndefined();
		expect(
			await service.verify("vfy_live_totallywrongvalue0000"),
		).toBeUndefined();

		// Expired: advance the clock past expires_in_days.
		now = new Date("2026-09-25T12:00:00Z");
		expect(await service.verify(raw)).toBeUndefined();

		// Revoked: create another, revoke it, expect verification to fail.
		now = new Date("2026-09-19T12:00:00Z");
		const second = await service.create(orgA, {
			name: "k2",
			scopes: ["sites:read"],
		});
		await service.revoke(orgA, second.record.id);
		expect(await service.verify(second.raw)).toBeUndefined();
		expect(
			(await service.get(orgA, second.record.id))?.revoked_at,
		).not.toBeNull();
	});

	it("is tenant-enforced: another organization's key id is invisible", async () => {
		const { service } = await makeService();
		const { record } = await service.create(orgA, {
			name: "a",
			scopes: ["sites:read"],
		});

		expect(await service.get(orgB, record.id)).toBeUndefined();
		expect(await service.revoke(orgB, record.id)).toBeUndefined();
		expect(await service.rotate(orgB, record.id)).toBeUndefined();
		// Org A still works on its own key.
		expect(await service.get(orgA, record.id)).toBeDefined();
		expect(await service.list(orgB)).toHaveLength(0);
		expect(await service.list(orgA)).toHaveLength(1);
	});

	it("rotate revokes the old key and issues a fresh raw secret with the same scopes", async () => {
		const { service } = await makeService();
		const { record, raw } = await service.create(orgA, {
			name: "rotating",
			scopes: ["sites:read", "audit:read"],
		});

		const rotated = await service.rotate(orgA, record.id);
		expect(rotated).toBeDefined();
		expect(rotated!.raw).not.toBe(raw);
		expect(rotated!.record.id).not.toBe(record.id);
		expect(await service.verify(raw)).toBeUndefined();
		expect(await service.verify(rotated!.raw)).toBeDefined();
	});
});

describe("wpistic oidc boundary", () => {
	it("builds an https authorization url with required params", () => {
		const url = buildAuthorizationUrl(
			{
				issuer: "https://account.wpistic.com",
				clientId: "vfy-dashboard",
				// The secret is never used by URL building and is always injected at runtime.
				clientSecret: process.env.WPISTIC_CLIENT_SECRET ?? "",
				redirectUri: "https://app.verifyistic.com/auth/callback",
				scopes: ["openid", "profile", "email"],
			},
			"state-123",
			"nonce-456",
		);
		expect(url.startsWith("https://account.wpistic.com/authorize?")).toBe(true);
		expect(url).toContain("response_type=code");
		expect(url).toContain("state=state-123");
	});

	it("rejects non-http(s) issuers", () => {
		expect(() =>
			buildAuthorizationUrl(
				{
					issuer: "file:///etc/passwd",
					clientId: "x",
					clientSecret: "x",
					redirectUri: "https://x",
					scopes: ["openid"],
				},
				"s",
				"n",
			),
		).toThrow(/http\(s\)/);
	});

	it("maps memberships fail-closed: unverified email or inactive membership grants nothing", () => {
		const identity = {
			userId: "wp_1",
			email: "a@b.c",
			emailVerified: true,
			displayName: "A",
		};
		const claims = [
			{
				organizationId: "org_a",
				role: "admin" as const,
				status: "active" as const,
			},
			{
				organizationId: "org_b",
				role: "owner" as const,
				status: "suspended" as const,
			},
		];
		expect(mapMemberships(identity, claims)).toEqual([claims[0]]);

		const unverified = { ...identity, emailVerified: false };
		expect(mapMemberships(unverified, claims)).toEqual([]);
	});
});
