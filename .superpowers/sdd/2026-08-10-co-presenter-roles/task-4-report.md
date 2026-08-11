# Task 4 report — Portal participant and role editing

## Status

Complete for Task 4. Portal owners can add, relabel, and remove participant role links before the source form closes, with server-derived role policy, real-D1 invariants, idempotent invitation delivery, and deterministic multi-role participation controls. Browser/live-deploy exercise remains the plan's Task 7 verification step; this task was verified through real workerd route actions, D1 state, rendered SSR markup, outbox state, and the full repository check.

## Files

- `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx`
- `app/components/portal/submission-detail-view.tsx`
- `app/components/portal/participation-controls.tsx`
- `app/domain/portal.ts`
- `test/portal.editing.test.ts`
- `.superpowers/sdd/2026-08-10-co-presenter-roles/task-4-report.md`
- `.superpowers/sdd/2026-08-10-co-presenter-roles/progress.md`

Commit subject: `feat(portal): manage participant roles before close` with the required Claude co-author trailer.

## TDD evidence

### Baseline

Before adding Task 4 regressions:

```text
pnpm vitest run test/portal.editing.test.ts test/portal.access.test.ts test/portal.participation.test.ts
Test Files  3 passed (3)
Tests       14 passed (14)
```

### RED

Exact required command before production edits:

```text
pnpm vitest run test/portal.editing.test.ts
Test Files  1 failed (1)
Tests       11 failed | 8 passed (19)
```

The failures independently exposed absent invitation dispatch/dedupe, canonical chairperson/moderator additions, visible disabled-role rejection, role-change minimum enforcement, primary promotion on role change, same-contact distinct roles, persisted-add mail warnings, allowed-role/label loader data, the explicit participant empty state, deterministic multi-role acceptance, and secondary-only acceptance suppression.

A self-review then found that adding a non-speaker to legacy data with speakers but no primary could preserve the broken state. Its focused regression failed before the repair:

```text
pnpm vitest run test/portal.editing.test.ts -t "repairs the single-primary invariant"
Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Expected p_me primary=true; received false
```

The insert and primary repair were moved into one D1 batch; the same focused command then passed.

### GREEN

Final required command:

```text
pnpm vitest run test/portal.editing.test.ts test/portal.access.test.ts test/portal.participation.test.ts
Test Files  3 passed (3)
Tests       28 passed (28)
```

### Formatting and full verification

```text
pnpm format
Formatted 413 files. No fixes applied.

pnpm verify
Test Files  96 passed (96)
Tests       867 passed (867)
```

Map validation, generated Worker/route types, TypeScript, ESLint, CSS lint, and the complete workerd real-D1 suite passed. The first full run correctly stopped on one nullable-contact narrowing and three test-fixture typing errors; all were repaired before two clean full runs. Final output contained only the repository's existing Drizzle sourcemap warning and binary-body `.text()` warnings.

## Behavior evidence

