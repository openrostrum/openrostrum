/**
 * Admin "View portal as" preview state. The cookie is a UI selector, NOT a
 * credential: it only names a contact, and every request re-derives the
 * caller's authority from their real session (admin role + org membership on
 * the contact's event) before the preview applies. A forged or stolen value
 * therefore grants nothing the holder couldn't already reach, and the admin's
 * auth session is never swapped.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "~/db";
import { contacts } from "~/db/schema";
import { cookieHeader, readCookie } from "~/lib/cookies";

const COOKIE = "__portal_preview";
const PREVIEW_TTL_SECONDS = 60 * 60 * 2;

/** `Set-Cookie` value that starts previewing the given contact. */
export function startPreviewCookie(contactId: string, secure: boolean): string {
	return cookieHeader(
		COOKIE,
		encodeURIComponent(contactId),
		PREVIEW_TTL_SECONDS,
		secure,
	);
}

/** `Set-Cookie` value that ends the preview. */
export function clearPreviewCookie(secure: boolean): string {
	return cookieHeader(COOKIE, "", 0, secure);
}

/** The contact the preview cookie names, verified to belong to `eventId` —
 * or null. Authorization is NOT checked here: callers must verify the session
 * user may preview this event (admin role + org membership). */
export async function previewContactForEvent(
	db: Db,
	request: Request,
	eventId: string,
): Promise<typeof contacts.$inferSelect | null> {
	const contactId = readPreviewContactId(request);
	if (!contactId) return null;
	const [contact] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.id, contactId), eq(contacts.eventId, eventId)))
		.limit(1);
	return contact ?? null;
}

/** The contact id the preview cookie names, or null. Authorization is NOT
 * checked here — callers must verify the session user may preview it. */
export function readPreviewContactId(request: Request): string | null {
	const value = readCookie(request, COOKIE);
	return value ? decodeURIComponent(value) : null;
}
