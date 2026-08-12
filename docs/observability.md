# Observability — runtime truth is queryable

**The rule: a claim about runtime behavior cites a query, not a theory.** "The webhook retried", "this page is slow", "the email went out" are all one query away — run it, paste the evidence. **Reviewer litmus:** *"what query would prove this?"*

## Events

`track(evt, fields)` from `app/lib/track.ts` emits one JSON line per event — the queryable record of what the app did.

- Names are `domain.verb` / `domain.verb_failed`: `submission.created`, `sync.reconciled`, `email.send_failed`.
- Always include the tenant ids in hand (`eventId`, `submissionId`, …) — they are the join keys of every future query.
- Emit at: every action's mutation outcome (the golden path shows the pattern), domain transitions (the accept spine), every Airtable webhook ping and reconciliation outcome, email sends.
- Never put secrets, session tokens, or raw user content in fields.

## Timings

`createTimings()` wraps request phases and surfaces them once as a `Server-Timing` response header (`db;dur=12.3`). Workers clocks only advance across I/O — time I/O phases (DB, fetch); pure CPU reads as ~0 by design.

## The queries

| Question | Query |
|---|---|
| What is the deploy doing right now | `pnpm exec wrangler tail --format=json` — events are one-line JSON inside log messages; filter with `jq` |
| What happened earlier on the deploy | Workers Logs in the Cloudflare dashboard (`observability.enabled` is on in `wrangler.json`) — filter by `evt` |
| Where does this request spend its time | `curl -sD - -o /dev/null <url>` → `Server-Timing` header |
| Which D1 queries are slow | `pnpm exec wrangler d1 insights openrostrum` |
| Did the email go out, to whom, with what body | `/admin/emails/history` — the in-app send log (also the judge's delivery evidence) |
| What did the Airtable sync do | sync `track()` events + `airtable_links` snapshot rows |
| Where new organizers drop out of first run | filter `evt` by the `onboarding.` prefix and compare counts per step: `signup.created` → `onboarding.event_created` → `onboarding.dates_saved`/`dates_skipped` → `onboarding.completed`. A step whose skip count dwarfs its save count is a question worth cutting, not a funnel to nag harder |
| Local dev | events print as JSON lines in the `pnpm dev:worktree` terminal |
