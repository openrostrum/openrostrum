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

/**
 * The KIND of problem an item probes. Clones cluster hard on `exists`/`crud`
 * and fall over on `rule`/`scoping`/`handoff`, so scoring by area alone averages
 * away the most discriminating signal. Every rubric item declares one.
 */
export const RUBRIC_TYPES = [
  "exists", // the capability/screen is present and reachable at all
  "crud", // create or edit something and it persists
  "roundtrip", // what one role/screen wrote is what another role/screen reads
  "handoff", // data crosses a module boundary without re-entry (accepted → session → public)
  "rule", // a stated behaviour or constraint is actually enforced (deadline, conflict, filter, approval gate)
  "scoping", // authz & isolation: a role sees exactly what it should, and nothing more
  "bulk", // operations at scale: CSV import, bulk email, ZIP export, auto-distribution
  "side-effect", // egress the browser cannot observe: real email delivery, calendar files
  "depth", // differentiators and polish beyond the core loop
] as const;

export type RubricType = (typeof RUBRIC_TYPES)[number];

export interface RubricItem {
  id: string; // e.g. "CFP-01"
  criterion: string;
  weight: 1 | 2 | 3; // 3 = core, 2 = important, 1 = polish
  /** Which kind of problem this probes. Reporting only — never affects points. */
  type: RubricType;
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
  /**
   * Share of the overall score this area carries, independent of how many
   * rubric items it happens to contain. Required areas sum to 100. Without
   * this the overall score would weight areas by rubric verbosity, which is an
   * authoring accident rather than a judgement about what matters.
   */
  area_weight: number;
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

/**
 * Why a scenario died at the HARNESS level. Recorded only for faults the run
 * itself is responsible for — an exception or a model refusal — never for an
 * outcome the agent chose or for a turn-limit stop (a budget decision, not a
 * fault). Persisted into evidence.json and mirrored into run.log, because a
 * crashed scenario with no error text is undiagnosable after the fact.
 */
export interface ScenarioError {
  kind: "exception" | "refusal";
  message: string;
  stack?: string;
  /** Agent turn in flight when it failed. */
  turn: number;
  /** Page URL at the moment of failure, when the browser was still alive. */
  url?: string;
  /** Last tool the agent invoked before the failure, and its (clipped) input. */
  lastTool?: string;
  lastToolInput?: string;
  at: string;
}

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
  /** Set when THIS evidence ended in a harness fault. Absent = the run's own doing. */
  error?: ScenarioError;
  /** Attempts the harness made before settling on this evidence (1 = first try). */
  attempts?: number;
  /** Every harness fault seen across those attempts, oldest first. */
  attemptErrors?: ScenarioError[];
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

/** Earned / judgeable / total rubric weight for one slice (an area, or a type). */
export interface WeightSlice {
  earned: number;
  judgeable: number;
  totalWeight: number;
  pct: number | null;
  coveragePct: number;
}

export interface AreaScore {
  area: string;
  title: string;
  optional: boolean;
  /** Share of the overall score this area carries (see Spec.area_weight). */
  areaWeight: number;
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
  /**
   * Rubric ids whose negative verdict was discarded because every scenario
   * backing them was cut short (blocked / agent_error), so the harness never
   * got to look. Absence of evidence, not evidence of absence — these are
   * excluded from the score and routed to the manual queue instead.
   */
  unproven: string[];
  /** Same points, sliced by problem type instead of by area. */
  byType: Partial<Record<RubricType, WeightSlice>>;
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
  /**
   * Area-weighted mean of the required areas' percentages (see Spec.area_weight),
   * renormalised over the areas actually present in this run.
   */
  overallPct: number | null;
  /** Area-weighted share of required-area rubric weight that was actually scored. */
  overallCoveragePct: number;
  /**
   * Required-area points sliced by problem type. Pooled by raw rubric weight
   * (not area-weighted) — types cut across areas.
   */
  byType: Partial<Record<RubricType, WeightSlice>>;
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
