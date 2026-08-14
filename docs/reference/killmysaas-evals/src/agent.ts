import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { authStatePath } from "./auth.js";
import { log } from "./log.js";
import type {
  EvalConfig,
  Scenario,
  ScenarioError,
  ScenarioEvidence,
  ScreenshotRef,
  TranscriptEntry,
} from "./types.js";
import { BrowserSession } from "./browser.js";
import { FIXTURES_DIR } from "./specs.js";

const TOOLS: Anthropic.ToolUnion[] = [
  {
    name: "navigate",
    description:
      "Navigate the browser to a URL (must stay on the target site's origin). Returns a text snapshot of the resulting page.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to open" } },
      required: ["url"],
    },
  },
  {
    name: "snapshot",
    description:
      "Take a fresh text snapshot of the current page: URL, title, aria outline, and interactive elements with refs. Use after any action that may have changed the page, and whenever a ref errors as stale.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Click an element by its ref (e.g. 'e12') from the latest snapshot. Returns a new snapshot.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "fill",
    description:
      "Clear and type text into an input, textarea, or rich-text editor identified by ref. Date/time fields accept human wording ('March 5, 2026', '9:30 AM') — they are converted to the format the field requires. A field marked 'readonly' cannot be typed into: filling it clicks it instead, which usually opens a picker, and the result is a fresh snapshot listing the picker's options.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, text: { type: "string" } },
      required: ["ref", "text"],
    },
  },
  {
    name: "select",
    description:
      "Choose an option in a dropdown by visible label. Works for a native <select> AND for custom dropdowns/comboboxes (refs marked 'dropdown', or any div/button that opens a list) — it opens the control, types to filter if needed, and clicks the matching option. If the value does not match, the error lists the options that were actually available.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
    },
  },
  {
    name: "drag",
    description:
      "Drag one element onto another (both refs from the latest snapshot). Use for drag-and-drop UIs — agenda/schedule builders usually place sessions this way. If a builder also offers click-to-select then click-a-slot, either approach is fine.",
    input_schema: {
      type: "object",
      properties: {
        from_ref: { type: "string", description: "Element to drag, e.g. an unscheduled session card" },
        to_ref: { type: "string", description: "Drop target, e.g. a time slot cell" },
      },
      required: ["from_ref", "to_ref"],
    },
  },
  {
    name: "upload",
    description:
      "Upload a fixture file through a file input or an upload button (ref from the latest snapshot). fixture: 'headshot' (PNG), 'slides' (PDF), or 'speakers_csv' (CSV).",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        fixture: { type: "string", enum: ["headshot", "slides", "speakers_csv"] },
      },
      required: ["ref", "fixture"],
    },
  },
  {
    name: "press",
    description: "Press a keyboard key (e.g. 'Enter', 'Escape', 'Tab').",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description:
      "Scroll up or down by roughly one viewport. Pass ref to scroll a specific list instead of the page — long session/speaker/submission lists often live in their own scroll box (refs marked 'scrollable') or load more rows only when that box is scrolled, so a short-looking list is usually not a short list.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        ref: {
          type: "string",
          description: "Optional: a ref inside the list/container to scroll instead of the whole page",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "wait",
    description: "Wait for the page to settle (max 8000ms). Use sparingly for slow-loading UI.",
    input_schema: {
      type: "object",
      properties: { ms: { type: "number" } },
      required: ["ms"],
    },
  },
  {
    name: "screenshot",
    description:
      "Capture a screenshot as visual evidence. ALWAYS screenshot key states: filled forms before submit, confirmation screens, lists/dashboards with data, anything a judge needs to see. Give a short descriptive label.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short kebab-case label, e.g. 'cfp-form-filled'" },
        full_page: { type: "boolean", description: "Capture the full scrollable page (default false)" },
      },
      required: ["label"],
    },
  },
  {
    name: "observe",
    description:
      "Record a factual observation for the judge (feature present/absent, validation behavior, data shown, bugs). Use liberally — observations are primary evidence.",
    input_schema: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
    },
  },
  {
    name: "done",
    description:
      "End the scenario. outcome: 'completed' (script finished, whether or not every check passed), 'blocked' (could not finish — say why), or 'feature_not_found' (searched thoroughly; feature appears absent).",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["completed", "blocked", "feature_not_found"] },
        summary: {
          type: "string",
          description: "Concise factual summary of what happened and what was verified",
        },
      },
      required: ["outcome", "summary"],
    },
  },
];

