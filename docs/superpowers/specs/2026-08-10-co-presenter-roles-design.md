# Co-presenter roles (ABS-11) — design

## Product contract

A submission carries an ordered participant list. Each participant is one event contact linked to the submission with a canonical role: `speaker`, `chairperson`, or `moderator`; the existing `secondary` contact extension remains available for task/communication assistance. An additional presenter is another `speaker` participant, not a new `co_presenter` core role. Every speaker- and organizer-facing detail view shows the role label.

Submitters can add participants while submitting and can add, remove, or change participant roles from **View Submission** until the source form closes. Organizers can add existing contacts, create-and-add a contact, remove a participant, and change a participant's role on submission detail. All writes are event/submission scoped and server-authorized.

## Chosen approach

Keep the existing thin `participants` junction and canonical role enum. Migration 0009 makes the junction role-aware by changing uniqueness from `(submission_id, contact_id)` to `(submission_id, contact_id, role)`, matching Sessionboard's participant-as-one-role-link semantics and allowing one contact to hold two roles on a session. It also adds `forms.notify_existing_contacts` (default true), the Sessionboard participant-step policy that controls an “added to this submission” notification for an already-known contact.

This is preferred over:

1. **UI-only changes:** smaller, but leaves same-person/multiple-role data impossible and notification policy implicit.
2. **A new event role-catalog subsystem:** ultimately useful for custom display labels, but it requires replacing the builder's existing per-core-role min/max model and is larger than ABS-11. The locked data model identifies the three core categories; this lane completes those semantics without inventing a parallel role system.

## Data and invariants

- `contacts` remains the identity record and is unique by normalized email per event.
- `participants` remains the ordered role link. Exactly one `speaker` link is primary when speakers exist.
- Duplicate form/portal entries with the same normalized email are rejected before persistence. Admin attachment of the same contact under the same role is idempotent; attaching the same contact under a different role is valid.
- Role changes preserve the participant row and acceptance state. Changing the primary speaker away from `speaker` atomically promotes the next ordered speaker. Changing a non-speaker to `speaker` promotes it only when no primary speaker exists.
- Source-form min/max limits are enforced on portal additions/removals and role changes, not merely rendered in the client.
- Portal edits remain available only while `getEditWindow()` reports the source form open.

## Participant notifications

A shared participant-notification domain function runs only after a new participant role link commits:

- self/submitter links do not receive an added-to-submission email;
- existing contacts receive the notification only when the source form's `notifyExistingContacts` setting is on;
- new contacts receive a portal invitation so the person can establish access;
- a contact with a matching existing user is linked to that user;
- a contact without a user gets the existing sentinel-user + `/set-password/:token` flow, never an implicit password;
- mail is transactional and idempotent on the participant-link id, so a replay cannot double-send;
- a mail failure does not roll back a safely persisted submission/participant; it is tracked and shown as an honest warning where an interactive mutation initiated it.

Submission confirmation remains addressed to the submitter only. Accept-time task provisioning already targets every `speaker` participant. Decision sends remain one per selected submission (primary speaker with submitter fallback), as required by the existing scenarios; this lane does not turn one selected row into an unbounded multi-recipient blast.

## Surfaces

### Public CFP

The existing participant step already supports multiple configured roles, live duplicate-email validation, source-form role counts, max caps, review summary, and persistence. It will use shared role constants/labels and trigger idempotent added-participant notifications after a successful first submit or participant-changing edit. Existing participant rows retain acceptance state when content or ordering changes.

### Speaker portal

The submission detail participant card will:

- show a designed empty state when no participant rows exist;
- offer every source-form-enabled canonical role plus Secondary Contact;
- disable mutating controls while any request is in flight;
- validate duplicate email, role enablement, and min/max on the server;
- permit role changes/removal only before close, with the submitter's own role protected from accidental removal.

### Organizer submission detail

Each participant row shows a human role label and an inline role selector/save action. Existing-contact and new-contact attach controls remain bounded and gain role-aware idempotency. Removal and role changes preserve the primary-speaker invariant. Empty state and permission behavior remain explicit.

## Verification

Tests run in workerd against real D1 and independently assert:

- CFP submit/edit persists two named people and their roles; duplicate normalized email is rejected;
- portal adds chairperson/moderator/speaker within source-form policy, refuses disabled roles and caps, blocks after close and for a foreign user, and replay does not duplicate links or emails;
- admin changes roles, permits a second role for the same contact, rejects the same role twice, and maintains primary-speaker promotion atomically;
- added-participant email creates a usable portal or set-password link, respects `notifyExistingContacts`, and dedupes by participant link;
- loader projections show names and role labels on portal and organizer views;
- existing accept provisioning still assigns onboarding tasks to all speaker links and agenda conflict detection still sees every speaker;
- migration reset/seed succeeds, targeted tests pass, `pnpm verify` passes, and the running app is exercised end to end through CFP → portal edit → organizer detail → outbox/DB evidence.

Because migration 0009 changes `participants` and `forms`, the design-time gate re-walks every step of scenarios 02, 03, 04, 05, 06, 08, and 09. The re-walk records a concrete SQL/route/email artifact at participant-sensitive steps and an explicit unchanged reason at all other steps.
