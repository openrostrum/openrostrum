import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRuntime, streamOptions } from "./core.mjs";

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
});

// A reviewer truncated by the provider's default output cap can only be reported
// as incomplete, so every request must carry an explicit ceiling of its own.
test("every provider request asks for an explicit output ceiling", () => {
	const sent = streamOptions({ key: "test-key", temperature: 0 });
	assert.ok(sent.maxTokens >= 8000);

	const caller = streamOptions({
		key: "test-key",
		temperature: 0,
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
