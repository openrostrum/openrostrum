/**
 * "Don't show again" for the dashboard's getting-started checklist, stored in
 * an HttpOnly cookie of `userId.eventId` pairs — keyed per user+event so one
 * admin's dismissal never hides the card for a teammate or for their other
 * events. Deliberately not a DB row: the checklist's primary exit is
 * completion (derived in app/domain/getting-started.ts); the dismissal is a
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
