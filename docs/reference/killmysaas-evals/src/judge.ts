import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AreaJudgement, EvalConfig, ScenarioEvidence, Spec } from "./types.js";

const JudgementSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["pass", "partial", "fail", "not_found", "cannot_judge"]),
      confidence: z.enum(["high", "medium", "low"]),
      reasoning: z.string(),
      evidence_refs: z.array(z.string()),
    }),
  ),
  defects: z.array(
    z.object({
      severity: z.enum(["critical", "major", "minor"]),
      description: z.string(),
      where: z.string(),
    }),
  ),
  area_notes: z.string(),
});

const JUDGE_SYSTEM = `You are an impartial software evaluator judging whether a web application implements specific functionality. The app is a third-party clone of SessionBoard (event call-for-papers / speaker & session management); it may look nothing like the original — judge FUNCTION against each criterion, never visual resemblance.

You receive: the rubric (criteria with pass conditions), and evidence gathered by a browser agent (scenario outcomes, its factual observations, an action transcript, and screenshots).

Rules:
- Judge ONLY from the evidence. Every verdict must cite specific evidence_refs: screenshot paths (e.g. "screenshots/003-cfp-form-filled.jpg") and/or observations/transcript turns (e.g. "obs: ...", "turn 12").
- pass: the criterion is clearly satisfied. partial: works but with a meaningful gap named in your reasoning. fail: attempted and broken/incorrect. not_found: the agent searched and the capability appears absent. cannot_judge: the evidence is insufficient to decide (e.g. the agent was blocked before reaching it) — do NOT guess.
- Distinguish "the clone lacks the feature" (not_found) from "the agent failed to reach it" (cannot_judge). Read the scenario outcome: 'blocked' or 'agent_error' usually means cannot_judge for downstream criteria.
- Be strict about evidence for 'pass': a form existing is not proof submission works; look for confirmation states, persisted data, list entries.
- Independently list defects you notice IN THE EVALUATED APPLICATION (broken flows, error states, data loss, misleading UI), even if no rubric item covers them. Defects describe the app, never the evaluation run: a turn limit, an agent that got lost, a harness error, or missing evidence is NOT a defect — that belongs in area_notes and in cannot_judge verdicts.
- Return a verdict for EVERY rubric item you were given, in the same order.`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "… (truncated)" : s);

function renderEvidence(evidence: ScenarioEvidence[], attached: Set<string>): string {
  return evidence
    .map((ev) => {
      const transcript = ev.transcript
        .map((t) => `  [turn ${t.turn}] ${t.kind}${t.tool ? ` ${t.tool}` : ""}: ${t.detail}`)
        .join("\n");
      const shots = ev.screenshots
        .map((s) => {
          const full = `${ev.scenarioId}/${s.path}`;
          return `  - ${full}${attached.has(full) ? " (ATTACHED below)" : " (not attached — cite only if the transcript describes it)"}`;
        })
        .join("\n");
      return [
        `=== SCENARIO ${ev.scenarioId}: ${ev.scenarioName} ===`,
        `outcome: ${ev.outcome} (${ev.turns} turns)`,
        `final url: ${ev.finalUrl ?? "unknown"}`,
        `agent summary: ${ev.summary}`,
        `observations:`,
        ...(ev.observations.length ? ev.observations.map((o) => `  - obs: ${o}`) : ["  (none)"]),
        `screenshots taken:`,
        shots || "  (none)",
        `transcript:`,
        clip(transcript, 14_000),
      ].join("\n");
    })
    .join("\n\n");
}

/** Judge sees at most this many screenshots per area. */
const MAX_JUDGE_IMAGES = 18;

/**
 * Allocate the image budget fairly across scenarios (round-robin from each
 * scenario's tail) so an image-heavy final scenario can't evict all evidence
 * from earlier ones. Missing files are dropped before the cap applies.
 */
function pickScreenshots(evidence: ScenarioEvidence[], runDir: string) {
  const perScenario = evidence.map((ev) =>
    ev.screenshots
      .map((s) => ({ label: `${ev.scenarioId}/${s.path}`, abs: path.join(runDir, ev.scenarioId, ...s.path.split("/")) }))
      .filter((s) => fs.existsSync(s.abs))
      .reverse(), // tail first: later shots usually show completed states
  );
  const picked: { label: string; abs: string }[] = [];
  for (let round = 0; picked.length < MAX_JUDGE_IMAGES; round++) {
    let took = false;
    for (const list of perScenario) {
      if (round < list.length && picked.length < MAX_JUDGE_IMAGES) {
        picked.push(list[round]);
        took = true;
      }
    }
    if (!took) break;
  }
  // Restore chronological-ish order (by scenario, then capture order).
  picked.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return picked.map((s) => ({
    label: s.label,
    base64: fs.readFileSync(s.abs).toString("base64"),
  }));
}

export async function judgeArea(opts: {
  client: Anthropic;
  config: EvalConfig;
  spec: Spec;
  evidence: ScenarioEvidence[];
  runDir: string;
}): Promise<AreaJudgement> {
  const { client, config, spec, evidence, runDir } = opts;

  const autoItems = spec.rubric.filter((r) => r.testability !== "manual");
  if (autoItems.length === 0) {
    return { area: spec.area, items: [], defects: [], area_notes: "No auto-judgeable items." };
  }

  const rubricText = autoItems
    .map(
      (r) =>
        `- ${r.id} (weight ${r.weight}${r.testability === "auto-partial" ? ", auto-partial: judge only the UI-observable half" : ""}): ${r.criterion}\n  pass when: ${r.pass_criteria}${r.evidence ? `\n  look for: ${r.evidence}` : ""}`,
    )
    .join("\n");

  const shots = pickScreenshots(evidence, runDir);
  const attached = new Set(shots.map((s) => s.label));
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: [
        `FEATURE AREA: ${spec.title}`,
        `AREA OVERVIEW: ${spec.overview}`,
        ``,
        `RUBRIC (judge every item):`,
        rubricText,
        ``,
        `EVIDENCE:`,
        renderEvidence(evidence, attached),
        ``,
        `The following ${shots.length} screenshots are attached in order:`,
        ...shots.map((s, i) => `  image ${i + 1}: ${s.label}`),
      ].join("\n"),
    },
    ...shots.flatMap((s): Anthropic.ContentBlockParam[] => [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: s.base64 },
      },
    ]),
  ];

  const response = await client.messages.parse({
    model: config.judgeModel!,
    max_tokens: 16000,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(JudgementSchema) },
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return {
      area: spec.area,
      items: autoItems.map((r) => ({
        id: r.id,
        verdict: "cannot_judge" as const,
        confidence: "low" as const,
        reasoning: "Judge call failed or was refused; re-run this area.",
        evidence_refs: [],
      })),
      defects: [],
      area_notes: "Judge failure — verdicts are placeholders.",
    };
  }

  const parsed = response.parsed_output;

  // Guarantee one verdict per rubric item even if the model dropped/duplicated any.
  const byId = new Map(parsed.items.map((i) => [i.id, i]));
  const items = autoItems.map(
    (r) =>
      byId.get(r.id) ?? {
        id: r.id,
        verdict: "cannot_judge" as const,
        confidence: "low" as const,
        reasoning: "Judge omitted this item.",
        evidence_refs: [],
      },
  );

  return { area: spec.area, items, defects: parsed.defects, area_notes: parsed.area_notes };
}
