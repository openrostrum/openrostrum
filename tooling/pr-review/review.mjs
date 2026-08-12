// Evaluation harness for the production agent boundary. Every fixture is exposed
// as a one-file pull request, and every dynamically discovered rule owner reviews
// it through the same Pi agent harness used by ci-review.mjs.
//
//   DEEPSEEK_API_KEY=... node review.mjs [dev|holdout]   RUNS=5 to average
//   DEEPSEEK_API_KEY=... node review.mjs models
import { runRuleReviewer } from "./agent.mjs";
import { loadSystems, makeRuntime, pool } from "./core.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const CONC = Number(process.env.CONC ?? 8);
const RUNS = Number(process.env.RUNS ?? 1);

const expectedAgents = (testCase) => new Set(testCase.violations ?? []);

if (!KEY) {
	console.error("DEEPSEEK_API_KEY is not set.");
	process.exit(1);
}

const runtime = makeRuntime({
	key: KEY,
	base: BASE,
	model: MODEL,
	temperature: TEMPERATURE,
});

if (process.argv[2] === "models") {
	console.log(
		JSON.stringify(await runtime.api("/models", { method: "GET" }), null, 2),
	);
	process.exit(0);
}

const which = process.argv[2] === "holdout" ? "holdout" : "dev";
const { cases } = await import(
	which === "holdout" ? "./cases.holdout.mjs" : "./cases.mjs"
);

function fixtureRepository(testCase) {
	const lines = String(testCase.code).split("\n");
	const diff = [
		`diff --git a/${testCase.file} b/${testCase.file}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${testCase.file}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((line) => `+${line}`),
	].join("\n");
	const numbered = lines
		.map((line, index) => `${index + 1}: ${line}`)
		.join("\n");
	return {
		baseSha: "fixture-base",
		headSha: "fixture-head",
		changes: [
			{
				status: "A",
				path: testCase.file,
				additions: lines.length,
				deletions: 0,
			},
		],
		async executeTool(name, args = {}) {
			if (name === "get_changed_file_diff" && args.path === testCase.file)
				return { ok: true, path: testCase.file, content: diff };
			if (name === "read_file" && args.path === testCase.file)
				return { ok: true, path: testCase.file, content: numbered };
			if (name === "search_repository") {
				const query = String(args.query ?? "").toLowerCase();
				return {
					ok: true,
					matches: lines.flatMap((line, index) =>
						line.toLowerCase().includes(query)
							? [{ path: testCase.file, line: index + 1, text: line }]
							: [],
					),
				};
			}
			if (name === "list_repository")
				return { ok: true, paths: [testCase.file] };
			return { ok: false, error: "fixture path or tool not found" };
		},
	};
}

async function reviewFixture(agent, system, testCase) {
	return runRuleReviewer({
		agent,
		system,
		repository: fixtureRepository(testCase),
		runtime,
	});
}

const { agents, systems } = await loadSystems();
console.log(
	`set=${which} model=${MODEL} temp=${TEMPERATURE} runs=${RUNS} architecture=whole-pr-agent agents=[${agents.map((agent) => agent.id).join(", ")}] cases=${cases.length}\n`,
);

const pairs = cases.flatMap((testCase) =>
	agents.map((agent) => ({ testCase, agent })),
);
const pct = (value) => (value * 100).toFixed(1);
const prf = (tp, fp, fn) => {
	const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
	const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
	return {
		precision,
		recall,
		f1:
			precision + recall === 0
				? 0
				: (2 * precision * recall) / (precision + recall),
	};
};

let sumTP = 0;
let sumFP = 0;
let sumFN = 0;
const perAgent = Object.fromEntries(
	agents.map((agent) => [agent.id, { tp: 0, fp: 0, fn: 0 }]),
);
const fpCount = new Map();
const fnCount = new Map();

for (let run = 0; run < RUNS; run++) {
	const reviewed = await pool(pairs, CONC, ({ testCase, agent }) =>
		reviewFixture(agent, systems.get(agent.id), testCase),
	);
	const incomplete = reviewed
		.map((result, index) => ({ result, pair: pairs[index] }))
		.filter(({ result }) => result.status !== "complete");
	if (incomplete.length) {
		for (const { result, pair } of incomplete)
			console.error(
				`incomplete ${pair.testCase.id}:${pair.agent.id}: ${result.reason}`,
			);
		throw new Error(
			`evaluation aborted: ${incomplete.length} reviewer session(s) incomplete`,
		);
	}
	const predicted = reviewed.map((result) => result.findings.length > 0);
	let TP = 0;
	let FP = 0;
	let FN = 0;
	pairs.forEach(({ testCase, agent }, index) => {
		const expected = expectedAgents(testCase).has(agent.id);
		if (predicted[index] && expected) {
			TP++;
			perAgent[agent.id].tp++;
		} else if (predicted[index] && !expected) {
			FP++;
			perAgent[agent.id].fp++;
			const key = `${testCase.id}:${agent.id}`;
			fpCount.set(key, (fpCount.get(key) ?? 0) + 1);
		} else if (!predicted[index] && expected) {
			FN++;
			perAgent[agent.id].fn++;
			const key = `${testCase.id}:${agent.id}`;
			fnCount.set(key, (fnCount.get(key) ?? 0) + 1);
		}
	});
	sumTP += TP;
	sumFP += FP;
	sumFN += FN;
	const { precision, recall, f1 } = prf(TP, FP, FN);
	console.log(
		`run ${run + 1}: TP=${TP} FP=${FP} FN=${FN}  P=${pct(precision)}%  R=${pct(recall)}%  F1=${pct(f1)}%`,
	);
}

const mean = prf(sumTP, sumFP, sumFN);
console.log(
	`\nmicro-avg over ${RUNS} run(s): P=${pct(mean.precision)}%  R=${pct(mean.recall)}%  F1=${pct(mean.f1)}%`,
);
console.log("\nper-agent (tp/fp/fn):");
for (const [id, scores] of Object.entries(perAgent))
	console.log(`  ${id.padEnd(12)} ${scores.tp}/${scores.fp}/${scores.fn}`);

if (fpCount.size) {
	console.log("\nfalse positives (case:agent → runs/total):");
	for (const [key, count] of [...fpCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${key}  ${count}/${RUNS}`);
}
if (fnCount.size) {
	console.log("\nmissed (case:agent → runs/total):");
	for (const [key, count] of [...fnCount.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${key}  ${count}/${RUNS}`);
}
