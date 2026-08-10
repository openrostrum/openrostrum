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
- **Draft saves need only a title;** required-field validation applies when
  advancing steps or submitting. Speakers can edit submitted proposals until
  the form's close date; after that, submissions are read-only.
- **Close dates accept past values** (that's how you close a CFP immediately).
- **Airtable sync:** `⏳ base invite link / note` — pushes submissions,
  contacts, and task statuses; team edits in Airtable flow back on a ~5-min
  tick (Airtable wins on team-editable fields).

## Deploy secrets

Beyond `RESEND_API_KEY`, the deployed instance requires
`UNSUBSCRIBE_SECRET` (`wrangler secret put UNSUBSCRIBE_SECRET` — any long
random string). It signs the unsubscribe-footer tokens; without it, any
deployed instance fails loud at announcement-send time rather than signing
tokens with a public dev constant anyone could forge.

## Reset / seed

Owner-run: `wrangler d1 execute openrostrum --remote --file drizzle/seed.sql`
restores the live demo baseline (idempotent — the seed deletes before
inserting). Locally: `pnpm db:reset`.
