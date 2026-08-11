# Tenancy Red-Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove OpenRostrum’s organization boundary against authenticated, unauthenticated, portal, public, and API-token attacks; fix every reproducible leak with the smallest server-side scope predicate.

**Architecture:** Reuse the existing real-D1 two-tenant fixtures and route-level test harnesses instead of adding production test hooks. Root resources must be selected by externally supplied ID plus the server-resolved organization/event; children may be selected by ID only when they were derived exclusively from that scoped root. Findings that require cross-column tenant integrity constraints rather than query changes are recorded as `NEEDS-SCHEMA` and receive no migration in this lane.

**Tech Stack:** React Router 7 framework mode, TypeScript 5.9 strict, Cloudflare Workers/workerd, D1/SQLite, Drizzle ORM, Hono API v1, Vitest workers pool, R2.

## Global Constraints

- Work only on `test/tenancy-redteam`; append commits, never rebase/amend/force-push.
- No production schema, migration, seed, dependency, binding, or shared UI changes.
- Every confirmed breach gets a failing real-D1 two-organization regression before its smallest server-side fix and a green rerun afterward.
- Safe attacks remain evidence-backed probes; do not alter production code merely for stylistic defense in depth.
- Cross-tenant targets return 403/404 without disclosing tenant metadata; unauthenticated private routes return the established auth denial.
- Public sessions require the requested event, `status === "accepted"`, `contentStatus === "approved"`, and public speaker visibility; private contact fields never serialize.
- API tokens remain organization-scoped, optionally one-event restricted, and read-only.
- Organization members are equal admins; there is no supported membership-role mutation, and the final member cannot be removed.
- Run `pnpm verify`, merge (never rebase) `origin/main` if it advances, run exactly one `judge-loop` round with suffix `H10`, and do not merge the PR.
- Open the PR as `test(tenancy): comprehensive two-organization scoping matrix`; its results table reports feature, two-org case, result, and change or already-correct.

---

### Task 1: Complete the attack map and preserve the real-D1 oracle

**Files:**
- Reference: `test/setup.ts`
- Reference: `test/auth.tenancy.test.ts`
- Reference: `test/crm-fixtures.ts`
- Reference: `test/portal.helpers.ts`
- Reference: `test/api-v1-fixtures.ts`
- Create: `/tmp/openrostrum-H10-findings.md` (scratch PR body; never commit secrets)

**Interfaces:**
- Consumes: per-test migrated/emptied D1 and existing `requestAs`, `authedRequest`, API token, portal, CRM, task, and program fixtures.
- Produces: one findings-table row per mandatory surface, with attacker, forged input, expected boundary, observed result, test evidence, severity, and disposition.

- [ ] **Step 1: Initialize the findings table**

Create the scratch body with these columns and rows for every required surface:

```markdown
| Surface | Attacker / forged input | Required boundary | Evidence | Result | Severity / disposition |
|---|---|---|---|---|---|
| Contacts | Org A admin supplies Org B contact/directory IDs | Active event or resolved organization | pending | pending | pending |
| Sessions and submissions | Org A admin supplies Org B submission IDs | Active event | pending | pending | pending |
| Files and downloads | Org A admin/token/portal user supplies Org B file IDs | Scoped root + event | pending | pending | pending |
| Tasks and assignments | Org A admin/portal user supplies Org B assignment IDs | Task event + portal contact | pending | pending | pending |
| Emails | Org A admin supplies Org B template/outbox/recipient IDs | Event/org | pending | pending | pending |
| Embeds / public feeds | Public caller mixes Org A slug with Org B embed ID | Embed event must equal requested event | pending | pending | pending |
| Pipelines | Org A admin supplies Org B email/card/pipeline IDs | Resolved organization | pending | pending | pending |
| Forms / CFP | Org A caller mixes event slug, form, field, or recipient IDs | Form/field event and member org | pending | pending | pending |
| Events / switching | Org A admin supplies Org B event ID | Membership-derived event access | pending | pending | pending |
| Memberships | Org A admin supplies Org B membership/invite IDs or role | Resolved organization; no role mutation | pending | pending | pending |
| Portal IDs / tokens | User mixes event slug, portal ID, contact, submission, task, file | Event-scoped portal contact owns child | pending | pending | pending |
| API tokens | Org/event-restricted token supplies sibling/foreign IDs | Token org + optional event | pending | pending | pending |
```

