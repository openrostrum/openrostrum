import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "../app/ui/field";

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
});
