/**
 * R2StorageProvider — wraps the native Cloudflare R2 **binding** used by the Workers
 * cloud deployment (ADR-001). The bucket is private by default; downloads are
 * app-gated (short-lived download tokens), so signedDownload returns an internal
 * marker rather than a public URL. Testable with a structural fake binding.
 */
import { sha256Hex } from "@verifyistic/core";
import type {
	PutOptions,
	StorageGetResult,
	StorageObjectMeta,
	StorageProvider,
} from "./provider.js";

/** Structural subset of the Workers R2Bucket binding — no Cloudflare types required in domain code. */
export interface R2BucketBinding {
	put(
		key: string,
		value: Uint8Array,
		options?: {
			httpMetadata?: { contentType?: string };
			customMetadata?: Record<string, string>;
		},
	): Promise<{ size: number } | undefined>;
	get(key: string): Promise<{
		size: number;
		body: { arrayBuffer(): Promise<ArrayBuffer> };
	} | null>;
	head(key: string): Promise<{ size: number } | null>;
	delete(key: string): Promise<void>;
}

export class R2StorageProvider implements StorageProvider {
	readonly name = "r2";

	constructor(private readonly bucket: R2BucketBinding) {}

	async put(
		key: string,
		body: Uint8Array,
		options?: PutOptions,
	): Promise<StorageObjectMeta> {
		await this.bucket.put(key, body, {
			httpMetadata: options?.contentType
				? { contentType: options.contentType }
				: undefined,
		});
		return {
			key,
			size: body.byteLength,
			contentType: options?.contentType,
			sha256: await sha256Hex(body),
			immutable: options?.immutable,
		};
	}

	async get(key: string): Promise<StorageGetResult | null> {
		const object = await this.bucket.get(key);
		if (!object) return null;
		// Real R2 bodies are ReadableStreams; read via Response (Workers-compatible).
		// Structural fakes in tests may expose arrayBuffer() directly.
		const rawBody = object.body as unknown;
		let buffer: ArrayBuffer;
		if (rawBody instanceof ArrayBuffer) {
			buffer = rawBody;
		} else if (
			typeof ReadableStream !== "undefined" &&
			rawBody instanceof ReadableStream
		) {
			buffer = await new Response(rawBody).arrayBuffer();
		} else {
			buffer = await (
				rawBody as { arrayBuffer(): Promise<ArrayBuffer> }
			).arrayBuffer();
		}
		const bytes = new Uint8Array(buffer);
		return {
			body: bytes,
			meta: { key, size: object.size, sha256: await sha256Hex(bytes) },
		};
	}

	async head(key: string): Promise<StorageObjectMeta | null> {
		const object = await this.bucket.head(key);
		return object ? { key, size: object.size } : null;
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}

	async signedDownload(key: string, expiresInSeconds: number): Promise<string> {
		if (!(await this.head(key))) throw new Error(`Object not found: ${key}`);
		return `r2://${key}?expires_at=${Date.now() + expiresInSeconds * 1000}`;
	}

	async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
		try {
			await this.bucket.head("__healthcheck__");
			return { ok: true, detail: "r2 binding reachable" };
		} catch (error) {
			return { ok: false, detail: (error as Error).message };
		}
	}
}
