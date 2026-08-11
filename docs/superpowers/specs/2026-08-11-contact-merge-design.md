# Duplicate-contact merge design

**Date:** 2026-08-11
**Owner:** lane G3 (`contact-merge`)
**Scope:** CRM-06 organization-level duplicate merge

## Outcome

An organizer can start from a same-name duplicate warning, compare two directory identities, choose the primary identity, preview every affected relationship, and merge once. The directory then contains one person carrying the union of event/session/task/file/note/pipeline history. The retired identity remains auditable, and its portal credentials resolve to the survivor.

## Chosen architecture: archive and re-point

Retired contacts leave the active `contacts` table after their full rows are captured in an immutable merge audit. This produces the required one-row directory outcome without making every contact query filter soft-deleted rows.

Two alternatives were rejected:

- Keeping retired rows in `contacts` would require retirement predicates in every roster, portal, CFP, API, sync, and file query. One missed predicate would leak a duplicate.
- Rewriting loser rows and users in place would erase provenance and create unsafe email/user uniqueness conflicts.

## Data model

### `contact_merges`

One append-only audit row per completed merge:

- organization, source email, survivor email
- actor id/name and timestamp
- client-minted idempotency key
- the exact executed movement summary
- complete snapshots of retired contact rows

The idempotency key is unique within the organization. A replay returns the recorded result.

### `contact_identity_aliases`

Maps each retired portal user in an organization to the surviving email and canonical user. Portal resolution follows the alias before loading event contact/submission ownership, so either prior login reaches the survivor.

### `contact_field_values`

Stores event-contact custom field values as a unique `(contactId, fieldId)` relationship. The merge moves source-only values and preserves survivor values when both contacts have the same field.

## Preview

The merge route accepts two normalized emails that must both resolve inside the active organization. It renders:

1. side-by-side identity/profile comparison;
2. an explicit survivor selector;
3. per-event source and survivor contact rows, including rows that must be created;
4. counts for participant links, task assignments, files, custom values, notes, pipeline enrollment/history, portal users/invites, and submitter-owned submissions;
5. conflict/consolidation counts where both identities already own the same unique relationship;
6. an irreversible-collapse warning and in-app two-step confirmation.

Changing the survivor rebuilds the preview; execution recomputes the same plan server-side rather than trusting preview counts.

## Merge policy

- The chosen survivor's populated profile values win.
- Blank survivor fields are filled from the retired event row, then the latest source profile.
- In an event where only the source exists, a new survivor contact row is created with the chosen identity plus source event workflow state.
- Participant duplicates consolidate. Primary status is ORed, the earliest position wins, and acceptance keeps the strongest state (`accepted`, then `declined`, then `pending`).
- Task duplicates consolidate. Completion state and timestamps are preserved, JSON responses are unioned without overwriting survivor keys, and source-only files/dates fill blanks.
- Source-only custom values move; conflicting survivor values remain. Both values remain visible in the audit snapshot/summary.
- Files re-point to the event's survivor contact; R2 objects do not move.
- CRM notes move to the survivor email.
- If only the source has a pipeline card, it becomes the survivor card. If both do, the chosen survivor card remains and all source stage-history rows move to it.
- Submission participant links move through `participants.contactId`. Source submitter ownership moves to the canonical survivor user where both accounts exist.
- Existing target portal users remain canonical. Source users receive aliases; if the survivor has no account, the source account becomes canonical. Existing source invite/reset tokens therefore continue to land on the merged survivor.
- Historical email logs and suppressions do not change: they describe sends/compliance for a real address, not an active contact reference.

## Atomicity and failure behavior

The server validates organization ownership in both directions, builds a deterministic merge plan, then submits all inserts/updates/deletes and the audit insert in one D1 `db.batch()`. No external R2/email/Airtable network call occurs in the request.

The batch writes the audit and deletes source contacts only after every active reference has a replacement. Any constraint failure rolls back the whole batch. Missing/foreign identities, same-email merges, stale previews, and malformed keys return clear form errors with no writes.

## Authorization and replay safety

- Loader and action self-authenticate with the standard admin guard.
- Both identities are resolved through `events.organizationId = activeOrg.id`; a foreign email is indistinguishable from a missing one.
- Event rows and every relationship are selected only through those verified contact ids.
- A client-minted merge key scopes the audit uniqueness contract. Replayed POSTs return the existing audit outcome.
- The submit control uses the shared busy guard.

## Verification

Real-D1 regressions cover:

- per-event survivor row reuse/creation and source retirement;
- participant, task, file, contact custom-value, note, pipeline, portal identity/invite, submission-owner, and Airtable-link re-pointing;
- participant/task/custom-value/pipeline uniqueness conflicts;
- exact preview counts matching executed audit counts;
- idempotent replay;
- source-in-foreign-org and survivor-in-foreign-org denials with no writes;
- retired portal login resolving to the survivor and seeing unioned submissions/tasks.

End-to-end verification runs the worktree Worker, creates same-name/different-email contacts with divergent tasks and submissions, completes the UI merge, confirms one directory person with unioned history, and signs in with the retired identity to confirm survivor portal access.
