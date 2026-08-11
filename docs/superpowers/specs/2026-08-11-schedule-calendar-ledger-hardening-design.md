# Schedule calendar ledger hardening

## Decision

Add a narrow, normalized calendar-invite revision ledger instead of treating the email outbox as the schedule state store. `submissions` remains the source of schedule truth and `email_outbox` remains the immutable, paginated admin history; the new ledger only projects the calendar revision, delivery attempt, and sequence allocation needed for schedule-update safety.

The ledger is append-only per submission state, with unique constraints on `(submission_id, sequence)` and `(submission_id, state_hash)`. A companion event cursor records the highest immutable `email_outbox.rowid` normalized from pre-migration history. Migration slot `0013` creates both tables and supporting indexes; no existing history is deleted or pruned.

## Why this design

The current implementation scans at most 1,001 outbox rows and refuses all updates when an event exceeds 1,000 matching sends. Removing the limit alone would make every Agenda load increasingly expensive. A single mutable sequence counter would avoid the claim race but could not fall back correctly after a later delivery bounces. The normalized ledger makes reads proportional to accepted submissions, retains every allocated revision, and leaves every sent email reachable in Email history.

This is not event sourcing: agenda writes still update `submissions` directly, and calendar revisions are a delivery-coordination projection only.

## Data flow

1. Before schedule-change detection, normalize outbox rows after the event cursor. Capture a rowid high-water mark first, read matching acceptance/schedule-update rows in bounded keyset pages through that mark, parse each ICS once, upsert normalized revisions idempotently, then advance the cursor. A crash replays the same range safely; outbox rows created after the high-water mark wait for the next pass.
2. Detect changes against the highest delivered normalized revision for each submission. Joined outbox status preserves bounce semantics; malformed matching acceptance history remains a fail-closed condition. There is no total-history cap.
3. Before rendering an update email, claim each semantic submission state with one `INSERT … SELECT … ON CONFLICT … RETURNING` statement. The statement allocates `max(sequence) + 1` and checks that the submission still has the expected slot fields. Identical concurrent states converge on the existing claim. A unique-sequence conflict retries from the new maximum. A stale computed state is refreshed rather than sent.
4. Build grouped emails from claimed sequences. The semantic outbox dedupe key includes the claimed revision and bounce-retry identity. After send, associate each claim with the real outbox row; a failed/crashed attempt reuses the claim and sequence on retry.

## Failure semantics

- A crash during normalization cannot skip rows because the cursor advances only after idempotent ledger writes complete.
- A crash after sequence claim but before delivery leaves a reusable claim; it never frees a sequence for another state.
- A duplicate concurrent claim returns the winner's sequence and relies on the existing unique outbox dedupe key for one effective send.
- A changed concurrent slot cannot reuse a sequence. A stale slot snapshot fails its conditional claim and is recomputed.
- A bounced attempt does not become the delivered baseline; retry keeps the claimed sequence and receives a new outbox dedupe identity.
- Malformed historical acceptance ICS remains fail-closed instead of guessing a lower revision.

## Tests

Use the real workerd D1 harness.

- Convert the 1,001-row cap regression to prove a revision above sequence 5,000 is found, claimed at 5,001, sent, and quiet on replay.
- Fire two `Promise.all` claims for one submission/state. Assert one insert wins, the loser returns the same claim without error, both receive one sequence, and only one outbox send exists.
- Compete two different semantic states and assert unique monotonic sequences; reject/refresh a stale slot snapshot.
- Preserve existing first-send, progression, grouped VEVENT, malformed-history, recipient-change, failure, and bounce-retry behavior.
- Apply migration `0013` to a fresh local D1 database and run `pnpm verify`.
