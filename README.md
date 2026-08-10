<div align="center">
  <img src="public/favicon.svg" width="88" alt="OpenRostrum mark — an O standing on a platform">
  <h1>OpenRostrum</h1>
  <p><strong>The open-source Sessionboard alternative.</strong><br>
  Conference speaker, session, and program management — CFP forms, submission review,
  speaker portals, agenda building, speaker comms, public session pages. Free, self-hostable, Cloudflare-native.</p>
  <p><a href="https://openrostrum.com">openrostrum.com</a></p>
</div>

> Full product README lands with the submission. Until then: what to build is `SCOPE.md`,
> how it's built is `docs/`, and grader notes are `docs/JUDGING.md`.
> Built for swyx's Kill My SaaS 1 hackathon.

## Quick start

```bash
pnpm install
pnpm db:reset   # wipe → migrate → seed the local D1 database
pnpm dev        # http://localhost:5173
```

`pnpm verify` runs the full gate (map check, typecheck, lint, stylelint, tests in workerd against real D1) — run it before every commit.

## Deploy your own

The committed config holds no account-specific values, so a fork deploys cleanly:

```bash
wrangler d1 create openrostrum          # prints your database id
cp .deploy.env.example .deploy.env      # set CF_D1_DATABASE_ID (+ EMAIL_FROM)
pnpm db:migrate:remote && wrangler d1 execute openrostrum --remote --file=./drizzle/seed.sql
pnpm run deploy                         # injects your .deploy.env, then deploys
```

Set secrets on the worker for real integrations (all optional — each falls back to a local/no-op adapter when unset): `wrangler secret put RESEND_API_KEY`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`. Email also needs `EMAIL_FROM` (a sender on your Resend-verified domain) — set it in `.deploy.env`. See `.dev.vars.example` for the full list.

### Auto-deploy on merge to `main`

CI deploys to Cloudflare on every push to `main`, once quality passes — no account-specific values live in the repo, so it only turns on when you add these **repository secrets** (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a token with Workers Scripts + D1 edit permissions
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id
- `CF_D1_DATABASE_ID` — the id `wrangler d1 create openrostrum` printed

Optionally set an `EMAIL_FROM` repository **variable** to override the committed default. The deploy job applies remote D1 migrations, then deploys. Until the secrets exist, the job is a green skip. Runtime secrets (`RESEND_API_KEY`, `AIRTABLE_*`, `TURNSTILE_SECRET`) live on the worker via `wrangler secret put` and are not read by CI.

## Stack

React Router 7 (framework mode) · Cloudflare Workers · D1 + Drizzle · R2 · Tailwind v4 · Vitest (workers pool). Agent-built in parallel git worktrees with functional self-verification; the conventions that make that work live in `CLAUDE.md` and `docs/`.
