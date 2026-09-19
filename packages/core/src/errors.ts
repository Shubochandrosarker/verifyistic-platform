/** Error envelope codes per API route contract v1 (doc 05 §2). */
export const ERROR_CODES = [
	"validation_error",
	"unauthorized",
	"forbidden",
	"not_found",
	"idempotency_conflict",
	"rate_limited",
	"internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	validation_error: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	idempotency_conflict: 409,
	rate_limited: 429,
	internal_error: 500,
};

export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly fields?: Record<string, string[]>;

	constructor(
		code: ErrorCode,
		message: string,
		fields?: Record<string, string[]>,
	) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.status = STATUS_BY_CODE[code];
		this.fields = fields;
	}

	static validation(
		message: string,
		fields?: Record<string, string[]>,
	): ApiError {
		return new ApiError("validation_error", message, fields);
	}

	static forbidden(
		message = "You do not have access to this resource.",
	): ApiError {
		return new ApiError("forbidden", message);
	}

	static notFound(message = "Resource not found."): ApiError {
		return new ApiError("not_found", message);
	}
}

/** Thrown when a signing session status change violates the state machine (doc 07 §2). */
export class InvalidTransitionError extends Error {
	constructor(
		readonly from: string,
		readonly to: string,
	) {
		super(`Invalid signing session transition: ${from} -> ${to}`);
		this.name = "InvalidTransitionError";
	}
}
