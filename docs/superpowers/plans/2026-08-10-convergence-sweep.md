# Convergence Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate every non-agenda mutation guard, clipboard control, and duplicated form path constructor without changing normal layout, copy, route targets, or server semantics.

**Architecture:** `useBusy()` remains the only global mutation lock and is adopted at component boundaries; local request state remains only for operation-specific labels/results. `CopyButton` becomes a behavior-configurable shared component so all existing copy surfaces retain their labels, timing, icon, and fallback behavior. `app/domain/forms.ts` becomes the single framework-neutral owner for public and admin form paths.

**Tech Stack:** React 19, React Router 7 framework mode, strict TypeScript, shared `app/ui` primitives, Vitest in workerd, ESLint, Biome.

## Global Constraints

- No CSS, route, action, schema, dependency, idempotency, or ordinary visible-copy changes.
- Every non-agenda mutating control combines `useBusy()` with existing domain/eligibility locks.
- The agenda board keeps its operation-local optimistic queue and fetcher guards.
- Local fetcher/navigation state may remain only for operation-specific labels, optimistic rendering, or result handling.
- The clipboard consolidation must preserve each surface's current labels, reset duration, icon, optimistic/awaited success, and manual fallback.
- `submitPath(eventSlug, formPublicId)` remains the published CFP path contract.
- Branch history is append-only: commit fixes forward; never amend, rebase, or force-push.
- Run the judge loop with artifact suffix `-laneQ`, fresh judges, and at most three rounds.
- Immediately before the final push, merge `origin/main`, re-sweep all three classes, and record the exact swept main commit in the PR body.

---

## File Structure

### Shared contracts

- `app/lib/use-busy.ts` — unchanged global in-flight predicate.
- `app/components/copy-button.tsx` — sole clipboard implementation and configurable behavior contract.
- `app/ui/confirm-button.tsx` — visual two-step confirmation; accepts `disabled` from application callers.
- `app/domain/forms.ts` — sole public CFP and admin form path constructors.

### Clipboard callers

- `app/components/getting-started.tsx`
- `app/routes/admin.forms.$formId.tsx`
- `app/routes/admin.settings.team.tsx`
- `app/routes/admin.reviewers.tsx`
- `app/routes/admin.contacts_.$id.tsx`
- `app/routes/admin.embeds.tsx`
- `app/routes/admin.embeds_.$id.tsx`
- `app/widgets/bits.tsx`
- `app/widgets/index.ts`

### Form-path callers

- `app/cfp/wizard.ts`
- `app/routes/cfp.tsx`
- `app/routes/admin._index.tsx`
- `app/routes/admin.forms.tsx`
- `app/routes/admin.forms.$formId.tsx`
- `app/routes/submit.$eventSlug.$formId.tsx`
- `app/routes/submit.$eventSlug.$formId._index.tsx`
- `app/routes/submit.$eventSlug.$formId.step.account.tsx`
- `app/routes/submit.$eventSlug.$formId.step.session.tsx`
- `app/routes/submit.$eventSlug.$formId.step.participant.tsx`
- `app/routes/submit.$eventSlug.$formId.step.review.tsx`
- `app/routes/submit.$eventSlug.$formId.step.success.tsx`

### Busy-guard callers

- Shared/auth/public: `app/ui/shell.tsx`, `app/components/event-switcher.tsx`, `app/components/getting-started.tsx`, `app/components/theme-toggle.tsx`, `app/routes/login.tsx`, `app/routes/signup.tsx`, `app/routes/forgot-password.tsx`, `app/routes/onboarding.tsx`, `app/routes/set-password.$token.tsx`, `app/routes/unsubscribe.$token.tsx`, `app/routes/portals.$eventSlug.$portalId.tsx`.
- Submissions/forms/settings/email: `app/lib/submission-list.tsx`, `app/routes/admin.submissions.tsx`, `app/routes/admin.submissions_.$id.tsx`, `app/routes/admin.forms.tsx`, `app/routes/admin.forms.$formId.tsx`, `app/routes/admin.emails.tsx`, `app/routes/admin.emails_.$key.tsx`, `app/routes/admin.events.new.tsx`, `app/routes/admin.settings._index.tsx`, `app/routes/admin.settings.airtable.tsx`, `app/routes/admin.settings.library.tsx`, `app/routes/admin.settings.team.tsx`.
- Evaluation/tasks/content: `app/routes/admin.evaluation.tsx`, `app/routes/admin.evaluation.$planId.tsx`, `app/routes/admin.tasks.tsx`, `app/routes/admin.tasks_.$assignmentId.tsx`, `app/routes/admin.files.tsx`, `app/routes/admin.files_.$id.tsx`, `app/routes/admin.contacts.tsx`, `app/routes/admin.contacts_.import.tsx`, `app/routes/admin.contacts_.$id.tsx`, `app/routes/admin.contacts_.compose.tsx`, `app/routes/admin.embeds.tsx`, `app/routes/admin.embeds_.$id.tsx`.
- Portal/reviewer: `app/components/portal/participation-controls.tsx`, `app/components/portal/task-detail-view.tsx`, `app/components/portal/profile-view.tsx`, `app/components/portal/submission-detail-view.tsx`, `app/routes/admin.reviewers.tsx`, `app/routes/reviews.$id.tsx`.
- Explicit exception: `app/routes/admin.agenda.tsx` remains local and is checked, not converted.

