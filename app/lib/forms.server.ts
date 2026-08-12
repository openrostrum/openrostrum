import { asc, eq } from "drizzle-orm";
import type { Db } from "~/db";
import { formats, languages, levels, tags, tracks } from "~/db/schema";

/**
 * Server-only halves of the form-domain contract (`./forms` holds the pure
 * parts): D1 reads and the HTMLRewriter sanitizer — neither may reach the
 * client bundle.
 */

export type RuleOptionMap = Record<
	string,
	Array<{ value: string; label: string }>
>;

/**
 * Rule `value` stores exactly what the public form control submits for the
 * trigger: taxonomy row IDS for Format/Tags/Track/Level, the language NAME for
 * Language (submissions.language is a name column). The builder's pickers, its
 * set-rule validation, and the public renderer must all read THIS map.
 */
export async function loadRuleOptions(
	db: Db,
	eventId: string,
): Promise<RuleOptionMap> {
	const [formatRows, trackRows, tagRows, levelRows, languageRows] =
		await Promise.all([
			db
				.select({ id: formats.id, name: formats.name })
				.from(formats)
				.where(eq(formats.eventId, eventId))
				.orderBy(asc(formats.position)),
			db
				.select({ id: tracks.id, name: tracks.name })
				.from(tracks)
				.where(eq(tracks.eventId, eventId))
				.orderBy(asc(tracks.name)),
			db
				.select({ id: tags.id, name: tags.name })
				.from(tags)
				.where(eq(tags.eventId, eventId))
				.orderBy(asc(tags.name)),
			db
				.select({ id: levels.id, name: levels.name })
				.from(levels)
				.where(eq(levels.eventId, eventId))
				.orderBy(asc(levels.position)),
			db
				.select({ id: languages.id, name: languages.name })
				.from(languages)
				.where(eq(languages.eventId, eventId))
				.orderBy(asc(languages.position)),
		]);
	return {
		format: formatRows.map((r) => ({ value: r.id, label: r.name })),
		tags: tagRows.map((r) => ({ value: r.id, label: r.name })),
		track: trackRows.map((r) => ({ value: r.id, label: r.name })),
		level: levelRows.map((r) => ({ value: r.id, label: r.name })),
		language: languageRows.map((r) => ({ value: r.name, label: r.name })),
	};
}

// What the shared editor produces; everything else is attack surface — the
// public CFP pages render this HTML to anonymous visitors.
const ALLOWED_TAGS = new Set([
	"p",
	"strong",
	"em",
	"u",
	"s",
	"a",
	"ul",
	"ol",
	"li",
	"br",
	"h2",
	"h3",
	"blockquote",
	"code",
]);

// Removed WITH their contents — keeping a script's source as visible text
// would be safe but garbage.
const DROPPED_TAGS = new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"link",
	"meta",
	"base",
	"form",
]);

/**
 * Allowlist sanitizer for stored rich text, enforced at the WRITE boundary so
 * a forged POST can't smuggle markup past the editor. Built on the runtime's
 * HTMLRewriter — the dependency set is frozen, so no DOMPurify.
 */
export async function sanitizeRichText(html: string): Promise<string> {
	if (!html) return "";
	const rewriter = new HTMLRewriter().on("*", {
		element(el) {
			const tag = el.tagName.toLowerCase();
			if (DROPPED_TAGS.has(tag)) {
				el.remove();
				return;
			}
			if (!ALLOWED_TAGS.has(tag)) {
				el.removeAndKeepContent();
				return;
			}
			const href = tag === "a" ? el.getAttribute("href") : null;
			const names: string[] = [];
			// workerd yields [name, value] tuples; the TS lib may type the
			// iterator as DOM Attr — handle both shapes.
			for (const attr of el.attributes) {
				names.push(
					Array.isArray(attr)
						? String(attr[0])
						: (attr as unknown as { name: string }).name,
				);
			}
			for (const name of names) el.removeAttribute(name);
			if (href && /^(https?:\/\/|mailto:)/i.test(href.trim())) {
				el.setAttribute("href", href.trim());
				el.setAttribute("rel", "noopener noreferrer");
			}
		},
	});
	return await rewriter.transform(new Response(html)).text();
}
