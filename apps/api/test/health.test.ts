import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

const app = createApp();

describe("GET /v1/health", () => {
	it("returns the success envelope with a minted request id", async () => {
		const res = await app.request("/v1/health");
		expect(res.status).toBe(200);
		expect(res.headers.get("X-Request-ID")).toMatch(/^req_/);

		const body = (await res.json()) as {
			data: { status: string; service: string; time: string };
			meta: { request_id: string };
		};
		expect(body.data.status).toBe("ok");
		expect(body.data.service).toBe("verifyistic-api");
		expect(body.meta.request_id).toBe(res.headers.get("X-Request-ID"));
	});

	it("honors a well-formed client X-Request-ID", async () => {
		const res = await app.request("/v1/health", {
			headers: { "X-Request-ID": "client-req-123456" },
		});
		expect(res.headers.get("X-Request-ID")).toBe("client-req-123456");
	});

	it("rejects malformed client request ids and mints one instead", async () => {
		const res = await app.request("/v1/health", {
			headers: { "X-Request-ID": "x" },
		});
		expect(res.headers.get("X-Request-ID")).toMatch(/^req_/);
	});
});

describe("error envelope", () => {
	it("unknown route returns the not_found error envelope", async () => {
		const res = await app.request("/v1/definitely-not-a-route");
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			error: { code: string; request_id: string };
		};
		expect(body.error.code).toBe("not_found");
		expect(body.error.request_id).toBe(res.headers.get("X-Request-ID"));
	});
});
