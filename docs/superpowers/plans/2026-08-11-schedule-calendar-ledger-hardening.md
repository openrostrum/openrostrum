# Schedule Calendar Ledger Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 1,000-row schedule-history ceiling and guarantee atomic, recoverable per-submission calendar sequence claims under concurrent sends.

**Architecture:** Add an append-only `calendar_invite_revisions` coordination ledger plus an event-scoped outbox normalization cursor. Normalize pre-migration outbox history in bounded rowid pages, detect changes from normalized delivered revisions, and allocate sequences with one conditional `INSERT … SELECT … RETURNING` statement backed by unique constraints. `submissions` remains schedule truth; `email_outbox` remains the complete user-visible history.

**Tech Stack:** TypeScript, React Router 7, Drizzle ORM, Cloudflare D1/SQLite, workerd Vitest, iCalendar.

## Global Constraints

- Work in existing branch `fix/schedule-scale-hardening`; do not create another worktree.
- TDD: observe each new regression test fail before implementation.
- D1 has no interactive transactions; correctness must come from single statements, uniqueness, idempotent upserts, and `db.batch()` only.
- Migration slot is exactly `0013`; schema edits are sanctioned with `ALLOW_SCHEMA_CHANGE=1`.
- Do not run `pnpm db:generate`; manually maintain migration SQL, journal, and snapshot metadata.
- Do not delete or prune `email_outbox`; Email history must retain every prior send.
- Keep schedule truth in `submissions`; this is a delivery projection, not event sourcing.
- Run one judge-loop round with suffix `-H4`, resolve inline AI-review threads fix-or-discard-with-written-reason, create the required PR, and do not merge.

## File structure

- `app/db/schema.ts` — declares normalized invite revision and normalization-cursor tables.
- `drizzle/migrations/0013_schedule_calendar_ledger.sql` — creates both tables and constraints/indexes.
- `drizzle/migrations/meta/_journal.json` — registers migration slot 0013.
- `drizzle/migrations/meta/0013_snapshot.json` — records the post-0013 Drizzle schema without generating it.
- `app/domain/schedule-update.ts` — normalizes legacy outbox rows, reads delivered baselines, atomically claims revisions, refreshes stale claims, and associates sends.
- `test/admin.agenda.route.test.ts` — real-D1 scale, concurrency, retry, and stale-state regressions.
- `docs/scenarios/08-emails.yaml` — binds atomic schedule-update behavior as an email scenario.
- `docs/scenarios/walks/08-emails.walk.md` — re-walks all email-scenario steps required by the schema/port gate.

---

### Task 1: Lock the schema contract with a failing real-D1 test

**Files:**
- Modify: `test/admin.agenda.route.test.ts:769-1277`

**Interfaces:**
- Produces: expected SQL contract for `calendar_invite_revisions` and `calendar_invite_ledger_cursors`.

- [ ] **Step 1: Add a schema-contract test before changing schema**

Add a test in the schedule-update describe block that queries `pragma_table_info`, `pragma_index_list`, and `pragma_foreign_key_list` through `env.DB.prepare()`. Assert:

```ts
expect(columnNames).toEqual([
  "id",
  "submission_id",
  "sequence",
  "state_hash",
  "recipient",
  "starts_at",
  "ends_at",
  "location",
  "title",
  "outbox_id",
  "invalid",
  "created_at",
]);
expect(indexNames).toEqual(
  expect.arrayContaining([
    "calendar_invite_revisions_submission_sequence_uq",
    "calendar_invite_revisions_submission_state_uq",
    "calendar_invite_revisions_outbox_idx",
  ]),
);
expect(cursorColumns).toEqual([
  "event_id",
  "last_outbox_rowid",
  "updated_at",
]);
```

Also assert cascading submission/event foreign keys and `SET NULL` for the outbox reference.

- [ ] **Step 2: Run only the schema-contract test and observe RED**

Run:

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "calendar invite ledger schema"
```

Expected: FAIL because both tables are absent.

- [ ] **Step 3: Record the failure output in the lane notes**

Keep the exact failing assertion/error for the final race/migration evidence; do not claim TDD without it.

---

### Task 2: Add migration 0013 and Drizzle schema

**Files:**
- Modify: `app/db/schema.ts:1393-1473`
- Create: `drizzle/migrations/0013_schedule_calendar_ledger.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Create: `drizzle/migrations/meta/0013_snapshot.json`
- Test: `test/admin.agenda.route.test.ts`

