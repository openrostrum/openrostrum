import { describe, expect, it } from "vitest";
import { renderEmailHtml, renderMergeFields } from "../app/lib/email-render";

describe("renderMergeFields", () => {
	it("resolves known tags per recipient and blanks missing values", () => {
		const out = renderMergeFields(
			"Hi {{first_name}} {{ last_name }} of {{company_name}}!",
			{ first_name: "Priya", last_name: "Raman", company_name: null },
		);
		// No unresolved known token may leak to a recipient.
		expect(out).toBe("Hi Priya Raman of !");
	});

	it("leaves unknown tags verbatim so typos surface in the preview", () => {
		expect(renderMergeFields("Hello {{frist_name}}", { first_name: "P" })).toBe(
			"Hello {{frist_name}}",
		);
	});
});

describe("renderEmailHtml", () => {
	it("escapes recipient data so it can never inject markup", () => {
		const html = renderEmailHtml("Hi {{first_name}}", {
			first_name: '<script>alert("x")</script>',
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("maps blank-line blocks to paragraphs and single newlines to <br>", () => {
		expect(renderEmailHtml("a\nb\n\nc", {})).toBe("<p>a<br>b</p><p>c</p>");
	});
});
