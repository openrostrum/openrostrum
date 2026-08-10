// Production PR reviewer. Runs in CI on pull_request: diffs the PR, runs each
// changed file past every rule-doc agent (the SAME prompt+client the eval
// harness validates, from core.mjs), and posts the findings as ONE advisory
// review (event always COMMENT — informs, never gates) with inline comments
// per finding. Posting model, fallback chain, and reconcile semantics:
// README "How findings are posted"; the pure logic lives in inline.mjs.
// Env (set by .github/workflows/ci.yml): DEEPSEEK_API_KEY, GH_TOKEN, REPO
// (owner/repo), PR_NUMBER, BASE_SHA, HEAD_SHA.
import { execFileSync } from "node:child_process";
import { loadSystems, makeClient, pool } from "./core.mjs";
import {
	anchorFinding,
	buildReviewPayload,
	fingerprint,
	findingBullet,
	findingCommentBody,
	mergeFile,
	parseDiff,
	parseFindingMarkers,
	reconcile,
	resolvedReplyBody,
	RESOLVED_MARKER,
	SUMMARY_MARKER,
} from "./inline.mjs";

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

// DRY_RUN=1 (or --dry-run) prints the payloads instead of posting — for local
// verification without GitHub write access. If GH_TOKEN/REPO/PR_NUMBER are
// also set, the dry run previews the reconcile plan with READ-ONLY calls; it
// never writes.
const DRY = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");
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
const CAN_READ_GH = Boolean(GH_TOKEN && REPO && PR);

function git(...args) {
	return execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
}

// ---------------------------------------------------------------------------
// GitHub I/O
// ---------------------------------------------------------------------------

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

async function ghPaged(path) {
	const all = [];
	for (let page = 1; ; page++) {
		const sep = path.includes("?") ? "&" : "?";
		const batch = await gh("GET", `${path}${sep}per_page=100&page=${page}`);
		all.push(...batch);
		if (batch.length < 100) return all;
	}
}

async function ghGraphql(query, variables) {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			authorization: `Bearer ${GH_TOKEN}`,
			"content-type": "application/json",
			"user-agent": "deepseek-review",
		},
		body: JSON.stringify({ query, variables }),
	});
	const json = await res.json();
	if (!res.ok || json.errors?.length)
		throw new Error(
			`graphql → ${res.status} ${JSON.stringify(json.errors ?? json)}`,
		);
	return json.data;
}

// Resolution state and thread node ids live only in GraphQL. Best effort: if
// this fails we still dedupe via REST (threads assumed unresolved — the safe
// direction, it only means we skip reposting).
async function fetchThreadState() {
	const [owner, name] = REPO.split("/");
	const byTopComment = new Map();
	let cursor = null;
	for (;;) {
		const data = await ghGraphql(
			`query($owner:String!,$name:String!,$number:Int!,$cursor:String){
				repository(owner:$owner,name:$name){ pullRequest(number:$number){
					reviewThreads(first:100, after:$cursor){
						pageInfo{ hasNextPage endCursor }
						nodes{ id isResolved comments(first:1){ nodes{ databaseId } } }
					}
				}}
			}`,
			{ owner, name, number: Number(PR), cursor },
		);
		const conn = data.repository.pullRequest.reviewThreads;
		for (const t of conn.nodes) {
			const top = t.comments.nodes[0]?.databaseId;
			if (top != null)
				byTopComment.set(top, { threadNodeId: t.id, isResolved: t.isResolved });
		}
		if (!conn.pageInfo.hasNextPage) return byTopComment;
		cursor = conn.pageInfo.endCursor;
	}
}

// Existing state from previous runs: our marker-bearing review-comment threads
// (inline + file-level) and finding markers recovered from our review bodies
// (the unanchored section — recognizable for dedupe, not resolvable).
async function listOurState() {
	const comments = await ghPaged(`/repos/${REPO}/pulls/${PR}/comments`);
	let threadState = new Map();
	try {
		threadState = await fetchThreadState();
	} catch (e) {
		console.warn(`thread-state query failed (dedupe still on): ${e}`);
	}
	const threads = [];
	for (const c of comments) {
		if (c.in_reply_to_id) continue;
		const marker = parseFindingMarkers(c.body)[0];
		if (!marker) continue;
		const state = threadState.get(c.id) ?? {};
		threads.push({
			id: c.id,
			topCommentId: c.id,
			threadNodeId: state.threadNodeId ?? null,
			isResolved: state.isResolved ?? false,
			hasResolvedReply: comments.some(
				(r) =>
					r.in_reply_to_id === c.id && (r.body ?? "").includes(RESOLVED_MARKER),
			),
			path: c.path,
			fp: marker.fp,
			words: marker.words,
		});
	}
	// Body findings dedupe but can't be resolved: markers in review bodies (the
	// unanchored section) and in issue comments (the summary fallback).
	const reviews = await ghPaged(`/repos/${REPO}/pulls/${PR}/reviews`);
	const issueComments = await ghPaged(`/repos/${REPO}/issues/${PR}/comments`);
	const prevBodyFindings = [...reviews, ...issueComments].flatMap((x) =>
		parseFindingMarkers(x.body),
	);
	return { threads, prevBodyFindings };
}

