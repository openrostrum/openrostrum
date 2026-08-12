import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeMenuForm } from "../app/components/theme-toggle";

describe("theme menu submission", () => {
	it("renders a form root with three mounted submit options", () => {
		const html = renderToStaticMarkup(
			ThemeMenuForm({
				Form: "form",
				busy: false,
				theme: "system",
				onSubmit: () => {},
			}),
		);

		expect(html.startsWith("<form ")).toBe(true);
		expect(html).toContain('method="post"');
		expect(html).toContain('action="/theme"');
		expect(html.match(/type="submit"/g)).toHaveLength(3);
		expect(html.match(/name="theme"/g)).toHaveLength(3);
		expect(html).toContain('value="system"');
		expect(html).toContain('value="light"');
		expect(html).toContain('value="dark"');
		expect(html).not.toContain('type="button"');
	});
});
