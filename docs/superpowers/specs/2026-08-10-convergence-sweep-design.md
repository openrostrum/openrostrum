# Convergence Sweep Design

## Goal

Remove three classes of duplicated client behavior without changing normal user-visible layout, copy, action targets, or server semantics:

1. Every non-agenda mutating control uses the global `useBusy()` contract.
2. Every clipboard control uses one shared copy component.
3. Public CFP and admin form action paths have one canonical constructor each.

## Busy guards

`app/lib/use-busy.ts` remains the single source of in-flight truth: a mutation is busy while navigation or any fetcher is non-idle. Each component containing a mutating control calls `useBusy()` once and combines it with existing eligibility locks such as `isDraft`, `locked`, empty selection, or missing idempotency key. Fetcher/navigation state may remain when it drives operation-specific text or result rendering, but it no longer owns `disabled`.

The agenda board keeps its documented operation-local queue and fetcher guards. A global guard there would disable deliberately concurrent drag/drop work and change the product interaction model.

`ConfirmButton` gains only the typed disabled input needed for callers to apply `useBusy()` to both the arming and confirmation controls. It does not import application hooks into the visual primitive layer.

## Clipboard controls

`app/components/copy-button.tsx` becomes the sole clipboard implementation. Its API preserves the existing surfaces rather than standardizing their product copy:

- configurable idle, copied, and failure labels;
- optional icon;
- configurable copied-state reset, including persistent copied state;
- awaited or optimistic success timing;
- optional failure callback for selecting a manual-fallback field.

All timers are cleaned up. Existing inputs, labels, focus-to-select behavior, and button variants remain at their current call sites. The form-builder local helper, widgets helper, team invite helper behavior, reviewer inline implementation, and contact inline implementation are deleted after their callers move to the shared component.

## Form paths

`app/domain/forms.ts` owns the published CFP base path via `submitPath(eventSlug, formPublicId)`. The duplicate `submitBasePath` is deleted, CFP wizard callers import `submitPath`, and the `/cfp` alias plus form-builder public URL use the same helper. The existing CFP `stepPath` remains responsible for wizard steps and queries.

A small canonical helper owns repeated `/admin/forms/:id` action targets. It stays framework-neutral and distinguishes internal form IDs from public IDs by name. This sweep does not alter encoding, validation, query composition, or redirect behavior because those would be behavior changes.

## Verification

- Preserve existing route tests and add direct tests only where a shared helper has a meaningful path contract not already pinned.
- Run targeted CFP, form-builder, submissions, and affected route tests during implementation.
- Run `pnpm verify` before commits and again after the final merge from `origin/main`.
- Exercise representative busy guards, clipboard success/failure/manual fallback, and public/admin action targets through the local app.
- Run the required judge loop with artifact suffix `-laneQ`, fresh judges, at most three rounds, and record every adopted or discarded finding.
- Immediately before the final push, merge `origin/main`, re-run repository-wide searches for all three duplication classes, fix new arrivals, and record the exact swept main commit in the pull request.

## Out of scope

No CSS, labels, route shapes, server actions, idempotency semantics, schema, dependencies, or agenda concurrency behavior change.
