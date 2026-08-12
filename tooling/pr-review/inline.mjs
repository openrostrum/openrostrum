// Pure logic for posting findings as GitHub review comments: diff parsing,
// anchor resolution, fingerprinting, re-run reconciliation, and payload
// construction. No network, no env — everything here is unit-testable with
// `node --test tooling/pr-review/inline.test.node.mjs`. The orchestration
// (model calls, GitHub I/O) stays in ci-review.mjs.
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// One pass over a file's unified diff (see README "How findings are posted"):
// `newLines` = the anchorable new side (added+context lines with new-file line
// numbers); `code` = the model snippet, byte-identical to the eval-validated
// legacy format (join+trim); `map` = snippet line (1-based) → new-file line.
export function parseDiff(diffText) {
	const newLines = [];
	const out = [];
	const rawMap = [];
	let newLine = 0;
	let inHunk = false;
	for (const line of String(diffText).split("\n")) {
		const m = line.match(HUNK_RE);
		if (m) {
			newLine = Number(m[1]);
			inHunk = true;
			out.push(""); // blank hunk separator in the snippet
			rawMap.push(null);
			continue;
		}
		if (!inHunk) continue;
		const added = line.startsWith("+");
		if (!added && !line.startsWith(" ")) continue; // removals, "\ no newline"
		const text = line.slice(1);
		newLines.push({ line: newLine, text, added });
		out.push(text);
		rawMap.push(newLine);
		newLine++;
	}
	// join+trim drops whole leading/trailing all-whitespace lines; drop the same
	// lines from the map so map[i] stays snippet line i+1.
	let start = 0;
	while (start < out.length && out[start].trim() === "") start++;
	let end = out.length;
	while (end > start && out[end - 1].trim() === "") end--;
	return {
		code: out.join("\n").trim(),
		map: rawMap.slice(start, end),
		newLines,
	};
}

// ---------------------------------------------------------------------------
// Anchoring — pick the diff line a finding points at
// ---------------------------------------------------------------------------

