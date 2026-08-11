# Task 2 report — Participant access and notification domain

## Status

Complete. The focused participant notification domain service and real-D1 tests are implemented and committed. No routes, schema, migrations, or unrelated files were changed.

## Files

- `app/domain/participant-notifications.ts`
- `test/participant-notifications.test.ts`

## Commit

- `f0faa4342e58dc76789881e0aadcaa4108a7a927` — `feat(email): notify newly added participants`
- Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`

## TDD evidence

### RED

Exact command:

```text
pnpm vitest run test/participant-notifications.test.ts
```

Result: failed as required before production code existed.

```text
Test Files  1 failed (1)
Tests       no tests
Error: Cannot find module '../app/domain/participant-notifications'
```

### GREEN

Exact command:

```text
pnpm vitest run test/participant-notifications.test.ts
```

Final result against real D1:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

The first implementation run reached all four tests and exposed a test-only timestamp precision mismatch: D1 stores timestamp seconds while the assertion required millisecond precision. The assertion was corrected with a one-second storage tolerance; production behavior was unchanged. The exact GREEN command then passed and was rerun successfully after the commit hook formatted the files.

### Full verification

Exact command:

```text
pnpm verify
```

Final result on the committed tree:

```text
Test Files  91 passed (91)
Tests       778 passed (778)
```

Map check, generated types, TypeScript build, ESLint, CSS lint, and the full workerd test suite passed.

## Behavior evidence

- A new unlinked participant receives a normalized speaker sentinel account, the contact is linked to it, and exactly one unused 14-day `password_resets` row is persisted with `organizationId: null`.
- The new participant email contains the deterministic `/set-password/:token` URL.
- A suppressed recipient still receives this invitation, proving the email is sent as `kind: "transactional"` rather than bulk.
- An existing normalized-email user is linked to the contact. A credentialed user receives the first event portal URL and receives no password reset.
- `forms.notifyExistingContacts=false` prevents email to an existing contact.
- Replaying the same participant link returns `deduped: true`, leaves one outbox row under `participant-added:${participantId}`, and leaves one stable reset token.
- Hostile contact, event, and submission strings are escaped in email HTML.

## Self-review

- Scope is limited to the two requested files; route integration remains intentionally absent.
- Contact and source-form reads select only required columns and are event-scoped.
- The implementation reuses `normalizeEmail()`, `mintSentinelHash()`, `hasSetPassword()`, `sha256Hex()`, portal helpers, `escapeHtml()`, and `getEmailSender()`.
- Existing normalized-email users are reused, including a conflict-safe re-read if concurrent account provisioning wins the unique-email insert.
- Password-reset and email idempotency use stable participant-link keys and `onConflictDoNothing`.
- Provider errors are not caught by the service and therefore propagate to the future route caller as required.
- No live route flow was exercised because route integration is explicitly outside Task 2; verification is the focused real-D1 domain test plus the complete workerd suite.
- Verification emitted pre-existing dependency sourcemap and binary-body `.text()` console warnings, but no check or test failed.

## Review repair round 1/5 — 2026-08-10

### Status

Complete. The participant notification domain now validates persisted relationships and email identity, provisions access before applying notification policy, uses compare-and-set contact linking, and issues random replay-stable access tokens. Route integration, schema, and migrations remain outside Task 2.

### Superseded behavior

This appendix supersedes the initial report's deterministic-token, participant-only reset-email dedupe, `sha256Hex()` reuse, and `{ sent, deduped }` return claims. Reset invitations now use high-entropy random tokens, reuse one active unused/unexpired null-organization token, dedupe on `participant-added:${participantId}:${token}`, and return exactly one `delivery` state: `sent`, `deduped`, or `suppressed`.

### RED

Exact command:

```text
pnpm vitest run test/participant-notifications.test.ts
```

Result against the pre-repair production implementation after all review regressions were present:

```text
Test Files  1 failed (1)
Tests       20 failed (20)
```

Representative expected failures included the obsolete `{ sent, deduped }` result instead of `{ delivery }`, stale linked-email and relationship/origin cases resolving instead of rejecting, and concurrent replay returning two undefined delivery states. The real-D1 CAS trigger setup completed successfully; failures were behavioral rather than test-infrastructure errors.

### GREEN

Exact command:

```text
pnpm vitest run test/participant-notifications.test.ts
```

Final real-D1 result:

```text
Test Files  1 passed (1)
Tests       20 passed (20)
```

The focused regressions prove exactly-one delivery, stale linked-identity rejection, provisioning under notification suppression, missing/cross-event source-form fail-closed behavior, persisted relationship and self validation, CAS conflict preservation, credential-free origin validation, random-token issuance, active-token replay stability, used/expired-token recovery, and concurrent replay with one active token and one delivered outbox row.

### Full verification

Exact command:

```text
pnpm verify
```

The first full run reached lint and correctly rejected four `it.each` declarations because the meaningful-test rule could not see assertions inside their generated callbacks. The table cases were expanded into statically visible `it` declarations without changing production behavior, and the focused suite remained green.

Final result:

```text
Test Files  91 passed (91)
Tests       794 passed (794)
```

Map validation, generated bindings/routes, TypeScript, ESLint, CSS lint, and the complete workerd real-D1 suite passed. Verification emitted only the pre-existing dependency sourcemap and binary-body `.text()` console warnings.

### Repair behavior evidence

- Origin is parsed before writes and accepted only as a normalized credential-free HTTP(S) origin with no path, query, or fragment.
- The persisted participant-to-submission-to-event/contact/form aggregate is authoritative for IDs, role, self identity, event content, submission content, and source-form policy.
- A linked user's normalized email must equal the persisted contact email before any credential or email is issued.
- Account discovery, sentinel provisioning, contact linking, and reset provisioning happen before existing-contact notification policy suppresses delivery.
- Contact linking compares the observed event, raw email, and user ID, then re-reads and validates any concurrent winner instead of overwriting it.
- Reset creation uses an atomic conditional D1 insert with a random token and reuses the active unused/unexpired null-organization token under sequential or concurrent replay.
- Failed provider attempts remain retryable because delivery still delegates to the existing email port with the stable participant-plus-token dedupe key.
- The repair and this appendix are recorded together in the next append-only commit after `f0faa4342e58dc76789881e0aadcaa4108a7a927`.
