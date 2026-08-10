# PR review — full-coverage, doc-sourced

The DeepSeek-backed PR reviewer and the harness that validates it before it
touches CI.

## How coverage works

One reviewer **agent per rule doc in `docs/rules/`** (`agents.mjs` discovers them
by globbing — no hand-maintained list). Each agent loads its doc **verbatim** at
review time as the source of truth, so the rules can never drift from the md
files and coverage is provably the union of `docs/rules/`. Add a rule doc → it
gets reviewed. The split keeps each agent's context to one doc (better precision)
while together they cover the whole rule surface.

Purely-procedural rules (git append-only, squash-merge, verify-before-commit)
aren't checkable from a PR diff and stay hook/CI-enforced — they aren't agents.

## Run

```bash
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs holdout      # real metric
DEEPSEEK_API_KEY=... RUNS=5 node tooling/pr-review/review.mjs holdout   # averaged
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs dev          # iterate/sanity
```

## Scoring

Every case runs through **every** agent. Scoring is at the (case × agent) level:
a case is labeled with the agent id(s) whose rules it violates (empty = clean),
so the harness measures both **coverage** (did the right agent catch it) and
**cross-agent noise** (did the other agents stay silent). It averages over `RUNS`
passes because the model isn't deterministic even at temp 0.

## Protocol (why the number is honest)

- **`cases.holdout.mjs`** is mostly verbatim snippets from this repo (real legit
  comments, tests, sanctioned patterns) — the real false-positive test,
  out-of-distribution from the synthetic `cases.mjs` dev set.
- The doctrine is never tuned to a held-out case: agents source the real docs,
  and prompt changes are general, never per-case patches. Fixes go to *labels*
  when a "miss" turns out to be mislabeled — never to the prompt.
