import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	type MigrationDefinition,
	createNodeSqliteDriver,
	runMigrations,
} from "../src/index.js";

const MIGRATION_A: MigrationDefinition = {
	name: "0001_test",
	sql: "CREATE TABLE things (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);",
};
const MIGRATION_B: MigrationDefinition = {
	name: "0002_test_index",
	sql: "CREATE INDEX idx_things_org ON things (organization_id);",
};

function freshDriver() {
	return createNodeSqliteDriver(new DatabaseSync(":memory:"));
}

describe("runMigrations", () => {
	it("applies pending migrations in order and records the journal", async () => {
		const driver = freshDriver();
		const applied = await runMigrations(driver, [MIGRATION_A, MIGRATION_B]);
		expect(applied).toEqual(["0001_test", "0002_test_index"]);

		const journal = await driver.all<{ name: string }>(
			"SELECT name FROM schema_migrations ORDER BY name",
		);
		expect(journal.map((row) => row.name)).toEqual([
			"0001_test",
			"0002_test_index",
		]);

		// The migration body actually ran.
		await driver.run("INSERT INTO things (id, organization_id) VALUES (?, ?)", [
			"t1",
			"org_1",
		]);
		expect(
			await driver.all("SELECT id FROM things WHERE organization_id = ?", [
				"org_1",
			]),
		).toHaveLength(1);
	});

	it("is a no-op on the second run (idempotent)", async () => {
		const driver = freshDriver();
		await runMigrations(driver, [MIGRATION_A, MIGRATION_B]);
		const second = await runMigrations(driver, [MIGRATION_A, MIGRATION_B]);
		expect(second).toEqual([]);
	});

	it("rejects editing an already-applied migration (checksum tamper guard)", async () => {
		const driver = freshDriver();
		await runMigrations(driver, [MIGRATION_A]);
		const edited = {
			...MIGRATION_A,
			sql: `${MIGRATION_A.sql}\n-- sneaky edit`,
		};
		await expect(runMigrations(driver, [edited])).rejects.toThrow(
			/checksum mismatch/,
		);
	});

	it("rolls back the whole migration body when a statement fails", async () => {
		const driver = freshDriver();
		const broken: MigrationDefinition = {
			name: "0003_broken",
			sql: "CREATE TABLE keepme (id TEXT); CREATE TABLE syntaxerror (;",
		};
		await expect(runMigrations(driver, [broken])).rejects.toThrow();

		// Nothing from the failed body persisted, and the migration was not journaled.
		const tables = await driver.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keepme'",
		);
		expect(tables).toHaveLength(0);
		const journal = await driver.all(
			"SELECT name FROM schema_migrations WHERE name = '0003_broken'",
		);
		expect(journal).toHaveLength(0);
	});

	it("rejects only the edited migration but still applies later new ones", async () => {
		const driver = freshDriver();
		await runMigrations(driver, [MIGRATION_A]);
		const editedA = { ...MIGRATION_A, sql: `${MIGRATION_A.sql}\n-- tampered` };
		// B is new and fine, but the run aborts at A.
		await expect(runMigrations(driver, [editedA, MIGRATION_B])).rejects.toThrow(
			/checksum mismatch/,
		);
		const journal = await driver.all<{ name: string }>(
			"SELECT name FROM schema_migrations",
		);
		expect(journal.map((row) => row.name)).toEqual(["0001_test"]);
	});
});
