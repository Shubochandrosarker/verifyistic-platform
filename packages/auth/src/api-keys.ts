/**
 * API keys (doc 06 §4): format vfy_live_<prefix><secret> / vfy_test_<prefix><secret>.
 * At rest: SHA-256 hash of the full raw key + display prefix + scopes + site restrictions.
 * The raw secret is returned exactly once at creation and never stored or logged.
 */
import { newId, sha256Hex } from "@verifyistic/core";
import type { ApiKey, Database } from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import { type Scope, isScope } from "./scopes.js";

export type ApiKeyMode = "live" | "test";

const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 24;
const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export interface CreateApiKeyInput {
	name: string;
	mode?: ApiKeyMode;
	scopes: Scope[];
	siteRestrictions?: string[];
	expiresInDays?: number;
}

export interface ApiKeyServiceDeps {
	now?: () => Date;
}

export class ApiKeyService {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly deps: ApiKeyServiceDeps = {},
	) {}

	private nowIso(): string {
		return (this.deps.now ?? (() => new Date()))().toISOString();
	}

	async create(
		tenant: TenantContext,
		input: CreateApiKeyInput,
	): Promise<{ record: ApiKey; raw: string }> {
		const mode = input.mode ?? "live";
		const prefix = randomString(PREFIX_LENGTH);
		const secret = randomString(SECRET_LENGTH);
		const raw = `vfy_${mode}_${prefix}${secret}`;
		const keyHash = await sha256Hex(raw);
		const now = this.nowIso();
		const record: ApiKey = {
			id: newId(),
			organization_id: tenant.organizationId,
			name: input.name,
			key_prefix: `vfy_${mode}_${prefix}`,
			key_hash: keyHash,
			scopes: JSON.stringify(input.scopes),
			site_restrictions: input.siteRestrictions
				? JSON.stringify(input.siteRestrictions)
				: null,
			last_used_at: null,
			expires_at: input.expiresInDays
				? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
				: null,
			revoked_at: null,
			created_at: now,
		};
		await this.db.insertInto("api_keys").values(record).execute();
		return { record, raw };
	}

	/** Resolve a raw bearer key to its record, or undefined when invalid/expired/revoked. */
	async verify(raw: string): Promise<ApiKey | undefined> {
		if (!raw.startsWith("vfy_live_") && !raw.startsWith("vfy_test_"))
			return undefined;
		const keyHash = await sha256Hex(raw);
		const record = await this.db
			.selectFrom("api_keys")
			.selectAll()
			.where("key_hash", "=", keyHash)
			.executeTakeFirst();
		if (!record) return undefined;
		if (record.revoked_at !== null) return undefined;
		if (record.expires_at !== null && record.expires_at <= this.nowIso())
			return undefined;
		await this.db
			.updateTable("api_keys")
			.set({ last_used_at: this.nowIso() })
			.where("id", "=", record.id)
			.execute();
		return record;
	}

	async list(tenant: TenantContext): Promise<ApiKey[]> {
		return this.db
			.selectFrom("api_keys")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "asc")
			.execute();
	}

	/** Tenant-enforced lookup: another organization's key id is indistinguishable from a missing one. */
	async get(tenant: TenantContext, keyId: string): Promise<ApiKey | undefined> {
		return this.db
			.selectFrom("api_keys")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", keyId)
			.executeTakeFirst();
	}

	async revoke(
		tenant: TenantContext,
		keyId: string,
	): Promise<ApiKey | undefined> {
		return this.db
			.updateTable("api_keys")
			.set({ revoked_at: this.nowIso() })
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", keyId)
			.where("revoked_at", "is", null)
			.returningAll()
			.executeTakeFirst();
	}

	/** Revoke + create with the same scopes/name. The new raw key is returned once. */
	async rotate(
		tenant: TenantContext,
		keyId: string,
	): Promise<{ record: ApiKey; raw: string } | undefined> {
		const existing = await this.get(tenant, keyId);
		if (!existing || existing.revoked_at !== null) return undefined;
		const revoked = await this.revoke(tenant, keyId);
		if (!revoked) return undefined;
		const { record, raw } = await this.create(tenant, {
			name: existing.name,
			mode: existing.key_prefix.startsWith("vfy_test_") ? "test" : "live",
			scopes: JSON.parse(existing.scopes).filter(isScope),
			siteRestrictions: existing.site_restrictions
				? JSON.parse(existing.site_restrictions)
				: undefined,
		});
		return { record, raw };
	}
}
