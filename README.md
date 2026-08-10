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

## Stack

React Router 7 (framework mode) · Cloudflare Workers · D1 + Drizzle · R2 · Tailwind v4 · Vitest (workers pool). Agent-built in parallel git worktrees with functional self-verification; the conventions that make that work live in `CLAUDE.md` and `docs/`.
