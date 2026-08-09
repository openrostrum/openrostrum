import fs from "node:fs";
import path from "node:path";
import type {
  AreaJudgement,
  AreaScore,
  JudgedItem,
  RunReport,
  ScenarioEvidence,
  Spec,
  Verdict,
} from "./types.js";
import { KIT_VERSION, MIN_COVERAGE_PCT } from "./config.js";

const VERDICT_POINTS: Record<Verdict, number | null> = {
  pass: 1,
  partial: 0.5,
  fail: 0,
  not_found: 0,
  cannot_judge: null, // excluded from the denominator; routed to manual queue
};

export function scoreArea(
  spec: Spec,
  judgement: AreaJudgement,
  evidence: ScenarioEvidence[],
): AreaScore {
  let earned = 0;
  let judgeable = 0;
  const pendingManual: string[] = [];
  const byId = new Map(judgement.items.map((i) => [i.id, i]));

  for (const r of spec.rubric) {
    if (r.testability === "manual") {
      pendingManual.push(r.id);
      continue;
    }
    const item = byId.get(r.id);
    const points = item ? VERDICT_POINTS[item.verdict] : null;
    if (points === null || item === undefined) {
      pendingManual.push(r.id); // cannot_judge → human follow-up
      continue;
    }
    judgeable += r.weight;
    earned += points * r.weight;
    // auto-partial items also get a manual follow-up for the unverifiable half
    if (r.testability === "auto-partial" && r.manual_instructions) {
      pendingManual.push(r.id);
    }
  }

  const totalWeight = spec.rubric.reduce((s, r) => s + r.weight, 0);
  return {
    area: spec.area,
    title: spec.title,
    optional: Boolean(spec.optional),
    earned,
    judgeable,
    totalWeight,
    pct: judgeable > 0 ? Math.round((earned / judgeable) * 1000) / 10 : null,
    coveragePct: totalWeight > 0 ? Math.round((judgeable / totalWeight) * 1000) / 10 : 0,
    pendingManual,
    items: judgement.items,
    defects: judgement.defects,
    notes: judgement.area_notes,
    scenarios: evidence,
  };
}

