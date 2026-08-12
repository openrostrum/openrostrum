/**
 * Merge-field rendering for ALL email surfaces — one module so previews and
 * sends share the exact same substitution. Pure and isomorphic (no server
 * imports) so editors can preview client-side with the exact functions send
 * sites use server-side.
 *
 * Two deliberate, DIFFERENT policies live here:
 *
 * - Template pipeline (lifecycle/custom templates — `renderSubject` /
 *   `renderBody`): EVERY {{...}} token is consumed — a tag with no value
 *   renders as empty string, never as a leaked literal token in a delivered
 *   email.
 *
 * - Compose pipeline (organizer-written campaign text — `renderMergeFields` /
 *   `renderEmailHtml`): known tags always resolve (missing data → empty
 *   string); UNKNOWN tags are left verbatim so a typo is visible in the
 *   per-recipient preview instead of vanishing silently.
 */

import { escapeHtml } from "~/lib/html";

export const MERGE_TAGS = [
	{ tag: "first_name", label: "Recipient's first name" },
	{ tag: "last_name", label: "Recipient's last name" },
	{ tag: "full_name", label: "Recipient's full name" },
	{ tag: "email", label: "Recipient's email address" },
	{ tag: "event_name", label: "Event name" },
	{ tag: "session_title", label: "Session / submission title" },
	{ tag: "session_date_time", label: "Scheduled session date & time" },
	{ tag: "starts_at", label: "Scheduled session start" },
	{ tag: "ends_at", label: "Scheduled session end" },
	{ tag: "session_room", label: "Scheduled session room" },
	{ tag: "location", label: "Session location" },
	{ tag: "portal_link", label: "Speaker portal URL" },
	{ tag: "form_title", label: "Submission form title" },
	{ tag: "form_close_date", label: "Submission form close date" },
] as const;

export type MergeTag = (typeof MERGE_TAGS)[number]["tag"];

/** FULL record on the published tag union: a typo'd key is a compile error,
 * and a tag added to MERGE_TAGS fails compilation at every template-pipeline
 * site — a partial context is how a tag renders resolved in the editor
 * preview and blank in the delivered email. `null` = "no value here" and
 * renders as empty string. */
export type MergeContext = Record<MergeTag, string | null>;

const CLASSIC_TAG_ALIASES: Readonly<Record<string, MergeTag>> = {
	"recipient.first_name": "first_name",
	"recipient.last_name": "last_name",
	title: "session_title",
	"event.name": "event_name",
};

const MERGE_TAG_PATTERN =
	/\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const TEMPLATE_MERGE_TAGS = MERGE_TAGS.map(
	({ tag }) => tag,
) as readonly string[];

function contextKey(
	tripleTag: string | undefined,
	doubleTag: string | undefined,
) {
	const normalized = (tripleTag ?? doubleTag ?? "").toLowerCase();
	return CLASSIC_TAG_ALIASES[normalized] ?? normalized;
}

function substitute(
	template: string,
	values: Partial<Record<string, string | null>>,
	knownTags: readonly string[],
	unknown: "blank" | "preserve",
	transform: (value: string) => string,
): string {
	return template.replace(
		MERGE_TAG_PATTERN,
		(whole, tripleTag: string | undefined, doubleTag: string | undefined) => {
			const tag = contextKey(tripleTag, doubleTag);
			if (!knownTags.includes(tag)) return unknown === "preserve" ? whole : "";
			const value = values[tag];
			return value == null ? "" : transform(value);
		},
	);
}

export function templateKindLabel(category: string | null): string {
	if (category === "lifecycle") return "Transactional";
	if (category === "custom") return "Announcement";
	return "—";
}

/** Plain-text substitution — subjects are never HTML. */
export function renderSubject(template: string, ctx: MergeContext): string {
	return substitute(template, ctx, TEMPLATE_MERGE_TAGS, "blank", (v) => v);
}

/** HTML substitution — merge values are DATA (speaker-supplied names, titles),
 * so they are escaped; markup belongs to the template, never to a value. */
export function renderBody(template: string, ctx: MergeContext): string {
	return substitute(template, ctx, TEMPLATE_MERGE_TAGS, "blank", escapeHtml);
}

// Organizer-composed bulk mail (admin.contacts_.compose) knows the recipient
// CONTACT, never a submission, so it publishes its own smaller tag list.

export const CAMPAIGN_MERGE_TAGS = [
	"first_name",
	"last_name",
	"full_name",
	"email",
	"job_title",
	"company_name",
	"event_name",
	"portal_link",
] as const;

export type CampaignMergeTag = (typeof CAMPAIGN_MERGE_TAGS)[number];
export type MergeValues = Partial<Record<CampaignMergeTag, string | null>>;

export function templateUsesTag(
	template: string,
	tag: CampaignMergeTag,
): boolean {
	return [...template.matchAll(MERGE_TAG_PATTERN)].some(
		(match) => contextKey(match[1], match[2]) === tag,
	);
}

export function renderMergeFields(
	template: string,
	values: MergeValues,
): string {
	return substitute(
		template,
		values,
		CAMPAIGN_MERGE_TAGS,
		"preserve",
		(value) => value,
	);
}

/**
 * Plain composed text → email HTML: substitute merge fields first, then
 * escape EVERYTHING (recipient data must never inject markup), then map
 * blank-line-separated blocks to paragraphs.
 */
export function renderEmailHtml(bodyText: string, values: MergeValues): string {
	const resolved = renderMergeFields(bodyText, values);
	const paragraphs = escapeHtml(resolved)
		.split(/\n{2,}/)
		.map((block) => `<p>${block.trim().replaceAll("\n", "<br>")}</p>`)
		.join("");
	return paragraphs || "<p></p>";
}
