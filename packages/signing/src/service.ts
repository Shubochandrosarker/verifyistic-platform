/**
 * Signing engine (doc 03 §7 completion transaction, doc 07 lifecycle).
 * - Raw signer tokens exist only at creation and in the URL — persist hash only.
 * - The guardian branch is decided server-side from DOB + template policy (doc 07 §7).
 * - Completion: validate → persist responses/consent/signatures → processing (single
 *   transition; duplicates are idempotent no-ops) → worker finalizes to completed.
 */
import type { AuditService } from "@verifyistic/audit";
import {
	canonicalJson,
	chainEventHash,
	generateSignerToken,
	hashSignerToken,
	newId,
	sha256Hex,
} from "@verifyistic/core";
import { type SigningSessionStatus, assertTransition } from "@verifyistic/core";
import type { CustomersRepository } from "@verifyistic/customers";
import type {
	Database,
	FieldResponse,
	Signature,
	SigningParticipant,
	SigningSession,
	TemplateVersion,
} from "@verifyistic/database";
import type { TemplateService } from "@verifyistic/templates";
import type { DocumentSchema } from "@verifyistic/templates";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import { ageFromDob, isMinor } from "./age.js";
import { type ConditionalDecision, validateSubmittedFields } from "./fields.js";

const nowIso = () => new Date().toISOString();
const DEFAULT_EXPIRES_IN_SECONDS = 604_800; // 7 days (doc 05 §4 example)
const MAX_ARTIFACT_CHARS = 700_000; // drawn PNG data-URL cap (moves to storage in Phase 5)

export class TokenNotFoundError extends Error {
	constructor() {
		super("Signing session not found.");
		this.name = "TokenNotFoundError";
	}
}

export class TokenExpiredError extends Error {
	constructor() {
		super("This signing link has expired.");
		this.name = "TokenExpiredError";
	}
}

export class TokenRevokedError extends Error {
	constructor() {
		super("This signing link is no longer usable.");
		this.name = "TokenRevokedError";
	}
}

export class SessionStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionStateError";
	}
}

export class FieldValidationError extends Error {
	readonly fields: Record<string, string[]>;
	constructor(fields: Record<string, string[]>) {
		super("One or more fields are invalid.");
		this.name = "FieldValidationError";
		this.fields = fields;
	}
}

export interface CreateSessionInput {
	template_id: string;
	customer_id: string;
	site_id?: string | null;
	expires_in_seconds?: number;
	delivery_method?: string;
	metadata?: Record<string, unknown>;
}

export interface SignatureSubmission {
	role: "signer" | "guardian";
	method: "drawn" | "typed";
	typed_name?: string;
	/** Drawn signature as a PNG data URL; bytes move to object storage in Phase 5. */
	artifact?: string;
}

export interface CompletePayload {
	values: Record<string, unknown>;
	consent: { accepted: boolean };
	signatures: SignatureSubmission[];
}

export interface CompletionResult {
	session: SigningSession;
	already_finalizing: boolean;
	signature_set_hash: string;
}

interface ResolvedSession {
	session: SigningSession;
	version: TemplateVersion;
	participants: SigningParticipant[];
}

const SAFE_UA = (ua: string | undefined): string | null => {
	if (!ua) return null;
	const platform = /iPhone|iPad/i.test(ua)
		? "iOS"
		: /Android/i.test(ua)
			? "Android"
			: /Windows/i.test(ua)
				? "Windows"
				: /Mac/i.test(ua)
					? "macOS"
					: "Other";
	const browser = /Edg\//i.test(ua)
		? "Edge"
		: /Chrome/i.test(ua)
			? "Chrome"
			: /Safari/i.test(ua)
				? "Safari"
				: /Firefox/i.test(ua)
					? "Firefox"
					: "Other";
	return `${platform}/${browser}`;
};

