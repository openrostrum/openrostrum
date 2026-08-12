import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { extractJson, FINDING_LIMITS } from "./core.mjs";
import { createRepositoryTools } from "./repository.mjs";

const TERMINAL_RESPONSE = Type.Object(
	{
		status: Type.Literal("complete"),
		findings: Type.Array(
			Type.Object(
				{
					file: Type.String({ minLength: 1 }),
					line: Type.Integer({ minimum: 1 }),
					quote: Type.String({ minLength: 1 }),
					rule: Type.String({ minLength: 1 }),
					why: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

// Budgets are the runaway guard, not the review plan: a rule owner investigating
// a wide PR legitimately spends dozens of turns, and the first production run hit
// 20 turns while still working. Wall-clock is the real ceiling.
const DEFAULT_LIMITS = {
	maxTurns: 60,
	maxToolCalls: 200,
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

function userPrompt(repository, agent) {
	return `Review the entire pull request against only ${agent.doc}.

You own this rule document across the whole PR. Investigate autonomously: choose which changed files, unchanged context, definitions, callers, tests, and schemas to inspect with the repository tools. Do not assume the changed-file index contains source or diffs. Retrieve evidence on demand. Do not stop after inspecting one file, and do not flag anything outside your assigned rule document.

Changed-file index (${repository.baseSha}..${repository.headSha}):
${manifest(repository.changes)}

A finding must identify a changed file, an absolute new-file line, an exact quote from that changed line, the violated rule, and why it is a concrete violation. Quote that one line and nothing else — never a block, never surrounding context, at most ${FINDING_LIMITS.quote} characters. Name the rule in at most ${FINDING_LIMITS.rule} characters and defend it in one sentence of at most ${FINDING_LIMITS.why}. Anything longer is cut to those limits before posting, so spend them on evidence rather than restatement.

When your investigation is finished, emit one JSON object and nothing else — no preface, no reasoning, no code fence, no trailing remarks:
{"status":"complete","findings":[{"file":"path","line":1,"quote":"exact changed line text","rule":"rule from this document","why":"one defensible sentence"}]}
If no violations remain after investigation, return {"status":"complete","findings":[]}. Never claim complete if tool or provider failures prevented a trustworthy review.`;
}

function incomplete(agent, reason, details = {}) {
	return {
		agent: agent.id,
		doc: agent.doc,
		status: "incomplete",
		findings: [],
		reason,
		...details,
	};
}

// An over-long field is trimmed, never rejected: a real violation stated too
// verbosely is still a real violation, and turning it into an incomplete review
// would delete signal to enforce a budget. `quote` is trimmed bare because the
// posting layer anchors by testing whether the changed line contains it — an
// appended ellipsis would break the match — while `rule` and `why` only render
// as comment prose and can show that they were cut.
function clamp(text, limit, { ellipsis = false } = {}) {
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	if (!ellipsis) return cut;
	const whole = cut.slice(0, limit - 1).replace(/\s+\S*$/, "");
	return `${whole || cut.slice(0, limit - 1)}…`;
}

function validateFindings(value, changedPaths, agent, answer) {
	if (!Value.Check(TERMINAL_RESPONSE, value)) {
		const [first] = [...Value.Errors(TERMINAL_RESPONSE, value)];
		throw new Error(
			`terminal response is not a complete review: ${first?.path || "/"} ${first?.message ?? "invalid shape"} (${answer})`,
		);
	}
	return value.findings.map((finding, index) => {
		if (!changedPaths.has(finding.file))
			throw new Error(
				`finding ${index + 1} cites ${finding.file}, which this pull request does not change`,
			);
		return {
			...finding,
			quote: clamp(finding.quote, FINDING_LIMITS.quote),
			rule: clamp(finding.rule, FINDING_LIMITS.rule, { ellipsis: true }),
			why: clamp(finding.why, FINDING_LIMITS.why, { ellipsis: true }),
			agent: agent.id,
		};
	});
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
	if (Number.isFinite(model?.maxTokens))
		parts.push(`ceiling requested ${model.maxTokens}`);
	return parts.length ? `length: ${parts.join(", ")}` : "length";
}

function assistantText(message) {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

// A session that stops normally without the contracted JSON object fails with
// the same schema error whether the model narrated instead of answering, emitted
// only reasoning, or said nothing at all — and that error names no cause anyone
// can act on. Report the shape of what actually arrived, bounded so a runaway
// answer cannot flood the CI summary with the review it failed to deliver.
const ANSWER_EXCERPT = 200;

function answerDetail(message) {
	const blocks = message.content.map((block) => block.type);
	const text = assistantText(message);
	const opening = text.replace(/\s+/g, " ").trim().slice(0, ANSWER_EXCERPT);
	return `blocks ${blocks.join("+") || "none"}, ${text.length} chars of text, ${opening ? `starting "${opening}"` : "no text emitted"}`;
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
	let turns = 0;
	let toolCalls = 0;
	let limitReason;

	const reviewer = new Agent({
		initialState: {
			systemPrompt: system,
			model: runtime.model,
			thinkingLevel: "off",
			tools: createRepositoryTools(repository),
		},
		streamFn: runtime.streamFn,
		toolExecution: "parallel",
		beforeToolCall: async () => {
			if (toolCalls <= limits.maxToolCalls) return undefined;
			limitReason = "tool call budget exhausted";
			return { block: true, reason: limitReason, terminate: true };
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
	try {
		await reviewer.prompt(userPrompt(repository, agent));
	} catch (error) {
		return incomplete(agent, String(error?.message ?? error), {
			turns,
			toolCalls,
		});
	} finally {
		clearTimeout(timer);
	}

	if (limitReason) return incomplete(agent, limitReason, { turns, toolCalls });
	if (reviewer.state.errorMessage)
		return incomplete(agent, reviewer.state.errorMessage, { turns, toolCalls });

	const terminal = reviewer.state.messages.findLast(
		(message) => message.role === "assistant",
	);
	if (!terminal || terminal.stopReason !== "stop")
		return incomplete(
			agent,
			`provider stopped with ${stopDetail(terminal, runtime.model)}`,
			{ turns, toolCalls },
		);

	try {
		const findings = validateFindings(
			extractJson(assistantText(terminal)),
			changedPaths,
			agent,
			answerDetail(terminal),
		);
		return {
			agent: agent.id,
			doc: agent.doc,
			status: "complete",
			findings,
			turns,
			toolCalls,
		};
	} catch (error) {
		return incomplete(agent, error.message, { turns, toolCalls });
	}
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