**Interfaces:**
- Produces: `calendarInviteRevisions` and `calendarInviteLedgerCursors` Drizzle tables.
- Constraints: unique `(submissionId, sequence)` and `(submissionId, stateHash)`; nullable sequence supports malformed/no-ICS legacy markers without consuming a calendar revision.

- [ ] **Step 1: Declare the two tables in `app/db/schema.ts`**

Use project helpers and existing email enums:

```ts
export const calendarInviteRevisions = sqliteTable(
  "calendar_invite_revisions",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    sequence: integer("sequence"),
    stateHash: text("state_hash").notNull(),
    recipient: text("recipient").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    location: text("location"),
    title: text("title"),
    outboxId: text("outbox_id").references(() => emailOutbox.id, {
      onDelete: "set null",
    }),
    invalid: integer("invalid", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("calendar_invite_revisions_submission_idx").on(t.submissionId),
    unique("calendar_invite_revisions_submission_sequence_uq").on(
      t.submissionId,
      t.sequence,
    ),
    unique("calendar_invite_revisions_submission_state_uq").on(
      t.submissionId,
      t.stateHash,
    ),
    index("calendar_invite_revisions_outbox_idx").on(t.outboxId),
  ],
);

export const calendarInviteLedgerCursors = sqliteTable(
  "calendar_invite_ledger_cursors",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    lastOutboxRowid: integer("last_outbox_rowid").notNull().default(0),
    updatedAt: updatedAt(),
  },
);
```

Because `calendarInviteRevisions` references `emailOutbox`, place it after `emailOutbox` or otherwise avoid a temporal-dead-zone initializer.

- [ ] **Step 2: Hand-author migration 0013**

Create both tables with matching defaults/FKs and these indexes:

```sql
CREATE UNIQUE INDEX `calendar_invite_revisions_submission_sequence_uq`
  ON `calendar_invite_revisions` (`submission_id`,`sequence`);
CREATE UNIQUE INDEX `calendar_invite_revisions_submission_state_uq`
  ON `calendar_invite_revisions` (`submission_id`,`state_hash`);
CREATE INDEX `calendar_invite_revisions_submission_idx`
  ON `calendar_invite_revisions` (`submission_id`);
CREATE INDEX `calendar_invite_revisions_outbox_idx`
  ON `calendar_invite_revisions` (`outbox_id`);
```

Separate Drizzle statements with `--> statement-breakpoint`.

- [ ] **Step 3: Register journal slot 0013 and create its snapshot**

Copy `0009_snapshot.json` to `0013_snapshot.json`, assign a new snapshot `id`, set `prevId` to the 0009 snapshot ID, and add exact table/index/FK metadata matching the migration. Add journal entry `idx: 13`, `tag: "0013_schedule_calendar_ledger"`, `breakpoints: true`. Do not invent 0010–0012 files.

- [ ] **Step 4: Reset local D1 and rerun the schema test**

Run:

```bash
pnpm db:reset
pnpm vitest run test/admin.agenda.route.test.ts -t "calendar invite ledger schema"
```

Expected: migration 0013 applies; schema-contract test passes.

- [ ] **Step 5: Commit the schema slice with the sanctioned guard override**

```bash
ALLOW_SCHEMA_CHANGE=1 git add app/db/schema.ts drizzle/migrations test/admin.agenda.route.test.ts
ALLOW_SCHEMA_CHANGE=1 git commit -m "feat(schedule): add durable calendar revision ledger" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Normalize all legacy history without a total cap

**Files:**
- Modify: `app/domain/schedule-update.ts:1-320`
- Modify: `test/admin.agenda.route.test.ts:1092-1211`

**Interfaces:**
- Produces: `normalizeCalendarInviteHistory(db: Db, eventId: string): Promise<void>`.
- Consumes: `parseIcsAttachment`, stable submission UIDs, `calendarInviteRevisions`, `calendarInviteLedgerCursors`, and immutable SQLite `email_outbox.rowid`.

- [ ] **Step 1: Convert the existing 1,001-history test to the desired result**

Rename the test to `normalizes every matching revision beyond 1,000 rows and advances above the true maximum`. Keep the seeded sequence 5,000 row and 1,000 lower rows, then assert:

```ts
expect(data.event).toMatchObject({
  staleSpeakers: 1,
  scheduleScanTruncated: false,
});
expect(result).toMatchObject({ ok: true });
expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
expect(vevent?.sequence).toBe(5001);
expect((await callLoader()).event?.staleSpeakers).toBe(0);
```

- [ ] **Step 2: Run the converted regression and observe RED**

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "normalizes every matching revision"
```

