/**
 * Core types for the SessionBoard Eval Kit (sbek).
 *
 * A Spec (one per feature area, loaded from specs/*.yaml) contains:
 *  - scenarios: natural-language scripts a browser agent executes against the target URL
 *  - rubric: weighted, individually-judgeable criteria scored by an LLM judge from evidence
 *
 * Judging is implementation-agnostic: a clone may look completely different from
 * SessionBoard; the rubric describes functionality and filled-state expectations,
 * not pixel fidelity.
 */

export type Testability = "auto" | "auto-partial" | "manual";

export interface RubricItem {
  id: string; // e.g. "CFP-01"
  criterion: string;
  weight: 1 | 2 | 3; // 3 = core, 2 = important, 1 = polish
  testability: Testability;
  /** Scenario id(s) whose evidence covers this item. Empty for manual items. */
  scenarios?: string[];
  pass_criteria: string;
  /** What the judge should look for in the evidence. */
  evidence?: string;
  /** Human instructions for testability: manual (or the manual half of auto-partial). */
  manual_instructions?: string;
}

export interface Scenario {
  id: string; // e.g. "CFP-S1"
  name: string;
  persona: string; // organizer | speaker | reviewer | attendee
  /** Natural-language script for the browser agent. May reference fixture data. */
  steps: string;
  /** Signals the agent should watch for; passed to it verbatim. */
  success_signals?: string[];
  /** Skip unless credentials for this persona were provided in config. */
  requires_credentials?: boolean;
}

export interface Spec {
  area: string; // slug, e.g. "call-for-papers"
  title: string;
  prefix: string; // rubric id prefix, e.g. "CFP"
  optional?: boolean; // extra-credit area (e.g. speaker-crm)
  overview: string;
  personas?: string[];
  scenarios: Scenario[];
  rubric: RubricItem[];
}

// ---------------------------------------------------------------------------
// Evidence produced by the browser agent
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  turn: number;
  kind: "tool_call" | "tool_result" | "assistant_text";
  tool?: string;
  /** JSON-ish rendering, truncated for the judge. */
  detail: string;
}

export interface ScreenshotRef {
  /**
   * Path relative to the SCENARIO's evidence directory (runDir/<scenarioId>/),
   * always with forward slashes, e.g. "screenshots/003-cfp-form-filled.jpg".
   * Consumers prepend the scenario id to resolve from the run directory.
   */
  path: string;
  label: string;
  turn: number;
}

export type ScenarioOutcome =
  | "completed"
  | "blocked" // agent could not finish (error, missing credentials, broken flow)
  | "feature_not_found" // agent searched but the feature does not appear to exist
  | "agent_error"; // harness-level failure (exception, refusal, turn limit)

export interface ScenarioEvidence {
  scenarioId: string;
  scenarioName: string;
  outcome: ScenarioOutcome;
  summary: string;
  observations: string[];
  transcript: TranscriptEntry[];
  screenshots: ScreenshotRef[];
  startedAt: string;
  finishedAt: string;
  finalUrl?: string;
  turns: number;
}

// ---------------------------------------------------------------------------
// Judge output
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "partial" | "fail" | "not_found" | "cannot_judge";

export interface JudgedItem {
  id: string;
  verdict: Verdict;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  /** Screenshot paths / transcript turns cited as evidence. */
  evidence_refs: string[];
}

export interface Defect {
  severity: "critical" | "major" | "minor";
  description: string;
  where: string;
}

export interface AreaJudgement {
  area: string;
  items: JudgedItem[];
  defects: Defect[];
  area_notes: string;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface AreaScore {
  area: string;
  title: string;
  optional: boolean;
  /** weighted points earned / weighted points actually judged */
  earned: number;
  judgeable: number;
  /** Total weight of every rubric item in the area (judged or not). */
  totalWeight: number;
  pct: number | null; // null when nothing was judgeable
  /**
   * Share of the area's rubric weight that was actually scored. A high pct on
   * low coverage is a weak signal — read them together.
   */
  coveragePct: number;
  pendingManual: string[]; // rubric ids awaiting human verification
  items: JudgedItem[];
  defects: Defect[];
  notes: string;
  scenarios: ScenarioEvidence[];
}

export interface RunReport {
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  kitVersion: string;
  models: { agent: string; judge: string };
  areas: AreaScore[];
  overallPct: number | null;
  /** Share of required-area rubric weight that was actually scored. */
  overallCoveragePct: number;
  /**
   * True when coverage is too low for the headline score to be reportable.
   * Consumers must show "insufficient coverage" instead of overallPct.
   */
  scoreWithheld: boolean;
  manualPending: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PersonaCredentials {
  email?: string;
  password?: string;
  notes?: string;
}

export interface EvalConfig {
  url: string;
  /** Area slugs to run; empty/undefined = all non-optional + optional flagged with includeOptional. */
  areas?: string[];
  /** Scenario ids to run within the selected areas; empty/undefined = all of them. */
  scenarios?: string[];
  includeOptional?: boolean;
  /**
   * Override the fixture email for any persona (organizer, speaker, speaker2,
   * reviewer, attendee). Use your own inbox — with plus-addressing for distinct
   * accounts — when a submission verifies emails or sends magic links.
   */
  personaEmails?: Record<string, string>;
  credentials?: Record<string, PersonaCredentials>;
  agentModel?: string;
  judgeModel?: string;
  maxTurnsPerScenario?: number;
  headless?: boolean;
  /** Extra free-text context about the submission (e.g. "signup is open, seed data preloaded"). */
  submissionNotes?: string;
}
