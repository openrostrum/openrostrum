# Speaker CRM Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit the completed organization-level Speaker CRM lane as a verified, review-converged pull request without merging it.

**Architecture:** Preserve the existing append-only feature history, merge the latest `origin/main`, and retain one linear Drizzle migration sequence where upstream AI reviews are `0007` and Speaker CRM is `0008`. Verify CRM behavior against real workerd/D1 tests and a locally running Worker, then run one final cold three-judge review and use the PR as the durable decision record.

**Tech Stack:** React Router v7, TypeScript strict mode, Drizzle ORM on Cloudflare D1, Cloudflare Workers/workerd, Vitest workers pool, pnpm, GitHub CLI.

## Global Constraints

- Work only in `/Users/thytu/Prog/kill-my-saas/.claude/worktrees/speaker-crm` on `feat/speaker-crm`.
- Branch history is append-only: never amend, rebase, force-push, or reset away committed work.
- Merge `origin/main`; never rebase onto it.
- Upstream `0007_third_psynapse` remains migration index 7; Speaker CRM remains `0008_speaker_crm` at index 8.
- `ALLOW_SCHEMA_CHANGE=1` was granted for migration `0008` and the corresponding `app/db/schema.ts` additions.
- `pnpm db:generate` is integration-owner-only and must not run here.
- Every loader/action self-authenticates and all CRM reads/writes remain organization-scoped.
- Tenancy evidence must prove organization A never sees organization B people.
- Run exactly one fresh full judge round with three cold judges and suffix `-crm-final`.
- Resolve every inline AI-review thread; do not merge the PR.
- `guard-shared-files` may fail by design because this sanctioned branch touches schema/migration files; disclose that state to the owner.

---

## File Structure

- `app/db/schema.ts`: shared schema containing sanctioned CRM tables and relations; merge with upstream `ai_reviews` additions without dropping either feature.
- `drizzle/migrations/0007_third_psynapse.sql`: upstream AI-review migration; must remain before CRM.
- `drizzle/migrations/0008_speaker_crm.sql`: sanctioned CRM migration.
- `drizzle/migrations/meta/0007_snapshot.json`: upstream snapshot.
- `drizzle/migrations/meta/0008_snapshot.json`: combined post-CRM snapshot.
- `drizzle/migrations/meta/_journal.json`: ordered Drizzle journal with unique indices/tags 0 through 8.
- `wrangler.json`: preserve upstream Workers AI binding and current branch configuration.
- `app/lib/use-busy.ts`: preserve upstream shared mutation-busy guard used by CRM forms.
- `app/root.tsx` and theme-related upstream files: accept the latest theme-toggle implementation from `origin/main`.
- `app/domain/crm.ts`: organization-scoped union, analytics, duplicate detection, add-to-event, segments, pipeline persistence.
- `app/routes/admin.crm*.tsx`: CRM overview, directory, profiles, segments, pipeline, and card-detail surfaces.
- `test/crm*.test.ts`: D1-backed behavior and tenancy contracts.
- `docs/superpowers/plans/2026-08-10-speaker-crm-finalization.md`: this execution record.
- Pull request body and review disposition log: GitHub-hosted decision record; no branch merge.

---

### Task 1: Merge Main and Preserve Migration Order

**Files:**
- Modify on conflict only: `app/db/schema.ts`
- Modify on conflict only: `drizzle/migrations/meta/_journal.json`
- Modify on conflict only: `drizzle/migrations/meta/0008_snapshot.json`
- Preserve: `drizzle/migrations/0007_third_psynapse.sql`
- Preserve: `drizzle/migrations/0008_speaker_crm.sql`
- Merge upstream: `wrangler.json`
- Merge upstream: theme files introduced by `origin/main`

**Interfaces:**
- Consumes: `origin/main` and committed `feat/speaker-crm` history.
- Produces: merge commit whose tree contains both AI review and Speaker CRM schema/configuration.

- [ ] **Step 1: Reconfirm a clean branch and remote divergence**

Run:
```bash
git fetch origin
git status --short --branch
git log --oneline HEAD..origin/main
```
Expected: clean `feat/speaker-crm`; only commits not yet merged from `origin/main` are listed.

- [ ] **Step 2: Merge main append-only**

Run:
```bash
git merge --no-edit origin/main
```
Expected: a merge commit or conflict state; never a rebase.

- [ ] **Step 3: Resolve migration metadata if Git reports conflicts**

The final `_journal.json` tail must be exactly ordered as:
```json
{
  "idx": 7,
  "version": "6",
  "tag": "0007_third_psynapse",
  "breakpoints": true
},
{
  "idx": 8,
  "version": "6",
  "tag": "0008_speaker_crm",
  "breakpoints": true
}
```
Keep each entry's existing `when` value. The final `0008_snapshot.json` must include both `ai_reviews` and CRM tables (`crm_pipeline_cards`, `crm_stage_history`, `person_notes`, `crm_segments`). Resolve `schema.ts` additively so none of those tables disappear.

- [ ] **Step 4: Verify migration and binding invariants**