Expected: loader reports `scheduleScanTruncated: true` and action refuses the send.

- [ ] **Step 3: Implement high-water/keyset normalization**

Replace `LEDGER_SCAN_LIMIT` and `structuredLedgerRows()` with a bounded page size, e.g. `OUTBOX_NORMALIZE_PAGE = 100`. For each call:

1. Read cursor row or zero.
2. Capture `max(email_outbox.rowid)` for the event once as `highWater`.
3. Fetch only acceptance/schedule-update rows where `rowid > cursor AND rowid <= highWater`, ordered by rowid, limited to one page.
4. Parse each row once and associate acceptance IDs from the dedupe key plus all stable UIDs in the attachment.
5. Validate associated IDs belong to the event in D1-safe chunks.
6. Upsert valid revisions in delivery order. Same state updates its latest `outboxId`; a different state at an already-used sequence keeps the earliest revision.
7. Insert a nullable-sequence marker for acceptance-without-ICS; mark malformed non-null acceptance ICS as `invalid`.
8. Advance the event cursor to `highWater` only after all page writes complete. Reprocessing after a crash must be idempotent.

- [ ] **Step 4: Read baselines from the normalized ledger**

Update `computeScheduleChanges()` to call normalization first, then load ledger revisions for candidate IDs in D1-safe chunks. Join linked outbox status logically in the projection:

- tracked = any normalized acceptance/update marker;
- unsafe = any invalid matching acceptance whose outbox status is `sent`;
- delivered baseline = highest sequence linked to current `sent` outbox, keeping the earliest state at equal sequence;
- bounce retry identity = latest linked `bounced` outbox ID;
- next display sequence is no longer authoritative; allocation happens during send.

Delete `LEDGER_SCAN_LIMIT`; return `truncated: true` only for malformed/unprovable history, not row count.

- [ ] **Step 5: Run focused history tests**

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "schedule-update emails|normalizes every matching revision|malformed matching history|bounced"
```

Expected: all focused tests pass, including sequence 5,001.

- [ ] **Step 6: Commit the normalization slice**

```bash
git add app/domain/schedule-update.ts test/admin.agenda.route.test.ts
git commit -m "fix(schedule): normalize unbounded invite history" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Make sequence claims atomic and concurrency-safe

**Files:**
- Modify: `app/domain/schedule-update.ts:367-466`
- Modify: `test/admin.agenda.route.test.ts:1232-1277`

**Interfaces:**
- Produces:
  - `claimScheduleUpdateRevision(db: Db, eventId: string, change: ScheduleChange): Promise<{ revisionId: string; sequence: number; inserted: boolean } | null>`; `null` means the computed slot is stale.
  - `sendScheduleUpdates(...)` renders claimed sequences, never `nextSequence` values inferred during detection.

- [ ] **Step 1: Add a real concurrent claim regression**

Replace the serial replay test with a `Promise.all` race over two identical claim calls for the same submission/state:

```ts
const [left, right] = await Promise.all([
  claimScheduleUpdateRevision(db, event.id, change),
  claimScheduleUpdateRevision(db, event.id, change),
]);
expect(left?.sequence).toBe(1);
expect(right?.sequence).toBe(1);
expect([left?.inserted, right?.inserted].sort()).toEqual([false, true]);
expect(
  await db.select().from(calendarInviteRevisions).where(
    and(
      eq(calendarInviteRevisions.submissionId, "s_keynote"),
      eq(calendarInviteRevisions.sequence, 1),
    ),
  ),
).toHaveLength(1);
```

