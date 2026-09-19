import { verifyAuditChain } from "@verifyistic/audit";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Cross-tenant authorization matrix (doc 16 §7) — the Phase 2 exit criterion.
 * For every protected resource: owner allowed, other organization denied,
 * key without scope denied, invalid/revoked key unauthorized.
 */
let world: TestWorld;
let orgA: SeededKey;
let orgB: SeededKey;
let siteA1: { id: string };
let siteB1: { id: string };

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
	orgB = await seedOrganization(world, "org_b", "range-b");

	const create = async (org: SeededKey, name: string) =>
		await (
			await authedRequest(world.app, "POST", "/v1/sites", org.keyRaw, { name })
		).json();
	siteA1 = ((await create(orgA, "Range A main")) as { data: { id: string } })
		.data;
	siteB1 = ((await create(orgB, "Range B main")) as { data: { id: string } })
		.data;
});

describe("authentication boundary", () => {
	it("rejects missing, malformed, and unknown bearer keys with 401", async () => {
		expect((await world.app.request("/v1/sites")).status).toBe(401);
		expect(
			(await authedRequest(world.app, "GET", "/v1/sites", "garbage")).status,
		).toBe(401);
		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					"/v1/sites",
					"vfy_live_skzsomerandomjunk00",
				)
			).status,
		).toBe(401);
		const body = (await (await world.app.request("/v1/sites")).json()) as {
			error: { code: string };
		};
		expect(body.error.code).toBe("unauthorized");
	});

	it("public health stays open without credentials", async () => {
		expect((await world.app.request("/v1/health")).status).toBe(200);
	});
});

describe("sites — cross-tenant matrix", () => {
	it("lists only the authenticated organization's sites", async () => {
		const resA = await authedRequest(
			world.app,
			"GET",
			"/v1/sites",
			orgA.keyRaw,
		);
		const listA = (await resA.json()) as { data: { id: string }[] };
		expect(listA.data.map((s) => s.id)).toEqual([siteA1.id]);

		const resB = await authedRequest(
			world.app,
			"GET",
			"/v1/sites",
			orgB.keyRaw,
		);
		const listB = (await resB.json()) as { data: { id: string }[] };
		expect(listB.data.map((s) => s.id)).toEqual([siteB1.id]);
	});

	it("cross-tenant GET/PATCH of a site reads as not-found (no existence leak)", async () => {
		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					`/v1/sites/${siteB1.id}`,
					orgA.keyRaw,
				)
			).status,
		).toBe(404);
		expect(
			(
				await authedRequest(
					world.app,
					"PATCH",
					`/v1/sites/${siteB1.id}`,
					orgA.keyRaw,
					{ name: "hijack" },
				)
			).status,
		).toBe(404);
		// B still sees its own site untouched.
		const own = await authedRequest(
			world.app,
			"GET",
			`/v1/sites/${siteB1.id}`,
			orgB.keyRaw,
		);
		expect(((await own.json()) as { data: { name: string } }).data.name).toBe(
			"Range B main",
		);
	});

	it("never trusts organization_id from the request body", async () => {
		const res = await authedRequest(
			world.app,
			"POST",
			"/v1/sites",
			orgA.keyRaw,
			{
				name: "Sneaky",
				organization_id: "org_b",
			},
		);
		const created = (await res.json()) as { data: { organization_id: string } };
		expect(created.data.organization_id).toBe("org_a");

		const bList = (await (
			await authedRequest(world.app, "GET", "/v1/sites", orgB.keyRaw)
		).json()) as {
			data: { id: string }[];
		};
		expect(bList.data).toHaveLength(1);
	});

	it("keys without the required scope are forbidden", async () => {
		const { record, raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "readonly", scopes: ["sites:read"] },
		);
		expect(
			(await authedRequest(world.app, "GET", "/v1/sites", raw)).status,
		).toBe(200);
		const write = await authedRequest(world.app, "POST", "/v1/sites", raw, {
			name: "Nope",
		});
		expect(write.status).toBe(403);
		expect(
			((await write.json()) as { error: { code: string } }).error.code,
		).toBe("forbidden");
	});
});

