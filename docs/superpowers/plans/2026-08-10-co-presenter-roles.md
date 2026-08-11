# Co-presenter Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete ABS-11 so submitters and organizers manage multiple submission participants with persisted canonical role labels, usable participant invitations, and role-safe edits.

**Architecture:** Keep `contacts` as event-scoped identity and `participants` as the ordered submission-role junction. Migration 0009 makes junction uniqueness role-aware and adds the form's existing-contact notification policy. A focused notification domain service owns account linking, sentinel access, set-password links, and idempotent transactional mail; CFP, portal, and admin routes call it only after a participant link commits.

**Tech Stack:** TypeScript strict mode, React Router v7 framework mode, Drizzle ORM on Cloudflare D1, Zod 4, Cloudflare workerd Vitest pool, existing `~/ui` primitives, existing EmailSender port.

## Global Constraints

- Core roles are `speaker`, `chairperson`, and `moderator`; `secondary` remains the existing explicit contact-assistance extension. Never add a `co_presenter` enum: another presenter is another `speaker` link.
- Every loader and action self-authenticates; every query is active-event/submission scoped.
- D1 writes use `db.batch()`, never `db.transaction()`.
- Every mutating control uses `useBusy()` and every replay-prone server action is idempotent.
- Public/portal pages remain mobile-friendly; lists and participant sections have explicit empty states.
- Routes compose existing `~/ui` primitives and make no new skin decisions.
- Tests run in workerd against real D1 and assert observable DB/outbox/response outcomes.
- Migration ownership is slot 0009 only. If speaker-crm's 0008 is absent, generated files must still sort as `0009_*`, and the PR records that decision.
- Schema/migration/seed commits use `ALLOW_SCHEMA_CHANGE=1`; shared-file guard CI is expected red and must be disclosed in the PR.
- Branch history is append-only: merge origin/main, never rebase/amend/force-push.
- Do not merge the PR.

## File Structure

- `app/db/schema.ts` — form notification policy and participant-role uniqueness.
- `drizzle/migrations/0009_*.sql`, `drizzle/migrations/meta/0009_snapshot.json`, `drizzle/migrations/meta/_journal.json` — slot-0009 D1 migration artifacts.
- `app/db/constants.ts` — client-safe role labels/options.
- `app/domain/participant-notifications.ts` — account/link/token/email workflow for newly attached participants.
- `app/cfp/server.ts` — role-aware participant synchronization and added-link metadata.
- `app/routes/submit.$eventSlug.$formId.step.review.tsx` — post-commit participant notification dispatch.
- `app/routes/admin.forms.$formId.tsx` — default-on “notify existing contacts” participant setting.
- `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx` — source-form role validation, add/change/remove actions, notification dispatch.
- `app/components/portal/submission-detail-view.tsx` — portal participant role controls, busy guard, empty state.
- `app/routes/admin.submissions_.$id.tsx` — organizer role edits and role-aware/idempotent attach.
- `test/participant-notifications.test.ts` — notification-domain integration tests.
- `test/cfp-wizard.route.test.ts`, `test/admin.forms.editor.route.test.ts`, `test/portal.editing.test.ts`, `test/admin.submissions.detail.route.test.ts`, `test/accept.domain.test.ts` — route/domain regressions.
- `docs/scenarios/walks/2026-08-10-co-presenter-roles.walk.md` — concrete design-time re-walk for every affected scenario step.

---

### Task 1: Schema contract and migration 0009

