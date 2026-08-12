import { z } from "zod";

const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";

export const WORKERS_AI_DEFAULT_MODEL = "@cf/openai/gpt-oss-120b";

export type AiRunner = {
	run(
		model: string,
		inputs: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	): Promise<Record<string, unknown>>;
};

export type AiChatProvider = {
	model: string;
	chat(
		messages: Array<{ role: string; content: string }>,
		opts: {
			maxTokens: number;
			temperature: number;
			signal?: AbortSignal;
		},
	): Promise<{ text: string; model?: string }>;
};

export function createDeepseekProvider(apiKey: string): AiChatProvider {
	return {
		model: DEEPSEEK_MODEL,
		async chat(messages, opts) {
			const system = messages
				.filter((message) => message.role === "system")
				.map((message) => message.content)
				.join("\n\n");
			const turns = messages
				.filter((message) => message.role !== "system")
				.map((message) => ({
					role: message.role,
					content: message.content,
				}));
			const res = await fetch(DEEPSEEK_ENDPOINT, {
				method: "POST",
				signal: opts.signal,
				headers: {
					"x-api-key": apiKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: DEEPSEEK_MODEL,
					system,
					messages: turns,
					max_tokens: opts.maxTokens,
					temperature: opts.temperature,
				}),
			});
			if (!res.ok) {
				throw new Error(`DeepSeek request failed (${res.status})`);
			}
			const data = await res.json();
			return { text: responseText(data), model: EchoedModel.parse(data).model };
		},
	};
}

export function createWorkersAiProvider(
	ai: AiRunner,
	model: string,
): AiChatProvider {
	return {
		model,
		async chat(messages, opts) {
			const result = await ai.run(
				model,
				{
					messages,
					max_tokens: opts.maxTokens,
					temperature: opts.temperature,
				},
				{ signal: opts.signal },
			);
			return { text: responseText(result) };
		},
	};
}

export function getAiProvider(env: Env): AiChatProvider | null {
	if (env.DEEPSEEK_API_KEY) {
		return createDeepseekProvider(env.DEEPSEEK_API_KEY);
	}
	const binding = (env as { AI?: AiRunner }).AI;
	return binding
		? createWorkersAiProvider(binding, WORKERS_AI_DEFAULT_MODEL)
		: null;
}

/** Anthropic interleaves text with tool/thinking blocks; only text is answer. */
const TextBlock = z.object({ type: z.literal("text"), text: z.string() });

/**
 * The dialects a chat completion arrives in, most specific first: Anthropic
 * content blocks, Workers AI `response`, OpenAI `choices`. A provider is free
 * to change dialect between calls, so all of them are always accepted.
 */
const Envelope = z.union([
	z.string(),
	z
		.object({ content: z.array(z.unknown()) })
		.transform(({ content }) =>
			content
				.flatMap((block) => TextBlock.safeParse(block).data?.text ?? [])
				.join(""),
		),
	z.object({ response: z.string() }).transform(({ response }) => response),
	z
		.object({
			choices: z.tuple(
				[z.object({ message: z.object({ content: z.string() }) })],
				z.unknown(),
			),
		})
		.transform(({ choices }) => choices[0].message.content),
]);

/** Which model actually answered, when the provider says — never load-bearing. */
const EchoedModel = z.object({ model: z.string().optional() }).catch({});

/** Exported so the envelope contract is pinned against a real body, not a mock. */
export function responseText(result: unknown): string {
	const parsed = Envelope.safeParse(result);
	if (!parsed.success) {
		throw new Error("AI provider returned an unknown response envelope");
	}
	return parsed.data;
}
