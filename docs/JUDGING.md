# For the graders — how to judge this deployment

This file feeds the eval kit's `submissionNotes` and is written for whoever points `sbek` (or their own hands) at the deployed site. The production base URL is `https://openrostrum.com`; all relative URLs below resolve from it.

## Entry points

| Surface | URL |
|---|---|
| App root (links the showcased public pages) | `https://openrostrum.com/` |
| Organizer admin | `/admin` (also `/dashboard`, `/organizer`) |
| Organizer sign-up and first-run setup | `/signup` → `/onboarding` (conference name) → `/onboarding/dates` → `/onboarding/place` → `/admin`. Only the name is required; the last two steps can be skipped and set later in `/admin/settings` |
| Speaker CRM | `/admin/crm` · directory `/admin/crm/directory` · sourcing pipeline `/admin/crm/pipeline` |
| Agenda builder | `/admin/agenda` |
| AI review | `/admin/evaluation?tab=ai` |
| Public CFP form | `/cfp` redirects to the default open form; route shape `/submit/<event-slug>/<form-id>` |
| Speaker portal | `/portals/<event-slug>/<portal-id>` from confirmation email; authenticated speakers can also enter at `/portal` |
| Reviewer dashboard | `/reviews` (reviewer role lands here after login) |
| Public pages | `/sessions/<slug>` · `/speakers/<slug>` · `/schedule/<slug>` · `/itinerary/<slug>` · `/gallery/<slug>` (bare routes redirect to the default event) |
| Public embeds | `/embed/<public-id>` (seeded example: `/embed/embed-demo-uuid`) |
| Feeds | `/feeds/<slug>/sessions.json` · `/feeds/<slug>/sessions.xml` · `/feeds/<slug>/sessions.html` · `/feeds/<slug>/speakers.json` · `/feeds/<slug>/speakers.xml` · `/feeds/<slug>/speakers.html` · `/feeds/<slug>/agenda.ics` · `/feeds/<slug>/widget.js` |
| Compat API | `/api/v1/*` — header `x-access-token: kms-demo-api-token` |

## Seeded credentials (all passwords: `password`)

| Persona | Email | Notes |
|---|---|---|
| Organizer/admin | `admin@example.com` | Member of the seeded "Demo" organization. A new account created through `/signup` followed by `/onboarding` gets a separate organization and event; organization membership scopes all admin access and event data |
| Reviewer | `reviewer@example.com` | Password login works; reviewer management also shows a **copyable invite link** for new reviewers |
| Speaker | `speaker@example.com` pre-seeded, or create an account through the public CFP | Email+password; no magic links |

The exact seeded speaker home is `/portals/ai-engineer-sandbox/portal-demo-uuid/home` after signing in as `speaker@example.com`.

## Behaviors worth knowing (by design, mirrors Sessionboard)

