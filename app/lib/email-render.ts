/**
 * Merge-field rendering for organizer-composed emails. Tags follow the
 * contact-scoped campaign vocabulary ({{first_name}}, {{portal_link}}, …).
 * Known tags always resolve (missing data → empty string, never a leaked
 * token); unknown tags are left verbatim so a typo is visible in the
 * per-recipient preview instead of vanishing silently.
 */
export const MERGE_TAGS = [
	"first_name",
	"last_name",
	"full_name",
	"email",
	"job_title",
	"company_name",
	"event_name",
	"portal_link",
] as const;

export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Partial<Record<MergeTag, string | null>>;

const TAG_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderMergeFields(
	template: string,
	values: MergeValues,
): string {
	return template.replace(TAG_PATTERN, (whole, tag: string) =>
		(MERGE_TAGS as readonly string[]).includes(tag)
			? (values[tag as MergeTag] ?? "")
			: whole,
	);
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
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