Then race two `sendScheduleUpdates()` calls using the same computed change set and assert one schedule-update outbox row, one effective send, and one dedupe recovery.

- [ ] **Step 2: Run the concurrency test and observe RED**

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "atomically claims one sequence"
```

Expected: missing export/table use or both callers infer/attempt the same unclaimed sequence.

- [ ] **Step 3: Implement one-statement conditional allocation**

Hash semantic state without bounce identity:

```ts
{
  eventId,
  submissionId,
  recipient: normalizeEmail(change.to),
  start: change.invite.start.toISOString(),
  end: change.invite.end.toISOString(),
  location: change.invite.location,
  title: change.invite.title,
}
```

Use one raw D1 statement shaped as:

```sql
INSERT INTO calendar_invite_revisions (...)
SELECT ..., COALESCE((
  SELECT MAX(sequence)
  FROM calendar_invite_revisions
  WHERE submission_id = ?
), -1) + 1, ...
FROM submissions
WHERE id = ? AND event_id = ?
  AND title = ?
  AND starts_at IS ?
  AND ends_at IS ?
  AND room_id IS ?
ON CONFLICT (submission_id, state_hash) DO NOTHING
RETURNING id, sequence;
```

If no row returns, select by `(submission_id, state_hash)` so the losing identical claimant recovers the winner's revision. If no existing state exists, return `null` because the source slot changed. Catch only the named submission/sequence uniqueness conflict, retry the whole statement from the new maximum a small bounded number of times, and rethrow all unrelated failures.

- [ ] **Step 4: Build and send only from claims**

Claim/refresh before recipient grouping. Use claimed `sequence` in `icsForInvites()`. Keep bounce ID out of `stateHash` but in the grouped outbox dedupe payload. After each sender success/dedupe/failure, resolve the outbox row by dedupe key and associate its ID to every claim in that email; never overwrite a claim with an older outbox attempt.

- [ ] **Step 5: Add a distinct-state competition test**

Start two claims for one submission with different slot snapshots. Assert no duplicate sequence exists. Make one snapshot stale by updating the submission before claim; assert it returns `null`, recomputation claims the current state, and the resulting email carries only the current slot.

- [ ] **Step 6: Run concurrency and progression tests**

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "atomically claims one sequence|distinct schedule states|semantic state|higher SEQUENCE|later schedule revision"
```

Expected: all pass; exactly one ledger insert/outbox send for identical competing state.

- [ ] **Step 7: Commit atomic claims**

```bash
git add app/domain/schedule-update.ts test/admin.agenda.route.test.ts
git commit -m "fix(schedule): claim email sequences atomically" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Preserve failure, bounce, grouping, and scale behavior

**Files:**
- Modify: `app/domain/schedule-update.ts`
- Modify: `test/admin.agenda.route.test.ts:801-1463`

**Interfaces:**
- Consumes: normalized revisions and atomic claim API from Tasks 3–4.
- Produces: stable retry semantics across failed, bounced, deduped, and grouped sends.

- [ ] **Step 1: Add a failed-send claim-reuse regression**

Use the existing email sender/fetch failure harness. Assert a failed first attempt leaves one claimed revision; retry after provider recovery reuses that exact sequence rather than allocating `+1`.

- [ ] **Step 2: Run it and observe RED if association/reuse is incomplete**

```bash
pnpm vitest run test/admin.agenda.route.test.ts -t "reuses an atomic claim after send failure"
```

Expected before final implementation: duplicate claim, advanced sequence, or missing outbox association.

- [ ] **Step 3: Complete retry association semantics**

On sender failure, query the failed outbox row by dedupe key and attach it to the claim. On retry of the same state, return the existing claim. On bounce, salt only the outbox dedupe state with the bounced outbox ID and update the claim to the new attempt after send.

- [ ] **Step 4: Run the full agenda route test file**

```bash
pnpm vitest run test/admin.agenda.route.test.ts
```

Expected: every existing first-send, malformed, recipient-change, bounce, batching, grouping, and sequence-progression test passes.

- [ ] **Step 5: Commit failure-path hardening**

```bash
git add app/domain/schedule-update.ts test/admin.agenda.route.test.ts
git commit -m "test(schedule): cover sequence claim recovery" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Bind the scenario and re-walk the schema/port gate

