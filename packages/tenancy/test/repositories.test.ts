import { createInMemoryDatabase } from "@verifyistic/database/testing";
import { describe, expect, it } from "vitest";
import {
	type TenantContext,
	TenantRepositories,
	requireTenant,
} from "../src/index.js";

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "system", id: "seed" },
};
const orgB: TenantContext = {
	organizationId: "org_b",
	actor: { type: "system", id: "seed" },
};

async function makeRepos() {
	const db = await createInMemoryDatabase();
	await db
		.insertInto("organizations")
		.values([
			{
				id: "org_a",
				name: "Range A",
				slug: "range-a",
				billing_email: null,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active",
				metadata: null,
				created_at: "2026-09-19T00:00:00Z",
				updated_at: "2026-09-19T00:00:00Z",
			},
			{
				id: "org_b",
				name: "Range B",
				slug: "range-b",
				billing_email: null,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active",
				metadata: null,
				created_at: "2026-09-19T00:00:00Z",
				updated_at: "2026-09-19T00:00:00Z",
			},
		])
		.execute();
	return { db, repos: new TenantRepositories(db) };
}

describe("TenantRepositories — tenant scoping", () => {
	it("creates sites under the context organization, regardless of any body-supplied org", async () => {
		const { repos } = await makeRepos();
		const site = await repos.createSite(orgA, { name: "Main Range" });
		expect(site.organization_id).toBe("org_a");
	});

	it("lists and reads only the context organization's sites", async () => {
		const { repos } = await makeRepos();
		const siteA = await repos.createSite(orgA, { name: "A site" });
		await repos.createSite(orgB, { name: "B site" });

		const aSites = await repos.listSites(orgA);
		expect(aSites.map((s) => s.id)).toEqual([siteA.id]);

		// Cross-tenant read is indistinguishable from missing.
		expect(await repos.getSite(orgA, siteA.id)).toBeDefined();
		expect(await repos.getSite(orgB, siteA.id)).toBeUndefined();
	});

	it("updates and deletes only within the context organization", async () => {
		const { repos } = await makeRepos();
		const siteA = await repos.createSite(orgA, { name: "A site" });
		const siteB = await repos.createSite(orgB, { name: "B site" });

		expect(
			await repos.updateSite(orgB, siteA.id, { name: "hijacked" }),
		).toBeUndefined();
		expect((await repos.getSite(orgA, siteA.id))!.name).toBe("A site");

		expect(
			(await repos.updateSite(orgA, siteA.id, { name: "Renamed" }))!.name,
		).toBe("Renamed");
		expect(
			await repos.updateSite(orgA, siteB.id, { name: "x" }),
		).toBeUndefined();
	});

	it("memberships are scoped: B cannot read, role-change or remove A's members", async () => {
		const { repos } = await makeRepos();
		await repos.addMember(orgA, { userId: "wp_user_1", role: "admin" });
		await repos.addMember(orgB, { userId: "wp_user_2", role: "front_desk" });

		expect((await repos.listMembers(orgA)).map((m) => m.user_id)).toEqual([
			"wp_user_1",
		]);
		expect(await repos.getMember(orgB, "wp_user_1")).toBeUndefined();
		expect(
			await repos.updateMemberRole(orgB, "wp_user_1", "auditor"),
		).toBeUndefined();
		expect(await repos.removeMember(orgB, "wp_user_1")).toBe(false);

		expect((await repos.getMember(orgA, "wp_user_1"))!.role).toBe("admin");
		expect(await repos.removeMember(orgA, "wp_user_1")).toBe(true);
	});

	it("organization reads are locked to the context organization", async () => {
		const { repos } = await makeRepos();
		expect((await repos.getOrganization(orgA))!.slug).toBe("range-a");
		expect((await repos.getOrganization(orgB))!.slug).toBe("range-b");
	});

	it("requireTenant throws on missing context", () => {
		expect(() => requireTenant(undefined)).toThrow(
			/Tenant context is required/,
		);
		expect(() =>
			requireTenant({ organizationId: "", actor: { type: "system", id: "x" } }),
		).toThrow();
	});
});
