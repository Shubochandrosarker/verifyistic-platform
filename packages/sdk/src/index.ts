/**
 * Verifyistic TypeScript SDK (doc 05 §9) — typed client for the v1 API.
 * - Envelope-aware: methods return `data` directly; errors throw VerifyisticApiError
 * - Idempotency: pass `idempotencyKey` on create calls
 * - Webhook helper: verifyWebhookSignature() for receivers (doc 05 §5)
 * - Runtime-agnostic: any fetch implementation (Workers, Node 18+, browsers)
 */

export interface VerifyisticClientOptions {
	apiKey: string;
	/** Defaults to https://api.verifyistic.com/v1 */
	baseUrl?: string;
	fetch?: typeof fetch;
}

export interface RequestMeta {
	request_id?: string;
	next_cursor?: string | null;
	has_more?: boolean;
	created?: boolean;
}

export interface ApiEnvelope<T> {
	data: T;
	meta: RequestMeta;
}

export class VerifyisticApiError extends Error {
	readonly code: string;
	readonly status: number;
	readonly requestId: string | undefined;
	readonly fields: Record<string, string[]> | undefined;

	constructor(
		code: string,
		message: string,
		status: number,
		requestId?: string,
		fields?: Record<string, string[]>,
	) {
		super(`${code}: ${message}`);
		this.name = "VerifyisticApiError";
		this.code = code;
		this.status = status;
		this.requestId = requestId;
		this.fields = fields;
	}
}

export class VerifyisticClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: VerifyisticClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = (
			options.baseUrl ?? "https://api.verifyistic.com/v1"
		).replace(/\/$/, "");
		this.fetchImpl = options.fetch ?? fetch;
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		idempotencyKey?: string,
	): Promise<{ data: T; meta: RequestMeta }> {
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const payload = (await response.json()) as {
			data?: T;
			meta?: RequestMeta;
			error?: {
				code: string;
				message: string;
				request_id?: string;
				fields?: Record<string, string[]>;
			};
		};
		if (!response.ok || payload.error) {
			throw new VerifyisticApiError(
				payload.error?.code ?? "internal_error",
				payload.error?.message ?? `HTTP ${response.status}`,
				response.status,
				payload.error?.request_id,
				payload.error?.fields,
			);
		}
		return { data: payload.data as T, meta: payload.meta ?? {} };
	}

	// --- health ---------------------------------------------------------------

	async health(): Promise<{ status: string }> {
		const response = await this.fetchImpl(`${this.baseUrl}/health`);
		const payload = (await response.json()) as { data: { status: string } };
		return payload.data;
	}

	// --- signing sessions -------------------------------------------------------

	async createSigningSession(
		input: {
			template_id: string;
			customer_id: string;
			site_id?: string | null;
			expires_in_seconds?: number;
			delivery_method?: string;
			metadata?: Record<string, unknown>;
		},
		options?: { idempotencyKey?: string },
	): Promise<
		ApiEnvelope<{
			id: string;
			status: string;
			participants: { role: string; required: boolean }[];
			signer_url: string;
			token: string;
		}>
	> {
		return this.request(
			"POST",
			"/signing-sessions",
			input,
			options?.idempotencyKey,
		);
	}

	async getSigningSession(
		id: string,
	): Promise<ApiEnvelope<{ id: string; status: string }>> {
		return this.request("GET", `/signing-sessions/${id}`);
	}

	async cancelSigningSession(
		id: string,
	): Promise<ApiEnvelope<{ id: string; status: string }>> {
		return this.request("POST", `/signing-sessions/${id}/cancel`);
	}

	// --- customers --------------------------------------------------------------

	async createCustomer(
		input: {
			first_name: string;
			last_name: string;
			email?: string | null;
			phone?: string | null;
			date_of_birth?: string | null;
		},
		options?: { idempotencyKey?: string },
	): Promise<
		ApiEnvelope<{ id: string; email: string | null; status: string }>
	> {
		return this.request("POST", "/customers", input, options?.idempotencyKey);
	}

	// --- documents ---------------------------------------------------------------

	async listDocuments(): Promise<
		ApiEnvelope<{ id: string; status: string; document_number: string }[]>
	> {
		return this.request("GET", "/documents");
	}

	async issueDownloadToken(
		documentId: string,
	): Promise<ApiEnvelope<{ download_url: string; expires_at: string }>> {
		return this.request("POST", `/documents/${documentId}/download-token`);
	}

	// --- check-in -----------------------------------------------------------------

	async checkinSearch(query: string): Promise<ApiEnvelope<unknown[]>> {
		return this.request(
			"GET",
			`/checkin/search?q=${encodeURIComponent(query)}`,
		);
	}
}

/**
 * Receiver-side webhook verification (doc 05 §5): v1=<hex hmac_sha256(secret, ts.body)>
 * with a 10-minute replay window. Uses WebCrypto — runs on Workers, Node 18+, browsers.
 */
export async function verifyWebhookSignature(options: {
	secret: string;
	timestamp: string;
	body: string;
	signature: string;
	/** Epoch seconds; defaults to now. */
	nowSeconds?: number;
}): Promise<{ valid: boolean; reason?: string }> {
	const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
	const age = Math.abs(now - Number(options.timestamp));
	if (!Number.isFinite(age) || age > 600) {
		return { valid: false, reason: "timestamp outside replay window" };
	}
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(options.secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`${options.timestamp}.${options.body}`),
	);
	const expected = [...new Uint8Array(mac)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const received = options.signature.replace(/^v1=/, "");
	// Constant-time-ish compare
	if (expected.length !== received.length)
		return { valid: false, reason: "signature mismatch" };
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
	}
	return diff === 0
		? { valid: true }
		: { valid: false, reason: "signature mismatch" };
}
