import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

export const DEFAULT_MODEL = "claude-sonnet-5";

const REQ_TIMEOUT_MS = Number(process.env.JC_REQ_TIMEOUT_MS ?? 120_000);
const MAX_OUTPUT_TOKENS = Number(process.env.JC_MAX_OUTPUT_TOKENS ?? 16_000);

/**
 * Off costs nothing and the charter carries the reasoning, but a gateway model
 * can refuse it: grok-4.6 rejects the request outright because its own floor is
 * "minimal". Every journey then dies on turn one, so the level is a knob.
 */
export const DEFAULT_THINKING_LEVEL = "off";

export function makeRuntime({
	key,
	model = DEFAULT_MODEL,
	baseUrl,
	thinkingLevel = DEFAULT_THINKING_LEVEL,
}) {
	const models = createModels();
	models.setProvider(anthropicProvider());
	const catalogued = models.getModel("anthropic", model);
	// A gateway speaks the Anthropic wire format under its own model names, so the
	// catalog cannot vouch for one. Off-catalog is allowed only behind a gateway,
	// and the run then has to say out loud that nobody checked it can see.
	if (!catalogued && !baseUrl)
		throw new Error(`unknown Anthropic model: ${model}`);
	if (catalogued && !catalogued.input?.includes("image"))
		throw new Error(
			`${model} cannot see images, and this harness judges pixels`,
		);

	const known = catalogued ?? {
		...models.getModel("anthropic", DEFAULT_MODEL),
		id: model,
		name: model,
	};
	const selected = baseUrl ? { ...known, baseUrl } : known;

	return {
		model: selected,
		endpoint: selected.baseUrl,
		visionVouched: Boolean(catalogued),
		thinkingLevel,
		streamFn(selectedModel, context, options = {}) {
			return models.streamSimple(selectedModel, context, {
				...options,
				apiKey: key,
				maxTokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
				timeoutMs: REQ_TIMEOUT_MS,
				maxRetries: 3,
			});
		},
	};
}