Add separate rows for contact merge, forged bulk-email selection, accept/status mutation, schedule mutation, public status/content filtering, current-event fallback, invite token intent, and unauthenticated private-route denial.

- [ ] **Step 2: Record schema-only invariants precisely**

Under `NEEDS-SCHEMA`, record each missing composite consistency rule proven by the schema inspection, without changing `app/db/schema.ts` or migrations:

```text
submissions: (form_id, event_id), (custom_status_id, event_id), (parent_id, event_id),
             (format_id, event_id), (level_id, event_id), (room_id, event_id)
participants: submission.event_id = contact.event_id
submission_tracks/tags: submission.event_id = track/tag.event_id
submission_answers: submission.event_id = field.event_id
files: file.event_id = submission/contact/task-assignment root event
 task_assignments: task.event_id = contact/submission event
api_tokens: token.event_id, when non-null, belongs to token.organization_id
```

The exact remediation is unique parent keys on `(id, event_id)` or `(id, organization_id)` plus composite foreign keys (or equivalent D1 triggers) for every listed pair.

- [ ] **Step 3: Run the fixture and auth oracle**

Run:

```bash
pnpm test -- test/db.test.ts test/hermeticity.test.ts test/auth.tenancy.test.ts
```

Expected: real workerd D1 passes; Org A active-event fallback/list/access never resolves Org B.

- [ ] **Step 4: Commit the plan only**

```bash
git add docs/superpowers/plans/2026-08-11-tenancy-redteam.md
git commit -m "docs(security): plan tenancy red-team" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Prove and close the CFP success-page cross-tenant disclosure

**Files:**
- Create: `test/cfp-success.route.test.ts`
- Modify: `app/routes/submit.$eventSlug.$formId.step.success.tsx`

**Interfaces:**
- Consumes: authenticated speaker cookie, Org A event slug/form public ID, and a submission owned by the same user in Org B.
- Produces: success-page submission lookup constrained by `id + eventId + formId + submitterId`.

- [ ] **Step 1: Write the failing real-D1 regression**

Seed `seedCfp()` for Org A, create one authenticated speaker, then seed Org B with its own event, form, and a submitted row owned by that same speaker. Call Org A’s success loader with Org B’s `sid` and assert existence-hiding 404:

```ts
const thrown = await catchThrown(() =>
  successLoader({
    context: CONTEXT,
    request: new Request(`${BASE_URL}/step/success?sid=s_foreign`, {
      headers: { Cookie: speaker.cookie },
    }),
    params: { eventSlug: FIX.eventSlug, formId: FIX.formPublicId },
  } as unknown as Parameters<typeof successLoader>[0]),
);
expect(thrownStatus(thrown)).toBe(404);
```

Also keep a same-event/same-form owned submission control that returns its title.

- [ ] **Step 2: Run it red**

Run:

```bash
pnpm test -- test/cfp-success.route.test.ts
```

Expected before the fix: the foreign call returns Org B’s title under Org A’s form success content instead of throwing 404.

- [ ] **Step 3: Scope the first submission lookup**

Import `and` and change the lookup in `app/routes/submit.$eventSlug.$formId.step.success.tsx` to:

```ts
.where(and(
  eq(submissions.id, sid),
  eq(submissions.eventId, event.id),
  eq(submissions.formId, form.id),
  eq(submissions.submitterId, user.id),
))
```

Retain the post-query owner check only if needed for type narrowing; the SQL query is the authorization boundary.

- [ ] **Step 4: Run it green**

Run:

```bash
pnpm test -- test/cfp-success.route.test.ts test/cfp-wizard.route.test.ts test/cfp-account.route.test.ts
```

Expected: mixed Org A path/Org B submission is 404; same-form success and existing CFP workflows pass.

- [ ] **Step 5: Commit the regression and fix**

```bash
git add 'app/routes/submit.$eventSlug.$formId.step.success.tsx' test/cfp-success.route.test.ts
git commit -m "fix(cfp): scope success submissions to form event" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Attack authenticated organizer IDOR and privileged mutations