export class SigningService {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly deps: {
			templates: TemplateService;
			customers: CustomersRepository;
			audit: AuditService;
		},
	) {}

	// --- business operations (tenant-scoped) ---------------------------------

	async createSession(
		tenant: TenantContext,
		input: CreateSessionInput,
	): Promise<{
		session: SigningSession;
		participants: SigningParticipant[];
		token: string;
	}> {
		const template = await this.deps.templates.get(tenant, input.template_id);
		if (!template) throw new TokenNotFoundError();
		if (!template.current_version_id || template.status !== "published") {
			throw new SessionStateError(
				"Template has no published version — publish it first.",
			);
		}
		const version = (await this.deps.templates.getVersion(
			tenant,
			template.current_version_id,
		))!;
		const customer = await this.deps.customers.get(tenant, input.customer_id);
		if (!customer) throw new TokenNotFoundError();

		const expiresIn = input.expires_in_seconds ?? DEFAULT_EXPIRES_IN_SECONDS;
		const token = generateSignerToken();
		const tokenHash = await hashSignerToken(token);
		const now = new Date();
		const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();

		// Server-side guardian branch (doc 07 §7): DOB + template policy decide, never the client.
		const guardianPolicy = template.guardian_policy_json
			? (JSON.parse(template.guardian_policy_json) as { min_age?: number })
			: {};
		const needsGuardian =
			typeof guardianPolicy.min_age === "number" &&
			customer.date_of_birth !== null &&
			isMinor(customer.date_of_birth, guardianPolicy.min_age, now);

		const session: SigningSession = {
			id: newId(),
			organization_id: tenant.organizationId,
			site_id: input.site_id ?? customer.primary_site_id ?? null,
			template_version_id: version.id,
			customer_id: customer.id,
			status: "created",
			token_hash: tokenHash,
			token_expires_at: expiresAt,
			token_revoked_at: null,
			delivery_method: input.delivery_method ?? "link",
			requested_by: tenant.actor.id,
			started_at: null,
			completed_at: null,
			declined_at: null,
			expires_at: expiresAt,
			metadata: JSON.stringify(input.metadata ?? {}),
			created_at: nowIso(),
			updated_at: nowIso(),
		};
		await this.db.insertInto("signing_sessions").values(session).execute();

		const participants: SigningParticipant[] = [];
		const signer: SigningParticipant = {
			id: newId(),
			organization_id: tenant.organizationId,
			session_id: session.id,
			customer_id: customer.id,
			role: "signer",
			email_snapshot: customer.email,
			phone_snapshot: customer.phone,
			required: 1,
			status: "pending",
			signed_at: null,
			created_at: nowIso(),
		};
		await this.db.insertInto("signing_participants").values(signer).execute();
		participants.push(signer);

		if (needsGuardian) {
			const guardian: SigningParticipant = {
				id: newId(),
				organization_id: tenant.organizationId,
				session_id: session.id,
				customer_id: null, // guardian identity is captured at completion
				role: "guardian",
				email_snapshot: null,
				phone_snapshot: null,
				required: 1,
				status: "pending",
				signed_at: null,
				created_at: nowIso(),
			};
			await this.db
				.insertInto("signing_participants")
				.values(guardian)
				.execute();
			participants.push(guardian);
		}

		await this.deps.audit.record(tenant, {
			eventType: "signing_session.created",
			entityType: "signing_session",
			entityId: session.id,
			data: {
				template_id: template.id,
				template_version_id: version.id,
				customer_id: customer.id,
				guardian_required: needsGuardian,
			},
		});

		return { session, participants, token };
	}

	async get(
		tenant: TenantContext,
		sessionId: string,
	): Promise<SigningSession | undefined> {
		return this.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", sessionId)
			.executeTakeFirst();
	}

	async list(
		tenant: TenantContext,
		status?: SigningSessionStatus,
	): Promise<SigningSession[]> {
		let query = this.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "desc")
			.limit(100);
		if (status) query = query.where("status", "=", status);
		return query.execute();
	}

	/** Business user re-sends the link: created/sent → sent. The token is unchanged. */
	async resend(
		tenant: TenantContext,
		sessionId: string,
	): Promise<SigningSession | undefined> {
		const session = await this.get(tenant, sessionId);
		if (!session) return undefined;
		assertTransition(session.status, "sent");
		const updated = await this.db
			.updateTable("signing_sessions")
			.set({ status: "sent", updated_at: nowIso() })
			.where("id", "=", session.id)
			.returningAll()
			.executeTakeFirst();
		await this.deps.audit.record(tenant, {
			eventType: "signing_session.sent",
			entityType: "signing_session",
			entityId: sessionId,
			data: { via: "resend" },
		});
		return updated;
	}

	/** Authorized business user terminates the request; the token becomes unusable. */
	async cancel(
		tenant: TenantContext,
		sessionId: string,
	): Promise<SigningSession | undefined> {
		const session = await this.get(tenant, sessionId);
		if (!session) return undefined;
		assertTransition(session.status, "cancelled");
		const updated = await this.db
			.updateTable("signing_sessions")
			.set({
				status: "cancelled",
				token_revoked_at: nowIso(),
				updated_at: nowIso(),
			})
			.where("id", "=", session.id)
			.returningAll()
			.executeTakeFirst();
		await this.deps.audit.record(tenant, {
			eventType: "signing_session.cancelled",
			entityType: "signing_session",
			entityId: sessionId,
			data: { actor: tenant.actor },
		});
		return updated;
	}

	// --- signer transport (token-authenticated) ------------------------------

	private async resolveByToken(token: string): Promise<ResolvedSession> {
		if (token.length < 20 || token.length > 200) throw new TokenNotFoundError();
		const tokenHash = await hashSignerToken(token);
		const session = await this.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("token_hash", "=", tokenHash)
			.executeTakeFirst();
		if (!session) throw new TokenNotFoundError();
		if (session.token_revoked_at !== null) throw new TokenRevokedError();

		const participants = await this.db
			.selectFrom("signing_participants")
			.selectAll()
			.where("session_id", "=", session.id)
			.orderBy("created_at", "asc")
			.execute();

		const version = (await this.db
			.selectFrom("template_versions")
			.selectAll()
			.where("id", "=", session.template_version_id)
			.executeTakeFirst())!;

		// Lazy expiry: an overdue open session transitions to expired on next touch.
		if (
			session.token_expires_at <= nowIso() &&
			(session.status === "created" ||
				session.status === "sent" ||
				session.status === "viewed" ||
				session.status === "in_progress")
		) {
			await this.db
				.updateTable("signing_sessions")
				.set({
					status: "expired",
					token_revoked_at: nowIso(),
					updated_at: nowIso(),
				})
				.where("id", "=", session.id)
				.execute();
			throw new TokenExpiredError();
		}
		return { session, version, participants };
	}

	/** Open the signer view: created→sent→viewed, start clock, return the sanitized view. */
	async openByToken(
		token: string,
	): Promise<{ view: SignerView; session: SigningSession }> {
		const { session, version, participants } = await this.resolveByToken(token);
		if (
			session.status === "processing" ||
			session.status === "completed" ||
			session.status === "viewed"
		) {
			// Idempotent open — re-loading the signer page never re-runs transitions.
			return {
				view: await this.buildView(session, version, participants),
				session,
			};
		}
		if (!["created", "sent"].includes(session.status)) {
			throw new SessionStateError(`Session is ${session.status}.`);
		}
		const now = nowIso();
		let status: SigningSessionStatus = session.status;
		if (status === "created") {
			assertTransition(status, "sent");
			status = "sent";
		}
		assertTransition(status, "viewed");
		const updated = (await this.db
			.updateTable("signing_sessions")
			.set({
				status: "viewed",
				started_at: session.started_at ?? now,
				updated_at: now,
			})
			.where("id", "=", session.id)
			.returningAll()
			.executeTakeFirst())!;
		await this.auditForSession(updated, "signing_session.viewed", {});
		return {
			view: await this.buildView(updated, version, participants),
			session: updated,
		};
	}

	/** Save partial progress; viewed → in_progress; upserts responses by field_key. */
	async saveProgress(
		token: string,
		values: Record<string, unknown>,
	): Promise<{ saved: number }> {
		const { session } = await this.resolveByToken(token);
		if (session.status === "processing" || session.status === "completed") {
			throw new SessionStateError("Session already finalized.");
		}
		if (!["viewed", "in_progress"].includes(session.status)) {
			throw new SessionStateError(`Session is ${session.status}.`);
		}
		if (session.status === "viewed") assertTransition("viewed", "in_progress");
		await this.db
			.updateTable("signing_sessions")
			.set({ status: "in_progress", updated_at: nowIso() })
			.where("id", "=", session.id)
			.execute();

		const signer = (await this.db
			.selectFrom("signing_participants")
			.selectAll()
			.where("session_id", "=", session.id)
			.where("role", "=", "signer")
			.executeTakeFirst())!;
		let saved = 0;
		for (const [fieldKey, value] of Object.entries(values)) {
			const valueJson = JSON.stringify(value ?? null);
			const valueHash = await sha256Hex(valueJson);
			const existing = await this.db
				.selectFrom("field_responses")
				.select("id")
				.where("session_id", "=", session.id)
				.where("field_key", "=", fieldKey)
				.executeTakeFirst();
			if (existing) {
				await this.db
					.updateTable("field_responses")
					.set({ value_json: valueJson, value_hash: valueHash })
					.where("id", "=", existing.id)
					.execute();
			} else {
				const row: FieldResponse = {
					id: newId(),
					organization_id: session.organization_id,
					session_id: session.id,
					participant_id: signer.id,
					field_key: fieldKey,
					field_type: "any",
					value_json: valueJson,
					value_hash: valueHash,
					created_at: nowIso(),
				};
				await this.db.insertInto("field_responses").values(row).execute();
			}
			saved += 1;
		}
		return { saved };
	}

	/**
	 * Completion transaction (doc 03 §7 steps 1–9): validate token/status/expiry →
	 * validate required fields → persist responses + consent + signatures → mark
	 * processing. Duplicate submissions are idempotent no-ops; a second signature
	 * or document can never be created.
	 */
	async complete(
		token: string,
		payload: CompletePayload,
		context: { ip?: string; userAgent?: string } = {},
	): Promise<CompletionResult> {
		const { session, version, participants } = await this.resolveByToken(token);
		if (session.status === "processing" || session.status === "completed") {
			// Duplicate submit: same logical result, no second document (doc 17 §3).
			return {
				session,
				already_finalizing: true,
				signature_set_hash: "",
			};
		}
		if (!["viewed", "in_progress"].includes(session.status)) {
			throw new SessionStateError(
				`Session is ${session.status} — completion not allowed.`,
			);
		}
		if (!payload.consent?.accepted) {
			throw new FieldValidationError({
				consent: ["Electronic signature consent must be accepted."],
			});
		}

		const schema = JSON.parse(version.document_schema_json) as DocumentSchema;
		const values = payload.values ?? {};
		const { decisions, result } = validateSubmittedFields(schema, values);
		if (!result.valid) throw new FieldValidationError(result.errors);

		// Required participants must all sign (signer always; guardian when the branch applied).
		const signer = participants.find((p) => p.role === "signer");
		const guardian = participants.find((p) => p.role === "guardian");
		if (!signer) throw new SessionStateError("Signer participant missing.");

		const now = nowIso();
		const uaSnapshot = SAFE_UA(context.userAgent);

		// Validate signature submissions against required participants.
		const signatureRows: {
			participant: SigningParticipant;
			submission: SignatureSubmission;
			signatureHash: string;
		}[] = [];
		for (const participant of [signer, guardian]) {
			if (!participant) continue;
			const submission = payload.signatures?.find(
				(s) => s.role === participant.role,
			);
			if (!submission) {
				throw new FieldValidationError({
					[`${participant.role}_signature`]: ["Signature is required."],
				});
			}
			if (submission.method !== "drawn" && submission.method !== "typed") {
				throw new FieldValidationError({
					[`${participant.role}_signature`]: ["method must be drawn or typed."],
				});
			}
			if (
				submission.method === "typed" &&
				(!submission.typed_name || submission.typed_name.trim().length === 0)
			) {
				throw new FieldValidationError({
					[`${participant.role}_signature`]: [
						"Type your full legal name to sign.",
					],
				});
			}
			if (submission.method === "drawn") {
				if (
					typeof submission.artifact !== "string" ||
					!submission.artifact.startsWith("data:image/png;base64,")
				) {
					throw new FieldValidationError({
						[`${participant.role}_signature`]: [
							"Draw a signature or switch to typed.",
						],
					});
				}
				if (submission.artifact.length > MAX_ARTIFACT_CHARS) {
					throw new FieldValidationError({
						[`${participant.role}_signature`]: ["Signature image too large."],
					});
				}
			}
			const signatureHash = await sha256Hex(
				canonicalJson({
					method: submission.method,
					typed_name: submission.typed_name ?? null,
					artifact_sha256: submission.artifact
						? await sha256Hex(submission.artifact)
						: null,
				}),
			);
			signatureRows.push({ participant, submission, signatureHash });
		}

		// Persist field responses (evidence snapshot of exactly what was submitted).
		for (const [fieldKey, value] of Object.entries(values)) {
			const valueJson = JSON.stringify(value ?? null);
			const valueHash = await sha256Hex(valueJson);
			const existing = await this.db
				.selectFrom("field_responses")
				.select("id")
				.where("session_id", "=", session.id)
				.where("field_key", "=", fieldKey)
				.executeTakeFirst();
			if (existing) {
				await this.db
					.updateTable("field_responses")
					.set({ value_json: valueJson, value_hash: valueHash })
					.where("id", "=", existing.id)
					.execute();
			} else {
				await this.db.insertInto("field_responses").values({
					id: newId(),
					organization_id: session.organization_id,
					session_id: session.id,
					participant_id: signer.id,
					field_key: fieldKey,
					field_type: "any",
					value_json: valueJson,
					value_hash: valueHash,
					created_at: now,
				});
			}
		}

		// Consent event per participant (doc 07 §6): version + timestamp + safe context.
		for (const { participant } of signatureRows) {
			await this.db.insertInto("field_responses").values({
				id: newId(),
				organization_id: session.organization_id,
				session_id: session.id,
				participant_id: participant.id,
				field_key: `__consent_${participant.role}`,
				field_type: "consent",
				value_json: JSON.stringify({
					consent_text_version: version.consent_text_version,
					template_version_id: version.id,
					accepted: true,
					accepted_at: now,
					ip: context.ip ?? null,
					device: uaSnapshot,
				}),
				value_hash: await sha256Hex(version.id),
				created_at: now,
			});
		}

		// Persist signatures + participant status.
		for (const { participant, submission, signatureHash } of signatureRows) {
			const signature: Signature = {
				id: newId(),
				organization_id: session.organization_id,
				session_id: session.id,
				participant_id: participant.id,
				method: submission.method,
				storage_key: null, // Phase 5: artifact bytes → object storage
				signature_hash: signatureHash,
				typed_name: submission.typed_name ?? null,
				captured_at: now,
				ip: context.ip ?? null,
				user_agent_safe_snapshot: uaSnapshot,
				metadata: submission.artifact
					? JSON.stringify({ artifact_pending_storage: true })
					: null,
			};
			await this.db.insertInto("signatures").values(signature).execute();
			await this.db
				.updateTable("signing_participants")
				.set({ status: "signed", signed_at: now })
				.where("id", "=", participant.id)
				.execute();
		}

		// viewed → in_progress → processing (state machine path).
		const inProgress =
			session.status === "viewed" ? "in_progress" : session.status;
		assertTransition(inProgress, "processing");

		const signatureSetHash = await chainEventHash(version.source_hash_sha256, {
			signatures: signatureRows.map((row) => ({
				role: row.participant.role,
				method: row.submission.method,
				signature_hash: row.signatureHash,
			})),
		});

		const updated = (await this.db
			.updateTable("signing_sessions")
			.set({
				status: "processing",
				metadata: JSON.stringify({
					...(session.metadata ? JSON.parse(session.metadata) : {}),
					shown_conditionals: decisions
						.filter((d) => d.shown)
						.map((d) => d.field_key),
					conditional_decisions: decisions satisfies ConditionalDecision[],
				}),
				updated_at: now,
			})
			.where("id", "=", session.id)
			.returningAll()
			.executeTakeFirst())!;

		await this.auditForSession(updated, "signing_session.completed", {
			template_version_id: version.id,
			agreement_hash: version.source_hash_sha256,
			signature_set_hash: signatureSetHash,
			guardian_signed: Boolean(guardian),
		});

		return {
			session: updated,
			already_finalizing: false,
			signature_set_hash: signatureSetHash,
		};
	}

	/** Signer explicitly declines: no completed document, token dead. */
	async decline(
		token: string,
		reason: string | undefined,
		context: { ip?: string } = {},
	): Promise<SigningSession> {
		const { session } = await this.resolveByToken(token);
		if (!["viewed", "in_progress"].includes(session.status)) {
			throw new SessionStateError(
				`Session is ${session.status} — decline not allowed.`,
			);
		}
		assertTransition(session.status, "declined");
		const now = nowIso();
		const updated = (await this.db
			.updateTable("signing_sessions")
			.set({
				status: "declined",
				declined_at: now,
				token_revoked_at: now,
				updated_at: now,
			})
			.where("id", "=", session.id)
			.returningAll()
			.executeTakeFirst())!;
		await this.db
			.updateTable("signing_participants")
			.set({ status: "declined" })
			.where("session_id", "=", session.id)
			.execute();
		await this.auditForSession(updated, "signing_session.declined", {
			reason: typeof reason === "string" ? reason.slice(0, 500) : null,
			ip: context.ip ?? null,
		});
		return updated;
	}

	/**
	 * Worker seam (Phase 5 wires PDF finalization before this): processing → completed.
	 * A failed PDF job retries finalization from the stored signed payload (doc 03 §7).
	 */
	async finalizeSession(
		sessionId: string,
	): Promise<SigningSession | undefined> {
		const session = (await this.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("id", "=", sessionId)
			.executeTakeFirst())!;
		if (!session || session.status !== "processing") return undefined;
		assertTransition("processing", "completed");
		const updated = (await this.db
			.updateTable("signing_sessions")
			.set({
				status: "completed",
				completed_at: nowIso(),
				updated_at: nowIso(),
			})
			.where("id", "=", sessionId)
			.returningAll()
			.executeTakeFirst())!;
		await this.auditForSession(updated, "signing_session.finalized", {});
		return updated;
	}

	// --- helpers -------------------------------------------------------------

	private async auditForSession(
		session: SigningSession,
		eventType: string,
		data: Record<string, unknown>,
	): Promise<void> {
		await this.deps.audit.record(
			{
				organizationId: session.organization_id,
				actor: { type: "signer", id: session.id },
			},
			{ eventType, entityType: "signing_session", entityId: session.id, data },
		);
	}

	private async buildView(
		session: SigningSession,
		version: TemplateVersion,
		participants: SigningParticipant[],
	): Promise<SignerView> {
		const org = (await this.db
			.selectFrom("organizations")
			.select(["name"])
			.where("id", "=", session.organization_id)
			.executeTakeFirst())!;
		return {
			session_id: session.id,
			status: session.status,
			business_name: org.name,
			template_title: version.title,
			template_version: version.version_number,
			consent_text_version: version.consent_text_version,
			schema: JSON.parse(version.document_schema_json) as DocumentSchema,
			participants: participants.map((p) => ({
				role: p.role,
				required: p.required === 1,
				status: p.status,
			})),
			expires_at: session.token_expires_at,
		};
	}
}

/** Sanitized signer view — no token material, no internal hashes, no raw PII beyond the form itself. */
export interface SignerView {
	session_id: string;
	status: SigningSessionStatus;
	business_name: string;
	template_title: string;
	template_version: number;
	consent_text_version: string;
	schema: DocumentSchema;
	participants: { role: string; required: boolean; status: string }[];
	expires_at: string;
}
