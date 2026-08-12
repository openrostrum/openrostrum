import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { runRuleReviewer, runRuleReviewers } from "./agent.mjs";
import { FINDING_LIMITS, loadSystems } from "./core.mjs";
import { anchorFinding } from "./inline.mjs";

const stop = (value) => fauxAssistantMessage(JSON.stringify(value));

const ENGINEERING = { id: "engineering", doc: "docs/rules/engineering.md" };

function promptText(messages) {
	const content = messages[0].content;
	return Array.isArray(content)
		? content.map((block) => block.text ?? "").join("")
		: content;
}

function repository(changes, toolResults = {}) {
	return {
		baseSha: "base123",
		headSha: "head456",
		changes,
		async executeTool(name, args) {
			const result = toolResults[name];
			return typeof result === "function"
				? result(args)
				: (result ?? { ok: false, error: `unknown tool ${name}` });
		},
	};
}

function fauxRuntime(responses) {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(responses);
	return {
		runtime: {
			model: faux.getModel(),
			streamFn: models.streamSimple.bind(models),
		},
		faux,
	};
}

test("starts exactly one Pi agent per discovered rule document", async () => {
	const { agents, systems } = await loadSystems();
	const changes = Array.from({ length: 240 }, (_, index) => ({
		status: "M",
		path: `app/routes/route-${index}.tsx`,
		additions: 3,
		deletions: 1,
	}));
	const contexts = [];
	const { runtime, faux } = fauxRuntime(
		agents.map(() => (context) => {
			contexts.push({ messages: structuredClone(context.messages) });
			return stop({ status: "complete", findings: [] });
		}),
	);

	const results = await runRuleReviewers({
		agents,
		systems,
		repository: repository(changes),
		runtime,
		concurrency: agents.length,
	});

	assert.equal(results.length, agents.length);
	assert.equal(faux.state.callCount, agents.length);
	assert.ok(results.every((result) => result.status === "complete"));
	for (const context of contexts) {
		const content = context.messages[0].content;
		const prompt = Array.isArray(content)
			? content.map((block) => block.text ?? "").join("")
			: content;
		assert.match(prompt, /240 changed files/);
		assert.match(prompt, /route-0\.tsx/);
		assert.match(prompt, /route-239\.tsx/);
		assert.doesNotMatch(prompt, /^diff --git/m);
	}
});

test("Pi keeps one session across model-selected changed and unchanged reads", async () => {
	const contexts = [];
	const executed = [];
	const { runtime } = fauxRuntime([
		(context) => {
			contexts.push({ messages: structuredClone(context.messages) });
			return fauxAssistantMessage(
				[
					fauxToolCall(
						"get_changed_file_diff",
						{ path: "app/changed.ts" },
						{
							id: "diff-call",
						},
					),
					fauxToolCall(
						"read_file",
						{ path: "app/unchanged.ts" },
						{
							id: "read-call",
						},
					),
				],
				{ stopReason: "toolUse" },
			);
		},
		(context) => {
			contexts.push({ messages: structuredClone(context.messages) });
			return stop({
				status: "complete",
				findings: [
					{
						file: "app/changed.ts",
						line: 7,
						quote: "unsafeCall()",
						rule: "Use the safe helper",
						why: "The changed caller bypasses the required helper used by its unchanged callee.",
					},
				],
			});
		},
	]);
	const repo = repository(
		[{ status: "M", path: "app/changed.ts", additions: 1, deletions: 0 }],
		{
			get_changed_file_diff: (args) => {
				executed.push(["get_changed_file_diff", args]);
				return { ok: true, content: "+unsafeCall()" };
			},
			read_file: (args) => {
				executed.push(["read_file", args]);
				return { ok: true, content: "export const safeHelper = () => true;" };
			},
		},
	);

	const result = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repo,
		runtime,
	});

	assert.deepEqual(
		executed,
		[
			["get_changed_file_diff", { path: "app/changed.ts" }],
			["read_file", { path: "app/unchanged.ts" }],
		],
		result.reason,
	);
	assert.equal(contexts.length, 2);
	assert.deepEqual(
		contexts[1].messages
			.filter((message) => message.role === "toolResult")
			.map((message) => message.toolCallId),
		["diff-call", "read-call"],
	);
	assert.equal(result.status, "complete");
	assert.equal(result.findings[0].agent, "engineering");
});

test("a malformed terminal response is incomplete, not a clean review", async () => {
	const { runtime } = fauxRuntime([
		stop({
			status: "complete",
			findings: [
				{
					file: "app/x.ts",
					line: 0,
					quote: "",
					rule: "Some rule",
					why: "Missing a real anchor.",
				},
			],
		}),
	]);

	const result = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /complete review/i);
	assert.deepEqual(result.findings, []);
});

