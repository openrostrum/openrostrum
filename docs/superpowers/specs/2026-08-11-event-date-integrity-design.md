# Event-Date Integrity Design

## Verified problem

The demo event declares `America/Los_Angeles` but `drizzle/seed.sql` stores its October 12–14 dates as `2026-10-12T00:00:00Z` and `2026-10-14T00:00:00Z`. Every public/admin date-range renderer correctly formats event instants in the event's own timezone, so both values land on the prior Los Angeles calendar day. The live local public sessions page therefore renders **October 11–13, 2026** under both `TZ=Pacific/Kiritimati` and `TZ=America/Los_Angeles`.

Current organizer-created rows do not share this defect. The settings flow accepts event-local `datetime-local` values plus an IANA timezone, converts them to UTC instants on write, and converts them back in the event timezone on read. Onboarding similarly stores event-local start/end instants. Event times are required product data for countdowns, save-the-date calendar attachments, and event settings.

## Considered approaches

1. **Convert `events.starts_at` / `ends_at` to date-only text.** Rejected because it discards required event start/end times and would make calendar attachments less precise.
2. **Store wall-clock datetime strings instead of instants.** Rejected for this lane because every instant consumer would need a broad schema/data/API migration, while the verified malformed writer is only the legacy seed.
3. **Repair the malformed seed and deployed seed row while retaining the existing event-timezone instant contract.** Chosen. It fixes the observed user outcome without changing correct organizer-created data or session/agenda timing.

## Design

- Change the demo seed to explicit UTC instants corresponding to October 12 at 08:00 and October 14 at 18:00 in `America/Los_Angeles`: `2026-10-12T15:00:00Z` through `2026-10-15T01:00:00Z`.
- Add data migration `0012_event_date_integrity.sql`. It updates only the known `e_demo` legacy signature: matching ID, timezone, and both old UTC-midnight values. This makes the migration safe for organizer-edited events and idempotent after the seed correction.
- Do not change `app/db/schema.ts`: `starts_at` / `ends_at` remain timestamp instants because event settings intentionally capture date, time, and timezone.
- Do not touch submission/session timing, agenda overlap, conflict, or placement logic.

## Verification contract

A real-D1 regression test will apply the committed seed, read the persisted event, project it through the shared public-program formatter, and require `October 12–14, 2026` plus the two exact UTC instants. A second test will recreate the legacy row, apply migration 0012, and assert the same result. The targeted test runs in separate processes under `TZ=Pacific/Kiritimati` and `TZ=America/Los_Angeles`, followed by local SSR checks and `pnpm verify`.

## Production impact

Existing production `e_demo` rows with the exact legacy signature currently render one day early on every event-timezone-aware surface. Migration 0012 repairs that row during deploy. Organizer-created rows already follow the correct contract and are not rewritten.