Run:
```bash
node -e 'const j=require("./drizzle/migrations/meta/_journal.json"); const t=j.entries.slice(-2).map(({idx,tag})=>({idx,tag})); console.log(t); if (JSON.stringify(t)!==JSON.stringify([{idx:7,tag:"0007_third_psynapse"},{idx:8,tag:"0008_speaker_crm"}])) process.exit(1)'
rg -n 'ai_reviews|crm_pipeline_cards|crm_stage_history|person_notes|crm_segments' app/db/schema.ts drizzle/migrations/meta/0008_snapshot.json
rg -n 'binding.*AI|"ai"' wrangler.json
```
Expected: ordered 0007/0008 output; every upstream/CRM table is found; the Workers AI binding is present.

- [ ] **Step 5: Commit any manual conflict resolution**

If the merge did not auto-commit, run:
```bash
git add app/db/schema.ts drizzle/migrations drizzle/migrations/meta wrangler.json
git commit
```
Expected: one merge commit; hooks run with the already granted schema sanction if the conflict resolution requires a separate non-merge commit.

---

### Task 2: Regenerate Types and Verify Product Behavior

**Files:**
- Generated: `.react-router/types/**`
- Test: `test/crm.directory.route.test.ts`
- Test: `test/crm.overview.route.test.ts`
- Test: `test/crm.person.route.test.ts`
- Test: `test/crm.pipeline.route.test.ts`
- Test: `test/crm.segments.route.test.ts`

**Interfaces:**
- Consumes: merged route/config/schema tree.
- Produces: generated route/binding types, passing full verification, and observed local app evidence.

- [ ] **Step 1: Regenerate bindings and route types**

Run:
```bash
pnpm typegen
```
Expected: exit 0; generated types reflect the merged Workers AI binding and CRM routes.

- [ ] **Step 2: Run focused CRM contracts**

Run:
```bash
pnpm vitest run test/crm.directory.route.test.ts test/crm.overview.route.test.ts test/crm.person.route.test.ts test/crm.pipeline.route.test.ts test/crm.segments.route.test.ts
```
Expected: all CRM test files pass, including these independent tenancy oracles:
- `unions appearances into one person per email and never crosses the org boundary`
- `refuses pushing a person into another organization's event`
- `404s for a person who exists only in another organization`
- `never lets another org see or move a card`
- `lists only the org's segments`
- `shows org2 its own numbers, untouched by org1's pipeline`

- [ ] **Step 3: Run the repository gate**

Run:
```bash
pnpm verify
```
Expected: typecheck, ESLint, map checks, and the entire Vitest suite exit 0.

- [ ] **Step 4: Reset and launch the real local Worker**

Run:
```bash
pnpm db:reset
pnpm dev:worktree
```
Expected: migrations 0000–0008 apply in order and Wrangler reports the local URL without startup errors.

- [ ] **Step 5: Exercise the CRM through HTTP/browser state**

Using the seeded admin session, visit `/admin/crm`, `/admin/crm/directory`, `/admin/crm/pipeline`, and `/admin/crm/segments`. Confirm the overview renders populated KPIs/widgets, directory search narrows results, a person profile renders persisted notes/connections, pipeline stages/cards render with detail history, and saved segments reopen with members. Record the URL/HTTP or browser evidence; stop the server afterward.

- [ ] **Step 6: Commit generated or verification-driven changes only if present**

Run:
```bash
git status --short
```
If tracked generated output changed, stage only those intended files and commit append-only with:
```bash
git add <changed-generated-or-fix-files>
git commit -m "chore(crm): reconcile generated types after main merge"
```
Expected: no unrelated files staged.

---

### Task 3: Run the Final Three-Judge Round

**Files:**
- Review target: complete `origin/main...HEAD` diff.
- Create/update per judge-loop convention: disposition log with suffix `-crm-final`.
- Modify only when a verified judge finding requires a fix: relevant CRM source/test files.

**Interfaces:**
- Consumes: fully verified final diff.
- Produces: three independent cold verdicts, one disposition per finding, and a reverified final tree.

- [ ] **Step 1: Invoke the required judge workflow**

Invoke `judge-loop` with arguments that require one full round, three cold judges, the complete final diff, suffix `-crm-final`, and a disposition log.

- [ ] **Step 2: Verify each finding before changing code**

For every finding, reproduce the claimed behavior against code/tests/local D1. Classify it as `adopted`, `already satisfied`, or `rejected`, with concrete evidence and no performative agreement.

- [ ] **Step 3: Fix every adopted finding with a regression oracle**

For each real defect, first add or identify the focused test that fails on the defect, then implement the smallest production fix, and rerun the focused test. Commit fixes append-only using a `fix(crm): ...` or `refactor(crm): ...` message.

- [ ] **Step 4: Re-run final verification**

Run:
```bash
pnpm typegen
pnpm verify
```
Expected: exit 0 after all dispositions; the disposition log names all three judges and every finding outcome.

---

### Task 4: Push, Open the PR, and Clear Inline AI Review

**Files:**
- GitHub PR body: durable decision record.
- GitHub review threads: all inline AI-review threads resolved.

