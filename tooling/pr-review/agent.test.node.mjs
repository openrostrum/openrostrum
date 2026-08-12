import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { runRuleReviewer, runRuleReviewers, summaryLine } from "./agent.mjs";
import {
	FINDING_LIMITS,
	loadSystems,
	SUBMISSIONS_PER_RESPONSE,
} from "./core.mjs";
import { anchorFinding } from "./inline.mjs";

const stop = (value) => fauxAssistantMessage(JSON.stringify(value));

const ENGINEERING = { id: "engineering", doc: "docs/rules/engineering.md" };

// One submitted finding, one response's worth of submissions, and the terminal
// completion signal — the three moves the incremental contract is made of.
const submit = (finding, id) => fauxToolCall("submit_finding", finding, { id });
const submits = (findings, tag) =>
	fauxAssistantMessage(
		findings.map((finding, index) => submit(finding, `${tag}-${index}`)),
		{ stopReason: "toolUse" },
	);
const done = (submitted) =>
	fauxAssistantMessage([fauxToolCall("finish_review", { submitted })], {
		stopReason: "toolUse",
	});

// A missing signal is asked for once more, so a reviewer that fails the same way
// to the end needs the same response queued for both asks.
const twice = (response) => [response, response];

const toolResultTexts = (messages) =>
	messages
		.filter((message) => message.role === "toolResult")
		.map((message) =>
			(Array.isArray(message.content) ? message.content : [])
				.map((block) => block.text ?? "")
				.join(""),
		);

const violation = (index) => ({
	file: `app/f${index % 3}.ts`,
	line: index + 1,
	quote: `unsafeCall(${index})`,
	rule: `Rule ${index}`,
	why: `Call ${index} bypasses the helper this document requires.`,
});

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
			return done(0);
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
			return submits(
				[
					{
						file: "app/changed.ts",
						line: 7,
						quote: "unsafeCall()",
						rule: "Use the safe helper",
						why: "The changed caller bypasses the required helper used by its unchanged callee.",
					},
				],
				"finding",
			);
		},
		(context) => {
			contexts.push({ messages: structuredClone(context.messages) });
			return done(1);
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
	assert.equal(contexts.length, 3);
	assert.deepEqual(
		contexts[1].messages
			.filter((message) => message.role === "toolResult")
			.map((message) => message.toolCallId),
		["diff-call", "read-call"],
	);
	assert.equal(result.status, "complete");
	assert.equal(result.findings[0].agent, "engineering");
});

// The overflow this contract lost to was prose: DeepSeek caps a completion at
// 8192 output tokens whatever ceiling is requested, and one reviewer spent a
// whole response on commentary by its fifth turn without reaching a finding.
// Instructions did not stop it, so the request leaves it no other channel.
test("every request forces the response to be tool calls", async () => {
	const choices = [];
	const { runtime } = fauxRuntime([submits([violation(0)], "a"), done(1)]);
	const observed = {
		...runtime,
		streamFn: (model, context, options) => {
			choices.push(options?.toolChoice);
			return runtime.streamFn(model, context, options);
		},
	};

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime: observed,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.ok(
		choices.length >= 2,
		`expected several requests, saw ${choices.length}`,
	);
	assert.deepEqual(
		[...new Set(choices)],
		["required"],
		"a request that leaves tool choice open lets the model answer in prose",
	);
});

test("closing the review ends the session without another request", async () => {
	const { runtime, faux } = fauxRuntime([
		submits([violation(0)], "a"),
		done(1),
		submits([violation(1)], "after-close"),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1);
	assert.equal(
		faux.state.callCount,
		2,
		"finish_review must stop the loop, not hand the model another turn",
	);
});

test("a close that miscounts the bank is incomplete and keeps the findings", async () => {
	const { runtime } = fauxRuntime(twice(done(7)));

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /claimed 7 finding\(s\).*but 0 reached/);
});

