import { ApiError } from "@verifyistic/core";
import { Hono } from "hono";
import type { AppServices } from "../deps.js";
import { ok } from "../lib/envelope.js";
import { requireScope } from "../middleware/auth.js";

function toPublicEndpoint(record: {
	id: string;
	url: string;
	subscribed_events: string;
	status: string;
	created_at: string;
}) {
	return {
		id: record.id,
		url: record.url,
		subscribed_events: JSON.parse(record.subscribed_events),
		status: record.status,
		created_at: record.created_at,
	};
}

export function webhookRoutes(deps: AppServices) {
	const routes = new Hono();

	routes.post("/", async (c) => {
		const { tenant } = requireScope(c, "webhooks:write");
		const body = await c.req.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw ApiError.validation("Request body must be a JSON object.");
		}
		const { url, events } = body as { url?: unknown; events?: unknown };
		if (typeof url !== "string" || url.length === 0 || url.length > 500) {
			throw ApiError.validation("url is required.", { url: ["required"] });
		}
		try {
			const { record, secret } = await deps.webhooks.registerEndpoint(tenant, {
				url,
				subscribedEvents: Array.isArray(events)
					? (events as string[])
					: undefined,
			});
			// Raw signing secret shown exactly once (doc 05 §5).
			return ok(c, { ...toPublicEndpoint(record), secret }, { created: true });
		} catch (error) {
			if ((error as Error).message.includes("Webhook URL rejected")) {
				throw ApiError.validation((error as Error).message, {
					url: ["rejected"],
				});
			}
			throw error;
		}
	});

	routes.get("/", async (c) => {
		requireScope(c, "webhooks:read");
		const endpoints = await deps.webhooks.listEndpoints(c.get("tenant")!);
		return ok(c, endpoints.map(toPublicEndpoint));
	});

	routes.get("/:id/deliveries", async (c) => {
		requireScope(c, "webhooks:read");
		const deliveries = await deps.webhooks.listDeliveries(
			c.get("tenant")!,
			c.req.param("id"),
		);
		return ok(c, deliveries);
	});

	routes.delete("/:id", async (c) => {
		const { tenant } = requireScope(c, "webhooks:write");
		const removed = await deps.webhooks.removeEndpoint(
			tenant,
			c.req.param("id"),
		);
		if (!removed) throw ApiError.notFound("Webhook endpoint not found.");
		return ok(c, { removed: true });
	});

	return routes;
}
