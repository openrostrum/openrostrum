import type { BadgeTone } from "~/ui";

/**
 * Form-domain contracts shared across lanes: the admin builder WRITES form
 * definitions, the public CFP renderer READS them — both must agree on when a
 * form accepts submissions, how event-timezone close instants are computed,
 * and what rich-text HTML is trusted.
 */

export type FormStatus = "draft" | "open" | "closed";

/** A form can be off (draft/closed) or auto-closed by its close date — one
 * effective state answers "why is my link dead?" everywhere it's shown. */
export function effectiveFormStatus(
	status: FormStatus,
	closeAt: Date | null,
	now: number,
): FormStatus {
	if (status !== "open") return status;
	if (closeAt && closeAt.getTime() <= now) return "closed";
	return "open";
}

export const FORM_STATUS_TONE: Record<FormStatus, BadgeTone> = {
	open: "success",
	closed: "neutral",
	draft: "faint",
};

/* ------------------------------------------------------------- timezones --- */

function tzOffsetMs(ts: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const p = Object.fromEntries(
		dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]),
	);
	return (
		Date.UTC(
			Number(p.year),
			Number(p.month) - 1,
			Number(p.day),
			Number(p.hour) % 24,
			Number(p.minute),
			Number(p.second),
		) - ts
	);
}

/** Interpret a wall-clock entry ("2027-04-30" + "23:59") in the EVENT's
 * timezone — close dates must not shift with the viewer's browser TZ. */
export function zonedTimeToUtc(
	date: string,
	time: string,
	timeZone: string,
): Date {
	const [y, m, d] = date.split("-").map(Number);
	const [hh, mm] = time.split(":").map(Number);
	const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
	// Two-pass: the offset at the guess can differ across a DST boundary.
	const offset = tzOffsetMs(guess - tzOffsetMs(guess, timeZone), timeZone);
	return new Date(guess - offset);
}

/** The inverse — render a stored instant as date/time input values in the
 * event's timezone. */
export function utcToZonedInputs(
	at: Date,
	timeZone: string,
): { date: string; time: string } {
	const dtf = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
	const p = Object.fromEntries(
		dtf.formatToParts(at).map((x) => [x.type, x.value]),
	);
	const hour = String(Number(p.hour) % 24).padStart(2, "0");
	return {
		date: `${p.year}-${p.month}-${p.day}`,
		time: `${hour}:${p.minute}`,
	};
}

/* ------------------------------------------------------------- rich text --- */

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