// A reviewer that answers with a review-shaped object instead of closing has
// submitted nothing, so reading it as a clean review would post "no issues
// found" on a pull request nobody reviewed.
test("a terminal response that is not the completion signal is incomplete, not a clean review", async () => {
	const { runtime } = fauxRuntime(
		twice(
			stop({
				status: "complete",
				findings: [
					{
						file: "app/x.ts",
						line: 4,
						quote: "unsafeCall()",
						rule: "Some rule",
						why: "Reported in the answer instead of submitted.",
					},
				],
			}),
		),
	);

	const result = await runRuleReviewer({
		agent: { id: "engineering", doc: "docs/rules/engineering.md" },
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /never closed/i);
	assert.deepEqual(result.findings, []);
});

// Narrating instead of answering, answering with reasoning only, and answering
// with nothing all reach the boundary as the same schema error. Production has
// hit this on four separate runs, and the reason has to say which one it was.
test("an unparseable terminal answer names what the model emitted", async () => {
	const narration = "I checked every changed file and found no violations.";
	const { runtime } = fauxRuntime(twice(fauxAssistantMessage(narration)));

	const narrated = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime,
	});

	assert.equal(narrated.status, "incomplete");
	assert.match(narrated.reason, /never closed with finish_review/);
	assert.match(narrated.reason, /blocks text/);
	assert.match(
		narrated.reason,
		new RegExp(`${narration.length} chars of text`),
	);
	assert.match(narrated.reason, /starting "I checked every changed file/);

	const silent = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository([{ status: "M", path: "app/x.ts" }]),
		runtime: fauxRuntime(twice(fauxAssistantMessage(""))).runtime,
	});

	assert.equal(silent.status, "incomplete");
	assert.match(silent.reason, /0 chars of text, no text emitted/);
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
			return done(0);
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
		submits(
			[
				{
					file: "app/x.ts",
					line: 12,
					quote: changedLine,
					rule: `Rule${"-restated".repeat(40)}`,
					why: `This line ${"repeats itself ".repeat(40)}unnecessarily.`,
				},
			],
			"long",
		),
		done(1),
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
	const { runtime } = fauxRuntime(
		twice(fauxAssistantMessage('{"status":"comp', { stopReason: "length" })),
	);
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
	// The diagnostic must report what was actually asked for: a run that stops
	// short of the ceiling it requested is a different bug from one that reaches
	// it, and confusing the two is what sent three runs chasing 8192.
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

	// Enough responses to outlast the close allowance too: a reviewer that ignores
	// the ask to close is the case that still has to fail.
	const { runtime } = fauxRuntime(
		Array.from({ length: 16 }, (_, index) =>
			fauxAssistantMessage(
				fauxToolCall("list_repository", {}, { id: `call-${index}` }),
				{ stopReason: "toolUse" },
			),
		),
	);
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
	assert.equal(exhausted.closing, true, "the close was never asked for");
});

// ---------------------------------------------------------------------------
// Incremental submission
// ---------------------------------------------------------------------------

const THREE_FILES = Array.from({ length: 3 }, (_, index) => ({
	status: "M",
	path: `app/f${index}.ts`,
	additions: 5,
	deletions: 0,
}));

// The defect this contract replaces: one terminal JSON had to carry every
// finding, so a large review was truncated at the provider's completion cap and
// discarded whole. No response carries the review now — see README.
test("a reviewer reports many findings without any response carrying them all", async () => {
	const findings = Array.from({ length: 24 }, (_, index) => violation(index));
	const { runtime, faux } = fauxRuntime([
		submits(findings.slice(0, 10), "a"),
		submits(findings.slice(10, 20), "b"),
		submits(findings.slice(20), "c"),
		done(24),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
		limits: { maxSubmissionsPerResponse: 10 },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 24);
	assert.deepEqual(
		result.findings.map((finding) => finding.quote),
		findings.map((finding) => finding.quote),
	);
	assert.ok(
		result.findings.every((finding) => finding.agent === "engineering"),
	);
	// The whole point: 24 findings arrived over three capped responses and a
	// close that carries one integer, so no response ever held the review.
	assert.equal(faux.state.callCount, 4);
});

// A session that dies mid-review has already proved whatever it submitted.
// Discarding that evidence to signal failure throws away real review for no
// safety gain: the session is still reported incomplete, so the required check
// still fails, stale threads are still left alone, and "no issues found" is
// still impossible. Only the findings survive.
test("findings banked before a session dies still post, and the session still fails", async () => {
	const { runtime } = fauxRuntime([
		submits([violation(0), violation(1)], "a"),
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "provider unavailable",
		}),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /provider unavailable/);
	assert.equal(result.findings.length, 2);
	assert.ok(
		result.findings.every((finding) => finding.agent === "engineering"),
	);
});

