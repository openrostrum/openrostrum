/**
 * Server-side rich-text sanitizer. Speaker-authored HTML (bio, descriptions)
 * renders in ADMIN browsers too — an unsanitized <script> in a bio is a
 * stored-XSS path to an organizer session, so every speaker-written HTML field
 * passes through here at WRITE time. Built on workerd's native HTMLRewriter
 * (streaming parser), not regex.
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

/** Tags whose CONTENT must die with them (executable/embedding vectors). */
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
				el.setAttribute("rel", "noopener noreferrer");
				el.setAttribute("target", "_blank");
			}
		},
		comments(c) {
			c.remove();
		},
	});
	const res = rewriter.transform(
		new Response(html, { headers: { "content-type": "text/html" } }),
	);
	return (await res.text()).trim();
}
