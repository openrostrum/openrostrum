import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, newRunDir, parseArgs, KIT_VERSION, MIN_COVERAGE_PCT } from "./config.js";
import { loadFixtures, loadSpecs, selectSpecs } from "./specs.js";
import { captureAuth, hasAuthState } from "./auth.js";
import { runScenario } from "./agent.js";
import { judgeArea } from "./judge.js";
import { buildReport, scoreArea, writeHtmlReport, writeManualChecklist, finalizeReport } from "./report.js";
import type { AreaScore, RunReport, ScenarioEvidence } from "./types.js";

const HELP = `sbek — SessionBoard Eval Kit v${KIT_VERSION}

Usage:
  npm run sbek -- <command> [flags]

Commands:
  list                         Show feature areas, scenarios, and rubric coverage
  run --url <url>              Evaluate a submission URL
      [--areas a,b,c]          Only these area slugs
      [--scenarios ID,ID]      Only these scenario ids (within the selected areas)
      [--max-turns N]          Cap agent turns per scenario (default 70)
      [--include-optional]     Include optional (extra-credit) areas
      [--config <file>]        Config file (default evalconfig.json)
      [--dry-run]              Validate specs + print the plan; no browser, no API calls
      [--headed]               Show the browser window
      [--agent-model <id>] [--judge-model <id>]
  auth --persona <name>        Sign in once by hand in a real browser window and save
       [--at /login]           the session, so scenarios for that persona start already
       [--click "<text>"]      logged in (for magic-link / OAuth submissions).
       [--url <url>]           --at opens a specific page instead of the site root.
                               --click "<text>" completes a one-click demo login with no
                               human step (headless); omit it for a hands-on login.
                               Personas: organizer | speaker | reviewer | attendee
  rescore --run <dir>          Rebuild report.html/json from a run's stored evidence
                               and judgements (no API calls). Re-run finalize after.
  finalize --run <dir>         Merge manual-results.json into the report and rescore

Environment:
  ANTHROPIC_API_KEY            required for 'run' (not for --dry-run / list / finalize)
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help") {
    console.log(HELP);
    return;
  }

  if (args.command === "list") {
    const specs = loadSpecs();
    for (const s of specs) {
      const auto = s.rubric.filter((r) => r.testability === "auto").length;
      const partial = s.rubric.filter((r) => r.testability === "auto-partial").length;
      const manual = s.rubric.filter((r) => r.testability === "manual").length;
      console.log(
        `${s.area.padEnd(28)} ${s.title.padEnd(34)} ${String(s.scenarios.length).padStart(2)} scenarios  rubric: ${auto} auto / ${partial} partial / ${manual} manual${s.optional ? "  (optional)" : ""}`,
      );
    }
    return;
  }

  if (args.command === "auth") {
    const persona = String(args.flags.persona ?? "");
    if (!persona) throw new Error("auth requires --persona <organizer|speaker|reviewer|attendee>");
    const config = loadConfig(args);
    const startAt = typeof args.flags.at === "string" ? args.flags.at : undefined;
    const autoClick = typeof args.flags.click === "string" ? args.flags.click : undefined;
    const saved = await captureAuth(persona, config, startAt, autoClick);
    console.log(`\nDone. Re-run this command any time the session expires: ${saved}`);
    return;
  }

  if (args.command === "rescore") {
    const runDir = String(args.flags.run ?? "");
    if (!runDir) throw new Error("rescore requires --run <dir>");
    const specs = loadSpecs();
    const prior: RunReport = JSON.parse(fs.readFileSync(path.join(runDir, "report.json"), "utf8"));
    const areas = prior.areas.map((a) => {
      const spec = specs.find((s) => s.area === a.area);
      if (!spec) throw new Error(`No spec for area "${a.area}" — was it renamed or removed?`);
      // Judged verdicts and evidence are both persisted in the report, so the
      // whole report can be rebuilt with current scoring logic, offline.
      return scoreArea(
        spec,
        { area: a.area, items: a.items, defects: a.defects, area_notes: a.notes },
        a.scenarios,
      );
    });
    const rebuilt = buildReport({
      targetUrl: prior.targetUrl,
      startedAt: prior.startedAt,
      models: prior.models,
      areas,
    });
    fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(rebuilt, null, 2));
    writeHtmlReport(runDir, rebuilt);
    writeManualChecklist(runDir, specs, rebuilt);
    console.log(
      `Rescored ${runDir}: ${rebuilt.overallPct ?? "n/a"}% over ${rebuilt.overallCoveragePct}% coverage, ${rebuilt.manualPending} manual item(s) pending.`,
    );
    if (fs.existsSync(path.join(runDir, "manual-results.json"))) {
      console.log("  Note: re-run `finalize` to re-apply any manual verdicts.");
    }
    return;
  }

  if (args.command === "finalize") {
    const runDir = String(args.flags.run ?? "");
    if (!runDir) throw new Error("finalize requires --run <dir>");
    const specs = loadSpecs();
    const report = finalizeReport(runDir, specs);
    console.log(`Finalized. Overall: ${report.overallPct ?? "n/a"}%  (${report.manualPending} manual item(s) still pending)`);
    return;
  }

  if (args.command !== "run") {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(args);
  const specs = selectSpecs(loadSpecs(), config.areas, Boolean(config.includeOptional));
  const fixtures = loadFixtures(config);

  if (args.flags["dry-run"]) {
    console.log(`Would evaluate ${config.url} across ${specs.length} area(s):`);
    for (const s of specs) {
      console.log(`\n${s.title} (${s.area})`);
      for (const sc of s.scenarios) console.log(`  scenario ${sc.id}: ${sc.name} [${sc.persona}]`);
      for (const r of s.rubric) console.log(`  rubric   ${r.id} [w${r.weight}, ${r.testability}]`);
    }
    console.log(`\nSpecs valid. Agent model: ${config.agentModel}, judge model: ${config.judgeModel}.`);
    return;
  }

  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth profile from env
  const runDir = newRunDir();
  console.log(`Run dir: ${runDir}`);
  const startedAt = new Date().toISOString();
  const areaScores: AreaScore[] = [];

  const personas = [...new Set(specs.flatMap((s) => s.scenarios.map((sc) => sc.persona)))];
  const preAuthed = personas.filter((p) => hasAuthState(p, config.url));
  if (preAuthed.length) console.log(`Pre-authenticated personas: ${preAuthed.join(", ")}`);
  const unauthed = personas.filter((p) => !preAuthed.includes(p) && !config.credentials?.[p]);
  if (unauthed.length) {
    console.log(
      `No saved session or credentials for: ${unauthed.join(", ")} — those scenarios will sign up themselves, or end 'blocked' if the app requires email verification.`,
    );
    console.log(`  Tip: npm run sbek -- auth --persona <name>`);
  }

  // Incremental persistence: after each area, write a partial report so a
  // crash or API failure late in the run never loses completed area scores.
  const writeArtifacts = () => {
    const report = buildReport({
      targetUrl: config.url,
      startedAt,
      models: { agent: config.agentModel!, judge: config.judgeModel! },
      areas: areaScores,
    });
    fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
    writeHtmlReport(runDir, report);
    writeManualChecklist(runDir, specs, report);
    return report;
  };

  for (const spec of specs) {
    console.log(`\n=== Area: ${spec.title} ===`);
    const evidence: ScenarioEvidence[] = [];

    for (const scenario of spec.scenarios) {
      if (config.scenarios?.length && !config.scenarios.includes(scenario.id)) {
        // Filtered out by --scenarios: record it as not-run so the judge marks
        // dependent rubric items cannot_judge rather than failing them.
        evidence.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          outcome: "blocked",
          summary: "NOT RUN — excluded by the --scenarios filter. No evidence was gathered; rubric items relying on this scenario cannot be judged.",
          observations: [],
          transcript: [],
          screenshots: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          turns: 0,
        });
        continue;
      }
      const personaReady =
        Boolean(config.credentials?.[scenario.persona]) || hasAuthState(scenario.persona, config.url);
      if (scenario.requires_credentials && !personaReady) {
        console.log(`  ~ ${scenario.id} skipped (needs '${scenario.persona}' credentials)`);
        evidence.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          outcome: "blocked",
          summary: `Skipped: persona '${scenario.persona}' has neither credentials in evalconfig.json nor a saved session (run: sbek auth --persona ${scenario.persona}).`,
          observations: [],
          transcript: [],
          screenshots: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          turns: 0,
        });
        continue;
      }
      console.log(`  > ${scenario.id}: ${scenario.name}`);
      const evidenceDir = path.join(runDir, scenario.id);
      fs.mkdirSync(evidenceDir, { recursive: true });
      const result = await runScenario({
        client,
        config,
        scenario,
        areaTitle: spec.title,
        fixtures,
        evidenceDir,
      });
      console.log(`    outcome: ${result.outcome} (${result.turns} turns, ${result.screenshots.length} screenshots)`);
      evidence.push(result);
      fs.writeFileSync(path.join(evidenceDir, "evidence.json"), JSON.stringify(result, null, 2));
    }

    console.log(`  judging ${spec.rubric.filter((r) => r.testability !== "manual").length} rubric item(s)...`);
    try {
      const judgement = await judgeArea({ client, config, spec, evidence, runDir });
      const score = scoreArea(spec, judgement, evidence);
      console.log(
        `  score: ${score.pct ?? "n/a"}% over ${score.coveragePct}% coverage (${score.judgeable}/${score.totalWeight} weight judged)  manual pending: ${score.pendingManual.length}  defects: ${score.defects.length}`,
      );
      areaScores.push(score);
    } catch (err: any) {
      // A failed judge call must not lose earlier areas: score everything in
      // this area cannot_judge (routes to the manual queue) and continue.
      console.error(`  judge failed for ${spec.area}: ${err?.message ?? err}`);
      const judgement = {
        area: spec.area,
        items: spec.rubric
          .filter((r) => r.testability !== "manual")
          .map((r) => ({
            id: r.id,
            verdict: "cannot_judge" as const,
            confidence: "low" as const,
            reasoning: `Judge call failed: ${err?.message ?? err}. Verify manually or re-run this area.`,
            evidence_refs: [],
          })),
        defects: [],
        area_notes: "Judge call failed — all items routed to the manual queue.",
      };
      areaScores.push(scoreArea(spec, judgement, evidence));
    }
    writeArtifacts();
  }

  const report = writeArtifacts();
  if (report.scoreWithheld) {
    console.log(
      `\nSCORE WITHHELD — only ${report.overallCoveragePct}% of rubric weight was judged (need ${MIN_COVERAGE_PCT}%).` +
        `\n  Provisional over the judged subset only: ${report.overallPct ?? "n/a"}% — not comparable across submissions.` +
        `\n  Raise coverage by working manual-checklist.md then running finalize, or re-run with more turns / pre-authenticated personas.`,
    );
  } else {
    console.log(
      `\nOverall: ${report.overallPct ?? "n/a"}%  (coverage: ${report.overallCoveragePct}% of rubric weight judged)`,
    );
  }
  console.log(`Report:  ${path.join(runDir, "report.html")}`);
  console.log(`Manual:  ${path.join(runDir, "manual-checklist.md")} (${report.manualPending} item(s))`);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
