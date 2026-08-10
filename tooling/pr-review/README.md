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

## How findings are posted (inline reviews)

Findings land as **one GitHub review (event `COMMENT` — always advisory, never
`REQUEST_CHANGES`)** whose inline comments anchor each finding to its diff line,
so every finding can be resolved, dismissed, or answered individually. The pure
logic lives in `inline.mjs` (unit-tested, no network); `ci-review.mjs` only
orchestrates.

- **Anchoring** — a finding is pinned to a new-side diff line by (1) matching a
  code quote from its `location`/`why` (backticked spans first, `...` elisions
  handled) against the diff's added+context lines, added lines preferred; else
  (2) reading `location`'s `:N` as a *snippet* line (the model only ever saw the
  snippet) and mapping it back to the file line via `parseDiff().map`. The
  snippet is byte-identical to the pre-inline format the eval validated, with
  one disclosed, tested exception: added lines whose content starts with `++`
  are now kept (the old parser dropped them by accident).
- **Fallback chain, nothing dropped** — can't anchor → file-level review
  comment (`subject_type: "file"`); that POST fails → an "Unanchored findings"
  section in the review body. A rejected review (422) retries once with every
  comment demoted to the body; if that also fails, the findings land in the
  legacy summary comment.
- **Re-run dedupe** — every posted finding embeds
  `<!-- deepseek-finding fp=<sha256-16> file=<path> words=<concept words> -->`.
  The fingerprint hashes file + sorted concept words (rule + why, normalized) —
  line numbers and agent ids are excluded, so it survives pushes and messenger
  wobble. A re-run skips findings whose fingerprint (or fuzzy word overlap, same
  file, capped to the marker's 24 words on both sides) already has a thread —
  including human-resolved ones: a human closed it, the bot doesn't nag. The
  exception is a thread the BOT itself declared resolved: a finding reappearing
  after that posts fresh — never deduped into silence by the bot's own claim.
- **Reconcile** — threads whose finding no longer appears get ONE reply
  ("resolved in `<sha>` — finding no longer present") and a best-effort GraphQL
  `resolveReviewThread`; if the token can't run the mutation the reply stands.
  A thread is only closed when its file was re-reviewed cleanly this run (or
  left the diff entirely) — a finding that "vanished" because its file fell
  past `MAX_FILES` or a check errored defers to a run with full signal.
- **No findings** → the single `<!-- deepseek-review -->` summary comment, as
  before. Never an empty review.

## Run the production reviewer locally

```bash
DEEPSEEK_API_KEY=... DRY_RUN=1 \
  BASE_SHA=<base> HEAD_SHA=<head> node tooling/pr-review/ci-review.mjs
```

`DRY_RUN=1` (or `--dry-run`) prints the review payload and reconcile plan
instead of posting; add `GH_TOKEN`/`REPO`/`PR_NUMBER` to preview reconciliation
against a real PR's existing threads (read-only — a dry run never writes). In CI
the `ai-review` job (`.github/workflows/ci.yml`) supplies those and posts for
real. It is **comment-only** — it never fails the check. It reviews the PR diff
only (the new side of each changed source file), never pre-existing code. The
job's security boundary is the fork guard — fork PRs never receive the secret
or a write token; within it the job runs only this repo's review scripts (no
dependency install, no build).

Unit tests for the pure posting logic (CI runs them unconditionally in the
`quality` job — no secret needed; they stay out of the `ai-review` job, which
runs only the review scripts):

```bash
node --test tooling/pr-review/inline.test.node.mjs
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
