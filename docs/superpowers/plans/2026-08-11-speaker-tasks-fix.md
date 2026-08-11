# Speaker Tasks Evaluation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make speaker onboarding cover every co-speaker with real due dates, keep roster workflow status aligned with acceptance/confirmation, and stop CSV imports before likely same-person duplicates are created.

**Architecture:** Keep all submission decisions on `transitionSubmissions`, extending its existing acceptance batch with a monotonic `pending → invited` contact transition. Keep participant confirmation exact to one participant row and atomically roll the contact to `confirmed`. Preserve exact-email CSV merge behavior, but add a deterministic normalized name+company classifier and a pre-write review gate with explicit “skip” or “create anyway” choices.

**Tech Stack:** React Router 7 framework mode, TypeScript 5.9 strict, Cloudflare Workers/workerd, D1/SQLite, Drizzle ORM, Zod 4, Vitest workers pool, hand-rolled `~/ui` primitives.

## Global Constraints

- Work only on `fix/speaker-tasks-fix`; append commits, never rebase/amend/force-push.
- No schema, migration, seed, dependency, binding, `app/ui`, or `app/app.css` changes in this feature worktree.
- D1 writes that must be atomic use `db.batch()`; never `db.transaction()`.
- Co-speakers are additional `participants.role === "speaker"` rows; `isPrimary` only orders one primary speaker.
- Contact tasks are one per `(taskId, contactId)`; submission tasks are one per `(taskId, contactId, submissionId)` and all inserts remain replay-safe.
- Default due dates materialize as `acceptedAt + tasks.dueInDays`; explicit assignment dates continue to override definition offsets.
- Exact normalized email remains an automatic merge. Same normalized name+company with a different email is never auto-merged or silently inserted.
- Contact workflow movement is monotonic for these events: final session acceptance changes only `pending → invited`; participant confirmation changes the contact to `confirmed`; neither path demotes a confirmed contact.
- Every bug fix gets a regression test that fails before implementation, runs against real D1, and asserts DB/route outcomes independently of implementation details.
- Finish with targeted tests, `pnpm verify`, live `pnpm dev:worktree` evidence, exactly one `judge-loop` round with suffix `-F4`, then the requested PR without merging.

---

### Task 1: Fan manual and automatic onboarding assignments out to all speakers

**Files:**
- Modify: `test/admin.tasks.route.test.ts`
- Modify: `app/routes/admin.tasks.tsx:714-769,1436-1440`
- Modify: `test/accept.domain.test.ts:193-315`
- Modify: `app/domain/accept.ts:186-200,262-365`

**Interfaces:**
- Consumes: canonical co-speaker representation `participants.role === "speaker"`; existing task-assignment partial unique indexes.
- Produces: both accept-time and manual accepted-audience assignment paths include every speaker-role participant and exclude moderator/chairperson/secondary-only contacts.

- [ ] **Step 1: Write the failing manual-assignment regression**

In `test/admin.tasks.route.test.ts`, seed a second `speaker` row on accepted submission `s1` and a moderator-only contact on the same submission. Assign `t_slides` and `t_flight`, then assert:

```ts
expect(slideRows.map((row) => row.contactId).sort()).toEqual([
  "c_co_speaker",
  "c_priya",
  "c_bob",
]);
expect(flightRows.map((row) => row.contactId).sort()).toEqual([
  "c_co_speaker",
  "c_priya",
  "c_bob",
]);
expect(allAssignments.some((row) => row.contactId === "c_moderator")).toBe(false);
```

Run:

```bash
pnpm test -- test/admin.tasks.route.test.ts
```

Expected before the fix: submission task assertion omits `c_co_speaker`; contact accepted-audience assertion includes `c_moderator`.

- [ ] **Step 2: Correct both manual candidate queries**

In `app/routes/admin.tasks.tsx`:

```ts
// submission tasks: remove eq(participants.isPrimary, true)
eq(participants.role, "speaker")

// accepted contact audience: add speaker-role qualification
eq(participants.role, "speaker")
```

Change the disabled audience label to `Speakers on accepted submissions`.

- [ ] **Step 3: Strengthen the acceptance-spine regression**

In `test/accept.domain.test.ts`, retain the existing two-speaker/multi-role fixture and additionally assert both speaker contacts receive every assignable default, due dates are non-null for definitions with offsets, statuses advance to `invited`, and replay preserves counts/completed work.

