# OpenRostrum — agent map

**OpenRostrum** — the open-source Sessionboard alternative (conference speaker/session/program management), built for swyx's Kill My SaaS 1 hackathon by parallel coding agents in git worktrees with functional self-verification.

## 🎯 THE LENS
You are building the **actual Sessionboard replacement** — production software a real event team runs their conference on, free and open source. NOT a hackathon demo: assume real scale (hundreds of contacts/submissions — search, pagination, nothing hardcoded to the demo event), handle the unhappy paths (empty states, validation, permission failures, double-submits), and never justify a cut with "the demo won't show it" — cuts come only from SCOPE's tiers. Reviewers hold builds to THIS bar.

## 🗺️ THIS FILE IS A MAP — keep it one
One row per topic below, pointing to where the depth lives; an agent reads only what its task requires. **Never add rule prose, checklists, or explanations here.** A new code convention goes in `docs/rules/engineering.md`, a new workflow rule in `docs/rules/process.md`, everything else in its mapped doc — then add/update ONE map row if a new topic exists. `scripts/check-map.sh` (in `pnpm verify`) fails if this file exceeds 60 lines or maps a path that doesn't exist.

## The map

| Topic | Read when | Where |
|---|---|---|
| What to build — tiers, north star, OUT table | starting any feature | `SCOPE.md` |
| Definition of done — scenarios + binding decisions (GAP-REGISTER) | before AND after building | `docs/scenarios/` |
| Judges' rubric → owning feature | your feature owns rubric IDs | `docs/eval-crosswalk.md` |
| Platform rules (mandatory: D1, imports, R2, email, routing) | writing any code | `docs/rules/tech-stack.md` |
| House conventions — golden path, design system, auth, current-event, comments, tests | writing any code or tests | `docs/rules/engineering.md` |
| Process — migrations, worktrees, git workflow, design-time gate, build waves | schema/deps/git/sequencing questions | `docs/rules/process.md` |
| Route/file ownership | adding a route | `docs/ROUTE-MAP.md` |
| Screens → reference screenshots | building UI | `docs/BUILD-SCREENS.md` |
| Per-module behavior ("what happens when") | building a module | `docs/flows/` |
| Design system — tokens, primitives, states, the petrol law | building any UI | `docs/rules/design-system.md` |
| Judging-harness & cross-cutting — native-confirm ban, route aliases, empty states, suppression | building judged UI/flows | `docs/rules/harness.md` |
| Data model — verified Sessionboard objects/fields/statuses (parity mandate) | modeling data, schema, Airtable | `docs/data-model.md` |
| Runtime truth — events, timings, log queries | debugging runtime behavior | `docs/observability.md` |
| Verification oracles — how to self-verify each surface | before verifying any feature | `VERIFICATION-CAPABILITIES.md` |
| Airtable sync design | sync work | `docs/airtable-sync-design.md` |
| Grader-facing deploy notes | deploy time | `docs/JUDGING.md` |

## Commands

| Task | Command |
|------|---------|
| Dev server (this worktree, unique port) | `pnpm dev:worktree` |
| Regenerate binding/route types | `pnpm typegen` |
| Apply migrations to local D1 | `pnpm db:migrate` |
| Reset local DB (wipe → migrate → seed) | `pnpm db:reset` |
| Tests (in workerd, real D1) | `pnpm test` |
| **Full check before you commit** | `pnpm verify` |

> `pnpm db:generate` is **integration-owner only** — feature worktrees never run it (see `docs/rules/process.md`).
