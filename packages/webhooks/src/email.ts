/**
 * Email outbox + sender adapter (Phase 6). Emails are queued in the DB (same retry
 * discipline as webhooks) and pumped by the worker. The sender is injected —
 * ConsoleEmailSender for dev/tests and PostmarkEmailSender/SmtpEmailSender/
 * ResendEmailSender for
 * cloud delivery.
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

export class PostmarkEmailSender implements EmailSender {
	constructor(
		private readonly serverToken: string,
		private readonly from: string,
		private readonly messageStream = "outbound",
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async send(email: {
		to: string;
		template: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		if (!this.serverToken) {
			throw new Error("POSTMARK_SERVER_TOKEN is not configured.");
		}
		const rendered = renderTransactionalEmail(email);
		const from = parseMailbox(this.from, "POSTMARK_FROM");
		const to = parseMailbox(email.to, "recipient");
		const response = await this.fetcher("https://api.postmarkapp.com/email", {
			method: "POST",
			headers: {
				"X-Postmark-Server-Token": this.serverToken,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				From: from.header,
				To: to.address,
				Subject: rendered.subject,
				TextBody: rendered.text,
				HtmlBody: rendered.html,
				MessageStream: this.messageStream,
			}),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(
				`Postmark rejected email (${response.status}): ${detail}`,
			);
		}
	}
}

export interface SmtpConnection {
	readLine(): Promise<string>;
	write(data: string): Promise<void>;
	startTls(): Promise<SmtpConnection>;
	close(): Promise<void>;
}

export interface SmtpConnector {
	connect(options: {
		host: string;
		port: number;
		mode: "tls" | "starttls";
	}): Promise<SmtpConnection>;
}

export interface SmtpEmailSenderOptions {
	connector: SmtpConnector;
	host: string;
	port: number;
	mode: "tls" | "starttls";
	username: string;
	password: string;
	from: string;
	heloName?: string;
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
		const rendered = renderTransactionalEmail(email);

		const response = await this.fetcher("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: this.from,
				to: [email.to],
				subject: rendered.subject,
				html: rendered.html,
			}),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`Resend rejected email (${response.status}): ${detail}`);
		}
	}
}

/**
 * SMTP delivery adapter. The connection is injected so the protocol can be
 * tested without opening a network socket; the Worker supplies its TCP/TLS
 * connector at runtime.
 */
export class SmtpEmailSender implements EmailSender {
	private readonly options: SmtpEmailSenderOptions;

	constructor(options: SmtpEmailSenderOptions) {
		this.options = options;
	}

	async send(email: {
		to: string;
		template: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		const from = parseMailbox(this.options.from, "SMTP_FROM");
		const to = parseMailbox(email.to, "recipient");
		const connection = await this.options.connector.connect({
			host: this.options.host,
			port: this.options.port,
			mode: this.options.mode,
		});
		let active = connection;
		try {
			assertResponse(await readResponse(active), [220], "SMTP greeting");
			let capabilities = await sendCommand(
				active,
				`EHLO ${safeHeloName(this.options.heloName ?? "verifyistic-worker")}`,
				[250],
				"EHLO",
			);

			if (this.options.mode === "starttls") {
				if (!hasCapability(capabilities, "STARTTLS")) {
					throw new Error("SMTP server does not advertise STARTTLS.");
				}
				assertResponse(
					await sendCommand(active, "STARTTLS", [220], "STARTTLS"),
					[220],
					"STARTTLS",
				);
				active = await active.startTls();
				capabilities = await sendCommand(
					active,
					`EHLO ${safeHeloName(this.options.heloName ?? "verifyistic-worker")}`,
					[250],
					"EHLO after STARTTLS",
				);
			}

			await authenticate(
				active,
				capabilities,
				this.options.username,
				this.options.password,
			);
			await sendCommand(
				active,
				`MAIL FROM:<${from.address}>`,
				[250],
				"MAIL FROM",
			);
			await sendCommand(
				active,
				`RCPT TO:<${to.address}>`,
				[250, 251],
				"RCPT TO",
			);
			await sendCommand(active, "DATA", [354], "DATA");
			const rendered = renderTransactionalEmail(email);
			await active.write(
				stuffSmtpMessage(
					buildMimeMessage({
						from: from.header,
						to: to.header,
						subject: rendered.subject,
						text: rendered.text,
						html: rendered.html,
					}),
				),
			);
			await sendCommand(active, "", [250], "message body");
			await sendCommand(active, "QUIT", [221, 250], "QUIT");
		} finally {
			await active.close().catch(() => undefined);
		}
	}
}

interface RenderedTransactionalEmail {
	subject: string;
	text: string;
	html: string;
}

export function renderTransactionalEmail(email: {
	template: string;
	payload: Record<string, unknown>;
}): RenderedTransactionalEmail {
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
	const text = signerUrl
		? `${business} sent you a document to review and sign.\n\nOpen the secure signing link: ${signerUrl}\n\nThis link is private and expires automatically.`
		: `${business} sent you a Verifyistic notification.`;
	const html = signerUrl
		? `<p>${escapeHtml(business)} sent you a document to review and sign.</p><p><a href="${escapeHtml(signerUrl)}">Open the secure signing link</a></p><p>This link is private and expires automatically.</p>`
		: `<p>${escapeHtml(business)} sent you a Verifyistic notification.</p>`;
	return { subject, text, html };
}

interface Mailbox {
	header: string;
	address: string;
}

function parseMailbox(value: string, label: string): Mailbox {
	if (!value || /[\r\n]/.test(value)) {
		throw new Error(`${label} is invalid.`);
	}
	const trimmed = value.trim();
	const match = trimmed.match(/<([^<>\s]+)>$/);
	const address = (match?.[1] ?? trimmed).trim();
	if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
		throw new Error(`${label} must contain a valid email address.`);
	}
	return { header: trimmed, address };
}

