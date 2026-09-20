import { ApiError } from "@verifyistic/core";
import { normalizeEmail, normalizePhone } from "@verifyistic/customers";
/**
 * Phase 12 (doc 15): generic CSV customer import — dry-run + commit, idempotent
 * by normalized email. No commit without an explicit commit=true call (doc 15 §5).
 */
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

const nowIso = () => new Date().toISOString();

/** Minimal RFC-4180-ish CSV parser (quoted fields, commas, newlines). */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			if (row.length > 1 || row[0] !== "") rows.push(row);
			row = [];
		} else {
			field += ch;
		}
	}
	row.push(field);
	if (row.length > 1 || row[0] !== "") rows.push(row);
	return rows;
}

export function importsRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.post("/customers/csv", async (c) => {
		const { tenant } = requireScope(c, "customers:write");
		const rawBody = await c.req.text();
		const contentType = c.req.header("Content-Type") ?? "";
		const commit = /commit\s*=\s*true/i.test(
			c.req.header("X-Import-Mode") ?? "",
		);

		if (!contentType.includes("text/csv")) {
			throw ApiError.validation(
				"Send the CSV as text/csv with header row: first_name,last_name,email,phone,date_of_birth",
				{
					"Content-Type": ["text/csv required"],
				},
			);
		}

		const rows = parseCsv(rawBody);
		if (rows.length === 0) {
			throw ApiError.validation("CSV is empty.", { body: ["empty"] });
		}
		const header = rows[0]!.map((h) => h.trim().toLowerCase());
		const idx = (name: string) => header.indexOf(name);
		if (
			idx("email") === -1 ||
			(idx("first_name") === -1 && idx("last_name") === -1)
		) {
			throw ApiError.validation(
				"CSV must include at least email and first_name/last_name columns.",
				{
					header: ["invalid"],
				},
			);
		}

		const report = {
			rows: rows.length - 1,
			created: 0,
			updated: 0,
			invalid: 0,
			warnings: [] as string[],
		};

		for (const [line, cells] of rows.slice(1).entries()) {
			const get = (name: string) => {
				const i = idx(name);
				return i >= 0 && i < cells.length ? cells[i]!.trim() : "";
			};
			const email = get("email");
			const emailNormalized = normalizeEmail(email);
			const firstName = get("first_name");
			const lastName = get("last_name");
			if (!emailNormalized && !firstName && !lastName) {
				report.invalid += 1;
				continue;
			}
			if (!emailNormalized) {
				report.warnings.push(
					`line ${line + 2}: missing/invalid email — skipped`,
				);
				report.invalid += 1;
				continue;
			}

			if (!commit) {
				// Dry run (default): count what WOULD happen without writing (doc 15 §5).
				const existing = await deps.customers.findByEmail(tenant, email);
				if (existing) report.updated += 1;
				else report.created += 1;
				continue;
			}

			const existing = await deps.customers.findByEmail(tenant, email);
			if (existing) {
				await deps.customers.update(tenant, existing.id, {
					firstName: firstName || existing.first_name,
					lastName: lastName || existing.last_name,
					phone: get("phone") || null,
					dateOfBirth: get("date_of_birth") || null,
				});
				report.updated += 1;
			} else {
				await deps.customers.create(tenant, {
					firstName: firstName || emailNormalized.split("@")[0]!,
					lastName: lastName || "—",
					email,
					phone: get("phone") || null,
					dateOfBirth: get("date_of_birth") || null,
					source: "import_csv",
				});
				report.created += 1;
			}
		}

		if (commit) {
			await deps.audit.record(tenant, {
				eventType: "import.customers_committed",
				entityType: "import",
				entityId: "csv",
				data: report,
			});
		}

		return ok(
			c,
			{ mode: commit ? "commit" : "dry_run", ...report },
			{ committed: commit },
		);
	});

	return routes;
}
