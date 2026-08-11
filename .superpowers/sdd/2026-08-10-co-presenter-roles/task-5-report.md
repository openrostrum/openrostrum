# Task 5 report — Organizer role editing and role-aware attachment

## Status

Complete for Task 5’s defined scope. Organizers can attach one event contact under distinct canonical roles, edit role links inline, and invite only confirmed new links while preserving primary-speaker and acceptance invariants. Verification used real workerd route actions, D1 state, SSR markup, local/failed-provider outbox state, the required focused suites, and the full repository check. Browser/live-deploy exercise remains the plan’s Task 7 gate and was not performed here.

## Files

- `app/routes/admin.submissions_.$id.tsx`
- `app/domain/participant-notifications.ts`
- `test/admin.submissions.detail.route.test.ts`
- `test/accept.domain.test.ts`
- `test/participant-notifications.test.ts`
- `.superpowers/sdd/2026-08-10-co-presenter-roles/task-5-report.md`
- `.superpowers/sdd/2026-08-10-co-presenter-roles/progress.md`

Commit subject: `feat(submissions): edit participant roles` with the required Claude co-author trailer.

## TDD evidence

### Baseline

Before Task 5 regressions:

```text
pnpm vitest run test/admin.submissions.detail.route.test.ts test/accept.domain.test.ts
Test Files  2 passed (2)
Tests       47 passed (47)
```

### RED

Exact required command before production edits:

```text
pnpm vitest run test/admin.submissions.detail.route.test.ts test/accept.domain.test.ts
Test Files  1 failed | 1 passed (2)
Tests       9 failed | 47 passed (56)
```

The failures exposed contact-only attachment identity, absent post-insert invitations/access, missing source-form/manual notification behavior, absent provider-failure warning, unknown role-change intent, missing collision/primary handling, and raw/missing organizer role controls. The accept regression already passed because the existing accept domain correctly filtered `speaker` role links.

The explicit manual-null domain contract also failed before its production change:

```text
pnpm vitest run test/participant-notifications.test.ts
Test Files  1 failed (1)
Tests       2 failed | 20 passed (22)
```

A self-review then found that a stale `isPrimary=true` on a non-speaker could displace an existing valid primary when that row changed to speaker. Its regression failed before repair:

```text
pnpm vitest run test/admin.submissions.detail.route.test.ts -t "stale non-speaker primary"
Test Files  1 failed (1)
Tests       1 failed | 32 skipped (33)
Expected existing speaker primary=true; received false
```

The primary selection was corrected to consider only previously valid speaker primaries; the same focused command then passed.

### GREEN

Final required regression command:

```text
pnpm vitest run test/admin.submissions.detail.route.test.ts test/admin.submissions.decisions.route.test.ts test/accept.domain.test.ts test/participant-notifications.test.ts
Test Files  4 passed (4)
Tests       91 passed (91)
```

### Formatting and full verification

```text
pnpm format
Formatted 413 files. No final fixes applied.

pnpm verify
Test Files  96 passed (96)
Tests       879 passed (879)
```

Map checks, generated Worker/route types, TypeScript, ESLint, CSS lint, and the complete workerd real-D1 suite passed. The first full run stopped on one D1 batch tuple typing issue and the generated literal type for the test sender; both were repaired before the final clean run. Final output contained only the repository’s existing Drizzle sourcemap and binary-body `.text()` warnings.

## Behavior evidence

