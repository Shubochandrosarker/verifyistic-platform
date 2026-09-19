import { describe, expect, it } from "vitest";
import {
	constantTimeEqual,
	generateSignerToken,
	hashSignerToken,
} from "../src/tokens.js";

describe("signer tokens (doc 07 §3)", () => {
	it("is 256-bit entropy rendered as 43 url-safe chars", () => {
		const token = generateSignerToken();
		expect(token).toHaveLength(43);
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("does not repeat across generations", () => {
		const seen = new Set(
			Array.from({ length: 100 }, () => generateSignerToken()),
		);
		expect(seen.size).toBe(100);
	});

	it("hashes to a stable 64-char hex digest; raw token is not recoverable", async () => {
		const token = generateSignerToken();
		const hash = await hashSignerToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashSignerToken(token)).toBe(hash);
		expect(hash).not.toContain(token);
	});
});

describe("constantTimeEqual", () => {
	it("matches equal strings and rejects different ones", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
	});

	it("rejects different lengths without throwing", () => {
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("", "a")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(true);
	});
});
