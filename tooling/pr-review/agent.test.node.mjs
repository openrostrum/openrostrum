import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { runRuleReviewer, runRuleReviewers } from "./agent.mjs";
import { loadSystems } from "./core.mjs";

const stop = (value) => fauxAssistantMessage(JSON.stringify(value));

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
