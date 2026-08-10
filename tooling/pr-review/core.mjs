// Shared reviewer core: the ONE prompt + client used by both the eval harness
// (review.mjs, which scores it against labeled cases) and the production CI
// reviewer (ci-review.mjs, which reviews real PR diffs). Keeping the prompt in
// one place is the whole point — the thing we validate is the thing that runs.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAgents, REPO_ROOT } from "./agents.mjs";

export const WRAPPER = `You are a strict senior code reviewer for the OpenRostrum repository. Below is ONE of the repo's rule documents — it is the source of truth. Review the single changed file for violations of the rules stated IN THIS DOCUMENT ONLY. Anything this document does not govern is out of scope: other reviewers cover the other docs, and lint/CI cover the mechanical rules. Do not comment on style or taste.

Your review gates merges, so a false positive is expensive — it blocks good code and trains the team to ignore you. When you are not clearly confident a rule stated in THIS document is violated, stay silent. Only flag what you could defend to the author in one sentence, quoting the rule.

Flag ONLY a concrete forbidden action that is visible in this diff. Do NOT flag based on:
- descriptive or reference material (version pins, "we use X, not Y" rationales, platform facts, tables, background) — those describe the stack, they are not per-change rules;
- a rule that depends on context this diff does not show (which git branch it is on, the build wave, whether a migration or primitive was authored elsewhere, whether a shared file is owner-approved) — you cannot see that, so stay silent;
- a rule whose subject — the specific API, primitive, dependency, file type, or subsystem it governs — this change does not actually use; a rule about one mechanism is not violated by code that uses a different mechanism, however superficially similar they look;
- the mere absence of something, unless the document explicitly requires it for this kind of change.
If you cannot point to a specific line that clearly does the forbidden thing, return no finding.

Return ONLY a JSON object: {"findings":[{"rule":"<short name of the violated rule from this doc>","location":"<file:line or a short quote>","why":"<one defensible sentence>"}]}. If the change is clean under this document, return {"findings":[]}.`;

export function extractJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		const s = text.indexOf("{");
		const e = text.lastIndexOf("}");
		if (s >= 0 && e > s) {
			try {
				return JSON.parse(text.slice(s, e + 1));
			} catch {
				/* fall through */
			}
		}
		return null;
	}
}

// Build one system prompt per rule doc: WRAPPER + the doc loaded verbatim.
export async function loadSystems() {
	const agents = loadAgents();
	const systems = new Map();
	for (const a of agents) {
		const doc = await readFile(join(REPO_ROOT, a.doc), "utf8");
		systems.set(
			a.id,
			`${WRAPPER}\n\n=== RULE DOCUMENT: ${a.doc} ===\n\n${doc}`,
		);
	}
	return { agents, systems };
}

// Per-request ceiling so a stalled connection can never hang the reviewer —
// which now gates merges, so an unbounded fetch would block every PR. A timeout
// throws, is caught per-sample, and degrades to "no finding" — never a hang.
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 60000);

export function makeClient({ key, base, model, temperature }) {
	async function api(path, init) {
		const res = await fetch(`${base}${path}`, {
			signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
			...init,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
				...(init?.headers ?? {}),
			},
		});
		if (!res.ok)
			throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
		return res.json();
	}

	// Returns the raw findings array for one (rule-doc, changed file) pair.
	async function review(system, file, code, attempt = 0) {
		const user = `File: ${file}\n\n\`\`\`\n${code}\n\`\`\`\n\nReview this change against the rule document and return the JSON object.`;
		try {
			const out = await api("/chat/completions", {
				method: "POST",
				body: JSON.stringify({
					model,
					temperature,
					response_format: { type: "json_object" },
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: user },
					],
				}),
			});
			const parsed = extractJson(out.choices?.[0]?.message?.content ?? "");
			return Array.isArray(parsed?.findings) ? parsed.findings : [];
		} catch (err) {
			if (attempt < 3 && /\b(429|5\d\d)\b/.test(String(err))) {
				await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
				return review(system, file, code, attempt + 1);
			}
			throw err;
		}
	}

	// Self-consistency vote against the model's run-to-run wobble at temp 0: draw
	// `samples` independent reviews and only report the agent as flagging the file
	// when at least `threshold` of them found something. Flaky false positives
	// (seen in one sample) drop out; stable true positives (seen every sample)
	// survive — precision up, recall held. samples=1 is the plain single-shot.
	async function reviewVoted(
		system,
		file,
		code,
		{ samples = 1, threshold = 1 } = {},
	) {
		if (samples <= 1) {
			const findings = await review(system, file, code);
			return {
				flagged: findings.length > 0,
				findings,
				votes: findings.length > 0 ? 1 : 0,
				samples: 1,
			};
		}
		const runs = await Promise.all(
			Array.from({ length: samples }, () =>
				review(system, file, code).catch(() => null),
			),
		);
		const positives = runs.filter((r) => Array.isArray(r) && r.length > 0);
		const votes = positives.length;
		const flagged = votes >= threshold;
		// Representative findings: the richest positive sample. Kept only if the
		// vote clears the bar, so a lone flaky sample never reaches the PR.
		const findings = flagged
			? positives.sort((a, b) => b.length - a.length)[0]
			: [];
		return { flagged, findings, votes, samples };
	}

	return { api, review, reviewVoted };
}

export async function pool(items, size, fn) {
	const results = new Array(items.length);
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (i < items.length) {
				const idx = i++;
				results[idx] = await fn(items[idx], idx);
			}
		}),
	);
	return results;
}
