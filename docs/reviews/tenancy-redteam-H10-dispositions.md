# Tenancy red-team H10 judge dispositions

One cold H10 round ran against `/tmp/tenancy-redteam-H10-judge.md` with architecture, governance, and simplicity judges.

| Finding | Decision | Reason |
|---|---|---|
| Architecture/governance: schema-level cross-tenant relational gaps were only described in the temporary PR body | adopt | Registered the exact composite-integrity follow-up in `docs/scenarios/GAP-REGISTER.md` as S5. Schema and migrations remain integration-owner-only, but the gap now has durable ownership and remediation shape. |
| Architecture/governance: no same-event, different-form regression | adopt | Added a real-D1 test proving a signed-in submitter's submission from another form in the selected event returns 404. |
| Simplicity: remove the committed 508-line execution plan | discard | The plan is the branch's governing execution artifact and records mandatory scope, verification, and publication constraints; deleting it would erase the audit trail rather than improve runtime code. |
| Simplicity: remove redundant `submitterId` projection and post-query ownership check | adopt | The SQL predicate is the authorization boundary; removed the redundant projection and check while retaining the scoped predicate. |

No second judge round was run: H10 requires exactly one round.
