// Shared reviewer core: the same rule-owner prompts and Pi runtime power both
// the labeled eval harness and production CI.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { loadAgents, REPO_ROOT } from "./agents.mjs";

// Per-field ceilings for one finding. The prompt states these numbers and
// validateFindings enforces them, so a reviewer is never told one contract and
// held to another. Only these five fields reach GitHub; everything else a
// reviewer writes is spent budget that buys no review.
export const FINDING_LIMITS = { quote: 240, rule: 100, why: 240 };

export const WRAPPER = `You are a strict senior code reviewer for the OpenRostrum repository. Below is ONE of the repo's rule documents — it is your sole source of truth. Review the entire pull request for violations of rules stated IN THIS DOCUMENT ONLY. Other reviewers independently own the other rule documents; lint and CI own mechanical checks. Do not comment on style or taste.

Your review gates merges, so a false positive is expensive. Investigate repository context when needed, but only report a concrete violation introduced by the pull request that you can defend by quoting this rule document and exact changed code. Descriptive material and rules whose required context cannot be established are not findings. The absence of something is only a finding when this document explicitly requires it for this kind of change.

Choose your own investigation order and breadth. Use the read-only repository tools to inspect changed diffs, changed or unchanged files, definitions, callers, tests, and schema. The changed-file index is orientation, not source evidence. Finish only after you have reviewed the pull request as a whole under this document.

Everything you write shares one output budget, and running out of it destroys the whole review rather than shortening it. Every turn you take is either tool calls or the final JSON answer — never a plan, a status note, a running commentary, or a summary of what you just read. Never restate, paraphrase, or quote back this rule document: the reader already has it. Files you inspected and cleared are not part of the answer; only violations are. Nothing you write outside the final JSON object is read by anyone. Investigate as widely as the pull request demands — the budget is spent by writing, not by reading.`;

export function extractJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(text.slice(start, end + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
}

export async function loadSystems() {
	const agents = loadAgents();
	const systems = new Map();
	for (const agent of agents) {
		const doc = await readFile(join(REPO_ROOT, agent.doc), "utf8");
		systems.set(
			agent.id,
			`${WRAPPER}\n\n=== RULE DOCUMENT: ${agent.doc} ===\n\n${doc}`,
		);
	}
	return { agents, systems };
}

const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 60000);

// Pi forwards a max-output value only when maxTokens is set; with none, the
// provider's own small default truncates a reviewer mid-answer, which the
// completion contract can only report as incomplete. The ceiling belongs to the
// model, so take it from the catalog entry rather than inventing a number.
export function streamOptions({ key, temperature, model, options = {} }) {
	return {
		...options,
		apiKey: key,
		temperature,
		maxTokens: options.maxTokens ?? model?.maxTokens,
		timeoutMs: REQ_TIMEOUT_MS,
		maxRetries: 3,
	};
}

export function makeRuntime({ key, base, model, temperature }) {
	const models = createModels();
	models.setProvider(deepseekProvider());
	const catalogModel = models.getModel("deepseek", model);
	const template =
		catalogModel ?? models.getModel("deepseek", "deepseek-v4-flash");
	if (!template) throw new Error(`DeepSeek model is unavailable: ${model}`);
	const activeModel = {
		...template,
		id: model,
		name: catalogModel?.name ?? model,
		baseUrl: base,
	};

	async function api(path, init) {
		const response = await fetch(`${base}${path}`, {
			signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
			...init,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
				...(init?.headers ?? {}),
			},
		});
		if (!response.ok)
			throw new Error(
				`${response.status} ${response.statusText}: ${await response.text()}`,
			);
		return response.json();
	}

	return {
		model: activeModel,
		api,
		streamFn(selectedModel, context, options = {}) {
			return models.streamSimple(
				selectedModel,
				context,
				streamOptions({
					key,
					temperature,
					model: selectedModel ?? activeModel,
					options,
				}),
			);
		},
	};
}

export async function pool(items, size, fn) {
	const results = new Array(items.length);
	let index = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (index < items.length) {
				const current = index++;
				results[current] = await fn(items[current], current);
			}
		}),
	);
	return results;
}
