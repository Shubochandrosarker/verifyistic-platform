/**
 * In-memory StorageProvider — used for unit/contract tests and local dev without storage deps.
 * NOT for production use.
 */
import { sha256Hex } from "@verifyistic/core";
import type {
	PutOptions,
	StorageGetResult,
	StorageObjectMeta,
	StorageProvider,
} from "./provider.js";

interface StoredObject {
	body: Uint8Array;
	meta: StorageObjectMeta;
}

export class MemoryStorageProvider implements StorageProvider {
	readonly name = "memory";
	private readonly objects = new Map<string, StoredObject>();

	async put(
		key: string,
		body: Uint8Array,
		options?: PutOptions,
	): Promise<StorageObjectMeta> {
		const copy = new Uint8Array(body);
		const meta: StorageObjectMeta = {
			key,
			size: copy.byteLength,
			contentType: options?.contentType,
			sha256: await sha256Hex(copy),
			immutable: options?.immutable,
		};
		this.objects.set(key, { body: copy, meta });
		return { ...meta };
	}

	async get(key: string): Promise<StorageGetResult | null> {
		const stored = this.objects.get(key);
		if (!stored) return null;
		return { body: new Uint8Array(stored.body), meta: { ...stored.meta } };
	}

	async head(key: string): Promise<StorageObjectMeta | null> {
		const stored = this.objects.get(key);
		return stored ? { ...stored.meta } : null;
	}

	async delete(key: string): Promise<void> {
		const stored = this.objects.get(key);
		if (stored?.meta.immutable) {
			throw new Error(`Object is immutable and cannot be deleted: ${key}`);
		}
		this.objects.delete(key);
	}

	async signedDownload(key: string, expiresInSeconds: number): Promise<string> {
		if (!this.objects.has(key)) {
			throw new Error(`Object not found: ${key}`);
		}
		const expiresAt = Date.now() + expiresInSeconds * 1000;
		return `memory://${key}?expires_at=${expiresAt}`;
	}

	async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
		return { ok: true, detail: "memory provider" };
	}
}