**Files:**
- Modify: `app/db/schema.ts:319-377,719-762`
- Modify: `app/db/constants.ts:52-61`
- Create: `test/participant-role.schema.test.ts`
- Create/modify: `drizzle/migrations/0009_*.sql`, `drizzle/migrations/meta/0009_snapshot.json`, `drizzle/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `forms.notifyExistingContacts: boolean` with D1 column `notify_existing_contacts`, default true.
- Produces: role-aware unique key `(participants.submissionId, participants.contactId, participants.role)`.
- Produces: `PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string>` in the client-safe constants module.

- [ ] **Step 1: Write failing real-D1 schema tests**

Create `test/participant-role.schema.test.ts` with cases that insert one speaker link, reject a replay of the same `(submission, contact, speaker)` tuple, accept `(submission, contact, moderator)`, and verify a newly inserted form reads `notifyExistingContacts === true`.

```ts
await db.insert(participants).values({ submissionId: "s1", contactId: "c1", role: "speaker" });
await expect(db.insert(participants).values({ submissionId: "s1", contactId: "c1", role: "speaker" })).rejects.toThrow();
await expect(db.insert(participants).values({ submissionId: "s1", contactId: "c1", role: "moderator" })).resolves.toBeDefined();
expect((await db.select().from(forms).where(eq(forms.id, "f1")))[0]?.notifyExistingContacts).toBe(true);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run test/participant-role.schema.test.ts`

Expected: FAIL because `notifyExistingContacts` is absent and current uniqueness rejects the second role.

- [ ] **Step 3: Implement the schema and client-safe role labels**

Add:

```ts
notifyExistingContacts: integer("notify_existing_contacts", { mode: "boolean" }).notNull().default(true)
```

Replace `participants_submission_contact_uq` with:

```ts
unique("participants_submission_contact_role_uq").on(t.submissionId, t.contactId, t.role)
```

Add to `app/db/constants.ts`:

```ts
export type ParticipantRole = (typeof PARTICIPANT_ROLE)[number];
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  speaker: "Speaker",
  chairperson: "Chairperson",
  moderator: "Moderator",
  secondary: "Secondary contact",
};
```

- [ ] **Step 4: Coordinate and generate exactly migration 0009**

First run `git fetch origin main && git merge --no-edit origin/main` and inspect `drizzle/migrations`. If 0008 exists, run `pnpm db:generate --name co_presenter_roles` normally and verify it emits 0009. If 0008 is absent, run the generator once, rename the generated SQL/snapshot/tag from 0008 to 0009, set the journal entry `idx` to 9, and preserve generated SQL unchanged apart from the tag/file numbering. Record “0008 absent at generation; reserved 0009” in the PR.

- [ ] **Step 5: Reset D1 and run the focused test GREEN**

Run: `pnpm db:reset && pnpm vitest run test/participant-role.schema.test.ts`

Expected: migrations 0000–0009 apply; all schema tests pass.

- [ ] **Step 6: Commit the schema contract**

```bash
ALLOW_SCHEMA_CHANGE=1 git add app/db/schema.ts app/db/constants.ts drizzle/migrations test/participant-role.schema.test.ts
ALLOW_SCHEMA_CHANGE=1 git commit -m "feat(db): model participant role links"
```

Include the required co-author trailer.

---

### Task 2: Participant access and notification domain

**Files:**
- Create: `app/domain/participant-notifications.ts`
- Create: `test/participant-notifications.test.ts`

**Interfaces:**
- Consumes: `forms.notifyExistingContacts`, EmailSender, `mintSentinelHash()`, `hasSetPassword()`, portal URL helpers, `passwordResets`.
- Produces:

```ts
export interface AddedParticipant {
  participantId: string;
  contactId: string;
  wasExistingContact: boolean;
  isSelf: boolean;
  role: ParticipantRole;
}

export async function notifyParticipantAdded(
  db: Db,
  env: Env,
  input: {
    added: AddedParticipant;
    event: Pick<Event, "id" | "name" | "slug">;
    submission: Pick<Submission, "id" | "title" | "formId" | "submitterId">;
    origin: string;
  },
): Promise<{ sent: boolean; deduped: boolean; warning?: string }>;
```

- [ ] **Step 1: Write failing notification tests**

Cover four independent outcomes:

1. A new unlinked co-speaker gets a sentinel `users` row, linked `contacts.userId`, one unused null-org `password_resets` token, and one outbox email containing `/set-password/`.
2. An existing contact with a credentialed user gets one email containing the portal URL and no new reset token.
3. An existing contact on a form with `notifyExistingContacts=false` gets no email.
4. Replaying the same `participantId` leaves one outbox row.

Assert `kind` indirectly through suppression exemption: seed an email suppression for the recipient and verify the participant invitation still lands.

- [ ] **Step 2: Run the domain test RED**

Run: `pnpm vitest run test/participant-notifications.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused service**

The service must:

- return immediately for `added.isSelf`;
- read the contact with selected columns only;
- read the source form's notification flag when `wasExistingContact` is true;
- find and link an existing normalized-email user;
- otherwise create a speaker sentinel user and link it to the contact;
- derive a stable set-password token from `participantId` and `userId`, insert with `onConflictDoNothing`, null `organizationId`, and 14-day expiry;
- build a portal URL for credentialed users and a set-password URL otherwise;
- call EmailSender with `kind:"transactional"` and `dedupeKey: participant-added:${participantId}`;
- escape all person/event/submission strings interpolated into HTML;
- catch no provider error internally: callers decide whether a persisted add returns a warning while outbox history carries the failure.

- [ ] **Step 4: Run tests GREEN**

Run: `pnpm vitest run test/participant-notifications.test.ts`

Expected: all four cases pass against real D1.

- [ ] **Step 5: Commit the domain unit**