const norm = (s) =>
	String(s ?? "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
const MIN_QUOTE = 8;

// Candidate code quotes from a finding, best first: backticked spans in
// `location`, then the free-text tail of `location` after the file[:line]
// prefix, then backticked spans in `why`.
export function extractQuotes(finding) {
	const out = [];
	const push = (q) => {
		const t = String(q ?? "").trim();
		if (t && norm(t).length >= MIN_QUOTE && !out.includes(t)) out.push(t);
	};
	const loc = String(finding.location ?? "");
	for (const m of loc.matchAll(/`([^`]+)`/g)) push(m[1]);
	const tail = loc
		.replace(/`[^`]*`/g, " ")
		.replace(/^[\w@/.[\]-]+\.\w+(?::\d+)?/, " ")
		.replace(/^[\s—–:-]+/, "")
		.trim();
	push(tail);
	for (const m of String(finding.why ?? "").matchAll(/`([^`]+)`/g)) push(m[1]);
	return out;
}

// Models elide long quotes with "..."/"…" — split into fragments and require
// every fragment (each meaningful on its own) to appear in the line.
function fragmentsOf(quote) {
	return norm(quote)
		.split(/\s*(?:\.{3}|…)\s*/)
		.filter((f) => f.length >= 4);
}

function lineMatches(lineText, fragments) {
	const l = norm(lineText);
	if (l.length < 4) return false;
	return fragments.every((f) => l.includes(f));
}

// Resolve a finding to a new-file line present in the diff, or null (see
// README "Anchoring"): (1) quote match, added lines preferred; (2) `:N` read
// as a SNIPPET line (all the model ever saw) mapped through parseDiff().map.
export function anchorFinding(finding, newLines, snippetMap) {
	if (Number.isInteger(finding.line) && finding.line > 0 && finding.quote) {
		const claimed = newLines.find(
			(candidate) => candidate.line === finding.line && candidate.added,
		);
		if (claimed && norm(claimed.text).includes(norm(finding.quote)))
			return claimed.line;
		if (!finding.location) return null;
	}
	for (const quote of extractQuotes(finding)) {
		const fragments = fragmentsOf(quote);
		if (!fragments.length) continue;
		const hits = newLines.filter((l) => lineMatches(l.text, fragments));
		if (hits.length) {
			const added = hits.filter((h) => h.added);
			return (added[0] ?? hits[0]).line;
		}
	}
	const m = String(finding.location ?? "").match(/:(\d+)\b/);
	if (m && Array.isArray(snippetMap)) {
		const idx = Number(m[1]) - 1;
		// A hunk-separator (null) tolerates a small forward scan to the next
		// mapped line; a line number past the snippet does not anchor.
		for (let i = idx; i >= 0 && i < snippetMap.length && i <= idx + 3; i++) {
			if (snippetMap[i] != null) return snippetMap[i];
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Finding identity — merge (within a run) and fingerprint (across runs)
// ---------------------------------------------------------------------------

// A rule can be stated in more than one doc, so multiple agents legitimately
// flag the same concern on the same file. That is redundancy, not extra
// signal — collapse near-identical findings within a file into one group that
// credits every agent that raised it.
const STOP = new Set([
	"this",
	"that",
	"which",
	"must",
	"from",
	"into",
	"with",
	"your",
	"have",
	"will",
	"when",
	"them",
	"they",
	"file",
	"code",
	"change",
	"changes",
	"rule",
	"rules",
	"line",
	"diff",
	"says",
	"state",
	"states",
]);

export function concept(f) {
	const words = `${f.rule ?? ""} ${f.why ?? ""}`
		.toLowerCase()
		.match(/[a-z0-9/.]+/g);
	// Strip trailing sentence periods (kept by the tokenizer for paths like
	// app/x.ts) and a trailing plural 's' only (routes→route) — deeper stemming
	// mangled words and broke the overlap it was meant to help.
	return new Set(
		(words ?? [])
			.map((w) => w.replace(/\.+$/, "").replace(/s$/, ""))
			.filter((w) => w.length > 3 && !STOP.has(w)),
	);
}

// Two findings are the same concern when 40% of the smaller one's words appear
// in the seed. Compared against a fixed seed (not a growing union) so the bar
// doesn't drift as agents pile on.
export function similar(seed, c) {
	if (!seed.size || !c.size) return false;
	let inter = 0;
	for (const w of c) if (seed.has(w)) inter++;
	return inter / Math.min(seed.size, c.size) >= 0.4;
}

export function mergeFile(findings) {
	const groups = [];
	for (const f of findings) {
		const c = concept(f);
		const g = groups.find((g) => similar(g.concept, c));
		if (g) g.agents.add(f.agent);
		else
			groups.push({
				concept: c,
				agents: new Set([f.agent]),
				rule: f.rule,
				why: f.why,
				location: f.location,
				line: f.line,
				quote: f.quote,
			});
	}
	return groups;
}

// Cross-run identity: file + sorted concept words. Line numbers (shift every
// push) and agent ids (the messenger wobbles, not the concern) are excluded —
// see README "Re-run dedupe".
export function fingerprint(file, conceptSet) {
	const words = [...conceptSet].sort().join(" ");
	return createHash("sha256")
		.update(`${file}\0${words}`)
		.digest("hex")
		.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Markers — machine-identifiable comment bodies
// ---------------------------------------------------------------------------

// Every posted finding embeds a marker (fingerprint + file + capped concept
// words) so a re-run recognizes its own comments after wording wobbles.
// concept() words are [a-z0-9/.]+ — safe inside an HTML comment.
export const SUMMARY_MARKER = "<!-- deepseek-review -->";
export const RESOLVED_MARKER = "<!-- deepseek-resolved -->";
const FINDING_RE =
	/<!-- deepseek-finding fp=([0-9a-f]+) file=(\S+) words=(\S*) -->/g;

// Marker cap; reconcile applies the SAME cap to the fresh side, so fuzzy
// matching behaves identically for wordy findings.
export function markerWords(conceptSet) {
	return [...conceptSet].sort().slice(0, 24);
}

export function buildFindingMarker(fp, file, conceptSet) {
	return `<!-- deepseek-finding fp=${fp} file=${file} words=${markerWords(conceptSet).join(",")} -->`;
}

export function parseFindingMarkers(body) {
	const out = [];
	for (const m of String(body ?? "").matchAll(FINDING_RE)) {
		out.push({
			fp: m[1],
			file: m[2],
			words: new Set(m[3] ? m[3].split(",") : []),
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Reconcile — what to post, what to skip, what to close
// ---------------------------------------------------------------------------

// Split this run's findings against previous runs' threads/body markers into
// toPost / skipped / toResolve. Matching = same file + (fp equal OR capped
// fuzzy word overlap). Human-resolved threads still dedupe (no nagging);
// BOT-resolved ones (hasResolvedReply) never do — full table in the README.
export function reconcile(groups, threads, prevBodyFindings = []) {
	const toPost = [];
	const skipped = [];
	const matchedThreads = new Set();
	const matches = (g, t) =>
		(t.path ?? t.file) === g.file &&
		(t.fp === g.fp || similar(t.words, new Set(markerWords(g.concept))));
	for (const g of groups) {
		const t = threads.find((t) => !t.hasResolvedReply && matches(g, t));
		if (t) {
			matchedThreads.add(t.id);
			skipped.push({ group: g, thread: t });
			continue;
		}
		const b = prevBodyFindings.find((b) => matches(g, b));
		if (b) skipped.push({ group: g, body: b });
		else toPost.push(g);
	}
	const toResolve = threads.filter(
		(t) => !matchedThreads.has(t.id) && !t.isResolved && !t.hasResolvedReply,
	);
	return { toPost, skipped, toResolve };
}

export function partitionStaleThreads(toResolve, reviewComplete) {
	return reviewComplete
		? { resolvable: toResolve, deferred: [] }
		: { resolvable: [], deferred: toResolve };
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

// One formatter for the finding line everywhere it renders (inline comment,
// file-level comment, review-body bullet) so the presentations never drift.
export function findingLine(g) {
	const who = [...g.agents].sort().join(", ");
	return `**[${who}] ${g.rule ?? "rule"}** — ${g.why ?? ""}`;
}

// Marker + bullet for a finding rendered in a comment BODY (review body's
// unanchored section, or the last-resort summary fallback) — one renderer.
export function findingBullet(g) {
	const loc = g.location ? ` _(${g.location})_` : "";
	return `${buildFindingMarker(g.fp, g.file, g.concept)}\n- **\`${g.file}\`** — ${findingLine(g)}${loc}`;
}

export function findingCommentBody(g, { withLocation = false } = {}) {
	const loc = withLocation && g.location ? `\n\n_${g.location}_` : "";
	return (
		`${buildFindingMarker(g.fp, g.file, g.concept)}\n` +
		`🤖 ${findingLine(g)}${loc}\n\n` +
		`<sub>Advisory — DeepSeek review against \`docs/rules/\`; resolve or dismiss as you see fit.</sub>`
	);
}

export function resolvedReplyBody(sha) {
	return `${RESOLVED_MARKER}\n✅ Resolved in ${String(sha).slice(0, 7)} — finding no longer present in the latest diff.`;
}

// The single review: event COMMENT (advisory by construction — never
// REQUEST_CHANGES), one inline comment per anchored finding, unanchorable
// ones carried in the body so nothing is dropped silently.
export function buildReviewPayload({
	commitId,
	header,
	footer,
	anchored,
	bodyFindings,
}) {
	const body = [header];
	if (bodyFindings.length) {
		body.push("", "#### Unanchored findings", "");
		for (const g of bodyFindings) body.push(findingBullet(g));
	}
	if (footer) body.push(footer);
	return {
		commit_id: commitId,
		event: "COMMENT",
		body: body.join("\n"),
		comments: anchored.map((a) => ({
			path: a.file,
			line: a.line,
			side: "RIGHT",
			body: findingCommentBody(a),
		})),
	};
}