function agentSystemPrompt(targetUrl: string, config: EvalConfig): string {
  const origin = new URL(targetUrl).origin;
  return `You are a QA browser agent evaluating a web application that claims to implement SessionBoard-like functionality (event call-for-papers / speaker & session management). You execute one test scenario at a time by driving a real browser through tools.

Ground rules:
- Stay on ${origin}, its subpaths, and sibling subdomains of the same site (a product's public pages often live on a different subdomain than its admin app). Never navigate to a different site. Never enter real personal data, payment details, or credentials other than the test values you are given.
- The implementation will NOT look like SessionBoard. Judge by function, not appearance. Hunt for equivalent features under different names (e.g. "Call for Papers" might be "Submissions", "Apply to speak", "CFP").
- READ THE SNAPSHOT LITERALLY. It lists everything you can act on, including controls inside embedded iframes (marked "in iframe …") and web components. When a modal dialog is open the list shows ONLY that dialog — close or save it to reach the page behind. A ref marked "scrollable" is a list with its own scrollbar: scroll it with that ref, because the page scrollbar will not move it and the list is probably longer than it looks. If a click reports that something is covering the target, dismiss that overlay and retry rather than concluding the control is broken — and if a tool reports a capability could not be exercised, that is evidence to record, not something to retry indefinitely.
- MULTI-STEP WIZARDS ARE GATED: in stepped flows (Overview → Rounds → Evaluators → Assignments; Abstract → Participant → Payments → Form Settings) the later steps stay 'disabled' until you advance through the earlier ones, so press Next/Continue/Save to unlock a step instead of concluding it is missing.
- Be persistent but bounded: if a path fails, try one or two plausible alternatives (nav menus, footer links, obvious URLs like /cfp, /speakers, /agenda, /admin, /dashboard) before concluding 'feature_not_found' or 'blocked'.
- ADAPT THE SCRIPT TO THE APP, BUT NEVER HIDE A MISSING CAPABILITY. The scenario's sample *values* (person names, talk titles, dates) are a convenience — if the app signs you in as a fixed demo identity or is pre-seeded, exercise the same capability against the data that exists and note what stood in for what. But when the app cannot do something the script asks for, that is a FINDING about the product, not a data mismatch to paper over: record an explicit observation naming the missing capability and what you tried, then continue with existing data so the rest of the scenario still produces evidence.
- The sample data's FORMAT and TRACK names (e.g. "Talk (30 min)", "Lightning Talk (10 min)") are illustrative. If the app offers its own vocabulary (Keynote / Break Out / Workshop, or its own track list), pick the closest equivalent, note the substitution, and carry on — an app is not deficient for naming formats differently.
- Multi-event support is graded. If you cannot create a second event, or the app has no event-creation UI or event switcher at all, say so explicitly in an observation ("no event creation UI found at X, Y, Z; the app appears to be single-event") — do not silently reuse the seeded event as though the step succeeded.
- Reserve 'blocked' for when the capability itself is unreachable (a hard auth wall you cannot pass, a crash, a flow that does not exist), not for a mismatch between the script's sample data and the app's seeded data.
- Budget your turns. You have a limited number; spend them on evidence for the rubric, not on exhaustive URL guessing. If something is not discoverable after a few tries, record that as an observation (it is a real finding about the product) and move on to the next step.
- If the app requires signup to proceed and no credentials were provided, create a throwaway account using the test identity from the scenario data (never a real email — use the provided fixture email).
- Collect evidence as you go: screenshot every meaningful state and record observations. A scenario without screenshots is worthless to the judge.
- Note bugs, dead links, console-visible errors, broken validation, and confusing flows as observations — finding defects is part of the job.
- Finish every scenario by calling the done tool with an honest outcome. Report what you actually verified, not what you assume.
${config.submissionNotes ? `\nSubmission-specific notes from the operator:\n${config.submissionNotes}` : ""}`;
}

/**
 * Scenarios may switch identities mid-run (sign out / sign back in), so the
 * agent gets every provided persona's credentials, with the starting persona
 * marked. Personas without provided credentials sign up with fixture identities.
 */
