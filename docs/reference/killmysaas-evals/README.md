# SessionBoard Eval Kit (`sbek`)

An LLM-as-judge evaluation harness for **SessionBoard clones**. Given a submission URL, a Claude-driven browser agent clicks through the app executing scripted scenarios (submitting talks, reviewing them, building agendas, checking public widgets), collects evidence (screenshots, observations, action transcripts), and a separate LLM judge scores the app against weighted feature rubrics. Anything that can't be verified by clicking alone (emails, exports, multi-user effects) lands in a **manual verification checklist** you complete asynchronously and fold back into the final score.

Judging is **implementation-agnostic**: submissions do not need to look like SessionBoard. The rubrics describe *functionality* and *filled-state expectations* (what a populated screen should communicate), never pixel fidelity.

## What gets evaluated

**98 rubric items across 20 scenarios in 7 areas** — 86 items (182 weighted points) are required, 12 items (19 points) are extra credit. Each item is individually judged and cited; a scenario is just the browser agent's unit of work, so several rubric items typically share one scenario run.

| Area | Spec | Area weight | Scenarios | Rubric items | Item weight |
|---|---|---:|---:|---:|---:|
| Call for Papers (incl. multi-event support) | `specs/01-call-for-papers.yaml` | 20 | 4 | 18 | 38 |
| Abstract Management (review depth & disposition) | `specs/02-abstract-management.yaml` | 20 | 3 | 14 | 28 |
| Speaker Management (incl. speaker portal) | `specs/03-speaker-management.yaml` | 15 | 3 | 16 | 33 |
| Content Management (files, versions, approvals) | `specs/04-content-management.yaml` | 15 | 3 | 14 | 31 |
| AI Agenda Builder | `specs/05-ai-agenda.yaml` | 10 | 2 | 8 | 18 |
| Public Widgets (sessions list, speakers list, agenda, itinerary, speaker gallery) | `specs/06-public-widgets.yaml` | 20 | 3 | 16 | 34 |
| **Required total** | | **100** | **18** | **86** | **182** |
| Speaker CRM | `specs/07-speaker-crm.yaml` | 10 | 2 | 12 | 19 |

"Area weight" is each area's deliberate share of the overall score (required areas sum to 100) — set independently of how many rubric items the spec happens to contain, so a verbosely-specced area doesn't win more influence by accident. "Item weight" is the sum of each item's own 1/2/3 weight, used only *within* an area to rank its own items against each other.

Every item also carries a `type` — what *kind* of problem it probes, not which area it lives in. Clones cluster hard on the easy types and fall over on the hard ones, so this cut is usually the most useful line in the report:

| Type | What it probes | Required weight | Share |
|---|---|---:|---:|
| `crud` | create or edit something and it persists | 41 | 23% |
| `roundtrip` | what one role/screen wrote is what another role/screen reads | 33 | 18% |
| `exists` | the capability/screen is present and reachable at all | 28 | 15% |
| `rule` | a stated constraint is actually enforced (deadline, conflict, filter, approval gate) | 22 | 12% |
| `scoping` | a role sees exactly what it should, and nothing more, and one event's data stays out of another | 20 | 11% |
| `depth` | differentiators and polish beyond the core loop | 13 | 7% |
| `bulk` | operations at scale — CSV import, bulk email, ZIP export, auto-distribution | 11 | 6% |
| `side-effect` | egress the browser can't observe — real email delivery, calendar files | 8 | 4% |
| `handoff` | data crosses a module boundary without re-entry (accepted → session → public) | 6 | 3% |

