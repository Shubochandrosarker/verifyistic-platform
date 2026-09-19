import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
/**
 * Node runtime entry — self-hosted and local dev (ADR-001).
 * The cloud deployment serves the same app from the Workers entry (D1 dialect, cloud wiring).
 * Usage: pnpm dev:api → http://localhost:8787/v1/health
 *
 * Boot applies pending migrations to DATABASE_PATH (idempotent, same runner as `pnpm migrate`).
 */
import { serve } from "@hono/node-server";
import { runMigrations } from "@verifyistic/database";
import {
	createNodeSqliteDriver,
	createNodeSqliteKysely,
} from "@verifyistic/database/node";
import { LocalStorageProvider } from "@verifyistic/storage/local";
import { createApp, createServices } from "./index.js";

const dbPath = process.env.DATABASE_PATH ?? "local/dev.db";
const port = Number(process.env.PORT ?? 8787);

const database = new DatabaseSync(dbPath);
const migrationsDir = fileURLToPath(
	new URL("../../../packages/database/migrations/", import.meta.url),
);
const migrations = readdirSync(migrationsDir)
	.filter((file) => file.endsWith(".sql"))
	.sort()
	.map((file) => ({
		name: file.replace(/\.sql$/, ""),
		sql: readFileSync(join(migrationsDir, file), "utf8"),
	}));

const applied = await runMigrations(
	createNodeSqliteDriver(database),
	migrations,
	{
		onApply: (name) => console.log(`applied migration ${name}`),
	},
);
if (applied.length === 0) console.log("migrations up to date");

const db = createNodeSqliteKysely(database);
const app = createApp(createServices(db));

serve({ fetch: app.fetch, port }, (info) => {
	console.log(
		`verifyistic-api listening on http://localhost:${info.port}/v1/health`,
	);
});
