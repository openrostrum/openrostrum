# SessionBoard Eval Kit (`sbek`)

An LLM-as-judge evaluation harness for **SessionBoard clones**. Given a submission URL, a Claude-driven browser agent clicks through the app executing scripted scenarios (submitting talks, reviewing them, building agendas, checking public widgets), collects evidence (screenshots, observations, action transcripts), and a separate LLM judge scores the app against weighted feature rubrics. Anything that can't be verified by clicking alone (emails, exports, multi-user effects) lands in a **manual verification checklist** you complete asynchronously and fold back into the final score.

Judging is **implementation-agnostic**: submissions do not need to look like SessionBoard. The rubrics describe *functionality* and *filled-state expectations* (what a populated screen should communicate), never pixel fidelity.

## What gets evaluated

| Area | Spec | Weight profile |
|---|---|---|
| Call for Papers | `specs/01-call-for-papers.yaml` | core |
| Abstract Management (review & disposition) | `specs/02-abstract-management.yaml` | core |
| Speaker Management (incl. speaker portal) | `specs/03-speaker-management.yaml` | core |
| Content Management (files, versions, approvals) | `specs/04-content-management.yaml` | core |
| AI Agenda Builder | `specs/05-ai-agenda.yaml` | basics only |
| Public Widgets (sessions list, speakers list, agenda, itinerary, speaker gallery) | `specs/06-public-widgets.yaml` | core |
| Speaker CRM | `specs/07-speaker-crm.yaml` | **optional** (extra credit) |

Feature documentation — what each area is supposed to do, the user journeys, and how screens should look when filled with data — lives in [`docs/`](docs/). Rubric IDs in the report trace back to these docs.

## Requirements

- Node.js 20+
- `ANTHROPIC_API_KEY` in the environment (or an `ant auth login` profile)
- ~$2–10 of API usage per full run depending on how far the agent gets (models default to `claude-opus-5`)

## Quick start

```bash
npm install                       # also downloads Playwright Chromium
cp evalconfig.example.json evalconfig.json   # edit: set the submission URL + any seeded credentials

npm run list                      # see areas / scenarios / rubric coverage
npm run smoke                     # offline Playwright check, no API key needed
npm run eval -- --url https://submission.example.com --dry-run   # validate specs, print the plan
npm run eval -- --url https://submission.example.com             # full evaluation
```

Recommended grading config (cheap agent, strong judge — judge quality drives cross-submission fairness):

```bash
npm run eval -- --url <url> --agent-model claude-sonnet-5 --judge-model claude-opus-5
```

Outputs land in `runs/<timestamp>/`:

- `report.html` — human-readable scored report with embedded screenshot evidence
- `report.json` — machine-readable results
- `manual-checklist.md` + `manual-results.json` — items needing human verification
- `<scenario-id>/` — per-scenario evidence bundles (screenshots + transcript)

### Personas behind magic-link / OAuth login

Many submissions gate speaker and reviewer accounts behind emailed magic links or OAuth. The browser agent has no inbox and cannot complete those flows. Sign in once by hand instead:

```bash
npm run sbek -- auth --persona speaker    # opens a real browser window
```

