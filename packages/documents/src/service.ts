/**
 * DocumentService (doc 08): turns a processing session into verifiable protected artifacts.
 *
 * Finalization sequence (non-circular hashing, doc 08 §4):
 *   1. build + persist immutable evidence snapshot;
 *   2. render signed.pdf from the snapshot;
 *   3. hash signed.pdf;
 *   4. render audit certificate CONTAINING that hash (separate artifact);
 *   5. write manifest.json referencing all hashes;
 *   6. create the document row (audit_chain_hash = document.generated event hash);
 *   7. mark the session completed.
 * A failed step leaves the session in `processing` for retry — the signer's action is
 * never lost (doc 18 §10). Completed bytes are immutable; void is metadata + audit only.
 */
import type { AuditService } from "@verifyistic/audit";
import { newId, sha256Hex } from "@verifyistic/core";
import type { Database, Document } from "@verifyistic/database";
import type { StorageProvider } from "@verifyistic/storage";
import type { TenantContext } from "@verifyistic/tenancy";
import type { Kysely } from "kysely";
import {
	type EvidenceSnapshot,
	buildEvidenceSnapshot,
	snapshotToPdfSections,
} from "./evidence.js";
import { renderSimplePdf } from "./pdf.js";

const nowIso = () => new Date().toISOString();

export class DocumentNotFoundError extends Error {
	constructor() {
		super("Document not found.");
		this.name = "DocumentNotFoundError";
	}
}

export interface FinalizeResult {
	document: Document;
}

