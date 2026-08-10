interface Env {
	AI: {
		run(model: string, input: Record<string, unknown>): Promise<unknown>;
	};
}

const MODELS = new Set(["@cf/moonshotai/kimi-k2.6", "@cf/openai/gpt-oss-120b"]);

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}
		const { model, messages } = await request.json<{
			model: string;
			messages: Array<{ role: string; content: string }>;
		}>();
		if (!MODELS.has(model)) {
			return Response.json(
				{ ok: false, error: "Model not allowed" },
				{ status: 400 },
			);
		}
		const started = performance.now();
		try {
			const result = await env.AI.run(model, {
				messages,
				max_tokens: 600,
				temperature: 0.2,
			});
			return Response.json({
				ok: true,
				latencyMs: performance.now() - started,
				result,
			});
		} catch (error) {
			return Response.json(
				{
					ok: false,
					latencyMs: performance.now() - started,
					error: String(error),
				},
				{ status: 502 },
			);
		}
	},
};
