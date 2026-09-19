import type { ApiError } from "@verifyistic/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Success envelope: {"data": ..., "meta": {"request_id": "req_..."}} (route contract v1). */
export function ok<T>(
	c: Context,
	data: T,
	extraMeta: Record<string, unknown> = {},
) {
	return c.json({
		data,
		meta: { request_id: c.get("requestId"), ...extraMeta },
	});
}

/** Error envelope: {"error": {"code", "message", "fields?", "request_id"}} (route contract v1). */
export function fail(c: Context, err: ApiError) {
	return c.json(
		{
			error: {
				code: err.code,
				message: err.message,
				...(err.fields ? { fields: err.fields } : {}),
				request_id: c.get("requestId"),
			},
		},
		err.status as ContentfulStatusCode,
	);
}

export function failInternal(c: Context) {
	return c.json(
		{
			error: {
				code: "internal_error",
				message: "Internal server error.",
				request_id: c.get("requestId"),
			},
		},
		500,
	);
}

export function failNotFound(c: Context) {
	return c.json(
		{
			error: {
				code: "not_found",
				message: "Resource not found.",
				request_id: c.get("requestId"),
			},
		},
		404,
	);
}
