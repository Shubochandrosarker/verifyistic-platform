/**
 * Worker loop (Node runtime, self-hosted/dev). Cloud runs the same jobs from
 * Queues consumers (Phase 6 cloud wiring). Interval: 5s.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createServices } from "@verifyistic/api";
import {
	createNodeSqliteDriver,
	createNodeSqliteKysely,
	runMigrations,
} from "@verifyistic/database";
import { runJobsOnce } from "./index.js";

const dbPath = process.env.DATABASE_PATH ?? "local/dev.db";
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
await runMigrations(createNodeSqliteDriver(database), migrations);

const db = createNodeSqliteKysely(database);
const services = createServices(db);
const intervalSeconds = Number(process.env.WORKER_INTERVAL_SECONDS ?? 5);

async function tick() {
	const summary = await runJobsOnce(services);
	if (
		summary.webhookDeliveries ||
		summary.emails ||
		summary.finalizedSessions.length ||
		summary.expiredSessions
	) {
		console.log("worker_tick", JSON.stringify(summary));
	}
}
await tick();
setInterval(() => {
	tick().catch((error) =>
		console.error("worker_tick_error", (error as Error).message),
	);
}, intervalSeconds * 1000);
console.log(`verifyistic-worker running every ${intervalSeconds}s`);