**Files:**
- Modify: `docs/scenarios/08-emails.yaml`
- Modify: `docs/scenarios/walks/08-emails.walk.md`

**Interfaces:**
- Produces: binding product scenario for unbounded history and concurrent sequence allocation.

- [ ] **Step 1: Add the new tables to `touches.tables`**

Add `calendarInviteRevisions` and `calendarInviteLedgerCursors` to the email scenario touch list.

- [ ] **Step 2: Add EM-S7**

Specify organizer-visible and DB evidence:

1. Seed more than 1,000 prior schedule-update revisions for one event, including a higher old sequence.
2. Move the session and verify Agenda reports one stale speaker rather than incomplete history.
3. Fire two competing schedule-update actions.
4. Verify one new outbox email/state, one claimed sequence above the true historical maximum, and no duplicate `(submission_id, sequence)` rows.
5. Retry/reload and verify the stale banner clears without another send.

- [ ] **Step 3: Re-walk every EM-S1–EM-S7 step**

For each existing step, record either the unchanged concrete SQL/route/outbox artifact or the new ledger artifact. Do not summarize with mechanism names. EM-S7 must include exact uniqueness SQL and the two-action/outbox count evidence.

- [ ] **Step 4: Commit the binding docs**

```bash
git add docs/scenarios/08-emails.yaml docs/scenarios/walks/08-emails.walk.md
git commit -m "docs(emails): bind atomic schedule revisions" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Verify, judge once, and open the PR

**Files:**
- Modify only if verification/judges identify a confirmed issue.

**Interfaces:**
- Produces: green branch, one judge-loop record with suffix `-H4`, decision-record PR, resolved inline AI-review threads.

- [ ] **Step 1: Format and inspect the complete diff**

```bash
pnpm format
git diff --check
git status --short
git diff origin/main...HEAD --stat
```

- [ ] **Step 2: Apply migration to a fresh database and verify schema**

```bash
rm -rf .wrangler/state
pnpm db:migrate
pnpm vitest run test/admin.agenda.route.test.ts -t "calendar invite ledger schema|normalizes every matching revision|atomically claims one sequence"
```

Expected: migration 0013 applies and all three high-signal tests pass.

- [ ] **Step 3: Run full verification**

```bash
pnpm verify
```

Expected: map, typecheck, ESLint, CSS lint, and all workerd D1 tests pass.

- [ ] **Step 4: Invoke exactly one judge-loop round**

Run the project `judge-loop` skill once with suffix `-H4` against the final diff. Fix confirmed findings; discard invalid findings with a written technical reason. Do not start a second round.

- [ ] **Step 5: Re-run verification after any judge fix and commit forward**

```bash
pnpm verify
git add -A
git commit -m "fix(schedule): address H4 judge findings" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Skip the commit only if the judge produced no code/doc changes.

- [ ] **Step 6: Invoke verification-before-completion and requesting-code-review skills**

Use the fresh command output, not prior assumptions. Do not claim end-to-end completion if migration or full verification was not observed.

- [ ] **Step 7: Push and create the required PR**

Title exactly:

```text
fix(schedule): unbounded revision history + atomic email sequence claims
```

PR body must be a decision record containing:

- normalized append-only ledger + rowid high-water cursor choice and why it is not event sourcing;
- atomic single-statement claim, both unique constraints, conflict recovery, stale-state behavior;
- no outbox pruning, so every Email-history row remains reachable;
- migration slot 0013 and `ALLOW_SCHEMA_CHANGE=1` sanction;
- `guard-shared-files`/schema guard CI red is expected by design and requires owner `--admin` merge;
- exact RED→GREEN concurrency and >1,000-history evidence;
- `pnpm verify` result;
- explicit `DO NOT MERGE`/owner action.

End the PR body with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 8: Resolve inline AI-review threads**

Fetch PR review threads with `gh api`. For every inline AI-review thread, either push a fix and reply with the verification evidence, or reply with a written technical reason for discarding it; then resolve the thread. Re-run focused/full checks after fixes. Do not merge.
