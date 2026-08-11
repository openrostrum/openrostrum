<div align="center">
  <img src="public/favicon.svg" width="88" alt="OpenRostrum mark — an O standing on a platform">
  <h1>OpenRostrum</h1>
  <p><strong>The open-source Sessionboard alternative.</strong><br>
  Conference speaker, session, and program management — free, self-hostable, and yours to keep.</p>
  <p><a href="https://openrostrum.com">openrostrum.com</a> · <a href="#quick-start">Quick start</a> · <a href="#deploy-your-own">Deploy your own</a></p>
  <p>
    <a href="https://github.com/openrostrum/openrostrum/actions/workflows/ci.yml"><img src="https://github.com/openrostrum/openrostrum/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  </p>
</div>

<a href=".github/media/agenda-builder.png"><img src=".github/media/agenda-builder.png" alt="The OpenRostrum agenda builder — a published day × room grid with scheduled sessions, an unscheduled tray, and one-action auto-place"></a>
<p align="center"><sub>The agenda builder: schedule on the day × room grid, work through the unscheduled tray, and publish when the program is ready.</sub></p>

## What it does

OpenRostrum runs the program side of a conference, end to end:

- **Call for speakers** — build and publish multi-step CFPs with conditional fields, close dates, submission limits, and multiple participants: speakers/co-presenters, chairpersons, moderators, and secondary contacts.
- **Submission review** — reviewers work assigned evaluation rounds or track-routed queues, score with scorecards, and record approve / maybe / deny recommendations; organizers retain the final decision. Acceptance moves content into review, provisions each speaker's onboarding tasks, and links matching existing accounts; invitations and decision emails remain explicit actions.
- **AI review** — run optional, bounded first-pass scoring with rationale through DeepSeek or Workers AI; scores stay visibly separate from human tallies and organizers can override them.
- **Speaker CRM** — manage an organization-wide directory across events, saved segments, event assignments, person details, and an eight-stage sourcing pipeline.
- **Speaker portals** — give invited speakers authenticated self-service pages with live submission status, editable bios and headshots, task forms and uploads, and shared files.
- **Speaker comms** — preview templated confirmations, decisions, reminders, and schedule updates, with **.ics calendar invites** that update the same calendar entry in place.
- **Agenda building** — drag sessions from an unscheduled tray onto timezone-aware day × room grids, detect overlapping room and speaker bookings instantly, or auto-place sessions where legal capacity exists and report what did not fit.
- **Task tracking** — filter assignments by speaker, task, status, and due date, flag overdue work, and send bounded reminder batches from one organizer dashboard.
- **Public program** — publish a live schedule, session catalog, speaker directory/gallery, and personal itinerary, plus configurable embeds, JSON/XML/basic HTML feeds, iCal, and a JavaScript widget from the same data.
- **Self-serve organizer setup** — create an account, then use guided first-run setup to create an organization and its first event with a slug, dates, and timezone; events and admin access stay organization-scoped.
- **Theme preferences** — switch between System, Light, and Dark instantly, with the choice persisted across auth, organizer, and speaker-portal surfaces.
- **Airtable sync** — optionally run background two-way sync for sessions/submissions, contacts, and task assignments with field-aware conflict handling; today, each deployment configures one base for its demo organization (no Zapier).

| Submission review | Speaker portal |
|---|---|
| ![Submission review — the full list with statuses, track routing, and bulk accept/decline email actions](.github/media/submissions-review.png) | ![Speaker portal — a speaker's self-service view of their submissions, profile, and outstanding tasks](.github/media/speaker-portal.png) |
| Review the pipeline, then preview and send decision emails explicitly. | Invited speakers manage submissions, profile, tasks, and files. |

| Speaker CRM directory |
|---|
| ![Speaker CRM directory — cross-event contacts with filters, bulk event assignment, and pipeline enrollment](.github/media/speaker-crm.png) |
| Search the organization-wide directory, assign contacts to events, and enroll prospects into the sourcing pipeline. |

See it running at [openrostrum.com](https://openrostrum.com). The public [schedule](https://openrostrum.com/schedule/ai-engineer-sandbox), [speakers](https://openrostrum.com/speakers/ai-engineer-sandbox), and [sessions](https://openrostrum.com/sessions/ai-engineer-sandbox) pages require no account; the schedule appears after an organizer publishes the agenda. Bare aliases such as `/schedule` redirect to the default event.

## Quick start

Local development needs [pnpm](https://pnpm.io) and Node 20+ (CI runs Node 24):

```bash
pnpm install
pnpm db:reset   # wipe → migrate → seed the local D1 database
pnpm dev        # http://localhost:5173
```

After `pnpm db:reset`, sign in at `/login` with organizer `admin@example.com` / `password`. Speaker `speaker@example.com` and reviewer `reviewer@example.com` use the same password.

## Deploy your own

OpenRostrum targets Cloudflare Workers with D1 and R2 — you hold the database, uploaded files, and every speaker record. Before deploying a fork, create both resources and remove or replace the committed `openrostrum.com` custom-domain route in `wrangler.json`:

```bash
pnpm exec wrangler d1 create openrostrum          # prints your database id
pnpm exec wrangler r2 bucket create openrostrum-files
cp .deploy.env.example .deploy.env                # set CF_D1_DATABASE_ID (+ EMAIL_FROM)
set -a; source .deploy.env; set +a
cp wrangler.json .wrangler.deploy.json
node scripts/inject-wrangler-id.mjs .wrangler.deploy.json
pnpm exec wrangler d1 migrations apply openrostrum --remote --config .wrangler.deploy.json
rm .wrangler.deploy.json
pnpm run deploy                                   # injects .deploy.env into the built config
```

`drizzle/seed.sql` deletes tenant data and is only for an empty demo database; use `pnpm db:reset` locally, never as a live-data refresh. The production demo is refreshed through [the scoped workflow](.github/workflows/demo-data.yml).

Configure Resend before sending real email: without it, mail stays in the D1 outbox rather than reaching recipients. Production email also needs a verified `EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, and `APP_ORIGIN` for links created by scheduled reminder jobs. Airtable shows an explicit not-configured state unless both core secrets exist; AI review uses DeepSeek first, then the Workers AI binding, otherwise stays unavailable.

```bash
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put UNSUBSCRIBE_SECRET
pnpm exec wrangler secret put APP_ORIGIN
pnpm exec wrangler secret put AIRTABLE_API_KEY    # optional native Airtable sync
pnpm exec wrangler secret put AIRTABLE_BASE_ID
pnpm exec wrangler secret put DEEPSEEK_API_KEY    # optional AI review provider
```

See `.dev.vars.example` for the full list. Forks can auto-deploy on every merge to `main` through [the CI workflow](.github/workflows/ci.yml) after its Cloudflare and D1 repository secrets are configured.

## Documentation

| Topic | Where |
|---|---|
| Data model (events, submissions, speakers, sessions) | [`docs/data-model.md`](docs/data-model.md) |
| Design system | [`docs/rules/design-system.md`](docs/rules/design-system.md) |
| Airtable sync design | [`docs/airtable-sync-design.md`](docs/airtable-sync-design.md) |
| Runtime observability (events, timings, log queries) | [`docs/observability.md`](docs/observability.md) |

## Stack

React Router 7 (framework mode) · Cloudflare Workers · D1 + Drizzle · R2 · Tailwind v4 · Vitest (workers pool).

## Contributing

Conventions live in [`docs/rules/`](docs/rules/); `pnpm verify` runs the full check (typecheck, lint, tests in workerd against real D1) — CI runs the same gate on every PR.

## License

[MIT](LICENSE).
