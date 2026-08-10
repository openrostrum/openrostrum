# Verification capabilities — the ground-truth gate

> ## 🚧 HARD GATE — do not start build work until this list is solved
> No scaffolding, no coding, no screen-building, no agent swarm — **nothing** — until every capability below is **Provisioned** (an agent can reach and exercise it with zero human help). The swarm is only reliable if every functional claim can be self-verified by the agent. Until then, work stops here.
>
> **Owner of the gate:** Val. **Status:** 🔴 OPEN (2 / 10 provisioned). Last updated 2026-08-09.

## Principle
We do **not** write the tests or dictate the method (no mandated Playwright, no mandated anything). **We provision access; the agent picks how to verify.** Our only job is to remove every "I can't check this because I lack access to X" blocker. A feature is not "done" until the paired reviewer agent has *exercised the real thing* and shown the result — not eyeballed a screenshot.

Scope note: this covers **functional** verification. Pure-aesthetic choices (the *look* of a screen) have no functional oracle and don't get a faked one — that stays a human glance. Everything functional, the agent proves itself.

---

## Capability inventory (each must reach 🟢 Provisioned before build starts)

Priority order = judge-replay path first. "Acceptance" = what proves an agent can self-verify this surface unaided.

| # | Surface | What "verify" means (agent action) | Capability to provision | Acceptance | Status |
|---|---------|-----------------------------------|-------------------------|-----------|--------|
| 1 | **Running instance + test accounts** | drive the app as admin *and* as submitter | a reachable dev/preview URL + seeded admin + submitter creds | an agent logs in as each role via API/headless and gets a session | 🔴 |
| 2 | **Seed + reset** | return to a known demo state between checks | `seed` + `reset` command (deterministic) | agent runs reset → identical baseline every time | 🔴 |
| 3 | **Database / auto-provision** | after accept, assert speaker+session+task rows exist | direct DB query access (conn string or query tool) | agent queries post-accept and sees the provisioned rows | 🔴 |
| 4 | **Email delivery** | trigger a send, then read the delivered message + body + attachments | real provider (Resend/CF Email) **+ a programmatically-readable inbox** | agent triggers confirmation email and reads its contents via API | 🟢 |
| 5 | **Calendar invite (.ics)** | fetch the attachment, parse it, confirm it imports | .ics reachable + a parser/calendar to import into | agent parses the VEVENT and asserts fields (or imports to a calendar) | 🔴 |
| 6 | **File uploads (headshot/slides/docs)** | upload a file, confirm stored + retrievable | object storage (R2/S3) + access | agent uploads then downloads the same bytes back | 🔴 |
| 7 | **Airtable one-way sync** (P2) | change a record in-app, then read Airtable to confirm | Airtable base + API token wired | agent mutates in-app, reads the synced row in Airtable | 🟢 |
| 8 | **API compatibility** (P2) | hit our API, diff response shapes vs spec | the Sessionboard OpenAPI (have it) + HTTP access | agent diffs a core endpoint's envelope against the spec | 🔴 |
| 9 | **Performance (<1s)** | measure real load against the deployed URL | deployed target + timing capability | agent records sub-1s loads on the demo path | 🔴 |
| 10 | **The judges' own harness** | run swyx's eval kit end-to-end against our deploy and read the scored report | `docs/reference/killmysaas-evals/` (vendored, runnable: `npm install && npm run eval -- --url <ours>`) + `ANTHROPIC_API_KEY` (~$2–10/run) | a full 01→06 run produces `report.html` with ≥60% coverage and per-area scores we've read and acted on (crosswalk: `docs/eval-crosswalk.md`) | 🔴 |

