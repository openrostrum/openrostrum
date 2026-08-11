# CRM and Public Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers add a person directly from the organization CRM, keep the directory table usable at bounded widths, and make public search/filter Apply controls submit on the first click.

**Architecture:** The CRM directory remains a union of event-scoped `contacts` keyed by normalized email. The new org-level action creates a person's first appearance in an explicitly selected event owned by the active organization, blocks exact-email duplication across the organization, and reuses the existing same-name warning semantics. Public filters remain URL-driven SSR GET forms; the click fix must preserve native progressive enhancement and select auto-submit.

**Tech Stack:** React Router v7 framework mode, React 19, TypeScript strict, Drizzle ORM on Cloudflare D1, Zod 4, Vitest in workerd, Tailwind v4 through existing UI primitives.

## Global Constraints

- Every loader and action self-authenticates; writes derive organization/event scope server-side.
- D1 has no interactive transactions; use existing single inserts or `db.batch()` only.
- Do not modify `app/db/schema.ts`, migrations, `app/ui`, or dependencies.
- Route JSX composes existing `~/ui` primitives; route classes express layout only.
- Every mutating control uses `useBusy()` and disables while a request is in flight.
- Bug fixes use a regression test where the existing harness can observe the failure; browser-only pointer behavior is verified live.
- No native `confirm()`, `alert()`, or `prompt()`.

---

## File Structure

- Modify `app/routes/admin.crm.directory.tsx`: validate/create a directory person, expose the Add person panel, and add directory overflow containment/affordance.
- Modify `test/crm.directory.route.test.ts`: pin create, duplicate, and tenant-boundary persistence contracts against real D1.
- Modify `app/widgets/filter-bar.tsx`: remove the first-click race while retaining GET URLs and select-driven submission.
- Create no schema, route, primitive, or dependency files.

### Task 1: Prove the CRM create contracts

**Files:**
- Test: `test/crm.directory.route.test.ts`

**Interfaces:**
- Consumes: existing `action()` in `app/routes/admin.crm.directory.tsx` and `runAction()` test helper.
- Produces: failing behavioral contracts for the `add-person` intent.

- [ ] **Step 1: Add a successful org-scoped create test**

Post `intent=add-person`, `firstName=Ada`, `lastName=Lovelace`, `email=Ada@Example.com`, `initialEventId=e1`, optional `jobTitle` and `companyName`. Assert a 302 redirect to `/admin/crm/person/ada%40example.com`, then query D1 and assert exactly one normalized-email row exists in `e1` with the submitted profile fields.

- [ ] **Step 2: Add exact-email and same-name dedupe tests**

For an existing org email, assert the action reports the existing person and inserts no row. For `Priya Raman` under a new email, assert the first post returns a duplicate warning and inserts nothing; repost with `confirmDuplicate=1` and assert one row is inserted and the redirect targets the new org profile.

- [ ] **Step 3: Add a cross-tenant event refusal test**

Post a new person from `u_admin1` with `initialEventId=e3`. Assert the response names the invalid event selection and D1 contains no row for the submitted email in any event.

- [ ] **Step 4: Run the focused test and confirm RED**

Run: `pnpm test -- crm.directory.route.test.ts`

Expected: the new cases fail because `intent=add-person` is unknown and no contact is inserted.

### Task 2: Implement direct Add person and overflow usability

**Files:**
- Modify: `app/routes/admin.crm.directory.tsx`
- Test: `test/crm.directory.route.test.ts`

**Interfaces:**
- Consumes: `contacts`, `insertContactSchema`, `events`, `normalizeEmail`, `isUniqueViolation`, `useBusy()`.
- Produces: `intent=add-person` action branch with action data shaped as `{ fieldErrors?, formError?, duplicate?, existing? }` and a visible directory form.

- [ ] **Step 1: Define the input and action result**

Create `NewPerson` from `insertContactSchema.pick({ firstName, lastName, email, jobTitle, companyName })`, refine first/last/email with the same messages as the event roster, and extend it with `initialEventId: z.string().min(1, "Pick an initial event.")`. Extend `ActionData` with field errors, `duplicate: { name, email }`, and `existing: { name, email }`.

- [ ] **Step 2: Add the authenticated, tenant-scoped action branch**

