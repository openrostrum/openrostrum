import type { FORM_STATUS } from "~/db/schema";

/**
 * Whether a form accepts NEW submissions: stored status must be open AND the
 * close date (if any) still in the future — a past close date closes an
 * "open" form at that instant. Distinct from the portal's edit-until-close
 * lock, which deliberately checks closeAt alone (an already-submitted
 * proposal stays editable regardless of the form's status field).
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
 * The public CFP entry URL — one shape for every surface that links or
 * emails a form (`/submit/<event-slug>/<form-public-id>`), so the published
 * URL contract can only move in one place.
 */
export function submitUrl(
	origin: string,
	eventSlug: string,
	formPublicId: string,
): string {
	return `${origin}/submit/${eventSlug}/${formPublicId}`;
}
