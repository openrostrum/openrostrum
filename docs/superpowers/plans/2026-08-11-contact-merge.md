# Duplicate-Contact Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer compare duplicate people, choose the survivor, atomically merge all active references, retain an immutable audit, and preserve portal access through either prior login.

**Architecture:** A focused `contact-merge` domain module builds a server-owned preview/plan and executes it as one D1 batch. Source contact rows are snapshotted into `contact_merges` and removed from the active table after every reference is re-pointed or consolidated; portal user aliases preserve credentials. A dedicated CRM route owns comparison/confirmation while the existing profile duplicate banner remains the entry point.

**Tech Stack:** React Router 7 loaders/actions, React 19, TypeScript strict mode, Drizzle ORM 0.45 on Cloudflare D1, Zod 4, Vitest workerd pool, existing `~/ui` primitives.

## Global Constraints

- D1 has no interactive transactions: the merge writes through one `db.batch()` and never calls `db.transaction()`.
- Every loader and action self-authenticates; both source and survivor resolve through the active organization.
- The merge route never trusts event ids, contact ids, counts, or actor fields from `FormData`.
- The merge key is client-minted, validated, organization-scoped, and replay-safe.
- Every submit control uses `useBusy()`; the final action uses an in-app `ConfirmButton`, never native `confirm()`.
- The chosen survivor's populated values win; source-only values fill blanks.
- No R2, email, Resend, or Airtable network call occurs during merge execution.
- Lists and previews are bounded by the two people's organization-scoped relationships and show exact counts.
- Migration slot is `0011`; schema/migration/SCOPE changes are owner-sanctioned and commit with `ALLOW_SCHEMA_CHANGE=1`.
- The SCOPE OUT row records the 2026-08-11 owner override and no longer says merge is excluded.

---

## File structure

- Create `app/domain/contact-merge.ts`: all org-scoped preflight, preview construction, deterministic conflict policy, batch execution, and audit lookup.
- Create `app/routes/admin.crm.merge.tsx`: comparison, survivor choice, movement preview, final in-app confirmation, action telemetry, and post-merge redirect.
- Create `test/contact-merge.test.ts`: real-D1 reference matrix, conflict behavior, idempotency, tenancy, route, and portal regressions.
- Modify `app/db/schema.ts`: merge audit, portal identity alias, and contact custom-value tables plus relations/types.
- Create migration `drizzle/migrations/0011_*.sql` and matching Drizzle metadata by generating once, then reserving slot `0011`.
- Modify `app/domain/portal.ts`: resolve aliases for direct portal URLs and use the canonical submitter user.
- Modify `app/routes/portal.tsx`: bare retired-account login finds the survivor's most recent portal.
- Modify `app/routes/admin.crm.person.$email.tsx`: duplicate banner links to merge preview and completed audits appear on the survivor.
- Modify `SCOPE.md`: record the dated owner override in the former OUT row.
- Modify generated route types only through `pnpm typegen`; do not hand-edit `app/routes.ts`.

---

### Task 1: Add merge persistence contracts and reserve migration 0011

