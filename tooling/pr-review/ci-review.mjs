// Production PR reviewer. Runs in CI on pull_request: diffs the PR, feeds each
// changed source file to every rule-doc agent (the SAME prompt+client the eval
// harness validates, from core.mjs), and posts ONE advisory comment on the PR.
//
// Comment-only by design: it never fails the check. It informs; it does not
// gate. Promote to blocking only once precision is proven in the wild.
//
// Env (set by .github/workflows/ci.yml): DEEPSEEK_API_KEY, GH_TOKEN, REPO
// (owner/repo), PR_NUMBER, BASE_SHA, HEAD_SHA.
import { execFileSync } from "node:child_process";
import { loadSystems, makeClient, pool } from "./core.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 6);
const MAX_FILES = Number(process.env.MAX_FILES ?? 60);
// Self-consistency vote: a finding must recur in a majority of samples to post,
// which filters the model's flaky one-off false positives. See core.mjs.
const SAMPLES = Number(process.env.SAMPLES ?? 3);
const THRESHOLD = Number(process.env.THRESHOLD ?? 2);

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.REPO;
const PR = process.env.PR_NUMBER;
const BASE_SHA = process.env.BASE_SHA;
const HEAD_SHA = process.env.HEAD_SHA;

// DRY_RUN=1 prints the comment instead of posting it — for local verification
// of review quality without GitHub write access.
const DRY = process.env.DRY_RUN === "1";
const MARKER = "<!-- deepseek-review -->";
// Source files the rule docs actually govern. Docs, lockfiles, and generated
// artifacts are out — reviewing them is pure noise.
const REVIEWABLE = /\.(ts|tsx|js|jsx|mjs|cjs|css|sql)$/;
const SKIP =
	/(^|\/)(node_modules|\.react-router|dist|build)\/|worker-configuration\.d\.ts$|\.gen\.ts$|\.snap$/;

const required = DRY
	? { DEEPSEEK_API_KEY: KEY, BASE_SHA, HEAD_SHA }
	: {
			DEEPSEEK_API_KEY: KEY,
			GH_TOKEN,
			REPO,
			PR_NUMBER: PR,
			BASE_SHA,
			HEAD_SHA,
		};
for (const [k, v] of Object.entries(required)) {
	if (!v) {
		console.error(`missing env ${k}`);
		process.exit(1);
	}
}

function git(...args) {
	return execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
}

// Reconstruct the new side of a file's diff as a plain snippet: keep added and
// context lines, drop removals and diff metadata. This matches the format the
// eval validated (a code block of the changed code) and scopes review to the
// change — no flagging pre-existing lines the PR never touched.
function newSnippet(diffText) {
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

async function gh(method, path, body) {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			authorization: `Bearer ${GH_TOKEN}`,
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			"user-agent": "deepseek-review",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok)
		throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
	return res.json();
}

async function upsertComment(body) {
	// Find our previous comment (across pages) and edit it in place, so a re-push
	// updates one comment instead of stacking a new one every run.
	let page = 1;
	let mine = null;
	for (;;) {
		const batch = await gh(
			"GET",
			`/repos/${REPO}/issues/${PR}/comments?per_page=100&page=${page}`,
		);
		mine = batch.find((c) => (c.body || "").includes(MARKER));
		if (mine || batch.length < 100) break;
		page++;
	}
	if (mine)
		await gh("PATCH", `/repos/${REPO}/issues/comments/${mine.id}`, { body });
	else await gh("POST", `/repos/${REPO}/issues/${PR}/comments`, { body });
}

const mergeBase = git("merge-base", BASE_SHA, HEAD_SHA).trim();
const changed = git(
	"diff",
	"--name-only",
	"--diff-filter=d",
	mergeBase,
	HEAD_SHA,
)
	.split("\n")
	.filter(Boolean);
const candidates = changed.filter((f) => REVIEWABLE.test(f) && !SKIP.test(f));

const dropped = Math.max(0, candidates.length - MAX_FILES);
const files = candidates.slice(0, MAX_FILES);

