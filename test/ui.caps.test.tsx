import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Caps } from "../app/ui/caps";

const sources = {
	...(import.meta.glob("../app/**/*.tsx", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>),
	...(import.meta.glob("../app/**/*.ts", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>),
};

/**
 * Every double-quoted string literal in a source file. Deliberately not just
 * `className="…"`: the recipe also hid behind an exported `LABEL_CLASS`
 * constant, and a scan that only looked at attributes would have missed it.
 */
function stringLiterals(source: string): string[] {
	return [...source.matchAll(/"([^"\n]*)"/g)].flatMap((m) =>
		m[1] === undefined ? [] : [m[1]],
	);
}

describe("Caps", () => {
	it("is the 11px caps voice the design system specifies", () => {
		const html = renderToString(createElement(Caps, { children: "Sessions" }));
		expect(html).toBe(
			'<span class="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Sessions</span>',
		);
	});

	it("carries no layout of its own — the caller owns the box", () => {
		// A primitive that also set padding or line-height would force call sites
		// that need a different box to hand-roll the voice again, which is how
		// this recipe drifted to three tracking values in the first place.
		const html = renderToString(
			createElement(Caps, { as: "h3", tone: "faint", children: "Rooms" }),
		);
		expect(html).toBe(
			'<h3 class="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">Rooms</h3>',
		);
	});

	it("is the only place the recipe is written", () => {
		const handRolled = Object.entries(sources)
			.filter(([path]) => !path.endsWith("/ui/caps.tsx"))
			.filter(([, source]) =>
				stringLiterals(source).some(
					(cls) =>
						cls.includes("text-[11px]") &&
						cls.includes("font-semibold") &&
						cls.includes("uppercase"),
				),
			)
			.map(([path]) => path.replace("../", ""));
		expect(handRolled).toEqual([]);
	});
});
