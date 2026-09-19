#!/usr/bin/env node
/**
 * Migration CLI — applies packages/database/migrations/*.sql in order to a local SQLite database.
 * Usage: pnpm migrate [path-to-sqlite-file]   (default: local/dev.db, created if missing)
 * The cloud (D1) path uses the same migrator with the D1 driver (Phase 2 wiring).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type MigrationDefinition,
	openNodeSqlite,
	runMigrations,
} from "../src/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const dbPath = process.argv[2] ?? "local/dev.db";

const migrations: MigrationDefinition[] = readdirSync(migrationsDir)
	.filter((file) => file.endsWith(".sql"))
	.sort()
	.map((file) => ({
		name: file.replace(/\.sql$/, ""),
		sql: readFileSync(join(migrationsDir, file), "utf8"),
	}));

if (migrations.length === 0) {
	console.error(`No migrations found in ${migrationsDir}`);
	process.exit(1);
}

if (dbPath !== ":memory:" && !existsSync(join(dbPath, ".."))) {
	mkdirSync(join(dbPath, ".."), { recursive: true });
}

const driver = openNodeSqlite(dbPath);
const applied = await runMigrations(driver, migrations, {
	onApply: (name) => console.log(`applied  ${name}`),
});

if (applied.length === 0) {
	console.log(
		`already up to date (${migrations.length} migrations) at ${dbPath}`,
	);
} else {
	console.log(`done: ${applied.length} applied, database at ${dbPath}`);
}
