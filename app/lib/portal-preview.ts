/**
 * Admin "View portal as" preview state. The cookie is a UI selector, NOT a
 * credential: it only names a contact, and every request re-derives the
 * caller's authority from their real session (admin role + org membership on
 * the contact's event) before the preview applies. A forged or stolen value
 * therefore grants nothing the holder couldn't already reach, and the admin's
 * auth session is never swapped.
 */

const COOKIE = "__portal_preview";
const PREVIEW_TTL_SECONDS = 60 * 60 * 2;

function cookieHeader(
	value: string,
	maxAgeSeconds: number,
	secure: boolean,
): string {
	const attrs = [
		`${COOKIE}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
	];
	if (secure) attrs.push("Secure");
	return attrs.join("; ");
}

/** `Set-Cookie` value that starts previewing the given contact. */
export function startPreviewCookie(contactId: string, secure: boolean): string {
	return cookieHeader(
		encodeURIComponent(contactId),
		PREVIEW_TTL_SECONDS,
		secure,
	);
}

/** `Set-Cookie` value that ends the preview. */
export function clearPreviewCookie(secure: boolean): string {
	return cookieHeader("", 0, secure);
}

/** The contact id the preview cookie names, or null. Authorization is NOT
 * checked here — callers must verify the session user may preview it. */
export function readPreviewContactId(request: Request): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === COOKIE) {
			const value = rest.join("=");
			return value === "" ? null : decodeURIComponent(value);
		}
	}
	return null;
}
