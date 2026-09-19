/**
 * Customer repository — tenant-scoped, cursor-paginated, with contact normalization
 * and guardian/household relationships (data model v1 §2, doc 15 §6 matching rules
 * use the normalized columns).
 */
import { newId } from "@verifyistic/core";
import type {
	Customer,
	CustomerRelationship,
	Database,
} from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import { normalizeEmail, normalizePhone } from "./normalize.js";

const nowIso = () => new Date().toISOString();

export interface CreateCustomerInput {
	firstName: string;
	lastName: string;
	email?: string | null;
	phone?: string | null;
	dateOfBirth?: string | null;
	address?: Record<string, unknown> | null;
	primarySiteId?: string | null;
	externalRef?: string | null;
	source?: string;
}

export interface UpdateCustomerInput {
	firstName?: string;
	lastName?: string;
	email?: string | null;
	phone?: string | null;
	dateOfBirth?: string | null;
	address?: Record<string, unknown> | null;
	primarySiteId?: string | null;
	status?: Customer["status"];
	externalRef?: string | null;
}

export interface ListCustomersOptions {
	limit?: number;
	/** Opaque cursor from the previous page (customers.id of the last row). */
	after?: string;
}

export interface CustomerPage {
	items: Customer[];
	hasMore: boolean;
	nextCursor: string | null;
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

export class CustomersRepository {
	constructor(private readonly db: Kysely<Database>) {}

	async create(
		tenant: TenantContext,
		input: CreateCustomerInput,
	): Promise<Customer> {
		const timestamp = nowIso();
		const row: Customer = {
			id: newId(),
			organization_id: tenant.organizationId,
			primary_site_id: input.primarySiteId ?? null,
			first_name: input.firstName.trim(),
			last_name: input.lastName.trim(),
			email: input.email?.trim() || null,
			email_normalized: normalizeEmail(input.email),
			phone: input.phone?.trim() || null,
			phone_normalized: normalizePhone(input.phone),
			date_of_birth: input.dateOfBirth ?? null,
			address_json: input.address ? JSON.stringify(input.address) : null,
			status: "active",
			source: input.source ?? "api",
			external_ref: input.externalRef ?? null,
			created_at: timestamp,
			updated_at: timestamp,
		};
		await this.db.insertInto("customers").values(row).execute();
		return row;
	}

	async get(
		tenant: TenantContext,
		customerId: string,
	): Promise<Customer | undefined> {
		return this.db
			.selectFrom("customers")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", customerId)
			.executeTakeFirst();
	}

	/** Deterministic matching helper (doc 15 §6): exact normalized email within the tenant. */
	async findByEmail(
		tenant: TenantContext,
		email: string,
	): Promise<Customer | undefined> {
		const normalized = normalizeEmail(email);
		if (!normalized) return undefined;
		return this.db
			.selectFrom("customers")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("email_normalized", "=", normalized)
			.executeTakeFirst();
	}

	/** Newest first, cursor-paginated (route contract: next_cursor + has_more, no unbounded lists). */
	async list(
		tenant: TenantContext,
		options: ListCustomersOptions = {},
	): Promise<CustomerPage> {
		const limit = Math.min(
			Math.max(options.limit ?? DEFAULT_PAGE_LIMIT, 1),
			MAX_PAGE_LIMIT,
		);
		const fetchLimit = limit + 1;

		let query = this.db
			.selectFrom("customers")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(fetchLimit);

		if (options.after) {
			const anchor = await this.get(tenant, options.after);
			if (anchor) {
				query = query.where((eb) =>
					eb.or([
						eb("customers.created_at", "<", anchor.created_at),
						eb.and([
							eb("customers.created_at", "=", anchor.created_at),
							eb("customers.id", "<", anchor.id),
						]),
					]),
				);
			}
		}

		const rows = await query.execute();
		const hasMore = rows.length > limit;
		const items = hasMore ? rows.slice(0, limit) : rows;
		const last = items.at(-1);
		return { items, hasMore, nextCursor: hasMore && last ? last.id : null };
	}

	async update(
		tenant: TenantContext,
		customerId: string,
		patch: UpdateCustomerInput,
	): Promise<Customer | undefined> {
		const set: Partial<Customer> = { updated_at: nowIso() };
		if (patch.firstName !== undefined) set.first_name = patch.firstName.trim();
		if (patch.lastName !== undefined) set.last_name = patch.lastName.trim();
		if (patch.email !== undefined) {
			set.email = patch.email;
			set.email_normalized = normalizeEmail(patch.email);
		}
		if (patch.phone !== undefined) {
			set.phone = patch.phone;
			set.phone_normalized = normalizePhone(patch.phone);
		}
		if (patch.dateOfBirth !== undefined) set.date_of_birth = patch.dateOfBirth;
		if (patch.address !== undefined)
			set.address_json = patch.address ? JSON.stringify(patch.address) : null;
		if (patch.primarySiteId !== undefined)
			set.primary_site_id = patch.primarySiteId;
		if (patch.status !== undefined) set.status = patch.status;
		if (patch.externalRef !== undefined) set.external_ref = patch.externalRef;

		return this.db
			.updateTable("customers")
			.set(set)
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", customerId)
			.returningAll()
			.executeTakeFirst();
	}

	// --- relationships (guardian/minor, household — doc 04 §2) -----------------

	async addRelationship(
		tenant: TenantContext,
		input: {
			customerId: string;
			relatedCustomerId: string;
			relationshipType: CustomerRelationship["relationship_type"];
			metadata?: Record<string, unknown>;
		},
	): Promise<CustomerRelationship> {
		const row: CustomerRelationship = {
			id: newId(),
			organization_id: tenant.organizationId,
			customer_id: input.customerId,
			related_customer_id: input.relatedCustomerId,
			relationship_type: input.relationshipType,
			effective_from: nowIso(),
			effective_to: null,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			created_at: nowIso(),
		};
		await this.db.insertInto("customer_relationships").values(row).execute();
		return row;
	}

	async listRelationships(
		tenant: TenantContext,
		customerId: string,
	): Promise<CustomerRelationship[]> {
		return this.db
			.selectFrom("customer_relationships")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("customer_id", "=", customerId)
			.orderBy("created_at", "asc")
			.execute();
	}

	async removeRelationship(
		tenant: TenantContext,
		relationshipId: string,
	): Promise<boolean> {
		const result = await this.db
			.deleteFrom("customer_relationships")
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", relationshipId)
			.executeTakeFirst();
		return Number(result.numDeletedRows) > 0;
	}
}
