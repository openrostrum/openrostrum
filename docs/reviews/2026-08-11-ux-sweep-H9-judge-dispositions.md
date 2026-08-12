# H9 judge dispositions — 2026-08-11

Exactly one cold judge round ran with suffix `-H9` over the complete `origin/main...HEAD` diff. The architecture judge approved. The governance and simplicity findings were dispositioned below; the lane's binding one-round cap prohibited a second round.

| Judge finding | Decision | Verified reason |
| --- | --- | --- |
| Governance: the 14 reported structural defects must be fixed or copied into SCOPE/register before merge. | Discard | The integration-owner lane brief explicitly required structural/new-flow/schema-dependent findings to be reported rather than implemented, and explicitly required this audit table as the handoff. These are pre-existing defects discovered by the audit, not shortcuts introduced by this change; `docs/reviews/2026-08-11-ux-sweep-H9.md` is the requested owner-facing decision record. |
| Governance: new tests pin UI copy and Tailwind implementation classes. | Adopt | Removed the three redundant copy assertions from submission-detail tests and removed the class-name placement test. Destination behavior remains covered by route assertions, and actual below-trigger geometry was verified in Chrome. |
| Governance: Agenda callback dependency edits are unrelated drive-by cleanup. | Adopt | Removed the three unnecessary manual `useCallback` wrappers entirely. React Compiler can optimize the plain callbacks without dependency-array noise. |
| Simplicity: Agenda's stable state setter dependencies add diff noise. | Adopt | Same correction: plain callbacks replace manual memoization and remove the dependency-only diff. |
| Simplicity: several render tests could share a `createRoutesStub` helper. | Discard | The adapters supply different route IDs, loader data, paths, and component props; a common helper would mostly parameterize those differences and hide each test's setup. Extracting it would be a broad test refactor outside this audit without reducing behavioral surface. |