**Files:**
- Modify: `app/db/schema.ts:502-563,1287-1391,1475-1881`
- Create: `drizzle/migrations/0011_*.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Create: `drizzle/migrations/meta/0011_snapshot.json`
- Modify: `SCOPE.md:161-173`
- Test: `test/contact-merge.test.ts`

**Interfaces:**
- Produces: `contactFieldValues`, `contactMerges`, `contactIdentityAliases`, `ContactMergeAuditSummary`, and Drizzle select/insert types.
- Consumes: existing `organizations`, `users`, `contacts`, `fields`, and timestamp/id conventions.

- [ ] **Step 1: Write a failing schema contract test**

Create `test/contact-merge.test.ts` with a baseline organization, two events, admin, duplicate contacts, and assertions that the three new tables accept valid rows and enforce these unique keys:

```ts
it("persists one audit per org merge key and one alias per org user", async () => {
  const db = getDb(env);
  await seedMergeBaseline();
  await db.insert(contactMerges).values({
    id: "merge-1",
    organizationId: "org-a",
    sourceEmail: "ada.alt@example.com",
    survivorEmail: "ada@example.com",
    actorId: "admin-a",
    actorName: "Admin A",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    summary: emptySummary,
    retiredContacts: [],
  });
  await expect(db.insert(contactMerges).values({
    id: "merge-2",
    organizationId: "org-a",
    sourceEmail: "other@example.com",
    survivorEmail: "ada@example.com",
    actorId: "admin-a",
    actorName: "Admin A",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    summary: emptySummary,
    retiredContacts: [],
  })).rejects.toThrow();
});
```

Define `emptySummary` independently from the design with zeroed keys for contacts, participants, tasks, files, custom values, notes, pipeline, identities, submissions, and Airtable links.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `pnpm test -- test/contact-merge.test.ts`
Expected: FAIL because the schema exports do not exist.

- [ ] **Step 3: Add the schema**

Add:

```ts
export type ContactMergeAuditSummary = {
  eventContactsCreated: number;
  contactsRetired: number;
  profileFieldsFilled: number;
  participantLinksMoved: number;
  participantLinksConsolidated: number;
  taskAssignmentsMoved: number;
  taskAssignmentsConsolidated: number;
  filesMoved: number;
  customValuesMoved: number;
  customValuesConsolidated: number;
  notesMoved: number;
  pipelineCardsMoved: number;
  pipelineCardsConsolidated: number;
  pipelineHistoryMoved: number;
  portalIdentitiesAliased: number;
  submissionsReassigned: number;
  airtableLinksMoved: number;
  airtableLinksConsolidated: number;
};