- **Status changes never auto-send email.** Accept Queue / Decline Queue are staging statuses that render as "Pending" in the speaker portal. The decision UI first previews the eligible recipients and email content, then requires an explicit confirm-send action; successful sends finalize those submissions.
- **Acceptance and participant roles are separate concerns.** CFPs support speakers/co-presenters, chairpersons, moderators, and secondary contacts. Acceptance moves content into review, links an existing account when its normalized email matches, and idempotently assigns the default onboarding tasks to every speaker-role participant; account invitations and decision emails stay explicit.
- **Email evidence without an inbox:** every send is logged at `/admin/emails/history` with recipient, subject, status, and timestamp, so judges can verify delivery attempts in-app.
- **Public visibility has explicit gates:** a session must be both accepted and content-approved to enter the public projection. The schedule and itinerary additionally require the organizer to publish the agenda from `/admin/agenda`.
- **Speaker CRM is organization-wide, not event-local.** `/admin/crm/directory` searches and filters contacts across events, supports bulk event assignment and pipeline enrollment, and exposes saved segments plus an eight-stage sourcing pipeline from Researching through Declined.
- **Embeds and feeds use the same public projection.** Organizers configure five embed surfaces in `/admin/embeds`; the copyable feed URLs and widget loader are listed above.
- **Theme choice is real product state.** System, Light, and Dark are available across auth, organizer, and speaker-portal surfaces; the browser's choice applies immediately and persists.
- **Org team invites carry a copyable link (no inbox needed).** At `/admin/settings/team`, "Invite teammate" (name + email) creates a pending invite whose full link is shown with a Copy button and also emailed. `/set-password/<token>` sets a password and lands the new member in `/admin` as an equal organization admin. Any member may remove any member through the in-app confirmation except the last one, whose removal is refused with an inline explanation; self-removal logs that member out. The current invite UI does not invite an email that already owns a credentialed account.
- **Turnstile is a no-op when `TURNSTILE_SECRET` is absent.** The current public CFP renders no widget, so browser agents can exercise it.
- **The compat API is read-only with Hide-PII always on.** It supports event reads; session search/list/get; speakers; contacts; and track/tag/format/level/room/language/status catalogs with the Sessionboard pagination envelope (default 25, max 100). Emails and phones are masked (`j***@a***.com`, `***-***-4567`), statuses retain raw queue values, and drafts never appear. `PUT`, `PATCH`, `DELETE`, plus `POST` paths ending in `/create`, `/bulk`, or `/restore`, return 405; supported POST search remains available.
- **AI review lives at `/admin/evaluation` → "AI review".** Per-submission "Run AI review" and bulk "Run AI review on unscored" produce a 0–10 first-pass score and rationale through DeepSeek V4 Flash when configured, otherwise the fixed Workers AI fallback `@cf/openai/gpt-oss-120b`. The model ID appears on detail. AI scores are badge-labeled, never enter the human tally or scorecard aggregate, and organizer overrides persist with who/when and the AI original. The plan table and cumulative CSV keep AI and human aggregates in separate columns. With neither provider, the tab states that AI review is unavailable.
- **Draft saves need only a title;** required-field validation applies when advancing or submitting. Speakers can edit submitted proposals until the form close date; afterward, submissions are read-only. Past close dates are accepted so an organizer can close a CFP immediately.
- **Airtable sync is a deployment-configured two-way mirror** for sessions/submissions, contacts, and task assignments, currently bound to the Demo organization rather than per-organization credentials. `/admin/settings/airtable` shows an explicit not-configured state when secrets are absent; when configured, it shows linked-record counts, the last trigger/status/provider error, and a **Sync now** action. App changes push out; Airtable edits return by provisioned webhook or hourly reconciliation, with Airtable winning on team-editable fields.

## Deploy secrets

Production email uses `RESEND_API_KEY`; announcement sends also require `UNSUBSCRIBE_SECRET` (`pnpm exec wrangler secret put UNSUBSCRIBE_SECRET` with any long random value). It signs unsubscribe-footer tokens, and a production send fails before the recipient loop when the secret is missing rather than using the public development fallback. `EMAIL_FROM` is a normal Wrangler variable, and scheduled task/draft reminders require `APP_ORIGIN=https://openrostrum.com` because no request URL exists when cron builds portal links. AI and Airtable credentials are optional and surface explicit unavailable/not-configured states when absent.

## Reset / seed

Locally, `pnpm db:reset` rebuilds the whole demo baseline in one command: wipe, migrate, seed D1, then load featured speaker headshots and three slide decks into local R2. The authored assets and byte-pinning manifests live under `scripts/seed-assets/`; `scripts/seed-demo-blobs.mjs` performs the upload.

Remote enrichment is owner-run and scoped. Do **not** rerun the full `drizzle/seed.sql` against a multi-tenant live database because it deletes tenant rows before inserting. Run the **Apply production demo data** workflow in `.github/workflows/demo-data.yml`; it injects the deployment's D1 ID, verifies and uploads the pinned R2 bundle first, then applies the idempotent `drizzle/seed-demo-enrichment.sql` updates and conflict-safe file upserts. Blob-first ordering prevents an R2 failure from leaving D1 rows pointed at missing objects.

The uploader verifies every PNG/PDF byte count and SHA-256 against its committed manifest before writing. Remote execution is deliberately explicit and owner-run; local development stays isolated in local R2.