Complete the login in **that** window (request the magic link, then paste the link into that window's address bar — a link opened in your own browser authenticates the wrong session). Press Enter and the kit saves the session to `.auth/<host>.<persona>.json`; every scenario for that persona then starts already signed in, and is told so, so it doesn't waste turns re-authenticating.

Re-run `auth` whenever a session expires.

**Use your own email addresses.** `fixtures/sample-data.json` ships placeholder addresses (`sbek-speaker@example.com`) that will never receive mail. To exercise real verification or magic-link flows, set `personaEmails` in `evalconfig.json` to inboxes you control — these override the fixture values at run time, and the agent fills forms with them:

```json
"personaEmails": {
  "speaker":  "you+sbek-speaker@your-domain.com",
  "reviewer": "you+sbek-reviewer@your-domain.com"
}
```

Plus-addressing gives each persona a distinct account on a single inbox, so a submission that keys accounts by email still sees them as separate people. An `email` under `credentials` works as an override too, for password-login submissions.

### Manual verification (async)

Some rubric items can't be auto-verified (acceptance emails actually arriving, calendar exports opening in a calendar app, second-account visibility). The run emits `manual-checklist.md` with step-by-step instructions. Fill in `manual-results.json` (verdicts: `pass | partial | fail | not_found`), then:

```bash
npm run finalize -- --run runs/<timestamp>
```

This rescores the report with your manual verdicts included. Items the agent was *blocked* from reaching (`cannot_judge`) also route to this queue, so a submission is never penalized for harness failures.

`npm run sbek -- rescore --run <dir>` rebuilds `report.html`/`report.json` from a run's stored evidence and judgements with **no API calls** — useful after changing scoring logic, or to recover a report. Re-run `finalize` afterwards to re-apply manual verdicts.

## Useful flags

```bash
npm run eval -- --url <url> --areas call-for-papers,public-widgets   # subset of areas
npm run eval -- --url <url> --scenarios CFP-S1,CFP-S2                # subset of scenarios
npm run eval -- --url <url> --include-optional                       # also run speaker-crm
npm run eval -- --url <url> --headed                                 # watch the browser

# Cheap pilot before a full run: one scenario, capped turns, small model
npm run eval -- --url <url> --areas ai-agenda --scenarios AIA-S1 \
  --max-turns 18 --agent-model claude-haiku-4-5 --judge-model claude-haiku-4-5
```

Scenarios excluded by `--scenarios` are recorded as not-run, so rubric items depending on them are judged `cannot_judge` and routed to the manual queue rather than failed.

## Run semantics worth knowing

- **Areas chain, in order.** Scenarios build on state created by earlier areas against the same deployment (the CFP submissions become the reviewed abstracts, the accepted talks become the scheduled sessions, the published agenda feeds the public widgets). A full ordered run (01 → 07) is the intended mode; specs carry fallback steps ("if X doesn't exist yet, create it") so subset runs still work, but expect more seeding turns.
- **Every scenario gets all provided credentials.** A scenario's `persona` is its *starting* identity; scripts may sign out and switch identities mid-scenario (e.g. organizer assigns a reviewer, then signs in as that reviewer).
- **Failures degrade, never destroy.** `report.json`/`report.html` are rewritten after every area; a scenario or judge API failure records `agent_error`/`cannot_judge` (routed to the manual queue) and the run continues. A submission is never penalized for harness failures.
- **Containment.** The browser session is pinned to the target origin: off-origin redirects are rolled back, off-origin popups closed, native dialogs auto-accepted (and reported to the agent). The agent never enters real personal data — all identities are fixtures.

## Scoring model

- Each rubric item has a weight: **3** (core — area is pointless without it), **2** (important), **1** (polish).
- Judge verdicts map to points: `pass` = 1.0, `partial` = 0.5, `fail`/`not_found` = 0, `cannot_judge` = excluded and routed to the manual queue.
- Area score = earned weighted points / judgeable weighted points. Overall = weighted aggregate across required (non-optional) areas.
- **Coverage** is reported alongside every score: the share of total rubric weight that actually reached a verdict. Below **60% coverage the headline score is withheld entirely** and the report says "insufficient coverage" instead — a percentage computed over a fraction of the rubric is not comparable between submissions and reads far better than the evidence supports. Raise coverage by working the manual checklist, pre-authenticating personas, or re-running with more turns.
- The judge must cite evidence (screenshot paths, observations, transcript turns) for every verdict, and independently reports **defects** it noticed even where no rubric item covers them.

## How it works

```
specs/*.yaml ──► browser agent (Claude + Playwright, custom tool loop)
                    │  per scenario: navigate/click/fill/upload/screenshot/observe
                    ▼
              evidence bundles (screenshots + observations + transcript)
                    │
                    ▼
              LLM judge (fresh context, structured output, evidence-cited verdicts)
                    │
                    ▼
        report.html / report.json  +  manual-checklist.md ──► npm run finalize
```

Design choices worth knowing:

- **Fresh-context judging.** The judge never sees the agent's reasoning, only its evidence — reducing "the agent believed it worked, so the judge does too" bias.
- **`not_found` vs `cannot_judge`.** The agent explicitly distinguishes "I searched and this feature doesn't exist" from "I couldn't get there" — only the former counts against the submission.
- **Fixture-driven inputs.** All form fills use `fixtures/sample-data.json` (the fictional *DevFlow Conf 2027*), so every submission is tested with identical data and the judge knows exactly what values to look for in filled states.
- **Defect hunting.** Agents record bugs/broken flows as observations; the judge surfaces them in a per-area defect list with severities.

## Adding or editing rubrics

Specs are plain YAML validated at load time. Each rubric item needs `id`, `criterion`, `weight (1|2|3)`, `testability (auto | auto-partial | manual)`, `pass_criteria`, and — for manual items — `manual_instructions`. Scenarios are natural-language scripts; keep them outcome-oriented and reference fixture values by name. Run `npm run eval -- --url x --dry-run` to validate after editing.