- [ ] **Step 4: Add monotonic invited statements to the existing acceptance batch**

Extend `planAcceptProvisioning`’s speaker projection with `contactStatus`. Build unique pending speaker-contact ids, then append one scoped update per id (or one `inArray` update) before the assignment insert:

```ts
db.update(contacts)
  .set({ status: "invited" })
  .where(and(inArray(contacts.id, pendingSpeakerIds), eq(contacts.status, "pending")))
```

Emit `contact.status_changed` only after the batch commits. Do not change participant acceptance status and do not touch already `invited`, `confirmed`, or `declined` contacts.

- [ ] **Step 5: Run focused tests**

```bash
pnpm test -- test/admin.tasks.route.test.ts test/accept.domain.test.ts
```

Expected: all pass; co-speakers receive contact and submission tasks; non-speaker roles do not; replays remain idempotent.

- [ ] **Step 6: Commit**

```bash
git add app/domain/accept.ts app/routes/admin.tasks.tsx test/accept.domain.test.ts test/admin.tasks.route.test.ts
git commit -m "fix(tasks): assign onboarding work to every speaker" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Give every provisioned onboarding default a due offset

**Files:**
- Modify: `test/seed-provision.lockstep.test.ts:51-82,216-267`
- Modify: `app/domain/provisionEvent.ts:122-150`
- Modify: `test/portal.tasks.test.ts:105-117,132-180`

**Interfaces:**
- Consumes: `tasks.dueInDays` and `taskAssignments.dueAt`; accept-time materialization in `planAcceptProvisioning`.
- Produces: fresh events provision hotel (14 days), flight (21 days), and presentation (30 days) offsets; accepted speakers receive materialized due dates that existing admin/portal views render.

- [ ] **Step 1: Make the default expectations fail**

Change `EXPECTED_TASKS` to independently require:

```ts
{ name: "Hotel & Travel Reservations", dueInDays: 14, /* existing fields */ }
{ name: "Flight Reimbursement", dueInDays: 21, /* existing fields */ }
{ name: "Presentation Upload", dueInDays: 30, /* existing fields */ }
```

Extend the fresh-event acceptance query to select `taskAssignments.dueAt`, capture `before = Date.now()` immediately before acceptance, and assert each due instant falls within 10 seconds of `before + dueInDays * 86_400_000`.

Run:

```bash
pnpm test -- test/seed-provision.lockstep.test.ts
```

Expected before the fix: provisioned definition values are `null` and assignment due dates are absent.

- [ ] **Step 2: Add the three offsets to event provisioning**

Set `dueInDays` on the three task values in `provisionEventDefaults`:

```ts
Hotel & Travel Reservations: 14
Flight Reimbursement: 21
Presentation Upload: 30
```

Do not edit `drizzle/seed.sql`; its judged demo assignments already carry absolute `due_at` values, while this defect is the fresh-event default path.

- [ ] **Step 3: Pin portal detail rendering against a real due date**

Give `ta_hotel` a fixed `dueAt` in `test/portal.tasks.test.ts`, call `taskLoader`, and independently assert:

```ts
expect(loaded.due).toBe("Sep 30, 2026");
expect(loaded.status.label).toBe("Incomplete");
```

The admin assignments loader already has a due-date/overdue regression in `test/admin.tasks.route.test.ts`; keep it green.

- [ ] **Step 4: Run due-date regressions**

```bash
pnpm test -- test/seed-provision.lockstep.test.ts test/accept.domain.test.ts test/admin.tasks.route.test.ts test/portal.tasks.test.ts
```

Expected: all defaults and minted assignments carry due dates; admin and portal projections return them.

- [ ] **Step 5: Commit**

```bash
git add app/domain/provisionEvent.ts test/seed-provision.lockstep.test.ts test/portal.tasks.test.ts
git commit -m "fix(tasks): provision onboarding due dates" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Advance roster status on participant confirmation

**Files:**
- Modify: `test/portal.participation.test.ts`
- Modify: `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx:428-475`

**Interfaces:**
- Consumes: authenticated `myParticipant.id`, event-scoped `ctx.contact.id`, accepted-session gate.
- Produces: exact participant-row acceptance updates and atomic contact workflow confirmation.

- [ ] **Step 1: Write failing lifecycle and role-granularity tests**

