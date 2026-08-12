// Production PR reviewer. Runs one autonomous whole-PR DeepSeek session per
// dynamically discovered rule document, then deterministically posts one
// advisory review (event always COMMENT — informs, never gates). Repository
// context is read on demand through bounded, read-only tools. Posting fallback
// and reconciliation semantics live in inline.mjs and are documented in README.
// Env (set by .github/workflows/ci.yml): DEEPSEEK_API_KEY, GH_TOKEN, REPO
// (owner/repo), PR_NUMBER, BASE_SHA, HEAD_SHA.
import { runRuleReviewers } from "./agent.mjs";
import { loadSystems, makeRuntime } from "./core.mjs";
import {
	anchorFinding,
	buildReviewPayload,
	fingerprint,
	findingBullet,
	findingCommentBody,
	mergeFile,
	parseDiff,
	parseFindingMarkers,
	partitionStaleThreads,
	reconcile,
	resolvedReplyBody,
	RESOLVED_MARKER,
	SUMMARY_MARKER,
} from "./inline.mjs";
import { createGitRepository } from "./repository.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 6);

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

const repository = createGitRepository({
	repoRoot: process.cwd(),
	baseSha: BASE_SHA,
	headSha: HEAD_SHA,
});
const { agents, systems } = await loadSystems();
const runtime = makeRuntime({
	key: KEY,
	base: BASE,
	model: MODEL,
	temperature: TEMPERATURE,
});

console.log(
	`starting ${agents.length} whole-PR reviewer session(s) for ${repository.changes.length} changed file(s)`,
);
const results = await runRuleReviewers({
	agents,
	systems,
	repository,
	runtime,
	concurrency: CONC,
});
const incomplete = results.filter((result) => result.status !== "complete");
const reviewComplete = incomplete.length === 0;
for (const result of results) {
	console.log(
		`${result.agent}: ${result.status}; turns=${result.turns}; tools=${result.toolCalls}` +
			(result.reason ? `; reason=${result.reason}` : ""),
	);
}

const byFile = new Map();
for (const result of results) {
	for (const finding of result.findings) {
		if (!byFile.has(finding.file)) byFile.set(finding.file, []);
		byFile.get(finding.file).push(finding);
	}
}

// Merge near-identical findings within a file, then anchor + fingerprint each
// group. Direct absolute lines are accepted only when their exact quote matches
// an added diff line; otherwise the existing deterministic fallbacks apply.
const groups = [];
for (const [file, findings] of byFile) {
	const { map, newLines } = parseDiff(repository.getRawDiff(file));
	for (const group of mergeFile(findings)) {
		groups.push({
			...group,
			file,
			fp: fingerprint(file, group.concept),
			line: anchorFinding(group, newLines, map),
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

// Never transition stale threads from an incomplete review: a missing finding is
// unknown rather than resolved when any rule owner failed to finish.
const stale = partitionStaleThreads(toResolve, reviewComplete);
const resolvable = stale.resolvable;
const deferred = stale.deferred.length;

const headerLines = [
	`### 🤖 DeepSeek review — ${total} finding(s) across ${byFile.size} file(s)`,
	"_Advisory (comment-only): this does not block merge. Each finding cites the rule doc it came from._",
];
if (skipped.length)
	headerLines.push(
		`_${skipped.length} of ${total} already posted on an earlier run — see the existing threads._`,
	);
const notes = [];
if (incomplete.length)
	notes.push(
		`${incomplete.length} rule reviewer(s) incomplete: ${incomplete
			.map((result) => result.agent)
			.join(", ")}; this is not a clean review`,
	);
const footer =
	(notes.length ? `\n> ⚠️ ${notes.join("; ")}.\n` : "") +
	`\n<sub>model: ${MODEL} · whole-PR sessions: ${agents.map((a) => a.id).join(", ")}</sub>`;

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
		reviewStatus: reviewComplete ? "complete" : "incomplete",
		reviewerSessions: results.map((result) => ({
			agent: result.agent,
			status: result.status,
			reason: result.reason,
			turns: result.turns,
			toolCalls: result.toolCalls,
		})),
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
		deferredResolves: stale.deferred.map((thread) => ({
			path: thread.path,
			fp: thread.fp,
			reason: "review incomplete",
		})),
		reviewPayload: toPost.length ? makeReview(anchored, []) : null,
		fileLevelComments: fileLevelPayloads,
	};
	console.log(`\n--- inline review plan (dry run) ---`);
	console.log(JSON.stringify(plan, null, 2));
	process.exit(0);
}

if (total === 0) {
	const title = reviewComplete
		? "### 🤖 DeepSeek review — no issues found"
		: "### 🤖 DeepSeek review — incomplete";
	const detail = reviewComplete
		? `_Reviewed all ${repository.changes.length} changed file(s) against \`docs/rules/\` with one whole-PR session per rule document. Advisory (comment-only)._`
		: `_No clean result: ${incomplete
				.map((result) => `\`${result.agent}\` (${result.reason})`)
				.join(", ")}. Existing review threads were left unchanged._`;
	await upsertSummaryComment(
		[SUMMARY_MARKER, title, detail, footer].join("\n"),
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
		`${incomplete.length} incomplete reviewer(s)`,
);
if (!reviewComplete) process.exitCode = 1;
