/**
 * LocalStorageProvider — private filesystem storage (self-hosted default, doc 09 §9).
 * Keys are mapped to paths under a configurable root that MUST live outside any
 * public web root; there are no directory permissions to rely on beyond the process.
 * Downloads are app-gated (short-lived tokens), never direct file URLs.
 */
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { sha256Hex } from "@verifyistic/core";
import type {
	PutOptions,
	StorageGetResult,
	StorageObjectMeta,
	StorageProvider,
} from "./provider.js";

export class LocalStorageProvider implements StorageProvider {
	readonly name = "local";
	private readonly root: string;

	constructor(root: string) {
		if (!root || root === "/")
			throw new Error("LocalStorageProvider requires an explicit root path.");
		this.root = resolve(root);
	}

	/** Resolve a storage key to an absolute path, refusing any traversal outside the root. */
	private pathFor(key: string): string {
		const path = resolve(this.root, key);
		if (path !== this.root && !path.startsWith(this.root + sep)) {
			throw new Error(`Invalid storage key: ${key}`);
		}
		return path;
	}

	async put(
		key: string,
		body: Uint8Array,
		options?: PutOptions,
	): Promise<StorageObjectMeta> {
		const path = this.pathFor(key);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, body);
		return {
			key,
			size: body.byteLength,
			contentType: options?.contentType,
			sha256: await sha256Hex(body),
			immutable: options?.immutable,
		};
	}

	async get(key: string): Promise<StorageGetResult | null> {
		// Validate the key BEFORE the file op — traversal refusals must not be swallowed.
		const path = this.pathFor(key);
		try {
			const body = await readFile(path);
			const bytes = new Uint8Array(body);
			return {
				body: bytes,
				meta: {
					key,
					size: bytes.byteLength,
					sha256: await sha256Hex(bytes),
				},
			};
		} catch {
			return null;
		}
	}

	async head(key: string): Promise<StorageObjectMeta | null> {
		const path = this.pathFor(key);
		try {
			const info = await stat(path);
			return { key, size: info.size };
		} catch {
			return null;
		}
	}

	async delete(key: string): Promise<void> {
		await unlink(this.pathFor(key));
	}

	/** Local provider has no CDN URLs — downloads are app-gated; the returned marker is internal only. */
	async signedDownload(key: string, expiresInSeconds: number): Promise<string> {
		const meta = await this.head(key);
		if (!meta) throw new Error(`Object not found: ${key}`);
		const expiresAt = Date.now() + expiresInSeconds * 1000;
		return `local://${key}?expires_at=${expiresAt}`;
	}

	async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
		try {
			await mkdir(this.root, { recursive: true });
			return { ok: true, detail: `local root ${this.root}` };
		} catch (error) {
			return { ok: false, detail: (error as Error).message };
		}
	}
}
