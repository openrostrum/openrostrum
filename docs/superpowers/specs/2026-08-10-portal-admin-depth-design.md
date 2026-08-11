# Portal Admin Depth Design

**Date:** 2026-08-10
**Branch:** `feat/portal-admin-depth`
**Status:** Approved continuation; the implementation pre-dates this consolidated design record.

## Outcome

An organizer can manage reusable event portal forms, attach a form to a task, create event-specific custom statuses, and inspect the real speaker portal as a selected contact without gaining a speaker session or being able to mutate speaker data.

This design closes the seed-only gap recorded by TK-S4 and replaces the copyable-login-link stand-in with a server-enforced read-only preview.

## Scope

### Portal task forms

- List forms for the active event.
- Create, edit, and delete forms with the field shape already exercised by the seeded form.
- Support text, textarea, dropdown, checkbox, number, and date fields, including required fields and dropdown options.
- Reuse the same runtime field representation for builder preview and speaker completion.
- Populate the task editor's form selector from active-event forms.
- Reject foreign-event form IDs.
- Refuse deletion while a task references the form.
- Validate and persist speaker answers server-side; organizers can inspect submitted answers.

### Custom statuses

- Create, edit, order, and delete active-event custom statuses in **Settings → Library**.
- Each status has a label and design-system color.
- Keep the optional custom status separate from the fixed submission decision status.
- Populate submission assignment from active-event statuses only.
- Reject foreign-event IDs and deletion while referenced.

Lane D may change the Library file's Fields section. This lane confines status work to the status taxonomy section and shared helpers required by that section so the diffs remain disjoint.

### Read-only portal preview

- An authenticated organizer selects an active-event contact with **View portal as**.
- The portal shows a persistent, explicit preview banner naming the selected contact and offering an exit action.
- The organizer's real session remains unchanged and is re-authorized on every request.
- The preview cookie contains only a contact selector; it is not an authentication credential.
- Portal GETs resolve all contact-, participant-, and linked-account-owned data as the selected speaker would see it.
- Every portal mutation in preview mode returns HTTP 403 before performing D1, R2, email, or other side effects.
- The UI additionally disables mutation controls, but server enforcement is authoritative.
- Switching events never mislabels the selected contact; a cross-event preview is rejected by the portal and remains explicitly visible on the admin surface so it can be exited.

## Non-goals

This lane does not add the broader portal-form parity backlog such as conditional logic, multipage sections, a reusable organization field library, PDF confirmations, result exports, or post-submission editing. It implements the committed scenario and the seed's current schema shape. It also does not add custom-status category mapping beyond the requested event-scoped label/color taxonomy.

## Architecture

### Forms

`admin.portal-forms` owns active-event form CRUD and builder validation. `admin.tasks` accepts only form IDs owned by the active event. Portal task detail loads the referenced schema, renders it through the shared `portal-form-fields` component, validates submitted values against the stored schema, then persists the response and completion state. Deletion uses a reference-aware predicate so a concurrent task reference cannot be orphaned.

The initial response write must be atomic: its update predicate includes the assignment's ownership and incomplete/no-response state. Two simultaneous first submissions therefore cannot both succeed.

### Statuses

`admin.settings.library` uses the established event-taxonomy CRUD pattern for validation, ordering, usage counts, tenancy, and reference-safe deletion. Submission detail loads and assigns the taxonomy independently of the fixed workflow decision.

### Preview security boundary

The preview cookie names a contact. `getPortalContext` first authenticates the real caller, resolves the event from the URL, confirms the caller is an organizer with access to that event, and only then resolves the selected contact inside that event. The context exposes the selected contact as the effective read subject while retaining the real organizer identity for authorization and audit.

When the selected contact is linked to an account, submitter-owned reads use that linked account. Participant-owned reads use the selected contact/participant relationship. This fixes the case where a speaker-owned submission without a participant row was omitted or returned 404 in preview. UI affordances such as `isMe`, withdrawal, and participant removal derive from the same effective subject, so the GET surface matches the selected speaker even though all actions remain forbidden.

No code writes an auth session for the selected speaker, emits a magic/login link, or changes the organizer's session cookie. Because the selector is non-authoritative, forging or stealing it grants no access beyond the holder's independently verified organizer rights.

## Validation and failure behavior

- Empty forms, duplicate field names, invalid dropdown configuration, and unsupported values return field-level/action errors without writes.
- Task creation/update rejects missing or foreign-event form references.
- Form deletion returns an explicit in-use error when referenced.
- Status CRUD rejects invalid label/color values and foreign-event records.
- Status deletion returns an explicit in-use error when assigned.
- Invalid or cross-event preview selectors do not expose contact data.
- Every non-GET/HEAD portal request in preview returns 403 and leaves persistence unchanged.
- Double submissions are rejected atomically rather than by a read-then-write race.

## Testing

Automated coverage must prove both tenancy directions with two events/organizations:

1. Event A cannot read, attach, update, or delete Event B forms.
2. Event B cannot do the inverse against Event A.
3. The same bidirectional checks apply to custom-status CRUD and assignment.
4. A selected Event A contact cannot be previewed through Event B's portal.
5. A non-admin preview cookie is inert.
6. Preview GETs show selected-contact tasks, profile, files, participant-linked submissions, and linked-account submitter-owned submissions.
7. Crafted preview POSTs to representative portal mutations return 403 and leave D1/R2/outbox state unchanged.
8. Concurrent initial task-form submissions produce one persisted response and one refusal.

Run targeted tests throughout development, then `pnpm verify` after all fixes.

## Live acceptance

Against the running application with a fresh organization:

1. Create a portal form.
2. Create a task definition referencing it.
3. Assign it and confirm the speaker sees and can submit the form.
4. Confirm the organizer sees the response.
5. Create a custom status and assign it to a submission.
6. Start **View portal as** for that speaker and confirm task/submission/profile read parity.
7. Confirm the preview banner is persistent and clear.
8. Attempt a mutation from the disabled UI and a crafted request; require 403 and unchanged data.
9. Exit preview and confirm the organizer session was never swapped.

## Delivery

Merge `origin/main` with a merge commit, never rebase. Run the judge loop with suffix `-portal-admin` for at most three rounds and record every accepted/rejected disposition. Open or update the PR with a decision-record body, resolve every inline AI-review thread, require green CI, and do not merge the PR.