---

### Task 1: Consolidate Clipboard Behavior

**Files:**
- Modify: `app/components/copy-button.tsx`
- Modify: `app/routes/admin.forms.$formId.tsx`
- Modify: `app/routes/admin.settings.team.tsx`
- Modify: `app/routes/admin.reviewers.tsx`
- Modify: `app/routes/admin.contacts_.$id.tsx`
- Modify: `app/routes/admin.embeds.tsx`
- Modify: `app/routes/admin.embeds_.$id.tsx`
- Modify: `app/widgets/bits.tsx`
- Modify: `app/widgets/index.ts`
- Verify unchanged caller: `app/components/getting-started.tsx`

**Interfaces:**
- Consumes: `Button` and `IconName` from `~/ui`/`~/ui/icon`.
- Produces:

```ts
export type CopyButtonProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string | null;
  resetAfterMs?: number | null;
  icon?: IconName | null;
  optimistic?: boolean;
  onFailure?: () => void;
};

export function CopyButton(props: CopyButtonProps): JSX.Element;
```

- [ ] **Step 1: Record the six existing behavior profiles before editing**

```text
getting-started/form-builder: Copy… -> Copied!, export icon, 2500 ms, visible failure
widgets: Copy -> Copied, no icon, 1600 ms, no visible failure
team invites: Copy link -> Copied, no icon, 2000 ms, select input on failure
reviewers: Copy -> Copied, no icon, persistent, optimistic
contact: Copy link -> Copied, no icon, persistent, optimistic
```

- [ ] **Step 2: Extend `CopyButton` with the exact configurable contract**

```tsx
const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

useEffect(() => {
  if (state === "idle" || resetAfterMs === null) return;
  const timeout = setTimeout(() => setState("idle"), resetAfterMs);
  return () => clearTimeout(timeout);
}, [resetAfterMs, state]);

function copy() {
  const write = navigator.clipboard?.writeText(value);
  if (optimistic) setState("copied");
  if (!write) return;
  write
    .then(() => {
      if (!optimistic) setState("copied");
    })
    .catch(() => {
      onFailure?.();
      if (!optimistic && failedLabel !== null) setState("failed");
    });
}
```

Default props remain the existing shared behavior: `copiedLabel="Copied!"`, `failedLabel="Copy failed"`, `resetAfterMs=2500`, `icon="export"`, `optimistic=false`.

- [ ] **Step 3: Replace the form-builder local helper**

```tsx
<CopyButton
  value={d.publicUrl}
  label="Copy link"
  failedLabel="Copy failed — select the link"
/>
```

Delete the local `CopyLinkButton` and its now-unused React state/effect imports.

- [ ] **Step 4: Replace widgets `CopyFieldButton` callers**

```tsx
<CopyButton
  value={value}
  copiedLabel="Copied"
  failedLabel={null}
  resetAfterMs={1600}
  icon={null}
/>
```

Import `CopyButton` directly from `~/components/copy-button` in both embed routes. Delete `CopyFieldButton` from `app/widgets/bits.tsx` and its export from `app/widgets/index.ts`; do not leave an alias or re-export.

- [ ] **Step 5: Replace team invite copy behavior with manual fallback**

