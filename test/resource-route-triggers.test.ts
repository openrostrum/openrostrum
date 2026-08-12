import { describe, expect, it } from "vitest";

/**
 * A resource route (loader, no component) answers with bytes, so reaching one
 * through the client router paints an empty page and downloads nothing;
 * `reloadDocument` hands the click to the browser. Checked over the whole route
 * tree because the failure is invisible in review.
 */

const sources = import.meta.glob<string>("../app/routes/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
});

/** Flat-route filename → URL path. `[.zip]` escapes a literal dot; a trailing
 * `_` opts a segment out of layout nesting without changing the URL. */
function urlFor(file: string): string {
	const name = file.replace("../app/routes/", "").replace(/\.tsx$/, "");
	const segments: string[] = [];
	let current = "";
	let escaped = false;
	for (const char of name) {
		if (char === "[") escaped = true;
		else if (char === "]") escaped = false;
		else if (char === "." && !escaped) {
			segments.push(current);
			current = "";
		} else current += char;
	}
	segments.push(current);
	const path = segments
		.map((s) => s.replace(/_$/, ""))
		.filter((s) => s !== "_index" && s !== "")
		.join("/");
	return `/${path}`;
}

const byteRoutes = new Set(
	Object.entries(sources)
		.filter(([, source]) => !/^export default/m.test(source))
		.map(([file]) => urlFor(file)),
);

/**
 * Every `<Link>` or GET `<Form>` opening tag with the destination it points at.
 * A POST is exempt: it submits and follows the redirect its action returns, so
 * it never asks the router to render the target.
 */
function navigations(source: string): Array<{ tag: string; target: string }> {
	const found: Array<{ tag: string; target: string }> = [];
	for (const match of source.matchAll(/<(?:Form|Link)\b[^>]*>/g)) {
		const tag = match[0];
		if (/\bmethod=["']post["']/i.test(tag)) continue;
		const target = /\b(?:action|to)=["'](\/[^"']*)["']/.exec(tag);
		if (target?.[1]) found.push({ tag, target: target[1] });
	}
	return found;
}

describe("links into byte-serving routes", () => {
	it("knows which routes serve bytes rather than a page", () => {
		expect(byteRoutes.has("/admin/files/export.zip")).toBe(true);
		expect(byteRoutes.has("/admin/submissions/export.csv")).toBe(true);
		expect(byteRoutes.has("/admin/files")).toBe(false);
	});

	it("hands every one of them to the browser with reloadDocument", () => {
		const offenders = Object.entries(sources).flatMap(([file, source]) =>
			navigations(source)
				.filter(
					(t) => byteRoutes.has(t.target) && !t.tag.includes("reloadDocument"),
				)
				.map((t) => `${file.replace("../app/routes/", "")} → ${t.target}`),
		);
		expect(offenders).toEqual([]);
	});
});
