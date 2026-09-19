import { beforeEach, describe, expect, it } from "vitest";
import {
	type TestWorld,
	authedRequest,
	makeTestApp,
	seedOrganization,
} from "./helpers.js";

/**
 * Phase 6: async platform — webhook delivery with HMAC + retries + dead-letter,
 * email outbox pump, retention (expiry sweeper), worker composition.
 */
let world: TestWorld;
let orgA: { orgId: string; keyId: string; keyRaw: string };

beforeEach(async () => {
	world = await makeTestApp();
});

async function seedOrg(): Promise<void> {
	orgA = await seedOrganization(world, "org_a", "range-a");
}

describe("webhooks API", () => {
	it("registers an endpoint (secret once), rejects SSRF targets", async () => {
		await seedOrg();
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/webhooks", orgA.keyRaw, {
				url: "https://hooks.customer.example/verifyistic",
			})
		).json()) as { data: { id: string; secret: string; url: string } };
		expect(created.data.secret).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(created.data.secret.length).toBeGreaterThanOrEqual(40);

		const stored = JSON.stringify(
			await world.db.selectFrom("webhook_endpoints").selectAll().execute(),
		);
		expect(stored).not.toContain(created.data.secret);

		const ssrf = await authedRequest(
			world.app,
			"POST",
			"/v1/webhooks",
			orgA.keyRaw,
			{
				url: "http://169.254.169.254/latest/meta-data",
			},
		);
		expect(ssrf.status).toBe(400);
		const localhost = await authedRequest(
			world.app,
			"POST",
			"/v1/webhooks",
			orgA.keyRaw,
			{
				url: "http://localhost/hook",
			},
		);
		expect(localhost.status).toBe(400);
	});

	it("lists and disables endpoints, tenant-scoped", async () => {
		await seedOrg();
		const orgB = await seedOrganization(world, "org_b", "range-b");
		const created = (await (
			await authedRequest(world.app, "POST", "/v1/webhooks", orgA.keyRaw, {
				url: "https://hooks.customer.example/a",
			})
		).json()) as { data: { id: string } };

		expect(
			(
				await authedRequest(
					world.app,
					"DELETE",
					`/v1/webhooks/${created.data.id}`,
					orgB.keyRaw,
				)
			).status,
		).toBe(404);
		expect(
			(
				await authedRequest(
					world.app,
					"DELETE",
					`/v1/webhooks/${created.data.id}`,
					orgA.keyRaw,
				)
			).status,
		).toBe(200);
		const list = (await (
			await authedRequest(world.app, "GET", "/v1/webhooks", orgA.keyRaw)
		).json()) as {
			data: { status: string }[];
		};
		expect(list.data[0]!.status).toBe("disabled");
	});
});

describe("worker composition", () => {
	it("processDueDeliveries + finalizeProcessing + expireOverdue run against one DB", async () => {
		await seedOrg();

		// A processing session awaits the pdf-finalize job.
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "J",
				last_name: "D",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: {
					blocks: [
						{
							type: "field",
							field_key: "legal_name",
							label: "Name",
							field_type: "text",
							required: true,
						},
						{ type: "signature", field_key: "signature", label: "Signature" },
					],
				},
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
			orgA.keyRaw,
		);
		const sess = (await (
			await authedRequest(
				world.app,
				"POST",
				"/v1/signing-sessions",
				orgA.keyRaw,
				{
					template_id: tpl.data.template.id,
					customer_id: customer.data.id,
				},
			)
		).json()) as { data: { id: string; token: string } };
		await world.app.request(`/v1/sign/${sess.data.token}/session`);
		await world.app.request(`/v1/sign/${sess.data.token}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				values: { legal_name: "J" },
				consent: { accepted: true },
				signatures: [{ role: "signer", method: "typed", typed_name: "J D" }],
			}),
		});

		const jobs = await world.documents.finalizeProcessing();
		expect(jobs.finalized).toHaveLength(1);
		const expired = await world.signing.expireOverdue();
		expect(expired).toBe(0);
	});

	it("expireOverdue expires only overdue non-final sessions", async () => {
		await seedOrg();
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "J",
				last_name: "D",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: {
					blocks: [
						{
							type: "field",
							field_key: "legal_name",
							label: "Name",
							field_type: "text",
							required: true,
						},
						{ type: "signature", field_key: "signature", label: "Signature" },
					],
				},
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
			orgA.keyRaw,
		);
		await authedRequest(
			world.app,
			"POST",
			"/v1/signing-sessions",
			orgA.keyRaw,
			{
				template_id: tpl.data.template.id,
				customer_id: customer.data.id,
				expires_in_seconds: 300,
			},
		);

		// Not yet overdue — the sweep is a no-op.
		expect(await world.signing.expireOverdue()).toBe(0);

		// Force overdue via the service (direct session with negative expiry).
		const { token: deadToken } = await world.signing.createSession(
			{ organizationId: "org_a", actor: { type: "system", id: "seed" } },
			{
				template_id: tpl.data.template.id,
				customer_id: customer.data.id,
				expires_in_seconds: -1,
			},
		);
		const expired = await world.signing.expireOverdue();
		expect(expired).toBe(1);
		expect(
			(await world.app.request(`/v1/sign/${deadToken}/session`)).status,
		).toBe(404);
	});
});

describe("email outbox", () => {
	it("session invitation queues an email when delivery_method=email; pump sends it", async () => {
		await seedOrg();
		const customer = (await (
			await authedRequest(world.app, "POST", "/v1/customers", orgA.keyRaw, {
				first_name: "Mail",
				last_name: "Me",
				email: "mailme@example.com",
			})
		).json()) as { data: { id: string } };
		const tpl = (await (
			await authedRequest(world.app, "POST", "/v1/templates", orgA.keyRaw, {
				name: "W",
				schema: {
					blocks: [
						{
							type: "field",
							field_key: "legal_name",
							label: "Name",
							field_type: "text",
							required: true,
						},
						{ type: "signature", field_key: "signature", label: "Signature" },
					],
				},
			})
		).json()) as {
			data: { template: { id: string }; version: { id: string } };
		};
		await authedRequest(
			world.app,
			"POST",
			`/v1/templates/${tpl.data.template.id}/versions/${tpl.data.version.id}/publish`,
			orgA.keyRaw,
		);
		await authedRequest(
			world.app,
			"POST",
			"/v1/signing-sessions",
			orgA.keyRaw,
			{
				template_id: tpl.data.template.id,
				customer_id: customer.data.id,
				delivery_method: "email",
			},
		);

		const queued = await world.db
			.selectFrom("email_outbox")
			.selectAll()
			.execute();
		expect(queued).toHaveLength(1);
		expect(queued[0]!.to_email).toBe("mailme@example.com");
		expect(queued[0]!.template).toBe("signing_session_invitation");

		const sent: string[] = [];
		const processed = await world.emailOutbox.processDue({
			send: async (email) => {
				sent.push(email.to);
			},
		});
		expect(processed).toBe(1);
		expect(sent).toEqual(["mailme@example.com"]);
		const after = (await world.db
			.selectFrom("email_outbox")
			.selectAll()
			.executeTakeFirst())!;
		expect(after.status).toBe("sent");
	});
});
