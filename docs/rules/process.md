# Process — how work flows across parallel agents

## Migration protocol [hook-enforced: `scripts/guard-schema.sh`]

Schema lives in `app/db/schema.ts` and is authored ~complete up front. **Schema changes are authored on the integration branch and consumed by worktrees** — do NOT edit `schema.ts` or mint migrations in a feature worktree, or `0000_*.sql` files collide and `_journal.json` corrupts on merge. A lefthook pre-commit blocks feature-branch commits touching any integration-owned shared file — `app/db/schema.ts`, `drizzle/migrations/`, `drizzle/seed.sql`, `package.json`, `pnpm-lock.yaml`, `wrangler.json`, `app/ui/`, `app/app.css`. Need a column, dependency, binding, or UI primitive? Request it from the integration owner (who overrides with `ALLOW_SCHEMA_CHANGE=1`). All stack deps are pre-installed and frozen — do not `pnpm add`. `pnpm db:generate` is integration-owner only.

## Design-time gate (integration owner)

Any change to `schema.ts`, a port, or a spec must RE-WALK the scenarios whose `touches:` header names the changed artifact — produce the concrete artifact for each affected step (real SQL/route/JSON), not a mechanism name. Inventory-checking ("the column exists") is what let a rule that couldn't trigger on a built-in dropdown ship past three review rounds; walking a scenario to its artifact is what caught it. See [`scenarios/GAP-REGISTER.md`](../scenarios/GAP-REGISTER.md).

**Scoping a re-walk:** walk every step of every scenario the `touches:` match selects; at each step, either produce the changed concrete artifact or record in the walk why that step is unchanged. The affected/unaffected determination is made DURING the walk, step by step — never by pre-filtering the step list (pre-filtering is inventory-checking wearing a different hat). The tenancy migration ([`multi-tenancy-design.md`](multi-tenancy-design.md) Wave A) touches `events`, so its gate is all nine scenarios, walked under this rule.

## Worktree isolation

Each worktree is a full instance: unique port (via `pnpm dev:worktree`), per-worktree `.wrangler/state` (D1 file + R2 blobs), no service bindings. `pnpm db:reset` in one worktree never touches another.

## Verification

`pnpm verify` = typecheck + lint (ESLint) + tests, and it must pass before commit. ESLint carries seams the type-checker can't catch (full rule list in [`tech-stack.md`](tech-stack.md)). Formatting is Biome (`pnpm format`); a lefthook pre-commit runs format + lint + the shared-file guard + the AGENTS.md map check.

## Agent harness — one map, vendor shims [hook-enforced: `scripts/check-map.sh`]

`AGENTS.md` (the cross-vendor standard filename) is the canonical entry point — the map every coding agent reads. Vendor filenames and dirs (`CLAUDE.md`, `.claude/`, `.cursor/`, …) are symlink shims or tool configuration only, **never rules**: rules live in `docs/`, and enforcement lives in git hooks + ESLint + CI, which fire for any agent regardless of what it read at startup. `check-map.sh` fails if a shim stops being a symlink — a diverged copy would mean two sources of truth. Adopting a new tool = add its shim, nothing else.

## Git — append forward, squash in [hook-enforced: `scripts/guard-append-only.sh`]

**Branch history is append-only.** Never `--amend`, never rebase, never force-push — rewriting shared state is how a swarm loses work: an amend invalidates a review already in flight; a force-push orphans a sibling worktree's base. Fix a bad commit with another commit; catch up with main by merging it in (`git merge main`). Hooks block all three (amend at `prepare-commit-msg`, rebase at `pre-rebase`, non-fast-forward pushes at `pre-push`).

**Everything lands by squash-merge, and the branch dies.** One squashed commit per PR on main, its body = the PR title + description — `git blame` then always lands on a curated decision record, never `wip:` noise. Squash is what makes append-only affordable: the fixup commits it forces vanish at merge. Write the PR description as the decision record — anything decided en route lives there or in a SCOPE/register row (No-shortcuts valve, [`engineering.md`](engineering.md)), never only in branch commits. Delete the branch on merge; until the GitHub remote exists, the integration owner squashes locally (`git merge --squash <branch>`).

**Reviewer obligation (forced disclosure):** *"can this branch be deleted losing nothing — does the description carry every decision made along the way?"* No → the description is fixed before merge.

**Repo-setup checklist (integration owner, when the GitHub remote is created):** ruleset on ALL branches blocking force pushes · main takes PRs only, no direct pushes · squash-only merging with default message "PR title and description" · auto-delete head branches.

## Build sequencing (waves)

The build is **waves**, not flat parallelism — a few roots gate everything. One **integration owner** owns the integration branch (and schema), and branches merge **continuously in wave order**, not big-bang at the end.

- **Wave 0 (gates, build first):** schema (done) · auth + login/logout/403 (done) · the golden path (done) · the admin shell + nav registry (done — `admin.tsx` + `app/nav/`) · taxonomy screens (tracks/tags/formats/levels/rooms).
- **Wave 1:** form builder · submissions list/review · email templates + port.
- **Wave 2:** public CFP · speaker portal · the accept→auto-provision spine (speaker+session+tasks) — integration-owned, it couples many tables. **Build the spine as a shared domain function (`app/domain/accept.ts`) called by the route action, not inlined in it** — the Airtable sync ([`airtable-sync-design.md`](../airtable-sync-design.md)) and the compat API must trigger the exact same transition with the exact same side effects. Every status transition the spine performs emits a `track()` event ([`observability.md`](../observability.md)).
- **Wave 3:** agenda · tasks dashboard · evaluation · dashboards.
- **No shared-file chokepoints:** routes are file-based (never edit `app/routes.ts`); nav is a per-file registry; schema is central + guarded.
