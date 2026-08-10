import { describe, expect, it } from "vitest";
import { renderBody, renderSubject } from "../app/lib/email-render";

// Oracle: the renderer's delivery contract — recipient values resolve, zero
// unresolved {{...}} tokens ever reach a delivered email, and merge values
// are data, never markup.
describe("merge-tag renderer", () => {
	const ctx = {
		first_name: "Priya",
		session_title: "Scaling Vector Search at the Edge",
		portal_link: "https://example.com/portals/ev/p1?a=1&b=2",
	};

	it("resolves known tags in subject and body", () => {
		expect(renderSubject("Hi {{first_name}}!", ctx)).toBe("Hi Priya!");
		expect(renderBody("<p>{{session_title}} is accepted</p>", ctx)).toBe(
			"<p>Scaling Vector Search at the Edge is accepted</p>",
		);
	});

	it("tolerates whitespace and case inside the braces", () => {
		expect(renderSubject("Hi {{ First_Name }}!", ctx)).toBe("Hi Priya!");
	});

	it("never leaks a literal token — missing and unknown tags render empty", () => {
		const out = renderBody(
			"<p>{{first_name}}{{session_room}}{{no_such_tag}}</p>",
			ctx,
		);
		expect(out).toBe("<p>Priya</p>");
		expect(out).not.toContain("{{");
	});

	it("HTML-escapes body values so speaker-supplied data can't inject markup", () => {
		const hostile = { first_name: '<script>alert(1)</script>&"' };
		expect(renderBody("<p>{{first_name}}</p>", hostile)).toBe(
			"<p>&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;</p>",
		);
	});

	it("keeps escaped URLs valid inside an href", () => {
		expect(renderBody('<a href="{{portal_link}}">Portal</a>', ctx)).toBe(
			'<a href="https://example.com/portals/ev/p1?a=1&amp;b=2">Portal</a>',
		);
	});

	it("does not escape subjects (they are plain text, not HTML)", () => {
		expect(renderSubject("{{first_name}} & co", ctx)).toBe("Priya & co");
	});
});
