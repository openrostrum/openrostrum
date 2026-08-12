# Tech Stack

The definitive stack for the Sessionboard clone. Cloudflare-native, TypeScript end-to-end, designed to run as N isolated local instances across parallel git worktrees. This document is the single source of truth; if something here conflicts with another doc, this wins.

## Platform (Cloudflare)

| Concern | Choice |
|---|---|
| Runtime & deploy | Cloudflare Workers/Pages — one Worker exports `fetch` + `scheduled` + `queue` |
| Database | Cloudflare **D1** (SQLite) — embedded file gives trivial per-worktree isolation |
| Object storage | Cloudflare **R2** |
| Async jobs | Cloudflare **Queues** (email/sync) + **Cron Triggers** (5-day / 1-day reminders) |
| Outbound email | **Resend** |
| Bot protection | Cloudflare **Turnstile** (public CFP form + `/signup`) |
| Local dev | `wrangler dev` |

## Language & libraries

| Layer | Choice | Pin |
|---|---|---|
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | — |
| Framework | React + **React Router v7** (framework mode) | **7.x exact — never 8.x** |
| ORM | **Drizzle** (on D1) | 0.45.x, lockfile-pinned |
| Contracts/validation | **Zod** + **drizzle-zod** (DB schema is the single source for row + form + API types) | Zod 4 |
| Styling | **Tailwind v4** (CSS-first config) | 4.x |
| Components | **shadcn/ui** (Radix), copy-in — added to the starter before fan-out; agents don't run `npx shadcn add` | — |
| Rich text | **Tiptap** behind a shared `<RichText/>` component (`immediatelyRender:false`) | — |
| Data tables | **TanStack Table** (headless) | v8 |
| Drag-and-drop | **dnd-kit** (agenda builder) | — |
| Forms | **React Hook Form** + Zod resolver (pin resolver + zod together) | — |
| Calendar files | **`app/lib/ics.ts`** — dependency-free RFC 5545 serializer, plain utility, not a port (the npm `ics` package's yup CJS chain fails to load in the workers vitest pool; owner may drop the unused dep) | — |
| Auth | ownable session module in D1; hashing via **WebCrypto PBKDF2** (or native `node:crypto.scrypt`) | — |
| Compat API (P1 #20) | **Hono** sub-app mounted on splat route `/api/v1/*` (one deployable, shared Drizzle/Zod) | — |
| Package manager / bundler | **pnpm** / **Vite** | — |
| Lint | **ESLint** (flat) + typescript-eslint + react/hooks/jsx-a11y + custom AST rules in `tooling/eslint-rules/` + `no-restricted-*` seams. Custom rules ported from the `cloudflare-agent-exercise` repo; skipped its CF-Workflow/AI-agent/monorepo-specific rules. | 9.x |
| Format | **Biome** — formatter only; its linter is disabled (ESLint owns linting). | 2.x |
| Tests | **Vitest** + **@cloudflare/vitest-pool-workers** (runs in workerd against real local D1) | — |
| Observability | Cloudflare Workers Logs (+ Logpush); `@sentry/cloudflare` optional | — |

Exact patch versions are frozen in `package.json` when the starter template is built (see "Local development").

## Ports (the only swappable seams)

Everything that differs between local and cloud sits behind a typed interface with a local and a prod adapter. Nothing else gets a port.

| Port | Prod adapter | Local / test adapter |
|---|---|---|
| `EmailSender` | Resend | D1 `email_outbox` table (agent-queryable) |
| `AirtableSync` | real Airtable base (serial integration lane); COMMITTED, tiered: push-on-change (Tier 1) + periodic pull of team edits ("source of truth", Tier 2) — see SCOPE P1 #15 | local fake table |
| `Turnstile` | Cloudflare Turnstile verify | no-op pass |
| `AI review` | DeepSeek Messages when keyed; Workers AI fallback | explicit unavailable state / injected scripted provider |
| `Clock` | real `now()` | injectable fixed time |

**Not ports:** Calendar (`ics` is a pure function — identical everywhere) and Storage (R2 emulates locally via Miniflare — use a thin wrapper only, not a swappable adapter).

**Timeouts:** a `fetch` in `app/ports/` that builds an options object must pass a `signal` — enforced by a `no-restricted-syntax` seam scoped to that directory. A third party answering with an error is the outage shape everyone handles; one that accepts the connection and then says nothing is the one that gets forgotten, and an unbounded `fetch` hands the only limit to the platform. Pick the deadline from who is waiting: `turnstile.ts` fails closed at 5s because a speaker is mid-submit, `email.ts` bounds its POST under the send-claim lease, `airtable.ts` bounds each attempt so a silent request is retried like the 5xx it resembles.

## Platform rules (mandatory)

- **D1 has no interactive transactions.** Use `db.batch()` for atomic multi-writes. Never `db.transaction()` — it throws at runtime.
- **`nodejs_compat`** is enabled globally.
- **Passwords:** WebCrypto PBKDF2 or native `node:crypto.scrypt`. Never native bcrypt (won't run on Workers) or pure-JS scrypt (blows the CPU budget).
- **File uploads/downloads:** Worker-mediated through the R2 binding — a POST to a `files.upload` route streams to `env.BLOBS.put(...)`; a GET to `files/:id` streams `env.BLOBS.get(...)` back after an authz check. (The R2 binding works identically in local Miniflare and prod; presigned direct-to-R2 needs S3 creds that don't exist locally and gives no authz'd read-back path — verified by the scenario walk. Speaker uploads are small: headshots/slides, well under the 100 MB request cap. If a future need exceeds that, add presigned PUT for that path only.)
- **Email:** outbound only — no inbound `email()` handler. Deduplicate with the D1 `email_outbox.dedupe_key` (template + recipient + occurrence) plus Resend idempotency keys. Failed sends use the ACCEPTED bounded-retry model (owner ruling 2026-08-10, GAP-REGISTER T1/C3): every send path is idempotent-keyed so a retry resumes without duplicating; Queue+DLQ infra is the registered post-submission follow-up (GAP-REGISTER S1). Do not use the rate-limit binding for idempotency.
- **React Router imports:** import from `react-router` only — never `react-router-dom` or `@remix-run/*`, and never the `json()`/`defer()` helpers (return plain objects). An ESLint `no-restricted-imports` rule fails lint on violations; `react-router typegen` is wired into the typecheck script.
- **Client bundle:** public and schedule pages render SSR and stay light; Tiptap and dnd-kit are lazy-loaded / code-split so they never ship to public visitors. (They don't count against the 10 MB Worker script cap — they're static assets — but they hurt public-page load if shipped everywhere, and load speed is judged.)
- **Tailwind v4:** CSS-first config (`@import "tailwindcss"` + `@theme`). No `tailwind.config.js`.
- **No shadcn:** the planned shadcn substrate was removed 2026-08-10 (never imported; its `cn` conflicted with `app/ui/cn.ts`). UI composes the hand-rolled `app/ui` primitives exclusively — enforced by the `ui-primitives-only` ESLint rule; agents never run `npx shadcn add`.
- **Routing:** file-based (`@react-router/fs-routes` `flatRoutes()`). Each feature owns a file in `app/routes/` per `docs/ROUTE-MAP.md`; nobody edits `app/routes.ts` — that is what lets agents add routes in parallel without conflicting there. Filename → URL: `_index.tsx` → `/`, `submissions.tsx` → `/submissions`, `submissions.$id.tsx` → `/submissions/:id`, `admin.forms.tsx` → `/admin/forms`. `admin.tsx` is the admin shell layout; `admin.*.tsx` are its children. Because EVERY file under `app/routes/` becomes a route, a component or helper shared by two routes lives in its own feature directory (`app/settings/`, `app/cfp/`, …) instead — the `ui-primitives-only` lint covers those directories the same as routes.
- **Nav:** each feature contributes one `app/nav/<feature>.nav.ts` (pure data); the shell auto-discovers via `import.meta.glob` — no shared nav file to edit.
- **Async jobs:** two cron cadences are pre-declared (`wrangler.json` `triggers.crons`: daily `0 9 * * *` + hourly `0 * * * *`) and `workers/app.ts` routes each tick to the `app/jobs/*.scheduled.ts` jobs declaring that cadence (`ScheduledJob.cron` matched against `controller.cron`); reminder/other jobs add a file, not an entrypoint edit. A new cadence = a new `triggers.crons` entry (integration-owned) — `test/scheduled.dispatch.test.ts` pins the lockstep.
- **Auth:** protect routes with `requireUser`/`requireAdmin`/`requireRole` from `app/lib/auth.ts`. A layout loader gates GET navigation for its children; **every `action` must self-authenticate** (a POST doesn't re-run parent loaders) — enforced by the `require-auth-in-actions` ESLint rule (opt out a genuinely public mutation with a `// @public` comment).
- **Shared files are integration-owned + guarded:** `schema.ts`, `drizzle/migrations`, `drizzle/seed.sql`, `package.json`, `pnpm-lock.yaml`, `wrangler.json` (see `scripts/guard-schema.sh`). All stack deps are pre-installed/frozen — no `pnpm add` in worktrees.

## Local development & worktree isolation

The stack runs as N concurrent, fully isolated local instances — one per git worktree — with zero cross-instance overlap. Everything is keyed to a single instance id and is ephemeral.

- **Per instance:** a free `--port` (base + offset, probed for collisions by `scripts/worktree-dev.sh`), inspector port auto-assigned, no service bindings, and per-worktree `.wrangler/state`. All persistent state (D1 file, R2 blobs, `email_outbox`) lives inside the worktree, so isolation is by state + port — the worker `name` is shared and irrelevant locally (it only matters for remote deploy).
- **Reset:** wipe `.wrangler/state` → apply migrations to local D1 → run seed. A `db:reset` and `db:seed` script provide this; the seed recreates a realistic conference (event, CFP forms, submissions across every status, an evaluation plan, scheduled + unscheduled sessions, onboarding tasks).
- **Migrations:** authored on a single integration branch and consumed by worktrees — agents do not each mint migrations. This is ENFORCED, not just documented: a lefthook pre-commit (`scripts/guard-schema.sh`) blocks any feature-branch commit touching `app/db/schema.ts` or `drizzle/migrations/` (integration owner overrides with `ALLOW_SCHEMA_CHANGE=1`). One apply-path: **`drizzle-kit generate` (flat SQL into `migrations/`) → `wrangler d1 migrations apply`**, and the same `migrations/` directory feeds `@cloudflare/vitest-pool-workers` (`applyD1Migrations`) so dev, tests, and prod share one mechanism.
- **Secrets:** `.dev.vars` locally (with a committed `.dev.vars.example`); `wrangler secret put` for prod.
- **Binding-touching code is exercised under `wrangler dev`, not `vite dev`** (service/binding behavior differs between them; `wrangler dev` matches prod).

## Not using (and why)

| Rejected | Use instead | Why not |
|---|---|---|
| Postgres | D1 (SQLite) | on Cloudflare it needs an external managed DB + Hyperdrive — a network seam that also breaks per-worktree isolation |
| Next.js · TanStack Start · SvelteKit · SPA + separate API | React Router v7 | Next-on-CF adapter is rough; TanStack Start still RC; Svelte drops the React component ecosystem; SPA+API adds a client/server seam |
| React Router v8 | React Router v7 (pinned) | v8 (Jun 2026) is ESM-only and removed `react-router-dom`; the training corpus is v6/v7 |
| Vercel `portless` | deterministic `--port` offsets | adds a shared `:443` proxy + local CA + sudo — a shared singleton against the isolation model; agents verify by port, not browser URL |
| Mailpit / SMTP local sink | D1 `email_outbox` | Resend is HTTPS not SMTP; a D1 table needs no extra process/port and is agent-queryable + auto-isolated per worktree |
| native bcrypt · pure-JS `@noble` scrypt | WebCrypto PBKDF2 / `node:crypto.scrypt` | bcrypt won't run on Workers; pure-JS scrypt intermittently blows the CPU budget |
| Lucia | ownable session module (`better-auth` only if OAuth/2FA is added) | Lucia is no longer maintained as a library |
| TanStack Query / Zustand wholesale | RR7 loaders/actions; add either narrowly only where a widget needs it | duplicates the loader cache and adds a seam |
| `vite dev` for binding-touching code | `wrangler dev` | binding / service-binding behavior differs from prod under `vite dev` |

## Platform facts (verified Aug 2026)

- **D1:** 10 GB max · single-writer · 2 MB max row · 1000 queries/invocation · 30 s/query · no interactive transactions. All comfortably clear for a single-conference app (use `db.batch()` for bulk).
- **Workers:** 10 MB gzip *script* cap (client JS ships as static assets, excluded) · CPU 30 s default, 5 min max, I/O wait free.
- **Queues** are on the Cloudflare free plan.
- **React Router** is GA on Cloudflare with the 1.0 Vite plugin; **v8 exists (Jun 2026) and is deliberately not used**.

_Stack validated by independent multi-agent review, Aug 2026._
