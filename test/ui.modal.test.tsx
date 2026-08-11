import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "../app/ui/modal";

describe("Modal", () => {
	it("renders an accessible in-app dialog with actions", () => {
		const html = renderToString(
			createElement(Modal, {
				open: true,
				title: "Review emails",
				subtitle: "Nothing sends before confirmation.",
				onClose: () => undefined,
				actions: createElement("button", { type: "button" }, "Confirm"),
				children: createElement("p", null, "Preview body"),
			}),
		);
		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain("Review emails");
		expect(html).toContain("Nothing sends before confirmation.");
		expect(html).toContain("Confirm");
	});

	it("renders nothing while closed", () => {
		const html = renderToString(
			createElement(Modal, {
				open: false,
				title: "Hidden",
				onClose: () => undefined,
				children: createElement("p", null, "Body"),
			}),
		);
		expect(html).toBe("");
	});
});