- The server reads only source-form role flags and min/max columns, scoped by form and event. Allowed roles are always `speaker` and `secondary`, plus enabled `chairperson` and `moderator`; a manual or missing form safely defaults to speaker plus secondary.
- Add parses only canonical `ParticipantRole` values, normalizes email, preserves event-level contact identity, records whether the contact already existed, and permits one contact under distinct roles.
- Exact `(submission, contact, role)` duplicates are rejected. Participant IDs are pre-minted; the insert uses `returning()` plus `onConflictDoNothing()` on the exact role-aware key and performs an exact-key re-read after a replay/race.
- Maxima are checked before contact creation. Tests prove disabled chairperson, speaker overflow, and duplicate attempts leave no unintended contact/role mutation.
- A confirmed add and primary repair commit in one D1 batch. Only the confirmed insert is passed to `notifyParticipantAdded()`. Replay leaves one role link and one outbox invitation.
- A simulated Resend 422 leaves the participant linked, records one failed outbox row, and returns a rendered invitation warning instead of rolling back the relationship.
- `set-participant-role` scopes the participant to the owned submission, validates the canonical target and source-form enablement, rejects same-contact/target-role collisions, enforces source minima and target maxima, and batches role change with primary clear/promotion.
- Remove scopes the participant to the submission, rejects the caller's own contact, enforces the removed role's configured minimum, and batches delete with deterministic next-speaker promotion.
- All add/change/remove actions remain behind the existing close-window gate and owned-submission gate. Tests execute all three intents after close and as a foreign event contact; every write is blocked.
- Portal ownership no longer selects an arbitrary `.limit(1)` role link. Ordered `(position, createdAt, id)` selection yields one non-secondary participation control; secondary-only ownership has no acceptance control.
- Confirm/withdraw updates all of the caller's non-secondary links for that submission in one scoped update while leaving secondary acceptance untouched.
- The loader returns canonical allowed roles and human labels. The UI imports `PARTICIPANT_ROLE_LABELS`, renders only policy options (plus a current disabled legacy role when needed to change away), adds inline role controls on removable rows, and renders exact empty-state title “No participants are listed”.
- `useBusy()` disables add inputs/submit, role selectors/saves, remove controls, content save, submission withdrawal, and participation controls while any navigation or fetcher is active.

## Self-review

- **Tenancy/ownership:** submission ownership is event-scoped before form parsing; form policy is form+event scoped; contacts are event scoped; participant mutations include submission scope.
- **Close gate:** add, role change, and remove all execute below `getEditWindow()`; acceptance remains intentionally close-independent.
- **Exact-key idempotency:** contact and participant conflict paths re-read their exact event-email or submission-contact-role key; notification runs only for the returned participant insert.
- **Role policy:** canonical validation and affected-role min/max checks are server-side; no role, limit, event, or submission field is trusted from the form.
- **Primary invariant:** add, role change, and remove leave one primary speaker whenever speakers remain; promotion is ordered and mutation-coupled in `db.batch()`.
- **Mail-after-commit:** participant notification cannot run until the role-aware insert batch returns its confirmed ID; provider failure cannot erase the link.
- **Multi-role acceptance:** ownership reads every matching link in deterministic order; one control represents non-secondary participation and its action updates all non-secondary links consistently.
- **Busy/accessibility:** every mutation has a global busy guard; role selectors have labels, invalid state is surfaced, native confirmation is not used, and Gallery primitives remain intact.
- **Bounded reads:** new queries select only rendered/policy columns; role-link reads are submission/contact scoped and ordered, with no full-contact or full-form projection.

## Plan deviations

- `app/domain/portal.ts` and `app/components/portal/participation-controls.tsx` changed in addition to Task 4's abbreviated file list because the required multi-role ownership/acceptance correction is shared by detail, list, and fetcher callers.
- The primary invariant repair was included in the add batch after the focused self-review regression proved legacy no-primary state otherwise survived a non-speaker add.
- No schema, migration, seed, package, Wrangler, `app/ui`, or CSS file changed. The notification domain was consumed unchanged.
- No browser/live-deploy run was performed in Task 4; the written plan reserves the CFP → portal → organizer → outbox live walk for Task 7. Real route/D1/outbox/SSR checks and full verification are complete.

## Remaining concerns for Task 5

- Organizer attachment still needs role-aware exact-key idempotency, same-contact distinct-role support, and shared participant invitation dispatch.
- Organizer `set-participant-role` must mirror the portal's collision handling, acceptance preservation, and atomic primary promotion without applying source-form portal restrictions where organizer authority differs.
- Organizer controls still need canonical human labels and `useBusy()` while preserving bounded contact-picker reads.
- Accept-domain regressions must continue provisioning every `speaker` role link after organizer role edits.

## Repository state

Task 4 will be committed append-only on `feat/co-presenter-roles`. Nothing was pushed, rebased, amended, reset, force-pushed, merged, or submitted as a PR.
