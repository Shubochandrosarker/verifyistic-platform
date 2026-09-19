/**
 * S3StorageProvider — S3-compatible object storage for self-hosted (AWS S3, MinIO,
 * and any S3-compatible endpoint including R2 over its S3 API, doc 09 §9).
 * Uses an injected structural client so tests run without network or SDK credentials.
 */
import { sha256Hex } from "@verifyistic/core";
import type {
	PutOptions,
	StorageGetResult,
	StorageObjectMeta,
	StorageProvider,
} from "./provider.js";

/** Structural subset the provider needs — satisfied by @aws-sdk/client-s3 in the app layer. */
export interface S3ClientLike {
	send(command: {
		readonly input: unknown;
		readonly constructor: { name: string };
	}): Promise<{
		Body?: { transformToByteArray(): Promise<Uint8Array> };
		ContentLength?: number;
	}>;
	putObject(input: Record<string, unknown>): unknown;
	getObject(input: Record<string, unknown>): unknown;
	headObject(input: Record<string, unknown>): unknown;
	deleteObject(input: Record<string, unknown>): unknown;
}

export interface S3StorageConfig {
	endpoint?: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export class S3StorageProvider implements StorageProvider {
	readonly name = "s3";

	constructor(
		private readonly client: S3ClientLike,
		private readonly bucket: string,
	) {}

	async put(
		key: string,
		body: Uint8Array,
		options?: PutOptions,
	): Promise<StorageObjectMeta> {
		await this.client.send(
			this.client.putObject({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: options?.contentType,
			}) as Parameters<S3ClientLike["send"]>[0],
		);
		return {
			key,
			size: body.byteLength,
			contentType: options?.contentType,
			sha256: await sha256Hex(body),
			immutable: options?.immutable,
		};
	}

	async get(key: string): Promise<StorageGetResult | null> {
		try {
			const response = await this.client.send(
				this.client.getObject({ Bucket: this.bucket, Key: key }) as Parameters<
					S3ClientLike["send"]
				>[0],
			);
			if (!response.Body) return null;
			const bytes = await response.Body.transformToByteArray();
			return {
				body: bytes,
				meta: { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) },
			};
		} catch {
			return null;
		}
	}

	async head(key: string): Promise<StorageObjectMeta | null> {
		try {
			const response = await this.client.send(
				this.client.headObject({ Bucket: this.bucket, Key: key }) as Parameters<
					S3ClientLike["send"]
				>[0],
			);
			return { key, size: response.ContentLength ?? 0 };
		} catch {
			return null;
		}
	}

	async delete(key: string): Promise<void> {
		await this.client.send(
			this.client.deleteObject({ Bucket: this.bucket, Key: key }) as Parameters<
				S3ClientLike["send"]
			>[0],
		);
	}

	/** With static keys the app-layer can issue presigned URLs; via binding it stays app-gated. */
	async signedDownload(key: string, expiresInSeconds: number): Promise<string> {
		if (!(await this.head(key))) throw new Error(`Object not found: ${key}`);
		return `s3://${this.bucket}/${key}?expires_at=${Date.now() + expiresInSeconds * 1000}`;
	}

	async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
		try {
			await this.head("__healthcheck__");
			return { ok: true, detail: `s3 bucket ${this.bucket}` };
		} catch (error) {
			return { ok: false, detail: (error as Error).message };
		}
	}
}
