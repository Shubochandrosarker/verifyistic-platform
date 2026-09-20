import { createHmac } from "node:crypto";
import { createInMemoryDatabase } from "@verifyistic/database/testing";
import type { TenantContext } from "@verifyistic/tenancy";
import { describe, expect, it } from "vitest";
import {
	PostmarkEmailSender,
	ResendEmailSender,
	SmtpEmailSender,
	WebhookService,
	decryptSecret,
	encryptSecret,
	isWebhookUrlAllowed,
	signPayload,
} from "../src/index.js";

class FakeSmtpConnection {
	readonly writes: string[] = [];
	private responseIndex = 0;

	constructor(private readonly responses: string[]) {}

	async readLine(): Promise<string> {
		const response = this.responses[this.responseIndex++];
		if (!response) throw new Error("fake SMTP response queue exhausted");
		return response;
	}

	async write(data: string): Promise<void> {
		this.writes.push(data);
	}

	async startTls(): Promise<FakeSmtpConnection> {
		return this;
	}

	async close(): Promise<void> {}
}

const orgA: TenantContext = {
	organizationId: "org_a",
	actor: { type: "api_key", id: "key_1" },
};

describe("url-guard (SSRF, doc 16 §5)", () => {
	it("allows public https URLs", () => {
		expect(isWebhookUrlAllowed("https://example.com/hook")).toEqual({
			allowed: true,
		});
	});

	it("rejects non-http schemes, localhost, private, link-local, and metadata ranges", () => {
		const rejected = [
			"file:///etc/passwd",
			"ftp://example.com",
			"http://localhost/hook",
			"http://api.localhost/hook",
			"http://127.0.0.1/hook",
			"http://10.0.0.5/hook",
			"http://172.16.1.1/hook",
			"http://192.168.1.1/hook",
			"http://169.254.169.254/latest/meta-data",
			"http://100.64.0.1/hook",
			"http://[::1]/hook",
			"http://[fd00::1]/hook",
		];
		for (const url of rejected) {
			expect(isWebhookUrlAllowed(url).allowed).toBe(false);
		}
	});
});

describe("secret encryption at rest (doc 06 §10)", () => {
	it("encrypt → decrypt roundtrip; ciphertext never contains the plaintext", () => {
		const ciphertext = encryptSecret("whsec_supersecret", "test-key-env");
		expect(ciphertext).not.toContain("supersecret");
		expect(decryptSecret(ciphertext, "test-key-env")).toBe("whsec_supersecret");
		expect(() => decryptSecret(ciphertext, "wrong-key")).toThrow();
	});
});

describe("HMAC signature (route contract v1)", () => {
	it("matches a receiver-side verification", () => {
		const secret = "whsec_abc";
		const timestamp = 1727000000;
		const body = '{"event":"document.generated"}';
		const signature = signPayload(secret, timestamp, body);
		const expected = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		expect(signature).toBe(`v1=${expected}`);
	});
});

describe("ResendEmailSender", () => {
	it("sends an escaped signing invitation through the Resend API", async () => {
		let captured: { url: string; init: RequestInit } | undefined;
		const sender = new ResendEmailSender(
			"re_test_key",
			"Verifyistic <noreply@example.com>",
			async (url, init) => {
				captured = { url: String(url), init: init ?? {} };
				return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
			},
		);

		await sender.send({
			to: "signer@example.com",
			template: "signing_session_invitation",
			payload: {
				business: "Range <A>",
				signer_url: "https://api.example.com/s/token?a=1&b=2",
			},
		});

		expect(captured?.url).toBe("https://api.resend.com/emails");
		expect(captured?.init.headers).toMatchObject({
			Authorization: "Bearer re_test_key",
			"Content-Type": "application/json",
		});
		const body = JSON.parse(String(captured?.init.body)) as {
			to: string[];
			subject: string;
			html: string;
		};
		expect(body.to).toEqual(["signer@example.com"]);
		expect(body.subject).toContain("Range <A>");
		expect(body.html).toContain("Range &lt;A&gt;");
		expect(body.html).toContain("a=1&amp;b=2");
	});
});