```tsx
<Input id={id} readOnly value={link} aria-label="Invite link" size={42} />
<CopyButton
  value={link}
  label="Copy link"
  copiedLabel="Copied"
  failedLabel={null}
  resetAfterMs={2000}
  icon={null}
  onFailure={() => {
    const input = document.getElementById(id);
    if (input instanceof HTMLInputElement) input.select();
  }}
/>
```

Preserve the existing focus-to-select behavior, generated input ID, and input size. The current `Input` primitive does not accept refs, so the shared callback deliberately retains the existing ID-based fallback.

- [ ] **Step 6: Replace reviewer and contact optimistic copy behavior**

```tsx
<CopyButton
  value={inviteLink}
  copiedLabel="Copied"
  failedLabel={null}
  resetAfterMs={null}
  icon={null}
  optimistic
/>
```

Reviewer idle label remains `"Copy"`; contact passes `label="Copy link"`. Remove their copy-specific state only; preserve input labels and focus-to-select handlers.

- [ ] **Step 7: Run static and route verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- test/admin.settings.team.route.test.ts test/admin.reviewers.route.test.ts test/admin.forms.editor.route.test.ts
```

Expected: all commands exit 0; repository source contains one `navigator.clipboard.writeText` implementation in `app/components/copy-button.tsx`.

- [ ] **Step 8: Commit**

```bash
git add app/components/copy-button.tsx app/routes/admin.forms.\$formId.tsx \
  app/routes/admin.settings.team.tsx app/routes/admin.reviewers.tsx \
  app/routes/admin.contacts_.\$id.tsx app/routes/admin.embeds.tsx \
  app/routes/admin.embeds_.\$id.tsx app/widgets/bits.tsx app/widgets/index.ts
git commit -m "refactor(ui): consolidate clipboard controls" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Canonicalize Form Paths

**Files:**
- Modify: `app/domain/forms.ts`
- Modify: `app/cfp/wizard.ts`
- Modify every form-path caller listed in the File Structure section.
- Test: existing `test/cfp-alias.route.test.ts`, `test/admin.dashboard.getting-started.test.ts`, `test/cfp-account.route.test.ts`, `test/cfp-wizard.route.test.ts`, `test/admin.forms.route.test.ts`, `test/admin.forms.editor.route.test.ts`.

**Interfaces:**
- Consumes: existing `submitPath(eventSlug: string, formPublicId: string): string`.
- Produces:

```ts
export function adminFormPath(formId: string): string {
  return `/admin/forms/${formId}`;
}
```

- [ ] **Step 1: Run existing path-contract tests before editing**

```bash
pnpm test -- test/cfp-alias.route.test.ts test/admin.dashboard.getting-started.test.ts \
  test/cfp-account.route.test.ts test/cfp-wizard.route.test.ts \
  test/admin.forms.route.test.ts test/admin.forms.editor.route.test.ts
```

Expected: PASS, establishing the behavior that must remain byte-for-byte.

- [ ] **Step 2: Delete the duplicate public base helper**

In `app/cfp/wizard.ts`, delete:

```ts
export function submitBasePath(eventSlug: string, formId: string) {
  return `/submit/${eventSlug}/${formId}`;
}
```

Update all CFP route imports/calls to use `submitPath` from `~/domain/forms`; retain `stepPath` in `app/cfp/wizard.ts`.

- [ ] **Step 3: Route every manual public construction through `submitPath`**

```ts
return redirect(submitPath(event.slug, form.publicId));
```

```ts
publicUrl: `${url.origin}${submitPath(event.slug, form.publicId)}`;
```

Do not alter queries, step routing, origin selection, or redirects.

- [ ] **Step 4: Add and adopt `adminFormPath`**

```ts
export function adminFormPath(formId: string): string {
  return `/admin/forms/${formId}`;
}
```

Replace local `/admin/forms/${...}` mutation targets in `admin.forms.tsx` and `admin.forms.$formId.tsx`. Keep unrelated navigation links unchanged unless they are the exact same detail-path contract.

- [ ] **Step 5: Run path-contract verification**

```bash
pnpm typecheck
pnpm test -- test/cfp-alias.route.test.ts test/admin.dashboard.getting-started.test.ts \
  test/cfp-account.route.test.ts test/cfp-wizard.route.test.ts \
  test/admin.forms.route.test.ts test/admin.forms.editor.route.test.ts
```

