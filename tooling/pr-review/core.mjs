// Shared reviewer core: the same rule-owner prompts and Pi runtime power both
// the labeled eval harness and production CI.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { loadAgents, REPO_ROOT } from "./agents.mjs";

// Per-field ceilings for one finding. The prompt states these numbers and the
// submit_finding boundary enforces them, so a reviewer is never told one contract
// and held to another. Only these five fields reach GitHub; everything else a
// reviewer writes is spent budget that buys no review.
export const FINDING_LIMITS = { quote: 240, rule: 100, why: 240 };

// How many findings one response may submit. Enforced in agent.mjs, so it is a
// property of this contract rather than a guess about the provider: past the
// cap, the extra submissions are refused with a reason and re-issued next turn.
export const SUBMISSIONS_PER_RESPONSE = 10;

const PATH_BUDGET = 256; // longest repository path, comfortably
const CALL_SCAFFOLD = 96; // keys, quotes, escapes, line number
const PROSE_SHARE = 2; // the model's own words get as much room as the payload
const CHARS_PER_TOKEN = 3; // conservative for JSON carrying code and prose

// No response carries the review any more, so the ceiling to request is the
// largest one this contract can require — derived from the limits that bound a
// response rather than picked, and never the catalog's 384000, which asks a
// provider honouring 8192 for 47x what a response can hold.
export const RESPONSE_CEILING = Math.ceil(
	((FINDING_LIMITS.quote +
		FINDING_LIMITS.rule +
		FINDING_LIMITS.why +
		PATH_BUDGET +
		CALL_SCAFFOLD) *
		SUBMISSIONS_PER_RESPONSE *
		PROSE_SHARE) /
		CHARS_PER_TOKEN,
);

export function requestCeiling(model) {
	return Math.min(model?.maxTokens ?? RESPONSE_CEILING, RESPONSE_CEILING);
}

export const WRAPPER = `You are a strict senior code reviewer for the OpenRostrum repository. Below is ONE of the repo's rule documents — it is your sole source of truth. Review the entire pull request for violations of rules stated IN THIS DOCUMENT ONLY. Other reviewers independently own the other rule documents; lint and CI own mechanical checks. Do not comment on style or taste.

Your review gates merges, so a false positive is expensive. Investigate repository context when needed, but only report a concrete violation introduced by the pull request that you can defend by quoting this rule document and exact changed code. Descriptive material and rules whose required context cannot be established are not findings. The absence of something is only a finding when this document explicitly requires it for this kind of change.

Choose your own investigation order and breadth. Use the read-only repository tools to inspect changed diffs, changed or unchanged files, definitions, callers, tests, and schema. The changed-file index is orientation, not source evidence. Finish only after you have reviewed the pull request as a whole under this document.

Report each violation with a submit_finding call the moment you are sure of it, and never hold findings back to list them at the end. Submissions are banked as you make them, so a review cut short still delivers everything it had already proved. Every turn you take is either tool calls or the final completion signal — never a plan, a status note, a running commentary, or a summary of what you just read. Never restate, paraphrase, or quote back this rule document: the reader already has it. Files you inspected and cleared are not part of the review; only violations are. Nothing you write outside submit_finding calls and the final signal is read by anyone. Investigate as widely as the pull request demands.`;

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
// provider's own small default truncates a reviewer mid-response. Ask for what
// a response can need, or for everything the model has when that is less.
export function streamOptions({ key, temperature, model, options = {} }) {
	return {
		...options,
		apiKey: key,
		temperature,
		maxTokens: options.maxTokens ?? requestCeiling(model),
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