const { agents, systems } = await loadSystems();
const client = makeClient({
	key: KEY,
	base: BASE,
	model: MODEL,
	temperature: TEMPERATURE,
});

const items = [];
for (const file of files) {
	const code = newSnippet(git("diff", mergeBase, HEAD_SHA, "--", file));
	if (!code) continue;
	for (const a of agents) items.push({ file, agent: a.id, code });
}

console.log(
	`reviewing ${files.length} file(s) × ${agents.length} agent(s) = ${items.length} checks (candidates=${candidates.length}, dropped=${dropped})`,
);

const results = await pool(items, CONC, async (it) => {
	try {
		const { findings } = await client.reviewVoted(
			systems.get(it.agent),
			it.file,
			it.code,
			{ samples: SAMPLES, threshold: THRESHOLD },
		);
		return { ...it, findings };
	} catch (e) {
		return { ...it, findings: [], error: String(e) };
	}
});

const errored = results.filter((r) => r.error).length;

// A rule can be stated in more than one doc (e.g. routing appears in several),
// so multiple agents legitimately flag the same concern on the same file. That
// is redundancy, not extra signal — collapse near-identical findings within a
// file into one bullet that credits every agent that raised it.
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
function concept(f) {
	const words = `${f.rule ?? ""} ${f.why ?? ""}`
		.toLowerCase()
		.match(/[a-z0-9/.]+/g);
	// Strip a trailing plural 's' only (routes→route, edits→edit) — deeper
	// stemming mangled words and broke the overlap it was meant to help.
	return new Set(
		(words ?? [])
			.map((w) => w.replace(/s$/, ""))
			.filter((w) => w.length > 3 && !STOP.has(w)),
	);
}
// Two findings are the same concern when half of the smaller one's words appear
// in the group seed. Compared against a fixed seed (not a growing union) so the
// bar doesn't drift as agents pile on.
function similar(seed, c) {
	if (!seed.size || !c.size) return false;
	let inter = 0;
	for (const w of c) if (seed.has(w)) inter++;
	return inter / Math.min(seed.size, c.size) >= 0.4;
}
function mergeFile(findings) {
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
			});
	}
	return groups;
}

const byFile = new Map();
for (const r of results) {
	for (const f of r.findings) {
		if (!byFile.has(r.file)) byFile.set(r.file, []);
		byFile.get(r.file).push({ agent: r.agent, ...f });
	}
}
for (const [file, fs] of byFile) byFile.set(file, mergeFile(fs));
const total = [...byFile.values()].reduce((n, a) => n + a.length, 0);

const lines = [MARKER];
if (total === 0) {
	lines.push("### 🤖 DeepSeek review — no issues found");
	lines.push(
		`_Reviewed ${files.length} changed file(s) against \`docs/rules/\`. Advisory (comment-only)._`,
	);
} else {
	lines.push(
		`### 🤖 DeepSeek review — ${total} finding(s) across ${byFile.size} file(s)`,
	);
	lines.push(
		"_Advisory (comment-only): this does not block merge. Each finding cites the rule doc it came from._\n",
	);
	for (const [file, groups] of byFile) {
		lines.push(`**\`${file}\`**`);
		for (const g of groups) {
			const loc = g.location ? ` _(${g.location})_` : "";
			const who = [...g.agents].sort().join(", ");
			lines.push(`- **[${who}] ${g.rule ?? "rule"}** — ${g.why ?? ""}${loc}`);
		}
		lines.push("");
	}
}
const notes = [];
if (dropped)
	notes.push(
		`${dropped} additional changed file(s) not reviewed (cap ${MAX_FILES})`,
	);
if (errored) notes.push(`${errored} check(s) errored and were skipped`);
if (notes.length) lines.push(`\n> ⚠️ ${notes.join("; ")}.`);
lines.push(
	`\n<sub>model: ${MODEL} · agents: ${agents.map((a) => a.id).join(", ")}</sub>`,
);

const body = lines.join("\n");
if (DRY) {
	console.log(`\n--- comment (dry run) ---\n${body}`);
} else {
	await upsertComment(body);
	console.log(
		`posted: ${total} finding(s), ${errored} error(s), ${dropped} dropped`,
	);
}
