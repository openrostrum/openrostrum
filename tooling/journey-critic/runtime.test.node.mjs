import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, makeRuntime } from "./runtime.mjs";

test("the default model can see, and is talked to at Anthropic", () => {
	const runtime = makeRuntime({ key: "sk-test" });
	assert.equal(runtime.model.id, DEFAULT_MODEL);
	assert.ok(runtime.model.input.includes("image"));
	assert.equal(runtime.visionVouched, true);
	assert.match(runtime.endpoint, /api\.anthropic\.com/);
});

test("a model nobody has heard of is refused rather than guessed at", () => {
	assert.throws(
		() => makeRuntime({ key: "sk-test", model: "claude-sonnet-5-20260101" }),
		/unknown Anthropic model/,
	);
});

test("a gateway may name its own model, and the run says nobody vouched for its eyes", () => {
	const runtime = makeRuntime({
		key: "sk-test",
		model: "gpt-5.6-sol",
		baseUrl: "http://127.0.0.1:8317",
	});
	assert.equal(runtime.model.id, "gpt-5.6-sol");
	assert.equal(runtime.model.baseUrl, "http://127.0.0.1:8317");
	assert.equal(runtime.visionVouched, false);
});

test("thinking stays off unless a gateway model needs otherwise", () => {
	assert.equal(makeRuntime({ key: "sk-test" }).thinkingLevel, "off");
	assert.equal(
		makeRuntime({ key: "sk-test", thinkingLevel: undefined }).thinkingLevel,
		"off",
	);
	// grok-4.6 rejects "none" outright, and every journey died on turn one for it.
	const gateway = makeRuntime({
		key: "sk-test",
		model: "grok-4.6",
		baseUrl: "https://router-api.ramp.com",
		thinkingLevel: "minimal",
	});
	assert.equal(gateway.thinkingLevel, "minimal");
});
