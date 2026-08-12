import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDeepseekProvider,
	createWorkersAiProvider,
	responseText,
} from "../app/ports/ai-review";

// Pins the inbound half of the AI port: the reviewer talks to whichever
// provider the deployment has keys for, and they answer in different
// envelopes. A dialect this file does not cover is a review that silently
// fails for the whole event, so every accepted shape is nailed down here.

describe("responseText", () => {
	it("reads a bare string answer", () => {
		expect(responseText("hello")).toBe("hello");
	});

	it("concatenates Anthropic text blocks and ignores every other block", () => {
		expect(
			responseText({
				content: [
					{ type: "thinking", thinking: "hmm" },
					{ type: "text", text: "one " },
					{ type: "tool_use", id: "t1" },
					{ type: "text", text: "two" },
				],
			}),
		).toBe("one two");
	});

	it("reads the Workers AI and OpenAI envelopes", () => {
		expect(responseText({ response: "workers" })).toBe("workers");
		expect(
			responseText({
				choices: [{ message: { content: "openai" } }, { message: {} }],
			}),
		).toBe("openai");
	});

	it("prefers content blocks when a provider sends two dialects at once", () => {
		expect(
			responseText({
				content: [{ type: "text", text: "blocks" }],
				response: "ignored",
			}),
		).toBe("blocks");
	});

	it("reads a content array holding no text as an empty answer", () => {
		// An empty answer is a legitimate reply the reviewer reports as such;
		// falling through to another dialect would invent one.
		expect(responseText({ content: [] })).toBe("");
		expect(responseText({ content: [{ type: "thinking" }] })).toBe("");
	});

	it("throws on an envelope it cannot read rather than inventing text", () => {
		const unknown = [
			null,
			42,
			{},
			{ content: "not an array" },
			{ response: 7 },
			{ choices: [] },
			{ choices: [{ message: { content: 3 } }] },
			{ text: "wrong key" },
		];
		for (const envelope of unknown) {
			expect(() => responseText(envelope)).toThrow(/unknown response envelope/);
		}
	});
});

describe("createWorkersAiProvider", () => {
	it("passes the tuning through and returns the model it was built with", async () => {
		const calls: unknown[] = [];
		const provider = createWorkersAiProvider(
			{
				run: async (model, inputs) => {
					calls.push({ model, inputs });
					return { response: "ok" };
				},
			},
			"@cf/test/model",
		);
		const reply = await provider.chat([{ role: "user", content: "hi" }], {
			maxTokens: 64,
			temperature: 0.2,
		});
		expect(reply).toEqual({ text: "ok" });
		expect(calls).toEqual([
			{
				model: "@cf/test/model",
				inputs: {
					messages: [{ role: "user", content: "hi" }],
					max_tokens: 64,
					temperature: 0.2,
				},
			},
		]);
	});
});

describe("createDeepseekProvider", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubReply(status: number, body: unknown) {
		const sent: unknown[] = [];
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)));
			return new Response(JSON.stringify(body), { status });
		});
		return sent;
	}

	it("hoists system turns into the system field and reports the echoed model", async () => {
		const sent = stubReply(200, {
			model: "deepseek-v4-flash-0710",
			content: [{ type: "text", text: "verdict" }],
		});
		const reply = await createDeepseekProvider("sk-test").chat(
			[
				{ role: "system", content: "be brief" },
				{ role: "system", content: "be fair" },
				{ role: "user", content: "review this" },
			],
			{ maxTokens: 128, temperature: 0 },
		);
		expect(reply).toEqual({
			text: "verdict",
			model: "deepseek-v4-flash-0710",
		});
		expect(sent[0]).toMatchObject({
			system: "be brief\n\nbe fair",
			messages: [{ role: "user", content: "review this" }],
		});
	});

	it("leaves the model unreported when the body does not name one", async () => {
		stubReply(200, { model: 7, response: "still an answer" });
		const reply = await createDeepseekProvider("sk-test").chat([], {
			maxTokens: 1,
			temperature: 0,
		});
		expect(reply).toEqual({ text: "still an answer", model: undefined });
	});

	it("surfaces a failed request as an error, not an empty review", async () => {
		stubReply(401, { error: "bad key" });
		await expect(
			createDeepseekProvider("sk-bad").chat([], {
				maxTokens: 1,
				temperature: 0,
			}),
		).rejects.toThrow("DeepSeek request failed (401)");
	});
});
