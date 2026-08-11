import { describe, expect, it } from "vitest";
import {
	type MergeContext,
	renderBody,
	renderEmailHtml,
	renderMergeFields,
	renderSubject,
	templateUsesTag,
} from "../app/lib/email-render";

// Oracle: the renderer's delivery contract — recipient values resolve, zero
// unresolved {{...}} tokens ever reach a delivered email, and merge values
// are data, never markup.
describe("merge-tag renderer", () => {
	// MergeContext is a FULL record by design (every send/preview site must
	// carry every tag); null is the renderer-visible "no value" state.
	const empty: MergeContext = {
		first_name: null,
		last_name: null,
		full_name: null,
		email: null,
		event_name: null,
		session_title: null,
		session_date_time: null,
		starts_at: null,
		ends_at: null,
		session_room: null,
		location: null,
		portal_link: null,
		form_title: null,
		form_close_date: null,
	};
	const ctx: MergeContext = {
		...empty,
		first_name: "Priya",
		session_title: "Scaling Vector Search at the Edge",
		portal_link: "https://example.com/portals/ev/p1?a=1&b=2",
	};
	const classicCtx = {
		...ctx,
		last_name: "Patel",
		event_name: "EdgeConf",
		starts_at: "Oct 13, 2026, 10:00 AM",
		ends_at: "Oct 13, 2026, 10:30 AM",
		location: "Room A",
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
		const hostile = { ...empty, first_name: '<script>alert(1)</script>&"' };
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

	it("renders the complete verified classic token set with whitespace and case tolerance", () => {
		expect(
			renderSubject(
				[
					"{{{ Recipient.First_Name }}}",
					"{{{recipient.last_name}}}",
					"{{{ title }}}",
					"{{{ EVENT.NAME }}}",
					"{{{starts_at}}}",
					"{{{ ends_at }}}",
					"{{{location}}}",
				].join(" | "),
				classicCtx,
			),
		).toBe(
			"Priya | Patel | Scaling Vector Search at the Edge | EdgeConf | Oct 13, 2026, 10:00 AM | Oct 13, 2026, 10:30 AM | Room A",
		);
	});

	it("HTML-escapes classic dotted recipient values without leaving stray braces", () => {
		const hostile = {
			...classicCtx,
			first_name: '<Priya & "team">',
		};
		expect(renderBody("<p>{{{recipient.first_name}}}</p>", hostile)).toBe(
			"<p>&lt;Priya &amp; &quot;team&quot;&gt;</p>",
		);
	});

	it("blanks missing classic values instead of leaking tokens", () => {
		const missing = {
			...classicCtx,
			first_name: null,
			last_name: null,
			session_title: null,
			event_name: null,
			starts_at: null,
			ends_at: null,
			location: null,
		};
		const output = renderBody(
			"<p>{{{recipient.first_name}}}|{{{recipient.last_name}}}|{{{title}}}|{{{event.name}}}|{{{starts_at}}}|{{{ends_at}}}|{{{location}}}</p>",
			missing,
		);
		expect(output).toBe("<p>||||||</p>");
		expect(output).not.toContain("{");
	});

	it("keeps every double-brace alias backward-compatible with classic tokens", () => {
		expect(
			renderSubject(
				"{{first_name}}|{{last_name}}|{{session_title}}|{{event_name}}|{{starts_at}}|{{ends_at}}|{{location}}",
				classicCtx,
			),
		).toBe(
			"Priya|Patel|Scaling Vector Search at the Edge|EdgeConf|Oct 13, 2026, 10:00 AM|Oct 13, 2026, 10:30 AM|Room A",
		);
	});
});

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

	it("uses template-parser grammar and aliases for case, whitespace, triple braces, and dotted paths", () => {
		const values = {
			first_name: "Priya",
			last_name: "Patel",
			event_name: "EdgeConf",
		};
		expect(
			renderMergeFields(
				"{{{ Recipient.First_Name }}} | {{ recipient.last_name }} | {{{ EVENT.NAME }}} | {{ unknown.path }}",
				values,
			),
		).toBe("Priya | Patel | EdgeConf | {{ unknown.path }}");
		expect(templateUsesTag("{{{ Recipient.First_Name }}}", "first_name")).toBe(
			true,
		);
		expect(templateUsesTag("{{ EVENT.NAME }}", "event_name")).toBe(true);
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

	it("escapes recipient data through classic triple-brace dotted aliases", () => {
		expect(
			renderEmailHtml("Hi {{{ recipient.first_name }}}", {
				first_name: '<script>alert("x")</script>',
			}),
		).toBe("<p>Hi &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
	});

	it("maps blank-line blocks to paragraphs and single newlines to <br>", () => {
		expect(renderEmailHtml("a\nb\n\nc", {})).toBe("<p>a<br>b</p><p>c</p>");
	});
});