- Organizer attachment identity is exactly `${contactId}:${role}`. One contact can hold speaker and moderator links; replaying the exact speaker key leaves two links and two role-link invitations rather than creating a third link or mail.
- Existing-contact attachment validates every contact against the active event. New-contact creation normalizes email, handles an event-email insert race by exact re-read, and never invents a second contact.
- `attachContacts()` pre-mints participant IDs, computes new positions after the current maximum without reordering existing rows, inserts through `returning()`, and returns `AddedParticipant` metadata only for confirmed inserted IDs.
- A conflict that occurs after the pre-read is classified by re-reading `(submissionId, contactId, role)` exactly. A non-exact conflict fails rather than being mislabeled as an idempotent replay.
- Attachment insertion and current-primary corrections batch together; a post-race invariant repair leaves exactly one primary speaker whenever speakers exist and clears primary from non-speakers.
- `set-participant-role` validates the canonical enum, scopes the target to this submission, rejects same-contact target-role collisions, preserves position and acceptance state, and applies role plus primary clear/promotion in one D1 batch.
- Changing the primary speaker away from speaker promotes the next `(position, createdAt, id)` speaker. Changing a non-speaker to speaker promotes it only when no valid speaker primary exists; stale non-speaker primary flags cannot displace a valid primary.
- Removal now uses the same deterministic participant ordering and batches deletion with primary normalization.
- Existing contacts obey the persisted source form’s `notifyExistingContacts` flag. Suppressed delivery still provisions the account and set-password token.
- Manual submissions persist `formId=null` and notify existing contacts by default through the optional `admin-manual-submission` context. The service accepts that context only after verifying the persisted submission really has `formId=null`; form-sourced misuse fails before account or mail writes.
- New contacts receive a sentinel speaker account, linked contact, active null-organization set-password token, and transactional invitation. Exact attachment replay leaves one participant and one outbox row.
- Notifications run only after confirmed participant insertion. `Promise.allSettled` preserves every confirmed link if one delivery fails. A simulated Resend 503 records a failed Email history row and returns exactly: “Participant attached, but the invitation failed — see Email history and retry from the contact record”.
- The organizer table and both attach controls render `PARTICIPANT_ROLE_LABELS`. Every participant has an inline canonical role selector and Save action.
- The route uses shared `useBusy()` instead of `useNavigation()` and disables touched mutation controls during any navigation/fetcher request.
- Contact-picker cap, A→Z ordering, truncation disclosure, client search, empty participant state, admin/event authorization, and existing double-submit behavior remain intact. The participant contact loader projection was narrowed to the three rendered fields.
- Accept production code was unchanged: the regression proves each speaker role link receives onboarding work once while the same contacts’ moderator/chairperson links receive none.

## Self-review

- **Event/submission scope:** active-event submission lookup precedes form parsing; contact reads carry `eventId`; every participant read/write carries the authorized submission ID.
- **Exact-key replay:** pre-read and race classification both include role; notification consumes only `returning()`-confirmed IDs.
- **Mail after commit:** insert/primary batch resolves before notification starts; replay metadata is empty and cannot invoke mail.
- **Provider failure:** attachment and access state survive; failed outbox history and exact interactive warning are both observable.
- **Collision:** role editing compares target contact plus canonical target role within the same submission before the batch.
- **Primary invariant:** attachment, role change, and removal leave one ordered speaker primary and no non-speaker primary; the stale-primary regression covers the unsafe legacy shape.
- **Acceptance preservation:** role updates never write `acceptanceStatus`.
- **Bounded reads:** event contacts remain capped with an honest truncation signal; participant/contact projections select only fields used by the mutation/UI.
- **Busy controls:** existing route mutation buttons now share `useBusy()`; new role selectors/save and attach role/contact controls are disabled while busy.
- **Accept semantics:** provisioning still filters `participants.role = 'speaker'`; no chairperson, moderator, or secondary link is treated as a speaker.

## Plan deviations

- `app/domain/participant-notifications.ts` and its focused test changed in addition to the Task 5 primary file list because the shared service previously treated every `formId=null` existing-contact notification as invalid. The narrow optional admin-manual context was therefore genuinely required; `wasExistingContact` remains truthful.
- The accept domain implementation did not change because its speaker-role filter was already correct; only a same-contact multi-role regression was added.
- The organizer participant contact relation was narrowed from a full contact row to rendered columns while touching the loader, satisfying the bounded-read rule without changing output.
- No schema, migration, seed, package, Wrangler, `app/ui`, CSS, portal, CFP, or accept-domain production file changed.
- No browser/live-deploy run was performed; the written plan reserves the CFP → portal → organizer → outbox live walk for Task 7.

## Task 6/7 concerns

- Task 6’s re-walk must record the organizer `set-participant-role` intent, role-aware participant key, confirmed-insert notification boundary, manual-null context, failed-outbox warning, and unchanged accept speaker filter at every selected scenario step.
- Task 7 must exercise speaker → moderator same-contact attachment, exact speaker replay, inline primary role change, invitation link usability, participant/outbox counts, and organizer labels in the running app.
- Task 7 should re-run full verification after merging current main append-only and after any judge/review repair; this lane intentionally did not merge main, invoke judge-loop, push, or open a PR.

## Repository state

Task 5 is ready for its required append-only commit on `feat/co-presenter-roles`. Nothing was pushed, rebased, amended, reset, force-pushed, merged, or submitted as a PR.
