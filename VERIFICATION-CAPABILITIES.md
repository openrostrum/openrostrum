# Verification capabilities — the ground-truth gate

> ## 🚧 HARD GATE — do not start build work until this list is solved
> No scaffolding, no coding, no screen-building, no agent swarm — **nothing** — until every capability below is **Provisioned** (an agent can reach and exercise it with zero human help). The swarm is only reliable if every functional claim can be self-verified by the agent. Until then, work stops here.
>
> **Owner of the gate:** Val. **Status:** 🔴 OPEN (0 / 9 provisioned). Last updated 2026-08-08.

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
| 4 | **Email delivery** | trigger a send, then read the delivered message + body + attachments | real provider (Resend/CF Email) **+ a programmatically-readable inbox** | agent triggers confirmation email and reads its contents via API | 🔴 |
| 5 | **Calendar invite (.ics)** | fetch the attachment, parse it, confirm it imports | .ics reachable + a parser/calendar to import into | agent parses the VEVENT and asserts fields (or imports to a calendar) | 🔴 |
| 6 | **File uploads (headshot/slides/docs)** | upload a file, confirm stored + retrievable | object storage (R2/S3) + access | agent uploads then downloads the same bytes back | 🔴 |
| 7 | **Airtable one-way sync** (P2) | change a record in-app, then read Airtable to confirm | Airtable base + API token wired | agent mutates in-app, reads the synced row in Airtable | 🔴 |
| 8 | **API compatibility** (P2) | hit our API, diff response shapes vs spec | the Sessionboard OpenAPI (have it) + HTTP access | agent diffs a core endpoint's envelope against the spec | 🔴 |
| 9 | **Performance (<1s)** | measure real load against the deployed URL | deployed target + timing capability | agent records sub-1s loads on the demo path | 🔴 |

---

## Open decisions that block provisioning

D2, D3, D4, and D6 are resolved by the locked stack ([`docs/tech-stack.md`](docs/tech-stack.md)). Still open:
- **D1 — Test identities: dedicated throwaway vs real accounts.** *Recommend dedicated* (catch-all inbox, scratch Airtable base, scratch calendar) so the swarm can't touch your real `val@delphi.ai` data.
- **D5 — Airtable** (for #7): base + API token, or defer #7 until P2.

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
