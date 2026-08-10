# Portal Polish Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PR #70 by adding the merged tri-state theme control to the speaker portal chrome, re-verifying all six lane fixes, and leaving a green, fully reviewed PR unmerged.

**Architecture:** Missions 1–5 remain in their committed route/domain implementations and regression tests. Mission 6 only composes the existing `ThemeToggle` in the portal shell footer; `/theme`, the root loader, cookie persistence, and document color-scheme remain unchanged. Verification combines real-D1 route tests, full `pnpm verify`, and a live `pnpm dev:worktree` browser walk.

**Tech Stack:** React Router v7 framework mode, React 19, TypeScript strict mode, Cloudflare Workers/D1/R2, Vitest workerd pool, Tailwind v4, existing `app/ui` and `ThemeToggle` components.

## Global Constraints

- Branch history is append-only: merge main, never rebase/amend/force-push.
- Do not change `app/db/schema.ts`, migrations, `app/ui`, `app/app.css`, dependencies, or bindings.
- Routes compose existing primitives/components and make layout decisions only.
- Theme remains tri-state (`system | light | dark`), cookie-persisted through the existing `/theme` action.
- Every mutating comment control uses `useBusy()` and server-side replay safety.
- Do not run the integration-owner-only eval kit or touch remote D1/R2.
- The existing three-round `-portal-polish` judge loop is the cap; do not create a fourth round.
- Update PR #70 and resolve every AI-review thread, but DO NOT MERGE.

## File Structure

- Modify `app/routes/portals.$eventSlug.$portalId.tsx`: compose `ThemeToggle` beside the existing logged-in footer note.
- Verify existing committed behavior in `app/components/portal/task-detail-view.tsx`, `app/domain/files.ts`, `app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx`, `app/routes/admin.files.tsx`, `app/routes/admin.files_.$id.tsx`, `app/routes/admin.forms.$formId.tsx`, `app/routes/admin.events.new.tsx`, and `app/routes/admin.tasks.tsx` without unrelated refactors.
- Run existing regression tests in `test/portal.tasks.test.ts` and `test/admin.files.route.test.ts`; do not add a pass-through composition test, per `docs/rules/engineering.md`.
- Update PR #70’s body and existing disposition comment; do not add a parallel permanent design document.

---

### Task 1: Finish the portal ThemeToggle composition

**Files:**
- Modify: `app/routes/portals.$eventSlug.$portalId.tsx:8-13,80-93`
- Test: live portal shell verification; no automated test for pass-through UI wiring

**Interfaces:**
- Consumes: `ThemeToggle(): JSX.Element` from `~/components/theme-toggle`; existing root loader and `/theme` action.
- Produces: a portal-visible trigger whose label is `Theme: System`, `Theme: Light`, or `Theme: Dark` and whose popover posts the selected `theme` to `/theme`.

- [ ] **Step 1: Confirm the pre-change defect and dirty edit are scoped**

Run:
```bash
git show HEAD:'app/routes/portals.$eventSlug.$portalId.tsx' | rg 'ThemeToggle|<footer'
git diff -- 'app/routes/portals.$eventSlug.$portalId.tsx'
```
Expected: HEAD has no `ThemeToggle`; the working-tree diff only imports it, makes the footer a wrapping `justify-between` row, and renders the toggle as the footer’s second child.

- [ ] **Step 2: Keep the minimal implementation**

The final route fragment must remain:
```tsx
import { ThemeToggle } from "~/components/theme-toggle";

<footer className="flex flex-wrap items-center justify-between gap-3">
	<FooterNote>
		<span>
			You are logged in as {user.name ?? user.email} ({user.email}).
		</span>
		<span>Not you?</span>
		<Form method="post" action="/logout">
			<Button type="submit" variant="ghost">
				Log out
			</Button>
		</Form>
	</FooterNote>
	<div className="ml-auto">
		<ThemeToggle />
	</div>
</footer>
```
Do not modify `ThemeToggle`, theme persistence, root rendering, or tokens.