async function upsertSummaryComment(
	body,
	{ createIfMissing = true, unlessFindings = false } = {},
) {
	const comments = await ghPaged(`/repos/${REPO}/issues/${PR}/comments`);
	const mine = comments.find((c) => (c.body ?? "").includes(SUMMARY_MARKER));
	// A summary carrying finding markers is a previous run's fallback post —
	// overwriting it would wipe those markers and repost the findings as dupes.
	if (mine && unlessFindings && parseFindingMarkers(mine.body).length) return;
	if (mine)
		await gh("PATCH", `/repos/${REPO}/issues/comments/${mine.id}`, { body });
	else if (createIfMissing)
		await gh("POST", `/repos/${REPO}/issues/${PR}/comments`, { body });
}

// Reply "resolved" on stale threads, then resolve them (GraphQL, best effort —
// if the token can't run the mutation the reply already tells the reader).
async function closeStaleThreads(toResolve) {
	let resolved = 0;
	for (const t of toResolve) {
		try {
			await gh(
				"POST",
				`/repos/${REPO}/pulls/${PR}/comments/${t.topCommentId}/replies`,
				{ body: resolvedReplyBody(HEAD_SHA) },
			);
		} catch (e) {
			console.warn(`stale-thread reply failed (${t.fp}): ${e}`);
			continue;
		}
		if (!t.threadNodeId) continue;
		try {
			await ghGraphql(
				`mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }`,
				{ id: t.threadNodeId },
			);
			resolved++;
		} catch (e) {
			console.warn(`resolveReviewThread failed (${t.fp}) — reply stands: ${e}`);
		}
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Review the diff
// ---------------------------------------------------------------------------

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

// Per file: the model snippet (eval-validated format) plus the anchor data
// (snippet-line map + the diff's new-side lines), from one diff parse.
const diffByFile = new Map();
const items = [];
for (const file of files) {
	const { code, map, newLines } = parseDiff(
		git("diff", mergeBase, HEAD_SHA, "--", file),
	);
	if (!code) continue;
	diffByFile.set(file, { map, newLines });
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

const byFile = new Map();
for (const r of results) {
	for (const f of r.findings) {
		if (!byFile.has(r.file)) byFile.set(r.file, []);
		byFile.get(r.file).push({ agent: r.agent, ...f });
	}
}

// Merge near-identical findings within a file, then anchor + fingerprint each
// group. `line` null = unanchorable → file-level fallback.
const groups = [];
for (const [file, fs] of byFile) {
	const { map, newLines } = diffByFile.get(file);
	for (const g of mergeFile(fs)) {
		groups.push({
			...g,
			file,
			fp: fingerprint(file, g.concept),
			line: anchorFinding(g, newLines, map),
		});
	}
}
const total = groups.length;

// ---------------------------------------------------------------------------
// Reconcile against previous runs, then post
// ---------------------------------------------------------------------------

let threads = [];
let prevBodyFindings = [];
if (CAN_READ_GH) {
	try {
		({ threads, prevBodyFindings } = await listOurState());
	} catch (e) {
		// Listing failed: post everything rather than drop anything. Worst case
		// is a duplicate comment, never a lost finding.
		console.warn(`listing previous state failed — dedupe off: ${e}`);
	}
} else if (DRY) {
	console.log(
		"dry run without GH_TOKEN/REPO/PR_NUMBER — reconcile preview skipped (no previous state).",
	);
}

const { toPost, skipped, toResolve } = reconcile(
	groups,
	threads,
	prevBodyFindings,
);
const anchored = toPost.filter((g) => g.line != null);
const fileLevel = toPost.filter((g) => g.line == null);

// Close a thread only when its file was re-reviewed cleanly this run (or left
// the diff): a finding that "vanished" behind an errored check or the file cap
// is unknown, not resolved — defer it (README "Reconcile").
const erroredFiles = new Set(results.filter((r) => r.error).map((r) => r.file));
const droppedFiles = new Set(candidates.slice(MAX_FILES));
const resolvable = toResolve.filter(
	(t) => !erroredFiles.has(t.path) && !droppedFiles.has(t.path),
);
const deferred = toResolve.length - resolvable.length;

const headerLines = [
	`### 🤖 DeepSeek review — ${total} finding(s) across ${byFile.size} file(s)`,
	"_Advisory (comment-only): this does not block merge. Each finding cites the rule doc it came from._",
];
if (skipped.length)
	headerLines.push(
		`_${skipped.length} of ${total} already posted on an earlier run — see the existing threads._`,
	);
const notes = [];
if (dropped)
	notes.push(
		`${dropped} additional changed file(s) not reviewed (cap ${MAX_FILES})`,
	);
if (errored) notes.push(`${errored} check(s) errored and were skipped`);
const footer =
	(notes.length ? `\n> ⚠️ ${notes.join("; ")}.\n` : "") +
	`\n<sub>model: ${MODEL} · agents: ${agents.map((a) => a.id).join(", ")}</sub>`;

const fileLevelPayloads = fileLevel.map((g) => ({
	path: `/repos/${REPO ?? "<repo>"}/pulls/${PR ?? "<pr>"}/comments`,
	body: {
		commit_id: HEAD_SHA,
		path: g.file,
		subject_type: "file",
		body: findingCommentBody(g, { withLocation: true }),
	},
}));

const makeReview = (anchoredGroups, bodyGroups) =>
	buildReviewPayload({
		commitId: HEAD_SHA,
		header: headerLines.join("\n"),
		footer,
		anchored: anchoredGroups,
		bodyFindings: bodyGroups,
	});

if (DRY) {
	const show = (g) => ({
		file: g.file,
		line: g.line,
		fp: g.fp,
		agents: [...g.agents].sort(),
		rule: g.rule,
	});
	const plan = {
		findings: total,
		anchored: anchored.map(show),
		fileLevel: fileLevel.map(show),
		skipped: skipped.map((s) => ({
			...show(s.group),
			matched: s.thread ? `thread ${s.thread.id}` : "earlier review body",
		})),
		toResolve: resolvable.map((t) => ({
			path: t.path,
			fp: t.fp,
			topCommentId: t.topCommentId,
			canResolveThread: Boolean(t.threadNodeId),
		})),
		deferredResolves: toResolve
			.filter((t) => !resolvable.includes(t))
			.map((t) => ({
				path: t.path,
				fp: t.fp,
				reason: erroredFiles.has(t.path) ? "check errored" : "file dropped",
			})),
		reviewPayload: toPost.length ? makeReview(anchored, []) : null,
		fileLevelComments: fileLevelPayloads,
	};
	console.log(`\n--- inline review plan (dry run) ---`);
	console.log(JSON.stringify(plan, null, 2));
	process.exit(0);
}

if (total === 0) {
	// No findings → the single summary comment, as before. Never an empty
	// review. Stale threads from earlier runs still get closed below.
	await upsertSummaryComment(
		[
			SUMMARY_MARKER,
			"### 🤖 DeepSeek review — no issues found",
			`_Reviewed ${files.length} changed file(s) against \`docs/rules/\`. Advisory (comment-only)._`,
			footer,
		].join("\n"),
	);
} else if (toPost.length === 0) {
	console.log(
		`all ${total} finding(s) already posted on earlier runs — no new review.`,
	);
} else {
	// Fallback chain, nothing dropped: file-level comments first (a failure
	// demotes the finding into the review body), then the single review.
	const demoted = [];
	for (let i = 0; i < fileLevel.length; i++) {
		try {
			await gh("POST", fileLevelPayloads[i].path, fileLevelPayloads[i].body);
		} catch (e) {
			console.warn(`file-level comment failed (${fileLevel[i].fp}): ${e}`);
			demoted.push(fileLevel[i]);
		}
	}
	let reviewPosted = false;
	try {
		await gh(
			"POST",
			`/repos/${REPO}/pulls/${PR}/reviews`,
			makeReview(anchored, demoted),
		);
		reviewPosted = true;
	} catch (e) {
		// Most likely a comment GitHub refused to anchor (422). Retry once with
		// every inline comment demoted to the body — the findings still land.
		console.warn(
			`review POST failed, retrying with all findings in body: ${e}`,
		);
		try {
			await gh(
				"POST",
				`/repos/${REPO}/pulls/${PR}/reviews`,
				makeReview([], [...anchored, ...demoted]),
			);
			reviewPosted = true;
		} catch (e2) {
			// Last resort: the legacy summary comment, markers included so these
			// findings still dedupe on the next run. Findings must land somewhere.
			console.warn(`retry failed too — falling back to the summary: ${e2}`);
			const bullets = [...anchored, ...demoted].map(findingBullet);
			await upsertSummaryComment(
				[SUMMARY_MARKER, headerLines.join("\n"), "", ...bullets, footer].join(
					"\n",
				),
			);
		}
	}
	// A stale "no issues found" summary must not stand next to a review full of
	// findings — repoint it. Never created here, never overwrites a summary that
	// carries fallback findings (any run's), and cosmetic: failure is a warning.
	if (reviewPosted)
		try {
			await upsertSummaryComment(
				[
					SUMMARY_MARKER,
					`### 🤖 DeepSeek review — ${total} finding(s) across ${byFile.size} file(s)`,
					"_Findings are posted as review comments on the diff — resolve, dismiss, or answer each individually. Advisory (comment-only)._",
					footer,
				].join("\n"),
				{ createIfMissing: false, unlessFindings: true },
			);
		} catch (e) {
			console.warn(`summary repoint failed (cosmetic): ${e}`);
		}
}

const resolvedCount = await closeStaleThreads(resolvable);
console.log(
	`posted: ${toPost.length} new finding(s) (${anchored.length} inline, ${fileLevel.length} file-level), ` +
		`${skipped.length} already-posted skipped, ${resolvable.length} stale thread(s) replied (${resolvedCount} resolved, ${deferred} deferred), ` +
		`${errored} error(s), ${dropped} dropped`,
);
