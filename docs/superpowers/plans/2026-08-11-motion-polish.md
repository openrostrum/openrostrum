# Motion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make occasional state changes feel physically coherent while preserving instant outcomes in OpenRostrum’s all-day workflows.

**Architecture:** Motion timing and curves live in `app/app.css`; `app/ui/motion.tsx` owns entry treatments for dialogs, anchored popovers, and inline reveals. Existing components and the few hand-rolled route/feature surfaces compose those primitives, while frequent content swaps and direct manipulation remain deliberately static.

**Tech Stack:** React 19, React Router 7, Tailwind CSS v4, TypeScript, CSS transitions/`@starting-style`, Vitest/workerd, local Wrangler dev.

## Global Constraints

- Add no dependencies.
- Motion must never delay mutation completion, content availability, dismissal, or input response.
- Every added transition must include a `prefers-reduced-motion` fallback.
- Visual decisions belong to `app/ui`, `app/components`, and `app/app.css`; callers change composition only.
- Keep frequent tabs, search, filters, table selection, validation, conditional fields, rich-text marks, and drag geometry immediate.
- The skeleton pulse remains unchanged.
- Do not add tautological class-string tests; verify visual motion in the running app and preserve existing functional tests.

---

### Task 1: Motion tokens and shared surfaces

**Files:**
- Modify: `app/app.css:39-83`
- Create: `app/ui/motion.tsx`
- Modify: `app/ui/modal.tsx`
- Modify: `app/ui/index.ts`

**Interfaces:**
- Produces `MotionReveal({ children, kind?: "panel" | "feedback" })`.
- Produces `PopoverSurface({ children, side: "top" | "bottom", align?: "start" | "end" | "stretch", width?: "sm" | "md" | "trigger" })`.
- Produces `DialogSurface({ children, role?: "dialog" | "alertdialog", size?: "sm" | "md" | "lg", ariaLabel?: string, labelledBy?: string, describedBy?: string, panelRef?: Ref<HTMLDivElement> })`.
- `Modal` continues to expose its existing props and composes `DialogSurface`.

- [ ] **Step 1: Add semantic motion tokens**

Add the following values inside `@theme`:

```css
--motion-duration-feedback: 120ms;
--motion-duration-enter: 180ms;
--ease-gallery-responsive: cubic-bezier(0.2, 0, 0, 1);
--ease-gallery-settle: cubic-bezier(0.16, 1, 0.3, 1);
```

- [ ] **Step 2: Create `app/ui/motion.tsx`**

Implement the three interfaces above with no `className` or `style` props. Use only opacity and transform for entry. Popovers use a small `translate-y` and `scale-[0.98]` with top/bottom transform origins; dialogs use backdrop opacity plus centered panel `scale-[0.97]`. `MotionReveal` uses a 2px vertical offset. Each treatment uses token-backed arbitrary transition properties, `starting:` styles, `motion-reduce:transition-none`, and reduced-motion starting overrides.

- [ ] **Step 3: Rebuild `Modal` on `DialogSurface`**

Keep title, subtitle, children, actions, and callback behavior unchanged. Do not add delayed unmounting. The dialog exists and is interactive immediately; close remains instant.

- [ ] **Step 4: Export the new primitives**

Add `DialogSurface`, `MotionReveal`, and `PopoverSurface` exports to `app/ui/index.ts`.

- [ ] **Step 5: Verify generated CSS and types**

Run:

```bash
pnpm typecheck
pnpm lint:css
pnpm build
```

Expected: all pass; the build output contains starting-style rules and reduced-motion overrides for each new primitive.

- [ ] **Step 6: Commit**

