// Unit tests for the pure inline-review logic (inline.mjs). Plain node:test —
// no network, no model, no GitHub. Run with:
//   node --test tooling/pr-review/inline.test.node.mjs
// (Named *.test.node.mjs so the app's vitest glob (*.test.mjs) never picks it
// up — vitest runs inside workerd, where node:test does not exist.)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	anchorFinding,
	buildFindingMarker,
	buildReviewPayload,
	concept,
	extractQuotes,
	fingerprint,
	findingCommentBody,
	mergeFile,
	parseDiff,
	parseFindingMarkers,
	reconcile,
	resolvedReplyBody,
	RESOLVED_MARKER,
} from "./inline.mjs";

// A two-hunk diff exercising adds, removals, context, and a blank context line.
const DIFF = [
	"diff --git a/app/x.ts b/app/x.ts",
	"index 1111111..2222222 100644",
	"--- a/app/x.ts",
	"+++ b/app/x.ts",
	"@@ -1,4 +1,5 @@",
	' import { a } from "./a";',
	'+import { b } from "./b";',
	" ",
	" export function x() {",
	"-	return a;",
	"+	return a + b;",
	" }",
	"@@ -10,3 +11,4 @@ function tail() {",
	" 	const y = 1;",
	"+	const z = 2;",
	" 	return y;",
	" }",
	"",
].join("\n");

// The pre-inline newSnippet, verbatim — the eval-validated model input format.
// parseDiff().code must stay byte-identical to it.
function legacyNewSnippet(diffText) {
	const out = [];
	for (const line of diffText.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("@@")) {
			out.push("");
			continue;
		}
		if (line.startsWith("+")) out.push(line.slice(1));
		else if (line.startsWith(" ")) out.push(line.slice(1));
	}
	return out.join("\n").trim();
}

test("parseDiff.newLines numbers added+context lines on the new side", () => {
	const lines = parseDiff(DIFF).newLines;
	assert.deepEqual(
		lines.map((l) => [l.line, l.added]),
		[
			[1, false],
			[2, true],
			[3, false],
			[4, false],
			[5, true],
			[6, false],
			[11, false],
			[12, true],
			[13, false],
			[14, false],
		],
	);
	assert.equal(lines[1].text, 'import { b } from "./b";');
	assert.equal(lines[7].text, "	const z = 2;");
	// Removed lines never appear.
	assert.ok(!lines.some((l) => l.text.includes("return a;")));
});

test("parseDiff.code is byte-identical to the legacy snippet", () => {
	assert.equal(parseDiff(DIFF).code, legacyNewSnippet(DIFF));
	// Degenerate inputs too.
	assert.equal(parseDiff("").code, legacyNewSnippet(""));
});

test("DISCLOSED divergence: added lines whose content starts with ++ are kept", () => {
	// Legacy ran startsWith("+++") on EVERY line, so an added line `++i;`
	// (raw "+++i;") was silently dropped from the model's view — a bug.
	// parseDiff gates the header skip on being outside a hunk and keeps it.
	const diff = [
		"--- a/a.js",
		"+++ b/a.js",
		"@@ -1,1 +1,2 @@",
		" let i = 0;",
		"+++i;",
		"",
	].join("\n");
	assert.equal(legacyNewSnippet(diff), "let i = 0;"); // the legacy bug
	assert.equal(parseDiff(diff).code, "let i = 0;\n++i;");
	assert.deepEqual(parseDiff(diff).newLines.at(-1), {
		line: 2,
		text: "++i;",
		added: true,
	});
});

test("parseDiff.map aligns snippet lines with new-file lines after the trim", () => {
	const { code, map } = parseDiff(DIFF);
	const snippetLines = code.split("\n");
	assert.equal(map.length, snippetLines.length);
	// Snippet line 1 is the first hunk's first context line → file line 1.
	assert.equal(map[0], 1);
	assert.equal(snippetLines[1], 'import { b } from "./b";');
	assert.equal(map[1], 2);
	// The hunk separator between hunks maps to nothing.
	const sep = snippetLines.indexOf("", 4);
	assert.equal(map[sep], null);
	// First line of hunk 2 → file line 11.
	assert.equal(snippetLines[sep + 1], "	const y = 1;");
	assert.equal(map[sep + 1], 11);
});

test("extractQuotes prefers location backticks, then the location tail, then why", () => {
	const q = extractQuotes({
		location: "app/x.ts:12 — `const z = 2` near the tail",
		why: "Uses `return a + b` where the doc forbids it.",
	});
	assert.deepEqual(q, ["const z = 2", "near the tail", "return a + b"]);
});

test("anchorFinding: backticked quote lands on its diff line (added preferred)", () => {
	const { map, newLines: lines } = parseDiff(DIFF);
	const line = anchorFinding(
		{ location: "app/x.ts — `return a + b`" },
		lines,
		map,
	);
	assert.equal(line, 5);
});