**Files:**
- Modify only if a new regression is needed: `test/admin.contacts.compose.route.test.ts`
- Modify only if a new regression is needed: `test/contact-merge.test.ts`
- Modify only if a new regression is needed: `test/crm.pipeline.route.test.ts`
- Modify only if a new regression is needed: `test/admin.submissions.decisions.route.test.ts`
- Modify only if a new regression is needed: `test/admin.agenda.route.test.ts`
- Modify only if a new regression is needed: `test/admin.files.route.test.ts`
- Modify only if a new regression is needed: `test/files.upload-download.route.test.ts`
- Modify only if a new regression is needed: `test/admin.tasks.assignment.route.test.ts`
- Modify only if a new regression is needed: `test/admin.emails.route.test.ts`
- Modify only if a new regression is needed: `test/admin.emails.history.route.test.ts`
- Modify only if a new regression is needed: `test/admin.embeds.route.test.ts`
- Modify only if a new regression is needed: `test/admin.forms.editor.route.test.ts`
- Modify only if a new regression is needed: `test/admin.settings.team.route.test.ts`
- Modify only if a new regression is needed: `test/admin.events.switch.route.test.ts`

**Interfaces:**
- Consumes: existing two-org route fixtures and authenticated session cookies.
- Produces: observed no-write/no-read evidence for every externally controlled organizer ID and mutation named in the mandate.

- [ ] **Step 1: Run contact, CRM, merge, and bulk-email attacks**

```bash
pnpm test -- \
  test/admin.contacts.record.route.test.ts \
  test/admin.contacts.compose.route.test.ts \
  test/contact-merge.test.ts \
  test/crm.directory.route.test.ts \
  test/crm.person.route.test.ts \
  test/crm.pipeline.route.test.ts
```

Confirm from DB assertions that forged Org B contact IDs/emails/cards never enter Org A previews, sends, merges, notes, pipeline enrollment, or moves.

- [ ] **Step 2: Run submission and schedule mutation attacks**

```bash
pnpm test -- \
  test/admin.submissions.route.test.ts \
  test/admin.submissions.decisions.route.test.ts \
  test/admin.submissions.detail.route.test.ts \
  test/admin.agenda.route.test.ts
```

Confirm Org B submission/room IDs cannot be accepted, declined, status-changed, scheduled, unscheduled, previewed, or emailed by Org A.

- [ ] **Step 3: Run files, tasks, emails, embeds, and forms attacks**

```bash
pnpm test -- \
  test/admin.files.route.test.ts \
  test/files.upload-download.route.test.ts \
  test/admin.tasks.route.test.ts \
  test/admin.tasks.assignment.route.test.ts \
  test/admin.emails.route.test.ts \
  test/admin.emails.history.route.test.ts \
  test/admin.embeds.route.test.ts \
  test/admin.forms.route.test.ts \
  test/admin.forms.editor.route.test.ts
```

Confirm every foreign ID returns 403/404 or an explicit validation error and DB/R2/outbox state is unchanged.

- [ ] **Step 4: Run event and membership attacks**

```bash
pnpm test -- \
  test/auth.tenancy.test.ts \
  test/admin.events.switch.route.test.ts \
  test/admin.events.new.route.test.ts \
  test/admin.settings.team.route.test.ts \
  test/set-password.route.test.ts
```

Confirm forged active event, event switch, event creation organization, membership remove/resend/revoke, invite token, last-member removal, and unsupported role payloads never cross organizations.

- [ ] **Step 5: Fix only newly reproduced breaches**

For each failing attack, preserve the red output, then add the event/org condition at the first lookup or mutation, for example:

```ts
.where(and(eq(resource.id, suppliedId), eq(resource.eventId, activeEvent.id)))
```

or:

```ts
.where(and(eq(resource.id, suppliedId), eq(resource.organizationId, resolvedOrg.id)))
```

Rerun that one test file green before proceeding. If no attack fails, make no production edit and record `PROVEN-SAFE` with the exact test name.

- [ ] **Step 6: Commit only if this task added tests or fixes**