export function buildReport(opts: {
  targetUrl: string;
  startedAt: string;
  models: { agent: string; judge: string };
  areas: AreaScore[];
}): RunReport {
  const { targetUrl, startedAt, models, areas } = opts;
  const required = areas.filter((a) => !a.optional);
  const totalEarned = required.reduce((s, a) => s + a.earned, 0);
  const totalJudgeable = required.reduce((s, a) => s + a.judgeable, 0);
  const totalWeight = required.reduce((s, a) => s + a.totalWeight, 0);
  const coverage = totalWeight > 0 ? Math.round((totalJudgeable / totalWeight) * 1000) / 10 : 0;
  return {
    targetUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    kitVersion: KIT_VERSION,
    models,
    areas,
    overallPct: totalJudgeable > 0 ? Math.round((totalEarned / totalJudgeable) * 1000) / 10 : null,
    overallCoveragePct: coverage,
    scoreWithheld: coverage < MIN_COVERAGE_PCT,
    manualPending: areas.reduce((s, a) => s + a.pendingManual.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Manual verification queue
// ---------------------------------------------------------------------------

export function writeManualChecklist(runDir: string, specs: Spec[], report: RunReport): void {
  const lines: string[] = [
    `# Manual verification checklist`,
    ``,
    `Target: ${report.targetUrl}`,
    `Run: ${runDir}`,
    ``,
    `These rubric items could not be verified automatically (or only half-verified).`,
    `For each item: perform the check, then record the result in \`manual-results.json\``,
    `and run \`npm run finalize -- --run ${runDir}\` to fold it into the final score.`,
    ``,
  ];
  const template: Record<string, { verdict: string; notes: string }> = {};

  for (const area of report.areas) {
    if (area.pendingManual.length === 0) continue;
    const spec = specs.find((s) => s.area === area.area)!;
    lines.push(`## ${area.title}`, ``);
    for (const id of area.pendingManual) {
      const r = spec.rubric.find((x) => x.id === id);
      if (!r) continue;
      const auto = area.items.find((i) => i.id === id);
      lines.push(
        `### ${r.id} (weight ${r.weight}) — ${r.criterion}`,
        ``,
        `- Pass when: ${r.pass_criteria}`,
        r.manual_instructions ? `- How to verify: ${r.manual_instructions}` : `- How to verify: (agent could not reach this — verify by hand: ${r.evidence ?? r.pass_criteria})`,
        auto ? `- Auto-judge said: ${auto.verdict} — ${auto.reasoning}` : ``,
        ``,
      );
      template[r.id] = { verdict: "pass | partial | fail | not_found", notes: "" };
    }
  }

  fs.writeFileSync(path.join(runDir, "manual-checklist.md"), lines.join("\n"));
  // Merge new pending items into the results template without clobbering
  // anything a human already filled in (the checklist is rewritten after
  // every area and again on finalize).
  const resultsPath = path.join(runDir, "manual-results.json");
  let existing: Record<string, { verdict: string; notes: string }> = {};
  if (fs.existsSync(resultsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    } catch {
      /* corrupted template — regenerate below */
    }
  }
  fs.writeFileSync(resultsPath, JSON.stringify({ ...template, ...existing }, null, 2));
}

/** Merge human manual-results.json verdicts into the report and rescore. */
export function finalizeReport(runDir: string, specs: Spec[]): RunReport {
  const report: RunReport = JSON.parse(
    fs.readFileSync(path.join(runDir, "report.json"), "utf8"),
  );
  const manualPath = path.join(runDir, "manual-results.json");
  if (!fs.existsSync(manualPath)) {
    throw new Error(`No manual-results.json in ${runDir}`);
  }
  const manual: Record<string, { verdict: string; notes?: string }> = JSON.parse(
    fs.readFileSync(manualPath, "utf8"),
  );

  const pendingEverywhere = new Set(report.areas.flatMap((a) => a.pendingManual));
  for (const key of Object.keys(manual)) {
    if (!pendingEverywhere.has(key)) {
      console.warn(
        `manual-results.json entry "${key}" is not pending (already finalized, or unknown id) — ignored. Edit report.json directly to correct an already-finalized verdict.`,
      );
    }
  }

  for (const area of report.areas) {
    const spec = specs.find((s) => s.area === area.area);
    if (!spec) continue;
    const remaining: string[] = [];
    for (const id of area.pendingManual) {
      const entry = manual[id];
      const verdict = entry?.verdict?.trim().toLowerCase() as Verdict | undefined;
      if (!verdict || !(verdict in VERDICT_POINTS) || VERDICT_POINTS[verdict] === null) {
        if (entry?.verdict && !entry.verdict.includes("|")) {
          console.warn(
            `manual-results.json: unrecognized verdict "${entry.verdict}" for ${id} — expected pass | partial | fail | not_found. Left pending.`,
          );
        }
        remaining.push(id);
        continue;
      }
      const r = spec.rubric.find((x) => x.id === id)!;
      const prior = area.items.find((i) => i.id === id);
      if (r.testability === "auto-partial" && prior && VERDICT_POINTS[prior.verdict] !== null) {
        // Item was already scored from its auto half; the human verdict on the
        // real-world half overrides those points rather than adding weight.
        area.earned +=
          ((VERDICT_POINTS[verdict] as number) - (VERDICT_POINTS[prior.verdict] as number)) *
          r.weight;
      } else {
        area.judgeable += r.weight;
        area.earned += (VERDICT_POINTS[verdict] as number) * r.weight;
      }
      const judged: JudgedItem = {
        id,
        verdict,
        confidence: "high",
        reasoning: `Manual verification: ${entry.notes ?? "(no notes)"}`,
        evidence_refs: ["manual"],
      };
      const existing = area.items.findIndex((i) => i.id === id);
      if (existing >= 0) area.items[existing] = judged;
      else area.items.push(judged);
    }
    area.pendingManual = remaining;
    area.pct = area.judgeable > 0 ? Math.round((area.earned / area.judgeable) * 1000) / 10 : null;
    area.coveragePct =
      area.totalWeight > 0 ? Math.round((area.judgeable / area.totalWeight) * 1000) / 10 : 0;
  }

  const required = report.areas.filter((a) => !a.optional);
  const totalEarned = required.reduce((s, a) => s + a.earned, 0);
  const totalJudgeable = required.reduce((s, a) => s + a.judgeable, 0);
  const totalWeight = required.reduce((s, a) => s + a.totalWeight, 0);
  report.overallPct =
    totalJudgeable > 0 ? Math.round((totalEarned / totalJudgeable) * 1000) / 10 : null;
  report.overallCoveragePct =
    totalWeight > 0 ? Math.round((totalJudgeable / totalWeight) * 1000) / 10 : 0;
  report.scoreWithheld = report.overallCoveragePct < MIN_COVERAGE_PCT;
  report.manualPending = report.areas.reduce((s, a) => s + a.pendingManual.length, 0);

  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  writeHtmlReport(runDir, report);
  // Regenerate the checklist so it reflects only the still-pending items.
  writeManualChecklist(runDir, specs, report);
  return report;
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const VERDICT_COLOR: Record<string, string> = {
  pass: "#1a7f37",
  partial: "#9a6700",
  fail: "#cf222e",
  not_found: "#cf222e",
  cannot_judge: "#6e7781",
};

export function writeHtmlReport(runDir: string, report: RunReport): void {
  const areaRows = report.areas
    .map(
      (a) => `
    <tr>
      <td><a href="#${esc(a.area)}">${esc(a.title)}</a>${a.optional ? " <em>(optional)</em>" : ""}</td>
      <td>${a.pct === null ? "—" : a.pct + "%"}</td>
      <td class="${a.coveragePct < 60 ? "lowcov" : ""}">${a.coveragePct}%</td>
      <td>${a.earned.toFixed(1)} / ${a.judgeable} of ${a.totalWeight}</td>
      <td>${a.pendingManual.length}</td>
      <td>${a.defects.length}</td>
    </tr>`,
    )
    .join("");

  const areaSections = report.areas
    .map((a) => {
      const items = a.items
        .map(
          (i) => `
        <tr>
          <td>${esc(i.id)}</td>
          <td style="color:${VERDICT_COLOR[i.verdict] ?? "#000"};font-weight:600">${esc(i.verdict)}</td>
          <td>${esc(i.confidence)}</td>
          <td>${esc(i.reasoning)}<br><small>${esc(i.evidence_refs.join(", "))}</small></td>
        </tr>`,
        )
        .join("");
      const defects = a.defects
        .map((d) => `<li><strong>[${esc(d.severity)}]</strong> ${esc(d.description)} <em>(${esc(d.where)})</em></li>`)
        .join("");
      const scenarios = a.scenarios
        .map((ev) => {
          const shots = ev.screenshots
            .map((s) => {
              // Forward slashes: these are URLs relative to report.html, not OS paths.
              const href = esc(`${ev.scenarioId}/${s.path}`);
              return `<figure><a href="${href}"><img loading="lazy" src="${href}" width="320"></a><figcaption>${esc(s.label)} (turn ${s.turn})</figcaption></figure>`;
            })
            .join("");
          return `<details><summary><strong>${esc(ev.scenarioId)}</strong> ${esc(ev.scenarioName)} — ${esc(ev.outcome)} (${ev.turns} turns)</summary>
            <p>${esc(ev.summary)}</p>
            ${ev.observations.length ? `<ul>${ev.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
            <div class="shots">${shots}</div>
          </details>`;
        })
        .join("");
      return `
      <section id="${esc(a.area)}">
        <h2>${esc(a.title)} — ${a.pct === null ? "n/a" : a.pct + "%"} <small>(coverage ${a.coveragePct}% of rubric weight)</small></h2>
        <p>${esc(a.notes)}</p>
        <table><thead><tr><th>Item</th><th>Verdict</th><th>Confidence</th><th>Reasoning</th></tr></thead><tbody>${items}</tbody></table>
        ${a.pendingManual.length ? `<p><strong>Pending manual verification:</strong> ${a.pendingManual.map(esc).join(", ")} (see manual-checklist.md)</p>` : ""}
        ${defects ? `<h3>Defects</h3><ul>${defects}</ul>` : ""}
        <h3>Scenario evidence</h3>
        ${scenarios}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>sbek report — ${esc(report.targetUrl)}</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; color: #1f2328; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; }
  .shots { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; } figcaption { font-size: 12px; color: #57606a; max-width: 320px; }
  .overall { font-size: 2.2rem; font-weight: 700; }
  .cov { font-size: 1rem; font-weight: 600; color: #57606a; margin-left: .75rem; }
  .lowcov { color: #cf222e; font-weight: 700; }
  .withheld { color: #cf222e; }
  .warn { background: #fff8c5; border: 1px solid #d4a72c; padding: .75rem 1rem; border-radius: 6px; }
  section { border-top: 1px solid #d0d7de; margin-top: 2rem; padding-top: 1rem; }
  details { margin: .5rem 0; } summary { cursor: pointer; }
</style></head>
<body>
  <h1>SessionBoard Eval Kit report</h1>
  <p>Target: <a href="${esc(report.targetUrl)}">${esc(report.targetUrl)}</a><br>
  Run: ${esc(report.startedAt)} → ${esc(report.finishedAt)} · kit v${esc(report.kitVersion)} · agent ${esc(report.models.agent)} · judge ${esc(report.models.judge)}</p>
  ${
    report.scoreWithheld
      ? `<p class="overall withheld">Score withheld — insufficient coverage
    <span class="cov lowcov">only ${report.overallCoveragePct}% of rubric weight judged</span></p>
  <p class="warn"><strong>No headline score is reported for this run.</strong> A percentage computed over ${report.overallCoveragePct}% of the rubric is not comparable to other submissions and reads far better than it is evidenced. Provisional figure over the judged subset only: <strong>${report.overallPct === null ? "n/a" : report.overallPct + "%"}</strong>. To obtain a reportable score, work through <code>manual-checklist.md</code> and re-run <code>finalize</code>, and/or re-run the evaluation with a higher <code>--max-turns</code> or pre-authenticated personas.</p>`
      : `<p class="overall">Overall: ${report.overallPct === null ? "n/a" : report.overallPct + "%"}
    <span class="cov">coverage ${report.overallCoveragePct}%</span></p>
  <p><strong>Read score and coverage together.</strong> The score is computed only over rubric weight that was actually judged; coverage is the share of total rubric weight that reached a verdict.</p>`
  }
  <p>${report.manualPending} rubric item(s) awaiting manual verification — see <code>manual-checklist.md</code>.</p>
  <table><thead><tr><th>Area</th><th>Score</th><th>Coverage</th><th>Weighted points</th><th>Manual pending</th><th>Defects</th></tr></thead>
  <tbody>${areaRows}</tbody></table>
  ${areaSections}
</body></html>`;

  fs.writeFileSync(path.join(runDir, "report.html"), html);
}