describe("PostmarkEmailSender", () => {
	it("sends an escaped signing invitation through the transactional stream", async () => {
		let captured: { url: string; init: RequestInit } | undefined;
		const sender = new PostmarkEmailSender(
			"pm_test_token",
			"Verifyistic <noreply@example.com>",
			"outbound",
			async (url, init) => {
				captured = { url: String(url), init: init ?? {} };
				return new Response(JSON.stringify({ MessageID: "email_1" }), {
					status: 200,
				});
			},
		);

		await sender.send({
			to: "signer@example.com",
			template: "signing_session_invitation",
			payload: {
				business: "Range <A>",
				signer_url: "https://api.example.com/s/token?a=1&b=2",
			},
		});

		expect(captured?.url).toBe("https://api.postmarkapp.com/email");
		expect(captured?.init.headers).toMatchObject({
			"X-Postmark-Server-Token": "pm_test_token",
			"Content-Type": "application/json",
		});
		const body = JSON.parse(String(captured?.init.body)) as {
			From: string;
			To: string;
			Subject: string;
			TextBody: string;
			HtmlBody: string;
			MessageStream: string;
		};
		expect(body.From).toBe("Verifyistic <noreply@example.com>");
		expect(body.To).toBe("signer@example.com");
		expect(body.Subject).toContain("Range <A>");
		expect(body.HtmlBody).toContain("Range &lt;A&gt;");
		expect(body.HtmlBody).toContain("a=1&amp;b=2");
		expect(body.MessageStream).toBe("outbound");
	});

	it("fails closed when the server token is missing", async () => {
		const sender = new PostmarkEmailSender("", "noreply@example.com");
		await expect(
			sender.send({
				to: "signer@example.com",
				template: "notification",
				payload: {},
			}),
		).rejects.toThrow("POSTMARK_SERVER_TOKEN is not configured.");
	});
});

describe("SmtpEmailSender", () => {
	it("authenticates and sends a MIME message over implicit TLS", async () => {
		const connection = new FakeSmtpConnection([
			"220 mail.wpistic.com ESMTP",
			"250-mail.wpistic.com",
			"250-AUTH PLAIN LOGIN",
			"250 SIZE 10485760",
			"235 2.7.0 Authentication successful",
			"250 2.1.0 OK",
			"250 2.1.5 OK",
			"354 End data with <CR><LF>.<CR><LF>",
			"250 2.0.0 queued",
			"221 2.0.0 Bye",
		]);
		let connectionOptions:
			| {
					host: string;
					port: number;
					mode: "tls" | "starttls";
			  }
			| undefined;
		const sender = new SmtpEmailSender({
			connector: {
				async connect(options) {
					connectionOptions = options;
					return connection;
				},
			},
			host: "mail.wpistic.com",
			port: 465,
			mode: "tls",
			username: "noreply@wpistic.com",
			password: "test-password",
			from: "Verifyistic <noreply@wpistic.com>",
			heloName: "verifyistic.com",
		});

		await sender.send({
			to: "signer@example.com",
			template: "signing_session_invitation",
			payload: {
				business: "Range <A>",
				signer_url: "https://api.example.com/s/token?a=1&b=2",
			},
		});

		expect(connectionOptions).toEqual({
			host: "mail.wpistic.com",
			port: 465,
			mode: "tls",
		});
		expect(connection.writes[0]).toBe("EHLO verifyistic.com\r\n");
		expect(connection.writes[1]).toMatch(/^AUTH PLAIN /);
		expect(connection.writes).toContain("MAIL FROM:<noreply@wpistic.com>\r\n");
		expect(connection.writes).toContain("RCPT TO:<signer@example.com>\r\n");
		const body = connection.writes.find((write) =>
			write.includes("MIME-Version"),
		);
		expect(body).toBeDefined();
		expect(body).toContain("Range &lt;A&gt;");
		expect(body).toContain("a=1&amp;b=2");
		expect(body).toMatch(/\r\n\.\r\n$/);
		expect(connection.writes.at(-1)).toBe("QUIT\r\n");
	});

	it("uses STARTTLS when configured and rejects missing SMTP credentials", async () => {
		const connection = new FakeSmtpConnection([
			"220 mail.wpistic.com ESMTP",
			"250-mail.wpistic.com",
			"250 STARTTLS",
			"220 2.0.0 Ready to start TLS",
			"250 mail.wpistic.com",
		]);
		const sender = new SmtpEmailSender({
			connector: { connect: async () => connection },
			host: "mail.wpistic.com",
			port: 587,
			mode: "starttls",
			username: "",
			password: "",
			from: "noreply@wpistic.com",
		});

		await expect(
			sender.send({
				to: "signer@example.com",
				template: "notification",
				payload: {},
			}),
		).rejects.toThrow("SMTP_USER and SMTP_PASSWORD are required.");
		expect(connection.writes).toEqual([
			"EHLO verifyistic-worker\r\n",
			"STARTTLS\r\n",
			"EHLO verifyistic-worker\r\n",
		]);
	});
});