```bash
git add app/app.css app/ui/motion.tsx app/ui/modal.tsx app/ui/index.ts
git commit -m "feat(ui): add motion tokens and surfaces" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Tokenize existing parallel feedback

**Files:**
- Modify: `app/ui/button.tsx`
- Modify: `app/ui/table.tsx`
- Modify: `app/ui/tabs.tsx`
- Modify: `app/ui/shell.tsx`
- Modify: `app/components/event-switcher.tsx`
- Modify: `app/components/theme-toggle.tsx`

**Interfaces:**
- Consumes motion tokens and `PopoverSurface` from Task 1.
- Produces no new public API.

- [ ] **Step 1: Replace scattered duration/easing utilities**

Change shared hover, press, and selected-state transitions from numeric `duration-150`/plain `ease-out` to `var(--motion-duration-feedback)` and `var(--ease-gallery-responsive)`. Preserve each current transition property list.

- [ ] **Step 2: Complete reduced-motion coverage**

Add `motion-reduce:transition-none` wherever a shared primitive or shared component now transitions. Keep button press `motion-reduce:active:scale-100`.

- [ ] **Step 3: Move both switcher menus to `PopoverSurface`**

Use `side="bottom" align="stretch" width="trigger"` for the event switcher and `side="top" align="end" width="sm"` for the theme menu. Keep form submissions, dismissal, and optimistic theme switching unchanged.

- [ ] **Step 4: Verify shared surfaces**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass with no route motion utilities and no changed component APIs.

- [ ] **Step 5: Commit**

```bash
git add app/ui/button.tsx app/ui/table.tsx app/ui/tabs.tsx app/ui/shell.tsx app/components/event-switcher.tsx app/components/theme-toggle.tsx
git commit -m "feat(ui): unify interaction feedback motion" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Add non-blocking reveal feedback

**Files:**
- Modify: `app/ui/confirm-button.tsx`
- Modify: `app/ui/rich-text.tsx`
- Modify: `app/components/copy-button.tsx`
- Modify: `app/components/add-to-calendar.tsx`
- Modify: `app/lib/submission-list.tsx`

**Interfaces:**
- Consumes `MotionReveal` from Task 1.
- Produces no new public API.

- [ ] **Step 1: Wrap occasional inline reveals**

Use `kind="panel"` for the shared confirmation prompt, rich-text link controls, and add-submission panel. The controls must be mounted and usable immediately; do not animate height or delay closing.

- [ ] **Step 2: Wrap acknowledgements**

Use keyed `kind="feedback"` reveals for copy success/failure and calendar-download acknowledgement. The clipboard/download operation must remain independent from the reveal.

- [ ] **Step 3: Preserve deliberately static state**

Do not add motion to file-name replacement, character counters, toolbar active marks, portal task tabs, search result swaps, or row selection.

- [ ] **Step 4: Verify behavior and types**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: the existing suite passes; no new class-string tests are added.

- [ ] **Step 5: Commit**

```bash
git add app/ui/confirm-button.tsx app/ui/rich-text.tsx app/components/copy-button.tsx app/components/add-to-calendar.tsx app/lib/submission-list.tsx
git commit -m "feat(ui): soften inline reveals and feedback" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: Promote hand-rolled floating surfaces

**Files:**
- Modify: `app/routes/admin.forms.tsx`
- Modify: `app/cfp/ui.tsx`
- Modify: `app/agenda/board.tsx`

**Interfaces:**
- Consumes `DialogSurface` and `PopoverSurface` from Task 1.
- Preserves existing route/feature function signatures and focus-management effects.

- [ ] **Step 1: Promote the form actions menu**

Replace its route-owned absolute panel skin with `PopoverSurface side="bottom" align="end" width="md"`. Keep only flex/gap layout in the route.

- [ ] **Step 2: Promote the delete-form dialog**

Replace the fixed overlay/panel classes with `DialogSurface role="alertdialog" size="sm" ariaLabel={...}`. Preserve Escape handling, cancel, idempotent delete form, and busy disabling.

- [ ] **Step 3: Promote the CFP confirm dialog**

Use `DialogSurface role="alertdialog" size="sm" ariaLabel={title}` while retaining the existing Escape listener and confirm node.

- [ ] **Step 4: Promote the agenda publish dialog**

Use `DialogSurface role="alertdialog" size="md" labelledBy="publish-agenda-title" describedBy="publish-agenda-description" panelRef={dialogRef}`. Preserve focus trapping, focus return, conflict preview, and publish semantics.

- [ ] **Step 5: Verify focused behavior**

Run the existing route/agenda tests that mention forms, CFP, or publish dialog, then run:

```bash
pnpm typecheck
pnpm lint
```

Expected: all pass; route motion/style lint stays green.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin.forms.tsx app/cfp/ui.tsx app/agenda/board.tsx
git commit -m "refactor(ui): centralize floating surface motion" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: Remove consciously watched first-paint motion and finish the audit

**Files:**
- Modify: `app/marketing/landing.tsx`
- Create: `docs/motion-audit.md`

**Interfaces:**
- Produces the canonical audit table later copied verbatim into the PR body.

- [ ] **Step 1: Remove the 500ms hero entrance**

Delete the landing hero’s starting translate/opacity and 500ms transition classes. The headline must be readable on first paint.

- [ ] **Step 2: Write the exhaustive audit table**

Create `docs/motion-audit.md` with one row per surface family and every concrete implementation/consumer found. Columns: surface, files, trigger/state mechanism, gating analysis, decision, duration/easing, reduced-motion behavior. Include all changed surfaces plus deliberately static categories from the design spec and concrete route groups discovered in the sweep.

- [ ] **Step 3: Re-run app-wide searches**

Run:

```bash
rg -n 'transition-|duration-|ease-|animate-' app --glob '*.tsx'
rg -n 'fixed inset|aria-modal|role="(dialog|alertdialog)"|<details|aria-expanded=|aria-pressed=' app --glob '*.tsx'
rg -n 'useState|useReducer' app --glob '*.tsx'
```

Reconcile every result into the audit table or explain why it is not a visual state surface. No uncovered overlay or ad-hoc long transition may remain.

- [ ] **Step 4: Commit**

```bash
git add app/marketing/landing.tsx docs/motion-audit.md
git commit -m "docs(ui): record complete motion audit" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 6: Full and live verification

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: Run the full verifier**

