// Eval harness for the DeepSeek PR reviewer. Runs the doctrine prompt over a
// labeled set, scores precision/recall/F1 at the case×category level, and (since
// the model is not fully deterministic even at temp 0) averages over RUNS passes
// so the reported number is not a single noisy draw.
//
//   DEEPSEEK_API_KEY=... node review.mjs [dev|holdout]   RUNS=5 to average
//   DEEPSEEK_API_KEY=... node review.mjs models          # list model ids
//
// Env: DEEPSEEK_API_KEY (required), DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
//      TEMPERATURE (0), CONC (5), RUNS (1).
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 5);
const RUNS = Number(process.env.RUNS ?? 1);
const VALID = new Set(["bs-comment", "weak-test", "shortcut", "legacy-shim"]);

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

async function review(doctrine, testCase, attempt = 0) {
	const user = `File: ${testCase.file}\n\n\`\`\`\n${testCase.code}\n\`\`\`\n\nReview this change against the four rules and return the JSON object.`;
	try {
		const out = await api("/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: MODEL,
				temperature: TEMPERATURE,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: doctrine },
					{ role: "user", content: user },
				],
			}),
		});
		const content = out.choices?.[0]?.message?.content ?? "";
		const parsed = extractJson(content);
		if (!parsed) return { predicted: [], parseError: true };
		return {
			predicted: Array.isArray(parsed.findings) ? parsed.findings : [],
		};
	} catch (err) {
		if (attempt < 3 && /\b(429|5\d\d)\b/.test(String(err))) {
			await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
			return review(doctrine, testCase, attempt + 1);
		}
		return { predicted: [], error: String(err) };
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

function scoreCase(c, r) {
	const gold = new Set(c.violations);
	const pred = new Set(
		(r.predicted ?? []).map((f) =>
			String(f.category ?? "")
				.trim()
				.toLowerCase(),
		),
	);
	return {
		c,
		r,
		gold: [...gold],
		pred: [...pred],
		tp: [...pred].filter((x) => gold.has(x)),
		fp: [...pred].filter((x) => !gold.has(x)),
		fn: [...gold].filter((x) => !pred.has(x)),
	};
}

const doctrine = await readFile(join(HERE, "doctrine.md"), "utf8");
console.log(
	`set=${which} model=${MODEL} temp=${TEMPERATURE} runs=${RUNS} cases=${cases.length}\n`,
);

const pct = (x) => (x * 100).toFixed(1);
const prf = (tp, fp, fn) => {
	const p = tp + fp === 0 ? 1 : tp / (tp + fp);
	const r = tp + fn === 0 ? 1 : tp / (tp + fn);
	return { p, r, f1: p + r === 0 ? 0 : (2 * p * r) / (p + r) };
};

let sumTP = 0;
let sumFP = 0;
let sumFN = 0;
const missCount = new Map();
const fpCount = new Map();

for (let run = 0; run < RUNS; run++) {
	const evaluated = await pool(cases, CONC, (c) =>
		review(doctrine, c).then((r) => scoreCase(c, r)),
	);
	let TP = 0;
	let FP = 0;
	let FN = 0;
	for (const e of evaluated) {
		TP += e.tp.length;
		FP += e.fp.length;
		FN += e.fn.length;
		for (const cat of e.fn)
			missCount.set(e.c.id, (missCount.get(e.c.id) ?? 0) + 1);
		for (const cat of e.fp)
			fpCount.set(
				`${e.c.id}:${cat}`,
				(fpCount.get(`${e.c.id}:${cat}`) ?? 0) + 1,
			);
	}
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

if (fpCount.size) {
	console.log("\nFalse positives (case:cat → runs flagged / total):");
	for (const [k, n] of [...fpCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${k}  ${n}/${RUNS}`);
}
if (missCount.size) {
	console.log("\nMissed positives (case → runs missed / total):");
	for (const [k, n] of [...missCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${k}  ${n}/${RUNS}`);
}
