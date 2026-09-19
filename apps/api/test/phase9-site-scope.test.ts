import { beforeEach, describe, expect, it } from "vitest";
import {
	type SeededKey,
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 9 (cloud side): site-scoped credentials (doc 06 §5) — the WordPress
 * connector's key is restricted to its site; the API enforces it.
 */
let world: TestWorld;
let orgA: SeededKey;

beforeEach(async () => {
	world = await makeTestApp();
	orgA = await seedOrganization(world, "org_a", "range-a");
});

async function seedTwoSites(): Promise<{ siteA: string; siteB: string }> {
	const s1 = (await (
		await authedRequest(world.app, "POST", "/v1/sites", orgA.keyRaw, {
			name: "Site A",
		})
	).json()) as {
		data: { id: string };
	};
	const s2 = (await (
		await authedRequest(world.app, "POST", "/v1/sites", orgA.keyRaw, {
			name: "Site B",
		})
	).json()) as {
		data: { id: string };
	};
	return { siteA: s1.data.id, siteB: s2.data.id };
}

async function createRestrictedKey(allowedSites: string[]): Promise<string> {
	const { raw } = await world.apiKeys.create(
		{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
		{
			name: "wp-connector",
			scopes: [
				"signing:write",
				"signing:read",
				"customers:write",
				"documents:read",
			],
			siteRestrictions: allowedSites,
		},
	);
	return raw;
}

describe("site-scoped credentials (doc 06 §5)", () => {
	it("a single-site key defaults site_id automatically and rejects other sites with 403", async () => {
		const { siteA, siteB } = await seedTwoSites();
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "J",
				last_name: "D",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: { blocks: [{ type: "paragraph", text: "x" }] },
			})
		).json()) as { data: { template: { id: string } } };
		const versions = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/templates/${tpl.data.template.id}/versions`,
				orgA.keyRaw,
			)
		).json()) as { data: { id: string }[] };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${versions.data[0]!.id}/publish`,
			orgA.keyRaw,
		);

		const siteKey = await createRestrictedKey([siteA]);

		// No site_id → defaults to the single allowed site.
		const created = (await (
			await world.app.request("/v1/signing-sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${siteKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					template_id: tpl.data.template.id,
					customer_id: customer.data.id,
				}),
			})
		).json()) as { data: { site_id: string | null } };
		expect(created.data.site_id).toBe(siteA);

		// Explicit other-site request → 403 (not 404: the site exists, the key may not touch it).
		const forbidden = await world.app.request("/v1/signing-sessions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${siteKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				template_id: tpl.data.template.id,
				customer_id: customer.data.id,
				site_id: siteB,
			}),
		});
		expect(forbidden.status).toBe(403);
	});

	it("unrestricted keys are unaffected", async () => {
		const { siteB } = await seedTwoSites();
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "J",
				last_name: "D",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: { blocks: [{ type: "paragraph", text: "x" }] },
			})
		).json()) as { data: { template: { id: string } } };
		const versions = (await (
			await authedRequest(
				world.app,
				"GET",
				`/v1/templates/${tpl.data.template.id}/versions`,
				orgA.keyRaw,
			)
		).json()) as { data: { id: string }[] };
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${versions.data[0]!.id}/publish`,
			orgA.keyRaw,
		);

		const created = (await (
			await authedRequest(
				world.app,
				"POST",
				"/v1/signing-sessions",
				orgA.keyRaw,
				{
					template_id: tpl.data.template.id,
					customer_id: customer.data.id,
					site_id: siteB,
				},
			)
		).json()) as { data: { site_id: string | null } };
		expect(created.data.site_id).toBe(siteB);
	});
});