```bash
ALLOW_SCHEMA_CHANGE=1 pnpm verify
```

Expected: map, typecheck, ESLint, stylelint, and all Vitest tests pass.

- [ ] **Step 2: Start the isolated app**

```bash
pnpm db:reset
pnpm dev:worktree
```

Record the printed local URL and keep the process running.

- [ ] **Step 3: Exercise light-theme motion**

Log in as `admin@example.com` / `password`. Open/close the decision-preview modal, form-delete dialog, agenda-publish dialog, event switcher, theme menu, and form actions menu. Trigger add-submission, rich-text link controls, inline confirmation, copy acknowledgement, and calendar/download feedback where reachable. Verify content is immediately interactive and dismissal is immediate.

- [ ] **Step 4: Exercise dark-theme motion**

Switch to Dark and repeat modal, popover, and feedback checks. Confirm no incorrect transform origin, flash, lost contrast, or first-paint delay.

- [ ] **Step 5: Exercise reduced motion**

Emulate `prefers-reduced-motion: reduce`, reload, and repeat the same checks. Confirm each surface appears in its final position/opacity immediately and existing skeleton pulse is disabled.

- [ ] **Step 6: Exercise deliberately static flows**

Switch tabs, search/filter tables, toggle conditional form questions, trigger validation, select rows, and drag/move an agenda session. Confirm each outcome remains immediate and no new transition gates the result.

- [ ] **Step 7: Record evidence**

Add exact commands, URL, browser theme, reduced-motion emulation, exercised surfaces, and observed outcomes to `docs/motion-audit.md`. Re-run `ALLOW_SCHEMA_CHANGE=1 pnpm verify` if any file changed.

### Task 7: Review, synchronize, and open the PR

**Files:**
- Modify only for verified review findings and final audit evidence.

- [ ] **Step 1: Run the judge loop**

Invoke `/judge-loop` for one round with suffix `-H8`. Fix every accepted finding; record an evidence-backed discard reason for every rejected finding.

- [ ] **Step 2: Commit review fixes**

Use append-only fix commits; never amend or rebase. End every commit body with the required co-author line.

- [ ] **Step 3: Synchronize with main**

```bash
git fetch origin
git merge origin/main
```

If the merge adds changes, run `ALLOW_SCHEMA_CHANGE=1 pnpm verify` again. Never rebase.

- [ ] **Step 4: Push and create the PR**

Push `feat/motion-polish` and create PR title:

```text
feat(ui): motion polish — subconsciously smooth overlays and state changes
```

The PR body must include the full `docs/motion-audit.md` table, tokens added, changed vs deliberately-static counts, verification evidence, judge-loop dispositions, and the statement that the branch is not merged.

- [ ] **Step 5: Resolve inline AI review threads**

Inspect all inline AI-review threads. Fix accepted findings with append-only commits; reply with written technical reasons for discarded findings. Re-run relevant tests and `ALLOW_SCHEMA_CHANGE=1 pnpm verify`, push, and leave the PR unmerged.