export const contactFieldValues = sqliteTable("contact_field_values", {
  id: id(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  fieldId: text("field_id").notNull().references(() => fields.id, { onDelete: "restrict" }),
  value: text("value"),
  createdAt: createdAt(),
}, (t) => [
  unique("contact_field_values_contact_field_uq").on(t.contactId, t.fieldId),
  index("contact_field_values_contact_idx").on(t.contactId),
]);
```

Define `contactMerges` after `contacts` with organization/actor FKs, unique `(organizationId, idempotencyKey)`, JSON `summary`, JSON `retiredContacts`, and `createdAt`. Define `contactIdentityAliases` with organization, source user, nullable canonical survivor user, survivor email, merge id, created timestamp, unique `(organizationId, sourceUserId)`, and indexes needed by portal resolution.

- [ ] **Step 4: Generate and reserve migration slot 0011**

Run: `ALLOW_SCHEMA_CHANGE=1 pnpm db:generate`.

If Drizzle emits `0010_<name>.sql` because the parallel slot has not landed locally, rename the SQL and snapshot to `0011_<name>.sql` / `0011_snapshot.json`, and update only the generated journal entry's `idx` and `tag` to `11` / `0011_<name>`. Do not invent SQL by hand.

- [ ] **Step 5: Record the owner override in SCOPE**

Replace the contact-merge OUT row with:

```md
| ~~Contact merge tooling (Sessionboard's Unique Contact Settings / CRM merge)~~ | **IN — owner override 2026-08-11 (“we're going for the 100%”):** duplicate contacts can be compared, a primary selected, all relationships atomically re-pointed, and the retired identity retained in an audit trail. |
```

- [ ] **Step 6: Reset the real local D1 and run the schema test GREEN**

Run: `pnpm db:reset && pnpm test -- test/contact-merge.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the schema contract**

```bash
ALLOW_SCHEMA_CHANGE=1 git add app/db/schema.ts drizzle/migrations SCOPE.md test/contact-merge.test.ts
ALLOW_SCHEMA_CHANGE=1 git commit -m "feat(crm): add contact merge persistence"
```

---

### Task 2: Build the org-scoped preview and tenancy boundary

**Files:**
- Create: `app/domain/contact-merge.ts`
- Modify: `test/contact-merge.test.ts`

**Interfaces:**
- Produces:
  - `buildContactMergePreview(db: Db, organizationId: string, sourceEmail: string, survivorEmail: string): Promise<ContactMergePreviewResult>`
  - `ContactMergePreviewResult = { ok: true; preview: ContactMergePreview } | { ok: false; code: "same" | "missing"; reason: string }`
  - `ContactMergePreview` with source/survivor person identity, per-event rows, movement summary, profile fields that will fill, and `mergeKey` supplied separately by the route.
- Consumes: normalized emails from `normalizeEmail`; schema tables from Task 1.

- [ ] **Step 1: Write failing preview and tenancy tests**

Add tests proving:

```ts
const result = await buildContactMergePreview(
  db,
  "org-a",
  "ada.alt@example.com",
  "ada@example.com",
);
expect(result).toMatchObject({
  ok: true,
  preview: {
    source: { email: "ada.alt@example.com" },
    survivor: { email: "ada@example.com" },
    events: [
      { eventId: "event-a1", sourceContactId: "source-a1", survivorContactId: "survivor-a1", createsSurvivor: false },
      { eventId: "event-a2", sourceContactId: "source-a2", survivorContactId: null, createsSurvivor: true },
    ],
  },
});
```

Also call with a source that exists only in org B and with a survivor that exists only in org B; both must return the same `missing` result and exact zero writes in every merge table.

- [ ] **Step 2: Run preview tests RED**

Run: `pnpm test -- test/contact-merge.test.ts -t "preview|foreign"`
Expected: FAIL because `buildContactMergePreview` is missing.

- [ ] **Step 3: Implement bounded organization-scoped loading**

In `contact-merge.ts`, resolve both people by joining `contacts → events` on `events.organizationId`. Normalize comparison with `lower(contacts.email)`. Load only columns needed to compare/profile-fill and collect the verified contact ids before querying references.

Build exact summary counts from:

- `participants.contactId`
- `taskAssignments.contactId`
- `files.contactId`
- `contactFieldValues.contactId`
- `crmNotes.(organizationId,email)`
- `pipelineCards.(organizationId,email)` plus `pipelineStageChanges.cardId`
- source/survivor `contacts.userId`
- `submissions.submitterId` restricted through organization events
- `airtableLinks` where `tableName = 'contacts'` and `recordId IN verifiedContactIds`

Count unique conflicts separately instead of presenting them as ordinary moves.

- [ ] **Step 4: Run preview and tenancy tests GREEN**

Run: `pnpm test -- test/contact-merge.test.ts -t "preview|foreign"`
Expected: PASS.

- [ ] **Step 5: Commit the preview boundary**

```bash
git add app/domain/contact-merge.ts test/contact-merge.test.ts
git commit -m "feat(crm): preview duplicate contact movement"
```

---

### Task 3: TDD the full atomic re-pointing matrix

**Files:**
- Modify: `app/domain/contact-merge.ts`
- Modify: `test/contact-merge.test.ts`

**Interfaces:**
- Produces:
  - `executeContactMerge(db: Db, organizationId: string, input: { sourceEmail: string; survivorEmail: string; idempotencyKey: string; actor: { id: string; name: string } }): Promise<ContactMergeExecutionResult>`
  - success returns `{ ok: true; mergeId: string; survivorEmail: string; summary: ContactMergeAuditSummary; replayed: boolean }`
  - failure returns `{ ok: false; code: "same" | "missing" | "invalid_key" | "failed"; reason: string }`
  - `queryContactMergeHistory(db: Db, organizationId: string, survivorEmail: string, limit: number)` for profile audit visibility.
- Consumes: the exact preview plan from Task 2 and persistence from Task 1.

- [ ] **Step 1: Seed one row for every reference and write the failing matrix assertion**

Build source/target rows in two org-A events and unrelated rows in org B. Seed:

- a source-only participant and a same-submission/same-role source+target participant conflict;
- a source-only assignment and a same-task/same-submission source+target assignment conflict with divergent status/response/file/dates;
- a source file;
- a source-only custom field value and a conflicting value;
- two source notes;
- source and target pipeline cards with history;
- source and target users, source invite/reset token, and source-owned submission;
- source-only and conflicting Airtable contact links.

After execution assert active source contacts are absent, the audit contains both retired snapshots, and every source id/email/card/user reference is absent from active reference columns. Assert unrelated org-B rows byte-for-byte unchanged.

- [ ] **Step 2: Run the matrix test RED**

Run: `pnpm test -- test/contact-merge.test.ts -t "re-points the complete contact matrix"`
Expected: FAIL because `executeContactMerge` is missing.

- [ ] **Step 3: Implement deterministic survivor contact planning**

For each source event:

- reuse its existing survivor contact; otherwise mint a new contact id;
- preserve survivor populated fields;
- fill only blank nullable profile fields from source/latest source profile;
- preserve event workflow state for a newly created survivor contact;
- choose the canonical user as survivor user when present, otherwise source user.

Record exact `profileFieldsFilled`, `eventContactsCreated`, and `contactsRetired` counts before writing.

- [ ] **Step 4: Implement relationship consolidation rules**

Participant conflict update:

```ts
const acceptanceRank = { pending: 0, declined: 1, accepted: 2 } as const;
const mergedAcceptance = acceptanceRank[source.acceptanceStatus] > acceptanceRank[target.acceptanceStatus]
  ? source.acceptanceStatus
  : target.acceptanceStatus;
```

Set `isPrimary` to either row's truth, `position` to the smaller position, update target, then delete source conflict. Non-conflicts update `contactId`.

Task conflict: retain `complete > pending_feedback > incomplete`; shallow-union response JSON as `{ ...sourceResponse, ...targetResponse }`; survivor non-null file/completed/reminder values win; due date is the earlier non-null value. Update target, delete source conflict. Non-conflicts update `contactId`.

Custom-value conflict: survivor value remains; delete source conflict after the retired contact snapshot captures it. Non-conflicts update `contactId`.

Pipeline conflict: move all source stage history to target card and delete source card; survivor card's stage/score/rationale remain. Source-only card updates email and live identity snapshot.

Airtable conflict: survivor link remains and source link is deleted after its details enter the audit summary; source-only link updates `recordId`.

- [ ] **Step 5: Assemble one D1 batch**

Create an array of Drizzle statements, ending with audit insert and source-contact deletes, then execute once:

```ts
const statements: unknown[] = [];
// deterministic inserts, updates, consolidation deletes, aliases, audit, source deletes
await db.batch(statements as unknown as Parameters<Db["batch"]>[0]);
```

Do not perform an earlier write while planning. Catch unique violations only to re-read the audit by `(organizationId, idempotencyKey)` and return `replayed: true`; other failures return a generic retry message and leave the batch rolled back.

- [ ] **Step 6: Run the matrix test GREEN**

Run: `pnpm test -- test/contact-merge.test.ts -t "re-points the complete contact matrix"`
Expected: PASS with exact moved/consolidated counts.

- [ ] **Step 7: Write and pass idempotency/failure tests**

Post the same input twice and assert one audit, no extra created contact, identical summary, and `replayed: true` on the second result. Force a stale source after preview and assert no partial writes.

Run: `pnpm test -- test/contact-merge.test.ts -t "replay|stale|rollback"`
Expected: PASS.

- [ ] **Step 8: Commit atomic execution**

```bash
git add app/domain/contact-merge.ts test/contact-merge.test.ts
git commit -m "feat(crm): atomically merge contact references"
```

---

### Task 4: Preserve portal access and canonical submission ownership

**Files:**
- Modify: `app/domain/portal.ts:94-169`
- Modify: `app/routes/portal.tsx:15-55`
- Modify: `test/contact-merge.test.ts`

**Interfaces:**
- Produces: `resolveContactIdentityAlias(db, organizationId, userId)` in `contact-merge.ts`, returning `{ survivorEmail: string; survivorUserId: string | null } | null`.
- Consumes: aliases written by `executeContactMerge`; existing `PortalContext.subjectUserId` contract.

- [ ] **Step 1: Write failing retired-login tests**

After merging two linked users, call `getPortalContext` with the retired user and assert:

```ts
expect(ctx.contact?.email).toBe("ada@example.com");
expect(ctx.subjectUserId).toBe("survivor-user");
expect((await listPortalSubmissions(env, ctx)).rows.map((row) => row.id).sort())
  .toEqual(["source-submission", "survivor-submission"]);
expect((await listPortalTasks(env, ctx)).map((row) => row.id).sort())
  .toEqual(["source-task", "survivor-task"]);
```

Call the bare `/portal` loader as the retired user and expect a redirect to the survivor event portal.

- [ ] **Step 2: Run portal tests RED**

Run: `pnpm test -- test/contact-merge.test.ts -t "retired portal login"`
Expected: FAIL because direct contact lookup ignores aliases.

- [ ] **Step 3: Resolve aliases in direct and bare portal entry**

In `getPortalContext`, after event/portal verification, load the alias using `event.organizationId`. Use `survivorEmail` for contact lookup and `survivorUserId ?? user.id` for `subjectUserId`. Preserve admin preview behavior unchanged.

In `/portal`, look up aliases joined through survivor contacts/events when direct linked/email contact lookup is empty. Use canonical survivor user for the submitted fallback.

- [ ] **Step 4: Run portal tests GREEN plus portal regression suites**

Run: `pnpm test -- test/contact-merge.test.ts test/portal.access.test.ts test/portal.participation.test.ts test/portal.profile-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit portal continuity**

```bash
git add app/domain/contact-merge.ts app/domain/portal.ts app/routes/portal.tsx test/contact-merge.test.ts
git commit -m "fix(portal): follow merged contact identities"
```

---

### Task 5: Build the comparison and confirmation route

**Files:**
- Create: `app/routes/admin.crm.merge.tsx`
- Modify: `app/routes/admin.crm.person.$email.tsx:43-49,54-105,107-178,180-343`
- Modify: `test/contact-merge.test.ts`

**Interfaces:**
- Consumes: `buildContactMergePreview`, `executeContactMerge`, `queryContactMergeHistory`.
- Produces: GET `/admin/crm/merge?source=<email>&survivor=<email>` and POST with `intent=merge`, normalized source/survivor emails, and UUID merge key.

- [ ] **Step 1: Write failing route loader/action tests**

Assert loader returns both people, exact summary, per-event rows, and a UUID merge key. Reverse survivor/source in the query and assert the comparison reverses. Assert action rejects same, malformed, missing, and foreign identities without writes. Assert a valid POST redirects to `/admin/crm/person/<survivor>?merged=1`.

- [ ] **Step 2: Run route tests RED**

Run: `pnpm test -- test/contact-merge.test.ts -t "merge route"`
Expected: FAIL because route module is absent.

- [ ] **Step 3: Implement loader and action**

Loader: `requireAdmin`, `resolveActiveOrg`, normalize query emails, call preview, mint `crypto.randomUUID()`, return `data(..., Server-Timing)`.

Action schema:

```ts
const MergeInput = z.object({
  sourceEmail: z.email(),
  survivorEmail: z.email(),
  mergeKey: z.uuid(),
});
```

Action: authenticate independently, resolve active org, parse `FormData`, call execution with actor from authenticated user, `track("crm.contacts_merged", { orgId, mergeId, replayed })`, redirect on success, return a generic form error on failure.

- [ ] **Step 4: Build the comparison UI from existing primitives**

Compose `Panel`, `IdentityPanel`, `StatusBadge`, `Table`, `Field`, `Select`, `ErrorText`, `ButtonLink`, and `ConfirmButton`. Show:

- source and survivor cards side by side;
- survivor selector that navigates by GET and therefore rebuilds the server preview;
- every summary row, including zero values, grouped as event contacts, program/tasks/files, CRM knowledge, and portal identity;
- per-event row showing reuse vs creation;
- explicit “The retired entry leaves the active directory, but its full row and movement audit remain recorded.” warning;
- hidden source/survivor/mergeKey inputs inside the final `<Form>`;
- `ConfirmButton` prompt naming both emails and `disabled={useBusy()}`.

- [ ] **Step 5: Link the duplicate banner and show merge history**

For each `sameNamePeople` candidate, add:

```tsx
<ButtonLink to={`/admin/crm/merge?source=${encodeURIComponent(candidate.email)}&survivor=${encodeURIComponent(email)}`}>
  Review merge
</ButtonLink>
```

Load the latest 20 audits where the current normalized email is the survivor. Render actor, date, retired email, and exact movement totals under “Merge history,” with an honest `+N older merges` count if capped.

- [ ] **Step 6: Run type generation and route tests GREEN**

Run: `pnpm typegen && pnpm test -- test/contact-merge.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the UI flow**

```bash
git add app/routes/admin.crm.merge.tsx app/routes/admin.crm.person.\$email.tsx app/domain/contact-merge.ts test/contact-merge.test.ts
git commit -m "feat(crm): add duplicate contact merge flow"
```

---

### Task 6: Full verification, live merge, judge loop, review, and PR

**Files:**
- Modify only files identified by verification/review defects.
- PR title: `feat(crm): duplicate-contact merge with audit trail`

**Interfaces:**
- Consumes: the complete branch.
- Produces: verified worktree, pushed branch, open unmerged PR, decision-record PR body, and resolved inline AI review threads.

- [ ] **Step 1: Read the verification oracle and run focused quality checks**

Read `VERIFICATION-CAPABILITIES.md` only now, then run:

```bash
pnpm format
pnpm typegen
pnpm test -- test/contact-merge.test.ts
pnpm verify
```

Fix failures with `superpowers:systematic-debugging`, rerun the failing command, then rerun `pnpm verify` from a clean process.

- [ ] **Step 2: Run the app and create divergent duplicate data**

Invoke the `run` skill, start `pnpm dev:worktree`, and use the real app plus local D1 to create two same-name/different-email contacts. Ensure one owns a submission/task/file/note/pipeline card that the other does not, and both have portal credentials.

- [ ] **Step 3: Live-verify the organizer merge**

In the browser:

1. open the directory and capture the possible-duplicate badge;
2. open the profile banner and “Review merge”;
3. verify the side-by-side identity cards and exact preview counts against direct D1 queries;
4. choose the original primary and confirm in-app;
5. verify the directory count decreases by one and only the survivor profile remains;
6. verify unioned event/session/task/file/note/pipeline history and visible merge audit;
7. repeat the POST request and verify one audit/no duplicate side effects.

- [ ] **Step 4: Live-verify retired portal login**

Log out, sign in with the retired identity, open `/portal`, and verify it redirects into the survivor profile with both divergent submissions and tasks. Confirm the survivor's own login produces the same union.

- [ ] **Step 5: Run one judge-loop round**

Invoke `judge-loop` with suffix `-G3` against the final diff/PR direction. Apply every valid finding, discard invalid findings with a recorded technical reason, then rerun focused tests and `pnpm verify`.

- [ ] **Step 6: Run final review skills**

Invoke `superpowers:requesting-code-review` and `superpowers:verification-before-completion`. Resolve findings by test-first fixes. Run `pnpm verify` after the last code change.

- [ ] **Step 7: Commit final fixes with schema sanction where required**

```bash
git status --short
git diff --check
ALLOW_SCHEMA_CHANGE=1 git add app/db/schema.ts drizzle/migrations SCOPE.md
git add app test docs
git commit -m "feat(crm): duplicate-contact merge with audit trail"
```

Skip the commit only if there are no uncommitted changes; never amend the earlier design commit.

- [ ] **Step 8: Push and create the PR**

Push `feat/contact-merge` and create the PR with exact title `feat(crm): duplicate-contact merge with audit trail`. The decision-record body must include:

- problem/user outcome;
- archive-and-repoint decision and rejected soft-retire/in-place alternatives;
- exact reference matrix and portal alias behavior;
- migration slot `0011`;
- SCOPE OUT-row override dated 2026-08-11;
- `guard-shared-files` expected red because owner-sanctioned schema/migration/SCOPE files changed, requiring owner `--admin` merge;
- focused/full/live verification evidence;
- judge-loop suffix/result;
- explicit “DO NOT MERGE.”

End the body with the repository-required Claude Code attribution.

- [ ] **Step 9: Resolve inline AI review threads**

Poll PR review comments with `gh api`. For each inline AI thread, either fix and reply with the verification command/result or reply with the concrete technical reason for discarding it; resolve the thread. Do not merge.

- [ ] **Step 10: Produce the lane report**

Report: PR URL/number, commits, schema/migration/SCOPE changes, exact reference matrix, test/verify evidence, live organizer and retired-login evidence, judge-loop outcome, AI thread dispositions, expected shared-file CI red, blockers, and “not merged.”
