/**
 * SSRF-safe URL validation for webhook endpoints (doc 16 §5):
 * - http/https only; hostname validated before any request
 * - localhost, loopback, private, link-local, and reserved addresses rejected
 * - resolution-based revalidation happens at delivery time via the injected fetcher's
 *   environment (DNS-level blocking is the network policy's job; this is app-level).
 */
export function isWebhookUrlAllowed(rawUrl: string): {
	allowed: boolean;
	reason?: string;
} {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { allowed: false, reason: "URL is not parseable." };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { allowed: false, reason: "Only http(s) URLs are allowed." };
	}
	const host = url.hostname.toLowerCase();

	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "0.0.0.0" ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	) {
		return {
			allowed: false,
			reason: "Local and internal hostnames are not allowed.",
		};
	}

	const ipCandidate =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	if (netlocIsPrivate(ipCandidate)) {
		return {
			allowed: false,
			reason: "Private, loopback, and reserved addresses are not allowed.",
		};
	}
	return { allowed: true };
}

function netlocIsPrivate(host: string): boolean {
	const parts = host.split(".");
	const isDottedQuad =
		parts.length === 4 &&
		parts.every((p) => p.length > 0 && /^\d{1,3}$/.test(p));
	if (isDottedQuad) {
		const octets = parts.map((p) => Number(p));
		const valid = octets.every((n) => n >= 0 && n <= 255);
		if (!valid) return true; // malformed numeric host — treat as reserved
		const first = octets[0];
		const second = octets[1];
		if (first === 10 || first === 127 || first === 0) return true; // private, loopback, unspecified
		if (first === 169 && second === 254) return true; // link-local (cloud metadata range)
		if (first === 172 && second >= 16 && second <= 31) return true;
		if (first === 192 && second === 168) return true;
		if (first === 100 && second >= 64 && second <= 127) return true; // CGNAT
		return false;
	}
	// IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
	const lower = host.toLowerCase();
	if (lower === "::" || lower === "::1") return true;
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
	if (
		lower.startsWith("fe8") ||
		lower.startsWith("fe9") ||
		lower.startsWith("fea") ||
		lower.startsWith("feb")
	) {
		return true;
	}
	return false;
}