- [ ] **Step 3: Run focused static checks**

Run:
```bash
pnpm typecheck
pnpm exec eslint 'app/routes/portals.$eventSlug.$portalId.tsx'
git diff --check
```
Expected: all commands exit 0.

### Task 2: Re-prove the committed regression contracts

**Files:**
- Test: `test/portal.tasks.test.ts`
- Test: `test/admin.files.route.test.ts`

**Interfaces:**
- Consumes: `addFileComment`, portal/admin comment actions and loaders, task-upload persistence, files-library projection.
- Produces: observed real-D1 evidence for author names/date-times, comment replay safety, foreign-key collision handling, and upload-to-session attribution.

- [ ] **Step 1: Run the portal task regression file**

Run:
```bash
pnpm test -- test/portal.tasks.test.ts
```
Expected: PASS, including replayed-comment-one-row, fresh-key-identical-comment, garbage/foreign-key fallback, real author plus `isYou`, date+time stamps, session-task `submissionId`, and contact-task null-session assertions.

- [ ] **Step 2: Run the admin files regression file**

Run:
```bash
pnpm test -- test/admin.files.route.test.ts
```
Expected: PASS, including same-key admin reply replay and fresh-key identical reply behavior.

### Task 3: Live-verify all six user-facing fixes

**Files:**
- Verify only; modify code only if an observed failure identifies a root cause.

**Interfaces:**
- Consumes: isolated local Wrangler/D1/R2 instance from `pnpm dev:worktree`, seeded accounts from `VERIFICATION-CAPABILITIES.md`.
- Produces: screenshots/DOM/DB evidence summarized in the PR and final lane report.

- [ ] **Step 1: Launch the isolated real app**

Invoke the `run` skill, then run `pnpm dev:worktree` through its prescribed background-server workflow. Use the emitted local URL; never assume a port. Log in with seeded `admin@example.com` or `speaker@example.com` / `password` as each flow requires.

- [ ] **Step 2: Verify portal attribution and timestamps**

Open a portal file-request task with a thread. Confirm the speaker’s comment shows the real name plus `(you)`, organizer replies show the organizer name, and upload/comment stamps include both date and time in the event timezone.

- [ ] **Step 3: Verify comment replay safety**

Submit one portal comment and confirm one new row/rendered entry. Replay the identical POST with the same `commentKey` and confirm the DB/thread count does not grow; submit the same body with a fresh key and confirm it does grow. Repeat or corroborate from the admin file-detail comment form; confirm the submit control disables while busy.

- [ ] **Step 4: Verify file-to-session attribution**

Upload through a Session-type file task and open `/admin/files`; confirm the Session column shows the linked session. Upload through a Speaker/contact task and confirm `—` remains honest. Confirm the task Type selector explains `Session — one per accepted session; uploads attach to it`.

- [ ] **Step 5: Verify the empty conditional-rule value state**

In a portal form, choose a dropdown/taxonomy trigger with zero options. Confirm Value reads `No values yet`, the selector and Apply control are disabled, and the hint links to `/admin/settings/library`.

- [ ] **Step 6: Verify duplicate-slug visibility**

At `/admin/events/new`, submit an already-used slug from the bottom of the form. Confirm the slug field receives focus and is brought into view, its inline error is visible, the entered values remain, and the button row displays the form-level highlighted-field summary.

- [ ] **Step 7: Verify all three portal theme states**

In the portal footer, select System, Light, and Dark in turn. For each state confirm the trigger’s accessible label, the selected row’s `aria-current`, the `<html>` `style.colorScheme` (empty for System, `light`, `dark`), and the `/theme` cookie behavior (`or_theme`: System clears the explicit cookie; Light/Dark persist across hard reload). Also confirm the control remains reachable at a 390px viewport and its popover opens inside the viewport.

- [ ] **Step 8: Stop the local server**

Stop only the background task started for this worktree; do not kill sibling worktree servers.