> **Cost policy for #10 (binding):** the kit is **integration-owner-only — feature agents NEVER run it** (their oracles are the free local ones above). Paid runs are budgeted: a few area-scoped checkpoints after major waves (`--areas … --agent-model claude-haiku-4-5 --judge-model claude-haiku-4-5 --max-turns 18`, ~cents–$1 each) + ONE full Sonnet-agent/Opus-judge run against the deploy on Aug 11 + one subset re-run of failed areas. Everything else uses the free modes: `npm run smoke` (offline), `--dry-run` (validate/plan, no API calls), `rescore`/`finalize` (re-score stored evidence, no API calls). Total ceiling ≈ $40.

---

## How to access (provisioned rows)

**#4 Email** — proven end-to-end 2026-08-09 (Resend send id `8cf4999a…` → D1 row, 4972 raw bytes):
- Send: Resend, from `OpenRostrum <noreply@openrostrum.com>` (domain verified, us-east-1). Local key in `.dev.vars`; prod via `wrangler secret put RESEND_API_KEY`. Key is **send-only scoped** — it cannot read delivery status or manage domains (dashboard only).
- Read: catch-all on `openrostrum.com` (Cloudflare Email Routing → `openrostrum-inbox` worker, source `tooling/inbox-worker/`) stores every inbound message raw in its own D1:
  `wrangler d1 execute openrostrum-inbox --remote --json --command "SELECT rcpt_to, subject, raw FROM inbox ORDER BY received_at DESC LIMIT 5"`
- Gotchas: a bounced recipient lands on Resend's **suppression list** and later sends to it are silently dropped (accepted with an id, never delivered, absent from the log) — use a fresh `<anything>@openrostrum.com` per test, never reuse a bounced address. The local dev oracle stays the `email_outbox` D1 sink (no key set → local adapter).

**#7 Airtable** — proven 2026-08-09 (schema read, table create, record write/read/delete):
- Scratch base `appt5DjfBHBzdor5S` + PAT in `.dev.vars` (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`); prod via `wrangler secret put`. Scopes: `data.records:read/write`, `schema.bases:read/write` — agents create tables/fields via the metadata API (`/v0/meta/bases/$BASE/tables`), no hand-built schema.
- Gotchas: 5 req/s per base (why sync is background-only); the API **cannot delete tables** (records yes) — name throwaway tables `_`-prefixed and ignore them.

## Open decisions that block provisioning

None. D1 (test identities) is resolved by #4's infrastructure: dedicated addresses on `openrostrum.com`, no real accounts. D5 (Airtable) is resolved by #7's scratch base. D2, D3, D4, and D6 are resolved by the locked stack ([`docs/tech-stack.md`](docs/tech-stack.md)).

## Already available in this session (candidate oracles, if we choose to use them)
Gmail MCP (read a test inbox) · Google Calendar MCP (import an .ics) · Vercel MCP (deploy/preview + logs/errors) · PostHog MCP (real telemetry/perf). Caveat: these authenticate as your real accounts — see D1/D2 before pointing the swarm at them.

## Local-instance isolation & remaining pre-work

The stack and the worktree-isolation mechanism live in [`docs/tech-stack.md`](docs/tech-stack.md) — not repeated here. This gate additionally requires, before any swarm starts:

- **Freeze a version-pinned RR7 + Cloudflare + Vite starter template** that boots and deploys (exercised on `wrangler dev`). Highest-leverage single de-risk.
- **Golden-path templates** agents copy: one route module, one Queue consumer, one `vitest-pool-workers` config + example D1 test, one canonical feature (list + table + form + drawer).

**Cloud-singleton verification:** real Resend deliverability and a real Airtable base can't be N-way isolated across worktrees → verify them in a single serialized integration lane, not in parallel.

**Isolation acceptance:** ≥3 worktree instances run the full demo path at once with zero cross-talk (DB / mail / storage / ports); `reset` on one doesn't touch another.

## Definition of done for this gate
Every row 🟢 with a recorded **how-to-access** (endpoint / credential / command) that an agent can pick up cold, **and** a one-time smoke proof that an agent actually exercised each oracle. When all 9 are green → the gate lifts and build may begin.
