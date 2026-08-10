// Multi-agent eval harness. Every rule doc in docs/rules/ becomes one reviewer
// agent (see agents.mjs); each loads its doc VERBATIM as the source of truth and
// reviews the changed file for violations of THAT doc only. Scoring is at the
// (case × agent) level — so it measures both coverage (did the right agent catch
// it) and cross-agent noise (did the other agents stay silent). Averages over
// RUNS passes since the model isn't deterministic even at temp 0.
//
//   DEEPSEEK_API_KEY=... node review.mjs [dev|holdout]   RUNS=5 to average
//   DEEPSEEK_API_KEY=... node review.mjs models
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgents, REPO_ROOT } from "./agents.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 8);
const RUNS = Number(process.env.RUNS ?? 1);

// A case is labeled with the agent id(s) whose rules it violates — and an agent
// id IS the rule-doc filename (docs/rules/<id>.md). Empty = clean. One
// vocabulary, no translation.
const expectedAgents = (c) => new Set(c.violations ?? []);

if (!KEY) {
	console.error("DEEPSEEK_API_KEY is not set.");
	process.exit(1);
}

async function api(path, init) {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${KEY}`,
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok)
		throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
	return res.json();
}

if (process.argv[2] === "models") {
	console.log(JSON.stringify(await api("/models", { method: "GET" }), null, 2));
	process.exit(0);
}

const which = process.argv[2] === "holdout" ? "holdout" : "dev";
const { cases } = await import(
	which === "holdout" ? "./cases.holdout.mjs" : "./cases.mjs"
);

const WRAPPER = `You are a strict senior code reviewer for the OpenRostrum repository. Below is ONE of the repo's rule documents — it is the source of truth. Review the single changed file for violations of the rules stated IN THIS DOCUMENT ONLY. Anything this document does not govern is out of scope: other reviewers cover the other docs, and lint/CI cover the mechanical rules. Do not comment on style or taste.

Your review gates merges, so a false positive is expensive — it blocks good code and trains the team to ignore you. When you are not clearly confident a rule stated in THIS document is violated, stay silent. Only flag what you could defend to the author in one sentence, quoting the rule.

Flag ONLY a concrete forbidden action that is visible in this diff. Do NOT flag based on:
- descriptive or reference material (version pins, "we use X, not Y" rationales, platform facts, tables, background) — those describe the stack, they are not per-change rules;
- a rule that depends on context this diff does not show (which git branch it is on, the build wave, whether a migration or primitive was authored elsewhere, whether a shared file is owner-approved) — you cannot see that, so stay silent;
- the mere absence of something, unless the document explicitly requires it for this kind of change.
If you cannot point to a specific line that clearly does the forbidden thing, return no finding.

Return ONLY a JSON object: {"findings":[{"rule":"<short name of the violated rule from this doc>","location":"<file:line or a short quote>","why":"<one defensible sentence>"}]}. If the change is clean under this document, return {"findings":[]}.`;

function extractJson(text) {
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

async function ask(system, testCase, attempt = 0) {
	const user = `File: ${testCase.file}\n\n\`\`\`\n${testCase.code}\n\`\`\`\n\nReview this change against the rule document and return the JSON object.`;
	try {
		const out = await api("/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: MODEL,
				temperature: TEMPERATURE,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			}),
		});
		const parsed = extractJson(out.choices?.[0]?.message?.content ?? "");
		const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
		return findings.length > 0;
	} catch (err) {
		if (attempt < 3 && /\b(429|5\d\d)\b/.test(String(err))) {
			await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
			return ask(system, testCase, attempt + 1);
		}
		return false;
	}
}

async function pool(items, size, fn) {
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

const agents = loadAgents();
const systems = new Map();
for (const a of agents) {
	const doc = await readFile(join(REPO_ROOT, a.doc), "utf8");
	systems.set(a.id, `${WRAPPER}\n\n=== RULE DOCUMENT: ${a.doc} ===\n\n${doc}`);
}

console.log(
	`set=${which} model=${MODEL} temp=${TEMPERATURE} runs=${RUNS} agents=[${agents.map((a) => a.id).join(", ")}] cases=${cases.length}\n`,
);

// One work item per (case, agent) pair.
const pairs = cases.flatMap((c) => agents.map((a) => ({ c, a })));
const pct = (x) => (x * 100).toFixed(1);
const prf = (tp, fp, fn) => {
	const p = tp + fp === 0 ? 1 : tp / (tp + fp);
	const r = tp + fn === 0 ? 1 : tp / (tp + fn);
	return { p, r, f1: p + r === 0 ? 0 : (2 * p * r) / (p + r) };
};

let sumTP = 0;
let sumFP = 0;
let sumFN = 0;
const perAgent = Object.fromEntries(
	agents.map((a) => [a.id, { tp: 0, fp: 0, fn: 0 }]),
);
const fpCount = new Map();
const fnCount = new Map();

for (let run = 0; run < RUNS; run++) {
	const flagged = await pool(pairs, CONC, ({ c, a }) =>
		ask(systems.get(a.id), c),
	);
	let TP = 0;
	let FP = 0;
	let FN = 0;
	pairs.forEach(({ c, a }, i) => {
		const expected = expectedAgents(c).has(a.id);
		const predicted = flagged[i];
		if (predicted && expected) {
			TP++;
			perAgent[a.id].tp++;
		} else if (predicted && !expected) {
			FP++;
			perAgent[a.id].fp++;
			fpCount.set(`${c.id}:${a.id}`, (fpCount.get(`${c.id}:${a.id}`) ?? 0) + 1);
		} else if (!predicted && expected) {
			FN++;
			perAgent[a.id].fn++;
			fnCount.set(`${c.id}:${a.id}`, (fnCount.get(`${c.id}:${a.id}`) ?? 0) + 1);
		}
	});
	sumTP += TP;
	sumFP += FP;
	sumFN += FN;
	const { p, r, f1 } = prf(TP, FP, FN);
	console.log(
		`run ${run + 1}: TP=${TP} FP=${FP} FN=${FN}  P=${pct(p)}%  R=${pct(r)}%  F1=${pct(f1)}%`,
	);
}

const mean = prf(sumTP, sumFP, sumFN);
console.log(
	`\nmicro-avg over ${RUNS} run(s): P=${pct(mean.p)}%  R=${pct(mean.r)}%  F1=${pct(mean.f1)}%`,
);
console.log("\nper-agent (tp/fp/fn):");
for (const [id, s] of Object.entries(perAgent))
	console.log(`  ${id.padEnd(12)} ${s.tp}/${s.fp}/${s.fn}`);

if (fpCount.size) {
	console.log("\nfalse positives (case:agent → runs/total):");
	for (const [k, n] of [...fpCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${k}  ${n}/${RUNS}`);
}
if (fnCount.size) {
	console.log("\nmissed (case:agent → runs/total):");
	for (const [k, n] of [...fnCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${k}  ${n}/${RUNS}`);
}