test("a finding outside the pull request is incomplete", async () => {
	const { runtime } = fauxRuntime([
		stop({
			status: "complete",
			findings: [
				{
					file: "app/never-changed.ts",
					line: 4,
					quote: "unsafeCall()",
					rule: "Some rule",
					why: "Cites a file this PR does not change.",
				},
			],
		}),
	]);

	const result = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /does not change/i);
});

// The output budget is what truncated three of five reviewers on a 2700-line
// pull request, so the prompt now states a per-field ceiling. It has to be the
// same ceiling the boundary applies, or reviewers are held to a contract they
// were never given.
test("the finding budget the prompt states is the budget enforced", async () => {
	const contexts = [];
	const { runtime } = fauxRuntime([
		(context) => {
			contexts.push(structuredClone(context.messages));
			return stop({ status: "complete", findings: [] });
		},
	]);

	await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	const prompt = promptText(contexts[0]);
	assert.match(prompt, new RegExp(`at most ${FINDING_LIMITS.quote} char`));
	assert.match(prompt, new RegExp(`at most ${FINDING_LIMITS.rule} char`));
	assert.match(prompt, new RegExp(`at most ${FINDING_LIMITS.why}\\b`));
});

// Trimming, not rejecting: a verbose statement of a real violation is still a
// real violation, and the posted comment only needs the cited line.
test("an over-long finding is trimmed to the budget and still anchors", async () => {
	const changedLine = `const value = compute(${"argument".repeat(50)});`;
	const { runtime } = fauxRuntime([
		stop({
			status: "complete",
			findings: [
				{
					file: "app/x.ts",
					line: 12,
					quote: changedLine,
					rule: `Rule${"-restated".repeat(40)}`,
					why: `This line ${"repeats itself ".repeat(40)}unnecessarily.`,
				},
			],
		}),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	const [finding] = result.findings;
	// The posting layer anchors by testing whether the cited changed line
	// contains the quote, so a trimmed quote must stay a literal substring of
	// it — an elided one anchors nowhere and demotes to a file-level comment.
	assert.equal(
		anchorFinding(
			finding,
			[{ line: 12, added: true, text: changedLine }],
			null,
		),
		12,
	);
	assert.equal(finding.quote.length, FINDING_LIMITS.quote);
	assert.ok(finding.rule.length <= FINDING_LIMITS.rule);
	assert.ok(finding.why.length <= FINDING_LIMITS.why);
	assert.ok(finding.rule.endsWith("…"));
	assert.ok(finding.why.endsWith("…"));
});

// The faux provider estimates usage from the text it emits, but a truncation
// diagnostic reports what the provider claims it produced — replace the
// reported usage on the way out and leave the rest of the stream alone.
function withUsage(runtime, usage) {
	return {
		...runtime,
		streamFn(model, context, options) {
			const stream = runtime.streamFn(model, context, options);
			return {
				[Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
				result: async () => ({ ...(await stream.result()), usage }),
			};
		},
	};
}

// "provider stopped with length" cannot distinguish an enormous answer from a
// provider ceiling below the one we asked for; the numbers can.
test("a truncated answer reports its size against the ceiling requested", async () => {
	const { runtime } = fauxRuntime([
		fauxAssistantMessage('{"status":"complete","findings":[', {
			stopReason: "length",
		}),
	]);
	const measured = withUsage(runtime, {
		input: 40_000,
		output: 8192,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 48_192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	measured.model = { ...runtime.model, maxTokens: 262_144 };

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime: measured,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /length/);
	assert.match(result.reason, /8192 output tokens/);
	assert.match(result.reason, /0 of them reasoning/);
	assert.match(result.reason, /ceiling requested 262144/);
});

test("provider failure and turn exhaustion are incomplete", async () => {
	const failedRuntime = fauxRuntime([
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "provider unavailable",
		}),
	]).runtime;
	const failed = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime: failedRuntime,
	});
	assert.equal(failed.status, "incomplete");
	assert.match(failed.reason, /provider unavailable/);

	const { runtime } = fauxRuntime([
		fauxAssistantMessage(
			fauxToolCall("list_repository", {}, { id: "call-1" }),
			{
				stopReason: "toolUse",
			},
		),
		fauxAssistantMessage(
			fauxToolCall("list_repository", {}, { id: "call-2" }),
			{
				stopReason: "toolUse",
			},
		),
	]);
	const exhausted = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }], {
			list_repository: { ok: true, paths: [] },
		}),
		runtime,
		limits: { maxTurns: 2, maxToolCalls: 10, timeoutMs: 10_000 },
	});
	assert.equal(exhausted.status, "incomplete");
	assert.match(exhausted.reason, /turn budget/i);
});