`exists`/`crud` items are necessary but rarely discriminate — almost anything that ships passes them. `rule`/`scoping`/`handoff` are where clones actually fail (see [Calibration notes](#calibration-notes) below).

Feature documentation — what each area is supposed to do, the user journeys, and how screens should look when filled with data — lives in [`docs/`](docs/). Rubric IDs in the report trace back to these docs.

## Requirements

- Node.js 20+
- `ANTHROPIC_API_KEY` in the environment (or an `ant auth login` profile)
- ~$2–10 of API usage per full run depending on how far the agent gets (models default to `claude-opus-5`)

## Quick start

```bash
pnpm install                       # also downloads Playwright Chromium
cp evalconfig.example.json evalconfig.json   # edit: set the submission URL + any seeded credentials

pnpm run list                      # see areas / scenarios / rubric coverage
pnpm run smoke                     # offline Playwright check, no API key needed
pnpm run eval -- --url https://submission.example.com --dry-run   # validate specs, print the plan
pnpm run eval -- --url https://submission.example.com             # full evaluation
```

Recommended grading config (cheap agent, strong judge — judge quality drives cross-submission fairness):

```bash
pnpm run eval -- --url <url> --agent-model claude-sonnet-5 --judge-model claude-opus-5
```

Outputs land in `runs/<timestamp>/`:

- `report.html` — human-readable scored report with embedded screenshot evidence
- `report.json` — machine-readable results
- `manual-checklist.md` + `manual-results.json` — items needing human verification
- `<scenario-id>/` — per-scenario evidence bundles (screenshots + transcript)

### Personas behind magic-link / OAuth login

Many submissions gate speaker and reviewer accounts behind emailed magic links or OAuth. The browser agent has no inbox and cannot complete those flows. Sign in once by hand instead:

```bash
pnpm run sbek -- auth --persona speaker    # opens a real browser window
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
pnpm run finalize -- --run runs/<timestamp>
```

This rescores the report with your manual verdicts included. Items the agent was *blocked* from reaching (`cannot_judge`) also route to this queue, so a submission is never penalized for harness failures.

`pnpm run sbek -- rescore --run <dir>` rebuilds `report.html`/`report.json` from a run's stored evidence and judgements with **no API calls** — useful after changing scoring logic, or to recover a report. Re-run `finalize` afterwards to re-apply manual verdicts.

## Useful flags

```bash
pnpm run eval -- --url <url> --areas call-for-papers,public-widgets   # subset of areas
pnpm run eval -- --url <url> --scenarios CFP-S1,CFP-S2                # subset of scenarios
pnpm run eval -- --url <url> --include-optional                       # also run speaker-crm
pnpm run eval -- --url <url> --headed                                 # watch the browser

# Cheap pilot before a full run: one scenario, capped turns, small model
pnpm run eval -- --url <url> --areas ai-agenda --scenarios AIA-S1 \
  --max-turns 18 --agent-model claude-haiku-4-5 --judge-model claude-haiku-4-5
```

Scenarios excluded by `--scenarios` are recorded as not-run, so rubric items depending on them are judged `cannot_judge` and routed to the manual queue rather than failed.

## Watching a run, and resuming one

A full evaluation takes about an hour, so it narrates itself. Every run writes a timestamped `runs/<ts>/run.log` (mirrored to stdout) with a line per agent turn:

```bash
tail -f runs/<ts>/run.log
```
```
[07:22:14]   > CFP-S2: Speaker drafts, submits, and edits proposals [speaker]
[07:22:18]       CFP-S2 turn 1/70: navigate(https://greenroom-hq.com/portal)
[07:24:03]     outcome: completed (31 turns, 18 screenshots)
[07:24:51]   score: 78.6% over 72% coverage (18/25 weight judged)  manual pending: 3  defects: 2
```

Use the log file rather than the process's stdout — piping stdout through `tail`/`less` buffers it for the whole hour; the file does not.

**Resume instead of restarting:**

```bash
pnpm run eval -- --resume runs/<ts> [--config <file>]
```

Finished scenarios are reused from their `evidence.json` and fully-scored areas from `report.json`, with no browser and no API calls — you only pay for what didn't finish. "Finished" means the scenario reached an outcome of its own (`completed`, `blocked`, `feature_not_found`). A scenario that died at the harness level or ran out of turns is `agent_error`: its evidence is kept for diagnosis but never reused, so a resume re-runs it — and re-scores the area around it, since that area's score was computed without it. If the process dies, `run.log` ends with a `FATAL` line and the exact resume command.

This is also the cheap way to raise coverage after the fact: re-run with `--max-turns 100 --resume <dir>` and only the scenarios that hit the cap will execute again.

## Run semantics worth knowing

- **Areas chain, in order.** Scenarios build on state created by earlier areas against the same deployment (the CFP submissions become the reviewed abstracts, the accepted talks become the scheduled sessions, the published agenda feeds the public widgets). A full ordered run (01 → 07) is the intended mode; specs carry fallback steps ("if X doesn't exist yet, create it") so subset runs still work, but expect more seeding turns.
- **Every scenario gets all provided credentials.** A scenario's `persona` is its *starting* identity; scripts may sign out and switch identities mid-scenario (e.g. organizer assigns a reviewer, then signs in as that reviewer).
- **Failures degrade, never destroy.** `report.json`/`report.html` are rewritten after every area; a scenario or judge API failure records `agent_error`/`cannot_judge` (routed to the manual queue) and the run continues. A submission is never penalized for harness failures.
- **Harness failures are retried, then recorded.** A scenario that dies from an exception or a model refusal is retried up to 3 times (10s then 30s apart), each attempt with a fresh browser, context and restored persona session, so no retry inherits the state that broke. An outcome the app produced (`blocked`) and a turn-limit stop are not retried — they are answers, not faults. When every attempt fails, the attempt with the most evidence is kept and the exception (message, stack, turn, page URL, last tool) lands in both `run.log` and the scenario's `evidence.json` (`error`, `attempts`, `attemptErrors`).
- **Containment.** The browser session is pinned to the target site: off-origin redirects are rolled back, off-origin popups closed, native dialogs auto-accepted (and reported to the agent). Sibling subdomains of the same registrable domain count as on-target — real products split across `app.` / `appv2.` / `admin.` hosts, and pinning to one exact origin strands the agent on a shell it can't leave. The agent never enters real personal data — all identities are fixtures.
- **SPA-aware element detection.** Clickable targets are found by role/tag *and* by `cursor: pointer`, because React/Vue table rows and cards are usually plain `<div>`s with synthetic handlers — no `href`, no `<button>`, no `onclick` attribute. Without this the agent can be unable to open a record at all and the clone loses points for a screen that works fine.

## Scoring model

**Anatomy of a rubric item** (`specs/*.yaml`, validated at load time): `id`, `criterion`, `weight` (1/2/3), `type` (see the taxonomy table above), `testability` (`auto` | `auto-partial` | `manual`), `pass_criteria`, `evidence` (what the judge should look for), and — for `manual`/`auto-partial` items — `manual_instructions`. Scenarios are natural-language scripts under the same spec; keep them outcome-oriented and reference fixture values by name.

- **Weight** (1/2/3, "polish"/"important"/"core") ranks an item against *its own area's* other items — 178 required points, distributed 31%/50%/19% across w3/w2/w1.
- **Area weight** (see the table above) sets each area's *share of the overall score*, independent of item weight or item count — required areas sum to 100.
- **Type** slices the same points by what kind of problem is being probed instead of by area (also above). Reporting only — it never changes a point total, but it's the fastest way to see *how* a submission is failing rather than just *how much*.
- Judge verdicts map to points: `pass` = 1.0, `partial` = 0.5, `fail`/`not_found` = 0, `cannot_judge` = excluded from the denominator and routed to the manual queue.
- Area score = earned weighted points / judgeable weighted points, using item weight. Overall score = area-weighted mean of area percentages (using area weight), renormalized over whichever required areas actually ran — so a `--areas` subset run still reports a meaningful number for what it covered.
- **Coverage** is reported alongside every score (area-weighted the same way): the share of total rubric weight that actually reached a verdict. Below **60% coverage the headline score is withheld entirely** and the report says "insufficient coverage" instead — a percentage computed over a fraction of the rubric is not comparable between submissions and reads far better than the evidence supports. Raise coverage by working the manual checklist, pre-authenticating personas, or re-running with more turns.
- The judge must cite evidence (screenshot paths, observations, transcript turns) for every verdict, and independently reports **defects** it noticed even where no rubric item covers them.

Edit specs freely — add an item, change a weight, retag a type — then run `pnpm run eval -- --url x --dry-run` to validate, or `pnpm run sbek -- rescore --run <dir>` to rescore an existing run's stored evidence against the new rubric with no API calls.

### Calibration notes

The type breakdown above is the intended reading order for "is this a real implementation or a demo": `exists` and `crud` pass almost everywhere and don't separate submissions; `roundtrip` and `handoff` are the first place a two-sided flow (reviewer writes → organizer reads; accepted talk → scheduled session → public agenda) turns out to be one-sided; `rule` and `scoping` are where enforcement (deadlines, conflicts, authz isolation) either exists or doesn't, and are the strongest signal in the whole rubric — but also the items scenarios reach last, so they're the first thing a turn-limit cutoff eats. Read an area's `rule`/`scoping` row together with its coverage: a missing rule check that's `cannot_judge` because the scenario ran out of turns is very different from one that's `not_found` because the agent searched and it isn't there.

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
        report.html / report.json  +  manual-checklist.md ──► pnpm run finalize
```

Design choices worth knowing:

- **Fresh-context judging.** The judge never sees the agent's reasoning, only its evidence — reducing "the agent believed it worked, so the judge does too" bias.
- **`not_found` vs `cannot_judge`.** The agent explicitly distinguishes "I searched and this feature doesn't exist" from "I couldn't get there" — only the former counts against the submission.
- **Fixture-driven inputs.** All form fills use `fixtures/sample-data.json` (the fictional *DevFlow Conf 2027*), so every submission is tested with identical data and the judge knows exactly what values to look for in filled states.
- **Defect hunting.** Agents record bugs/broken flows as observations; the judge surfaces them in a per-area defect list with severities.