```bash
git add app/domain/participant-notifications.ts test/participant-notifications.test.ts
git commit -m "feat(email): notify newly added participants"
```

Include the required co-author trailer.

---

### Task 3: CFP roles, persistence, and notifications

**Files:**
- Modify: `app/cfp/definition.ts:39-68,332-337`
- Modify: `app/cfp/server.ts:540-596,616-869,895-984`
- Modify: `app/routes/submit.$eventSlug.$formId.step.review.tsx:113-265`
- Modify: `app/routes/admin.forms.$formId.tsx` participant settings loader/action/UI
- Modify: `test/cfp-wizard.route.test.ts`
- Modify: `test/admin.forms.editor.route.test.ts`

**Interfaces:**
- Consumes: `AddedParticipant`, `notifyParticipantAdded()`.
- Produces: successful `writeSubmission()` results include `addedParticipants: AddedParticipant[]` and use participant identity key `${contactId}:${role}` rather than contact alone.

- [ ] **Step 1: Write failing CFP and builder tests**

Add tests that:

- submit Priya as `speaker`, Marcus as second `speaker`, and Claire as `chairperson`; assert three participant rows and exact roles;
- edit the existing submission and add Marcus; assert one added-to-submission email and no duplicate on replay;
- reject duplicate normalized participant emails with no DB mutation;
- save/reload `notifyExistingContacts=false` from the participant-settings step.

- [ ] **Step 2: Run the focused tests RED**

Run: `pnpm vitest run test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts`

Expected: notification/policy assertions fail.

- [ ] **Step 3: Return added-link metadata from `writeSubmission()`**

Pre-mint participant IDs for inserts, preserve existing rows by `(contactId, role)`, and return only newly inserted links:

```ts
{ ok: true, submissionId, created, previousStatus, addedParticipants }
```

Do not mark the signed-in self row for notification. Preserve acceptance state on retained links. A role change is represented as deleting the old role link and inserting the new one only when the wizard actually changed it.

- [ ] **Step 4: Dispatch notifications after the D1 batch commits**

In the review action, call `notifyParticipantAdded()` for each returned link. Use `Promise.allSettled`; track failures without turning a stored submission into a failed form. Confirmation email remains submitter-only.

- [ ] **Step 5: Persist the form notification setting**

Derive the field through the route's existing insert schema, include it in loader/action projections, and render the participant-step toggle with default-on copy: “Notify existing contacts when they are added to a submission.”

- [ ] **Step 6: Run focused tests GREEN**

Run: `pnpm vitest run test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts test/participant-notifications.test.ts`

Expected: all pass.

- [ ] **Step 7: Commit the CFP slice**

```bash
git add app/cfp app/routes/submit.* app/routes/admin.forms.'$formId'.tsx test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts
git commit -m "feat(cfp): persist and notify co-presenter roles"
```

Include the required co-author trailer.

---

### Task 4: Portal participant and role editing

**Files:**
- Modify: `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx`
- Modify: `app/components/portal/submission-detail-view.tsx`
- Modify: `test/portal.editing.test.ts`

**Interfaces:**
- Consumes: role labels, `notifyParticipantAdded()`, source-form role config.
- Produces: portal intents `add-participant`, `set-participant-role`, `remove-participant` with close-date gate and role-limit enforcement.

- [ ] **Step 1: Write failing portal tests**

Add real-D1 tests for:

- adding an enabled chairperson and moderator before close;
- refusing a disabled source-form role and refusing speaker max overflow;
- changing a co-speaker to moderator while promoting/retaining a valid primary speaker;
- rejecting duplicate same-role email and allowing idempotent replay without duplicate mail;
- rejecting all three intents after close and from a foreign portal user;
- rendering loader data with human role labels and the empty participant state.

- [ ] **Step 2: Run the portal test RED**

Run: `pnpm vitest run test/portal.editing.test.ts`

Expected: role additions/changes fail under the current `speaker|secondary` schema.

- [ ] **Step 3: Add server-side allowed-role and limit helpers**

Load only the source form's role flags/min/max. Compute allowed roles as `speaker`, enabled `chairperson`, enabled `moderator`, plus `secondary`. Validate role membership and the resulting per-role counts on add/change/remove. Never trust the `<select>`.

- [ ] **Step 4: Implement add/change/remove invariants and notification**

Pre-mint the participant id, insert with `onConflictDoNothing`, classify a duplicate honestly, call `notifyParticipantAdded()` only after a confirmed insert, and return a warning if mail fails. For role changes, batch the role update with primary clear/promotion when required.

- [ ] **Step 5: Complete the portal UI**