```bash
git add app test
git commit -m "test(security): lock organizer tenant boundaries" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Attack portal identities, public projections, feeds, embeds, and CFP

**Files:**
- Modify: `test/program-feeds.route.test.ts` if the cross-event embed pair is not already asserted
- Modify: `test/public-program.route.test.ts` if the two-event projection is not already asserted
- Modify only for reproduced defects: `app/lib/program.ts`
- Modify only for reproduced defects: `app/routes/feeds.$eventSlug.$kind.tsx`
- Modify only for reproduced defects: `app/routes/embed.$publicId.tsx`
- Reference: `test/portal.access.test.ts`
- Reference: `test/portal.editing.test.ts`
- Reference: `test/portal.tasks.test.ts`
- Reference: `test/portal.profile-files.test.ts`
- Reference: `test/cfp-wizard.route.test.ts`

**Interfaces:**
- Consumes: `seedPortalWorld()`, `seedProgram()`, scoped portal contact identity, event slug, portal/embed/form public IDs.
- Produces: proof that public/portal paths cannot mix IDs between events and expose only accepted+approved+public data.

- [ ] **Step 1: Add a two-event public projection probe if missing**

Seed Org B with an accepted+approved submission, visible speaker, embed, and distinctive title. Request Org A’s sessions, speakers, embed, JSON/XML/ICS feeds, and assert the Org B title/person never appears. Also request Org A’s event slug with Org B’s embed public ID and assert 404.

- [ ] **Step 2: Run the public attacks**

```bash
pnpm test -- \
  test/public-program.route.test.ts \
  test/program-feeds.route.test.ts \
  test/embed.route.test.ts \
  test/public-add-to-calendar.route.test.ts
```

Expected: only Org A accepted+approved rows appear; hidden speakers and contact email/phones do not; agenda/itinerary respect publication; mixed slug/embed IDs 404.

- [ ] **Step 3: Run portal ownership and file attacks**

```bash
pnpm test -- \
  test/portal.access.test.ts \
  test/portal.editing.test.ts \
  test/portal.participation.test.ts \
  test/portal.tasks.test.ts \
  test/portal.profile-files.test.ts \
  test/portal.masking.test.ts
```

Expected: mixed event slug/portal ID, another contact’s submission/assignment/file, and unauthenticated portal requests cannot read or mutate data; ownership derives from the event-scoped portal contact.

- [ ] **Step 4: Run public CFP ID-mixing attacks**

```bash
pnpm test -- \
  test/cfp-account.route.test.ts \
  test/cfp-definition.test.ts \
  test/cfp-wizard.route.test.ts
```

Expected: public form lookup pairs `forms.publicId` with `events.slug`; edits/deletes remain submitter-owned; participant contacts are created/linked only under that form’s event.

- [ ] **Step 5: Fix only a reproduced query leak and rerun green**

Any fix must add the event predicate to the SQL query that loads the public root or child; do not remove foreign rows after retrieval. Preserve strict status/content/public-visible predicates.

- [ ] **Step 6: Commit only if this task added probes or fixes**

```bash
git add app test
git commit -m "test(security): lock public event projections" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Attack API-token restrictions and unauthenticated private routes

**Files:**
- Modify only if a missing probe is found: `test/api.v1.auth.test.ts`
- Modify only if a missing probe is found: `test/api.v1.lookups.test.ts`
- Modify only if a missing probe is found: `test/api.v1.contacts.test.ts`
- Modify only if a missing probe is found: `test/api.v1.sessions.test.ts`
- Modify only if a missing probe is found: `test/403.route.test.ts`
- Reference: `app/api/v1/app.ts`
- Reference: `app/lib/api-token.ts`

**Interfaces:**
- Consumes: Org A unrestricted token, Org A event-A2-restricted token, Org B token, unknown token, and no token.
- Produces: proof that all 24 API endpoints authenticate, root event resolution enforces token organization/event, unsupported writes are 405 after authentication, and private React Router handlers deny missing sessions.

- [ ] **Step 1: Run all API attacks**

```bash
pnpm test -- \
  test/api-token.test.ts \
  test/api.v1.auth.test.ts \
  test/api.v1.lookups.test.ts \
  test/api.v1.contacts.test.ts \
  test/api.v1.sessions.test.ts \
  test/api.v1.files.test.ts
```

Record no-token/unknown-token 401, foreign/sibling-event 404, restricted `/events` output, foreign record IDs absent, raw token absent from responses, and all write suffixes/methods rejected without mutation.

- [ ] **Step 2: Run unauthenticated and wrong-role private-route attacks**

```bash
pnpm test -- test/403.route.test.ts test/admin.route.test.ts test/reviews.route.test.ts
```

Use existing direct-loader/action calls (not parent-layout assumptions) to verify admin routes authenticate themselves and reviewers derive only track-assigned events.

- [ ] **Step 3: Add one direct denial test for any uncovered handler**

For each private loader/action found without a direct auth probe, call it without a Cookie and assert the established redirect/403 status plus unchanged D1. If the handler itself lacks `requireAdmin`/equivalent, first preserve the failing test, then add that guard at the top of the handler.

- [ ] **Step 4: Commit only if this task added tests or fixes**

