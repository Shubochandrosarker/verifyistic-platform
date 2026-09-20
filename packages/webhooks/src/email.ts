/**
 * Email outbox + sender adapter (Phase 6). Emails are queued in the DB (same retry
 * discipline as webhooks) and pumped by the worker. The sender is injected —
 * ConsoleEmailSender for dev/tests and ResendEmailSender for the cloud runtime.
 */
import { newId } from "@verifyistic/core";
import type { Database, EmailOutboxMessage } from "@verifyistic/database";
import type { Kysely } from "kysely";

const nowIso = () => new Date().toISOString();
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600];

export interface QueuedEmail {
	to: string;
	template: string;
	payload: Record<string, unknown>;
	organizationId?: string | null;
}

export class EmailOutbox {
	constructor(private readonly db: Kysely<Database>) {}

	async enqueue(
		email: QueuedEmail,
		delaySeconds = 0,
	): Promise<EmailOutboxMessage> {
		const now = new Date();
		const row: EmailOutboxMessage = {
			id: newId(),
			organization_id: email.organizationId ?? null,
			to_email: email.to,
			template: email.template,
			payload_json: JSON.stringify(email.payload),
			status: "pending",
			attempt: 0,
			max_attempts: RETRY_DELAYS_SECONDS.length + 1,
			next_attempt_at: new Date(
				now.getTime() + delaySeconds * 1000,
			).toISOString(),
			sent_at: null,
			last_error: null,
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
		};
		await this.db.insertInto("email_outbox").values(row).execute();
		return row;
	}

	async processDue(sender: EmailSender, limit = 20): Promise<number> {
		const due = await this.db
			.selectFrom("email_outbox")
			.selectAll()
			.where("status", "=", "pending")
			.where("next_attempt_at", "<=", nowIso())
			.orderBy("next_attempt_at", "asc")
			.limit(limit)
			.execute();

		let processed = 0;
		for (const message of due) {
			const attempt = message.attempt + 1;
			try {
				await sender.send({
					to: message.to_email,
					template: message.template,
					payload: JSON.parse(message.payload_json) as Record<string, unknown>,
				});
				await this.db
					.updateTable("email_outbox")
					.set({
						status: "sent",
						attempt,
						sent_at: nowIso(),
						next_attempt_at: null,
						last_error: null,
						updated_at: nowIso(),
					})
					.where("id", "=", message.id)
					.execute();
			} catch (error) {
				const dead = attempt >= message.max_attempts;
				const nextDelay =
					RETRY_DELAYS_SECONDS[
						Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)
					] ?? 21600;
				await this.db
					.updateTable("email_outbox")
					.set({
						status: dead ? "dead_letter" : "pending",
						attempt,
						last_error: (error as Error).message.slice(0, 300),
						next_attempt_at: dead
							? null
							: new Date(Date.now() + nextDelay * 1000).toISOString(),
						updated_at: nowIso(),
					})
					.where("id", "=", message.id)
					.execute();
			}
			processed += 1;
		}
		return processed;
	}
}

export interface EmailSender {
	send(email: {
		to: string;
		template: string;
		payload: Record<string, unknown>;
	}): Promise<void>;
}

/** Dev/test sender — logs instead of sending. Never used in production. */
export class ConsoleEmailSender implements EmailSender {
	async send(email: {
		to: string;
		template: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		console.log("email", { to: email.to, template: email.template });
	}
}

/**
 * Resend delivery adapter for the Cloudflare worker.
 *
 * The API key is runtime-only. Templates stay in the outbox payload so the
 * worker can retry without re-reading the signing session or exposing tokens.
 */
export class ResendEmailSender implements EmailSender {
	constructor(
		private readonly apiKey: string,
		private readonly from: string,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async send(email: {
		to: string;
		template: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		if (!this.apiKey) throw new Error("RESEND_API_KEY is not configured.");
		const signerUrl =
			typeof email.payload.signer_url === "string"
				? email.payload.signer_url
				: "";
		const business =
			typeof email.payload.business === "string"
				? email.payload.business
				: "Verifyistic customer";
		const subject =
			email.template === "signing_session_invitation"
				? `${business} sent you a document to sign`
				: "Verifyistic notification";
		const html = signerUrl
			? `<p>${escapeHtml(business)} sent you a document to review and sign.</p><p><a href="${escapeHtml(signerUrl)}">Open the secure signing link</a></p><p>This link is private and expires automatically.</p>`
			: `<p>${escapeHtml(business)} sent you a Verifyistic notification.</p>`;

		const response = await this.fetcher("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: this.from,
				to: [email.to],
				subject,
				html,
			}),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`Resend rejected email (${response.status}): ${detail}`);
		}
	}
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[character] ?? character,
	);
}