test("anchorFinding: elided quotes (…) match on fragments, added wins over context", () => {
	const { map, newLines: lines } = parseDiff(DIFF);
	// "const" appears on context line 11 and added line 12 — added wins.
	const line = anchorFinding({ location: "`const ... = 2;`" }, lines, map);
	assert.equal(line, 12);
});

test("anchorFinding: :N reads as a snippet line and maps through to the file line", () => {
	const { map, newLines: lines } = parseDiff(DIFF);
	assert.equal(anchorFinding({ location: "app/x.ts:2" }, lines, map), 2);
	// A :N pointing at the hunk separator scans forward to the next real line.
	const sepSnippetLine = parseDiff(DIFF).code.split("\n").indexOf("", 4) + 1;
	assert.equal(
		anchorFinding({ location: `app/x.ts:${sepSnippetLine}` }, lines, map),
		11,
	);
	// Past the snippet → no anchor.
	assert.equal(anchorFinding({ location: "app/x.ts:99" }, lines, map), null);
});

test("anchorFinding: nothing quotable, no :N → null (file-level fallback)", () => {
	const { map, newLines: lines } = parseDiff(DIFF);
	assert.equal(
		anchorFinding(
			{ location: "app/x.ts", why: "No opt-out comment anywhere." },
			lines,
			map,
		),
		null,
	);
});

test("fingerprint is stable across line shifts and wording order, distinct across files", () => {
	const a = concept({
		rule: "Auth — public routes must carry a @public opt-out",
		why: "Login is public but file has no @public comment (line 12).",
	});
	const b = concept({
		rule: "public routes must carry a @public opt-out — Auth",
		why: "file has no @public comment; login is public (line 97).",
	});
	assert.equal(fingerprint("app/routes/login.tsx", a).length, 16);
	// Same words, different order/lines → same fingerprint.
	assert.equal(
		fingerprint("app/routes/login.tsx", a),
		fingerprint("app/routes/login.tsx", b),
	);
	assert.notEqual(
		fingerprint("app/routes/login.tsx", a),
		fingerprint("app/routes/signup.tsx", a),
	);
});

test("finding markers round-trip through a comment body", () => {
	const c = concept({ rule: "Turnstile on /signup", why: "No widget." });
	const fp = fingerprint("app/routes/signup.tsx", c);
	const body = findingCommentBody({
		fp,
		file: "app/routes/signup.tsx",
		concept: c,
		agents: new Set(["harness"]),
		rule: "Turnstile on /signup",
		why: "No widget.",
		location: "app/routes/signup.tsx:<Form>",
	});
	const parsed = parseFindingMarkers(body);
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].fp, fp);
	assert.equal(parsed[0].file, "app/routes/signup.tsx");
	assert.ok(parsed[0].words.has("turnstile"));
});

test("mergeFile collapses near-identical findings and credits both agents", () => {
	const groups = mergeFile([
		{
			agent: "engineering",
			rule: "Auth — public routes must opt out with @public",
			why: "Login route lacks the @public comment.",
		},
		{
			agent: "process",
			rule: "public route opt-out",
			why: "The login route is missing its @public opt-out comment.",
		},
	]);
	assert.equal(groups.length, 1);
	assert.deepEqual([...groups[0].agents].sort(), ["engineering", "process"]);
});

const mkGroup = (file, rule, why) => {
	const c = concept({ rule, why });
	return {
		file,
		concept: c,
		fp: fingerprint(file, c),
		agents: new Set(["engineering"]),
		rule,
		why,
	};
};
const mkThread = (group, over = {}) => ({
	id: over.id ?? 1,
	topCommentId: over.id ?? 1,
	threadNodeId: "T_1",
	isResolved: false,
	hasResolvedReply: false,
	path: group.file,
	fp: group.fp,
	words: group.concept,
	...over,
});

test("reconcile: fingerprint match on an existing thread skips the repost", () => {
	const g = mkGroup("a.ts", "no raw fetch", "Uses raw fetch instead of api().");
	const { toPost, skipped, toResolve } = reconcile([g], [mkThread(g)]);
	assert.equal(toPost.length, 0);
	assert.equal(skipped.length, 1);
	assert.equal(toResolve.length, 0);
});

test("reconcile: fuzzy word overlap on the same file also skips (wording wobble)", () => {
	const g1 = mkGroup(
		"a.ts",
		"no raw fetch",
		"Uses raw fetch instead of the api() helper.",
	);
	const g2 = mkGroup(
		"a.ts",
		"raw fetch forbidden",
		"Calls raw fetch; the helper api() is required.",
	);
	assert.notEqual(g1.fp, g2.fp);
	const { toPost, skipped } = reconcile([g2], [mkThread(g1)]);
	assert.equal(toPost.length, 0);
	assert.equal(skipped.length, 1);
});

test("reconcile: same words on a DIFFERENT file still posts", () => {
	const g1 = mkGroup("a.ts", "no raw fetch", "Uses raw fetch.");
	const g2 = { ...mkGroup("b.ts", "no raw fetch", "Uses raw fetch.") };
	const { toPost } = reconcile([g2], [mkThread(g1)]);
	assert.equal(toPost.length, 1);
});

