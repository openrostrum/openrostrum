# PR-review doctrine + eval

`doctrine.md` is the reviewer prompt for the DeepSeek-backed PR reviewer: the four
semantic house rules lint can't catch (`bs-comment`, `weak-test`, `shortcut`,
`legacy-shim`), biased toward precision — a false positive blocks good code and
trains the team to ignore the bot, so silence beats noise.

`review.mjs` measures the prompt against labeled cases and reports
precision/recall/F1 at the case×category level.

## Run

```bash
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs holdout   # real metric
DEEPSEEK_API_KEY=... RUNS=5 node tooling/pr-review/review.mjs holdout   # averaged
DEEPSEEK_API_KEY=... node tooling/pr-review/review.mjs dev       # iterate/sanity
```

## Protocol (why it isn't overfit)

- **`cases.mjs` (dev)** — synthetic cases for iteration and sanity only.
- **`cases.holdout.mjs` (test)** — mostly verbatim snippets from this repo (real
  legit comments, real tests, sanctioned throws). It is the real generalization
  metric and is **never** tuned against: the doctrine is edited only with general
  principles, never patched to a case that failed here.
- The model isn't deterministic even at temp 0, so `RUNS=N` averages over passes.

## Result (deepseek-v4-flash, held-out, 5-run micro-average)

Precision **100%** · Recall **89%** · F1 **94%**. Dev (~91%) ≈ holdout (~94%): no
overfitting gap. Precision-first by design — the residual misses are ambiguous or
subtle positives, never noise on real code.