Expected: all tests pass with the same redirect locations and absolute public URL assertions.

- [ ] **Step 6: Commit**

```bash
git add app/domain/forms.ts app/cfp/wizard.ts app/routes/cfp.tsx \
  app/routes/admin._index.tsx app/routes/admin.forms.tsx \
  app/routes/admin.forms.\$formId.tsx app/routes/submit.\$eventSlug.\$formId*.tsx
git commit -m "refactor(forms): centralize action paths" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add Busy Support to Shared, Auth, and Public Controls

**Files:**
- Modify: `app/ui/confirm-button.tsx`
- Modify all shared/auth/public busy callers listed in File Structure.

**Interfaces:**
- Consumes: `useBusy(): boolean` from `~/lib/use-busy`.
- Produces: `ConfirmButton` accepts `disabled?: boolean` and applies it to both the arming and final submit buttons.

- [ ] **Step 1: Extend `ConfirmButton` without importing application hooks**

```tsx
export function ConfirmButton({ disabled = false, ...props }: {
  // existing props
  disabled?: boolean;
})
```

Apply `disabled={disabled}` to the initial `type="button"` and the final `type="submit"`; Cancel remains enabled so an armed confirmation can always be dismissed.

- [ ] **Step 2: Adopt `useBusy()` in each shared/auth/public component**

At each component boundary:

```tsx
const busy = useBusy();
```

Then change mutation controls from no guard or navigation-only guard to:

```tsx
disabled={busy}
```

or preserve domain locks:

```tsx
disabled={busy || existingCondition}
```

Do not add busy to GET export/filter controls.

- [ ] **Step 3: Preserve operation-specific text**

Where current code uses local navigation/fetcher state for labels, retain it:

```tsx
<Button disabled={busy}>
  {navigation.state !== "idle" ? "Signing in…" : "Sign in"}
</Button>
```

Only `disabled` moves to the global contract.

- [ ] **Step 4: Verify shared/auth/public routes**

```bash
pnpm typecheck
pnpm lint
pnpm test -- test/auth.test.ts test/auth.tenancy.test.ts \
  test/onboarding.route.test.ts test/portal.access.test.ts \
  test/portal.participation.test.ts test/admin.dashboard.getting-started.test.ts
```

Expected: all commands and named test files pass.

- [ ] **Step 5: Commit with the sanctioned UI override**

```bash
git add app/ui/confirm-button.tsx app/components app/routes/login.tsx \
  app/routes/signup.tsx app/routes/forgot-password.tsx app/routes/onboarding.tsx \
  app/routes/set-password.\$token.tsx app/routes/unsubscribe.\$token.tsx \
  app/routes/portals.\$eventSlug.\$portalId.tsx
ALLOW_SCHEMA_CHANGE=1 git commit -m "fix(forms): guard shared and public mutations" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Guard Submissions, Forms, Settings, and Email Mutations

**Files:**
- Modify every submissions/forms/settings/email busy caller listed in File Structure.

**Interfaces:**
- Consumes: `useBusy()` and the `ConfirmButton disabled` prop from Task 3.
- Produces: no new API.

- [ ] **Step 1: Replace navigation-only disabled sources**

Remove component-level definitions equivalent to:

```ts
const busy = useNavigation().state !== "idle";
```

and replace with:

```ts
const busy = useBusy();
```

Retain `useNavigation()` only when its form data/state drives operation-specific text.

- [ ] **Step 2: Replace fetcher-local disabled sources**

For `submission-list.tsx`, email-template save, settings-library forms, and form-builder fetchers:

```tsx
const busy = useBusy();
const saving = fetcher.state !== "idle"; // only if copy/result logic still needs it
<Button disabled={busy || existingEligibility}>{saving ? "Saving…" : label}</Button>
```

This explicitly closes the adopted PR #64 gap in `submission-list.tsx` for both the drawer create fetcher and bulk list mutations.

- [ ] **Step 3: Guard every form-builder mutation**

Apply `busy` to required toggles, remove/apply/clear-rule, reorder, library add, field create, built-in/section/divider add, settings save, and destructive confirmations. Preserve `requiredLocked`, invalid rule inputs, already-placed checks, and other domain conditions with `|| busy`.

- [ ] **Step 4: Guard all remaining controls in this file group**

Use `disabled={busy}` or `disabled={busy || condition}` for every POST button, select, checkbox, and `ConfirmButton`; do not touch GET filter/export controls.

