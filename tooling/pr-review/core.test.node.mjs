import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRuntime } from "./core.mjs";

test("Pi runtime preserves the configured DeepSeek model and endpoint", () => {
	const runtime = makeRuntime({
		key: "test-key",
		base: "https://api.deepseek.test",
		model: "deepseek-v4-flash",
		temperature: 0,
	});

	assert.equal(runtime.model.provider, "deepseek");
	assert.equal(runtime.model.api, "openai-completions");
	assert.equal(runtime.model.id, "deepseek-v4-flash");
	assert.equal(runtime.model.baseUrl, "https://api.deepseek.test");
	assert.equal(typeof runtime.streamFn, "function");
	assert.equal(typeof runtime.api, "function");
});