describe("api keys — cross-tenant matrix", () => {
	it("lists only own keys and never exposes key_hash", async () => {
		const res = await authedRequest(
			world.app,
			"GET",
			"/v1/api-keys",
			orgA.keyRaw,
		);
		const list = (await res.json()) as { data: Record<string, unknown>[] };
		expect(list.data).toHaveLength(1);
		expect(JSON.stringify(list.data)).not.toContain("key_hash");
	});

	it("cross-tenant delete/rotate read as not-found", async () => {
		expect(
			(
				await authedRequest(
					world.app,
					"DELETE",
					`/v1/api-keys/${orgB.keyId}`,
					orgA.keyRaw,
				)
			).status,
		).toBe(404);
		expect(
			(
				await authedRequest(
					world.app,
					"POST",
					`/v1/api-keys/${orgB.keyId}/rotate`,
					orgA.keyRaw,
				)
			).status,
		).toBe(404);
		// B's key still valid afterwards.
		expect(
			(await authedRequest(world.app, "GET", "/v1/api-keys", orgB.keyRaw))
				.status,
		).toBe(200);
	});

	it("revoked keys lose access immediately", async () => {
		await world.apiKeys.revoke(
			{ organizationId: "org_a", actor: { type: "api_key", id: orgA.keyId } },
			orgA.keyId,
		);
		expect(
			(await authedRequest(world.app, "GET", "/v1/sites", orgA.keyRaw)).status,
		).toBe(401);
	});

	it("a test key cannot mint a live key (no test-to-live escalation)", async () => {
		const { record, raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "ci", scopes: ["api_keys:write"], mode: "test" },
		);
		const res = await authedRequest(world.app, "POST", "/v1/api-keys", raw, {
			name: "escalate",
			scopes: ["sites:read"],
			mode: "live",
		});
		const created = (await res.json()) as {
			data: { key: string; key_prefix: string };
		};
		expect(record.key_prefix.startsWith("vfy_test_")).toBe(true);
		expect(created.data.key.startsWith("vfy_test_")).toBe(true);
	});
});

describe("organization + audit — cross-tenant matrix", () => {
	it("reads only the authenticated organization and its members", async () => {
		const org = (await (
			await authedRequest(world.app, "GET", "/v1/organization", orgA.keyRaw)
		).json()) as {
			data: { id: string };
		};
		expect(org.data.id).toBe("org_a");

		await world.repos.addMember(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{
				userId: "wp_user_1",
				role: "front_desk",
			},
		);
		const members = (await (
			await authedRequest(
				world.app,
				"GET",
				"/v1/organization/members",
				orgA.keyRaw,
			)
		).json()) as {
			data: { user_id: string }[];
		};
		expect(members.data.map((m) => m.user_id)).toEqual(["wp_user_1"]);
		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					"/v1/organization/members",
					orgB.keyRaw,
				)
			).json() as Promise<{ data: unknown[] }>,
		).resolves.toMatchObject({ data: [] });
	});

	it("audit events are tenant-scoped and the chain stays valid", async () => {
		const aEvents = (await (
			await authedRequest(world.app, "GET", "/v1/audit-events", orgA.keyRaw)
		).json()) as {
			data: { organization_id: string }[];
		};
		expect(aEvents.data.length).toBeGreaterThan(0);
		expect(
			aEvents.data.every((event) => event.organization_id === "org_a"),
		).toBe(true);

		const bEvents = (await (
			await authedRequest(world.app, "GET", "/v1/audit-events", orgB.keyRaw)
		).json()) as {
			data: { organization_id: string }[];
		};
		expect(
			bEvents.data.every((event) => event.organization_id === "org_b"),
		).toBe(true);

		expect(
			(
				await authedRequest(
					world.app,
					"GET",
					"/v1/audit-events",
					"vfy_live_none",
				)
			).status,
		).toBe(401);

		const { valid } = await verifyAuditChain(world.db, "org_a");
		expect(valid).toBe(true);
	});

	it("audit:read scope is enforced", async () => {
		const { raw } = await world.apiKeys.create(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{ name: "no-audit", scopes: ["sites:read"] },
		);
		expect(
			(await authedRequest(world.app, "GET", "/v1/audit-events", raw)).status,
		).toBe(403);
	});
});