// Reaching the last turn without the completion signal is the case the contract
// exists for: the reviewer stopped, it did not finish. Its banked findings post
// and it is still not a clean review.
test("a session that never reaches the terminal signal is incomplete with its findings", async () => {
	const { runtime } = fauxRuntime([
		submits([violation(0)], "a"),
		submits([violation(1)], "b"),
		// Keeps submitting through the close ask instead of calling finish_review.
		...Array.from({ length: 14 }, (_, index) =>
			submits([violation(index + 2)], `more-${index}`),
		),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
		limits: { maxTurns: 2, maxToolCalls: 40, timeoutMs: 10_000 },
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /turn budget/i);
	assert.ok(
		result.findings.length >= 2,
		"findings banked before and during the close must survive",
	);
});

// Retries and re-reports are normal agent behaviour. The exact-duplicate guard
// belongs at submission because the running total the reviewer reads back has to
// be true; near-duplicates stay the posting layer's job.
test("submitting the same finding twice records it once", async () => {
	const repeated = violation(0);
	const seen = [];
	const { runtime } = fauxRuntime([
		submits([repeated], "a"),
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return submits([repeated], "b");
		},
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return done(1);
		},
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1);
	const [afterFirst, afterSecond] = seen;
	assert.match(afterFirst.at(-1), /"submitted":1/);
	assert.match(afterSecond.at(-1), /"duplicate":true/);
	assert.match(afterSecond.at(-1), /"submitted":1/);
});

// Still rejected, but rejected per submission rather than by voiding the whole
// review: the reviewer is told what it got wrong and can submit a real finding
// in its place, and everything it proved beforehand survives.
test("a finding citing a file the pull request does not change is refused, not banked", async () => {
	const outside = { ...violation(0), file: "app/never-changed.ts" };
	const seen = [];
	const { runtime } = fauxRuntime([
		submits([outside, violation(1)], "a"),
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return done(1);
		},
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1);
	assert.equal(result.findings[0].file, "app/f1.ts");
	assert.ok(
		seen[0].some((text) => /does not change/.test(text)),
		`no rejection reached the model: ${JSON.stringify(seen[0])}`,
	);
});

// Production reviewers submit their own checklist: "no shadcn import; no
// violation", "no design-system violation is established" — posted as inline
// comments telling a human nothing was wrong. Three prompts already say a
// cleared file is not part of the review, and it still happens on sessions that
// close voluntarily, so the boundary refuses it instead of asking again.
test("a submission that reports compliance rather than a violation is refused", async () => {
	const cleared = {
		...violation(0),
		why: "timezone-select composes Field and Select from ~/ui; no violation.",
	};
	const seen = [];
	const { runtime } = fauxRuntime([
		submits([cleared, violation(1)], "a"),
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return done(1);
		},
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1, "the compliance note was banked");
	assert.equal(result.findings[0].file, "app/f1.ts");
	assert.ok(
		seen[0].some((text) => /not a finding/.test(text)),
		`no refusal reached the model: ${JSON.stringify(seen[0])}`,
	);
});

