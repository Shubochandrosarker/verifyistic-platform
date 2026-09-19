/**
 * Check-in service (doc 11 §5-6): fast returning-customer lookup + status card.
 * The card answers the front-desk questions at a glance — age status, waiver
 * currency, re-consent, guardian state, attention flags — and a check-in is
 * recorded with same-day idempotency (unique org+customer+date index).
 */
import { ageFromDob, newId } from "@verifyistic/core";
import type { CheckIn, Database, Document } from "@verifyistic/database";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";

const nowIso = () => new Date().toISOString();

export interface StatusCard {
	customer: {
		id: string;
		name: string;
		email: string | null;
		date_of_birth: string | null;
	};
	age_status: "minor" | "adult" | "unknown";
	waiver_status:
		| "current"
		| "expired"
		| "reconsent_required"
		| "missing"
		| "void";
	waiver: {
		document_id: string;
		document_number: string;
		template_name: string;
		template_version_id: string;
		on_latest_version: boolean;
		reconsent_required: boolean;
		guardian_signed: boolean | null;
		signed_at: string;
		expires_at: string | null;
	} | null;
	last_check_in: string | null;
	attention_flags: string[];
}

export interface CheckInServiceDeps {
	now?: () => Date;
}

export class CheckInService {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly deps: CheckInServiceDeps = {},
	) {}

	private now(): Date {
		const injected = this.deps.now as unknown;
		return typeof injected === "function"
			? (injected as () => Date)()
			: new Date();
	}

	/** Search by name fragment, normalized email, or phone fragment (org-scoped).
	 * SQLite/D1 LIKE is case-insensitive for ASCII by default. */
	async search(
		tenant: TenantContext,
		query: string,
		limit = 10,
	): Promise<StatusCard[]> {
		const q = query.trim();
		if (q.length < 2) return [];
		const like = `%${q}%`;
		const customers = await this.db
			.selectFrom("customers")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where((eb) =>
				eb.or([
					eb("first_name", "like", like),
					eb("last_name", "like", like),
					eb("email_normalized", "like", like),
					eb("phone_normalized", "like", like),
				]),
			)
			.orderBy("last_name", "asc")
			.limit(limit)
			.execute();
		const cards: StatusCard[] = [];
		for (const customer of customers) {
			const card = await this.statusCard(tenant, customer.id);
			if (card) cards.push(card);
		}
		return cards;
	}

	/** Full status card for one customer (doc 11 §5). Cross-tenant ids read as missing. */
	async statusCard(
		tenant: TenantContext,
		customerId: string,
	): Promise<StatusCard | undefined> {
		const customer = await this.db
			.selectFrom("customers")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", customerId)
			.executeTakeFirst();
		if (!customer) return undefined;

		const now = this.now();
		const flags: string[] = [];

		const age = customer.date_of_birth
			? ageFromDob(customer.date_of_birth, now)
			: null;
		let ageStatus: StatusCard["age_status"] = "unknown";
		if (age !== null) {
			ageStatus = age < 18 ? "minor" : "adult";
		}
		if (ageStatus === "unknown") flags.push("age_unknown");

		let waiverStatus: StatusCard["waiver_status"] = "missing";
		let waiver: StatusCard["waiver"] = null;

		const waiverDoc = await this.db
			.selectFrom("documents")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("customer_id", "=", customerId)
			.where("status", "=", "completed")
			.orderBy("signed_at", "desc")
			.executeTakeFirst();

		if (!waiverDoc) {
			flags.push("waiver_missing");
		} else {
			const version = (await this.db
				.selectFrom("template_versions")
				.selectAll()
				.where("id", "=", waiverDoc.template_version_id)
				.executeTakeFirst())!;
			const template = (await this.db
				.selectFrom("templates")
				.selectAll()
				.where("id", "=", version.template_id)
				.executeTakeFirst())!;

			const expiresAt =
				waiverDoc.expires_at ??
				(template.default_validity_days !== null
					? new Date(
							new Date(waiverDoc.signed_at).getTime() +
								template.default_validity_days * 86_400_000,
						).toISOString()
					: null);
			const expired = expiresAt !== null && expiresAt <= now.toISOString();
			const onLatest =
				template.current_version_id === waiverDoc.template_version_id;
			// Re-consent is driven by the CURRENT version's flag (doc 07 §9): a newer
			// published version requiring re-consent invalidates the old waiver
			// operationally while historical evidence stays intact.
			let reconsentRequired = false;
			if (!onLatest && template.current_version_id) {
				const currentVersion = await this.db
					.selectFrom("template_versions")
					.select("requires_reconsent")
					.where("id", "=", template.current_version_id)
					.executeTakeFirst();
				reconsentRequired = currentVersion?.requires_reconsent === 1;
			}

			if (expired) {
				waiverStatus = "expired";
				flags.push("waiver_expired");
			} else if (reconsentRequired) {
				waiverStatus = "reconsent_required";
				flags.push("reconsent_required");
			} else {
				waiverStatus = "current";
			}

			// Guardian check for minors: the waiver's session must have a signed guardian.
			let guardianSigned: boolean | null = null;
			if (ageStatus === "minor" && waiverDoc.session_id) {
				const guardian = await this.db
					.selectFrom("signing_participants")
					.select("status")
					.where("session_id", "=", waiverDoc.session_id)
					.where("role", "=", "guardian")
					.executeTakeFirst();
				guardianSigned = guardian?.status === "signed";
				if (!guardianSigned) flags.push("guardian_missing");
			}

			waiver = {
				document_id: waiverDoc.id,
				document_number: waiverDoc.document_number,
				template_name: template.name,
				template_version_id: waiverDoc.template_version_id,
				on_latest_version: onLatest,
				reconsent_required: reconsentRequired,
				guardian_signed: guardianSigned,
				signed_at: waiverDoc.signed_at,
				expires_at: expiresAt,
			};
		}

		const lastCheckIn = await this.db
			.selectFrom("checkins")
			.select("checked_in_at")
			.where("organization_id", "=", tenant.organizationId)
			.where("customer_id", "=", customerId)
			.orderBy("checked_in_at", "desc")
			.limit(1)
			.executeTakeFirst();

		return {
			customer: {
				id: customer.id,
				name: `${customer.first_name} ${customer.last_name}`,
				email: customer.email,
				date_of_birth: customer.date_of_birth,
			},
			age_status: ageStatus,
			waiver_status: waiverStatus,
			waiver,
			last_check_in: lastCheckIn?.checked_in_at ?? null,
			attention_flags: flags,
		};
	}

	/** Record a check-in — same-day duplicates resolve to the existing record (idempotent). */
	async checkIn(
		tenant: TenantContext,
		input: {
			customerId: string;
			siteId?: string | null;
			documentId?: string | null;
			source?: CheckIn["source"];
			metadata?: Record<string, unknown>;
		},
	): Promise<{ checkIn: CheckIn; duplicate: boolean }> {
		const customer = await this.db
			.selectFrom("customers")
			.select("id")
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", input.customerId)
			.executeTakeFirst();
		if (!customer) throw new CustomerNotFoundError();

		const now = this.now();
		const date = now.toISOString().slice(0, 10);
		const existing = await this.db
			.selectFrom("checkins")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("customer_id", "=", input.customerId)
			.where("checked_in_date", "=", date)
			.executeTakeFirst();
		if (existing) return { checkIn: existing, duplicate: true };

		const row: CheckIn = {
			id: newId(),
			organization_id: tenant.organizationId,
			site_id: input.siteId ?? null,
			customer_id: input.customerId,
			document_id: input.documentId ?? null,
			source: input.source ?? "api",
			checked_in_at: now.toISOString(),
			checked_in_date: date,
			staff_actor_type: tenant.actor.type,
			staff_actor_id: tenant.actor.id,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			created_at: now.toISOString(),
		};
		await this.db.insertInto("checkins").values(row).execute();
		return { checkIn: row, duplicate: false };
	}

	async history(
		tenant: TenantContext,
		customerId: string,
		limit = 50,
	): Promise<CheckIn[]> {
		return this.db
			.selectFrom("checkins")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("customer_id", "=", customerId)
			.orderBy("checked_in_at", "desc")
			.limit(limit)
			.execute();
	}
}

export class CustomerNotFoundError extends Error {
	constructor() {
		super("Customer not found.");
		this.name = "CustomerNotFoundError";
	}
}

export type { Document };
