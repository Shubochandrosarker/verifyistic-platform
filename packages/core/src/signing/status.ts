/**
 * Signing session lifecycle — the exact state machine from doc 07 §2.
 * `completed` is terminal for artifact content; void/revoke is separate metadata + audit.
 */
import { InvalidTransitionError } from "../errors.js";

export const SIGNING_SESSION_STATUSES = [
	"created",
	"sent",
	"viewed",
	"in_progress",
	"processing",
	"completed",
	"declined",
	"cancelled",
	"expired",
	"failed",
] as const;

export type SigningSessionStatus = (typeof SIGNING_SESSION_STATUSES)[number];

const TRANSITIONS: Readonly<
	Record<SigningSessionStatus, readonly SigningSessionStatus[]>
> = {
	created: ["sent", "cancelled", "expired"],
	sent: ["viewed", "cancelled", "expired"],
	viewed: ["in_progress", "declined", "expired"],
	in_progress: ["processing", "declined"],
	processing: ["completed", "failed"],
	completed: [],
	declined: [],
	cancelled: [],
	expired: [],
	failed: ["processing"],
};

export const TERMINAL_STATUSES: readonly SigningSessionStatus[] =
	Object.entries(TRANSITIONS)
		.filter(([, next]) => next.length === 0)
		.map(([status]) => status as SigningSessionStatus);

export function canTransition(
	from: SigningSessionStatus,
	to: SigningSessionStatus,
): boolean {
	return TRANSITIONS[from].includes(to);
}

export function assertTransition(
	from: SigningSessionStatus,
	to: SigningSessionStatus,
): void {
	if (!canTransition(from, to)) {
		throw new InvalidTransitionError(from, to);
	}
}