// The guard keys on a reviewer clearing its own subject, so it must not fire on
// a finding whose sentence merely contains a negation — the reason a broad
// phrase match was the wrong instrument.
test("a real finding that names a missing guard is not mistaken for compliance", async () => {
	const real = {
		...violation(0),
		rule: "Bounded loaders",
		why: "The loader has no limit, so no cap violation is caught before a large event times the page out.",
	};
	const { runtime } = fauxRuntime([submits([real], "a"), done(1)]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(
		result.findings.length,
		1,
		"a real finding was refused as a compliance note",
	);
});

// Every field is validated at the submission boundary, so a finding that cannot
// anchor never enters the bank — and the reviewer hears about it in time to fix it.
test("a submission that fails the finding schema is refused, not banked", async () => {
	const seen = [];
	const { runtime } = fauxRuntime([
		submits([{ ...violation(0), line: 0 }], "a"),
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return done(0);
		},
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.deepEqual(result.findings, []);
	assert.ok(
		seen[0].some((text) => /line/i.test(text)),
		`no schema rejection reached the model: ${JSON.stringify(seen[0])}`,
	);
});

// The completion signal has to mean "I finished", not "I emitted a JSON object".
// A count that disagrees with the bank means the reviewer lost track of its own
// review, which is exactly the state the fail-closed contract must not bless.
test("a terminal count that disagrees with what was submitted is incomplete", async () => {
	const { runtime } = fauxRuntime([
		submits([violation(0), violation(1)], "a"),
		...twice(done(5)),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /5/);
	assert.match(result.reason, /2/);
	assert.equal(result.findings.length, 2);
});

// The per-response cap is what makes the requested output ceiling an honest
// number rather than a guess: a response can only ever hold this many findings,
// and the rest are re-issued on the next turn instead of being lost.
test("submissions past the per-response cap are refused and can be re-issued", async () => {
	const seen = [];
	const { runtime } = fauxRuntime([
		submits([violation(0), violation(1), violation(2)], "a"),
		(context) => {
			seen.push(toolResultTexts(context.messages));
			return submits([violation(2)], "b");
		},
		() => done(3),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
		limits: { maxSubmissionsPerResponse: 2 },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 3);
	const refused = seen[0].filter((text) => !/"ok":true/.test(text));
	assert.equal(refused.length, 1, JSON.stringify(seen[0]));
	// The refusal has to name the cap actually in force. Told "at most 10" under a
	// cap of 2, a reviewer re-issues into the same refusal forever.
	assert.match(refused[0], /\b2\b/);
});

// ---------------------------------------------------------------------------
// The terminal signal
// ---------------------------------------------------------------------------

const userTexts = (messages) =>
	messages
		.filter((message) => message.role === "user")
		.map((message) =>
			Array.isArray(message.content)
				? message.content.map((block) => block.text ?? "").join("")
				: message.content,
		);

// A reviewer that ends in reasoning has said neither "I finished" nor "I stopped",
// so discarding the session throws a proved review away over a formatting miss
// that one more ask recovers.
test("a reviewer that ends in prose is asked once more for the signal", async () => {
	const contexts = [];
	const { runtime, faux } = fauxRuntime([
		fauxAssistantMessage("Let me weigh whether this comment runs five lines."),
		(context) => {
			contexts.push(structuredClone(context.messages));
			return submits([violation(0)], "reask");
		},
		done(1),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1);
	assert.equal(faux.state.callCount, 3);
	// The re-ask has to carry the contract, not just repeat the complaint: the
	// signal's exact shape, and that banked findings must not be sent again.
	const reask = userTexts(contexts[0]).at(-1);
	assert.match(reask, /do not submit them again/i);
	assert.match(reask, /call finish_review with the running total/i);
});

// A recovery nobody can see is a recovery nobody can trust: "complete" alone
// cannot say whether a session got there first time or needed the extra ask, and
// an unexercised recovery must not be reported as a working one.
test("a session reports whether it needed the extra ask", async () => {
	const session = (responses) =>
		runRuleReviewer({
			agent: ENGINEERING,
			system: "SYSTEM RULE",
			repository: repository(THREE_FILES),
			runtime: fauxRuntime(responses).runtime,
		});

	const direct = await session([done(0)]);
	assert.equal(direct.status, "complete", direct.reason);
	assert.equal(direct.reasked, 0);

	const recovered = await session([
		fauxAssistantMessage("An essay where the signal belongs."),
		done(0),
	]);
	assert.equal(recovered.status, "complete", recovered.reason);
	assert.equal(recovered.reasked, 1);
});

// One chance to say which it was, not an escape from the contract.
test("a reviewer that misses the signal twice is incomplete", async () => {
	const { runtime, faux } = fauxRuntime([
		fauxAssistantMessage("First essay about the diff."),
		fauxAssistantMessage("Second essay, still not the signal."),
		done(0),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /Second essay/);
	// The third response is queued to prove it is never reached.
	assert.equal(faux.state.callCount, 2);
	assert.deepEqual(result.findings, []);
});

// The re-ask must not cost a reviewer the review it already banked.
test("findings banked before a missed signal survive the re-ask", async () => {
	const { runtime, faux } = fauxRuntime([
		submits([violation(0), violation(1)], "a"),
		fauxAssistantMessage("Here is a summary of what I found."),
		fauxAssistantMessage("Here is that summary again."),
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
	});

	assert.equal(result.status, "incomplete");
	assert.equal(faux.state.callCount, 3);
	assert.equal(result.findings.length, 2);
	assert.match(result.reason, /that summary again/);
});

// A counter nobody can read answers nothing. The run log is the only place the
// recovery is observable, and a reason that swallows the rest of the line is how
// a run stops reporting the numbers before it.
test("the run summary reports a re-ask only when there was one", () => {
	const session = {
		agent: "engineering",
		findings: [violation(0)],
		turns: 4,
		toolCalls: 7,
	};

	const direct = summaryLine({ ...session, status: "complete", reasked: 0 });
	assert.doesNotMatch(direct, /reasked/);

	const recovered = summaryLine({ ...session, status: "complete", reasked: 1 });
	assert.match(recovered, /reasked=1/);

	const failed = summaryLine({
		...session,
		status: "incomplete",
		reasked: 1,
		reason: "terminated",
	});
	assert.match(failed, /reasked=1;.*reason=terminated$/);
});

// Forcing tool calls removed the model's way of saying "done", so a reviewer that
// keeps reading spends its whole budget and the review is lost. The budget is
// spent on investigation, so reaching it asks for the close instead of failing.
test("a reviewer still reading at its budget is asked to close, and does", async () => {
	const reading = () =>
		fauxAssistantMessage(
			[
				fauxToolCall("read_file", {
					path: "app/f0.ts",
					start_line: 1,
					end_line: 5,
				}),
			],
			{ stopReason: "toolUse" },
		);
	const contexts = [];
	const { runtime } = fauxRuntime([
		submits([violation(0)], "found"),
		reading(),
		reading(),
		reading(),
		(context) => {
			contexts.push(structuredClone(context.messages));
			return done(1);
		},
	]);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES, {
			read_file: () => ({ ok: true, content: "1: export const value = 1;" }),
		}),
		runtime,
		limits: { maxTurns: 4 },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.findings.length, 1);
	assert.equal(result.closing, true, "the close was never asked for");
	// The ask has to end the investigation, not merely repeat the contract, and it
	// must tell the reviewer what is already banked so it does not resubmit.
	const close = userTexts(contexts[0]).at(-1);
	assert.match(close, /investigation is over/i);
	assert.match(close, /read nothing further/i);
	assert.match(close, /1 finding\(s\) are recorded/);
	// Production reviewers submitted one finding per closing turn and ran out of
	// turns with findings still unsent — every failing session banked exactly as
	// many findings as it had closing turns. The ask has to carry the allowance,
	// or the drip rate decides how much of the review survives.
	assert.match(close, new RegExp(`${SUBMISSIONS_PER_RESPONSE} `));
	// "Submit anything you have proved" read as including proved-compliant: asked
	// to empty its notes, a closing reviewer submitted its per-rule checklist, so
	// 4 of 7 findings on one production PR were sentences ending "no violation".
	// The ask has to name violations and exclude the rules it cleared.
	assert.match(close, /violation/i);
	assert.match(close, /satisfied|cleared/i);
	assert.doesNotMatch(
		close,
		/submit .{0,20}anything/i,
		"the closing ask still invites everything the reviewer has, not its violations",
	);
});

// Telling a reviewer to stop reading was not enough in production — four of five
// kept reading and spent the close allowance too. The repository tools have to be
// gone, so submitting and closing are the only calls it can still make.
test("the closing request offers no way to keep reading", async () => {
	const reading = (id) =>
		fauxAssistantMessage(
			[
				fauxToolCall(
					"read_file",
					{ path: "app/f0.ts", start_line: 1, end_line: 5 },
					{ id },
				),
			],
			{ stopReason: "toolUse" },
		);
	const offered = [];
	const { runtime } = fauxRuntime([
		reading("r1"),
		reading("r2"),
		reading("r3"),
		done(0),
	]);
	const watched = {
		...runtime,
		streamFn: (model, context, options) => {
			offered.push((context.tools ?? []).map((tool) => tool.name).sort());
			return runtime.streamFn(model, context, options);
		},
	};

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES, {
			read_file: () => ({ ok: true, content: "1: export const value = 1;" }),
		}),
		runtime: watched,
		limits: { maxTurns: 3 },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.ok(
		offered[0].includes("read_file"),
		`investigation must start with the repository tools, got ${offered[0]}`,
	);
	assert.deepEqual(
		offered.at(-1),
		["finish_review", "submit_finding"],
		"the closing request still offered a way to keep reading",
	);
});

// Taking the repository tools away was still not enough: on a 25-file PR four of
// five sessions spent the whole close allowance submitting and never closed, so
// reviews that had already done the work were reported incomplete and the
// required check failed on them. Asking cannot win against a reviewer that
// always has one more finding — submitting has to run out first, leaving the
// close as the only call the session can still make.
test("a reviewer that submits through the close allowance is left only the close", async () => {
	const offered = [];
	const asks = [];
	// A reviewer that submits whenever submitting is possible, and closes only
	// when it is not — a provider can only call the tools it was offered, so this
	// is the shape that tells an enforced close from a requested one.
	const { runtime } = fauxRuntime(
		Array.from({ length: 20 }, (_, index) => (context) => {
			const names = (context.tools ?? []).map((tool) => tool.name);
			if (names.length > 1) return submits([violation(index)], `s${index}`);
			asks.push(userTexts(context.messages).at(-1));
			// The reviewer states the total the ask names, which is what makes a
			// forced close an assertion rather than a formality.
			return done(Number(asks.at(-1).match(/(\d+) finding/)[1]));
		}),
	);
	const watched = {
		...runtime,
		streamFn: (model, context, options) => {
			offered.push((context.tools ?? []).map((tool) => tool.name).sort());
			return runtime.streamFn(model, context, options);
		},
	};

	const INVESTIGATION = 2;
	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime: watched,
		limits: { maxTurns: INVESTIGATION },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(result.forced, true, "the close was not recorded as forced");
	assert.deepEqual(
		offered.at(-1),
		["finish_review"],
		"the session ended still offering something to do other than close",
	);
	// The oracle is the investigation budget it was given, not this fixture's
	// length: submitting past that budget is the close allowance being spent, and
	// without it the assertions above would also hold for a reviewer that closed
	// on its first turn having proved nothing.
	assert.ok(
		result.findings.length > INVESTIGATION,
		`expected submissions past the investigation budget, got ${result.findings.length}`,
	);
	// Every finding it managed to submit is still banked: the close is forced to
	// end the session, not to cut the review short of what it proved.
	assert.equal(result.findings.length, offered.length - 1);
	assert.match(asks.at(-1), /only call/i);
	assert.match(asks.at(-1), new RegExp(`${result.findings.length} finding`));
});

// Closing on the last turn of the allowance is a volunteered close, and the
// session has to be read that way: the turn budget and the close land in the
// same response, so a loop that reads the budget first drags a reviewer that did
// exactly what it was asked into the forced stage and re-asks for a close it has
// already made.
test("a close that lands on the last allowed turn is taken, not overridden", async () => {
	const CLOSING = 10;
	let requests = 0;
	const { runtime } = fauxRuntime(
		Array.from({ length: CLOSING + 4 }, (_, index) => () => {
			requests++;
			const finding = violation(index);
			// The last turn the allowance permits: submit and close together.
			return requests < CLOSING
				? submits([finding], `s${index}`)
				: fauxAssistantMessage(
						[
							submit(finding, `s${index}`),
							fauxToolCall("finish_review", { submitted: requests }),
						],
						{ stopReason: "toolUse" },
					);
		}),
	);

	const result = await runRuleReviewer({
		agent: ENGINEERING,
		system: "SYSTEM RULE",
		repository: repository(THREE_FILES),
		runtime,
		limits: { maxTurns: 2 },
	});

	assert.equal(result.status, "complete", result.reason);
	assert.equal(
		result.forced,
		false,
		"a reviewer that closed when asked was reported as having been forced",
	);
	assert.equal(result.findings.length, CLOSING);
});

// A forced close is a weaker claim than a volunteered one — the reviewer never
// said it was finished, it ran out of anything else to do. A run summary that
// cannot tell the two apart hides how often the reviewers actually converge.
test("the run summary says when the close had to be forced", () => {
	const session = {
		agent: "engineering",
		status: "complete",
		turns: 12,
		toolCalls: 30,
		findings: [violation(0)],
	};
	assert.doesNotMatch(summaryLine(session), /forced/);
	// Position, not presence: the numbers have to stay readable, so `forced` sits
	// with the other markers ahead of the free-text reason rather than after it.
	assert.match(
		summaryLine({
			...session,
			status: "incomplete",
			reasked: 1,
			forced: true,
			reason: "terminated",
		}),
		/reasked=1; forced; reason=terminated$/,
	);
});
