import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { authStatePath } from "./auth.js";
import type { EvalConfig, Scenario, ScenarioEvidence, ScreenshotRef, TranscriptEntry } from "./types.js";
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
    description: "Clear and type text into an input, textarea, or contenteditable identified by ref.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, text: { type: "string" } },
      required: ["ref", "text"],
    },
  },
  {
    name: "select",
    description: "Choose an option in a <select> element by visible label (falls back to value).",
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
    description: "Scroll the page up or down by roughly one viewport.",
    input_schema: {
      type: "object",
      properties: { direction: { type: "string", enum: ["up", "down"] } },
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
- Stay on ${origin} (and its subpaths). Never navigate to other sites. Never enter real personal data, payment details, or credentials other than the test values you are given.
- The implementation will NOT look like SessionBoard. Judge by function, not appearance. Hunt for equivalent features under different names (e.g. "Call for Papers" might be "Submissions", "Apply to speak", "CFP").
- Be persistent but bounded: if a path fails, try one or two plausible alternatives (nav menus, footer links, obvious URLs like /cfp, /speakers, /agenda, /admin, /dashboard) before concluding 'feature_not_found' or 'blocked'.
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
  let turn = 0;

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
              if (target.origin !== new URL(config.url).origin) {
                content = `ERROR: ${target.origin} is off-target. Stay on ${new URL(config.url).origin}.`;
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
              content = await browser.scroll(input.direction === "up" ? "up" : "down");
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

        // Auto-capture evidence whenever an action lands on a new page. These
        // are saved for the judge but NOT returned to the model, so richer
        // evidence costs no agent tokens — models under-screenshot in practice.
        if (AUTO_SHOT_TOOLS.has(tu.name) && !isError) {
          try {
            const url = browser.page?.url();
            if (url && url !== lastShotUrl) {
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
  };
}
