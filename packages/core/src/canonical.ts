/**
 * Canonical JSON + hash chaining for audit evidence.
 * One canonical serialization implementation only (data model v1, audit chain):
 *   event_hash = SHA256(previous_hash || canonical_json(event))
 * Tamper-evident, not magical immutability (doc 08 §5).
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
	return `{${entries.join(",")}}`;
}

const textEncoder = new TextEncoder();

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
	const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Append an event to the audit chain. */
export async function chainEventHash(
	previousHash: string,
	event: unknown,
): Promise<string> {
	return sha256Hex(previousHash + canonicalJson(event));
}
