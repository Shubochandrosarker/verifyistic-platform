import { describe, expect, it } from "vitest";
import { canonicalJson, chainEventHash, sha256Hex } from "../src/canonical.js";

describe("canonicalJson", () => {
	it("is independent of key insertion order", () => {
		const a = { b: 1, a: { d: 2, c: 3 } };
		const b = { a: { c: 3, d: 2 }, b: 1 };
		expect(canonicalJson(a)).toBe(canonicalJson(b));
		expect(canonicalJson(a)).toBe('{"a":{"c":3,"d":2},"b":1}');
	});

	it("drops undefined object values but keeps nulls", () => {
		expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it("serializes arrays in order and primitives stably", () => {
		expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
		expect(canonicalJson("x")).toBe('"x"');
		expect(canonicalJson(null)).toBe("null");
	});
});

describe("sha256Hex", () => {
	it("matches the known empty-input vector", async () => {
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("matches the known 'abc' vector", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});

describe("chainEventHash", () => {
	const event = { event_type: "signing_session.completed", entity_id: "doc_1" };

	it("is deterministic for the same event and previous hash", async () => {
		const h1 = await chainEventHash("genesis", event);
		const h2 = await chainEventHash("genesis", {
			entity_id: "doc_1",
			event_type: "signing_session.completed",
		});
		expect(h1).toBe(h2);
	});

	it("changes when the previous hash or payload changes", async () => {
		const base = await chainEventHash("genesis", event);
		expect(await chainEventHash("tampered", event)).not.toBe(base);
		expect(
			await chainEventHash("genesis", { ...event, entity_id: "doc_2" }),
		).not.toBe(base);
	});

	it("produces 64 lowercase hex chars", async () => {
		const hash = await chainEventHash("genesis", event);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});
});
