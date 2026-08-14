/**
 * Judge A/B: run the kit's OWN judge over identical stored evidence, once per
 * model, so any verdict difference is judgment and not evidence modality.
 *
 * Scratch harness only — the kit's src/ and specs/ are never modified.
 * Usage: tsx judge-ab.mts <runDir> <area> <label>=<model>[@<baseUrl>#<key>] ...
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { judgeArea } from "./src/judge.js";
import { loadSpecs } from "./src/specs.js";
import type { EvalConfig, ScenarioEvidence } from "./src/types.js";

const [runDir, area, ...modelArgs] = process.argv.slice(2);
if (!runDir || !area || !modelArgs.length) {
	console.error("usage: tsx judge-ab.mts <runDir> <area> label=model[@baseUrl#key] ...");
	process.exit(1);
}

const spec = loadSpecs().find((s) => s.area === area);
if (!spec) throw new Error(`no spec for area ${area}`);

// Same bundles, byte-for-byte, for every judge. Scenario order follows the
// spec so the evidence list is identical across runs.
const evidence: ScenarioEvidence[] = spec.scenarios
	.map((sc) => path.join(runDir, sc.id, "evidence.json"))
	.filter((p) => fs.existsSync(p))
	.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as ScenarioEvidence);

console.log(`area: ${spec.area} — ${evidence.length} scenario bundle(s)`);
for (const ev of evidence)
	console.log(`  ${ev.scenarioId}: outcome=${ev.outcome} turns=${ev.turns} shots=${ev.screenshots.length}`);
console.log(`auto-judgeable rubric items: ${spec.rubric.filter((r) => r.testability !== "manual").length}`);

const out: Record<string, unknown> = {};
for (const arg of modelArgs) {
	const [label, rest] = arg.split("=");
	const [model, gateway] = rest.split("@");
	const [baseURL, apiKey] = gateway ? gateway.split("#") : [undefined, undefined];
	const client = new Anthropic({
		...(baseURL ? { baseURL } : {}),
		...(apiKey ? { apiKey } : {}),
	});
	const config = { judgeModel: model } as EvalConfig;
	const started = Date.now();
	console.log(`\n=== judging with ${label} (${model}${baseURL ? ` via ${baseURL}` : ""}) ===`);
	try {
		const judgement = await judgeArea({ client, config, spec, evidence, runDir });
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		console.log(`${label}: ${judgement.items.length} verdicts, ${judgement.defects.length} defects, ${seconds}s`);
		out[label] = { model, seconds: Number(seconds), judgement };
	} catch (error) {
		console.log(`${label}: FAILED — ${(error as Error).message}`);
		out[label] = { model, error: String((error as Error).message) };
	}
}

const dest = path.join(runDir, "judge-ab.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`\nwrote ${dest}`);
