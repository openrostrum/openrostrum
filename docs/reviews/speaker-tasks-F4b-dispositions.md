# Speaker tasks F4b judge dispositions

Exactly one cold judge round ran against `origin/main...HEAD` with suffix `-F4b`. Per lane instruction, adopted findings were fixed without a second round.

| Finding | Decision | Reason |
| --- | --- | --- |
| Architecture A1 — one deterministic multi-role control made exact-row confirmation leave another held role unreachable | adopt | The detail loader now returns every owned non-secondary participation, the UI renders one control per role, and the action authorizes and updates the exact owned participant row. |
| Architecture A2 — accept-time provisioning exceeded D1 parameter limits at real bulk size | adopt | Submission/contact/task/user reads, invited-contact updates, and assignment inserts are now chunked below D1’s per-statement parameter cap. A 101-speaker workerd/D1 regression failed before the fix and passes after it. |
| Architecture A3 — existing/seeded task definitions keep null due offsets | discard in this lane; blocking follow-up | The finding is valid, but `docs/rules/process.md` makes `drizzle/seed.sql` and migrations integration-owner-only and the pre-commit guard rejects feature-lane edits. This PR supplies offsets for newly provisioned events and stable acceptance-time deadlines; the integration owner must backfill existing canonical defaults before merge. |
| Governance G1 — each held role requires its own confirmation path | adopt | Same implementation and regression as A1; both held roles can now be confirmed independently. |
| Governance G2 — no forward migration for existing null due offsets | discard in this lane; blocking follow-up | Same integration-owned migration constraint as A3. This is disclosed in the PR decision record rather than hidden or worked around with runtime name matching that would override organizer configuration. |
| Governance G3 — pending-to-invited used an unbounded `IN` statement | adopt | Invited contact IDs are chunked to 80; the broader provisioning reads and inserts were bounded at the same time so the fix is not merely local. |
| Simplicity S1 — delete the 416-line implementation plan | discard | This repository intentionally keeps committed plans as durable binding decisions; deleting the F4 plan would remove the exact participant-row, duplicate-policy, and integration-boundary rationale needed to review the branch. |

## Residual merge gate

Do not merge until an integration-owner migration/backfill sets meaningful `due_in_days` values on existing canonical onboarding task definitions (including the demo seed) without overwriting organizer-customized definitions.
