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
const MAX_JUDGE_IMAGES = 40;

/**
 * The Messages API rejects any image over 2000px on a side in a many-image
 * request, and one oversized image fails the WHOLE call — losing an entire
 * area's judgement. Captures are clamped at write time, but evidence from
 * older runs may not be, so screen it here too.
 */
const MAX_IMAGE_EDGE = 2000;

/** Width/height straight from the JPEG SOF header; null if unparseable. */
function jpegSize(file: string): { w: number; h: number } | null {
  try {
    const b = fs.readFileSync(file);
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // SOF0-SOF15, excluding DHT(c4)/JPG(c8)/DAC(cc)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Allocate the image budget fairly across scenarios (round-robin from each
 * scenario's tail) so an image-heavy final scenario can't evict all evidence
 * from earlier ones. Missing files are dropped before the cap applies.
 */
function pickScreenshots(evidence: ScenarioEvidence[], runDir: string) {
  let oversized = 0;
  const perScenario = evidence.map((ev) =>
    ev.screenshots
      .map((s) => ({ label: `${ev.scenarioId}/${s.path}`, abs: path.join(runDir, ev.scenarioId, ...s.path.split("/")) }))
      .filter((s) => {
        if (!fs.existsSync(s.abs)) return false;
        const dim = jpegSize(s.abs);
        if (dim && (dim.w > MAX_IMAGE_EDGE || dim.h > MAX_IMAGE_EDGE)) {
          oversized++;
          return false; // one of these would 400 the entire judge call
        }
        return true;
      })
      .reverse(), // tail first: later shots usually show completed states
  );
  if (oversized > 0) {
    console.warn(
      `  note: ${oversized} screenshot(s) exceed ${MAX_IMAGE_EDGE}px and were withheld from the judge (older evidence; captures are clamped now)`,
    );
  }
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

  // A 17-item rubric with cited reasoning plus a defect list overruns 16k and
  // truncates mid-JSON, failing the whole area's parse — so budget 32k. The SDK
  // requires streaming at that size, so stream and parse the final message.
  const stream = client.messages.stream({
    model: config.judgeModel!,
    max_tokens: 32000,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(JudgementSchema) },
  });
  const message = await stream.finalMessage();
  // Scratch-copy instrumentation only (judge A/B token accounting).
  console.log(`  [usage] ${config.judgeModel} ${JSON.stringify(message.usage)}`);

  let parsedOutput: z.infer<typeof JudgementSchema> | null = null;
  if (message.stop_reason !== "refusal") {
    const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    try {
      parsedOutput = JudgementSchema.parse(JSON.parse(text));
    } catch (err: any) {
      console.warn(`  judge output did not parse for ${spec.area}: ${err?.message?.slice(0, 160)}`);
    }
  }
  const response = { stop_reason: message.stop_reason, parsed_output: parsedOutput };

  if (response.stop_reason === "max_tokens") {
    console.warn(
      `  judge output hit max_tokens for ${spec.area} — verdicts may be truncated; re-judge with a higher cap`,
    );
  }
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
