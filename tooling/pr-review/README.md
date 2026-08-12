# PR review — autonomous rule owners

The production reviewer runs one independent DeepSeek session per dynamically
discovered `docs/rules/*.md` document. Each session owns the entire pull request
under its assigned rule document and decides what repository evidence to inspect.

## Architecture

- `agents.mjs` discovers and sorts every rule document; there is no maintained
  reviewer list.
- `core.mjs` loads each document verbatim and configures Pi's native DeepSeek
  provider for `deepseek-v4-flash`.
- `agent.mjs` gives each rule owner its own `@earendil-works/pi-agent-core`
  `Agent`. Its initial context is a compact changed-file index (status, path,
  rename, and line counts), never concatenated diffs. Pi owns the persistent
  conversation, provider streaming, validated tool execution, and continuation;
  the model controls investigation order and breadth.
- `repository.mjs` exposes read-only, paginated tools for changed-file diffs,
  changed or unchanged file contents at base/head, literal repository search,
  and tracked-path listing. Git is invoked with argument arrays and paths must be
  repository-relative.
- `ci-review.mjs` launches the rule-owner sessions in parallel and passes their
  findings into the existing deterministic posting pipeline in `inline.mjs`.

With the five current rule documents, the old production shape was up to
`60 files × 5 rules × 3 samples = 900` stateless model requests. The new shape is
exactly **five top-level whole-PR sessions**. A session can make model-directed
continuations after tool calls, bounded by turn, tool-call, request, and wall-time
limits; production never creates a model review per changed file.

The launcher does not rank files, create clusters, prescribe traversal order, or
encode a delegation workflow. Its only orchestration is independent rule-owner
parallelism and safety limits.

## Completion semantics

A session is complete only after the provider stops normally and its terminal JSON
passes a TypeBox schema at the boundary — no hand-rolled shape checks. Provider
errors, timeouts, malformed tool calls, aborted runs, findings that fail the schema
or cite an unchanged file, and exhausted budgets are **incomplete**, never clean.

Incomplete runs are named in the summary and fail the required AI-review check.
Findings from completed sessions still post, but zero findings cannot render as “no
issues found” and all stale-thread resolution is deferred until every rule owner
completes.

## Deterministic posting

Findings land as one advisory GitHub review (`event: COMMENT`), with one thread per
anchored finding.

- **Anchoring:** the agent supplies an absolute new-file line and exact quote.
  The line is accepted only when that quote matches an added diff line. Existing
  quote and snippet-map fallbacks remain for compatibility; unanchorable findings
  become file-level comments.
- **Fallbacks:** file-level failure demotes to the review body; rejected inline
  reviews retry with body findings; a second review failure falls back to the
  summary comment. Findings are not silently dropped.
- **Identity and dedupe:** stable markers fingerprint file plus normalized rule
  concept, excluding line and reviewer identity. Exact or conservative fuzzy
  matches suppress repeat posts, including human-resolved threads.
- **Reconciliation:** a vanished finding gets one resolved reply and a
  best-effort GraphQL thread resolution only after a complete review. Bot-resolved
  findings that reappear post fresh.

The GitHub Actions job uses `pull_request`, not `pull_request_target`. Fork PRs do
not receive the DeepSeek secret or a write token. The job installs the pinned Pi
runtime with lifecycle scripts disabled before launching the reviewers.

## Verification

All local reviewer tests are network-free:

```bash
node --test tooling/pr-review/*.test.node.mjs
```

They cover dynamic one-session-per-rule launch over a 240-file index, multi-turn
changed and unchanged reads, Git-backed repository access and path safety,
provider/tool/budget failure states, anchoring, fingerprints, dedupe,
reconciliation, stale deferral, and posting payloads. CI runs this complete set in
its unconditional quality job.

A local production dry run performs real DeepSeek sessions but no GitHub writes:

```bash
DEEPSEEK_API_KEY=... DRY_RUN=1 \
  BASE_SHA=<base> HEAD_SHA=<head> node tooling/pr-review/ci-review.mjs
```

Supplying `GH_TOKEN`, `REPO`, and `PR_NUMBER` additionally previews reconciliation
against existing comments using read-only GitHub calls.

## Evaluation

`review.mjs` now evaluates the production autonomous-agent boundary. Each fixture
is exposed as a one-file pull request with the same repository tools, every rule
owner gets its own session, and any incomplete session aborts the run rather than
being scored as a clean prediction.

```bash
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  RUNS=5 node tooling/pr-review/review.mjs holdout
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs dev
```

The former 99.0% F1 / 98.1% precision / 100% recall numbers measured the removed
per-file majority-of-three architecture. They are historical and are not claimed
for the autonomous reviewer. The fixture corpus remains available, but the new
architecture must establish its own baseline through the agentic harness above.
