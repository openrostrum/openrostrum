/**
 * The dashboard's first-run checklist. Every step's done-state is DERIVED from
 * live data on each load — nothing is stored per step, so work done outside
 * the checklist (or undone: a form deleted, the location cleared) is always
 * reflected honestly. The only stored bit is the explicit dismissal.
 */

export const GETTING_STARTED_STEPS = [
	"basics",
	"program",
	"cfp",
	"reviewers",
	"first_submission",
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number];

export type GettingStartedFacts = {
	hasDates: boolean;
	hasLocation: boolean;
	trackCount: number;
	formatCount: number;
	/** Forms whose status left `draft` — a closed form was still published. */
	publishedFormCount: number;
	reviewerCount: number;
	/** Non-draft submissions. */
	submissionCount: number;
};

export type GettingStartedState = {
	steps: Array<{ id: GettingStartedStepId; done: boolean }>;
	doneCount: number;
	complete: boolean;
	/** First incomplete step in journey order — the one the card highlights. */
	activeStepId: GettingStartedStepId | null;
};

export function deriveGettingStarted(
	facts: GettingStartedFacts,
): GettingStartedState {
	const done: Record<GettingStartedStepId, boolean> = {
		basics: facts.hasDates && facts.hasLocation,
		program: facts.trackCount > 0 && facts.formatCount > 0,
		cfp: facts.publishedFormCount > 0,
		reviewers: facts.reviewerCount > 0,
		first_submission: facts.submissionCount > 0,
	};
	const steps = GETTING_STARTED_STEPS.map((id) => ({ id, done: done[id] }));
	const doneCount = steps.reduce((n, s) => n + (s.done ? 1 : 0), 0);
	return {
		steps,
		doneCount,
		complete: doneCount === steps.length,
		activeStepId: steps.find((s) => !s.done)?.id ?? null,
	};
}

/* -------------------------------------------------------------- dismissal --- */

/**
 * "Don't show again" lives in an HttpOnly cookie holding `userId.eventId`
 * pairs — keyed per user+event so one admin's dismissal never hides the card
 * for a teammate or for their other events. Deliberately not a DB row: the
 * checklist's primary exit is completion (derived above); the dismissal is a
 * browser-level escape hatch, and reappearing once on a new device is
 * acceptable for a card that only shows while setup is incomplete.
 */
const DISMISS_COOKIE = "or_gs_dismissed";
const DISMISS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Newest-kept cap so the cookie can't grow past header limits. */
const DISMISS_MAX_PAIRS = 24;

function dismissalPair(userId: string, eventId: string): string {
	return `${userId}.${eventId}`;
}

export function parseDismissedPairs(cookieHeader: string | null): string[] {
	if (!cookieHeader) return [];
	for (const part of cookieHeader.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === DISMISS_COOKIE) {
			return rest.join("=").split("|").filter(Boolean);
		}
	}
	return [];
}

export function isGettingStartedDismissed(
	request: Request,
	userId: string,
	eventId: string,
): boolean {
	return parseDismissedPairs(request.headers.get("Cookie")).includes(
		dismissalPair(userId, eventId),
	);
}

/**
 * `Set-Cookie` value recording one more dismissal on top of whatever the
 * request already carries. Pass `secure` from `isSecureRequest(request)` so
 * the cookie isn't dropped on local http dev.
 */
export function dismissGettingStartedCookie(
	request: Request,
	userId: string,
	eventId: string,
	secure: boolean,
): string {
	const pair = dismissalPair(userId, eventId);
	const pairs = parseDismissedPairs(request.headers.get("Cookie"))
		.filter((p) => p !== pair)
		.concat(pair)
		.slice(-DISMISS_MAX_PAIRS);
	const attrs = [
		`${DISMISS_COOKIE}=${pairs.join("|")}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${DISMISS_MAX_AGE_SECONDS}`,
	];
	if (secure) attrs.push("Secure");
	return attrs.join("; ");
}
