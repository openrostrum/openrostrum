import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import {
	extractJson,
	FINDING_LIMITS,
	requestCeiling,
	SUBMISSIONS_PER_RESPONSE,
} from "./core.mjs";
import { createRepositoryTools } from "./repository.mjs";

const SUBMIT_TOOL = "submit_finding";

// One finding, validated where it is submitted. Pi checks a tool call against
// its own parameter schema before the tool runs, so this is the boundary: a
// submission that misses it is refused with a reason the reviewer can act on
// and never enters the bank.
const FINDING = Type.Object(
	{
		file: Type.String({ minLength: 1 }),
		line: Type.Integer({ minimum: 1 }),
		quote: Type.String({ minLength: 1 }),
		rule: Type.String({ minLength: 1 }),
		why: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

// The review no longer travels in the terminal response — the findings are
// already banked — so all it has to do is separate "I finished reviewing" from
// "I stopped". The count is what makes it an assertion rather than a formality:
// a reviewer that has lost track of its own review cannot state it correctly.
const TERMINAL_RESPONSE = Type.Object(
	{
		status: Type.Literal("complete"),
		submitted: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

// Budgets are the runaway guard, not the review plan: a rule owner investigating
// a wide PR legitimately spends dozens of turns, and the first production run hit
// 20 turns while still working. Wall-clock is the real ceiling.
const DEFAULT_LIMITS = {
	maxTurns: 60,
	maxToolCalls: 200,
	maxSubmissionsPerResponse: SUBMISSIONS_PER_RESPONSE,
	timeoutMs: 15 * 60 * 1000,
};

function manifest(changes) {
	const entries = changes.map((change) => {
		const counts =
			Number.isInteger(change.additions) && Number.isInteger(change.deletions)
				? ` +${change.additions}/-${change.deletions}`
				: "";
		const rename = change.oldPath ? ` (from ${change.oldPath})` : "";
		return `${change.status}\t${change.path}${rename}${counts}`;
	});
	return `${changes.length} changed files\n${entries.join("\n")}`;
}

function userPrompt(repository, agent, limits) {
	return `Review the entire pull request against only ${agent.doc}.

You own this rule document across the whole PR. Investigate autonomously: choose which changed files, unchanged context, definitions, callers, tests, and schemas to inspect with the repository tools. Do not assume the changed-file index contains source or diffs. Retrieve evidence on demand. Do not stop after inspecting one file, and do not flag anything outside your assigned rule document.

Changed-file index (${repository.baseSha}..${repository.headSha}):
${manifest(repository.changes)}

Report each violation with a ${SUBMIT_TOOL} call as soon as you are sure of it — one call per violation, at most ${limits.maxSubmissionsPerResponse} calls in any one response. A finding must identify a changed file, an absolute new-file line, an exact quote from that changed line, the violated rule, and why it is a concrete violation. Quote that one line and nothing else — never a block, never surrounding context, at most ${FINDING_LIMITS.quote} characters. Name the rule in at most ${FINDING_LIMITS.rule} characters and defend it in one sentence of at most ${FINDING_LIMITS.why}. Anything longer is cut to those limits before posting, so spend them on evidence rather than restatement.

Every ${SUBMIT_TOOL} result carries the running total recorded for you. A refused call is not recorded: fix what its error names and call again. A finding you already submitted comes back marked duplicate and leaves the total unchanged.

When your investigation is finished, emit one JSON object and nothing else — no preface, no reasoning, no code fence, no trailing remarks:
{"status":"complete","submitted":N}
where N is the running total from your last ${SUBMIT_TOOL} result, or 0 if you submitted nothing. Never claim complete if tool or provider failures prevented a trustworthy review.`;
}

// Whatever a session submitted before it died, it proved. Discarding that to
// signal failure buys no safety — the status stays incomplete, so the required
// check still fails, stale threads are still left alone, and zero findings still
// cannot render as a clean review — and it would delete real review.
function incomplete(agent, reason, findings, details = {}) {
	return {
		agent: agent.id,
		doc: agent.doc,
		status: "incomplete",
		findings,
		reason,
		...details,
	};
}

// Trimmed, never rejected: a verbosely stated violation is still a violation,
// and rejecting it would delete signal to enforce a budget. `quote` is trimmed
// bare because anchoring tests whether the changed line contains it, so an
// appended ellipsis would match nothing; `rule` and `why` only render as prose.
function clamp(text, limit, { ellipsis = false } = {}) {
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	if (!ellipsis) return cut;
	const whole = cut.slice(0, limit - 1).replace(/\s+\S*$/, "");
	return `${whole || cut.slice(0, limit - 1)}…`;
}

// Exact repeats only. A retried turn or a reviewer that loses its place must not
// inflate the running total it reads back, but near-duplicates are the posting
// layer's problem: inline.mjs already merges them across rule owners with
// evidence this boundary does not have.
const submissionKey = (finding) =>
	[
		finding.file,
		finding.line,
		finding.quote.trim(),
		finding.rule.trim().toLowerCase().replace(/\s+/g, " "),
	].join("\0");

// The bank. Every finding enters the review through this one tool call, so this
// is where the boundary lives: Pi checks the arguments against FINDING before
// execute runs, and what survives both is clamped, stamped, and counted.
function createFindingSink(agent, changedPaths) {
	const findings = [];
	const seen = new Set();

	return {
		findings,
		tool: {
			name: SUBMIT_TOOL,
			label: SUBMIT_TOOL,
			description:
				"Record one violation of your rule document. Call it once per violation, as soon as you are sure of it. The result carries the running total recorded for you.",
			parameters: FINDING,
			async execute(_toolCallId, params) {
				if (!changedPaths.has(params.file))
					throw new Error(
						`this finding cites ${params.file}, which this pull request does not change; quote a line from a changed file instead`,
					);
				const finding = {
					...params,
					quote: clamp(params.quote, FINDING_LIMITS.quote),
					rule: clamp(params.rule, FINDING_LIMITS.rule, { ellipsis: true }),
					why: clamp(params.why, FINDING_LIMITS.why, { ellipsis: true }),
					agent: agent.id,
				};
				const key = submissionKey(finding);
				const duplicate = seen.has(key);
				if (!duplicate) {
					seen.add(key);
					findings.push(finding);
				}
				const result = { ok: true, duplicate, submitted: findings.length };
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					details: result,
				};
			},
		},
	};
}

// A reviewer that ends in prose has said neither "I finished" nor "I stopped".
// The bank is already safe and the budgets are shared, so one more ask is either
// the signal or the same failure — never a second chance at the contract.
const TERMINAL_RETRIES = 1;

function retryPrompt(failure) {
	return `That response was not the completion signal. ${failure}

Findings you already submitted are recorded — do not submit them again. Submit with a ${SUBMIT_TOOL} call anything you have proved but not yet submitted, then emit one JSON object and nothing else — no preface, no reasoning, no code fence, no trailing remarks:
{"status":"complete","submitted":N}
where N is the running total from your last ${SUBMIT_TOOL} result, or 0 if you submitted nothing. Never claim complete if tool or provider failures prevented a trustworthy review.`;
}

// The terminal response no longer carries the review, so all it proves is that
// the reviewer knows it finished; the count is what makes that an assertion. A
// tally that disagrees fails safe: banked findings still post, the session is
// still incomplete, the required check still fails.
function terminalCount(value, banked, answer) {
	if (!Value.Check(TERMINAL_RESPONSE, value)) {
		const [first] = [...Value.Errors(TERMINAL_RESPONSE, value)];
		throw new Error(
			`terminal response is not a completion signal: ${first?.path || "/"} ${first?.message ?? "invalid shape"} (${answer})`,
		);
	}
	if (value.submitted !== banked)
		throw new Error(
			`terminal signal claims ${value.submitted} finding(s) submitted, but ${banked} reached the boundary`,
		);
}

// Truncation is the failure this contract exists to catch, and "stopped with
// length" alone cannot tell an enormous answer from a provider ceiling smaller
// than the one we asked for. Report what the provider says it produced against
// what we requested, so the next run answers that question with evidence.
function stopDetail(terminal, model) {
	if (!terminal) return "no assistant response";
	if (terminal.stopReason !== "length") return terminal.stopReason;
	const usage = terminal.usage ?? {};
	const parts = [];
	if (Number.isFinite(usage.output))
		parts.push(`${usage.output} output tokens`);
	if (Number.isFinite(usage.reasoning))
		parts.push(`${usage.reasoning} of them reasoning`);
	parts.push(`ceiling requested ${requestCeiling(model)}`);
	return `length: ${parts.join(", ")}`;
}

function assistantText(message) {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

// Narrating instead of answering, emitting only reasoning, and emitting nothing
// all fail with the same schema error, which names no cause anyone can act on.
// Report the shape of what arrived, bounded so a runaway answer cannot flood the
// CI summary with the review it failed to deliver.
const ANSWER_EXCERPT = 200;

function answerDetail(message) {
	const blocks = message.content.map((block) => block.type);
	const text = assistantText(message);
	const opening = text.replace(/\s+/g, " ").trim().slice(0, ANSWER_EXCERPT);
	return `blocks ${blocks.join("+") || "none"}, ${text.length} chars of text, ${opening ? `starting "${opening}"` : "no text emitted"}`;
}

// Null means the session ended the way the contract requires; anything else is
// the reason it did not, phrased for both the CI summary and the re-ask.
function terminalFailure(terminal, banked, model) {
	if (!terminal || terminal.stopReason !== "stop")
		return `provider stopped with ${stopDetail(terminal, model)}`;
	try {
		terminalCount(
			extractJson(assistantText(terminal)),
			banked,
			answerDetail(terminal),
		);
		return null;
	} catch (error) {
		return error.message;
	}
}

export async function runRuleReviewer({
	agent,
	system,
	repository,
	runtime,
	limits: suppliedLimits = {},
}) {
	const limits = { ...DEFAULT_LIMITS, ...suppliedLimits };
	const changedPaths = new Set(repository.changes.map((change) => change.path));
	const sink = createFindingSink(agent, changedPaths);
	// Keyed by the assistant message that requested the calls, so the count is
	// per response by construction. Pi prepares a response's tool calls in order
	// before executing them, so which submissions land past the cap is settled.
	const submissionsPerResponse = new WeakMap();
	let turns = 0;
	let toolCalls = 0;
	let limitReason;

	const reviewer = new Agent({
		initialState: {
			systemPrompt: system,
			model: runtime.model,
			thinkingLevel: "off",
			tools: [...createRepositoryTools(repository), sink.tool],
		},
		streamFn: runtime.streamFn,
		toolExecution: "parallel",
		beforeToolCall: async ({ assistantMessage, toolCall }) => {
			if (toolCalls > limits.maxToolCalls) {
				limitReason = "tool call budget exhausted";
				return { block: true, reason: limitReason, terminate: true };
			}
			if (toolCall.name !== SUBMIT_TOOL) return undefined;
			// Refused, not fatal: the reviewer is told to re-issue it, and the next
			// response is a fresh allowance. This is the cap RESPONSE_CEILING is
			// derived from, which is why it is enforced rather than merely asked for.
			const used = (submissionsPerResponse.get(assistantMessage) ?? 0) + 1;
			submissionsPerResponse.set(assistantMessage, used);
			if (used <= limits.maxSubmissionsPerResponse) return undefined;
			return {
				block: true,
				reason: `submit at most ${limits.maxSubmissionsPerResponse} findings per response; this one was not recorded — re-issue it in your next response`,
			};
		},
		shouldStopAfterTurn: async ({ message }) => {
			const requestedTools = message.content.some(
				(block) => block.type === "toolCall",
			);
			if (requestedTools && turns >= limits.maxTurns) {
				limitReason = "turn budget exhausted";
				return true;
			}
			return Boolean(limitReason);
		},
	});

	reviewer.subscribe((event) => {
		if (event.type === "turn_start") turns++;
		if (event.type === "tool_execution_start") toolCalls++;
	});

	const timer = setTimeout(() => {
		limitReason = "review timeout exceeded";
		reviewer.abort();
	}, limits.timeoutMs);
	let ask = userPrompt(repository, agent, limits);
	let reasked = 0;
	const spent = () => ({ turns, toolCalls, reasked });
	try {
		while (true) {
			try {
				await reviewer.prompt(ask);
			} catch (error) {
				return incomplete(
					agent,
					String(error?.message ?? error),
					sink.findings,
					spent(),
				);
			}

			if (limitReason)
				return incomplete(agent, limitReason, sink.findings, spent());
			if (reviewer.state.errorMessage)
				return incomplete(
					agent,
					reviewer.state.errorMessage,
					sink.findings,
					spent(),
				);

			const failure = terminalFailure(
				reviewer.state.messages.findLast(
					(message) => message.role === "assistant",
				),
				sink.findings.length,
				runtime.model,
			);
			if (!failure)
				return {
					agent: agent.id,
					doc: agent.doc,
					status: "complete",
					findings: sink.findings,
					...spent(),
				};
			if (reasked++ >= TERMINAL_RETRIES)
				return incomplete(agent, failure, sink.findings, spent());
			ask = retryPrompt(failure);
		}
	} finally {
		clearTimeout(timer);
	}
}

// One session, one line of the run log. `reasked` appears only when the extra
// ask happened, so a clean run stays quiet about a recovery nobody needed and a
// "complete" that took two asks cannot read as a direct one. The reason goes
// last because it is free text and would otherwise swallow the numbers.
export function summaryLine(result) {
	return (
		`${result.agent}: ${result.status}; turns=${result.turns}; tools=${result.toolCalls}; findings=${result.findings.length}` +
		(result.reasked ? `; reasked=${result.reasked}` : "") +
		(result.reason ? `; reason=${result.reason}` : "")
	);
}

async function pool(items, size, fn) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from(
			{ length: Math.min(Math.max(size, 1), items.length) },
			async () => {
				while (next < items.length) {
					const index = next++;
					results[index] = await fn(items[index]);
				}
			},
		),
	);
	return results;
}

export function runRuleReviewers({
	agents,
	systems,
	repository,
	runtime,
	concurrency = agents.length,
	limits,
}) {
	return pool(agents, concurrency, (agent) =>
		runRuleReviewer({
			agent,
			system: systems.get(agent.id),
			repository,
			runtime,
			limits,
		}),
	);
}