function renderCredentials(config: EvalConfig, startingPersona: string): string {
  const all = Object.entries(config.credentials ?? {}).filter(
    ([, c]) => c && (c.email || c.password),
  );
  if (all.length === 0) {
    return "No pre-provisioned credentials. Sign up with the fixture identities from the sample data when accounts are needed.";
  }
  const lines = all.map(
    ([persona, c]) =>
      `- ${persona}${persona === startingPersona ? " (starting persona)" : ""}: email=${c.email ?? "(none)"} password=${c.password ?? "(none)"}${c.notes ? ` — ${c.notes}` : ""}`,
  );
  return `Pre-provisioned credentials (personas not listed: sign up with fixture identities):\n${lines.join("\n")}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "… (truncated)" : s);

/** Actions after which a URL change triggers an automatic evidence screenshot. */
const AUTO_SHOT_TOOLS = new Set(["navigate", "click", "press"]);

/**
 * Runs one scenario with a manual agentic loop (custom client-side tools,
 * screenshots returned to the model as image blocks).
 */
export async function runScenario(opts: {
  client: Anthropic;
  config: EvalConfig;
  scenario: Scenario;
  areaTitle: string;
  fixtures: Record<string, unknown>;
  evidenceDir: string;
}): Promise<ScenarioEvidence> {
  const { client, config, scenario, areaTitle, fixtures, evidenceDir } = opts;
  const startedAt = new Date().toISOString();
  const transcript: TranscriptEntry[] = [];
  const screenshots: ScreenshotRef[] = [];
  const observations: string[] = [];
  const maxTurns = config.maxTurnsPerScenario ?? 40;

  // Restore a pre-authenticated session for this persona when one was captured.
  const statePath = authStatePath(scenario.persona, config.url);
  const preAuthed = fs.existsSync(statePath);
  const browser = new BrowserSession(
    evidenceDir,
    config.headless ?? true,
    new URL(config.url).origin,
    preAuthed ? statePath : undefined,
  );

  let outcome: ScenarioEvidence["outcome"] = "agent_error";
  let summary = "Scenario did not finish.";
  let finalUrl: string | undefined;
  let started = false;
  let lastShotUrl: string | undefined;
  // Consecutive turns that ended on a login wall while we began authenticated.
  let loggedOutStreak = 0;
  let turn = 0;
  let error: ScenarioError | undefined;

  /**
   * Snapshot what a post-mortem needs: the fault, the page it happened on and
   * the step in flight. Best-effort by construction — it runs inside a catch
   * block and must never throw itself.
   */
  const recordFailure = (
    kind: ScenarioError["kind"],
    message: string,
    stack?: string,
  ): ScenarioError => {
    let url: string | undefined;
    try {
      if (started) url = browser.page?.url();
    } catch {
      /* the page can already be gone when the browser is what crashed */
    }
    const lastCall = [...transcript].reverse().find((t) => t.kind === "tool_call");
    return {
      kind,
      message: clip(message, 800),
      ...(stack ? { stack: clip(stack, 4000) } : {}),
      turn,
      ...(url ? { url } : {}),
      ...(lastCall?.tool
        ? { lastTool: lastCall.tool, lastToolInput: clip(lastCall.detail, 300) }
        : {}),
      at: new Date().toISOString(),
    };
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `TARGET URL: ${config.url}`,
            `FEATURE AREA: ${areaTitle}`,
            `SCENARIO ${scenario.id}: ${scenario.name}`,
            `PERSONA: ${scenario.persona}`,
            preAuthed
              ? `AUTH: this browser is ALREADY SIGNED IN as the "${scenario.persona}" persona (session restored). Do not sign up or sign in again — go straight to the task. If you unexpectedly see a logged-out state, say so in an observation and continue as best you can.`
              : renderCredentials(config, scenario.persona),
            ``,
            `SCRIPT:`,
            scenario.steps,
            scenario.success_signals?.length
              ? `\nSUCCESS SIGNALS TO VERIFY:\n- ${scenario.success_signals.join("\n- ")}`
              : "",
            ``,
            `SAMPLE DATA (use these exact values when filling forms):`,
            "```json",
            JSON.stringify(fixtures, null, 2),
            "```",
            ``,
            `Start by navigating to the target URL.`,
          ].join("\n"),
        },
      ],
    },
  ];

  try {
    await browser.start();
    started = true;

    while (turn < maxTurns) {
      turn += 1;
      const response = await client.messages.create({
        model: config.agentModel!,
        max_tokens: 16000,
        cache_control: { type: "ephemeral" },
        system: agentSystemPrompt(config.url, config),
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === "refusal") {
        outcome = "agent_error";
        summary = "Model refused mid-scenario (safety classifier). Re-run or verify this scenario manually.";
        error = recordFailure("refusal", "Model returned stop_reason=refusal (safety classifier).");
        break;
      }

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          transcript.push({ turn, kind: "assistant_text", detail: clip(block.text, 600) });
        }
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length > 0) {
        const summary = toolUses
          .map((t) => {
            const i = t.input as Record<string, any>;
            const arg = i.url ?? i.label ?? i.ref ?? i.note ?? i.outcome ?? i.key ?? "";
            return `${t.name}${arg ? `(${String(arg).slice(0, 40)})` : ""}`;
          })
          .join(", ");
        log(`      ${scenario.id} turn ${turn}/${maxTurns}: ${summary}`);
      }

      if (toolUses.length === 0) {
        if (response.stop_reason === "max_tokens") {
          // Truncated mid-thought with no complete tool call — nudge and retry
          // rather than mistaking the fragment for a finished scenario.
          transcript.push({
            turn,
            kind: "assistant_text",
            detail: "(turn truncated at max_tokens with no tool call — nudged to continue)",
          });
          messages.push({ role: "assistant", content: response.content });
          messages.push({
            role: "user",
            content:
              "Your last turn was cut off by the output limit before any tool call. Continue the scenario now: be brief in prose and go straight to the next tool call (or call done if the scenario is finished).",
          });
          continue;
        }
        // end_turn without calling done — accept the text as the summary.
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        outcome = "completed";
        summary = text || "Agent ended the scenario without an explicit summary.";
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      let finished = false;

      for (const tu of toolUses) {
        const input = tu.input as Record<string, any>;
        transcript.push({
          turn,
          kind: "tool_call",
          tool: tu.name,
          detail: clip(JSON.stringify(input), 400),
        });

        let content: Anthropic.ToolResultBlockParam["content"];
        let isError = false;
        try {
          switch (tu.name) {
            case "navigate": {
              const target = new URL(String(input.url), config.url);
              // Use the session's own containment rule — an exact-origin check
              // here would reject sibling subdomains that the browser layer
              // allows (e.g. a public site on sites.example.com), silently
              // making a whole product surface unreachable.
              if (!browser.isAllowedUrl(target.toString())) {
                content = `ERROR: ${target.origin} is off-target. Stay on ${new URL(config.url).origin} or a sibling subdomain of the same site.`;
                isError = true;
              } else {
                content = await browser.navigate(target.toString());
              }
              break;
            }
            case "snapshot":
              content = await browser.snapshot();
              break;
            case "click":
              content = await browser.click(String(input.ref));
              break;
            case "fill":
              content = await browser.fill(String(input.ref), String(input.text));
              break;
            case "select":
              content = await browser.select(String(input.ref), String(input.value));
              break;
            case "drag":
              content = await browser.drag(String(input.from_ref), String(input.to_ref));
              break;
            case "upload": {
              const fixtureFiles: Record<string, string> = {
                headshot: "headshot.png",
                slides: "slides.pdf",
                speakers_csv: "speakers.csv",
              };
              const file = fixtureFiles[String(input.fixture)];
              if (!file) {
                content = `ERROR: unknown fixture '${input.fixture}'. Use headshot | slides | speakers_csv.`;
                isError = true;
              } else {
                content = await browser.upload(String(input.ref), path.join(FIXTURES_DIR, file));
              }
              break;
            }
            case "press":
              content = await browser.press(String(input.key));
              break;
            case "scroll":
              content = await browser.scroll(
                input.direction === "up" ? "up" : "down",
                input.ref ? String(input.ref) : undefined,
              );
              break;
            case "wait":
              content = await browser.wait(Number(input.ms) || 1000);
              break;
            case "screenshot": {
              const shot = await browser.screenshot(String(input.label ?? "shot"), Boolean(input.full_page));
              screenshots.push({ path: shot.relPath, label: String(input.label ?? "shot"), turn });
              content = [
                { type: "text", text: `Screenshot saved as ${shot.relPath}` },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data: shot.base64 },
                },
              ];
              break;
            }
            case "observe":
              observations.push(String(input.note));
              content = "Observation recorded.";
              break;
            case "done": {
              const allowed: ScenarioEvidence["outcome"][] = [
                "completed",
                "blocked",
                "feature_not_found",
              ];
              outcome = allowed.includes(input.outcome)
                ? (input.outcome as ScenarioEvidence["outcome"])
                : "completed";
              summary = String(input.summary ?? "");
              content = "Scenario ended.";
              finished = true;
              break;
            }
            default:
              content = `ERROR: unknown tool ${tu.name}`;
              isError = true;
          }
        } catch (err: any) {
          content = `ERROR: ${err?.message ?? String(err)}`;
          isError = true;
        }

        transcript.push({
          turn,
          kind: "tool_result",
          tool: tu.name,
          detail:
            typeof content === "string"
              ? clip(content, 500)
              : `(screenshot returned: ${screenshots.at(-1)?.path ?? ""})`,
        });

        // Session-health guard. A pre-authenticated run that lands on a login
        // wall has lost its session (shared-domain cookies, idle timeout, an
        // impersonation switch). Continuing means exploring a logged-out app
        // and reporting real features as missing, so stop and say why.
        if (preAuthed && !isError) {
          const url = browser.page?.url() ?? "";
          const wall =
            /[?&/](login|signin|sign-in)\b/i.test(url) || /reason=sessionExpired/i.test(url);
          loggedOutStreak = wall ? loggedOutStreak + 1 : 0;
          if (loggedOutStreak >= 2) {
            outcome = "blocked";
            summary =
              `Session lost mid-scenario: this run started pre-authenticated but the app redirected to a login wall (${url.slice(0, 140)}) and stayed there. ` +
              `Everything after this point would be observed while logged out, so the scenario was stopped rather than reporting features as missing. ` +
              `Re-capture the persona's session (sbek auth) and re-run this scenario.`;
            observations.push(`SESSION LOST: redirected to ${url.slice(0, 160)} while pre-authenticated.`);
            transcript.push({ turn, kind: "assistant_text", detail: "(halted: session lost)" });
            finished = true;
            break;
          }
        }

        // Auto-capture evidence whenever an action lands on a new page. These
        // are saved for the judge but NOT returned to the model, so richer
        // evidence costs no agent tokens — models under-screenshot in practice.
        if (AUTO_SHOT_TOOLS.has(tu.name) && !isError) {
          try {
            const url = browser.page?.url();
            // Don't spend the judge's image budget on 404s from URL probing —
            // a failed guess is worth an observation, not a screenshot.
            const title = typeof content === "string" ? (content.match(/^TITLE: (.*)$/m)?.[1] ?? "") : "";
            const isErrorPage = /404|not found|could not be found/i.test(title);
            if (url && url !== lastShotUrl && !isErrorPage) {
              lastShotUrl = url;
              const slug = url.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/gi, "-") || "root";
              const shot = await browser.screenshot(`auto${slug}`.slice(0, 55), false);
              screenshots.push({ path: shot.relPath, label: `auto: ${url}`, turn });
            }
          } catch {
            /* evidence capture is best-effort */
          }
        }

        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content,
          ...(isError ? { is_error: true } : {}),
        });
      }

      messages.push({ role: "user", content: results });
      if (finished) break;
    }

    if (turn >= maxTurns && outcome === "agent_error") {
      summary = `Turn limit (${maxTurns}) reached before the scenario finished.`;
    }
  } catch (err: any) {
    // Harness-level failure (API error after SDK retries, browser crash, ...):
    // degrade to agent_error so the run continues and evidence so far is kept.
    outcome = "agent_error";
    summary = `Harness error on turn ${turn}: ${err?.message ?? String(err)}`;
    error = recordFailure("exception", err?.message ?? String(err), err?.stack);
    // The exception is the only thing that explains the lost scenario later, so
    // it goes to run.log too — evidence.json alone is easy to miss.
    log(
      [
        `      ${scenario.id} HARNESS FAILURE on turn ${turn}: ${error.message}`,
        `        at url: ${error.url ?? "unknown"}` +
          (error.lastTool ? ` | last tool: ${error.lastTool} ${error.lastToolInput ?? ""}` : ""),
        ...(error.stack ? [`        ${error.stack.split("\n").slice(0, 12).join("\n        ")}`] : []),
      ].join("\n"),
    );
  } finally {
    if (started) {
      // Terminal-state screenshot for the judge, best-effort.
      try {
        const shot = await browser.screenshot("final-state", false);
        screenshots.push({ path: shot.relPath, label: "final-state", turn });
      } catch {}
      try {
        finalUrl = browser.page?.url();
      } catch {}
    }
    await browser.stop();
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    outcome,
    summary,
    observations,
    transcript,
    screenshots,
    startedAt,
    finishedAt: new Date().toISOString(),
    finalUrl,
    turns: turn,
    ...(error ? { error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/**
 * Attempts a scenario gets when the HARNESS is what failed. One transient
 * provider or browser fault used to cost the scenario's rubric items for the
 * whole run, which reads as a product regression rather than a lost measurement.
 */
export const MAX_SCENARIO_ATTEMPTS = 3;

/** Backoff before attempt N+1, indexed by attempts already made. */
const RETRY_BACKOFF_MS = [10_000, 30_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this a harness fault (retry) rather than a finding about the submission?
 *
 * Only the exception and refusal paths attach `error`, so this is exactly
 * "the run broke", never "the app blocked the agent". `blocked` is a real
 * observation the judge must see; a turn-limit `agent_error` is a budget
 * decision, and re-running it in-process would just burn the same turns again
 * (raise --max-turns and resume instead).
 */
export function isHarnessFailure(ev: ScenarioEvidence): boolean {
  return ev.outcome === "agent_error" && Boolean(ev.error);
}

/**
 * Did the scenario reach an outcome of its own? Only these are real results
 * that a resume may reuse — an `agent_error` (crash, refusal, turn limit) left
 * the rubric un-evidenced, so it is work still to do, not a finding.
 */
export function isGenuineFinish(ev: ScenarioEvidence): boolean {
  return ev.outcome !== "agent_error";
}

/** How much a failed attempt is still worth to the judge. */
const evidenceValue = (ev: ScenarioEvidence) => ev.screenshots.length * 1000 + ev.turns;

/**
 * Runs a scenario, retrying harness failures. Every attempt goes through
 * `runScenario`, which builds a fresh BrowserSession — new browser process, new
 * context, persona session restored again from its auth state file — so no
 * attempt inherits the cookies, storage or half-submitted form of the one that
 * crashed. A retry that reuses poisoned state would just fail the same way.
 */
export async function runScenarioWithRetries(opts: {
  client: Anthropic;
  config: EvalConfig;
  scenario: Scenario;
  areaTitle: string;
  fixtures: Record<string, unknown>;
  evidenceDir: string;
  maxAttempts?: number;
}): Promise<ScenarioEvidence> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_SCENARIO_ATTEMPTS);
  const failures: ScenarioEvidence[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ev = await runScenario(opts);
    ev.attempts = attempt;

    if (!isHarnessFailure(ev)) {
      if (failures.length) {
        ev.attemptErrors = failures.map((f) => f.error!);
        log(`    ${opts.scenario.id}: recovered on attempt ${attempt}/${maxAttempts}`);
      }
      return ev;
    }

    failures.push(ev);
    log(
      `    ! ${opts.scenario.id}: attempt ${attempt}/${maxAttempts} failed at the harness level ` +
        `(${ev.error!.kind}) — ${ev.error!.message.split("\n")[0].slice(0, 160)}`,
    );
    if (attempt < maxAttempts) {
      const wait = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1)!;
      log(`      retrying in ${Math.round(wait / 1000)}s with a fresh browser and persona session`);
      await sleep(wait);
    }
  }

  // Out of attempts. Return whichever attempt gathered the most evidence, so
  // retrying can never leave the judge with less than one attempt would have.
  const kept = failures.reduce((a, b) => (evidenceValue(b) > evidenceValue(a) ? b : a));
  kept.attempts = maxAttempts;
  kept.attemptErrors = failures.map((f) => f.error!);
  log(
    `    ! ${opts.scenario.id}: ${maxAttempts} attempts failed — keeping the attempt with the most evidence ` +
      `(${kept.screenshots.length} screenshots, ${kept.turns} turns)`,
  );
  return kept;
}