Extend `seedPanel` with contacts initially `invited`. Add a second non-secondary role for Priya on the same submission. Confirm only `p_priya`, then assert:

```ts
expect(await acceptance("p_priya")).toBe("accepted");
expect(await acceptance("p_priya_moderator")).toBe("pending");
expect(await contactStatus("c_priya")).toBe("confirmed");
```

Retain the independent Dana withdrawal assertion and assert Dana’s contact does not become confirmed.

Run:

```bash
pnpm test -- test/portal.participation.test.ts
```

Expected before the fix: all Priya non-secondary roles change together and contact status stays `invited`.

- [ ] **Step 2: Batch the exact participant and contact updates**

Replace the broad `(submissionId, contactId, role != secondary)` update with:

```ts
const participantUpdate = db.update(participants)
  .set({ acceptanceStatus: acceptance })
  .where(and(
    eq(participants.id, myParticipant.id),
    eq(participants.submissionId, submission.id),
    eq(participants.contactId, ctx.contact.id),
  ));

await db.batch(
  acceptance === "accepted"
    ? [
        participantUpdate,
        db.update(contacts)
          .set({ status: "confirmed" })
          .where(and(eq(contacts.id, ctx.contact.id), eq(contacts.eventId, ctx.event.id))),
      ]
    : [participantUpdate],
);
```

Track the contact transition after commit when confirmation changed a non-confirmed contact. Withdrawal remains participant-specific and never downgrades a contact confirmed through another role/session.

- [ ] **Step 3: Run lifecycle regressions**

```bash
pnpm test -- test/portal.participation.test.ts test/portal.editing.test.ts test/accept.domain.test.ts
```

Expected: one held role changes, co-speakers stay independent, contact becomes confirmed, accepted-session gate still blocks pending sessions.

- [ ] **Step 4: Commit**

```bash
git add 'app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx' test/portal.participation.test.ts
git commit -m "fix(speakers): advance confirmation workflow status" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Review probable CSV duplicates before any writes

**Files:**
- Modify: `app/domain/contacts.ts`
- Modify: `test/admin.contacts.import.route.test.ts`
- Modify: `app/routes/admin.contacts_.import.tsx`

**Interfaces:**
- Produces: `probableContactDuplicateKey(input: { firstName: string; lastName: string; companyName: string | null | undefined }): string | null`.
- Consumes: exact-email merge map, mapped CSV rows, active-event contacts.
- Produces: a bounded `step: "review"` action state carrying one CSV payload, mapping, and flagged rows; explicit `duplicatePolicy: "skip" | "create"` completion.

- [ ] **Step 1: Add deterministic helper tests through the import route**

Seed `Priya Raman / Latticework Systems / priya@example.com`. Import `" priya ","RAMAN",priya.alt@example.com,"  LATTICEWORK   SYSTEMS  "`. Assert the first POST returns `step === "review"`, identifies the existing email, and leaves the database unchanged. Add controls proving different company adds normally and exact normalized email still merges.

- [ ] **Step 2: Add explicit policy regressions**

Replay the same CSV/mapping with `duplicatePolicy=skip`; assert the probable row is skipped with a reason naming normalized name+company and no second contact exists. Replay in a fresh fixture with `duplicatePolicy=create`; assert the second email is inserted and no fields merged into the original.

Run:

```bash
pnpm test -- test/admin.contacts.import.route.test.ts
```

Expected before the fix: the probable duplicate is immediately inserted and no review step exists.

- [ ] **Step 3: Add the shared deterministic key**

In `app/domain/contacts.ts`:

```ts
const normalizeIdentityPart = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

export function probableContactDuplicateKey(input: {
  firstName: string;
  lastName: string;
  companyName: string | null | undefined;
}): string | null {
  const name = `${normalizeIdentityPart(input.firstName)} ${normalizeIdentityPart(input.lastName)}`.trim();
  const company = normalizeIdentityPart(input.companyName ?? "");
  return name && company ? `${name} ${company}` : null;
}
```

Company is required to avoid flagging common names without corroborating context.

- [ ] **Step 4: Classify before writing**

In the import action:

- Build a probable-key map from active-event contacts.
- Keep exact normalized-email matching first and unchanged.
- Add each valid new CSV row to the key map so same-file/different-email duplicates are caught too.
- With no `duplicatePolicy`, collect likely duplicates and return `step: "review"` before executing any `writes`.
- With `skip`, report each likely duplicate as skipped and never insert it.
- With `create`, insert it as a new contact and report that the organizer explicitly overrode the warning.

Do not fuzzy match, persist duplicate flags, or auto-merge.

- [ ] **Step 5: Render one review form with two explicit outcomes**

Add `step === "review"` UI showing the likely duplicate rows and existing candidate emails. Use one `<Form>` containing one `csvB64` payload and preserved `map_*` fields, with two submit buttons:

```tsx
<Button name="duplicatePolicy" value="skip">Import safe rows</Button>
<Button name="duplicatePolicy" value="create" variant="ghost">
  Create probable duplicates anyway
