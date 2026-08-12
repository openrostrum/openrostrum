import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FINDING_LIMITS,
	makeRuntime,
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
	assert.ok(runtime.model.maxTokens > 100_000);
});

// This is the defect that cost a night of reviews. pi-ai chooses
// max_completion_tokens for every OpenAI-compatible provider outside its
// allow-list, DeepSeek is outside it, and DeepSeek's API reads only max_tokens —
// so every ceiling we sent was dropped on the floor and its 8192 default applied.
// Requesting 6214 still stopped at 8192, which is what gave it away.
test("the output ceiling is sent under the field name DeepSeek reads", () => {
	const runtime = makeRuntime({
		key: "test-key",
		base: "https://api.deepseek.test",
		model: "deepseek-v4-flash",
		temperature: 0,
	});

	assert.equal(
		runtime.model.compat?.maxTokensField,
		"max_tokens",
		"DeepSeek ignores max_completion_tokens, so a ceiling sent under it never arrives",
	);
});

// Asking for less than the model allows is asking reviewers to truncate for a
// reason we invented. The ceiling belongs to the catalog.
test("the ceiling asked for is the model's own, not a derived budget", () => {
	const sent = streamOptions({
		key: "test-key",
		temperature: 0,
		model: { maxTokens: 384_000 },
	});

	assert.equal(sent.maxTokens, 384_000);
});

test("a model that cannot reach the contract ceiling is asked for its own", () => {
	const sent = streamOptions({
		key: "test-key",
		temperature: 0,
		model: { maxTokens: 2048 },
	});

	assert.equal(sent.maxTokens, 2048);
});

// The ceiling has to keep holding a worst-case response — a full allowance of
// maximum-size findings — or the contract truncates against its own limits.
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
	const runtime = makeRuntime({
		key: "test-key",
		base: "https://api.deepseek.test",
		model: "deepseek-v4-flash",
		temperature: 0,
	});
	const ceiling = streamOptions({
		key: "test-key",
		temperature: 0,
		model: runtime.model,
	}).maxTokens;

	assert.ok(
		ceiling > maximal.length / 4,
		`ceiling ${ceiling} cannot hold ${SUBMISSIONS_PER_RESPONSE} maximum findings (${maximal.length} chars)`,
	);
});