- [ ] **Step 5: Run targeted verification**

```bash
pnpm typecheck
pnpm lint
pnpm test -- test/admin.submissions.route.test.ts \
  test/admin.forms.route.test.ts test/admin.forms.editor.route.test.ts \
  test/admin.settings.team.route.test.ts
```

Expected: all commands exit 0; no non-agenda `fetcher.state !== "idle"` expression owns a mutation's disabled condition in these files.

- [ ] **Step 6: Commit**

```bash
git add app/lib/submission-list.tsx app/routes/admin.submissions*.tsx \
  app/routes/admin.forms*.tsx app/routes/admin.emails*.tsx \
  app/routes/admin.events.new.tsx app/routes/admin.settings*.tsx
git commit -m "fix(forms): guard admin mutations globally" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Guard Evaluation, Task, and Content Mutations

**Files:**
- Modify every evaluation/tasks/content busy caller listed in File Structure.

**Interfaces:**
- Consumes: `useBusy()` and `ConfirmButton disabled`.
- Produces: no new API.

- [ ] **Step 1: Add one global busy source per rendering component**

```tsx
const busy = useBusy();
```

Large route files contain multiple React components; call the hook in each component that renders mutations rather than prop-drilling through unrelated layers.

- [ ] **Step 2: Combine busy with all eligibility locks**

```tsx
disabled={busy || selected.size === 0}
disabled={busy || !sendKey}
disabled={busy || locked}
<ConfirmButton disabled={busy || cannotDelete} ... />
```

Do not replace or weaken any domain lock.

- [ ] **Step 3: Keep GET controls enabled by eligibility only**

CSV exports, file filters, and other `method="get"` forms are not mutations and do not receive `busy` unless they already intentionally had one.

- [ ] **Step 4: Run targeted route tests and static checks**

```bash
pnpm typecheck
pnpm lint
pnpm test -- test/admin.evaluation*.test.ts test/admin.tasks*.test.ts \
  test/admin.files*.test.ts test/admin.contacts*.test.ts test/admin.embeds*.test.ts
```

Expected: typecheck/lint pass and every matched existing test passes.

- [ ] **Step 5: Commit**

```bash
git add app/routes/admin.evaluation*.tsx app/routes/admin.tasks*.tsx \
  app/routes/admin.files*.tsx app/routes/admin.contacts*.tsx \
  app/routes/admin.embeds*.tsx
git commit -m "fix(forms): guard content workflow mutations" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Guard Portal and Reviewer Mutations

**Files:**
- Modify every portal/reviewer busy caller listed in File Structure.

**Interfaces:**
- Consumes: `useBusy()` and `ConfirmButton disabled`.
- Produces: no new API.

- [ ] **Step 1: Add `useBusy()` to portal composition components**

```tsx
const busy = useBusy();
```

Guard confirm/withdraw, comments, complete/uncomplete, task forms, file uploads, profile saves, submission edits, and destructive confirmations. Keep GET exports unchanged.

- [ ] **Step 2: Add `useBusy()` to reviewer flows**

Guard reviewer submission/update/abstain/save-decision controls and combine it with `locked` or other current eligibility rules. Keep local state that controls result copy or scorecard rendering.

- [ ] **Step 3: Verify portal/reviewer behavior**

```bash
pnpm typecheck
pnpm lint
pnpm test -- test/portal*.test.ts test/reviews*.test.ts test/admin.reviewers.route.test.ts
```

Expected: typecheck/lint pass and every matched existing test passes.

- [ ] **Step 4: Commit**

