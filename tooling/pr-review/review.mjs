// Multi-agent eval harness. Every rule doc in docs/rules/ becomes one reviewer
// agent (see agents.mjs); each loads its doc VERBATIM as the source of truth and
// reviews the changed file for violations of THAT doc only. The prompt + client
// live in core.mjs — the SAME ones the production CI reviewer uses. Scoring is at
// the (case × agent) level — so it measures both coverage (did the right agent
// catch it) and cross-agent noise (did the other agents stay silent). Averages
// over RUNS passes since the model isn't deterministic even at temp 0.
//
//   DEEPSEEK_API_KEY=... node review.mjs [dev|holdout]   RUNS=5 to average
//   DEEPSEEK_API_KEY=... node review.mjs models
import { loadSystems, makeClient, pool } from "./core.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 8);
const RUNS = Number(process.env.RUNS ?? 1);
const SAMPLES = Number(process.env.SAMPLES ?? 1);
const THRESHOLD = Number(process.env.THRESHOLD ?? 1);

// A case is labeled with the agent id(s) whose rules it violates — and an agent
// id IS the rule-doc filename (docs/rules/<id>.md). Empty = clean. One
// vocabulary, no translation.
const expectedAgents = (c) => new Set(c.violations ?? []);

if (!KEY) {
	console.error("DEEPSEEK_API_KEY is not set.");
	process.exit(1);
}

const client = makeClient({
	key: KEY,
	base: BASE,
	model: MODEL,
	temperature: TEMPERATURE,
});

if (process.argv[2] === "models") {
	console.log(
		JSON.stringify(await client.api("/models", { method: "GET" }), null, 2),
	);
	process.exit(0);
}

const which = process.argv[2] === "holdout" ? "holdout" : "dev";
const { cases } = await import(
	which === "holdout" ? "./cases.holdout.mjs" : "./cases.mjs"
);

// An error after retries counts as "no finding predicted" — same as the
// pre-refactor harness, so a flaky API call never silently inflates recall.
async function flagged(system, c) {
	try {
		return (
			await client.reviewVoted(system, c.file, c.code, {
				samples: SAMPLES,
				threshold: THRESHOLD,
			})
		).flagged;
	} catch {
		return false;
	}
}

const { agents, systems } = await loadSystems();

console.log(
	`set=${which} model=${MODEL} temp=${TEMPERATURE} runs=${RUNS} vote=${THRESHOLD}/${SAMPLES} agents=[${agents.map((a) => a.id).join(", ")}] cases=${cases.length}\n`,
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
	const predicted = await pool(pairs, CONC, ({ c, a }) =>
		flagged(systems.get(a.id), c),
	);
	let TP = 0;
	let FP = 0;
	let FN = 0;
	pairs.forEach(({ c, a }, i) => {
		const expected = expectedAgents(c).has(a.id);
		if (predicted[i] && expected) {
			TP++;
			perAgent[a.id].tp++;
		} else if (predicted[i] && !expected) {
			FP++;
			perAgent[a.id].fp++;
			fpCount.set(`${c.id}:${a.id}`, (fpCount.get(`${c.id}:${a.id}`) ?? 0) + 1);
		} else if (!predicted[i] && expected) {
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
