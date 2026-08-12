# Journey critic — personas walking the live deploy

Three gates already guard this repo. `pnpm verify` asks whether the code works.
The rule reviewer in `tooling/pr-review/` asks whether a diff obeys `docs/rules/*`.
The external eval asks whether a feature exists and functions. All three pass
happily on a product that is miserable to use.

This harness asks the fourth question: **what happens to a person trying to get
something done here.** It walks `https://openrostrum.com` on a schedule as five
personas with real goals and real reasons to quit, looks at the rendered pixels,
and reports what cost them momentum, clarity, confidence, or trust.

It is advisory. It blocks nothing.

## Why it is shaped this way

- **Journeys, not screens.** The defect that started this — `/onboarding`
  demanding six committed answers from someone forty minutes into evaluating the
  product — passes any screen-by-screen review, because each screen is fine. It
  only shows up as a break in a sequence. Every persona walks a whole arc.
- **Goals, not scripts.** A persona gets a situation, a goal, and a reason to
  abandon. Never a click path. If it wanders or gives up, that is the finding;
  `journeys.mjs` records where and why rather than steering it back on course.
- **Vision.** The petrol plinth under the auth card reads as a progress bar
  directly beneath a submit button. No DOM assertion finds that. `look` returns a
  real screenshot to the model, and every finding must cite one.
- **No rubric.** A checklist finds only the defects someone already thought of,
  which is exactly the blind spot this exists to correct. `charter.mjs` says so in
  as many words. `docs/rules/design-system.md` and `docs/rules/harness.md` are
  appended as **grounding** — vocabulary for describing what is on screen, and a
  way to tell a house choice from an accident — explicitly not as a test.
- **The toll question.** Before a journey may finish it answers: what did this
  person have to invent, guess, or commit to before the product would let them
  proceed, and what did they still not know at the end? That question is what
  catches a screen that satisfies its own specification perfectly.
- **The second look.** The first live run returned 22 findings and every one came
  off a screen where the persona had stalled. A person in a hurry crosses most
  screens without stopping, and a screen nobody stops on is a screen nobody ever
  reviews — so the charter ends by sending the critic back through the shots it
  walked past, asking whether everything on them is addressed to the person who
  was standing there and whether anything reads as something it is not.
- **Demanding, not cautious.** It is tuned to surface arguable findings. A gate
  narrow enough to only ever be right would have missed the two defects that
  prompted it. Being overruled is a fine outcome; silence is not.

## Architecture

- `charter.mjs` — the system prompt, the TypeBox terminal schema, and
  `loadCharter()`, which appends the grounding docs verbatim.
- `journeys.mjs` — the five personas, their viewports, what each produces and
  needs, and `planWaves()`, which orders them so a journey never starts before the
  handoff it depends on exists.
- `browser.mjs` — one Playwright context per journey and the tool surface:
  `look`, `open`, `click`, `fill`, `choose`, `press`, `scroll`, `back`,
  `claim_event`. Also `isBlockedRequest`, the safety guard (below).
- `critic.mjs` — drives one journey as a Pi agent, enforces the budgets, and
  validates the terminal report at the boundary.
- `findings.mjs` — stable fingerprints, collation of the same defect hit by two
  personas, and reconciliation against the previous run.
- `report.mjs` — the run report, the ledger issue body, and the per-run delta.
- `publish.mjs` — GitHub writes.
- `run.mjs` — the CLI.

Action tools return text, not images. Judging pixels costs a deliberate `look`, so
the model spends its screenshot budget where it means to.

## The journeys

| Journey | Persona | Viewport | Arc |
|---|---|---|---|
| `organizer-first-run` | Priya, program chair evaluating a move off Sessionboard | desktop | signup → get a call for papers open and linkable |
| `speaker-submission` | Marcus, staff engineer with a link from Slack and 15 minutes | mobile | cold link → talk submitted |
| `organizer-week-two` | Priya again, a week later, remembering almost nothing | desktop | sign back in → work out where things stand, get a reviewer invited |
| `reviewer-first-touch` | Dr. Whitfield, a volunteer who agreed too quickly | desktop | an emailed link → understand the ask, score a talk |
| `attendee-program` | Sam, on a train, deciding whether to buy a ticket and a flight | mobile | public pages only → is this worth the money |

They chain. The speaker enters at the **cfpUrl the organizer actually produced**,
not at a hardcoded path, so a broken handoff surfaces as a broken handoff. The
returning-organizer journey exists because a week-old event is where continuity
defects live; a first-run-only harness never sees them.

## Production safety

It runs against the real product, which real people also use.

- **Reads are never blocked.** Writes are, unless they are the run's own signup,
  login, onboarding and admin traffic, or they target an event the run created.
- **`claim_event`** — the agent must declare the slug of an event it created
  before writes to that event's public pages are allowed. Until then the guard
  blocks them.
