# For the graders — how to judge this deployment

This file feeds the eval kit's `submissionNotes` and is written for whoever
points `sbek` (or their own hands) at the deployed site. Placeholders marked
`⏳` are filled at deploy time — grep this file for `⏳` before submitting; any that remain are unfinished.

## Entry points

| Surface | URL |
|---|---|
| App root (links every public surface) | `https://openrostrum.com/` |
| Organizer admin | `/admin` (also `/dashboard`, `/organizer`) |
| Organizer sign-up (own org + first event) | `/signup` → one-form onboarding → empty `/admin` |
| Public CFP form | linked from the homepage; shape `/submit/<event-slug>/<form-id>` |
| Speaker portal | `/portals/<event-slug>/<portal-id>` (linked from confirmation email + homepage) |
| Reviewer dashboard | `/reviews` (reviewer role lands here after login) |
| Public widgets | `/sessions/<slug>` · `/speakers/<slug>` · `/schedule/<slug>` · `/itinerary/<slug>` · `/gallery/<slug>` (bare `/sessions` etc. redirect to the demo event) |
| Feeds | `/feeds/<slug>/sessions.json` · `.xml` · `/feeds/<slug>/agenda.ics` |
| Compat API | `/api/v1/*` — header `x-access-token: kms-demo-api-token` |

## Seeded credentials (all passwords: `password`)

| Persona | Email | Notes |
|---|---|---|
| Organizer/admin | `admin@example.com` | Pre-seeded as a member of the "Demo" organization (the tenant the sandbox event lives in — multi-org per `docs/multi-tenancy-design.md`). Organizer sign-up is live at `/signup`: it creates a fresh account + its own organization + first event; new sign-ups never see the Demo org or its data, nor it theirs |
| Reviewer | `reviewer@example.com` | Password login works; reviewer management also shows a **copyable invite link** for new reviewers |
| Speaker | `speaker@example.com` pre-seeded, or sign up at the public CFP form | Email+password; no magic links anywhere |

## Behaviors worth knowing (by design, mirrors Sessionboard)

- **Status changes never auto-send email.** Accept Queue / Decline Queue are
  staging statuses that render as "Pending" in the speaker portal; the bulk
  Accept/Decline email send flips them final. A one-click
  "accept + send + finalize" shortcut exists on the decision UI.
- **Email evidence without an inbox:** every send is logged at
  `/admin/emails/history` (recipient, subject, status, timestamp) — the eval
  kit accepts an in-app email log as delivery evidence.
- **Content approval gates public output:** a session appears on the public
  widgets only when its content status is Approved (independent of the
  accept decision). The agenda/itinerary additionally require the agenda to be
  Published (button in the agenda builder).
- **Org team invites carry a copyable link (no inbox needed).** At
  `/admin/settings/team`, "Invite teammate" (name + email) creates a pending
  invite whose full link is shown in the UI with a Copy button — the same link
  is also emailed. Opening the link at `/set-password/<token>` sets a password
  and lands the new member in `/admin` as an equal admin of the organization.
  Any member may remove any member (in-app confirm, no native dialogs), except
  the last one — that removal is refused with an inline message. Removing
  yourself logs you out.
- **Bot protection is disabled on this deployment** so browser agents can
  exercise the public form (the Turnstile port resolves to a no-op without
  keys).
- **The compat API is read-only with Hide-PII always on.** `/api/v1` mirrors
  Sessionboard's read surface — `GET /api/v1/events`, session search
  (`POST /api/v1/event/<eventId>/sessions`) / list / get, speakers, contacts,
  and the lookup catalogs (tracks/tags/formats/levels/rooms/languages/statuses)
  — with their pagination envelope (default 25, max 100). Emails and phones
  come back masked (`j***@a***.com`, `***-***-4567`); statuses are the raw
  pipeline values including queue states; drafts never appear; write
  operations answer an explicit 405.
- **AI-assisted review lives at `/admin/evaluation` → "AI review" tab.**
  Per-submission "Run AI review" and a bulk "Run on unscored" action produce a
  0–10 first-pass score with a written rationale (DeepSeek V4 Flash when its key
  is configured; benchmark-selected Workers AI fallback otherwise; model id
  shown on the detail). AI scores are always badge-labeled "AI", never enter the
  human decision tally or scorecard aggregates, and an organizer can override
  the number — the override persists with who/when, alongside the AI original.
  The plan results table and the cumulative CSV carry the AI score in its own
  column beside the human aggregate. On a deployment with neither a DeepSeek key
  nor Workers AI binding, the tab states so explicitly instead of scoring.
- **Draft saves need only a title;** required-field validation applies when
  advancing steps or submitting. Speakers can edit submitted proposals until
  the form's close date; after that, submissions are read-only.
- **Close dates accept past values** (that's how you close a CFP immediately).
- **Airtable sync:** two-way mirror of sessions, contacts, and task
  assignments into the organizer's own Airtable base — there is no public base
  invite link; the grader-facing evidence is in-app at
  `/admin/settings/airtable`: per-table linked-record counts, the last sync
  run (trigger, status, and any provider error shown verbatim), and a
  **Sync now** button for an on-demand pass. The app pushes its changes; team
  edits in Airtable flow back via webhook when one is provisioned, otherwise
  on the hourly reconciliation poll (Airtable wins on team-editable fields).

## Deploy secrets

Beyond `RESEND_API_KEY`, the deployed instance requires
`UNSUBSCRIBE_SECRET` (`wrangler secret put UNSUBSCRIBE_SECRET` — any long
random string). It signs the unsubscribe-footer tokens; without it, any
deployed instance fails loud at announcement-send time rather than signing
tokens with a public dev constant anyone could forge.

## Reset / seed

Locally: `pnpm db:reset` rebuilds the whole demo baseline in one command —
wipe, migrate, seed D1, and load the featured speaker headshots plus three
slide decks into local R2 (`scripts/seed-demo-blobs.mjs`; authored assets and
byte-pinning manifests live under `scripts/seed-assets/`).

Remote is owner-run and **scoped**: since organizer sign-up went multi-tenant,
re-running the full `drizzle/seed.sql` against the live DB would delete other
organizations' rows (it deletes before inserting). The seed's enrichment
section is the dedicated, idempotent `drizzle/seed-demo-enrichment.sql`
(`UPDATE`s by id + conflict-safe file upserts). Upload the idempotent blobs
first, so an R2 failure cannot leave live D1 rows pointing at missing objects:

```sh
node scripts/seed-demo-blobs.mjs --remote
wrangler d1 execute openrostrum --remote \
  --file=drizzle/seed-demo-enrichment.sql
```

The uploader verifies every PNG/PDF byte count and SHA-256 against its
committed manifest before writing. `--remote` is deliberately explicit and
owner-run; the script defaults to isolated local R2 for normal development.