```bash
git add app test
git commit -m "test(security): lock token and anonymous boundaries" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Finalize findings, verify, judge once, and publish the unmerged PR

**Files:**
- Create: `docs/reviews/tenancy-redteam-H10-dispositions.md` only when judge findings need a durable disposition log
- Update: `/tmp/openrostrum-H10-findings.md`
- Modify product/tests only for verified judge or inline-review findings

**Interfaces:**
- Consumes: Tasks 1–5, exact red/green output, schema inspection, and full branch diff.
- Produces: complete PR-body findings table, green gate/CI, exactly one judge round, resolved review threads, and an unmerged exact-title PR.

- [ ] **Step 1: Complete the findings table**

Every mandatory feature gets a PR results row with `Feature | Two-org case | Result | Change or already-correct`. Each result must end as one of:

```text
FIXED — test failed before the named server query predicate and passed after it.
PROVEN-SAFE — named real-D1 route/domain test passed with Org B data seeded.
NEEDS-SCHEMA — exact missing composite invariant/index/trigger stated; no migration in H10.
NOT-APPLICABLE — only for membership role escalation, because memberships intentionally have no role and no role mutation endpoint.
```

Include counts of fixed breaches and proven-safe surfaces, highest severity, and no unverified claim.

- [ ] **Step 2: Run focused security regressions together**

```bash
pnpm test -- \
  test/auth.tenancy.test.ts \
  test/contact-merge.test.ts \
  test/admin.contacts.compose.route.test.ts \
  test/crm.pipeline.route.test.ts \
  test/admin.submissions.decisions.route.test.ts \
  test/admin.agenda.route.test.ts \
  test/admin.files.route.test.ts \
  test/files.upload-download.route.test.ts \
  test/admin.tasks.assignment.route.test.ts \
  test/admin.emails.route.test.ts \
  test/admin.forms.editor.route.test.ts \
  test/admin.settings.team.route.test.ts \
  test/portal.access.test.ts \
  test/portal.tasks.test.ts \
  test/public-program.route.test.ts \
  test/program-feeds.route.test.ts \
  test/embed.route.test.ts \
  test/api.v1.auth.test.ts \
  test/api.v1.files.test.ts
```

- [ ] **Step 3: Run the full repository gate**

```bash
pnpm verify
git diff --check origin/main...HEAD
git status --short --branch
```

Do not claim completion unless all observed commands pass.

- [ ] **Step 4: Merge moving main append-only**

```bash
git fetch origin
git rev-list --left-right --count HEAD...origin/main
```

If the right count is nonzero:

```bash
git merge --no-edit origin/main
pnpm verify
```

Never rebase.

- [ ] **Step 5: Run exactly one `judge-loop` round**

Build `/tmp/tenancy-redteam-H10-judge.md` containing the mission and complete `git diff origin/main...HEAD`. Invoke three fresh judge agents once with suffix `-H10`. Record every finding as adopted or discarded with an evidence-backed reason. Apply verified findings test-first and rerun focused tests plus `pnpm verify`; do not invoke a second judge round even when a finding is adopted, because H10 explicitly requires exactly one round.

- [ ] **Step 6: Commit final verified changes**

```bash
git add app test docs
git commit -m "test(security): complete tenancy red-team" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Skip this commit if there are no uncommitted changes.

- [ ] **Step 7: Push and create the exact-title PR from the body file**

Put the summary, full findings table, `NEEDS-SCHEMA` section, exact test/verify evidence, judge dispositions, and `DO NOT MERGE` in `/tmp/openrostrum-H10-findings.md`, then:

```bash
git push -u origin test/tenancy-redteam
gh pr create \
  --title "test(tenancy): comprehensive two-organization scoping matrix" \
  --body-file /tmp/openrostrum-H10-findings.md
```

Do not merge.

- [ ] **Step 8: Resolve every inline AI-review thread**

Use GitHub GraphQL to list unresolved threads. For each claim, either add a new failing regression, apply the smallest scoped fix, rerun green, reply with evidence, and resolve; or reply with the exact technical reason/evidence for discarding and resolve. Push any appended commits and wait for:

```bash
gh pr checks --watch
```

- [ ] **Step 9: Print the concise lane report**

Report only the PR URL, fixed-breach count, proven-safe surface count, highest-severity breaches, `NEEDS-SCHEMA` gaps, CI state, and explicit `not merged` status.
