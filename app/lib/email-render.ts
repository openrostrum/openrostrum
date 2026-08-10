/**
 * Merge-tag renderer for email templates. Pure and isomorphic (no server
 * imports) so the template editor can preview client-side with the exact
 * function send sites use server-side.
 *
 * Syntax: {{tag_name}} (case-insensitive, optional inner whitespace).
 * Policy: EVERY {{...}} token is consumed — a tag with no value renders as
 * empty string, never as a leaked literal token in a delivered email.
 */

export const MERGE_TAGS = [
	{ tag: "first_name", label: "Recipient's first name" },
	{ tag: "last_name", label: "Recipient's last name" },
	{ tag: "full_name", label: "Recipient's full name" },
	{ tag: "email", label: "Recipient's email address" },
	{ tag: "event_name", label: "Event name" },
	{ tag: "session_title", label: "Session / submission title" },
	{ tag: "session_date_time", label: "Scheduled session date & time" },
	{ tag: "session_room", label: "Scheduled session room" },
	{ tag: "portal_link", label: "Speaker portal URL" },
	{ tag: "form_title", label: "Submission form title" },
	{ tag: "form_close_date", label: "Submission form close date" },
] as const;

export type MergeTag = (typeof MERGE_TAGS)[number]["tag"];

/** Keyed on the published tag union so a typo'd key at a send site is a
 * compile error instead of silently-deleted content in a delivered email. */
export type MergeContext = Partial<Record<MergeTag, string | null>>;

const TAG_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function substitute(
	template: string,
	ctx: MergeContext,
	transform: (value: string) => string,
): string {
	const values = ctx as Partial<Record<string, string | null>>;
	return template.replace(TAG_RE, (_match, tag: string) => {
		const value = values[tag.toLowerCase()];
		return value ? transform(value) : "";
	});
}

/** Plain-text substitution — subjects are never HTML. */
export function renderSubject(template: string, ctx: MergeContext): string {
	return substitute(template, ctx, (v) => v);
}

/** HTML substitution — merge values are DATA (speaker-supplied names, titles),
 * so they are escaped; markup belongs to the template, never to a value. */
export function renderBody(template: string, ctx: MergeContext): string {
	return substitute(template, ctx, escapeHtml);
}
