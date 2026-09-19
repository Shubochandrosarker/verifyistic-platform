/**
 * Tenant-scoped repositories (Phase 2): organizations, sites, memberships.
 * Pattern: every method takes TenantContext first and every query filters on
 * organization_id from that context. get-by-id returns null for other tenants —
 * cross-tenant access is indistinguishable from "does not exist" (no existence leak).
 */
import { newId } from "@verifyistic/core";
import type {
	Database,
	Organization,
	OrganizationUser,
	Site,
} from "@verifyistic/database";
import type { Kysely } from "kysely";
import type { TenantContext } from "./context.js";

const nowIso = () => new Date().toISOString();

export class TenantRepositories {
	constructor(private readonly db: Kysely<Database>) {}

	// --- organizations -------------------------------------------------------

	/** The authenticated tenant's own organization — the only one an API key can ever see. */
	async getOrganization(
		tenant: TenantContext,
	): Promise<Organization | undefined> {
		return this.db
			.selectFrom("organizations")
			.selectAll()
			.where("id", "=", tenant.organizationId)
			.executeTakeFirst();
	}

	// --- sites ---------------------------------------------------------------

	async listSites(tenant: TenantContext): Promise<Site[]> {
		return this.db
			.selectFrom("sites")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "asc")
			.execute();
	}

	async getSite(
		tenant: TenantContext,
		siteId: string,
	): Promise<Site | undefined> {
		return this.db
			.selectFrom("sites")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", siteId)
			.executeTakeFirst();
	}

	async createSite(
		tenant: TenantContext,
		data: {
			name: string;
			domain?: string | null;
			address?: string | null;
			timezone?: string;
		},
	): Promise<Site> {
		const timestamp = nowIso();
		const row: Site = {
			id: newId(),
			organization_id: tenant.organizationId,
			name: data.name,
			domain: data.domain ?? null,
			address: data.address ?? null,
			timezone: data.timezone ?? "UTC",
			status: "active",
			branding_config: null,
			created_at: timestamp,
			updated_at: timestamp,
		};
		await this.db.insertInto("sites").values(row).execute();
		return row;
	}

	async updateSite(
		tenant: TenantContext,
		siteId: string,
		patch: {
			name?: string;
			domain?: string | null;
			address?: string | null;
			timezone?: string;
			status?: "active" | "inactive";
		},
	): Promise<Site | undefined> {
		const updated = await this.db
			.updateTable("sites")
			.set({ ...patch, updated_at: nowIso() })
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", siteId)
			.returningAll()
			.executeTakeFirst();
		return updated;
	}

	// --- memberships ---------------------------------------------------------

	async listMembers(tenant: TenantContext): Promise<OrganizationUser[]> {
		return this.db
			.selectFrom("organization_users")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "asc")
			.execute();
	}

	async getMember(
		tenant: TenantContext,
		userId: string,
	): Promise<OrganizationUser | undefined> {
		return this.db
			.selectFrom("organization_users")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("user_id", "=", userId)
			.executeTakeFirst();
	}

	async addMember(
		tenant: TenantContext,
		data: {
			userId: string;
			role: OrganizationUser["role"];
			status?: OrganizationUser["status"];
		},
	): Promise<OrganizationUser> {
		const timestamp = nowIso();
		const row: OrganizationUser = {
			id: newId(),
			organization_id: tenant.organizationId,
			user_id: data.userId,
			role: data.role,
			status: data.status ?? "active",
			created_at: timestamp,
			updated_at: timestamp,
		};
		await this.db.insertInto("organization_users").values(row).execute();
		return row;
	}

	async updateMemberRole(
		tenant: TenantContext,
		userId: string,
		role: OrganizationUser["role"],
	): Promise<OrganizationUser | undefined> {
		return this.db
			.updateTable("organization_users")
			.set({ role, updated_at: nowIso() })
			.where("organization_id", "=", tenant.organizationId)
			.where("user_id", "=", userId)
			.returningAll()
			.executeTakeFirst();
	}

	async removeMember(tenant: TenantContext, userId: string): Promise<boolean> {
		const result = await this.db
			.deleteFrom("organization_users")
			.where("organization_id", "=", tenant.organizationId)
			.where("user_id", "=", userId)
			.executeTakeFirst();
		return Number(result.numDeletedRows) > 0;
	}
}
