// Tri-state theme (System / Light / Dark). An explicit choice persists as a
// cookie so the ROOT LOADER can pin `color-scheme` on <html> during SSR — the
// first paint is already correct in both directions (localStorage can't do
// that without a flash). "system" is the absence of the cookie, never a value.

import { readCookie, serializeCookie } from "~/lib/cookies";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const COOKIE = "or_theme";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseTheme(value: unknown): Theme | null {
	return value === "system" || value === "light" || value === "dark"
		? value
		: null;
}

/** The theme this browser chose, or "system" when it never chose. */
export function getTheme(request: Request): Theme {
	return parseTheme(readCookie(request, COOKIE)) ?? "system";
}

/** `Set-Cookie` value persisting a choice; "system" clears the override. */
export function themeCookie(theme: Theme, secure: boolean): string {
	const clearing = theme === "system";
	return serializeCookie(
		COOKIE,
		clearing ? "" : theme,
		clearing ? 0 : YEAR_SECONDS,
		secure,
	);
}

export type SchemePin = "light" | "os";

/**
 * The `color-scheme` <html> carries, or null to let the OS decide. Pins
 * outrank the cookie: the marketing homepage stays canonical light, and
 * embeds always follow the viewer's OS (third-party iframes never send the
 * SameSite cookie, so a same-origin preview must not follow it either).
 */
export function documentScheme(
	pin: SchemePin | null,
	theme: Theme,
): "light" | "dark" | null {
	if (pin === "light") return "light";
	if (pin === "os") return null;
	return theme === "system" ? null : theme;
}
