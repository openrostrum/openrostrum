import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "../app/ui/field";

const sources = import.meta.glob("../app/**/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

describe("Field semantics", () => {
	it("uses a native label for a single form control", () => {
		const html = renderToString(
			createElement(Field, {
				label: "Title",
				children: createElement("input"),
			}),
		);
		expect(html).toMatch(/^<label\b/);
	});

	it("does not label-wrap composite controls with toolbar buttons", () => {
		const html = renderToString(
			createElement(Field, {
				label: "Biography",
				composite: true,
				children: createElement(
					"section",
					null,
					createElement("div", { contentEditable: true }),
					createElement("button", { type: "button" }, "Bold"),
				),
			}),
		);
		expect(html).toMatch(/^<div\b/);
		expect(html).not.toMatch(/^<label\b/);
	});

	it("hangs an aside off the error row, so a counter needs no second copy", () => {
		// The rich-text editor wants a character count beside the error. Without
		// a slot for it, the only way to get one was to re-type the whole recipe.
		const html = renderToString(
			createElement(Field, {
				label: "Biography",
				composite: true,
				error: "Too long",
				aside: "1,200/1,000",
				children: createElement("div"),
			}),
		);
		expect(html).toContain(
			'<div class="flex items-baseline"><span class="text-[11.5px] text-danger">Too long</span><span class="ml-auto">1,200/1,000</span></div>',
		);
	});

	it("is the only place the field recipe is written", () => {
		const copies = Object.entries(sources)
			.filter(([path]) => !path.endsWith("/ui/field.tsx"))
			.filter(([, source]) =>
				source.includes("flex flex-col gap-[5px] text-[12.5px]"),
			)
			.map(([path]) => path.replace("../", ""));
		expect(copies).toEqual([]);
	});
});
