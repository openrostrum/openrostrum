import { describe, expect, it } from "vitest";
import {
	deriveGettingStarted,
	dismissGettingStartedCookie,
	type GettingStartedFacts,
	isGettingStartedDismissed,
} from "../app/domain/getting-started";

// Oracle: the checklist spec — five ordered steps (basics → tracks/formats →
// published form → reviewers → first submission), each done-state derived
// from live data, the active step being the first incomplete one.

const ALL_DONE: GettingStartedFacts = {
	hasDates: true,
	hasLocation: true,
	trackCount: 2,
	formatCount: 1,
	publishedFormCount: 1,
	reviewerCount: 1,
	submissionCount: 3,
};

describe("deriveGettingStarted", () => {
	it("basics needs BOTH dates and location", () => {
		const datesOnly = deriveGettingStarted({ ...ALL_DONE, hasLocation: false });
		expect(datesOnly.steps.find((s) => s.id === "basics")?.done).toBe(false);
		const locationOnly = deriveGettingStarted({ ...ALL_DONE, hasDates: false });
		expect(locationOnly.steps.find((s) => s.id === "basics")?.done).toBe(false);
		expect(
			deriveGettingStarted(ALL_DONE).steps.find((s) => s.id === "basics")?.done,
		).toBe(true);
	});

	it("program needs at least one track AND one format", () => {
		const noFormats = deriveGettingStarted({ ...ALL_DONE, formatCount: 0 });
		expect(noFormats.steps.find((s) => s.id === "program")?.done).toBe(false);
		const noTracks = deriveGettingStarted({ ...ALL_DONE, trackCount: 0 });
		expect(noTracks.steps.find((s) => s.id === "program")?.done).toBe(false);
	});

	it("a draft-only form does not satisfy the publish step", () => {
		const state = deriveGettingStarted({ ...ALL_DONE, publishedFormCount: 0 });
		expect(state.steps.find((s) => s.id === "cfp")?.done).toBe(false);
	});

	it("the active step is the FIRST incomplete one in journey order", () => {
		const state = deriveGettingStarted({
			...ALL_DONE,
			trackCount: 0, // program incomplete…
			reviewerCount: 0, // …and so is a later step
		});
		expect(state.activeStepId).toBe("program");
		expect(state.complete).toBe(false);
		expect(state.doneCount).toBe(3);
	});

	it("all facts satisfied → complete, no active step, 5 of 5", () => {
		const state = deriveGettingStarted(ALL_DONE);
		expect(state.complete).toBe(true);
		expect(state.activeStepId).toBeNull();
		expect(state.doneCount).toBe(5);
	});

	it("always exposes exactly five ordered steps, independent of data volume", () => {
		const state = deriveGettingStarted({
			...ALL_DONE,
			submissionCount: 100_000,
		});
		expect(state.steps.map((s) => s.id)).toEqual([
			"basics",
			"program",
			"cfp",
			"reviewers",
			"first_submission",
		]);
	});
});

/* -------------------------------------------------------------- dismissal --- */

function requestWithCookie(cookie: string | null): Request {
	return new Request(
		"http://localhost/admin",
		cookie ? { headers: { Cookie: cookie } } : undefined,
	);
}

/** The Cookie header a browser would send back after receiving `setCookie`. */
function replay(setCookie: string): string {
	return setCookie.split(";")[0] ?? "";
}

describe("getting-started dismissal cookie", () => {
	it("round-trips: dismissed for exactly that user+event, no other", () => {
		const setCookie = dismissGettingStartedCookie(
			requestWithCookie(null),
			"user-1",
			"event-1",
			false,
		);
		const next = requestWithCookie(replay(setCookie));
		expect(isGettingStartedDismissed(next, "user-1", "event-1")).toBe(true);
		expect(isGettingStartedDismissed(next, "user-2", "event-1")).toBe(false);
		expect(isGettingStartedDismissed(next, "user-1", "event-2")).toBe(false);
	});

	it("a second event's dismissal keeps the first one", () => {
		const first = dismissGettingStartedCookie(
			requestWithCookie(null),
			"user-1",
			"event-1",
			false,
		);
		const second = dismissGettingStartedCookie(
			requestWithCookie(replay(first)),
			"user-1",
			"event-2",
			false,
		);
		const next = requestWithCookie(replay(second));
		expect(isGettingStartedDismissed(next, "user-1", "event-1")).toBe(true);
		expect(isGettingStartedDismissed(next, "user-1", "event-2")).toBe(true);
	});

	it("re-dismissing the same pair does not grow the cookie", () => {
		const first = dismissGettingStartedCookie(
			requestWithCookie(null),
			"user-1",
			"event-1",
			false,
		);
		const again = dismissGettingStartedCookie(
			requestWithCookie(replay(first)),
			"user-1",
			"event-1",
			false,
		);
		expect(replay(again)).toBe(replay(first));
	});

	it("caps stored pairs at 24, dropping the oldest first", () => {
		let cookie: string | null = null;
		for (let i = 1; i <= 25; i += 1) {
			cookie = replay(
				dismissGettingStartedCookie(
					requestWithCookie(cookie),
					"user-1",
					`event-${i}`,
					false,
				),
			);
		}
		const next = requestWithCookie(cookie);
		expect(isGettingStartedDismissed(next, "user-1", "event-1")).toBe(false);
		expect(isGettingStartedDismissed(next, "user-1", "event-2")).toBe(true);
		expect(isGettingStartedDismissed(next, "user-1", "event-25")).toBe(true);
	});

	it("is HttpOnly and long-lived; Secure only over https", () => {
		const insecure = dismissGettingStartedCookie(
			requestWithCookie(null),
			"u",
			"e",
			false,
		);
		expect(insecure).toContain("HttpOnly");
		expect(insecure).toMatch(/Max-Age=\d{6,}/);
		expect(insecure).not.toContain("Secure");
		const secure = dismissGettingStartedCookie(
			requestWithCookie(null),
			"u",
			"e",
			true,
		);
		expect(secure).toContain("Secure");
	});
});
