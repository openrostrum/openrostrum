import { Agent } from "@earendil-works/pi-agent-core";
import { extractJson } from "./core.mjs";
import { createRepositoryTools } from "./repository.mjs";

const DEFAULT_LIMITS = {
	maxTurns: 20,
	maxToolCalls: 80,
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

A finding must identify a changed file, an absolute new-file line, an exact quote from that changed line, the violated rule, and why it is a concrete violation. Return only JSON in this shape when your investigation is finished:
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

function validateFindings(value, changedPaths, agent) {
	if (value?.status !== "complete" || !Array.isArray(value.findings))
		throw new Error("terminal response did not declare a complete review");
	return value.findings.map((finding, index) => {
		if (
			typeof finding?.file !== "string" ||
			!changedPaths.has(finding.file) ||
			!Number.isInteger(finding.line) ||
			finding.line < 1 ||
			typeof finding.quote !== "string" ||
			!finding.quote.trim() ||
			typeof finding.rule !== "string" ||
			!finding.rule.trim() ||
			typeof finding.why !== "string" ||
			!finding.why.trim()
		)
			throw new Error(`invalid finding ${index + 1}`);
		return {
			file: finding.file,
			line: finding.line,
			quote: finding.quote,
			rule: finding.rule,
			why: finding.why,
			agent: agent.id,
		};
	});
}

function assistantText(message) {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
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
			`provider stopped with ${terminal?.stopReason ?? "no assistant response"}`,
			{ turns, toolCalls },
		);

	try {
		const findings = validateFindings(
			extractJson(assistantText(terminal)),
			changedPaths,
			agent,
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
