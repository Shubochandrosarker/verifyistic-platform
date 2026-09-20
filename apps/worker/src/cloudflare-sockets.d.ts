declare module "cloudflare:sockets" {
	export function connect(
		address: { hostname: string; port: number },
		options?: { secureTransport?: "on" | "off" | "starttls" },
	): unknown;
}