**Interfaces:**
- Consumes: verified branch plus judge disposition log.
- Produces: one open PR from `feat/speaker-crm` to `main`, pushed append-only and not merged.

- [ ] **Step 1: Push the append-only branch**

Run:
```bash
git push origin feat/speaker-crm
```
Expected: fast-forward push succeeds; no force flags.

- [ ] **Step 2: Build the PR decision record**

The body must state:
- problem/outcome: organization-level cross-event speaker CRM;
- architecture: union over per-event contacts, add-to-event profile copy, persisted kanban stages/history, dynamic saved segments, scoped near-duplicate surfacing, org-wide dashboard;
- migration decision: `ALLOW_SCHEMA_CHANGE=1 was granted for migration 0008 + schema.ts additions`;
- verification evidence with exact command/test counts and local Worker observations;
- judge dispositions with adopted/rejected/already-satisfied outcomes;
- owner note: `guard-shared-files may be red by design because this sanctioned lane changes app/db/schema.ts and drizzle/migrations`;
- explicit `DO NOT MERGE` handoff;
- deletion test: all non-obvious decisions from the branch are preserved in the body.

Coverage map rows must be explicit:
- `CRM-01` — shipped: org-level cross-event searchable directory.
- `CRM-04` — shipped: persistent organizer-defined metadata via tags.
- `CRM-06` — shipped: org-scoped same-name/different-email duplicate surfacing; consciously cut merge because SCOPE explicitly leaves contact merge tooling OUT.
- `CRM-07` — shipped: staged sourcing kanban, enrollment, persistent moves.
- `CRM-08` — shipped: pipeline notes plus timestamped stage history.
- `CRM-09` — shipped: reusable dynamic saved segments with live member counts.
- `CRM-10` — shipped: add-to-event handoff with profile carry-over and org guard.
- `CRM-12` — shipped: org-wide KPIs and populated company/event analytics.
Also name omitted rubric items honestly: `CRM-02/03` may be supporting depth if present; `CRM-05` CSV import and `CRM-11` bulk outreach are consciously not part of this lane unless the final diff proves otherwise.

- [ ] **Step 3: Create the PR**

Run:
```bash
gh pr create --base main --head feat/speaker-crm --title "feat(crm): add organization-level speaker CRM" --body-file <decision-record-file>
```
Expected: one PR URL/number; if a PR already exists, update it with `gh pr edit` instead of creating a duplicate.

- [ ] **Step 4: Discover inline AI-review threads**

Use `gh api graphql` to query `repository.pullRequest.reviewThreads` with each thread's ID, path, line, resolution state, comments, and author. Review every unresolved thread against the current tree.

- [ ] **Step 5: Resolve every thread truthfully**

Apply and push fixes for valid unresolved comments, reply with evidence where needed, then call the `resolveReviewThread` GraphQL mutation for each thread that is actually addressed or obsolete. Re-query until unresolved thread count is zero.

---

### Task 5: Monitor CI and Print the Lane Report

**Files:**
- No repository changes unless CI exposes a real defect.

**Interfaces:**
- Consumes: open PR and GitHub checks.
- Produces: terminal CI state and complete owner handoff; leaves PR unmerged.

- [ ] **Step 1: Monitor all PR checks to terminal state**

Run:
```bash
gh pr checks <PR_NUMBER> --watch
```
Expected: every check reaches pass/fail/cancelled/skipped; no check remains pending. A sanctioned `guard-shared-files` failure is reported, not disguised.

- [ ] **Step 2: Fix genuine CI failures append-only**

For any real failure, inspect logs with `gh run view --log-failed`, reproduce locally, add a regression oracle, commit, push, and monitor the new run. Do not attempt to bypass or suppress checks.

- [ ] **Step 3: Re-query final GitHub state**

Run:
```bash
gh pr view <PR_NUMBER> --json number,url,state,mergeStateStatus,reviewDecision,statusCheckRollup
gh api graphql <review-thread-query>
```
Expected: PR remains open and unmerged; exact CI state and zero unresolved inline AI-review threads are observable.

- [ ] **Step 4: Print the complete lane report**

First sentence states the user outcome. Then report, compactly:
1. PR number/link and explicit `OPEN — DO NOT MERGE` state.
2. CI checks, including the expected/shared-file guard exception if red.
3. CRM-01/04/06/07/08/09/10/12 shipped-vs-cut map.
4. `pnpm typegen`, focused CRM, `pnpm verify`, local Worker, and tenancy evidence.
5. Three-judge `-crm-final` dispositions.
6. Inline AI-review thread resolution count and any owner-only blocker.

---

## Self-Review

- Spec coverage: all four requested workstreams are mapped to Tasks 1–5; the no-merge constraint appears globally and in PR/CI steps.
- Placeholder scan: command metavariables are runtime values (`<PR_NUMBER>`, decision-record path, review-thread query), not missing product decisions; every required behavior and expected result is concrete.
- Type consistency: migration tags match existing filenames; CRM route/test names match the current branch; coverage IDs match the vendored `07-speaker-crm.yaml` rubric.