</Button>
```

This follows the roster’s existing warning-before-insert / create-anyway pattern without duplicating a 1 MB payload per row.

- [ ] **Step 6: Run import and CRM regressions**

```bash
pnpm test -- test/admin.contacts.import.route.test.ts test/crm.directory.route.test.ts test/admin.contacts.route.test.ts
```

Expected: import review is active-event scoped, exact email wins, likely duplicates never auto-merge, explicit override works, existing CRM duplicate surfaces stay green.

- [ ] **Step 7: Commit**

```bash
git add app/domain/contacts.ts app/routes/admin.contacts_.import.tsx test/admin.contacts.import.route.test.ts
git commit -m "fix(speakers): flag probable CSV duplicates" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Verify, live-walk, judge once, and publish the PR

**Files:**
- Create: `docs/reviews/speaker-tasks-F4-dispositions.md` only if judge-loop reports findings requiring a durable disposition log.
- Modify: product/tests only for verified judge or AI-review findings.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: green repository gate, observed live flow, exactly one judge round, open PR with zero unresolved AI-review threads.

- [ ] **Step 1: Run all focused regressions together**

```bash
pnpm test -- test/accept.domain.test.ts test/admin.tasks.route.test.ts test/seed-provision.lockstep.test.ts test/portal.tasks.test.ts test/portal.participation.test.ts test/admin.contacts.import.route.test.ts
```

- [ ] **Step 2: Run the complete gate**

```bash
pnpm verify
git diff --check origin/main...HEAD
git status --short --branch
```

- [ ] **Step 3: Live-verify accept → co-speaker tasks**

Reset and start the isolated app:

```bash
pnpm db:reset
pnpm dev:worktree
```

Through real HTTP/browser actions, create or use a pending submission with two `speaker` participants, finalize acceptance, then observe:

- both contacts appear in All assignments;
- each has hotel, flight, and presentation work as scoped;
- Due is a real date in admin and each speaker portal;
- contact workflow is Invited after acceptance;
- confirming one participant changes that contact to Confirmed;
- replaying acceptance does not change assignment counts.

Query local D1 for independent counts/statuses/due dates and record the exact evidence for the PR body.

- [ ] **Step 4: Live-verify CSV warning**

Import a CSV row with an existing contact’s normalized name+company and a different email. Observe the review screen before any roster write, choose skip, and verify one roster row remains. Repeat with explicit create-anyway and verify the second row is created only then.

- [ ] **Step 5: Invoke `judge-loop` exactly once**

Use suffix `-F4` and review the complete `origin/main...HEAD` diff against the mission, SCOPE, flows, scenarios, and engineering rules. Fix only confirmed findings test-first, rerun targeted tests plus `pnpm verify`, and do not run a second judge round.

- [ ] **Step 6: Invoke verification-before-completion and create the requested PR**

Use title exactly:

```text
fix(speakers): co-speaker task minting, due dates, lifecycle status, import dedupe flags
```

The body is a decision record with user outcomes, root causes, chosen invariants, exact targeted/full/live evidence, judge disposition, and `DO NOT MERGE`.

- [ ] **Step 7: Resolve inline AI-review threads and wait for CI**

Use GitHub GraphQL to list unresolved review threads. Verify each claim against current code; fix valid findings test-first, reply with evidence for invalid/already-fixed claims, resolve every thread, push, and wait for `gh pr checks --watch`. Never merge.

- [ ] **Step 8: Print the complete lane report**

Include PR link/number, observed CI state, commit list, each product outcome, focused/full/live evidence, judge and AI-review dispositions, residual authorized limits, and an explicit “not merged” statement.
