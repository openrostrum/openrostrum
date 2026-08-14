import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, newRunDir, parseArgs, KIT_VERSION, MIN_COVERAGE_PCT } from "./config.js";
import { loadFixtures, loadSpecs, selectSpecs } from "./specs.js";
import { captureAuth, hasAuthState } from "./auth.js";
import { initLog, log, closeLog } from "./log.js";
import { runScenarioWithRetries, isGenuineFinish } from "./agent.js";
import { judgeArea } from "./judge.js";
import { buildReport, scoreArea, writeHtmlReport, writeManualChecklist, finalizeReport } from "./report.js";
import type { AreaScore, RunReport, ScenarioEvidence } from "./types.js";

// Load ANTHROPIC_API_KEY (and friends) from a .env in the working directory, the
// way .env.example advertises. Without this the kit silently depended on the
// operator having exported the key by hand, and a whole run would burn through
// every scenario as agent_error before anyone noticed. Existing environment
// variables win — same precedence as node --env-file.
try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch {
  // No .env, or unreadable — the key may still come from the real environment.
}

const HELP = `sbek — SessionBoard Eval Kit v${KIT_VERSION}

Usage:
  pnpm run sbek -- <command> [flags]

Commands:
  list                         Show feature areas, scenarios, and rubric coverage
  run --url <url>              Evaluate a submission URL
      [--areas a,b,c]          Only these area slugs
      [--scenarios ID,ID]      Only these scenario ids (within the selected areas)
      [--max-turns N]          Cap agent turns per scenario (default 70)
      [--include-optional]     Include optional (extra-credit) areas
      [--resume <run dir>]     Continue a previous run: finished scenarios and
                               scored areas are reused; anything that crashed or
                               ran out of turns is re-run, and its area re-scored
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

/**
 * Read a scenario's stored evidence, or null when there is none to trust —
 * missing file, or a half-written one from a process that died mid-write. Both
 * mean "this scenario still has to run", never "abort the resume".
 */
function readEvidence(file: string): ScenarioEvidence | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ScenarioEvidence;
  } catch {
    return null;
  }
}

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
  // Scratch-copy only: route the JUDGE to a different provider than the browser
  // agent. Off unless JUDGE_BASE_URL is set, so default behaviour is unchanged.
  const judgeClient = process.env.JUDGE_BASE_URL
    ? new Anthropic({
        baseURL: process.env.JUDGE_BASE_URL,
        apiKey: process.env.JUDGE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      })
    : client;

  // --resume <dir>: reuse a previous run's finished scenarios and area scores.
  // "Finished" means the scenario reached an outcome of its own; evidence from
  // a crash or a turn-limit stop is kept for diagnosis but never reused, so
  // resuming re-runs exactly the work that did not really happen.
  const resumeDir = typeof args.flags.resume === "string" ? args.flags.resume : undefined;
  if (resumeDir && !fs.existsSync(resumeDir)) throw new Error(`No such run dir: ${resumeDir}`);
  const runDir = resumeDir ?? newRunDir();
  const logFile = initLog(runDir);

  const priorAreas = new Map<string, AreaScore>();
  let startedAt = new Date().toISOString();
  if (resumeDir) {
    const priorPath = path.join(runDir, "report.json");
    if (fs.existsSync(priorPath)) {
      const prior: RunReport = JSON.parse(fs.readFileSync(priorPath, "utf8"));
      for (const a of prior.areas) priorAreas.set(a.area, a);
      startedAt = prior.startedAt;
    }
    log(`Resuming ${runDir} — ${priorAreas.size} area(s) already scored`);
  }
  log(`Run dir: ${runDir}`);
  log(`Live log: tail -f ${logFile}`);
  const areaScores: AreaScore[] = [];

  const personas = [...new Set(specs.flatMap((s) => s.scenarios.map((sc) => sc.persona)))];
  const preAuthed = personas.filter((p) => hasAuthState(p, config.url));
  if (preAuthed.length) log(`Pre-authenticated personas: ${preAuthed.join(", ")}`);
  const unauthed = personas.filter((p) => !preAuthed.includes(p) && !config.credentials?.[p]);
  if (unauthed.length) {
    log(
      `No saved session or credentials for: ${unauthed.join(", ")} — those scenarios will sign up themselves, or end 'blocked' if the app requires email verification.`,
    );
    log(`  Tip: pnpm run sbek -- auth --persona <name>`);
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
    log(`\n=== Area: ${spec.title} ===`);

    // Whole area already scored and unchanged? Reuse it — no browser, no API.
    const prior = priorAreas.get(spec.area);
    // Every scenario must have genuinely finished. A crashed one is re-run
    // below, and its area score was computed from the missing evidence — reuse
    // it and the re-run changes nothing, leaving the harness failure baked into
    // the report as if it were a product result.
    const unfinished = spec.scenarios.filter((sc) => {
      const prevEv = readEvidence(path.join(runDir, sc.id, "evidence.json"));
      return !prevEv || !isGenuineFinish(prevEv);
    });
    // pct === null means nothing scored — a failed or refused judge call.
    // Reusing that would bake a harness failure into the report, so re-judge
    // it (evidence is on disk, so this costs one judge call, no browsing).
    const priorComplete = prior && prior.pct !== null && unfinished.length === 0;
    if (priorComplete) {
      log(`  reusing scored area from previous run (${prior!.pct ?? "n/a"}%)`);
      areaScores.push(prior!);
      continue;
    }
    if (prior && prior.pct !== null) {
      log(
        `  area was scored before (${prior.pct}%), but ${unfinished.map((s) => s.id).join(", ")} did not finish — re-running and re-scoring`,
      );
    }

    const evidence: ScenarioEvidence[] = [];
    let reusedAll = true;

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
        log(`  ~ ${scenario.id} skipped (needs '${scenario.persona}' credentials)`);
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
      const evidenceDir = path.join(runDir, scenario.id);
      const evidenceFile = path.join(evidenceDir, "evidence.json");
      const prev = readEvidence(evidenceFile);
      if (prev && isGenuineFinish(prev)) {
        log(`  = ${scenario.id}: reusing evidence (${prev.outcome}, ${prev.screenshots.length} screenshots)`);
        evidence.push(prev);
        continue;
      }
      if (prev) {
        // Scoring this would score the harness, not the submission.
        log(
          `  ↻ ${scenario.id}: previous attempt ended ${prev.outcome} (${prev.error ? `${prev.error.kind}: ${prev.error.message.split("\n")[0].slice(0, 120)}` : `stopped after ${prev.turns} turns`}) — re-running`,
        );
      }

      reusedAll = false;
      log(`  > ${scenario.id}: ${scenario.name} [${scenario.persona}]`);
      fs.mkdirSync(evidenceDir, { recursive: true });
      const result = await runScenarioWithRetries({
        client,
        config,
        scenario,
        areaTitle: spec.title,
        fixtures,
        evidenceDir,
      });
      log(
        `    outcome: ${result.outcome} (${result.turns} turns, ${result.screenshots.length} screenshots${(result.attempts ?? 1) > 1 ? `, ${result.attempts} attempts` : ""})`,
      );
      evidence.push(result);
      fs.writeFileSync(path.join(evidenceDir, "evidence.json"), JSON.stringify(result, null, 2));
    }

    log(`  judging ${spec.rubric.filter((r) => r.testability !== "manual").length} rubric item(s)...`);
    try {
      const judgement = await judgeArea({ client: judgeClient, config, spec, evidence, runDir });
      const score = scoreArea(spec, judgement, evidence);
      log(
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

  // Resuming with a narrower --areas selection must not delete areas the run
  // already scored: carry forward any prior area this pass didn't cover.
  for (const [area, prior] of priorAreas) {
    if (!areaScores.some((a) => a.area === area)) {
      log(`  carrying forward previously scored area: ${area} (${prior.pct ?? "n/a"}%)`);
      areaScores.push(prior);
    }
  }
  areaScores.sort((a, b) => a.area.localeCompare(b.area));

  const report = writeArtifacts();
  if (report.scoreWithheld) {
    log(
      `\nSCORE WITHHELD — only ${report.overallCoveragePct}% of rubric weight was judged (need ${MIN_COVERAGE_PCT}%).` +
        `\n  Provisional over the judged subset only: ${report.overallPct ?? "n/a"}% — not comparable across submissions.` +
        `\n  Raise coverage by working manual-checklist.md then running finalize, or re-run with more turns / pre-authenticated personas.`,
    );
  } else {
    log(
      `\nOverall: ${report.overallPct ?? "n/a"}%  (coverage: ${report.overallCoveragePct}% of rubric weight judged)`,
    );
  }
  log(`Report:  ${path.join(runDir, "report.html")}`);
  log(`Manual:  ${path.join(runDir, "manual-checklist.md")} (${report.manualPending} item(s))`);
  closeLog();
}

main().catch((err) => {
  // Log the failure into run.log too, and point at the resume command — the
  // run directory already holds every completed scenario and area score.
  try {
    log(`FATAL: ${err?.message ?? String(err)}`);
    log(`Resume with: pnpm run eval -- --resume <run dir> [--config <file>]`);
    closeLog();
  } catch {}
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
