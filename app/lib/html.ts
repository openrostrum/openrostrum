/**
 * Minimal HTML helpers for surfaces that must never render user-authored
 * markup (reviewer projections, system emails). Not a sanitizer — we strip to
 * plain text instead of allow-listing tags, so stored rich text can never
 * execute in a reviewer's browser.
 */

/** Rich-text HTML → plain text (tags removed, common entities decoded). */
export function stripHtml(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Escape for a TEXT-NODE position only (never attributes). Quotes stay as-is
 * so quoted feedback lands verbatim in the email body.
 */
export function escapeHtmlText(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
