import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../src/errors.js";
import {
	type SigningSessionStatus,
	TERMINAL_STATUSES,
	assertTransition,
	canTransition,
} from "../src/signing/status.js";

describe("signing session state machine (doc 07 §2)", () => {
	it("allows the full happy path to completion", () => {
		const path: SigningSessionStatus[] = [
			"created",
			"sent",
			"viewed",
			"in_progress",
			"processing",
			"completed",
		];
		for (let i = 0; i < path.length - 1; i++) {
			expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
		}
	});

	it("allows cancellation before work starts, decline after the signer engaged", () => {
		expect(canTransition("created", "cancelled")).toBe(true);
		expect(canTransition("sent", "cancelled")).toBe(true);
		expect(canTransition("viewed", "declined")).toBe(true);
		expect(canTransition("in_progress", "declined")).toBe(true);
	});

	it("allows expiry from every pre-engagement state and failed processing recovery", () => {
		expect(canTransition("created", "expired")).toBe(true);
		expect(canTransition("sent", "expired")).toBe(true);
		expect(canTransition("viewed", "expired")).toBe(true);
		expect(canTransition("processing", "failed")).toBe(true);
		expect(canTransition("failed", "processing")).toBe(true);
	});

	it("forbids skipping to completion and any transition out of terminal states", () => {
		expect(canTransition("created", "completed")).toBe(false);
		expect(canTransition("sent", "completed")).toBe(false);
		expect(canTransition("completed", "declined")).toBe(false);
		expect(canTransition("declined", "created")).toBe(false);
		expect(canTransition("cancelled", "sent")).toBe(false);
		expect(canTransition("expired", "sent")).toBe(false);
	});

	it("does not allow voiding through the state machine (void is separate metadata + audit)", () => {
		expect(canTransition("completed", "cancelled")).toBe(false);
	});

	it("assertTransition throws InvalidTransitionError for illegal moves", () => {
		expect(() => assertTransition("created", "completed")).toThrow(
			InvalidTransitionError,
		);
		expect(() => assertTransition("completed", "failed")).toThrow(
			InvalidTransitionError,
		);
	});

	it("treats completed/declined/cancelled/expired as terminal", () => {
		expect([...TERMINAL_STATUSES].sort()).toEqual([
			"cancelled",
			"completed",
			"declined",
			"expired",
		]);
	});
});
