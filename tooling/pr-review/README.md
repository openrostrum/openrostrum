# PR review — full-coverage, doc-sourced

The DeepSeek-backed PR reviewer and the harness that validates it. The prompt and
client live in **`core.mjs`** — the eval (`review.mjs`) and the production CI
reviewer (`ci-review.mjs`) both import it, so the thing measured is the thing that
ships.

## How coverage works

One reviewer **agent per rule doc in `docs/rules/`** (`agents.mjs` discovers them
by globbing — no hand-maintained list). Each agent loads its doc **verbatim** at
review time as the source of truth, so the rules can never drift from the md
files and coverage is provably the union of `docs/rules/`. Add a rule doc → it
gets reviewed. The split keeps each agent's context to one doc (better precision)
while together they cover the whole rule surface.

Purely-procedural rules (git append-only, squash-merge, verify-before-commit)
aren't checkable from a PR diff and stay hook/CI-enforced — they aren't agents.

## Voting (why the reviewer is quiet)

DeepSeek isn't deterministic even at temp 0: a single-shot review posts a flaky
false positive ~1-in-5 times per problematic check. On a merge-gating comment
that noise is what trains people to ignore the bot. So `reviewVoted` draws
`SAMPLES` independent reviews per (file, agent) and only reports a finding that
recurs in at least `THRESHOLD` of them. The samples fire concurrently
(`Promise.all`) — 3× the API calls, one round-trip of latency. Default is
**majority-of-3** (`SAMPLES=3 THRESHOLD=2`).

Measured on the held-out set (5 passes, single-shot vs voting), same prompt:

| | single-shot | vote 2/3 |
|---|---|---|
| F1 | 95.0% | **99.0%** |
| precision | 90.4% | 98.1% |
| recall | 100% | 100% |
| worst pass (precision) | 70.8% | 94.4% |

Recall is untouched; voting collapses the false-positive tail.

## Run the eval

```bash
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  RUNS=5 node tooling/pr-review/review.mjs holdout            # single-shot, averaged
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  RUNS=5 SAMPLES=3 THRESHOLD=2 node tooling/pr-review/review.mjs holdout   # voting
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs dev    # synthetic dev set
```

## Run the production reviewer locally

```bash
DEEPSEEK_API_KEY=... DRY_RUN=1 \
  BASE_SHA=<base> HEAD_SHA=<head> node tooling/pr-review/ci-review.mjs
```

`DRY_RUN=1` prints the comment instead of posting it. In CI the `ai-review` job
(`.github/workflows/ci.yml`) supplies `GH_TOKEN`/`REPO`/`PR_NUMBER` and it posts
one advisory comment, edited in place on re-push. It is **comment-only** — it
never fails the check. It reviews the PR diff only (the new side of each changed
source file), never pre-existing code, and runs no PR-authored code.

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
