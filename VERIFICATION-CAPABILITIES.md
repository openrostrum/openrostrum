# Verification capabilities — the ground-truth gate

> ## ✅ GATE LIFTED — build may begin
> **Owner of the gate:** Val. **Status:** 🟢 LIFTED (10 / 10 provisioned, each smoke-proven live). Last updated 2026-08-10.
> Every capability below was exercised for real on that date — not assumed. The smoke scripts live in `scripts/gate-*.sh` so any agent can re-prove a row cold.

## Principle
We do **not** write the tests or dictate the method (no mandated Playwright, no mandated anything). **We provision access; the agent picks how to verify.** Our only job is to remove every "I can't check this because I lack access to X" blocker. A feature is not "done" until the paired reviewer agent has *exercised the real thing* and shown the result — not eyeballed a screenshot.

Scope note: this covers **functional** verification. Pure-aesthetic choices (the *look* of a screen) have no functional oracle and don't get a faked one — that stays a human glance. Everything functional, the agent proves itself.

---

## Capability inventory — all provisioned, with cold-start access notes

| # | Surface | How an agent accesses it (cold) | Smoke proof (2026-08-10) | Status |
|---|---------|--------------------------------|--------------------------|--------|
| 1 | **Running instance + test accounts** | Live: `https://openrostrum.com` (Worker `openrostrum`, custom domain). Seeded logins `admin@example.com` / `reviewer@example.com` / `speaker@example.com`, password `password` (form POST to `/login`). Local: `pnpm dev:worktree`. Re-prove: `bash scripts/gate-login-smoke.sh` | all 3 roles logged in over HTTP; admin reached `/admin`, non-admins correctly hit `/403` | 🟢 |
| 2 | **Seed + reset** | Local: `pnpm db:reset` (wipe → migrate → seed). Remote (owner lane): `wrangler d1 migrations apply openrostrum --remote` + `wrangler d1 execute openrostrum --remote --file drizzle/seed.sql` | two consecutive resets produced identical row fingerprints (3/1/8/2 users/events/submissions/contacts) | 🟢 |
| 3 | **Database / direct query** | `npx wrangler d1 execute openrostrum --local --command "<sql>" --json` (add `--remote` for prod, owner lane). In tests: real D1 via `vitest-pool-workers` | queried users local + remote; 12 tests run against real D1 every `pnpm verify` | 🟢 |
| 4 | **Email delivery** | App sends land in the D1 `email_outbox` table (the in-app log the eval kit accepts as delivery evidence). Real provider: Resend (send-only key). Real **readable inbox**: catch-all → `openrostrum-inbox` worker — see "Deep how-to" below | outbox row inserted + read back locally; real Resend sends returned 200 + message ids (2026-08-09 + -10) | 🟢 |
| 5 | **Calendar invite (.ics)** | `email_outbox.ics_attachment` holds the payload; parse VEVENT fields with stdlib (see `scripts/gate-oracles-smoke.sh` for the 10-line parser) | fixture VEVENT parsed, SUMMARY/DTSTART/LOCATION asserted | 🟢 |
| 6 | **File uploads (R2)** | Local/tests: `BLOBS` binding (miniflare). Remote bucket `openrostrum-files`: `wrangler r2 object put|get openrostrum-files/<key> --remote` | 1 KB random blob uploaded remote, downloaded, `cmp` byte-identical, deleted | 🟢 |
| 7 | **Airtable sync** (P1) | `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` in `.dev.vars`. REST: `api.airtable.com/v0/meta/bases/$BASE/tables` (schema), `/v0/$BASE/$TABLE` (records) | schema read 200; record created then deleted via API | 🟢 |
| 8 | **API compatibility** | Spec: all 177 ops distilled in [`docs/flows/08-settings-data-api.md`](docs/flows/08-settings-data-api.md) (canonical `openapi.yaml`, fetched 2026-08-08; raw yaml re-fetchable from apidocs.sessionboard.com). Probe deploy with `curl -H "x-access-token: kms-demo-api-token" https://openrostrum.com/api/v1/…` | HTTP path exercised (404 today — `/api/v1` routes not built yet; oracle ready for when they are) | 🟢 |
| 9 | **Performance (<1s)** | `curl -s -o /dev/null -w "%{time_starttransfer}" https://openrostrum.com/` | 3 samples: 154–187 ms TTFB — 5× headroom under the 1 s bar | 🟢 |
| 10 | **The judges' own harness** | `docs/reference/killmysaas-evals/`: `npm install`, then free modes `npm run smoke` (offline browser harness), `--dry-run`, `rescore`. Upload fixture `fixtures/slides.pdf` is generated (not shipped upstream): `python3 fixtures/make-slides.py`. Paid runs: key available on the owner machine as `ANTHROPIC_API_KEY_PERSO` — **deferred to the final review pass by owner decision** | `npm run smoke` → "SMOKE OK: navigate/fill/select/upload/click/screenshot all worked" | 🟢 |

