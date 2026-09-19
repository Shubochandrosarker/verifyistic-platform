/**
 * Migration runner (Phase 1) — runtime-agnostic per ADR-001.
 * One portable SQL migration set applied identically on node:sqlite (self-hosted/local dev)
 * and Cloudflare D1 (cloud).
 *
 * Security posture: migration SQL is repository-authored, loaded from packages/database/migrations/,
 * and checksum-locked in the journal — an already-applied migration can never be re-executed with
 * different content. Parameterized statements are used for every journal write; no dynamic SQL
 * is ever constructed from request/user data.
 */
import { sha256Hex } from "@verifyistic/core";

export interface MigrationDefinition {
	/** Zero-padded ordered name, e.g. 0001_core_tenancy. */
	name: string;
	sql: string;
}

/**
 * The only surface the migration runner needs from any engine.
 * runScript() executes one repository-authored SQL script atomically (engine-managed transaction,
 * rollback on failure). run()/all() are parameterized statements only — never concatenate values
 * into SQL strings.
 */
export interface DatabaseDriver {
	runScript(sql: string): Promise<void>;
	run(sql: string, params: unknown[]): Promise<void>;
	all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

const JOURNAL_DDL = [
	"CREATE TABLE IF NOT EXISTS schema_migrations (",
	"  name TEXT PRIMARY KEY,",
	"  checksum TEXT NOT NULL,",
	"  applied_at TEXT NOT NULL",
	");",
].join("\n");

const JOURNAL_INSERT = [
	"INSERT INTO schema_migrations (name, checksum, applied_at)",
	"VALUES (?, ?, ?)",
].join("\n");

interface JournalRow {
	name: string;
	checksum: string;
}

export async function appliedMigrations(
	driver: DatabaseDriver,
): Promise<Map<string, string>> {
	const rows = await driver.all<JournalRow>(
		"SELECT name, checksum FROM schema_migrations",
	);
	return new Map(rows.map((row) => [row.name, row.checksum]));
}

/**
 * Apply pending migrations in order. Returns the names applied in this run.
 * @throws when an applied migration's content no longer matches its recorded checksum.
 */
export async function runMigrations(
	driver: DatabaseDriver,
	migrations: MigrationDefinition[],
	options?: { onApply?: (name: string) => void },
): Promise<string[]> {
	await driver.runScript(JOURNAL_DDL);

	const applied = await appliedMigrations(driver);
	const appliedNow: string[] = [];

	for (const migration of migrations) {
		const checksum = await sha256Hex(migration.sql);
		const recorded = applied.get(migration.name);

		if (recorded !== undefined) {
			if (recorded !== checksum) {
				throw new Error(
					`Migration checksum mismatch for ${migration.name} — applied migrations are immutable. Write a new forward-fix migration instead.`,
				);
			}
			continue;
		}

		await driver.runScript(migration.sql);
		await driver.run(JOURNAL_INSERT, [
			migration.name,
			checksum,
			new Date().toISOString(),
		]);
		options?.onApply?.(migration.name);
		appliedNow.push(migration.name);
	}

	return appliedNow;
}
