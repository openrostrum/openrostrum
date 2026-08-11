# Task 3 report — CFP roles, persistence, and notifications

## Status

Complete. Task 3 is implemented and verified against real D1 route/domain tests. Portal and organizer participant editing remain outside this task.

## Files

- `app/cfp/definition.ts`
- `app/cfp/server.ts`
- `app/cfp/summary.tsx`
- `app/routes/admin.forms.$formId.tsx`
- `app/routes/submit.$eventSlug.$formId.step.participant.tsx`
- `app/routes/submit.$eventSlug.$formId.step.review.tsx`
- `app/routes/submit.$eventSlug.$formId.step.success.tsx`
- `test/admin.forms.editor.route.test.ts`
- `test/cfp-wizard.route.test.ts`

Commit subject: `feat(cfp): persist and notify co-presenter roles` with the required Claude co-author trailer.

## TDD evidence

### Baseline

Before adding Task 3 regressions:

```text
pnpm vitest run test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts test/participant-notifications.test.ts
Test Files  3 passed (3)
Tests       75 passed (75)
```

### RED

Exact command, before production edits:

```text
pnpm vitest run test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts
Test Files  2 failed (2)
Tests       5 failed | 57 passed (62)
```

The five expected failures proved the missing behavior: the form policy stayed `true`, co-participant invitations were absent, an edit-added existing contact received no email, provider failure produced no warning, and persisted same-contact/multiple-role rows could not pass review validation.

### GREEN

Exact required command after implementation and the final assertion update:

```text
pnpm vitest run test/cfp-wizard.route.test.ts test/admin.forms.editor.route.test.ts test/participant-notifications.test.ts
Test Files  3 passed (3)
Tests       82 passed (82)
```

One intermediate focused run correctly exposed an obsolete assertion that expected only one total outbox row after adding Dana during an edit. Task 3 now sends Dana's participant invitation while retaining exactly one submitter confirmation, so the test was tightened to assert both recipient/subject contracts independently.

### Formatting and full verification

```text
pnpm format
Formatted 413 files. No fixes applied.

pnpm verify
Test Files  96 passed (96)
Tests       853 passed (853)
```

Map validation, generated Worker/route types, TypeScript, ESLint, CSS lint, and the complete workerd real-D1 suite passed. The first full run stopped at typecheck on a nullable persisted submitter projection and an accidental doubled role-label import name; both were corrected before the final clean run. Verification emitted only the existing dependency sourcemap and binary-body `.text()` warnings.

## Behavior evidence

- CFP code now imports the canonical `ParticipantRole` and `PARTICIPANT_ROLE_LABELS`; the local role union and label table are gone.
- A real route submission persisted Priya as `speaker`, Marcus as a second `speaker`, and Claire as `chairperson`, in order, with exact role rows.
- Participant reconciliation keys retained links by `${contactId}:${role}`. Same-contact speaker and moderator links round-trip together, retain their participant IDs, and retain `accepted` / `declined` acceptance states.
- New participant IDs are minted before the D1 batch. `writeSubmission()` re-reads those exact IDs after commit and returns only confirmed inserts as `addedParticipants`.
- `wasExistingContact` comes from contact planning before the batch. `isSelf` comes from the committed contact-user/submission-submitter relationship, not the submitted row flag.
- Initial/new duplicate normalized emails are rejected on final submit and draft save before mutation. Tests observe zero submissions, contacts, participants, and outbox rows.
- Existing same-contact/multiple-role rows are explicitly marked only after the server authenticates the submission, form, submitter, participant IDs, persisted email, and common contact. A forged client `persisted` marker is stripped by the payload schema and cannot bypass the write-boundary check.
- Participant notifications run with `Promise.allSettled` only after `db.batch()` completes. First-submit co-participants and edit-added participants receive transactional access mail; the submitter receives only the existing confirmation.
- Replaying the same edit leaves one participant role link and one participant invitation. A replayed create returns no newly added links and does not resend confirmation or participant mail.
- Existing-contact policy `false` suppresses that person's participant email while preserving the committed participant link and provisioning access through the domain service.
- A simulated Resend 422 leaves the participant committed, records a failed outbox row, emits the failure track event, redirects successfully with `notificationWarning=1`, and renders a non-destructive warning on the success page.
- Admin participant settings save and reload `notifyExistingContacts=false`; the selected-column loader exposes it, and the Gallery `OnOffSelect` renders default-on copy exactly: “Notify existing contacts when they are added to a submission.” Both builder Save controls use `useBusy()`.

## Self-review

- **Role preservation:** reconciliation uses contact+role identity; retained rows are updated only for order/primary status, so acceptance state survives. Same-contact distinct roles are neither collapsed nor deleted.
- **Tenancy:** form and submission reads remain event/form/submitter scoped; contact planning is event scoped; confirmed added-link reads join the same event.
- **Bounded reads:** new reads select only required columns; participant input is already capped at 30; per-submission participant reads are naturally bounded by the curated submission participant set.
- **Post-commit mail:** no participant notification call occurs until the D1 batch resolves and confirmed insert metadata is available.
- **Replay/double submit:** pre-minted IDs are reported only after confirmed insert; exact retained role links produce no added metadata on replay; email dedupe remains participant-link based in the domain service.
- **Unhappy paths:** duplicate emails mutate nothing, notification policy suppresses only delivery, and provider failure preserves the stored submission while surfacing an honest warning.

## Plan deviations

Three necessary surface files beyond Task 3's abbreviated file list changed:

- `app/cfp/summary.tsx` and the participant step now consume canonical role labels after removing the CFP-local table.
- The success step renders the required non-destructive participant-email warning carried through the review redirect.

No schema, migration, seed, package, Wrangler, `app/ui`, or CSS file changed. The shared participant-notification domain was consumed unchanged.

## Remaining concerns for Tasks 4/5

- Portal add/change/remove participant actions, close-window enforcement, source-form role limits, and portal controls remain Task 4.
- Organizer role editing, same-contact second-role attachment, primary-speaker promotion, and organizer invitation retry UX remain Task 5.
- Those tasks must preserve the role-aware identity and participant-link email dedupe contracts established here; Task 3 did not touch their routes or tests.