test("reconcile: a resolved thread still dedupes — no nagging repost", () => {
	const g = mkGroup("a.ts", "no raw fetch", "Uses raw fetch.");
	const { toPost, skipped } = reconcile(
		[g],
		[mkThread(g, { isResolved: true })],
	);
	assert.equal(toPost.length, 0);
	assert.equal(skipped.length, 1);
});

test("reconcile: vanished finding → thread goes to toResolve, once", () => {
	const g = mkGroup("a.ts", "no raw fetch", "Uses raw fetch.");
	const stale = mkThread(g);
	assert.deepEqual(reconcile([], [stale]).toResolve, [stale]);
	// Already replied on a previous run → never again.
	assert.equal(
		reconcile([], [mkThread(g, { hasResolvedReply: true })]).toResolve.length,
		0,
	);
	// Already resolved → nothing to do.
	assert.equal(
		reconcile([], [mkThread(g, { isResolved: true })]).toResolve.length,
		0,
	);
});

test("reconcile: a finding reappearing after the BOT declared it resolved posts fresh", () => {
	// The bot's own "resolved in <sha>" claim (hasResolvedReply) must not dedupe
	// a reappearing finding — that would be a one-way ratchet where a false
	// resolve (or a regression) silences the finding forever.
	const g = mkGroup("a.ts", "no raw fetch", "Uses raw fetch.");
	const { toPost, skipped, toResolve } = reconcile(
		[g],
		[mkThread(g, { hasResolvedReply: true, isResolved: true })],
	);
	assert.equal(toPost.length, 1);
	assert.equal(skipped.length, 0);
	assert.equal(toResolve.length, 0);
});

test("reconcile: fuzzy matching caps BOTH sides like the marker (wordy findings)", () => {
	// >24 concept words: the thread's marker stores only the first 24 sorted
	// words. The fresh finding must be capped the same way or wordy findings
	// would match differently than they were stored.
	const words = Array.from({ length: 30 }, (_, i) => `topic${i}word`);
	const g = {
		file: "a.ts",
		concept: new Set(words),
		fp: "aaaaaaaaaaaaaaaa",
		agents: new Set(["engineering"]),
		rule: "wordy",
		why: "wordy",
	};
	const thread = mkThread(g, {
		fp: "bbbbbbbbbbbbbbbb", // force the fuzzy arm, not fp equality
		words: new Set([...words].sort().slice(0, 24)),
	});
	const { toPost, skipped } = reconcile([g], [thread]);
	assert.equal(toPost.length, 0);
	assert.equal(skipped.length, 1);
});

test("reconcile: markers from earlier review BODIES dedupe too", () => {
	const g = mkGroup("a.ts", "no raw fetch", "Uses raw fetch.");
	const { toPost, skipped } = reconcile(
		[g],
		[],
		[{ fp: g.fp, file: g.file, words: g.concept }],
	);
	assert.equal(toPost.length, 0);
	assert.equal(skipped.length, 1);
	assert.equal(skipped[0].body.fp, g.fp);
});

test("buildReviewPayload: COMMENT event, anchored comments, unanchored section", () => {
	const anchored = {
		...mkGroup("a.ts", "no raw fetch", "Uses fetch."),
		line: 5,
	};
	const unanchored = mkGroup("b.ts", "missing opt-out", "No @public comment.");
	const p = buildReviewPayload({
		commitId: "abc1234def",
		header: "### header",
		footer: "<sub>footer</sub>",
		anchored: [anchored],
		bodyFindings: [unanchored],
	});
	assert.equal(p.event, "COMMENT");
	assert.equal(p.commit_id, "abc1234def");
	assert.ok(p.body.startsWith("### header"));
	assert.ok(p.body.includes("#### Unanchored findings"));
	// The body finding is marker-identifiable for the next run's dedupe.
	assert.deepEqual(
		parseFindingMarkers(p.body).map((m) => m.fp),
		[unanchored.fp],
	);
	assert.deepEqual(p.comments, [
		{
			path: "a.ts",
			line: 5,
			side: "RIGHT",
			body: findingCommentBody(anchored),
		},
	]);
});

test("resolvedReplyBody carries the marker and a short sha", () => {
	const body = resolvedReplyBody("5dd1a0076294158a8c947d8a5d557dfe45619617");
	assert.ok(body.startsWith(RESOLVED_MARKER));
	assert.ok(body.includes("5dd1a00"));
	assert.ok(!body.includes("5dd1a0076"));
});

test("buildFindingMarker caps the word list but keeps it parseable", () => {
	const many = new Set(
		Array.from({ length: 40 }, (_, i) => `word${String(i).padStart(2, "0")}`),
	);
	const marker = buildFindingMarker("deadbeefdeadbeef", "a.ts", many);
	const parsed = parseFindingMarkers(marker)[0];
	assert.equal(parsed.words.size, 24);
	assert.equal(parsed.fp, "deadbeefdeadbeef");
});