```bash
git add app/components/portal app/routes/admin.reviewers.tsx app/routes/reviews.\$id.tsx
git commit -m "fix(forms): guard portal and review mutations" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Exhaustive Local Re-sweep and Verification

**Files:**
- Modify: any non-agenda omissions found by the exact source scans.
- Create: judge artifact/disposition files required by the `judge-loop` skill, using suffix `-laneQ`.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a complete, verified branch and disposition log.

- [ ] **Step 1: Re-sweep busy guards**

Run repository searches for:

```text
useNavigation().state
navigation.state !== "idle"
fetcher.state !== "idle"
.state === "submitting"
disabled=
method="post"
method={"post"}
fetcher.Form
<Form
```

Inspect every remaining non-agenda mutation. Domain-only disabled conditions must be combined with `busy`; operation-local state may remain for labels/results. Record `admin.agenda.tsx` as the sole carve-out.

- [ ] **Step 2: Re-sweep clipboard implementations**

Search for:

```text
navigator.clipboard
clipboard
CopyFieldButton
CopyLinkButton
copiedId
```

Expected: one write implementation in `app/components/copy-button.tsx`; other hits are imports/callers/copy text, not behavior implementations.

- [ ] **Step 3: Re-sweep form paths**

Search for:

```text
submitBasePath
`/submit/${
"/submit/"
`/admin/forms/${
```

Expected: public base construction exists only in `submitPath`; admin form detail/action construction exists only in `adminFormPath`; step/query helpers may append to their canonical base.

- [ ] **Step 4: Run full verification**

```bash
pnpm verify
```

Expected: map check, typecheck/typegen, ESLint, Stylelint, and all Vitest files pass.

- [ ] **Step 5: Run the required judge loop**

Invoke `judge-loop` with the final committed diff, artifact suffix `-laneQ`, fresh judges, and maximum three rounds. For every finding, record one disposition:

```text
adopt — code/docs changed and verification rerun
reject — written technical reason with code/doc evidence
```

Never silently drop a finding.

- [ ] **Step 6: Apply adopted findings forward**

Commit each coherent correction without amending:

```bash
git add -A
git commit -m "fix: address convergence review" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Rerun `pnpm verify` after the last adopted finding.

---

### Task 8: Merge Main, Re-sweep, Push, and Create the PR

**Files:**
- Modify: any files newly landed on main that contain one of the three duplication classes.
- Create/update: PR decision-record body.

**Interfaces:**
- Consumes: the verified Task 7 branch.
- Produces: pushed branch and unmerged pull request.

- [ ] **Step 1: Fetch and merge main append-only**

```bash
git fetch origin main
git merge --no-edit origin/main
```

Never rebase. Record:

```bash
LAST_SWEPT_MAIN=$(git rev-parse origin/main)
printf '%s\n' "$LAST_SWEPT_MAIN"
```

Use the printed 40-character commit SHA in the PR body.

- [ ] **Step 2: Re-run all three exhaustive source sweeps**

Repeat Task 7 Steps 1–3 against the merged tree. Adopt newly landed controls/helpers immediately and commit forward if needed.

- [ ] **Step 3: Run final verification after the merge**

```bash
pnpm verify
git status --short
git log --oneline --decorate origin/main..HEAD
```

Expected: verification exits 0 and working tree is clean.

- [ ] **Step 4: Push exactly once after the final merge/re-sweep**

```bash
git push -u origin fix/convergence-sweep
```

- [ ] **Step 5: Create the PR decision record**

Use `create-pr` skill or `gh pr create`. The body must include:

```markdown
## Decision record
- Busy guards: global `useBusy()` everywhere except the documented agenda queue.
- Clipboard: one configurable shared `CopyButton`; per-surface labels/timing/fallback preserved.
- Form paths: `submitPath` and `adminFormPath` are canonical; duplicates deleted.
- `app/ui/confirm-button.tsx` changed under `ALLOW_SCHEMA_CHANGE=1`; guard-shared-files CI is red by design and the owner merges with `--admin`.
- Last swept main commit: insert the 40-character SHA printed in Step 1.

## Verification
- `pnpm verify`: exact passing test/file counts.
- Live local checks: exact controls/routes exercised and observed outcomes.

## Judge loop (`-laneQ`)
- Round-by-round findings and adopt/reject reasons.

## Inline AI review
- Every thread resolved with a fix commit or written discard reason.

DO NOT MERGE.
```

- [ ] **Step 6: Resolve every inline AI-review thread**

After automation posts, retrieve all review threads. For each unresolved thread:

1. Verify the claim against current code/docs.
2. Fix and push a new commit, or reply with a concrete written rejection reason.
3. Resolve the thread through the GitHub API.
4. Update the PR decision record with the disposition.

Do not merge the PR.

- [ ] **Step 7: Print the full lane report**

Report branch, PR URL, commits, files/surfaces changed, exact verification evidence, live checks, judge dispositions, AI-thread dispositions, `LAST_SWEPT_MAIN`, intentional shared-file CI exception, and explicit `DO NOT MERGE` status.
