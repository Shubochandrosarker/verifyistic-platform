import { connect } from "cloudflare:sockets";
import type { SmtpConnection, SmtpConnector } from "@verifyistic/webhooks";

interface CloudflareSocket {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	startTls(): CloudflareSocket;
	close(): Promise<void>;
}

export class CloudflareSmtpConnector implements SmtpConnector {
	async connect(options: {
		host: string;
		port: number;
		mode: "tls" | "starttls";
	}): Promise<SmtpConnection> {
		if (!options.host || !Number.isInteger(options.port) || options.port < 1) {
			throw new Error("SMTP host and port are not configured.");
		}
		const socket = connect(
			{ hostname: options.host, port: options.port },
			{ secureTransport: options.mode === "tls" ? "on" : "starttls" },
		) as unknown as CloudflareSocket;
		return new CloudflareSmtpConnection(socket);
	}
}

class CloudflareSmtpConnection implements SmtpConnection {
	private readonly encoder = new TextEncoder();
	private readonly decoder = new TextDecoder();
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private buffer = "";

	constructor(private socket: CloudflareSocket) {
		this.reader = socket.readable.getReader();
	}

	async readLine(): Promise<string> {
		while (true) {
			const newline = this.buffer.indexOf("\n");
			if (newline >= 0) {
				const line = this.buffer.slice(0, newline).replace(/\r$/, "");
				this.buffer = this.buffer.slice(newline + 1);
				return line;
			}
			if (this.buffer.length > 32_768) {
				throw new Error("SMTP response line is too long.");
			}
			const chunk = await this.reader.read();
			if (chunk.done) throw new Error("SMTP connection closed unexpectedly.");
			this.buffer += this.decoder.decode(chunk.value, { stream: true });
		}
	}

	async write(data: string): Promise<void> {
		const writer = this.socket.writable.getWriter();
		try {
			await writer.write(this.encoder.encode(data));
		} finally {
			writer.releaseLock();
		}
	}

	async startTls(): Promise<SmtpConnection> {
		this.reader.releaseLock();
		this.socket = this.socket.startTls();
		return new CloudflareSmtpConnection(this.socket);
	}

	async close(): Promise<void> {
		this.reader.releaseLock();
		await this.socket.close();
	}
}
