# AI review provider design

## Goal

Make DeepSeek V4 Flash the preferred AI submission-review provider when `DEEPSEEK_API_KEY` is configured, while retaining a benchmark-selected Workers AI model as the keyless fallback. Human review remains authoritative and existing AI scores, rationale, override, timeout, retry, bounded bulk, and compare-and-set persistence behavior stays intact.

## Provider boundary

`AiChatProvider` remains the only generation seam used by the review pipeline. It accepts provider-neutral text chat turns and returns response text plus an optional API-reported model ID.

Provider resolution is capability-based, in this order:

1. A non-empty `DEEPSEEK_API_KEY` creates the DeepSeek provider.
2. Otherwise, an `AI` binding creates the Workers AI provider using `AI_REVIEW_WORKERS_MODEL` or the benchmark winner.
3. Otherwise, the feature renders an explicit unavailable state and performs no inference.

## DeepSeek protocol

The DeepSeek adapter uses the official Anthropic-compatible Messages endpoint:

- `POST https://api.deepseek.com/anthropic/v1/messages`
- `x-api-key: <DEEPSEEK_API_KEY>`
- model `deepseek-v4-flash`
- top-level `system` text and `messages` containing only plain-text content
- `max_tokens` and `temperature`; no `output_config`

This deliberately avoids unsupported image/document blocks and compatibility fields that DeepSeek ignores. The adapter reads text from Anthropic response `content` blocks and stores the API-reported model ID when present. Non-2xx responses fail through the existing typed provider-error path without exposing the secret.

## Workers AI fallback benchmark

Benchmark `@cf/moonshotai/kimi-k2.6` and `@cf/openai/gpt-oss-120b` through the real Workers AI binding with the exact production review messages and generation settings. Use a fixed set of realistic CFP submissions from repository fixtures, including strong, thin, and prompt-injection cases. Run identical repeated prompts for both models and alternate model order.

Record:

- first-response schema-valid JSON count/rate;
- successful valid verdict count after the production one-retry parser;
- wall-clock latency distribution (median and p95, plus failures/timeouts);
- blinded output-quality score against a fixed rubric: submission-specific evidence, score calibration, non-fabrication, rationale usefulness, and instruction-injection resistance.

Select the winner by validity and quality first, latency second. Keep `AI_REVIEW_WORKERS_MODEL` as an operational override. Put the method, sample size, aggregate numbers, winner, and limitations in the PR decision record; do not commit raw secrets.

## Generation and persistence

The existing review pipeline continues to ask for JSON in text, salvage the first object, validate score `0..10` and a substantive rationale with Zod, and retry malformed output once. Calls remain bounded by timeout. Persistence remains compare-and-set so stale or concurrent inference cannot overwrite a newer score or human override. A re-run clears the old override only when its fresh verdict wins the compare-and-set.

## UI and observability

The AI tab continues to distinguish AI scores from human decisions and aggregates. It shows the configured model, preserves organizer overrides with actor/time, and explains both configuration routes when inference is unavailable. Existing success/failure/save-skipped telemetry remains provider-neutral and records the actual model ID.

## Verification

Tests pin the DeepSeek Messages endpoint, key header, exact model, plain-text-only payload, absence of `output_config`, Anthropic content-block parsing, API-reported model storage, provider priority, Workers fallback model, malformed retry, timeout/error behavior, compare-and-set persistence, and route-level scoring. Run targeted tests, `pnpm verify`, the real benchmark, and an end-to-end app flow under `wrangler dev` before opening the PR.
