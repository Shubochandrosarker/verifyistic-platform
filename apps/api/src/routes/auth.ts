import { ApiError, newId, sha256Hex } from "@verifyistic/core";
import type { DashboardUsersTable } from "@verifyistic/database";
/**
 * Dashboard auth (Phase 14 completion): email+password signup/login.
 * Signup creates organization + owner + root API key (raw shown once).
 * Login verifies PBKDF2 (WebCrypto, 100k iterations) and mints a fresh API key.
 * No session cookies — the dashboard holds the returned key client-side (v1).
 */
import { Hono } from "hono";
import type { AppServices } from "../deps.js";

const nowIso = () => new Date().toISOString();

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return bytesToHex(buf.buffer);
}

async function hashPassword(
	password: string,
	saltHex: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: Uint8Array.from(
				saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)),
			),
			iterations: 100_000,
			hash: "SHA-256",
		},
		key,
		256,
	);
	return bytesToHex(bits);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALL_SCOPES = [
	"sites:read",
	"sites:write",
	"customers:read",
	"customers:write",
	"templates:read",
	"templates:write",
	"signing:read",
	"signing:write",
	"checkin:read",
	"checkin:write",
	"documents:read",
	"documents:write",
	"webhooks:read",
	"webhooks:write",
	"api_keys:read",
	"api_keys:write",
	"audit:read",
];

/** Mint a root API key for the organization (raw returned once by the caller). */
async function mintRootKey(
	db: AppServices["db"],
	organizationId: string,
	name: string,
): Promise<string> {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const rand = (n: number) => {
		const bytes = new Uint8Array(n);
		crypto.getRandomValues(bytes);
		return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
	};
	const prefix = rand(8);
	const secret = rand(24);
	const raw = `vfy_live_${prefix}${secret}`;
	await db
		.insertInto("api_keys")
		.values({
			id: newId(),
			organization_id: organizationId,
			name,
			key_prefix: `vfy_live_${prefix}`,
			key_hash: await sha256Hex(raw),
			scopes: JSON.stringify(ALL_SCOPES),
			site_restrictions: null,
			last_used_at: null,
			expires_at: null,
			revoked_at: null,
			created_at: nowIso(),
		})
		.execute();
	return raw;
}

export function authRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.post("/auth/signup", async (c) => {
		const body = (await c.req.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (!body) throw ApiError.validation("Request body must be a JSON object.");
		const company =
			typeof body.company_name === "string" ? body.company_name.trim() : "";
		const email =
			typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		const password = typeof body.password === "string" ? body.password : "";
		const errors: Record<string, string[]> = {};
		if (company.length < 2 || company.length > 100)
			errors.company_name = ["2-100 characters required."];
		if (!EMAIL_RE.test(email)) errors.email = ["Enter a valid email address."];
		if (password.length < 10)
			errors.password = ["Password must be at least 10 characters."];
		if (Object.keys(errors).length > 0)
			throw new ApiError(
				"validation_error",
				"One or more fields are invalid.",
				errors,
			);

		const existingUser = await deps.db
			.selectFrom("dashboard_users")
			.select("id")
			.where("email", "=", email)
			.executeTakeFirst();
		if (existingUser) {
			throw new ApiError(
				"conflict",
				"An account with this email already exists. Sign in instead.",
			);
		}

		const slugBase =
			company
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "range";
		const slug = `${slugBase}-${randomHex(2)}`;
		const orgId = newId();
		const userId = newId();
		const now = nowIso();

		await deps.db
			.insertInto("organizations")
			.values({
				id: orgId,
				name: company,
				slug,
				billing_email: email,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active",
				metadata: null,
				created_at: now,
				updated_at: now,
			})
			.execute();

		const salt = randomHex(16);
		const passwordHash = await hashPassword(password, salt);
		await deps.db
			.insertInto("dashboard_users")
			.values({
				id: userId,
				organization_id: orgId,
				email,
				password_hash: passwordHash,
				salt,
				role: "owner",
				created_at: now,
			})
			.execute();

		const rawKey = await mintRootKey(deps.db, orgId, "dashboard-root");
		await deps.audit.record(
			{ organizationId: orgId, actor: { type: "system", id: userId } },
			{
				eventType: "organization.created",
				entityType: "organization",
				entityId: orgId,
				data: { via: "signup" },
			},
		);

		// Raw API key returned exactly once — the dashboard stores it client-side.
		return c.json({
			data: {
				organization: { id: orgId, name: company, slug },
				email,
				api_key: rawKey,
			},
			meta: { request_id: c.get("requestId") },
		});
	});

	routes.post("/auth/login", async (c) => {
		const body = (await c.req.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		const email =
			typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
		const password = typeof body?.password === "string" ? body.password : "";
		if (!email || !password) {
			throw new ApiError(
				"validation_error",
				"Email and password are required.",
			);
		}
		const user = await deps.db
			.selectFrom("dashboard_users")
			.selectAll()
			.where("email", "=", email)
			.executeTakeFirst();
		// Constant-shape failure: same error whether email or password is wrong.
		if (!user) throw new ApiError("unauthorized", "Invalid email or password.");
		const candidateHash = await hashPassword(password, user.salt);
		if (candidateHash !== user.password_hash) {
			throw new ApiError("unauthorized", "Invalid email or password.");
		}
		const rawKey = await mintRootKey(
			deps.db,
			user.organization_id,
			"dashboard-login",
		);
		const org = await deps.db
			.selectFrom("organizations")
			.select(["id", "name", "slug"])
			.where("id", "=", user.organization_id)
			.executeTakeFirst();
		await deps.audit.record(
			{
				organizationId: user.organization_id,
				actor: { type: "user", id: user.id },
			},
			{
				eventType: "auth.login",
				entityType: "dashboard_user",
				entityId: user.id,
				data: {},
			},
		);

		return c.json({
			data: { organization: org, email, api_key: rawKey },
			meta: { request_id: c.get("requestId") },
		});
	});

	return routes;
}
