/**
 * StorageProvider — the only storage surface the signing/documents domain may use (doc 03 §8).
 * Implementations (Phase 5): LocalStorage, S3Storage, R2Storage, MinIOStorage.
 * Streaming reads are added in Phase 5; buffered get() suffices for the contract tests now.
 */

export interface StorageObjectMeta {
	key: string;
	size: number;
	contentType?: string;
	/** SHA-256 hex of the stored bytes, computed by the provider on write. */
	sha256?: string;
	/** True when the object is covered by a retention lock / legal hold. */
	immutable?: boolean;
}

export interface PutOptions {
	contentType?: string;
	/** Mark the object immutable at write time (completed artifacts, doc 09 §4). */
	immutable?: boolean;
}

export interface StorageGetResult {
	body: Uint8Array;
	meta: StorageObjectMeta;
}

export interface StorageProvider {
	readonly name: string;
	put(
		key: string,
		body: Uint8Array,
		options?: PutOptions,
	): Promise<StorageObjectMeta>;
	/** Returns null when the object does not exist — missing is not an error. */
	get(key: string): Promise<StorageGetResult | null>;
	head(key: string): Promise<StorageObjectMeta | null>;
	delete(key: string): Promise<void>;
	/** Short-lived authorized download URL. Buckets are private; this is the only read path for external consumers. */
	signedDownload(key: string, expiresInSeconds: number): Promise<string>;
	healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