- **Browse-only journeys** (`readOnly: true`) cannot write at all.
- The public API and embed routes are never written through.
- Cross-origin writes are blocked. Cloudflare's analytics beacon is blocked
  quietly, so a synthetic persona never lands in the owner's traffic numbers.
- Guard blocks are surfaced to the agent as **harness-caused**, so a blocked
  request is never misreported as a product defect, and they are listed in the
  report.
- Accounts are `journey-critic+<runId>-<role>@journey-critic.invalid`.
  `.invalid` is reserved and non-routable by RFC 6761, so no mail this run
  triggers can reach a stranger. The cost is that invite emails bounce; set
  `JC_EMAIL_DOMAIN` to a real inbox if a journey ever needs to read one.

Each run leaves an organization and an event behind on production. The report
names them under "Run data the owner may need".

## Completion semantics

A journey is complete only when the provider stops normally and its terminal JSON
passes the TypeBox schema, including that every finding cites a screenshot the
journey actually took. Provider errors, timeouts, exhausted budgets, aborted runs,
an unsatisfied handoff, and self-declared failure are **incomplete**.

Incomplete runs exit non-zero, banner the report with what was not covered, and
suppress every resolution — nothing can be called fixed by a run that did not look.
Zero findings from an incomplete run never renders as "no problems found".

A journey that runs out of budget mid-walk is a third state. The first real run
lost its most important journey that way: the organizer walked signup, onboarding
and half a CFP form, hit turn 48, and every one of those 16 screenshots was thrown
away. So the budget now holds back `wrapMargin` turns, and a journey that reaches
the ceiling is told the clock stopped it and asked for the report it can honestly
give. That report is `truncated`: its findings are real, its coverage of the rest
of the arc is not, and the run says so in a banner, in the coverage table, and by
refusing to call anything fixed.

One exception, deliberate: if the report parses but fails validation, the agent is
shown the exact error once and asked to re-serialize the same report. A walked
journey is expensive and dropping one over a missing field is worse than one extra
turn. A dead provider or a spent budget skips the repair entirely — asking again
cannot help — and the repair prompt states it is a formatting fix, not a second
opinion.

## Cost

Per journey: 64 turns (the last 8 reserved for wrapping up), 200 tool calls, 30
screenshots, 18 minutes. Screenshots are JPEG q62. The Anthropic provider sets
`cache_control` automatically, so the charter and the growing image-heavy
transcript are cached across turns. Five journeys in four dependency waves land
around $3–6 per run at `claude-sonnet-5`.

Weekly, not daily. Experience defects do not appear hourly and the report is only
useful if someone reads it.

## Operating it

Runs weekly (`.github/workflows/journey-critic.yml`, Mondays 11:17 UTC) and on
demand via **workflow_dispatch**, which takes a comma-separated `journeys` filter
and a `target` override.

**The one secret the owner must set: `ANTHROPIC_API_KEY`** (repository secret). If
it is absent the workflow warns and skips rather than failing red.

Output lands in two places:

- The **artifact** (`journey-critic-<runId>`) — `report.md` with relative links
  into `shots/`, plus `findings.json`. Uploaded even when the run fails, because a
  failed run's screenshots are how you find out why.
- A **persistent GitHub issue** labelled `journey-critic`, rewritten each run as
  the current open set, with a per-run comment saying what is new, what is still
  open, and what is gone.

Locally:

```bash
ANTHROPIC_API_KEY=... DRY_RUN=1 node tooling/journey-critic/run.mjs
ANTHROPIC_API_KEY=... DRY_RUN=1 JC_JOURNEYS=attendee-program JC_HEADED=1 \
  node tooling/journey-critic/run.mjs
```

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `JC_TARGET` | `https://openrostrum.com` | what to walk |
| `JC_MODEL` | `claude-sonnet-5` | must be able to see images |
| `JC_BASE_URL` | Anthropic | any Anthropic-compatible gateway |
| `JC_JOURNEYS` | all | comma-separated ids |
| `JC_EMAIL_DOMAIN` | `journey-critic.invalid` | |
| `JC_OUT` | `tooling/journey-critic/.out` | gitignored |
| `JC_HEADED` | — | watch it work |
| `DRY_RUN` | — | no GitHub writes |

`JC_MODEL` is checked against the model catalog and rejected if it cannot see
images — this harness judges pixels, and a blind critic would return a clean
run having missed every visual defect. A gateway names its own models, so the
catalog cannot vouch for one: off-catalog ids are accepted only when
`JC_BASE_URL` is set, and the report then says on its face that nobody verified
that model can see.

## Verification

Network-free, no browser, no model:

```bash
node --test 'tooling/**/*.test.node.mjs'
```

They cover the charter schema's refusals (evidence-free findings, invented
severities, a missing handoff, a one-line narrative, a self-declared incomplete),
every failure state in `critic.mjs` including the repair round and its limits,
wave ordering and single-journey selection, the request guard, fingerprints and
reconciliation, and that an incomplete run cannot render as clean. `pnpm verify`
runs them; so does the unconditional CI quality job.
