/**
 * node:sqlite driver (self-hosted + local dev). Satisfies DatabaseDriver.
 * node:sqlite is available unflagged from Node 22.13+ (experimental until 23.x).
 *
 * runScript() wraps the script in an explicit engine transaction: BEGIN and COMMIT are issued
 * as separate standalone statements — no SQL text is ever assembled by string concatenation.
 * The script content itself is repository-authored (packages/database/migrations/) and
 * checksum-locked by the migration journal.
 */
import { DatabaseSync } from "node:sqlite";
import type { DatabaseDriver } from "../migrator.js";

export function createNodeSqliteDriver(db: DatabaseSync): DatabaseDriver {
	return {
		async runScript(sql) {
			db.exec("BEGIN");
			try {
				db.exec(sql);
				db.exec("COMMIT");
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch {
					/* no transaction open — nothing to roll back */
				}
				throw error;
			}
		},
		async run(sql, params) {
			db.prepare(sql).run(...(params as never[]));
		},
		async all<T = unknown>(sql: string, params: unknown[] = []) {
			return db.prepare(sql).all(...(params as never[])) as T[];
		},
	};
}

export function openNodeSqlite(path: string): DatabaseDriver {
	return createNodeSqliteDriver(new DatabaseSync(path));
}
