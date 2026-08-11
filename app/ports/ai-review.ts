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
			const data = (await res.json()) as { model?: unknown };
			return {
				text: responseText(data),
				model: typeof data.model === "string" ? data.model : undefined,
			};
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

function responseText(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		const content = (result as { content?: unknown }).content;
		if (Array.isArray(content)) {
			return content
				.filter(
					(block): block is { type: "text"; text: string } =>
						block != null &&
						typeof block === "object" &&
						(block as { type?: unknown }).type === "text" &&
						typeof (block as { text?: unknown }).text === "string",
				)
				.map((block) => block.text)
				.join("");
		}
		const response = (result as { response?: unknown }).response;
		if (typeof response === "string") return response;
		const choices = (result as { choices?: unknown }).choices;
		if (Array.isArray(choices)) {
			const text = (choices[0] as { message?: { content?: unknown } })?.message
				?.content;
			if (typeof text === "string") return text;
		}
	}
	throw new Error("AI provider returned an unknown response envelope");
}
