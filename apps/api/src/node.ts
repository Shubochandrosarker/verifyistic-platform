/**
 * Node runtime entry — self-hosted and local dev (ADR-001).
 * The cloud deployment serves the same app from the Workers entry (wrangler main).
 * Usage: pnpm dev:api → http://localhost:8787/v1/health
 */
import { serve } from "@hono/node-server";
import { createApp } from "./index.js";

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp().fetch, port }, (info) => {
	console.log(
		`verifyistic-api listening on http://localhost:${info.port}/v1/health`,
	);
});