describe("WebhookService delivery engine", () => {
	async function makeService(
		fetcher?: ConstructorParameters<typeof WebhookService>[1]["fetcher"],
	) {
		const db = await createInMemoryDatabase();
		await db
			.insertInto("organizations")
			.values({
				id: "org_a",
				name: "Org A",
				slug: "range-a",
				billing_email: null,
				timezone: "UTC",
				default_retention_policy_id: null,
				status: "active" as const,
				metadata: null,
				created_at: "2026-09-20T00:00:00Z",
				updated_at: "2026-09-20T00:00:00Z",
			})
			.execute();
		const service = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher,
		});
		return { db, service };
	}

	it("registers endpoint (secret shown once), enqueues matching events, delivers with HMAC headers", async () => {
		let captured: {
			url: string;
			headers: Record<string, string>;
			body: string;
		} | null = null;
		const { db, service } = await makeService(async (url, init) => {
			captured = { url, headers: init.headers, body: init.body };
			return { ok: true, status: 200 };
		});
		const { record, secret } = await service.registerEndpoint(orgA, {
			url: "https://hooks.example.com/vf",
		});

		// Secret stored encrypted — raw absent from storage.
		const stored = JSON.stringify(
			await db.selectFrom("webhook_endpoints").selectAll().execute(),
		);
		expect(stored).not.toContain(secret);

		const queued = await service.enqueueEvent("org_a", "document.generated", {
			document_id: "doc_1",
		});
		expect(queued).toBe(1);
		const processed = await service.processDueDeliveries();
		expect(processed).toBe(1);

		// Receiver-side verification of the signature contract.
		const body = captured!.body;
		const payload = JSON.parse(body) as {
			event_id: string;
			event: string;
			data: { document_id: string };
		};
		expect(payload.event).toBe("document.generated");
		expect(payload.data.document_id).toBe("doc_1");
		expect(payload.event_id).toBe(captured!.headers["Verifyistic-Event-ID"]);
		const timestamp = Number(captured!.headers["Verifyistic-Timestamp"]);
		const expected = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		expect(captured!.headers["Verifyistic-Signature"]).toBe(`v1=${expected}`);
		expect(captured!.headers["Verifyistic-Event-Type"]).toBe(
			"document.generated",
		);

		const deliveries = await service.listDeliveries(orgA, record.id);
		expect(deliveries[0]!.status).toBe("delivered");
		expect(deliveries[0]!.attempt).toBe(1);
	});

	it("subscribed event filter skips non-matching events", async () => {
		const { service } = await makeService(async () => ({
			ok: true,
			status: 200,
		}));
		await service.registerEndpoint(orgA, {
			url: "https://hooks.example.com/x",
			subscribedEvents: ["document.generated"],
		});
		expect(await service.enqueueEvent("org_a", "checkin.created", {})).toBe(0);
		expect(await service.enqueueEvent("org_a", "document.generated", {})).toBe(
			1,
		);
	});

	it("failed delivery schedules bounded retries with backoff, then dead-letters", async () => {
		let now = new Date("2026-09-20T12:00:00Z");
		const { db } = await makeService();
		const failing = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher: async () => ({ ok: false, status: 500 }),
			now: () => now,
		});
		await failing.registerEndpoint(orgA, {
			url: "https://hooks.example.com/y",
		});
		await failing.enqueueEvent("org_a", "document.generated", {});

		// max_attempts = 6 (5 retry delays + first attempt): each sweep advances the
		// clock past the scheduled backoff before the next try.
		for (let attempt = 1; attempt <= 6; attempt++) {
			const processed = await failing.processDueDeliveries();
			expect(processed).toBe(1);
			const delivery = (await db
				.selectFrom("webhook_deliveries")
				.selectAll()
				.executeTakeFirst())!;
			expect(delivery.attempt).toBe(attempt);
			if (attempt < 6) {
				expect(delivery.status).toBe("pending");
				expect(delivery.next_retry_at).not.toBeNull();
				now = new Date(now.getTime() + 7 * 60 * 60 * 1000); // past the longest backoff
			}
		}
		const final = (await db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.executeTakeFirst())!;
		expect(final.status).toBe("dead_letter");
		expect(final.next_retry_at).toBeNull();
		expect(final.attempt).toBe(6);
	});

	it("successful delivery after failures marks delivered", async () => {
		let now = new Date("2026-09-20T12:00:00Z");
		let calls = 0;
		const { db } = await makeService();
		const flaky = new WebhookService(db, {
			encryptionKey: "test-env-key",
			fetcher: async () => {
				calls += 1;
				return calls >= 2
					? { ok: true, status: 200 }
					: { ok: false, status: 503 };
			},
			now: () => now,
		});
		await flaky.registerEndpoint(orgA, { url: "https://hooks.example.com/z" });
		await flaky.enqueueEvent("org_a", "document.generated", {});
		await flaky.processDueDeliveries();
		now = new Date(now.getTime() + 2 * 60 * 1000);
		await flaky.processDueDeliveries();
		const delivery = (await db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.executeTakeFirst())!;
		expect(delivery.status).toBe("delivered");
		expect(delivery.attempt).toBe(2);
	});
});
