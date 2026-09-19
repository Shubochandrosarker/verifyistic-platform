/**
 * Evidence snapshot (doc 07 §10): the canonical record of what the signer saw,
 * entered, agreed to, and how they signed — persisted BEFORE the PDF renders so a
 * failed render retries without changing what was signed.
 */
import { canonicalJson, sha256Hex } from "@verifyistic/core";
import type {
	Document,
	FieldResponse,
	Signature,
	SigningParticipant,
	SigningSession,
	TemplateVersion,
} from "@verifyistic/database";
import type { Database } from "@verifyistic/database";
import type { Kysely } from "kysely";

export interface EvidenceSnapshot {
	snapshot_version: 1;
	session: {
		id: string;
		status: string;
		created_at: string;
		started_at: string | null;
		completed_at: string | null;
		delivery_method: string;
		requested_by: string | null;
	};
	business: { organization_id: string; name: string; site_id: string | null };
	template: {
		template_id: string;
		template_name: string;
		template_version_id: string;
		version_number: number;
		consent_text_version: string;
		agreement_sha256: string;
		schema: unknown;
	};
	customer: {
		id: string;
		name: string;
		email: string | null;
		date_of_birth: string | null;
	};
	participants: {
		role: string;
		required: boolean;
		status: string;
		email_snapshot: string | null;
		signed_at: string | null;
	}[];
	responses: { field_key: string; value: unknown; value_hash: string }[];
	consents: {
		participant_role: string;
		consent_text_version: string;
		accepted_at: string;
		ip: string | null;
		device: string | null;
	}[];
	signatures: {
		role: string;
		method: string;
		signature_hash: string;
		typed_name: string | null;
		captured_at: string;
		ip: string | null;
		device: string | null;
		artifact_pending_storage: boolean;
	}[];
	shown_conditionals: string[];
	conditional_decisions: {
		field_key: string;
		expected: unknown;
		shown: boolean;
	}[];
}

export interface EvidenceData {
	snapshot: EvidenceSnapshot;
	snapshotBytes: Uint8Array;
	snapshotSha256: string;
}

