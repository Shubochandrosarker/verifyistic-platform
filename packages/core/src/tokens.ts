/**
 * Signer tokens (doc 07 §3):
 * - 32 random bytes (256-bit) rendered base64url for the URL  sign.verifyistic.com/s/{token}
 * - raw token never stored or logged — callers persist hashSignerToken(token) only
 * - constant-time comparison for any token lookup path
 */
import { sha256Hex } from "./canonical.js";

export const SIGNER_TOKEN_BYTES = 32;

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function generateSignerToken(): string {
	const bytes = new Uint8Array(SIGNER_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

export async function hashSignerToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export function constantTimeEqual(a: string, b: string): boolean {
	const ea = new TextEncoder().encode(a);
	const eb = new TextEncoder().encode(b);
	let diff = ea.length ^ eb.length;
	const len = Math.max(ea.length, eb.length);
	for (let i = 0; i < len; i++) {
		diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
	}
	return diff === 0;
}
