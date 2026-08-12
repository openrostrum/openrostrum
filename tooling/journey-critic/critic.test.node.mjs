import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	Type,
} from "@earendil-works/pi-ai";
import {
	extractJson,
	journeyPrompt,
	runJourney,
	wrapPrompt,
} from "./critic.mjs";

const journey = {
	id: "organizer-first-run",
	title: "Organizer, first run",
	produces: ["cfpUrl"],
};

const finding = {
	title: "Onboarding demands six fields before anything happens",
	kind: "momentum",
	severity: "blocker",
	url: "/onboarding",
	evidence: ["shot-01"],
	expected:
		"somewhere to start naming the conference and come back to the rest",
	actual: "six required fields, three of which are decisions she has not made",
	cost: "she closes the tab and renews the tool she already pays for",
	abandonment: 8,
};

const report = {
	status: "complete",
	outcome: "abandoned",
	narrative:
		"I signed up, hit a form demanding dates I have not agreed with my venue, and stopped there because none of it could wait until later.",
	toll: [],
	findings: [finding],
	handoff: { cfpUrl: null },
};

const stop = (value) =>
	fauxAssistantMessage(
		typeof value === "string" ? value : JSON.stringify(value),
	);

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

function fauxSession() {
	const shots = [];
	const tools = [
		{
			name: "look",
			label: "look",
			description: "screenshot the page",
			parameters: Type.Object({}),
			async execute() {
				const id = `shot-${String(shots.length + 1).padStart(2, "0")}`;
				shots.push({ id, file: `${id}-page.jpg` });
				return { content: [{ type: "text", text: `screenshot: ${id}` }] };
			},
		},
	];
	return { tools, shots, blocked: [], close: async () => {} };
}

const run = (responses, overrides = {}) => {
	const { runtime } = fauxRuntime(responses);
	return runJourney({
		journey,
		entry: "https://openrostrum.com/",
		brief: "You are Priya Raman.",
		charter: "You are a demanding product lead.",
		session: fauxSession(),
		runtime,
		...overrides,
	});
};

const look = () =>
	fauxAssistantMessage(fauxToolCall("look", {}, { id: "call-1" }), {
		stopReason: "toolUse",
	});

test("a walked journey that reports evidenced findings completes", async () => {
	const result = await run([look(), stop(report)]);
	assert.equal(result.status, "complete");
	assert.equal(result.outcome, "abandoned");
	assert.equal(result.findings.length, 1);
	assert.equal(result.findings[0].journey, "organizer-first-run");
	assert.deepEqual(result.handoff, { cfpUrl: null });
	assert.equal(result.shots.length, 1);
});

test("a finding citing a screenshot the journey never took is incomplete, not reported", async () => {
	const invented = stop({
		...report,
		findings: [{ ...finding, evidence: ["shot-09"] }],
	});
	const result = await run([look(), invented, invented]);
	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /shot-09/);
	assert.deepEqual(result.findings, []);
});

test("a dropped field is asked for back rather than discarding a walked journey", async () => {
	const { abandonment: _dropped, ...incomplete } = finding;
	const prompts = [];
	const { runtime } = fauxRuntime([
		look(),
		stop({ ...report, findings: [incomplete] }),
		(context) => {
			prompts.push(context.messages.at(-1));
			return stop(report);
		},
	]);
	const result = await runJourney({
		journey,
		entry: "https://openrostrum.com/",
		brief: "You are Priya Raman.",
		charter: "You are a demanding product lead.",
		session: fauxSession(),
		runtime,
	});
	assert.equal(result.status, "complete");
	assert.equal(result.findings.length, 1);
	assert.equal(result.findings[0].abandonment, 8);
	assert.match(JSON.stringify(prompts.at(-1)), /abandonment/);
	assert.match(
		JSON.stringify(prompts.at(-1)),
		/formatting fix, not a second opinion/,
	);
});

test("a provider failure is incomplete, never a clean run", async () => {
	const { runtime, faux } = fauxRuntime([
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "provider unavailable",
		}),
		stop(report),
	]);
	const result = await runJourney({
		journey,
		entry: "https://openrostrum.com/",
		brief: "You are Priya Raman.",
		charter: "You are a demanding product lead.",
		session: fauxSession(),
		runtime,
	});
	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /provider unavailable/);
	assert.deepEqual(result.findings, []);
	// A dead provider is not a formatting problem: the repair round must not fire
	// and turn a failed run into a clean one.
	assert.equal(faux.getPendingResponseCount(), 1);
});