/** Load everything needed to build the snapshot for a processing session. */
export async function buildEvidenceSnapshot(
	db: Kysely<Database>,
	sessionId: string,
): Promise<EvidenceData> {
	const session = (await db
		.selectFrom("signing_sessions")
		.selectAll()
		.where("id", "=", sessionId)
		.executeTakeFirst())!;
	if (!session) throw new Error(`Signing session not found: ${sessionId}`);

	const version = (await db
		.selectFrom("template_versions")
		.selectAll()
		.where("id", "=", session.template_version_id)
		.executeTakeFirst())!;
	const template = (await db
		.selectFrom("templates")
		.selectAll()
		.where("id", "=", version.template_id)
		.executeTakeFirst())!;
	const org = (await db
		.selectFrom("organizations")
		.select(["name"])
		.where("id", "=", session.organization_id)
		.executeTakeFirst())!;
	const customer = (await db
		.selectFrom("customers")
		.selectAll()
		.where("id", "=", session.customer_id)
		.executeTakeFirst())!;
	const participants = await db
		.selectFrom("signing_participants")
		.selectAll()
		.where("session_id", "=", sessionId)
		.orderBy("created_at", "asc")
		.execute();
	const responses = await db
		.selectFrom("field_responses")
		.selectAll()
		.where("session_id", "=", sessionId)
		.orderBy("created_at", "asc")
		.execute();
	const signatures = await db
		.selectFrom("signatures")
		.selectAll()
		.where("session_id", "=", sessionId)
		.orderBy("captured_at", "asc")
		.execute();

	const participantById = new Map(participants.map((p) => [p.id, p]));
	const metadata = session.metadata
		? (JSON.parse(session.metadata) as {
				shown_conditionals?: string[];
				conditional_decisions?: EvidenceSnapshot["conditional_decisions"];
			})
		: {};

	const snapshot: EvidenceSnapshot = {
		snapshot_version: 1,
		session: {
			id: session.id,
			status: session.status,
			created_at: session.created_at,
			started_at: session.started_at,
			completed_at: session.completed_at,
			delivery_method: session.delivery_method,
			requested_by: session.requested_by,
		},
		business: {
			organization_id: session.organization_id,
			name: org?.name ?? "",
			site_id: session.site_id,
		},
		template: {
			template_id: template!.id,
			template_name: template!.name,
			template_version_id: version!.id,
			version_number: version!.version_number,
			consent_text_version: version!.consent_text_version,
			agreement_sha256: version!.source_hash_sha256,
			schema: JSON.parse(version!.document_schema_json),
		},
		customer: {
			id: customer?.id ?? "",
			name: customer ? `${customer.first_name} ${customer.last_name}` : "",
			email: customer?.email ?? null,
			date_of_birth: customer?.date_of_birth ?? null,
		},
		participants: participants.map((p: SigningParticipant) => ({
			role: p.role,
			required: p.required === 1,
			status: p.status,
			email_snapshot: p.email_snapshot,
			signed_at: p.signed_at,
		})),
		responses: responses
			.filter((r: FieldResponse) => !r.field_key.startsWith("__consent_"))
			.map((r: FieldResponse) => ({
				field_key: r.field_key,
				value: JSON.parse(r.value_json),
				value_hash: r.value_hash,
			})),
		consents: responses
			.filter((r: FieldResponse) => r.field_key.startsWith("__consent_"))
			.map((r: FieldResponse) => {
				const value = JSON.parse(r.value_json) as {
					consent_text_version: string;
					accepted_at: string;
					ip: string | null;
					device: string | null;
				};
				const participant = r.participant_id
					? participantById.get(r.participant_id)
					: undefined;
				return {
					participant_role: participant?.role ?? "signer",
					consent_text_version: value.consent_text_version,
					accepted_at: value.accepted_at,
					ip: value.ip,
					device: value.device,
				};
			}),
		signatures: signatures.map((s: Signature) => {
			const participant = participantById.get(s.participant_id);
			return {
				role: participant?.role ?? "signer",
				method: s.method,
				signature_hash: s.signature_hash,
				typed_name: s.typed_name,
				captured_at: s.captured_at,
				ip: s.ip,
				device: s.user_agent_safe_snapshot,
				artifact_pending_storage: s.storage_key === null,
			};
		}),
		shown_conditionals: metadata.shown_conditionals ?? [],
		conditional_decisions: metadata.conditional_decisions ?? [],
	};

	const snapshotBytes = new TextEncoder().encode(
		JSON.stringify(snapshot, null, 2),
	);
	return {
		snapshot,
		snapshotBytes,
		snapshotSha256: await sha256Hex(snapshotBytes),
	};
}

/** Canonical JSON of the snapshot (for hashing inside certificates) — one serializer only. */
export function snapshotCanonical(snapshot: EvidenceSnapshot): string {
	return canonicalJson(snapshot);
}

/** Human-readable body for the fallback signed PDF (Unicode sanitizer runs in the renderer). */
export function snapshotToPdfSections(
	snapshot: EvidenceSnapshot,
): { heading: string; lines: string[] }[] {
	return [
		{
			heading: "Agreement",
			lines: [
				`Business: ${snapshot.business.name}`,
				`Template: ${snapshot.template.template_name} (version ${snapshot.template.version_number})`,
				`Agreement SHA-256: ${snapshot.template.agreement_sha256}`,
			],
		},
		{
			heading: "Participant",
			lines: [
				`Name: ${snapshot.customer.name}`,
				`Email: ${snapshot.customer.email ?? "-"}`,
				...(snapshot.customer.date_of_birth
					? [`Date of birth: ${snapshot.customer.date_of_birth}`]
					: []),
			],
		},
		{
			heading: "Responses",
			lines: snapshot.responses.map(
				(r) => `${r.field_key}: ${JSON.stringify(r.value) ?? "-"}`,
			),
		},
		{
			heading: "Signatures",
			lines: snapshot.signatures.map(
				(s) =>
					`${s.role}: ${s.method} signature · captured ${s.captured_at} · hash ${s.signature_hash.slice(0, 16)}…${s.typed_name ? ` · "${s.typed_name}"` : ""}`,
			),
		},
		{
			heading: "Consent",
			lines: snapshot.consents.map(
				(c) =>
					`${c.participant_role}: consent ${c.consent_text_version} accepted ${c.accepted_at}`,
			),
		},
	];
}

export type { Document, SigningSession };
