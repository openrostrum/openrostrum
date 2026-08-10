<div align="center">
  <img src="public/favicon.svg" width="88" alt="OpenRostrum mark — an O standing on a platform">
  <h1>OpenRostrum</h1>
  <p><strong>The open-source Sessionboard alternative.</strong><br>
  Conference speaker, session, and program management — free, self-hostable, and yours to keep.</p>
  <p><a href="https://openrostrum.com">openrostrum.com</a> · <a href="#quick-start">Quick start</a> · <a href="#deploy-your-own">Deploy your own</a></p>
</div>

## What it does

OpenRostrum runs the program side of a conference, end to end:

- **Call for speakers** — a multi-step submission form builder with conditional logic, participant roles, and close dates; publish the link and submissions arrive.
- **Submission review** — approve / maybe / deny, routed to reviewers by track; accepting a submission auto-creates the speaker, the session, and their onboarding tasks.
- **Speaker portals** — a self-service home for every speaker: bios, headshots, slides, task forms, and live submission status.
- **Speaker comms** — templated confirmations, decisions, and reminders with real **.ics calendar invites** (one stable entry per session; updates move it in place).
- **Agenda building** — drag-and-drop day × room scheduling with instant speaker/room conflict detection and one-action auto-place.
- **Task tracking** — which speakers still owe a bio, a headshot, or a travel form, on one screen.
- **Public pages** — live schedule, speaker directory, session catalog, and personal itinerary, plus embeds and JSON/XML/iCal feeds — rendered from the same data the team edits.
- **Airtable sync** — native push of submissions, speakers, and sessions into your base (no Zapier).

See it running at [openrostrum.com](https://openrostrum.com) — the public [schedule](https://openrostrum.com/schedule), [speakers](https://openrostrum.com/speakers), and [sessions](https://openrostrum.com/sessions) pages of a live event are open to everyone, no account needed.

## Quick start

Local development needs [pnpm](https://pnpm.io) and Node 20+:

```bash
pnpm install
pnpm db:reset   # wipe → migrate → seed the local D1 database
pnpm dev        # http://localhost:5173
```

## Deploy your own

OpenRostrum deploys to your own Cloudflare account — you hold the database (D1), the uploaded files (R2), and every speaker record. The committed config contains no account-specific values, so a fork deploys cleanly:

```bash
wrangler d1 create openrostrum          # prints your database id
cp .deploy.env.example .deploy.env      # set CF_D1_DATABASE_ID (+ EMAIL_FROM)
pnpm db:migrate:remote
pnpm run deploy                         # injects your .deploy.env, then deploys
```

Optionally seed sample data with `wrangler d1 execute openrostrum --remote --file=./drizzle/seed.sql`.

Integrations are opt-in secrets on the worker — each falls back to a local/no-op adapter when unset:

```bash
wrangler secret put RESEND_API_KEY      # outbound email (also set EMAIL_FROM in .deploy.env)
wrangler secret put AIRTABLE_API_KEY    # native Airtable sync
wrangler secret put AIRTABLE_BASE_ID
```

See `.dev.vars.example` for the full list. Forks can also auto-deploy on every merge to `main` — see [`.github/workflows/`](.github/workflows/) for the three repository secrets that switch it on.

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

MIT.

---

<sub>OpenRostrum began at swyx's Kill My SaaS hackathon.</sub>
