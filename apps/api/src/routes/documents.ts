import { ApiError } from "@verifyistic/core";
import { DocumentNotFoundError } from "@verifyistic/documents";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

export function documentsErrorStatus(
	error: unknown,
): { code: "not_found"; status: 404 } | null {
	if (error instanceof DocumentNotFoundError)
		return { code: "not_found", status: 404 };
	return null;
}

function toPublicDocument(record: {
	id: string;
	status: string;
	document_number: string;
	signed_at: string;
	customer_id: string | null;
	template_version_id: string;
	signed_pdf_sha256: string;
	certificate_sha256: string;
	agreement_sha256: string;
	signature_set_sha256: string;
	audit_chain_hash: string;
	legal_hold: number;
	voided_at: string | null;
	void_reason: string | null;
	created_at: string;
}) {
	return {
		id: record.id,
		status: record.status,
		document_number: record.document_number,
		signed_at: record.signed_at,
		customer_id: record.customer_id,
		template_version_id: record.template_version_id,
		hashes: {
			signed_pdf: record.signed_pdf_sha256,
			certificate: record.certificate_sha256,
			agreement: record.agreement_sha256,
			signature_set: record.signature_set_sha256,
			audit_chain: record.audit_chain_hash,
		},
		legal_hold: record.legal_hold === 1,
		voided_at: record.voided_at,
		void_reason: record.void_reason,
		created_at: record.created_at,
	};
}

export function documentsRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/", async (c) => {
		requireScope(c, "documents:read");
		const documents = await deps.documents.list(c.get("tenant")!);
		return ok(c, documents.map(toPublicDocument));
	});

	routes.get("/:id", async (c) => {
		requireScope(c, "documents:read");
		const document = await deps.documents.get(
			c.get("tenant")!,
			c.req.param("id"),
		);
		if (!document) throw ApiError.notFound("Document not found.");
		return ok(c, toPublicDocument(document));
	});

	// Short-lived download token — the bucket stays private (doc 09 §3).
	routes.post("/:id/download-token", async (c) => {
		const { tenant } = requireScope(c, "documents:read");
		const ip =
			c.req.header("CF-Connecting-IP") ??
			c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
		const issued = await deps.documents.issueDownloadToken(
			tenant,
			c.req.param("id"),
			ip,
		);
		if (!issued) throw ApiError.notFound("Document not found.");
		return ok(c, {
			download_url: `/v1/documents/${c.req.param("id")}/download?dt=${encodeURIComponent(issued.token)}`,
			expires_at: issued.expires_at,
		});
	});

	// Token-authenticated download (no bearer) — public URL, audited access.
	routes.get("/:id/download", async (c) => {
		const token = c.req.query("dt");
		if (!token || token.length > 200)
			throw ApiError.validation("dt is required.");
		const ip =
			c.req.header("CF-Connecting-IP") ??
			c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
		const download = await deps.documents.downloadByToken(token, ip);
		if (!download)
			throw ApiError.notFound("Invalid or expired download token.");
		return new Response(download.bytes as unknown as BodyInit, {
			status: 200,
			headers: {
				"Content-Type": download.contentType,
				"Content-Disposition": `attachment; filename="${download.document.document_number}.pdf"`,
				"X-Request-ID": c.get("requestId"),
			},
		});
	});

	// Void is status/audit only — never rewrites bytes (doc 08 §8).
	routes.post("/:id/void", async (c) => {
		const { tenant } = requireScope(c, "documents:write");
		const body = await c.req.json().catch(() => ({}));
		const reason = (body as { reason?: unknown }).reason;
		if (typeof reason !== "string" || reason.trim().length === 0) {
			throw ApiError.validation("reason is required.", {
				reason: ["required"],
			});
		}
		const ip =
			c.req.header("CF-Connecting-IP") ??
			c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
		const document = await deps.documents.void(
			tenant,
			c.req.param("id"),
			reason,
			ip,
		);
		if (!document) throw ApiError.notFound("Document not found.");
		return ok(c, toPublicDocument(document));
	});

	routes.get("/:id/audit-events", async (c) => {
		const { tenant } = requireScope(c, "documents:read");
		const document = await deps.documents.get(tenant, c.req.param("id"));
		if (!document) throw ApiError.notFound("Document not found.");
		const events = await deps.audit.listForEntity(
			tenant,
			"document",
			document.id,
		);
		return ok(c, events);
	});

	return routes;
}

/** Public verification page — safe metadata only (doc 08 §7). Mounted at app root. */
export function verificationRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.get("/verify/:uuid", async (c) => {
		const data = await deps.documents.verificationData(c.req.param("uuid"));
		if (!data) {
			return c.html(
				`<!doctype html><html><body style="font-family:sans-serif;max-width:520px;margin:60px auto"><h1>Not found</h1><p>No document with this verification ID.</p></body></html>`,
				404,
			);
		}
		const esc = (s: string) =>
			String(s).replace(
				/[&<>"']/g,
				(ch) =>
					({
						"&": "&amp;",
						"<": "&lt;",
						">": "&gt;",
						'"': "&quot;",
						"'": "&#39;",
					})[ch]!,
			);
		const statusLabel = data.status === "void" ? "VOID" : "Valid";
		const color = data.status === "void" ? "#b3261e" : "#1b7f4d";
		return c.html(
			`<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Verify document</title></head><body style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#17202a"><h1>Document verification</h1><p style="font-size:1.4rem;font-weight:700;color:${color}">${statusLabel}</p><ul style="line-height:1.9"><li><strong>Business:</strong> ${esc(data.business_name)}</li><li><strong>Document:</strong> ${esc(data.document_title)} (${esc(data.document_number)})</li><li><strong>Template version:</strong> ${esc(String(data.template_version))}</li><li><strong>Signed:</strong> ${esc(data.signed_at)}</li><li><strong>Integrity check:</strong> ${data.integrity_ok ? "PASSED" : "FAILED"}</li>${
				data.status === "void"
					? `<li><strong>Voided:</strong> ${esc(data.void_state.at ?? "")} — ${esc(data.void_state.reason ?? "")}</li>`
					: ""
			}</ul><p style="color:#5c6771;font-size:.85rem">This page shows verification metadata only. It never discloses identity details, responses, or signature images.</p></body></html>`,
		);
	});

	return routes;
}
