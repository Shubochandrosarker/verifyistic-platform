import type { Scope } from "@verifyistic/auth";
import { createInMemoryDatabase } from "@verifyistic/database/testing";
import { MemoryStorageProvider } from "@verifyistic/storage";
import type { Hono } from "hono";
import { type AppServices, createApp, createServices } from "../src/index.js";

export const ALL_SCOPES: Scope[] = [
	"sites:read",
	"sites:write",
	"customers:read",
	"customers:write",
	"templates:read",
	"templates:write",
	"signing:read",
	"signing:write",
	"documents:read",
	"documents:write",
	"api_keys:read",
	"api_keys:write",
	"audit:read",
];

export interface TestWorld extends AppServices {
	app: Hono;
}

export async function makeTestApp(): Promise<TestWorld> {
	const db = await createInMemoryDatabase();
	const services = createServices(db, {
		storage: new MemoryStorageProvider(),
		verifyBaseUrl: "https://verifyistic.com",
	});
	const app = createApp(services);
	return { app, ...services };
}

export interface SeededKey {
	orgId: string;
	keyId: string;
	keyRaw: string;
}

export async function seedOrganization(
	world: TestWorld,
	orgId: string,
	slug = orgId,
): Promise<SeededKey> {
	await world.db
		.insertInto("organizations")
		.values({
			id: orgId,
			name: `Org ${orgId}`,
			slug,
			billing_email: null,
			timezone: "UTC",
			default_retention_policy_id: null,
			status: "active",
			metadata: null,
			created_at: "2026-09-19T00:00:00Z",
			updated_at: "2026-09-19T00:00:00Z",
		})
		.execute();
	const { record, raw } = await world.apiKeys.create(
		{ organizationId: orgId, actor: { type: "system", id: "seed" } },
		{ name: "test-root", scopes: ALL_SCOPES },
	);
	return { orgId, keyId: record.id, keyRaw: raw };
}

export function authedRequest(
	app: Hono,
	method: "GET" | "POST" | "PATCH" | "DELETE",
	path: string,
	keyRaw: string,
	body?: unknown,
) {
	return app.request(path, {
		method,
		headers: {
			Authorization: `Bearer ${keyRaw}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
