/**
 * Kysely Dialect over a Cloudflare D1 binding (cloud edition, ADR-001).
 * D1 prepared statements only — no interactive transactions; Kysely-level
 * transaction calls throw. Single statements suffice for all current repositories.
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

export interface D1PreparedStatementLike {
	bind(...values: unknown[]): {
		all(): Promise<{ results?: unknown[] }>;
		run(): Promise<{ meta?: { changes?: number; last_row_id?: number } }>;
	};
}

export interface D1DatabaseLike {
	prepare(query: string): D1PreparedStatementLike;
}

const SELECT_PATTERN = /^\s*(select|values|with)\b/i;
const RETURNING_PATTERN = /\breturning\b/i;

class D1KyselyDriver implements Driver {
	constructor(private readonly database: D1DatabaseLike) {}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		const db = this.database;
		return {
			async executeQuery<R>(
				compiledQuery: CompiledQuery,
			): Promise<QueryResult<R>> {
				const { sql, parameters } = compiledQuery;
				const statement = db.prepare(sql).bind(...parameters);
				if (RETURNING_PATTERN.test(sql) || SELECT_PATTERN.test(sql)) {
					const result = await statement.all();
					return { rows: (result.results ?? []) as R[] };
				}
				const info = await statement.run();
				return { rows: [], numAffectedRows: BigInt(info.meta?.changes ?? 0) };
			},
			async *streamQuery() {
				throw new Error("D1 streaming is not supported");
			},
		};
	}

	async beginTransaction(): Promise<void> {
		throw new Error(
			"D1 does not support interactive transactions — use batch or single statements.",
		);
	}
	async commitTransaction(): Promise<void> {
		throw new Error("D1 does not support interactive transactions.");
	}
	async rollbackTransaction(): Promise<void> {
		throw new Error("D1 does not support interactive transactions.");
	}

	async releaseConnection(): Promise<void> {}
	async destroy(): Promise<void> {}
}

export function createD1Kysely(database: D1DatabaseLike): Kysely<Database> {
	const dialect: Dialect = {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new D1KyselyDriver(database),
		createIntrospector: (db) => new SqliteIntrospector(db),
		createQueryCompiler: () => new SqliteQueryCompiler(),
	};
	return new Kysely<Database>({ dialect });
}