Use `PARTICIPANT_ROLE_LABELS`, render allowed-role options, add an inline role-change form for removable rows, show an explicit “No participants are listed” state, and use `useBusy()` to disable add/change/remove controls during any in-flight request.

- [ ] **Step 6: Run portal tests GREEN**

Run: `pnpm vitest run test/portal.editing.test.ts test/portal.access.test.ts test/portal.participation.test.ts`

Expected: pass.

- [ ] **Step 7: Commit the portal slice**

```bash
git add app/routes/portals.* app/components/portal/submission-detail-view.tsx test/portal.editing.test.ts
git commit -m "feat(portal): manage participant roles before close"
```

Include the required co-author trailer.

---

### Task 5: Organizer role editing and role-aware attachment

**Files:**
- Modify: `app/routes/admin.submissions_.$id.tsx`
- Modify: `test/admin.submissions.detail.route.test.ts`
- Modify: `test/accept.domain.test.ts`

**Interfaces:**
- Consumes: role-aware unique key, labels, notification service.
- Produces: admin intent `set-participant-role`; role-aware attach permits one contact under two different roles but rejects the same role twice.

- [ ] **Step 1: Write failing organizer tests**

Add tests that:

- attach Ada as speaker, then moderator, yielding two role links to one contact;
- replay speaker attach and keep two total links (not three);
- change the primary speaker's role and atomically promote the next speaker;
- reject a role change that collides with an existing same-contact/same-role link;
- add a new contact, emit one usable participant invitation, and dedupe replay;
- preserve accept provisioning for every `speaker` role link.

- [ ] **Step 2: Run focused tests RED**

Run: `pnpm vitest run test/admin.submissions.detail.route.test.ts test/accept.domain.test.ts`

Expected: role-aware attach/change and notification cases fail.

- [ ] **Step 3: Make attachment identity role-aware**

Replace contact-only sets with `${contactId}:${role}` keys. Pre-mint participant IDs so each confirmed insert has a stable notification key. Return the inserted link metadata from `attachContacts()` and classify races by re-reading the exact role key.

- [ ] **Step 4: Implement `set-participant-role`**

Scope the participant to this submission, validate `PARTICIPANT_ROLE`, detect target-role collision, and use one `db.batch()` for role update plus primary promotion/clear. Track event/submission/participant/from/to.

- [ ] **Step 5: Complete organizer UI**

Render `PARTICIPANT_ROLE_LABELS[p.role]` and an inline role selector/save action per row. Replace the route's hand-rolled navigation busy check with `useBusy()` while touching this surface. Preserve bounded contact-picker truncation and existing empty state.

- [ ] **Step 6: Dispatch invitation after confirmed attaches**

Use the shared notification service for newly inserted links only. For manual submissions (no source form), notify by default. A provider failure returns “Participant attached, but the invitation failed — see Email history and retry from the contact record” without deleting the participant.

- [ ] **Step 7: Run focused tests GREEN**

Run: `pnpm vitest run test/admin.submissions.detail.route.test.ts test/admin.submissions.decisions.route.test.ts test/accept.domain.test.ts`

Expected: pass.

- [ ] **Step 8: Commit the organizer slice**

```bash
git add app/routes/admin.submissions_.'$id'.tsx test/admin.submissions.detail.route.test.ts test/accept.domain.test.ts
git commit -m "feat(submissions): edit participant roles"
```

Include the required co-author trailer.

---

### Task 6: Scenario design-time re-walk

**Files:**
- Create: `docs/scenarios/walks/2026-08-10-co-presenter-roles.walk.md`

**Interfaces:**
- Consumes: final schema, route intents, notification dedupe keys, and test names.
- Produces: concrete artifact coverage for every step in scenarios 02, 03, 04, 05, 06, 08, and 09.

- [ ] **Step 1: Build the re-walk matrix**

For each scenario and every numbered step, record one row:

```md
| Scenario.step | Participant/form impact | Concrete artifact |
| FB-S4.7 | affected | `INSERT INTO participants (... role='speaker' ...)`; fifth add rejected by role-count validation before batch |
| RV-S1.3 | unchanged | Pagination query is unchanged; participant uniqueness and form notification columns are not read by this step |
```

Never pre-filter steps. At affected steps include exact SQL columns, route intent, email recipient/dedupe key, or loader projection. At unchanged steps state why the artifact is unaffected.

- [ ] **Step 2: Check completeness mechanically**

Run this completeness check and record its total in the walk header:

```bash
python3 - <<'PY'
import pathlib, re
files = ["02-form-builder", "03-public-cfp", "04-speaker-portal", "05-review-accept", "06-agenda", "08-emails", "09-cross-module-seams"]
walk = pathlib.Path("docs/scenarios/walks/2026-08-10-co-presenter-roles.walk.md").read_text()
expected = []
for stem in files:
    text = pathlib.Path(f"docs/scenarios/{stem}.yaml").read_text()
    for block in re.split(r"\n  - id: ", text)[1:]:
        scenario = block.splitlines()[0].strip()
        steps = block.split("    steps: |", 1)[1].split("    success_signals:", 1)[0]
        expected.extend(f"{scenario}.{n}" for n in re.findall(r"^      (\d+)\.", steps, re.M))
missing = [key for key in expected if f"| {key} |" not in walk]
assert not missing, f"missing walk rows: {missing}"
print(f"walk covers {len(expected)} numbered steps")
PY
```

Then search for placeholder markers or rows that say only “unchanged” and replace each with a concrete artifact or reason.

- [ ] **Step 3: Commit the re-walk**

```bash
git add docs/scenarios/walks/2026-08-10-co-presenter-roles.walk.md
git commit -m "docs: re-walk participant role scenarios"
```

Include the required co-author trailer.

---

### Task 7: Full verification, judge convergence, PR, and AI review resolution

**Files:**
- Modify only files required by verified findings.
- Create: judge artifacts with suffix `-laneP` and the judge-loop disposition log at the skill-prescribed paths.

**Interfaces:**
- Consumes: completed implementation and tests.
- Produces: verified branch, PR decision record, resolved inline AI-review threads; does not merge.

- [ ] **Step 1: Merge latest main append-only and resolve forward**

Run: `git fetch origin main && git merge --no-edit origin/main`

If 0008 lands now, reconcile migration journal/snapshots without renumbering this lane away from 0009. Never rebase.

- [ ] **Step 2: Run formatting and targeted regression suite**

Run:

```bash
pnpm format
pnpm db:reset
pnpm vitest run test/participant-role.schema.test.ts test/participant-notifications.test.ts test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts test/portal.editing.test.ts test/admin.submissions.detail.route.test.ts test/accept.domain.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run full verification**

Run: `pnpm verify`

Expected: typecheck, ESLint, CSS lint, map checks, and all workerd tests pass.

- [ ] **Step 4: Exercise the running app end to end**

Start `pnpm dev:worktree`; use the project run/browser oracle to:

1. open the seeded CFP;
2. submit with primary speaker plus co-speaker and moderator;
3. query local D1 for exact names/roles;
4. query `email_outbox` for the co-speaker invitation and open its set-password/portal link;
5. add/change a participant role from portal before close;
6. open organizer submission detail and verify names/labels;
7. backdate close and prove portal mutation is blocked;
8. replay an add POST and prove participant/outbox counts remain unchanged.

Record actual URLs, SQL counts, and observed responses in the lane report; unit tests alone are insufficient.

- [ ] **Step 5: Invoke `judge-loop` exactly as required**

Use fresh judges, artifact suffix `-laneP`, maximum three rounds, and maintain the disposition log. Fix confirmed findings with tests; discard invalid findings only with a written technical reason. Re-run targeted tests and `pnpm verify` after the final round.

- [ ] **Step 6: Commit final verified fixes with schema sanction when needed**

Use append-only fix commits. Any commit containing `app/db/schema.ts`, `drizzle/`, or `drizzle/seed.sql` runs with `ALLOW_SCHEMA_CHANGE=1`.

- [ ] **Step 7: Push and create the PR with a decision-record body**

Invoke `create-pr`. The body must state:

- user outcomes and unhappy paths;
- canonical role decision (co-presenter = another speaker role link);
- migration 0009 generation state and whether 0008 was absent;
- schema sanction and expected shared-file guard red requiring owner `--admin` merge;
- notification recipients/idempotency policy;
- scenario re-walk coverage;
- exact targeted/full/live verification evidence;
- judge-loop disposition summary;
- forced disclosure: the branch can be deleted losing nothing because all decisions are in the body.

Do not merge.

- [ ] **Step 8: Resolve every inline AI-review thread**

Use `gh` to list review threads and check status. For each inline AI finding: fix and push a new commit, or reply with a verified written discard reason; then resolve the thread. Re-run the smallest regression test for each fix plus `pnpm verify` after all threads. If review is still pending, poll the PR checks/reviews at a reasonable interval until every inline AI thread has a disposition.

- [ ] **Step 9: Print the full lane report**

Report branch/PR, commits, user-visible behavior, migration/schema notes, exact test/live evidence, judge dispositions, AI thread dispositions, known blockers, and the explicit “not merged” state.
