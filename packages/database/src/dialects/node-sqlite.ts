import type { DatabaseSync } from "node:sqlite";
/**
 * Kysely Dialect over node:sqlite — used by self-hosted, local dev, and tests (ADR-001).
 * Cloud uses the same Kysely queries through the D1 dialect (added with cloud wiring).
 * Single connection: node:sqlite is synchronous; transactions are plain BEGIN/COMMIT/ROLLBACK.
 */
import {
	type CompiledQuery,
	type DatabaseConnection,
	type Dialect,
	type Driver,
	Kysely,
	type QueryResult,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
} from "kysely";
import type { Database } from "../schema.js";

const SELECT_PATTERN = /^\s*(select|values|with)\b/i;
const RETURNING_PATTERN = /\breturning\b/i;

class NodeSqliteKyselyDriver implements Driver {
	constructor(private readonly database: DatabaseSync) {}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		const db = this.database;
		return {
			async executeQuery<R>(
				compiledQuery: CompiledQuery,
			): Promise<QueryResult<R>> {
				const { sql, parameters } = compiledQuery;
				const statement = db.prepare(sql);
				const args = parameters as never[];
				// RETURNING statements yield rows through .all(); plain writes use .run().
				if (RETURNING_PATTERN.test(sql) || SELECT_PATTERN.test(sql)) {
					const rows = statement.all(...args) as R[];
					return { rows };
				}
				const info = statement.run(...args);
				return { rows: [], numAffectedRows: BigInt(info.changes) };
			},
			// biome-ignore lint/correctness/useYield: guard must throw on iteration — node:sqlite has no streaming
			async *streamQuery() {
				throw new Error("node:sqlite streaming is not supported");
			},
		};
	}

	async beginTransaction(): Promise<void> {
		this.database.exec("BEGIN");
	}

	async commitTransaction(): Promise<void> {
		this.database.exec("COMMIT");
	}

	async rollbackTransaction(): Promise<void> {
		this.database.exec("ROLLBACK");
	}

	async releaseConnection(): Promise<void> {}
	async destroy(): Promise<void> {}
}

export function createNodeSqliteKysely(
	database: DatabaseSync,
): Kysely<Database> {
	const dialect: Dialect = {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new NodeSqliteKyselyDriver(database),
		createIntrospector: (db) => new SqliteIntrospector(db),
		createQueryCompiler: () => new SqliteQueryCompiler(),
	};
	return new Kysely<Database>({ dialect });
}
