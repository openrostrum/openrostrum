import type { FORM_STATUS } from "~/db/schema";

/**
 * Whether a form accepts NEW submissions: stored status open AND the close date
 * (if any) still in the future — a past close date closes an "open" form at
 * that instant. NOT the portal's edit-until-close lock, which checks closeAt
 * alone: an already-submitted proposal stays editable whatever the status says.
 */
export function formIsOpen(
	form: { status: (typeof FORM_STATUS)[number]; closeAt: Date | null },
	now: Date,
): boolean {
	return (
		form.status === "open" &&
		(form.closeAt === null || form.closeAt.getTime() > now.getTime())
	);
}

/**
 * The public CFP entry path — one shape for every surface that links,
 * redirects, or emails a form (`/submit/<event-slug>/<form-public-id>`), so
 * the published URL contract can only move in one place. Callers needing an
 * absolute URL prefix their origin.
 */
export function submitPath(eventSlug: string, formPublicId: string): string {
	return `/submit/${eventSlug}/${formPublicId}`;
}

export function adminFormPath(formId: string): string {
	return `/admin/forms/${formId}`;
}

/**
 * Speaker-facing form title. An organizer-authored external title is kept
 * verbatim; an empty one falls back to this event's name, never the
 * admin-only internal name and never another event.
 */
export function defaultExternalTitle(eventName: string): string {
	return `${eventName} — Call for Speakers`;
}

export function publicFormTitle(
	form: { externalTitle: string },
	event: { name: string },
): string {
	const authored = form.externalTitle.trim();
	return authored || defaultExternalTitle(event.name);
}
