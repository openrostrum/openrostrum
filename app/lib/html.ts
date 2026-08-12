/** Escape user-supplied text before interpolating it into HTML email bodies. */
export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
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

/**
 * Rich-text HTML → plain text, for surfaces that must never render user markup
 * (reviewer projections, public feeds, system emails). The output is arbitrary
 * TEXT that may contain angle brackets: markup safety lives at the sinks
 * (React, the feeds' escapeHtml, JSON.stringify), never here.
 */
export function stripHtml(html: string): string {
	return (
		html
			.replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
			.replace(/<[^>]*>/g, "")
			.replaceAll("&nbsp;", " ")
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&quot;", '"')
			.replaceAll("&#39;", "'")
			.replaceAll("&apos;", "'")
			// &amp; LAST — decoding it first turns a stored "&amp;lt;" into "<" and
			// hands the sink back the markup the author had escaped.
			.replaceAll("&amp;", "&")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/**
 * THE server-side rich-text sanitizer: CFP posts, portal profiles and admin
 * edits write the same columns, so one policy guards them all at WRITE time.
 * Speaker HTML renders in ADMIN browsers, so an unsanitized bio is stored XSS
 * against an organizer session. Built on workerd's HTMLRewriter, not regex.
 */

const KEEP_CONTENT = new Set([
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"ul",
	"ol",
	"li",
	"a",
	"h1",
	"h2",
	"h3",
	"blockquote",
	"code",
	"pre",
]);

/**
 * Tags whose CONTENT must die with them. Two reasons, both fatal:
 * executable/embedding vectors (script, iframe, …), and raw-text elements —
 * the parser hands their contents back as a text node, so unwrapping one
 * re-emits `<img src=x onerror=…>` as live markup instead of escaping it.
 */
const DROP_ENTIRELY = new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"form",
	"link",
	"meta",
	"svg",
	"math",
	"template",
	"noscript",
	"textarea",
	"title",
	"xmp",
	"noembed",
	"noframes",
	"plaintext",
]);

export async function sanitizeHtml(html: string): Promise<string> {
	if (!html.trim()) return "";
	const rewriter = new HTMLRewriter().on("*", {
		element(el) {
			const tag = el.tagName.toLowerCase();
			if (DROP_ENTIRELY.has(tag)) {
				el.remove();
				return;
			}
			if (!KEEP_CONTENT.has(tag)) {
				el.removeAndKeepContent();
				return;
			}
			// workerd yields [name, value] tuples at runtime while the type says
			// Attr objects — normalize both shapes so removal can't silently no-op.
			const attrs: Array<{ name: string; value: string }> = [];
			for (const attr of el.attributes as Iterable<unknown>) {
				if (Array.isArray(attr)) {
					attrs.push({ name: String(attr[0]), value: String(attr[1] ?? "") });
				} else {
					const a = attr as { name: string; value: string };
					attrs.push({ name: a.name, value: a.value });
				}
			}
			for (const { name, value } of attrs) {
				if (
					tag === "a" &&
					name === "href" &&
					/^https?:\/\//i.test(value.trim())
				)
					continue;
				el.removeAttribute(name);
			}
			if (tag === "a") {
				el.setAttribute("rel", "noopener noreferrer nofollow");
				el.setAttribute("target", "_blank");
			}
		},
	});
	// onDocument, not on("*"): a comment sitting between top-level elements is
	// nobody's child, so an element selector never sees it.
	rewriter.onDocument({
		comments(c) {
			c.remove();
		},
	});
	const res = rewriter.transform(
		new Response(html, { headers: { "content-type": "text/html" } }),
	);
	return (await res.text()).trim();
}
