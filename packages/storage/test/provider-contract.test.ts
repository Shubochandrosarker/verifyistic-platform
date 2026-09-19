import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "../src/memory.js";

/**
 * Contract suite for StorageProvider (doc 24 §9: put/head/read/missing object + retention).
 * Every real implementation (local, S3, R2, MinIO) must pass the same suite in Phase 5.
 */
function storageContractSuite(
	name: string,
	makeProvider: () => MemoryStorageProvider,
) {
	describe(`storage contract: ${name}`, () => {
		it("put computes sha256 and returns metadata; head reads it back", async () => {
			const provider = makeProvider();
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
			expect(meta.immutable).toBe(true);

			const head = await provider.head(
				"tenants/org_1/documents/doc_1/signed.pdf",
			);
			expect(head?.sha256).toBe(meta.sha256);
		});

		it("get returns the exact bytes that were written", async () => {
			const provider = makeProvider();
			const body = new TextEncoder().encode("üñïçødé content");
			await provider.put("tenants/org_1/documents/doc_2/signed.pdf", body);
			const result = await provider.get(
				"tenants/org_1/documents/doc_2/signed.pdf",
			);
			expect(new TextDecoder().decode(result!.body)).toBe("üñïçødé content");
		});

		it("missing objects return null instead of throwing", async () => {
			const provider = makeProvider();
			expect(
				await provider.get("tenants/org_9/documents/none/signed.pdf"),
			).toBeNull();
			expect(
				await provider.head("tenants/org_9/documents/none/signed.pdf"),
			).toBeNull();
		});

		it("delete removes objects but refuses immutable (legal hold) objects", async () => {
			const provider = makeProvider();
			const key = "tenants/org_1/documents/doc_3/manifest.json";
			await provider.put(key, new TextEncoder().encode("{}"));
			await provider.delete(key);
			expect(await provider.head(key)).toBeNull();

			const heldKey = "tenants/org_1/documents/doc_4/signed.pdf";
			await provider.put(heldKey, new TextEncoder().encode("held"), {
				immutable: true,
			});
			await expect(provider.delete(heldKey)).rejects.toThrow(/immutable/);
			expect(await provider.head(heldKey)).not.toBeNull();
		});

		it("signedDownload issues an expiring URL and fails for missing objects", async () => {
			const provider = makeProvider();
			await provider.put(
				"tenants/org_1/documents/doc_5/certificate.pdf",
				new TextEncoder().encode("cert"),
			);
			const url = await provider.signedDownload(
				"tenants/org_1/documents/doc_5/certificate.pdf",
				300,
			);
			expect(url).toContain("expires_at=");
			await expect(
				provider.signedDownload(
					"tenants/org_1/documents/none/certificate.pdf",
					300,
				),
			).rejects.toThrow();
		});
	});
}

storageContractSuite("memory", () => new MemoryStorageProvider());
