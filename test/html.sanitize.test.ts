import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeHtml, stripHtml } from "../app/lib/html";

/**
 * The one sanitizer guards every speaker-authored HTML field — public CFP
 * POSTs, portal profiles, admin contact bios — all of which render back into
 * an ORGANIZER's browser. These cases are the policy itself; if one of them
 * has to change, the stored-XSS surface changed with it.
 */
describe("sanitizeHtml", () => {
	it("keeps the formatting an author can actually type", async () => {
		const clean = await sanitizeHtml(
			"<h1>Title</h1><h2>Sub</h2><p>Hello <strong>bold</strong> and <em>italic</em></p><ul><li>one</li></ul><blockquote>quote</blockquote><pre><code>x</code></pre>",
		);
		for (const tag of [
			"h1",
			"h2",
			"p",
			"strong",
			"em",
			"ul",
			"li",
			"blockquote",
			"pre",
			"code",
		]) {
			expect(clean).toContain(`<${tag}>`);
		}
	});

	it("unwraps an unknown tag but keeps the words inside it", async () => {
		const clean = await sanitizeHtml("<section><p>kept</p></section>");
		expect(clean).toBe("<p>kept</p>");
	});

	it("strips every attribute, including event handlers", async () => {
		const clean = await sanitizeHtml(
			'<p onclick="steal()" class="x" style="color:red" data-x="1">hi</p>',
		);
		expect(clean).toBe("<p>hi</p>");
	});

	// Each of these can execute or exfiltrate on its own, so the CONTENT dies
	// with the tag — unwrapping would re-emit the payload as live markup.
	it("drops every executable and raw-text tag WITH its content", async () => {
		const payloads = [
			"<script>alert(1)</script>",
			"<style>body{background:url(//evil)}</style>",
			'<iframe src="//evil"></iframe>',
			'<object data="//evil"></object>',
			'<embed src="//evil">',
			'<form action="//evil"><input name="a"></form>',
			'<link rel="stylesheet" href="//evil">',
			'<meta http-equiv="refresh" content="0;//evil">',
			"<svg><script>alert(1)</script></svg>",
			"<math><mtext><script>alert(1)</script></mtext></math>",
			"<template><img src=x onerror=alert(1)></template>",
			// Raw-text elements: the parser hands their contents back as TEXT, so
			// unwrapping the tag re-emits the payload as live markup.
			"<noscript><img src=x onerror=alert(1)></noscript>",
			"<textarea><img src=x onerror=alert(1)></textarea>",
			"<title><img src=x onerror=alert(1)></title>",
			"<xmp><img src=x onerror=alert(1)></xmp>",
			"<noembed><img src=x onerror=alert(1)></noembed>",
			"<noframes><img src=x onerror=alert(1)></noframes>",
		];
		for (const payload of payloads) {
			const clean = await sanitizeHtml(`<p>before</p>${payload}<p>after</p>`);
			expect(clean, payload).toBe("<p>before</p><p>after</p>");
		}
	});

	// <plaintext> has no closing tag — it swallows the rest of the document —
	// so it gets its own case rather than the before/after shape above.
	it("drops <plaintext> and everything it swallowed", async () => {
		const clean = await sanitizeHtml(
			"<p>before</p><plaintext><img src=x onerror=alert(1)>",
		);
		expect(clean).toBe("<p>before</p>");
	});

	it("keeps an http(s) link and hardens it", async () => {
		const clean = await sanitizeHtml('<a href="https://ok.example">ok</a>');
		expect(clean).toContain('href="https://ok.example"');
		expect(clean).toContain('rel="noopener noreferrer nofollow"');
		expect(clean).toContain('target="_blank"');
	});

	it("keeps the link text but drops any non-http(s) href", async () => {
		const hrefs = [
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
			// Leading whitespace: browsers trim it before resolving the scheme.
			" javascript:alert(1)",
		];
		for (const href of hrefs) {
			const clean = await sanitizeHtml(`<a href="${href}">x</a>`);
			expect(clean, href).not.toContain("href");
			expect(clean, href).toContain(">x</a>");
		}
	});

	it("removes comments, which can smuggle markup past a naive reader", async () => {
		const clean = await sanitizeHtml(
			"<p>a</p><!-- <script>alert(1)</script> -->",
		);
		expect(clean).toBe("<p>a</p>");
	});

	it("returns empty for blank input", async () => {
		expect(await sanitizeHtml("")).toBe("");
		expect(await sanitizeHtml("   \n  ")).toBe("");
	});
});

describe("stripHtml", () => {
	it("turns block boundaries into line breaks and drops the tags", async () => {
		expect(stripHtml("<p>one</p><p>two</p><ul><li>a</li><li>b</li></ul>")).toBe(
			"one\ntwo\na\nb",
		);
	});

	it("decodes an entity once, never twice", () => {
		// An author who typed a literal "&lt;b&gt;" stored "&amp;lt;b&amp;gt;".
		// Decoding &amp; before &lt; hands the sink back real markup.
		expect(stripHtml("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
	});

	it("decodes the entities a rich-text editor actually emits", () => {
		expect(
			stripHtml(
				"<p>a&nbsp;&amp;&nbsp;b &quot;q&quot; &#39;s&#39; &apos;t&apos;</p>",
			),
		).toBe(`a & b "q" 's' 't'`);
	});
});

describe("escapeHtml", () => {
	it("neutralizes every character that can break out of markup", () => {
		expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
			"&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
		);
	});
});
