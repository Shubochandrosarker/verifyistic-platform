import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import { CustomersRepository } from "../src/customers.js";
import { normalizeEmail, normalizePhone } from "../src/normalize.js";

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
				created_at: "2026-09-20T00:00:00Z",
				updated_at: "2026-09-20T00:00:00Z",
			})),
		)
		.execute();
	return { db, repos: new CustomersRepository(db) };
}

describe("contact normalization", () => {
	it("email: trims, lowercases, rejects junk", () => {
		expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe(
			"jane.doe@example.com",
		);
		expect(normalizeEmail("not-an-email")).toBeNull();
		expect(normalizeEmail("has space@x.com")).toBeNull();
		expect(normalizeEmail("")).toBeNull();
		expect(normalizeEmail(null)).toBeNull();
	});

	it("phone: digits with optional leading +", () => {
		expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
		expect(normalizePhone("555-123-4567")).toBe("5551234567");
		expect(normalizePhone("abc")).toBeNull();
		expect(normalizePhone(null)).toBeNull();
	});
});

describe("CustomersRepository — tenant scoping", () => {
	it("stores normalized columns and creates under the context organization", async () => {
		const { repos } = await makeRepos();
		const customer = await repos.create(orgA, {
			firstName: "Jane",
			lastName: "Doe",
			email: "  Jane.Doe@Example.COM ",
			phone: "+1 (555) 123-4567",
		});
		expect(customer.organization_id).toBe("org_a");
		expect(customer.email_normalized).toBe("jane.doe@example.com");
		expect(customer.phone_normalized).toBe("+15551234567");
	});

	it("cross-tenant ids read as missing; email matching is org-scoped", async () => {
		const { repos } = await makeRepos();
		const a = await repos.create(orgA, {
			firstName: "A",
			lastName: "One",
			email: "shared@example.com",
		});
		await repos.create(orgB, {
			firstName: "B",
			lastName: "Two",
			email: "shared@example.com",
		});

		expect(await repos.get(orgB, a.id)).toBeUndefined();
		expect((await repos.findByEmail(orgA, "SHARED@example.com"))!.id).toBe(
			a.id,
		);
		expect(
			(await repos.findByEmail(orgB, "shared@example.com"))!.organization_id,
		).toBe("org_b");
	});

	it("update re-normalizes contact columns and is tenant-scoped", async () => {
		const { repos } = await makeRepos();
		const a = await repos.create(orgA, {
			firstName: "A",
			lastName: "One",
			email: "a@x.com",
		});
		await repos.create(orgB, { firstName: "B", lastName: "Two" });

		expect(
			await repos.update(orgB, a.id, { firstName: "Hijacked" }),
		).toBeUndefined();
		const updated = (await repos.update(orgA, a.id, {
			email: "New@X.com",
			status: "inactive",
		}))!;
		expect(updated.email_normalized).toBe("new@x.com");
		expect(updated.status).toBe("inactive");
	});

	it("cursor pagination returns next_cursor/has_more without unbounded lists", async () => {
		const { repos } = await makeRepos();
		for (let i = 0; i < 7; i++) {
			await repos.create(orgA, { firstName: `C${i}`, lastName: "Test" });
		}

		const page1 = await repos.list(orgA, { limit: 3 });
		expect(page1.items).toHaveLength(3);
		expect(page1.hasMore).toBe(true);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await repos.list(orgA, {
			limit: 3,
			after: page1.nextCursor!,
		});
		expect(page2.items).toHaveLength(3);
		expect(page2.hasMore).toBe(true);

		const page3 = await repos.list(orgA, {
			limit: 3,
			after: page2.nextCursor!,
		});
		expect(page3.items).toHaveLength(1);
		expect(page3.hasMore).toBe(false);
		expect(page3.nextCursor).toBeNull();

		// No overlap, newest first.
		const ids = [...page1.items, ...page2.items, ...page3.items].map(
			(c) => c.id,
		);
		expect(new Set(ids).size).toBe(7);
	});

	it("guardian relationships are org-scoped and reject cross-tenant pairing", async () => {
		const { repos } = await makeRepos();
		const minor = await repos.create(orgA, {
			firstName: "Min",
			lastName: "Or",
			dateOfBirth: "2012-05-01",
		});
		const guardian = await repos.create(orgA, {
			firstName: "Gua",
			lastName: "Rdian",
		});
		await repos.create(orgB, { firstName: "Out", lastName: "Sider" });

		const rel = await repos.addRelationship(orgA, {
			customerId: minor.id,
			relatedCustomerId: guardian.id,
			relationshipType: "guarded_by",
			metadata: { note: "father" },
		});

		expect(await repos.listRelationships(orgB, minor.id)).toHaveLength(0);
		expect(
			(await repos.listRelationships(orgA, minor.id))![0]!.related_customer_id,
		).toBe(guardian.id);
		expect(
			(await repos.listRelationships(orgA, minor.id))![0]!.relationship_type,
		).toBe("guarded_by");
		expect(await repos.removeRelationship(orgB, rel.id)).toBe(false);
		expect(await repos.removeRelationship(orgA, rel.id)).toBe(true);
	});
});