function safeHeloName(value: string): string {
	if (!value || /[\r\n\s]/.test(value)) {
		throw new Error("SMTP_HELO must be a single hostname.");
	}
	return value;
}

interface SmtpResponse {
	code: number;
	lines: string[];
}

async function readResponse(connection: SmtpConnection): Promise<SmtpResponse> {
	const first = await connection.readLine();
	const match = first.match(/^(\d{3})([- ])(.*)$/);
	if (!match)
		throw new Error(`Malformed SMTP response: ${first.slice(0, 120)}`);
	const code = Number(match[1]);
	const lines = [first];
	if (match[2] === "-") {
		while (true) {
			const line = await connection.readLine();
			lines.push(line);
			if (line.startsWith(`${code} `)) break;
			if (!line.startsWith(`${code}-`)) {
				throw new Error(
					`Malformed multiline SMTP response: ${line.slice(0, 120)}`,
				);
			}
		}
	}
	return { code, lines };
}

async function sendCommand(
	connection: SmtpConnection,
	command: string,
	expectedCodes: number[],
	label: string,
): Promise<SmtpResponse> {
	if (command) await connection.write(`${command}\r\n`);
	const response = await readResponse(connection);
	assertResponse(response, expectedCodes, label);
	return response;
}

function assertResponse(
	response: SmtpResponse,
	expectedCodes: number[],
	label: string,
): void {
	if (!expectedCodes.includes(response.code)) {
		const detail = response.lines.at(-1)?.slice(0, 240) ?? "unknown response";
		throw new Error(`${label} failed (${response.code}): ${detail}`);
	}
}

function hasCapability(response: SmtpResponse, capability: string): boolean {
	return response.lines.some((line) =>
		new RegExp(`^250[- ]${capability}(?:[ =]|$)`, "i").test(line),
	);
}

async function authenticate(
	connection: SmtpConnection,
	capabilities: SmtpResponse,
	username: string,
	password: string,
): Promise<void> {
	if (!username || !password) {
		throw new Error("SMTP_USER and SMTP_PASSWORD are required.");
	}
	if (hasCapability(capabilities, "AUTH PLAIN")) {
		await sendCommand(
			connection,
			`AUTH PLAIN ${base64Encode(`\u0000${username}\u0000${password}`)}`,
			[235],
			"AUTH PLAIN",
		);
		return;
	}
	if (hasCapability(capabilities, "AUTH LOGIN")) {
		await sendCommand(connection, "AUTH LOGIN", [334], "AUTH LOGIN");
		await sendCommand(
			connection,
			base64Encode(username),
			[334],
			"SMTP username",
		);
		await sendCommand(
			connection,
			base64Encode(password),
			[235],
			"SMTP password",
		);
		return;
	}
	throw new Error("SMTP server does not advertise AUTH PLAIN or AUTH LOGIN.");
}

function buildMimeMessage(input: {
	from: string;
	to: string;
	subject: string;
	text: string;
	html: string;
}): string {
	const boundary = `verifyistic-${Date.now().toString(36)}-alternative`;
	return [
		`From: ${headerSafe(input.from)}`,
		`To: ${headerSafe(input.to)}`,
		`Subject: ${encodeMimeHeader(input.subject)}`,
		`Date: ${new Date().toUTCString()}`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		normalizeCrlf(input.text),
		`--${boundary}`,
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		normalizeCrlf(input.html),
		`--${boundary}--`,
		"",
	].join("\r\n");
}

function stuffSmtpMessage(message: string): string {
	const normalized = normalizeCrlf(message).replace(/(^|\r\n)\./g, "$1..");
	return `${normalized.replace(/\r\n$/, "")}\r\n.\r\n`;
}

function normalizeCrlf(value: string): string {
	return value.replace(/\r?\n/g, "\r\n");
}

function headerSafe(value: string): string {
	if (/[\r\n]/.test(value)) throw new Error("SMTP header contains a newline.");
	return value;
}

function encodeMimeHeader(value: string): string {
	return /^[\x20-\x7e]*$/.test(value)
		? value
		: `=?UTF-8?B?${base64Encode(value)}?=`;
}

function base64Encode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const a = bytes[index] ?? 0;
		const b = bytes[index + 1] ?? 0;
		const c = bytes[index + 2] ?? 0;
		const n = (a << 16) | (b << 8) | c;
		output += alphabet[(n >>> 18) & 63];
		output += alphabet[(n >>> 12) & 63];
		output += index + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=";
		output += index + 2 < bytes.length ? alphabet[n & 63] : "=";
	}
	return output;
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
