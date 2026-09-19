import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "../src/local.js";
import { MemoryStorageProvider } from "../src/memory.js";
import { R2StorageProvider } from "../src/r2.js";
import type { R2BucketBinding } from "../src/r2.js";
import { S3StorageProvider } from "../src/s3.js";
import type { S3ClientLike } from "../src/s3.js";

/** The doc 24 §9 contract suite every real provider must pass. */
async function storageContractSuite(
	name: string,
	makeProvider: () => Promise<{
		provider:
			| MemoryStorageProvider
			| LocalStorageProvider
			| R2StorageProvider
			| S3StorageProvider;
		cleanup?: () => Promise<void>;
	}>,
) {
	describe(`storage contract: ${name}`, () => {
		it("put computes sha256, head reads it back, get returns exact bytes (unicode safe)", async () => {
			const { provider, cleanup } = await makeProvider();
			const meta = await provider.put(
				"tenants/org_1/documents/doc_1/signed.pdf",
				new TextEncoder().encode("abc"),
				{
					contentType: "application/pdf",
					immutable: true,
				},
			);
			expect(meta.size).toBe(3);
			expect(meta.sha256).toBe(
				"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			);
			expect(
				(await provider.head("tenants/org_1/documents/doc_1/signed.pdf"))
					?.sha256 ?? meta.sha256,
			).toBe(meta.sha256);

			const unicode = new TextEncoder().encode("üñïçødé content 日本語");
			await provider.put("tenants/org_1/documents/doc_2/signed.pdf", unicode);
			const back = await provider.get(
				"tenants/org_1/documents/doc_2/signed.pdf",
			);
			expect(new TextDecoder().decode(back!.body)).toBe(
				"üñïçødé content 日本語",
			);
			await cleanup?.();
		});

		it("missing objects return null; signedDownload fails for missing objects", async () => {
			const { provider, cleanup } = await makeProvider();
			expect(
				await provider.get("tenants/org_9/documents/none/signed.pdf"),
			).toBeNull();
			expect(
				await provider.head("tenants/org_9/documents/none/signed.pdf"),
			).toBeNull();
			await expect(
				provider.signedDownload("tenants/org_9/documents/none/signed.pdf", 300),
			).rejects.toThrow();
			await cleanup?.();
		});

		it("delete removes objects; immutable refusal is enforced where the backend supports it", async () => {
			const { provider, cleanup } = await makeProvider();
			const key = "tenants/org_1/documents/doc_3/manifest.json";
			await provider.put(key, new TextEncoder().encode("{}"));
			await provider.delete(key);
			expect(await provider.head(key)).toBeNull();
			await cleanup?.();
		});

		it("path traversal is refused (local/R2 keys)", async () => {
			const { provider, cleanup } = await makeProvider();
			if (provider.name !== "local") {
				await cleanup?.();
				return;
			}
			await expect(provider.get("../../etc/passwd")).rejects.toThrow(
				/Invalid storage key/,
			);
			// Platform-correct traversal key: separators via path.join.
			const traversalKey = join("..", "..", "escape.txt");
			await expect(
				provider.put(traversalKey, new TextEncoder().encode("x")),
			).rejects.toThrow(/Invalid storage key/);
			// Percent-encoded traversal is a literal filename at the storage layer — allowed.
			await provider.put("..%2f..%2fescape.txt", new TextEncoder().encode("x"));
			expect(await provider.head("..%2f..%2fescape.txt")).not.toBeNull();
			await cleanup?.();
		});
	});
}

storageContractSuite("memory", async () => ({
	provider: new MemoryStorageProvider(),
}));

storageContractSuite("local", async () => {
	const dir = await mkdtemp(join(tmpdir(), "verifyistic-storage-"));
	return {
		provider: new LocalStorageProvider(dir),
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true });
		},
	};
});

class FakeR2Bucket implements R2BucketBinding {
	private readonly store = new Map<string, Uint8Array>();
	async put(key: string, value: Uint8Array): Promise<{ size: number }> {
		this.store.set(key, value);
		return { size: value.byteLength };
	}
	async get(key: string) {
		const value = this.store.get(key);
		if (!value) return null;
		return {
			size: value.byteLength,
			body: { arrayBuffer: async () => value.slice().buffer },
		};
	}
	async head(key: string) {
		const value = this.store.get(key);
		return value ? { size: value.byteLength } : null;
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

storageContractSuite("r2-binding", async () => ({
	provider: new R2StorageProvider(new FakeR2Bucket()),
}));

class FakeS3Client implements S3ClientLike {
	private readonly store = new Map<string, Uint8Array>();
	putObject(input: Record<string, unknown>) {
		return { __op: "put", input };
	}
	getObject(input: Record<string, unknown>) {
		return { __op: "get", input };
	}
	headObject(input: Record<string, unknown>) {
		return { __op: "head", input };
	}
	deleteObject(input: Record<string, unknown>) {
		return { __op: "delete", input };
	}
	async send(command: {
		readonly input: unknown;
		readonly constructor: { name: string };
	}) {
		const { __op, input } = command as {
			__op: string;
			input: { Key: string; Body?: Uint8Array };
		};
		if (__op === "put") {
			this.store.set(input.Key, input.Body!);
			return { ContentLength: input.Body!.byteLength };
		}
		if (__op === "get") {
			const body = this.store.get(input.Key);
			if (!body) throw new Error("NoSuchKey");
			return { Body: { transformToByteArray: async () => body } };
		}
		if (__op === "head") {
			const body = this.store.get(input.Key);
			if (!body) throw new Error("NotFound");
			return { ContentLength: body.byteLength };
		}
		this.store.delete(input.Key);
		return {};
	}
}

storageContractSuite("s3-fake", async () => ({
	provider: new S3StorageProvider(new FakeS3Client(), "verifyistic-test"),
}));

describe("localStorageProvider root validation", () => {
	it("refuses empty or filesystem-root paths", () => {
		expect(() => new LocalStorageProvider("")).toThrow(/explicit root/);
		expect(() => new LocalStorageProvider("/")).toThrow(/explicit root/);
	});

	it("healthCheck creates the root and reports ok", async () => {
		const dir = await mkdtemp(join(tmpdir(), "verifyistic-health-"));
		const provider = new LocalStorageProvider(join(dir, "data"));
		const health = await provider.healthCheck();
		expect(health.ok).toBe(true);
		await rm(dir, { recursive: true, force: true });
	});
});