Dispatch `intent === "add-person"` to `addPersonAction(db, org.id, form)`. Parse and normalize values; verify `initialEventId` belongs to `org.id`; look for an exact normalized email across the org and return `existing` without writing; unless `confirmDuplicate=1`, look for the same case-insensitive first/last name under another email and return `duplicate`; insert the event-backed contact and redirect to `/admin/crm/person/${encodeURIComponent(email)}`. Convert a race-time unique violation into the existing-person response and track create/failure outcomes without leaking raw errors.

- [ ] **Step 3: Render the direct action**

Add an always-visible `Add person` heading/action area before the filters. Render first name, last name, email, job title, company, and Initial event fields using `Field`, `Input`, `Select`, `Button`, `ErrorText`, and `ButtonLink`; submit `intent=add-person`; disable create controls with `busy`; show the same-name warning plus `Create anyway`; show exact-email dedupe with a direct link to the existing org profile.

- [ ] **Step 4: Keep the directory horizontally bounded with an explicit cue**

Give the directory section `min-w-0`, preserve the existing `Table` scroll container, and render a concise right-aligned `Scroll horizontally to see all columns →` cue immediately above it so macOS users are not dependent on hidden overlay scrollbars. Keep the Events column visible and unchanged.

- [ ] **Step 5: Run the CRM test and confirm GREEN**

Run: `pnpm test -- crm.directory.route.test.ts`

Expected: all CRM directory tests pass, including new persistence and tenant-boundary assertions.

### Task 3: Diagnose and fix the public Apply interaction

**Files:**
- Modify: `app/widgets/filter-bar.tsx`
- Test only if an observable automated browser boundary already exists; do not add a source-shape test.

**Interfaces:**
- Consumes: `base`, `filters`, `facets`, `extraParams`, and the existing UI fields/buttons.
- Produces: one stable GET form whose Apply button and select changes each trigger exactly one navigation.

- [ ] **Step 1: Reproduce before editing**

Start `pnpm dev:worktree`, load seeded Sessions, Speakers, and Gallery pages, type a query, click Apply once, and record the observed URL/result behavior. In the browser event/navigation trace, determine whether the first click is lost to a select-triggered `requestSubmit()`, React Router form interception/remount, or pointer target movement.

- [ ] **Step 2: Implement the smallest root-cause fix**

Keep a single GET form and shareable query parameters. If React Router interception/remount is the cause, use a native `<form method="get" action={base}>` for this anonymous SSR surface. If select auto-submit races the explicit click, submit from the stable form element exactly once and remove the competing remount path. Preserve hidden `extraParams`, Clear links, and no-JS behavior.

- [ ] **Step 3: Run focused public loader tests**

Run: `pnpm test -- public-program.route.test.ts embed.route.test.ts`

Expected: public query/filter projections and embed reuse remain green.

- [ ] **Step 4: Live-verify one click on all three surfaces**

In the running app, on Sessions, Speakers, and Gallery: type a query, click Apply once, and assert the URL gains `q=...` and visible results change after that single click. On Sessions, also change Track/Format/Room once and assert one navigation with the chosen facet retained.

### Task 4: Verify, judge, and submit the lane

**Files:**
- Modify only files required by valid judge/review findings.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: verified branch and unmerged PR.

- [ ] **Step 1: Run full verification**

Run: `pnpm verify`

Expected: formatter, lint, types, map/schema guards, and full workerd tests all pass.

- [ ] **Step 2: Complete live product verification**

With `pnpm dev:worktree`, create a unique person through CRM, observe the person in the directory/profile, exercise exact-email and same-name warnings, inspect the directory at a clipped-width viewport and horizontally scroll to Events, and repeat one-click Apply checks across all public surfaces.

- [ ] **Step 3: Run one judge-loop round**

Invoke `judge-loop` once with suffix `-F5`, challenge the diff against the mission and production lens, and implement only verified findings. Re-run focused tests and `pnpm verify` after any edit.

- [ ] **Step 4: Commit and create the PR**

Commit the implementation and plan. Create an unmerged PR titled `fix(crm,public): direct add-person, directory overflow, single-click filters`. The body records the decisions: event-backed first appearance preserves the current schema; exact email is blocked org-wide; same-name duplication requires explicit confirmation; Events remains visible with a scroll cue; the public filter change follows the reproduced root cause.

- [ ] **Step 5: Stabilize review**

Wait for CI and inline ai-review. Read every inline thread, apply only verified corrections, push follow-up commits, resolve addressed threads, and leave the PR unmerged.