export class DocumentService {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly deps: {
			storage: StorageProvider;
			audit: AuditService;
			verifyBaseUrl?: string;
		},
	) {}

	private documentPrefix(organizationId: string, documentId: string): string {
		return `tenants/${organizationId}/documents/${documentId}`;
	}

	private async nextDocumentNumber(organizationId: string): Promise<string> {
		const row = await this.db
			.selectFrom("documents")
			.select(({ fn }) => [fn.count("id").as("n")])
			.where("organization_id", "=", organizationId)
			.executeTakeFirst();
		const seq = Number(row?.n ?? 0) + 1;
		return `DOC-${new Date().getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
	}

	/** Finalize a processing session into protected artifacts + document row. */
	async finalize(sessionId: string): Promise<FinalizeResult | undefined> {
		const session = await this.db
			.selectFrom("signing_sessions")
			.selectAll()
			.where("id", "=", sessionId)
			.executeTakeFirst();
		if (!session || session.status !== "processing") return undefined;

		const documentId = newId();
		const prefix = this.documentPrefix(session.organization_id, documentId);
		const evidence = await buildEvidenceSnapshot(this.db, sessionId);
		const snapshot = evidence.snapshot;

		// 1. evidence snapshot (immutable artifact)
		const snapshotKey = `${prefix}/source-snapshot.json`;
		await this.deps.storage.put(snapshotKey, evidence.snapshotBytes, {
			contentType: "application/json",
			immutable: true,
		});

		// 2–3. signed.pdf, then hash it (no hash-inside-its-own-file)
		const verifyUrl = `${this.deps.verifyBaseUrl ?? "https://verifyistic.com"}/verify/${documentId}`;
		const signedPdf = renderSimplePdf({
			title: snapshot.template.template_name,
			subtitle: `${snapshot.business.name} · version ${snapshot.template.version_number}`,
			sections: snapshotToPdfSections(snapshot),
			footer: `${documentId} · ${verifyUrl}`,
		});
		const signedPdfKey = `${prefix}/signed.pdf`;
		const signedMeta = await this.deps.storage.put(signedPdfKey, signedPdf, {
			contentType: "application/pdf",
			immutable: true,
		});

		// 4. audit certificate — rendered separately, contains the signed.pdf hash
		const certificate = renderSimplePdf({
			title: "Audit Certificate",
			subtitle: `Document ${documentId}`,
			sections: [
				{
					heading: "Integrity",
					lines: [
						`Signed PDF SHA-256: ${signedMeta.sha256}`,
						`Agreement SHA-256: ${snapshot.template.agreement_sha256}`,
						`Snapshot SHA-256: ${evidence.snapshotSha256}`,
					],
				},
				{
					heading: "Signing",
					lines: [
						`Business: ${snapshot.business.name}`,
						`Template: ${snapshot.template.template_name} (v${snapshot.template.version_number})`,
						`Signer: ${snapshot.customer.name}`,
						...snapshot.signatures.map(
							(s) => `${s.role}: ${s.method} at ${s.captured_at}`,
						),
						...snapshot.consents.map(
							(c) =>
								`Consent (${c.participant_role}): ${c.consent_text_version} accepted ${c.accepted_at}`,
						),
					],
				},
				{ heading: "Verification", lines: [verifyUrl] },
			],
			footer: `Certificate for ${documentId}`,
		});
		const certificateKey = `${prefix}/certificate.pdf`;
		const certificateMeta = await this.deps.storage.put(
			certificateKey,
			certificate,
			{
				contentType: "application/pdf",
				immutable: true,
			},
		);

		// 5. manifest — references every hash
		const signatureSetSha256 = await this.computeSignatureSetHash(sessionId);
		const manifest = {
			document_uuid: documentId,
			artifacts: {
				"signed.pdf": { sha256: signedMeta.sha256, size: signedMeta.size },
				"certificate.pdf": {
					sha256: certificateMeta.sha256,
					size: certificateMeta.size,
				},
				"source-snapshot.json": {
					sha256: evidence.snapshotSha256,
					size: evidence.snapshotBytes.byteLength,
				},
			},
			agreement_sha256: snapshot.template.agreement_sha256,
			signature_set_sha256: signatureSetSha256,
			template: {
				id: snapshot.template.template_id,
				version: snapshot.template.version_number,
			},
			signed_at: snapshot.consents[0]?.accepted_at ?? nowIso(),
			verification_url: verifyUrl,
		};
		const manifestBytes = new TextEncoder().encode(
			JSON.stringify(manifest, null, 2),
		);
		const manifestKey = `${prefix}/manifest.json`;
		await this.deps.storage.put(manifestKey, manifestBytes, {
			contentType: "application/json",
			immutable: true,
		});

		// 6. document row + audit
		const now = nowIso();
		const document: Document = {
			id: documentId,
			organization_id: session.organization_id,
			site_id: session.site_id,
			customer_id: session.customer_id,
			session_id: session.id,
			template_version_id: session.template_version_id,
			status: "completed",
			document_number: await this.nextDocumentNumber(session.organization_id),
			signed_at: manifest.signed_at,
			expires_at: null,
			storage_key_signed_pdf: signedPdfKey,
			storage_key_certificate_pdf: certificateKey,
			storage_key_manifest: manifestKey,
			storage_key_source_snapshot: snapshotKey,
			signed_pdf_sha256: signedMeta.sha256!,
			certificate_sha256: certificateMeta.sha256!,
			agreement_sha256: snapshot.template.agreement_sha256,
			signature_set_sha256: signatureSetSha256,
			audit_chain_hash: "",
			retention_until: null,
			legal_hold: 0,
			voided_at: null,
			voided_by: null,
			void_reason: null,
			created_at: now,
		};
		await this.db.insertInto("documents").values(document).execute();

		const auditEvent = await this.deps.audit.record(
			{
				organizationId: session.organization_id,
				actor: { type: "system", id: "finalizer" },
			},
			{
				eventType: "document.generated",
				entityType: "document",
				entityId: documentId,
				data: {
					signed_pdf_sha256: signedMeta.sha256,
					agreement_sha256: document.agreement_sha256,
					signature_set_sha256: signatureSetSha256,
				},
			},
		);
		// audit_chain_hash = the hash of the document.generated chain event (tamper-evident link).
		await this.db
			.updateTable("documents")
			.set({ audit_chain_hash: auditEvent.event_hash })
			.where("id", "=", documentId)
			.execute();
		document.audit_chain_hash = auditEvent.event_hash;

		// 7. session → completed
		await this.db
			.updateTable("signing_sessions")
			.set({ status: "completed", completed_at: now, updated_at: now })
			.where("id", "=", sessionId)
			.execute();

		return { document };
	}

	private async computeSignatureSetHash(sessionId: string): Promise<string> {
		const signatures = await this.db
			.selectFrom("signatures")
			.selectAll()
			.where("session_id", "=", sessionId)
			.execute();
		const participants = await this.db
			.selectFrom("signing_participants")
			.selectAll()
			.where("session_id", "=", sessionId)
			.execute();
		const roleById = new Map(participants.map((p) => [p.id, p.role]));
		const { chainEventHash } = await import("@verifyistic/core");
		const version = await this.db
			.selectFrom("signing_sessions")
			.select("template_version_id")
			.where("id", "=", sessionId)
			.executeTakeFirst();
		const agreementHash = version?.template_version_id
			? ((
					await this.db
						.selectFrom("template_versions")
						.select("source_hash_sha256")
						.where("id", "=", version.template_version_id)
						.executeTakeFirst()
				)?.source_hash_sha256 ?? "unknown")
			: "unknown";
		return chainEventHash(
			agreementHash,
			signatures.map((s) => ({
				role: roleById.get(s.participant_id) ?? "signer",
				method: s.method,
				signature_hash: s.signature_hash,
			})),
		);
	}

	/**
	 * Worker entry (Phase 6): finalize every `processing` session (pdf-finalize job).
	 * A per-session failure is caught and logged — the session stays `processing`
	 * and is retried on the next sweep (doc 03 §7, doc 18 §10).
	 */
	async finalizeProcessing(
		limit = 10,
	): Promise<{ finalized: string[]; failed: string[] }> {
		const pending = await this.db
			.selectFrom("signing_sessions")
			.select(["id"])
			.where("status", "=", "processing")
			.orderBy("updated_at", "asc")
			.limit(limit)
			.execute();
		const finalized: string[] = [];
		const failed: string[] = [];
		for (const row of pending) {
			try {
				const result = await this.finalize(row.id);
				if (result) finalized.push(row.id);
			} catch (error) {
				console.error("finalize_job_failed", {
					session_id: row.id,
					message: (error as Error).message,
				});
				failed.push(row.id);
			}
		}
		return { finalized, failed };
	}

	// --- business access ------------------------------------------------------

	async get(
		tenant: TenantContext,
		documentId: string,
	): Promise<Document | undefined> {
		return this.db
			.selectFrom("documents")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", documentId)
			.executeTakeFirst();
	}

	async list(tenant: TenantContext): Promise<Document[]> {
		return this.db
			.selectFrom("documents")
			.selectAll()
			.where("organization_id", "=", tenant.organizationId)
			.orderBy("created_at", "desc")
			.limit(100)
			.execute();
	}

	/** Void: status + audit only — the signed bytes are never rewritten (doc 08 §8). */
	async void(
		tenant: TenantContext,
		documentId: string,
		reason: string,
		ip?: string,
	): Promise<Document | undefined> {
		const document = await this.get(tenant, documentId);
		if (!document) return undefined;
		const now = nowIso();
		const updated = await this.db
			.updateTable("documents")
			.set({
				status: "void",
				voided_at: now,
				voided_by: tenant.actor.id,
				void_reason: reason.slice(0, 500),
			})
			.where("organization_id", "=", tenant.organizationId)
			.where("id", "=", documentId)
			.returningAll()
			.executeTakeFirst();
		await this.deps.audit.record(tenant, {
			eventType: "document.voided",
			entityType: "document",
			entityId: documentId,
			data: { reason: reason.slice(0, 500) },
		});
		await this.recordAccess(
			document.organization_id,
			documentId,
			tenant.actor.type,
			tenant.actor.id,
			"voided",
			ip,
		);
		return updated;
	}

	/** Issue a short-lived download token — raw shown once in the API response, hash stored. */
	async issueDownloadToken(
		tenant: TenantContext,
		documentId: string,
		ip?: string,
	): Promise<{ token: string; expires_at: string } | undefined> {
		const document = await this.get(tenant, documentId);
		if (!document) return undefined;
		const raw = `${documentId.replace(/-/g, "")}.${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
		const tokenHash = await sha256Hex(raw);
		const expiresAt = new Date(Date.now() + 300_000).toISOString();
		await this.db.insertInto("download_tokens").values({
			id: newId(),
			organization_id: tenant.organizationId,
			document_id: documentId,
			token_hash: tokenHash,
			expires_at: expiresAt,
			used_at: null,
			created_by_actor_type: tenant.actor.type,
			created_by_actor_id: tenant.actor.id,
			created_at: nowIso(),
		});
		await this.db
			.insertInto("download_tokens")
			.values({
				id: newId(),
				organization_id: tenant.organizationId,
				document_id: documentId,
				token_hash: tokenHash,
				expires_at: expiresAt,
				used_at: null,
				created_by_actor_type: tenant.actor.type,
				created_by_actor_id: tenant.actor.id,
				created_at: nowIso(),
			})
			.execute();
		await this.recordAccess(
			tenant.organizationId,
			documentId,
			tenant.actor.type,
			tenant.actor.id,
			"download_token_issued",
			ip,
		);
		return { token: raw, expires_at: expiresAt };
	}

	/** Resolve a download token to the signed PDF bytes; every download is access-audited. */
	async downloadByToken(
		token: string,
		ip?: string,
	): Promise<
		{ bytes: Uint8Array; contentType: string; document: Document } | undefined
	> {
		const tokenHash = await sha256Hex(token);
		const record = await this.db
			.selectFrom("download_tokens")
			.selectAll()
			.where("token_hash", "=", tokenHash)
			.executeTakeFirst();
		if (!record || record.expires_at <= nowIso()) return undefined;
		const document = (await this.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", record.document_id)
			.executeTakeFirst())!;
		if (!document) return undefined;
		const stored = await this.deps.storage.get(document.storage_key_signed_pdf);
		if (!stored) return undefined;
		await this.recordAccess(
			document.organization_id,
			document.id,
			"token",
			"download",
			"downloaded",
			ip,
		);
		return { bytes: stored.body, contentType: "application/pdf", document };
	}

	/** Public verification data — safe output only (doc 08 §7). */
	async verificationData(documentUuid: string): Promise<
		| {
				status: string;
				document_number: string;
				business_name: string;
				document_title: string;
				template_version: number;
				signed_at: string;
				integrity_ok: boolean;
				void_state: {
					voided: boolean;
					at: string | null;
					reason: string | null;
				};
		  }
		| undefined
	> {
		const document = (await this.db
			.selectFrom("documents")
			.selectAll()
			.where("id", "=", documentUuid)
			.executeTakeFirst())!;
		if (!document) return undefined;
		const org = (await this.db
			.selectFrom("organizations")
			.select(["name"])
			.where("id", "=", document.organization_id)
			.executeTakeFirst())!;
		const version = (await this.db
			.selectFrom("template_versions")
			.selectAll()
			.where("id", "=", document.template_version_id)
			.executeTakeFirst())!;
		const stored = await this.deps.storage.get(document.storage_key_signed_pdf);
		const integrityOk = stored
			? (await sha256Hex(stored.body)) === document.signed_pdf_sha256
			: false;
		await this.recordAccess(
			document.organization_id,
			document.id,
			"public",
			"verification",
			"viewed",
			undefined,
		);
		return {
			status: document.status,
			document_number: document.document_number,
			business_name: org?.name ?? "",
			document_title: version?.title ?? "",
			template_version: version?.version_number ?? 0,
			signed_at: document.signed_at,
			integrity_ok: integrityOk,
			void_state: {
				voided: document.status === "void",
				at: document.voided_at,
				reason: document.void_reason,
			},
		};
	}

	private async recordAccess(
		organizationId: string,
		documentId: string,
		actorType: string,
		actorId: string,
		action:
			| "viewed"
			| "downloaded"
			| "download_token_issued"
			| "voided"
			| "metadata_read",
		ip?: string,
	): Promise<void> {
		await this.db
			.insertInto("document_access_events")
			.values({
				id: newId(),
				organization_id: organizationId,
				document_id: documentId,
				actor_type: actorType,
				actor_id: actorId,
				action,
				ip: ip ?? null,
				created_at: nowIso(),
			})
			.execute();
	}
}

export type { EvidenceSnapshot };