### Task 4: Run the full quality gate and commit

**Files:**
- Commit: `app/routes/portals.$eventSlug.$portalId.tsx`
- Commit: `docs/superpowers/plans/2026-08-10-portal-polish-completion.md`

**Interfaces:**
- Consumes: completed working tree and all repo checks.
- Produces: one append-only commit extending PR #70.

- [ ] **Step 1: Run the required full gate**

Run:
```bash
pnpm verify
```
Expected: map check, typecheck/typegen, ESLint, CSS lint, and the full real-D1 workerd test suite all pass.

- [ ] **Step 2: Inspect the exact final diff**

Run:
```bash
git status --short
git diff --check
git diff -- 'app/routes/portals.$eventSlug.$portalId.tsx'
```
Expected: only the intended route edit and this implementation plan are uncommitted; no generated, schema, migration, dependency, UI-primitive, or unrelated files changed.

- [ ] **Step 3: Commit append-only**

Run:
```bash
git add 'app/routes/portals.$eventSlug.$portalId.tsx' \
  docs/superpowers/plans/2026-08-10-portal-polish-completion.md
git commit -m "feat(portal): add tri-state theme control

Co-Authored-By: Claude <noreply@anthropic.com>"
```
Expected: pre-commit hooks pass and a new commit is added without amend/rebase.

### Task 5: Review, update PR #70, and clear CI feedback

**Files:**
- External: PR #70 body, judge-loop disposition comment, AI-review threads.

**Interfaces:**
- Consumes: committed branch, existing three-round `-portal-polish` disposition log, PR #70.
- Produces: pushed branch, complete decision record, green checks, zero unresolved inline threads, unmerged PR.

- [ ] **Step 1: Run the required pre-PR review skill**

Invoke `superpowers:requesting-code-review` against the final branch diff. If feedback arrives, invoke `superpowers:receiving-code-review` before deciding whether to adopt it. Any adopted change gets its own append-only commit after focused and full verification.

- [ ] **Step 2: Preserve the judge-loop cap and disposition record**

Invoke the `judge-loop` skill only to inspect/report the existing `-portal-polish` run state and disposition log. Do not run round 4: PR #70 already records three completed rounds, the stated cap.

- [ ] **Step 3: Push the branch**

Run:
```bash
git push origin fix/portal-polish
```
Expected: fast-forward push succeeds; no force push.

- [ ] **Step 4: Extend the PR decision record**

Update PR #70’s body with a sixth section stating: the portal now composes the existing `ThemeToggle` in its footer; no theme logic, token, schema, or persistence path changed; System/Light/Dark were live-verified in portal chrome. Update verification counts/evidence without deleting the existing five-fix decisions or three-round disposition history.

- [ ] **Step 5: Wait for CI and inspect every thread**

Run:
```bash
gh pr checks 70 --watch --interval 30
```
Then query all review threads through `gh api graphql`; for every unresolved AI thread, verify the claim against code/rules, reply with the adoption or dismissal rationale, resolve it, and re-run CI if code changes. Expected final state: all required checks successful and every inline thread resolved.

- [ ] **Step 6: Confirm the no-merge boundary**

Run:
```bash
gh pr view 70 --json number,state,mergeStateStatus,statusCheckRollup,url
```
Expected: PR #70 remains OPEN; do not call any merge command.

### Task 6: Print the complete lane report

**Files:**
- None.

**Interfaces:**
- Consumes: observed live evidence, test output, CI result, PR metadata, disposition log.
- Produces: the user-facing final message.

- [ ] **Step 1: Report outcomes, not intentions**

The final message must start with the outcome and include: PR number/link, OPEN/not-merged state, CI state, `pnpm verify` observed result, one evidence bullet per fix (all six), no-schema-change confirmation, judge-loop round/disposition summary, and inline AI-thread dispositions. If any oracle was not exercised or any check is not green, state that blocker explicitly instead of claiming completion.