> **Cost policy for #10 (binding):** the kit is **integration-owner-only — feature agents NEVER run it** (their oracles are the free local ones above). Paid runs are budgeted: a few area-scoped checkpoints after major waves (`--areas … --agent-model claude-haiku-4-5 --judge-model claude-haiku-4-5 --max-turns 18`, ~cents–$1 each) + ONE full Sonnet-agent/Opus-judge run against the deploy on Aug 11 + one subset re-run of failed areas. Everything else uses the free modes. Total ceiling ≈ $40.

## Isolation acceptance — PROVEN

`bash scripts/gate-iso-smoke.sh` (run 2026-08-10): three worktree instances ran concurrently on auto-derived ports (5501/5358/5506), each served the home page and authenticated the seeded admin; a marker row written in instance A never appeared in B; `pnpm db:reset` in B left A's marker and C's rows untouched; all three stayed healthy afterward. Per-worktree isolation = cwd-relative `.wrangler/state` + `scripts/worktree-dev.sh` port derivation.

## Deep how-to: email + Airtable (from the provisioning lane, 2026-08-09)

**#4 Email** — proven end-to-end (Resend send id `8cf4999a…` → D1 row, 4972 raw bytes):
- Send: Resend, from `OpenRostrum <noreply@openrostrum.com>` (domain verified, us-east-1). Local key in `.dev.vars`; prod via `wrangler secret put RESEND_API_KEY`. Key is **send-only scoped** — it can `POST /emails` but 401s on every read/management endpoint; don't "validate" it against `GET /domains`.
- Read: catch-all on `openrostrum.com` (Cloudflare Email Routing → `openrostrum-inbox` worker, source `tooling/inbox-worker/`) stores every inbound message raw in its own D1:
  `wrangler d1 execute openrostrum-inbox --remote --json --command "SELECT rcpt_to, subject, raw FROM inbox ORDER BY received_at DESC LIMIT 5"`
- Gotchas: a bounced recipient lands on Resend's **suppression list** and later sends to it are silently dropped (accepted with an id, never delivered, absent from the log) — use a fresh `<anything>@openrostrum.com` per test, never reuse a bounced address. The local dev oracle stays the `email_outbox` D1 sink (no key set → local adapter).

**#7 Airtable** — proven (schema read, table create, record write/read/delete):
- Scratch base `appt5DjfBHBzdor5S` + PAT in `.dev.vars` (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`); prod via `wrangler secret put`. Scopes: `data.records:read/write`, `schema.bases:read/write` — agents create tables/fields via the metadata API (`/v0/meta/bases/$BASE/tables`), no hand-built schema.
- Gotchas: 5 req/s per base (why sync is background-only); the API **cannot delete tables** (records yes) — name throwaway tables `_`-prefixed and ignore them.

## Swarm rules that keep it true

- **Cloud singletons are serialized:** the real Airtable base, real Resend sends, and the production D1/R2 belong to the single integration lane. Parallel feature agents verify against local oracles only (local D1, `email_outbox`, miniflare R2) — they never touch `--remote` or the live keys.
- **Prod-only platform limits are real:** the Workers runtime caps PBKDF2 `deriveBits` at 100k iterations **in production only** — local workerd doesn't enforce it, so logins 500'd exclusively on the live deploy until `app/lib/auth.ts` and the seeded hashes moved to 100k (found by this gate's first live smoke, fixed 2026-08-10). Lesson: local green ≠ deployed green; the deployed smoke is the oracle that counts.
- **Deploy how-to (owner lane):** `npx wrangler deploy` from a synced checkout (OAuth session on the owner machine). D1 `openrostrum` = `5f1d8b81-229e-4756-8dbb-c0f926b87921`; custom domain + cron are in `wrangler.json`. CI deploy stays off until repo secrets exist (owner decision: optional).

## Resolved decisions (were "open")

- **D1 — test identities:** dedicated seeded accounts (`*@example.com`, password `password`) for app logins, dedicated `<anything>@openrostrum.com` addresses for real-mail tests — the swarm never touches Val's real accounts. Real-provider sends go through the serialized integration lane only.
- **D5 — Airtable:** live base + PAT provisioned and exercised (see row 7).

## Definition of done for this gate — MET

Every row 🟢 with a recorded how-to-access an agent can pick up cold, and a one-time smoke proof that the oracle was actually exercised. Lifted 2026-08-10.
