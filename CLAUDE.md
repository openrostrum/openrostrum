# Kill My SaaS — agent guide

Open-source clone of Sessionboard (conference speaker/session/program management). Built by parallel coding agents in git worktrees, each pair coder + reviewer, with **functional** self-verification.

## Read before you code (single source of truth — do not restate these elsewhere)
- **`docs/tech-stack.md`** — the stack + the **mandatory platform rules** (D1 has no interactive transactions → `db.batch()`; import from `react-router` only; WebCrypto/`node:crypto` for hashing; presigned direct-to-R2 uploads; outbound-only email; Tailwind v4 CSS-first; shadcn pre-installed). Read this first.
- **`SCOPE.md`** — what to build (P0/P1/P2/OUT tiers).
- **`docs/BUILD-SCREENS.md`** — every screen → its reference screenshot.
- **`docs/flows/`** — per-module behavior ("what happens when").
- **`VERIFICATION-CAPABILITIES.md`** — the verification gate (provisioned separately).

## The pattern to copy
`app/routes/submissions.tsx` is the **golden path**: loader (Cloudflare env → Drizzle → D1) → typed component (`./+types/*`) → Tailwind UI, with a loader test in `test/`. Mirror its shape for every feature. External seams go behind a port — see `app/ports/email.ts`.

## Commands
| Task | Command |
|------|---------|
| Dev server (this worktree, unique port) | `pnpm dev:worktree` |
| Regenerate binding/route types | `pnpm typegen` |
| Generate a migration from schema | `pnpm db:generate` |
| Apply migrations to local D1 | `pnpm db:migrate` |
| Reset local DB (wipe → migrate → seed) | `pnpm db:reset` |
| Tests (in workerd, real D1) | `pnpm test` |
| **Full check before you commit** | `pnpm verify` |

`pnpm verify` = typecheck + conventions guard + lint + tests. It must pass. The guard (`scripts/check-conventions.sh`) hard-fails on the import/transaction/`node:` mistakes the type-checker can't catch.

## Migration protocol (parallel-agent safety)
Schema lives in `app/db/schema.ts`. **Schema changes are authored on the integration branch and consumed by worktrees** — do NOT each mint migrations, or `0000_*.sql` files collide. If your feature needs a column/table, request it on the integration branch.

## Worktree isolation
Each worktree is a full instance: unique port (via `pnpm dev:worktree`), per-worktree `.wrangler/state` (D1 file + R2 blobs), no service bindings. `pnpm db:reset` in one worktree never touches another.
