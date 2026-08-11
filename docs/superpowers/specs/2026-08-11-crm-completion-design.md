# CRM completion design

## Outcome

Organizers can define person metadata once for their organization, set values on a cross-event CRM profile, reload without losing them, and email exactly the people checked in the organization directory through the existing campaign composer.

## Person custom fields

The existing `fields` table remains the single definition library. A required `recordType` discriminator separates `session` fields from `contact` fields; existing rows migrate to `session`. Contact definitions are organization-scoped only (`organizationId` set, `eventId` null) and are managed from a dedicated **Fields** tab in Speaker CRM. The form builder and Settings Library explicitly filter to `session`, so person fields cannot be attached to submission forms or mutated through session-field actions.

`contact_answers` stores one value per `(organizationId, normalizedEmail, fieldId)`. The normalized email is the CRM person's stable key because directory people are the union of per-event contact appearances; tying values to one `contacts.id` would incorrectly make them event-specific. Foreign keys cascade when the organization or field is removed. The action verifies both that the person exists in the active organization and that the field is an organization-owned contact field before writing.

The CRM field manager supports value-bearing types (text, text area, dropdown, checkbox, number, email, phone, date), validates names/options, and enforces a bounded definition count. The profile loader returns definitions plus current values. Each field has an independently submitted editor so one save is one bounded write; blank text deletes the answer, while checkbox false remains an explicit value. Type-specific validation rejects forged or stale values.

## Email selected

The directory selection bar gains **Email selected**. It links to the existing `/admin/contacts/compose` route with the checked normalized emails. The composer gains one additional recipient-selection mode rather than a second composer: it resolves each email inside the active organization, chooses that person's latest appearance as the merge-field source, and preserves the checked order while deduplicating.

The composer continues to own merge tags, recipient preview, suppression handling, unsubscribe footer, idempotent send keys, and local outbox delivery. Its form snapshots directory recipients as emails because selected people may not have a contact row in the active event; classic event-roster selection remains snapshotted by contact IDs. The active event still supplies campaign context (`event_name`, portal link, outbox event), while authorization comes from active organization membership. Missing or cross-tenant emails are excluded and never leak profile data.

## UI and failure states

The CRM shell exposes Overview, Directory, Pipeline, Segments, and Fields. The fields page has create and definition-management forms, bounded list feedback, validation errors, busy-state disabling, and an empty state. The person profile shows every organization field, including unset fields, with inline success/error feedback. Existing primitives provide all styling and accessibility.

The compose page identifies a directory selection as people, links back to the directory, and otherwise retains the roster experience. Empty resolution shows the existing no-recipient state instead of silently widening to the full roster.

## Verification

Tests are written first against real D1 and cover:

- org-scoped field creation and cross-tenant isolation;
- session-field consumers excluding contact definitions;
- profile value save and fresh-loader persistence;
- forged field/person writes being rejected;
- selected directory emails resolving exactly once across event appearances;
- per-recipient preview and send reaching only the checked subset through suppression-aware local outbox delivery.

After focused tests and `pnpm verify`, live verification uses `pnpm dev:worktree`: create a field, save a profile value, reload, select two directory people, preview both personalized copies, send, and query the local outbox for exactly two rows. Exactly one judge-loop round runs with suffix `-G1` before PR submission.
