import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FINDING_LIMITS,
	makeRuntime,
	RESPONSE_CEILING,
	streamOptions,
	SUBMISSIONS_PER_RESPONSE,
} from "./core.mjs";

// The contract: reviewer sessions must reach DeepSeek through Pi's own DeepSeek
// provider, so the wire format, compat quirks, and tool support come from Pi's
// catalog rather than from anything we hand-assemble here.
test("the runtime carries Pi's DeepSeek provider contract, not a hand-built model", () => {
	const runtime = makeRuntime({
		key: "test-key",
		base: "https://api.deepseek.test",
		model: "deepseek-v4-flash",
		temperature: 0,
	});

	assert.equal(runtime.model.provider, "deepseek");
	assert.equal(runtime.model.api, "openai-completions");
	assert.equal(runtime.model.compat?.supportsDeveloperRole, false);
	assert.equal(runtime.model.compat?.thinkingFormat, "deepseek");
	assert.ok(runtime.model.contextWindow > 0);
	// The model still has to be able to give a response the size our contract
	// asks for; anything less and reviewers truncate for a reason we chose.
	assert.ok(
		runtime.model.maxTokens >= RESPONSE_CEILING,
		`catalog ceiling ${runtime.model.maxTokens} is below the ${RESPONSE_CEILING} a response can need`,
	);
});

// A response no longer carries the review — findings are submitted one tool call
// at a time — so asking DeepSeek for the catalog's 384000 was requesting 47x
// what any response can hold, from a provider that honours 8192 regardless. Ask
// for what the contract can actually require.
test("the ceiling asked for is the largest response this contract can require", () => {
	const sent = streamOptions({
		key: "test-key",
		temperature: 0,
		model: { maxTokens: 384_000 },
	});

	assert.equal(sent.maxTokens, RESPONSE_CEILING);
	assert.ok(RESPONSE_CEILING < 384_000);
});

test("a model that cannot reach the contract ceiling is asked for its own", () => {
	const sent = streamOptions({
		key: "test-key",
		temperature: 0,
		model: { maxTokens: 2048 },
	});

	assert.equal(sent.maxTokens, 2048);
});

// The ceiling is derived, so it must keep holding a worst-case response rather
// than drifting into a number that truncates the contract it was derived from.
test("the requested ceiling holds a full response of maximum-size findings", () => {
	const maximal = JSON.stringify(
		Array.from({ length: SUBMISSIONS_PER_RESPONSE }, () => ({
			file: `${"deep-directory/".repeat(8)}${"n".repeat(60)}.tsx`,
			line: 999_999,
			quote: "q".repeat(FINDING_LIMITS.quote),
			rule: "r".repeat(FINDING_LIMITS.rule),
			why: "w".repeat(FINDING_LIMITS.why),
		})),
	);

	// Four characters per token is generous for JSON carrying code and prose,
	// and the ceiling has to leave the model room for its own words on top.
	assert.ok(
		RESPONSE_CEILING > maximal.length / 4,
		`ceiling ${RESPONSE_CEILING} cannot hold ${SUBMISSIONS_PER_RESPONSE} maximum findings (${maximal.length} chars)`,
	);
});

test("a caller may still narrow the ceiling below the model's limit", () => {
	const caller = streamOptions({
		key: "test-key",
		temperature: 0,
		model: { maxTokens: 262_144 },
		options: { maxTokens: 4096 },
	});

	assert.equal(caller.maxTokens, 4096);
});

// A deployer may point DEEPSEEK_MODEL at a model newer than Pi's bundled
// catalog; that must still review rather than crash the job.
test("an uncatalogued model id still resolves through the catalog template", () => {
	const runtime = makeRuntime({
		key: "test-key",
		base: "https://api.deepseek.test",
		model: "deepseek-v9-unreleased",
		temperature: 0,
	});

	assert.equal(runtime.model.id, "deepseek-v9-unreleased");
	assert.equal(runtime.model.api, "openai-completions");
	assert.equal(runtime.model.baseUrl, "https://api.deepseek.test");
});