test("a truncated or malformed terminal answer is incomplete", async () => {
	const prose = stop("I got stuck at the signup page, sorry.");
	const malformed = await run([prose, prose]);
	assert.equal(malformed.status, "incomplete");

	const invented = stop({
		...report,
		findings: [{ ...finding, severity: "critical" }],
	});
	const wrongShape = await run([invented, invented]);
	assert.equal(wrongShape.status, "incomplete");
	assert.match(wrongShape.reason, /not a completed journey/);
});

test("a journey that says it could not finish is not recorded as finished", async () => {
	const gaveUp = stop({
		status: "incomplete",
		reason: "the signup form never responded",
	});
	const result = await run([gaveUp, gaveUp]);
	assert.equal(result.status, "incomplete");
	assert.deepEqual(result.findings, []);
});

test("a journey stopped by the turn budget still reports what it walked, and says it was cut short", async () => {
	const result = await run([look(), look(), look(), look(), stop(report)], {
		limits: {
			maxTurns: 6,
			wrapMargin: 2,
			maxToolCalls: 100,
			maxLooks: 10,
			timeoutMs: 30_000,
		},
	});
	assert.equal(result.status, "complete");
	assert.match(result.truncated, /turn budget/);
	assert.equal(result.findings.length, 1);
});

test("a journey that will not stop when its budget is spent is incomplete, not half-reported", async () => {
	const result = await run(
		Array.from({ length: 12 }, () => look()),
		{
			limits: {
				maxTurns: 6,
				wrapMargin: 2,
				maxToolCalls: 100,
				maxLooks: 20,
				timeoutMs: 30_000,
			},
		},
	);
	assert.equal(result.status, "incomplete");
	assert.match(result.reason, /turn budget/);
	assert.deepEqual(result.findings, []);
});

test("exhausting the tool budget also takes the report rather than throwing the walk away", async () => {
	const result = await run(
		[look(), look(), look(), look(), look(), stop(report)],
		{
			limits: {
				maxTurns: 50,
				maxToolCalls: 3,
				maxLooks: 50,
				timeoutMs: 30_000,
			},
		},
	);
	assert.equal(result.status, "complete");
	assert.match(result.truncated, /tool call budget/);
	assert.equal(result.findings.length, 1);
});

test("the wrap-up names the budget that stopped the walk", () => {
	assert.match(wrapPrompt("turn budget exhausted"), /turn budget exhausted/);
	assert.match(wrapPrompt("tool call budget exhausted"), /tool call budget/);
});

test("a journey that outruns its clock is incomplete", async () => {
	const slow = () =>
		fauxAssistantMessage(fauxToolCall("look", {}, { id: "call-1" }), {
			stopReason: "toolUse",
		});
	const result = await run(Array.from({ length: 40 }, slow), {
		limits: { maxTurns: 200, maxToolCalls: 500, maxLooks: 500, timeoutMs: 1 },
	});
	assert.equal(result.status, "incomplete");
	assert.deepEqual(result.findings, []);
});

test("the prompt tells the persona where to start and what shape to answer in", () => {
	const prompt = journeyPrompt({
		journey,
		entry: "https://openrostrum.com/",
		brief: "You are Priya Raman.",
		limits: { maxLooks: 26, maxTurns: 48, wrapMargin: 8 },
	});
	assert.match(prompt, /You are Priya Raman\./);
	assert.match(prompt, /You start at https:\/\/openrostrum\.com\//);
	// The persona is told what it may spend walking, not the raw ceiling: the
	// last wrapMargin turns are reserved for the report and are not its to use.
	assert.match(prompt, /roughly 40 turns of walking/);
	assert.match(prompt, /"cfpUrl":"…"\|null/);
});

test("json survives being wrapped in the model's chatter", () => {
	assert.deepEqual(extractJson('here you go:\n{"a":1}\nhope that helps'), {
		a: 1,
	});
	assert.equal(extractJson("no json at all"), null);
});
