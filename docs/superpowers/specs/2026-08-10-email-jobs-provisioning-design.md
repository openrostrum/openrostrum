# Lane L: Email Jobs and Event Provisioning Design

## Goal

Complete production-grade draft-close reminders, compliant announcement delivery, and fresh-event onboarding task provisioning without weakening existing tenancy, idempotency, or transactional boundaries.

## Integration strategy

Preserve the five existing lane commits. Merge the current `origin/main` append-only before further implementation, then reconcile main's rendered-decision-email changes before editing overlapping email code. Never rebase and never merge the feature PR.

## Draft-close reminders

Retain the scheduled-job registry and existing Worker cron dispatch. The reminder job evaluates form close instants in each event's configured timezone. The five-day occurrence may send two through five event-calendar days before close; the one-day occurrence may send zero through one event-calendar day before close. It skips closed forms, non-draft submissions, and forms with reminders disabled.

Each occurrence uses a durable outbox identity scoped by occurrence, form, recipient, and close instant. Replays dedupe, while changing the close instant rearms the occurrences. Email content goes through the same merge-tag renderer used by previews, and every successful local/test delivery creates an outbox row. A recipient failure must not starve other recipients or tenants.

## Announcement delivery

The real compose action calls `sendAnnouncement` as its only delivery path. The helper owns unsubscribe-footer generation and forces bulk classification so suppression and outbox behavior cannot be bypassed by route changes. The route snapshots recipients, uses a stable per-blast key, and retains safe same-key retry behavior for partial provider failures.

The public unsubscribe route validates the signed token, records suppression idempotently, and subsequent bulk sends to that address create no outbox row. Transactional mail remains deliverable.

## Event defaults and acceptance provisioning

`provisionEventDefaults` returns atomic D1 batch statements for the seeded-equivalent hotel, flight, and presentation task definitions alongside existing event defaults. Task definitions reference provisioned portal forms through generated IDs.

Acceptance finalization uses those definitions to mint contact- and submission-scoped assignments idempotently. Re-acceptance preserves completed work and does not duplicate assignments.

## Testing and failure handling

Implement remaining gaps test-first with real local D1 and the local email sink only. Coverage pins timezone-safe window math, reminder replay idempotency, toggle-off behavior, failed-send recovery, compliant announcement delivery and unsubscribe round-trip, fresh-event defaults, and acceptance assignment minting.

After targeted tests, run `pnpm verify`. Start the app with `pnpm dev:worktree` and exercise all three flows end to end, inspecting UI and D1/outbox state. Run judge-loop with suffix `-email-jobs` for at most three rounds and record every disposition.

## Delivery

Create or update the PR from `feat/email-jobs-provisioning` with a decision-record body covering integration choices, trade-offs, verification evidence, and judge dispositions. Resolve every inline AI-review thread. Wait for CI and report its actual state. Do not merge the PR.
