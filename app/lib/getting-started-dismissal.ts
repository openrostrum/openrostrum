import { createCookie } from "react-router";

/**
 * "Don't show again" for the getting-started checklist: an HttpOnly cookie
 * of `userId.eventId` pairs — scoped so one admin's dismissal never hides
 * the card for a teammate or for their other events.
 */
const dismissCookie = createCookie("or_gs_dismissed", {
	path: "/",
	httpOnly: true,
	sameSite: "lax",
	maxAge: 60 * 60 * 24 * 365,
});

/** Newest-kept cap so the cookie can't grow past header limits. */
const DISMISS_MAX_PAIRS = 24;

function dismissalPair(userId: string, eventId: string): string {
	return `${userId}.${eventId}`;
}

async function readPairs(request: Request): Promise<string[]> {
	const value: unknown = await dismissCookie.parse(
		request.headers.get("Cookie"),
	);
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

export async function isGettingStartedDismissed(
	request: Request,
	userId: string,
	eventId: string,
): Promise<boolean> {
	return (await readPairs(request)).includes(dismissalPair(userId, eventId));
}

/**
 * `Set-Cookie` value recording one more dismissal on top of whatever the
 * request already carries. Pass `secure` from `isSecureRequest(request)` so
 * the cookie isn't dropped on local http dev.
 */
export async function dismissGettingStartedCookie(
	request: Request,
	userId: string,
	eventId: string,
	secure: boolean,
): Promise<string> {
	const pair = dismissalPair(userId, eventId);
	const pairs = (await readPairs(request))
		.filter((p) => p !== pair)
		.concat(pair)
		.slice(-DISMISS_MAX_PAIRS);
	return dismissCookie.serialize(pairs, { secure });
}
