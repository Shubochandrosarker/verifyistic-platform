/**
 * Test utility: an in-memory Kysely<Database> with all migrations applied.
 * Lives beside the migrations so every package's tests share one bootstrap.
 * NOT exported from the package root — import { createInMemoryDatabase } from "@verifyistic/database/testing".
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { createNodeSqliteKysely } from "./dialects/node-sqlite.js";
import { createNodeSqliteDriver } from "./drivers/node-sqlite.js";
import { runMigrations } from "./migrator.js";
import type { Database } from "./schema.js";

export async function createInMemoryDatabase(): Promise<Kysely<Database>> {
	const database = new DatabaseSync(":memory:");
	const migrationsDir = fileURLToPath(
		new URL("../migrations/", import.meta.url),
	);
	const migrations = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort()
		.map((file) => ({
			name: file.replace(/\.sql$/, ""),
			sql: readFileSync(join(migrationsDir, file), "utf8"),
		}));
	await runMigrations(createNodeSqliteDriver(database), migrations);
	return createNodeSqliteKysely(database);
}
