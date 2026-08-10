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
import { userCanAccessEvent } from "~/lib/auth";
import { readCookie, serializeCookie } from "~/lib/cookies";

const COOKIE = "__portal_preview";
const PREVIEW_TTL_SECONDS = 60 * 60 * 2;

/** `Set-Cookie` value that starts previewing the given contact. */
export function startPreviewCookie(contactId: string, secure: boolean): string {
	return serializeCookie(
		COOKIE,
		encodeURIComponent(contactId),
		PREVIEW_TTL_SECONDS,
		secure,
	);
}

/** `Set-Cookie` value that ends the preview. */
export function clearPreviewCookie(secure: boolean): string {
	return serializeCookie(COOKIE, "", 0, secure);
}

/** One home for the previewed speaker's display name. */
export function contactDisplayName(contact: {
	firstName: string;
	lastName: string;
}): string {
	return `${contact.firstName} ${contact.lastName}`.trim();
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

function readPreviewContactId(request: Request): string | null {
	const value = readCookie(request, COOKIE);
	return value ? decodeURIComponent(value) : null;
}

/**
 * The previewed contact for the ADMIN surface, resolved across any event the
 * admin can access — event-unscoped on purpose: after an event switch the
 * preview cookie is still live (portal-side), and the admin page must keep
 * showing the state and the exit affordance rather than silently hiding them.
 */
export async function previewContactForAdmin(
	env: Env,
	db: Db,
	request: Request,
	userId: string,
): Promise<typeof contacts.$inferSelect | null> {
	const contactId = readPreviewContactId(request);
	if (!contactId) return null;
	const [contact] = await db
		.select()
		.from(contacts)
		.where(eq(contacts.id, contactId))
		.limit(1);
	if (!contact) return null;
	return (await userCanAccessEvent(env, userId, contact.eventId))
		? contact
		: null;
}
