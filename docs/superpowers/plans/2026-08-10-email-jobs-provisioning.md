# Email Jobs and Event Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and prove timezone-safe draft-close reminders, compliant announcement blasts, and atomic fresh-event onboarding task defaults on the existing lane branch.

**Architecture:** Preserve the branch's implemented vertical slices, merge current `origin/main` append-only, and reconcile main's rendered-decision-email work before changing shared email code. Close only verified gaps test-first, using real local D1 and the local email sink, then prove the three user flows in a running worktree app before PR review.

**Tech Stack:** React Router 7, TypeScript 5.9, Cloudflare Workers/workerd, D1, Drizzle ORM, Vitest 4, Wrangler 4, pnpm 10.

## Global Constraints

- Work only in the existing `feat/email-jobs-provisioning` worktree and preserve its commits.
- Fetch and merge `origin/main` append-only before further implementation; never rebase.
- Reconcile main's rendered-decision-email changes before editing overlapping email renderer or decision-send code.
- Use D1; do not introduce another database, queue, or dependency.
- Tests are hermetic: real local D1 and local/fake process boundaries only; never contact Resend.
- Reminder occurrences use event-timezone calendar math: five-day sends at 5–2 days, one-day sends at 1–0 days, never at/after close.
- Announcement delivery goes only through `sendAnnouncement`; unsubscribe footer, bulk suppression, and outbox recording stay coupled.
- `provisionEventDefaults` returns unexecuted statements for the caller's atomic event-creation batch.
- Run `pnpm verify`, live-test all three missions with `pnpm dev:worktree`, and run judge-loop with suffix `-email-jobs` for at most three rounds.
- Create/update the PR with a decision-record body, resolve every inline AI-review thread, and do not merge.

---

## File map

- `app/jobs/draft-reminders.scheduled.ts` — reminder window selection, recipient grouping, shared rendering, durable send identity, and scheduled-job registration.
- `app/routes/admin.contacts_.compose.tsx` — recipient snapshot, preview, announcement orchestration, partial-failure retry state, and stable blast key.
- `app/lib/announcements.ts` — the only compliant announcement send API; signs footer and forces bulk classification.
- `app/lib/unsubscribe.ts` and `app/routes/unsubscribe.$token.tsx` — signed unsubscribe round-trip and idempotent suppression.
- `app/domain/provisionEvent.ts` — default templates, portal/forms, and onboarding task statements for fresh events.
- `app/domain/accept.ts` — acceptance transition and task-assignment minting; main owns the latest decision-rendering changes.
- `test/draft-reminders.job.test.ts` — timezone windows, toggle, retry, rendering, and outbox identities.
- `test/admin.contacts.compose.route.test.ts` — real compose action, helper coupling, suppression, retry, and blast identity.
- `test/unsubscribe.route.test.ts` and `test/email.suppression.test.ts` — public unsubscribe and bulk-versus-transactional behavior.
- `test/seed-provision.lockstep.test.ts` — independent fresh-event defaults and accepted-speaker assignments.
- `test/admin.submissions.decisions.route.test.ts`, `test/accept.domain.test.ts`, and `test/email-render.test.ts` — regression gate for main's rendered-decision-email work.
- `docs/reviews/email-jobs-dispositions.md` — judge findings and evidence-backed dispositions.

---

### Task 1: Append-only integration of current main

**Files:**
- Potential conflict resolution only in files changed by both branches.

**Interfaces:**
- Consumes: clean `feat/email-jobs-provisioning` branch with the existing lane commits and design commit.
- Produces: merge commit whose history contains current `origin/main` and all lane commits.

- [ ] **Step 1: Confirm the branch is clean and fetch current refs**

Run:

```bash
git status --short --branch
git fetch origin
git merge-base --is-ancestor origin/main HEAD; printf 'ancestor=%s\n' "$?"
```

Expected: clean worktree; `ancestor=1` before the merge when main has advanced.

- [ ] **Step 2: Merge main without rebasing**

Run:

```bash
git merge --no-ff --no-edit origin/main
```

If conflicts occur, retain main's current decision renderer/send behavior and retain the lane's reminder job, `sendAnnouncement` compose path, unsubscribe support, and default task statements. Do not choose whole-file `ours` or `theirs` for shared email files.

- [ ] **Step 3: Prove ancestry and inspect the merge**

Run:

```bash
git merge-base --is-ancestor origin/main HEAD
git status --short
git diff --check origin/main...HEAD
git log --oneline --decorate --graph -12
```

Expected: the ancestry command exits 0, the worktree is clean, and all original lane commits remain visible.

---

### Task 2: Reconcile shared renderer and decision-email overlap

**Files:**
- Inspect/modify only if required: `app/lib/email-render.ts`
- Inspect/modify only if required: `app/domain/accept.ts`
- Test: `test/email-render.test.ts`
- Test: `test/accept.domain.test.ts`
- Test: `test/admin.submissions.decisions.route.test.ts`

**Interfaces:**
- Consumes: main's merged merge-tag syntax and decision email context.
- Produces: one renderer API used by previews, reminders, compose, and decision emails without regressing verified triple-brace/dotted-path support.

- [ ] **Step 1: Compare both sides of the overlap before editing**

Run:

```bash
git diff origin/main...HEAD -- app/lib/email-render.ts app/domain/accept.ts test/email-render.test.ts test/accept.domain.test.ts test/admin.submissions.decisions.route.test.ts
git log -p -1 origin/main -- app/lib/email-render.ts app/domain/accept.ts
```

Decision rule: main's verified decision rendering is authoritative; adapt lane callers to its public renderer rather than restoring an older renderer implementation.

- [ ] **Step 2: Run the overlap regression tests**

Run:

```bash
pnpm test -- test/email-render.test.ts test/accept.domain.test.ts test/admin.submissions.decisions.route.test.ts
```

Expected: all rendered-decision, merge-tag, `.ics`, idempotency, and finalize-after-send cases pass. If a conflict resolution broke a caller, the failing assertion must reproduce before code changes.

- [ ] **Step 3: Make the smallest reconciliation, if a test fails**

Keep the existing public renderer signatures from main. Reminder and compose contexts must map their values into that API; decision sends must continue rendering subject/body before calling the sender. Never create a second merge parser.

- [ ] **Step 4: Re-run the overlap tests and commit only real reconciliation**

Run:

```bash
pnpm test -- test/email-render.test.ts test/accept.domain.test.ts test/admin.submissions.decisions.route.test.ts
git diff --check
```

If files changed:

```bash
git add app/lib/email-render.ts app/domain/accept.ts test/email-render.test.ts test/accept.domain.test.ts test/admin.submissions.decisions.route.test.ts
git commit -m "fix(email): reconcile decision rendering after main merge" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Pin reminder missed-window and failed-send recovery

**Files:**
- Modify: `test/draft-reminders.job.test.ts`
- Modify only if the failure test needs injection: `app/jobs/draft-reminders.scheduled.ts`

**Interfaces:**
- Consumes: `reminderWindow(now, closeAt, timeZone)` and `getEmailSender(env)`.
- Produces: `runDraftCloseReminders(env, clock, sender?)`, where the optional sender implements `EmailSender`; production callers omit it.

- [ ] **Step 1: Add a failing late-toggle integration test**

Add a case that seeds `sendReminders: false`, updates the form to `sendReminders: true` two event-calendar days before close, runs the job twice, and asserts:

```ts
expect(first).toEqual({ sent: 1, deduped: 0, failed: 0 });
expect(replay).toEqual({ sent: 0, deduped: 1, failed: 0 });
expect(await db.select().from(emailOutbox)).toHaveLength(1);
expect((await db.select().from(emailOutbox))[0]?.templateId).toBe("et_rem5");
```

This pins the ranged-window policy and its one-occurrence marker.

- [ ] **Step 2: Add a failing failed-send recovery test**

Pass a hermetic sender whose first `send` throws and then rerun with the local D1 sender. Assert the first result is `{ sent: 0, deduped: 0, failed: 1 }`, no successful outbox marker exists, and the retry creates exactly one row with the expected dedupe key.

Use the production-compatible signature:

```ts
export async function runDraftCloseReminders(
  env: Env,
  clock: Clock,
  sender: EmailSender = getEmailSender(env),
): Promise<{ sent: number; deduped: number; failed: number }>
```

- [ ] **Step 3: Run the new tests and observe the intended failure**

Run:

```bash
pnpm test -- test/draft-reminders.job.test.ts
```

Expected before injection support: the failed-send test cannot pass a sender or otherwise proves the missing seam.

- [ ] **Step 4: Add only the sender injection seam**

Import `EmailSender` as a type from `~/ports/email`, add the optional parameter shown above, and remove the inner `const sender = getEmailSender(env)`. Do not change scheduled registration; `job.run` continues calling `runDraftCloseReminders(env, systemClock)`.

- [ ] **Step 5: Prove all reminder contracts**

Run:

```bash
pnpm test -- test/draft-reminders.job.test.ts test/scheduled.dispatch.test.ts
```

Expected: timezone edges, toggle-off, late toggle-on, replay dedupe, deadline rearm, shared rendering, suppression bypass, tenant isolation, and failed-send retry all pass.

- [ ] **Step 6: Commit**

```bash
git add app/jobs/draft-reminders.scheduled.ts test/draft-reminders.job.test.ts
git commit -m "test(email): pin reminder retry and late-toggle behavior" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Make announcement partial failures safely retryable

**Files:**
- Modify: `test/admin.contacts.compose.route.test.ts`
- Modify: `app/routes/admin.contacts_.compose.tsx`
- Regression tests: `test/unsubscribe.route.test.ts`
- Regression tests: `test/email.suppression.test.ts`

**Interfaces:**
- Consumes: `sendAnnouncement(env, origin, message)` and Resend adapter outbox retry semantics.
- Produces: a form-state response with the original `sendKey` whenever any recipient fails, allowing same-key retry without resending successes.

- [ ] **Step 1: Add a failing partial-provider-failure route test**

Use a production-shaped local env with `RESEND_API_KEY`, `EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, and a stubbed global `fetch`. Return 200 for the first confirmed contact and 500 for the second. Assert:

```ts
expect(first.step).toBe("form");
expect(first.sendKey).toBe("send-key-1");
expect(first.formError).toMatch(/retry/i);
expect(await db.select().from(emailOutbox)).toHaveLength(2);
```

On a second POST with the same `sendKey`, make the provider return 200 and assert the prior success dedupes, the failed row retries in place, provider fetch runs only for the failed recipient, and both outbox rows end in `sent`.

- [ ] **Step 2: Add a failing blank-key test**

POST `sendKey: "   "` and assert every resulting dedupe key matches `^bulk:[^:]+:(c_alice|c_carol)$` and none starts with `bulk::` or `bulk:   :`.

- [ ] **Step 3: Run the compose route tests and observe both failures**

Run:

```bash
pnpm test -- test/admin.contacts.compose.route.test.ts
```

Expected: current code returns terminal `step: "sent"` after a per-recipient failure and accepts whitespace as the blast identity.

- [ ] **Step 4: Normalize the blast key and return retryable form state**

Replace key extraction with:

```ts
const postedSendKey = String(form.get("sendKey") ?? "").trim();
const sendKey = postedSendKey || crypto.randomUUID();
```

After calculating `failed`, return the existing `formStep` when `failed > 0`:

```ts
if (failed > 0) {
  return formStep({
    formError: `${failed} recipient${failed === 1 ? "" : "s"} failed. Retry to send only to recipients who have not received it yet.`,
  });
}
```

The retry resubmits the resolved recipient snapshot and original `sendKey`; sent rows dedupe and failed outbox rows retry in place.

- [ ] **Step 5: Run announcement and unsubscribe regressions**

Run:

```bash
pnpm test -- test/admin.contacts.compose.route.test.ts test/unsubscribe.route.test.ts test/email.suppression.test.ts test/email.resend.test.ts
```

Expected: compose uses signed unsubscribe links, suppresses bulk mail before outbox insertion, retains transactional delivery, and retries partial failures safely.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin.contacts_.compose.tsx test/admin.contacts.compose.route.test.ts
git commit -m "fix(email): retain safe retries for partial blasts" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Make fresh-event defaults an independent acceptance contract

**Files:**
- Modify: `test/seed-provision.lockstep.test.ts`
- Modify only if merge reconciliation removed defaults: `app/domain/provisionEvent.ts`

**Interfaces:**
- Consumes: `provisionEventDefaults(db, eventId)` and `transitionSubmissions(db, submissions, "accepted")`.
- Produces: fresh events with five known email templates and exactly three onboarding task definitions whose scopes and portal-form links mint three open assignments on acceptance.

- [ ] **Step 1: Replace derived test oracles with fixed product expectations**

Define independent constants in the test:

```ts
const EXPECTED_TEMPLATE_KEYS = [
  "accept",
  "decline",
  "reminder_1day",
  "reminder_5day",
  "submission_confirmation",
];

const EXPECTED_TASKS = [
  { name: "Flight Reimbursement", type: "contact", required: true },
  { name: "Hotel & Travel Reservations", type: "contact", required: true },
  { name: "Presentation Upload", type: "submission", required: false },
];
```

Assert both seed and provisioned rows independently equal these values. For both contact tasks, assert a non-null portal form from the same event with a non-empty schema. Assert Presentation Upload is a file request without a portal form.

- [ ] **Step 2: Strengthen the fresh-event acceptance assertion**

After `transitionSubmissions`, compare assignments to the fixed task names, assert two contact assignments have `submissionId === null`, one submission assignment references the accepted submission, and every status is `incomplete`.

- [ ] **Step 3: Run the test and repair only genuine drift**

Run:

```bash
pnpm test -- test/seed-provision.lockstep.test.ts test/accept.domain.test.ts
```

Expected: current atomic defaults and accept spine pass. If main changed a schema/API, update `provisionEventDefaults` minimally while keeping generated hotel/flight form IDs referenced by their task statements.

- [ ] **Step 4: Commit**

```bash
git add app/domain/provisionEvent.ts test/seed-provision.lockstep.test.ts
git commit -m "test(events): pin provisioned onboarding defaults" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Run the complete local verification gate

**Files:**
- Modify only files required by failures attributable to this lane.

**Interfaces:**
- Consumes: all merged and lane changes.
- Produces: fresh evidence that the repository-wide gate is green.

- [ ] **Step 1: Run all lane-focused tests together**

```bash
pnpm test -- test/draft-reminders.job.test.ts test/scheduled.dispatch.test.ts test/admin.contacts.compose.route.test.ts test/unsubscribe.route.test.ts test/email.suppression.test.ts test/email.resend.test.ts test/seed-provision.lockstep.test.ts test/accept.domain.test.ts test/admin.submissions.decisions.route.test.ts test/email-render.test.ts
```

Expected: all pass in workerd with local D1; no external fetch escapes the test process.

- [ ] **Step 2: Run the full project gate**

```bash
pnpm verify
```

Expected: map check, type generation/typecheck, ESLint, CSS lint, and the complete Vitest suite all pass.

- [ ] **Step 3: Confirm a clean, reviewable tree**

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: no uncommitted files and no whitespace errors.

---

### Task 7: Live-verify all three user outcomes in the worktree app

**Files:**
- No product edits unless a live defect is reproduced.

**Interfaces:**
- Consumes: `pnpm dev:worktree`, seeded admin login, local D1, and local `email_outbox`.
- Produces: observed UI plus D1 evidence for reminders, unsubscribe suppression, and fresh-event acceptance assignments.

- [ ] **Step 1: Reset and start the isolated app**

Run:

```bash
pnpm db:reset
pnpm dev:worktree
```

Capture the printed local URL. Keep the server running and use the `run` skill/browser workflow for UI actions.

- [ ] **Step 2: Prove announcement delivery and unsubscribe round-trip**

Log in as `admin@example.com` / `password`, open the contacts roster, select a local test contact, compose an announcement, preview recipient merge fields, and send. Query local D1:

```bash
npx wrangler d1 execute openrostrum --local --json --command "SELECT \"to\", subject, html, status, dedupe_key FROM email_outbox WHERE dedupe_key LIKE 'bulk:%' ORDER BY created_at DESC LIMIT 5"
```

Open the exact unsubscribe URL stored in the newest row while logged out. Send another announcement to the same address. Prove the suppression exists and the second blast created no new outbox row:

```bash
npx wrangler d1 execute openrostrum --local --json --command "SELECT email, reason FROM email_suppressions ORDER BY created_at DESC LIMIT 5"
```

- [ ] **Step 3: Prove fresh-event defaults and accepted-speaker assignments**

Create a fresh organization/event through the real onboarding/event UI. Capture its event ID from local D1, then assert the three exact task definitions and their portal-form references. Create or attach a speaker and pending submission through the admin UI, accept/finalize it, and query:

```bash
npx wrangler d1 execute openrostrum --local --json --command "SELECT name, type, required, is_onboarding_default, portal_form_id FROM tasks WHERE event_id = (SELECT id FROM events ORDER BY created_at DESC LIMIT 1) ORDER BY name"
npx wrangler d1 execute openrostrum --local --json --command "SELECT ta.contact_id, ta.submission_id, ta.status, t.name, t.type FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.event_id = (SELECT id FROM events ORDER BY created_at DESC LIMIT 1) ORDER BY t.name"
```

Expected: hotel and flight are required contact tasks with forms; presentation is optional/submission-scoped; acceptance minted two shared contact assignments and one submission assignment.

- [ ] **Step 4: Prove the reminder job against the running app's D1**

Through the form editor, enable reminders and set an open form close instant inside the event-timezone five-day window. Save a real draft through the public CFP. Trigger the local scheduled handler using Wrangler's scheduled test endpoint if exposed by the running dev worker:

Set `DEV_URL` to the exact URL printed by `pnpm dev:worktree`, then invoke:

```bash
curl -i "$DEV_URL/__scheduled?cron=0+*+*+*+*"
```

If React Router dev does not expose `__scheduled`, stop only the server process, start the same Worker/state with `pnpm exec wrangler dev --test-scheduled`, invoke the endpoint, then restart `pnpm dev:worktree` to inspect the UI. Query:

```bash
npx wrangler d1 execute openrostrum --local --json --command "SELECT \"to\", subject, status, dedupe_key, template_id FROM email_outbox WHERE dedupe_key LIKE 'reminder_5day:%' ORDER BY created_at DESC"
```

Invoke the same cron again and prove the row count and dedupe key are unchanged. Disable the form toggle, move the close instant to rearm the occurrence, invoke again, and prove no new reminder row appears.

- [ ] **Step 5: Record exact evidence**

Save observed URLs, relevant row IDs/dedupe keys, counts, and command outcomes in the PR body. Do not include secrets, unsubscribe tokens, or recipient content.

---

### Task 8: Run judge-loop and disposition every finding

**Files:**
- Create: `docs/reviews/email-jobs-dispositions.md`
- Modify product/tests only for accepted findings.

**Interfaces:**
- Consumes: green `pnpm verify` and live verification evidence.
- Produces: at most three independent review rounds with every finding marked fixed, rejected with evidence, or deferred only when an existing binding scope ruling permits it.

- [ ] **Step 1: Invoke judge-loop round 1**

Invoke the `judge-loop` skill with suffix `-email-jobs`, reviewing the complete `origin/main...HEAD` diff against the lane mission, `SCOPE.md`, scenarios, engineering rules, and THE LENS.

- [ ] **Step 2: Write the disposition log**

Use this exact structure for every finding:

```markdown
# Email Jobs Judge Dispositions

## Round 1

### J1 — Exact title copied from the judge output
- Verdict: fixed | rejected | deferred-by-binding-ruling
- Evidence: exact clickable source location plus command/test output
- Change: exact commit hash, or "none"
- Reason: user-visible outcome and governing rule
```

No finding may disappear between rounds.

- [ ] **Step 3: Fix accepted findings test-first and re-verify**

For each accepted correctness finding, add a reproducing test, observe failure, implement the smallest fix, rerun targeted tests, and commit. After the round's fixes run `pnpm verify` again.

- [ ] **Step 4: Repeat only until converged, maximum three rounds**

Run rounds 2 and 3 only when the previous round found actionable issues. Stop at convergence or after round 3. Append all rounds to the same disposition log and commit it:

```bash
git add docs/reviews/email-jobs-dispositions.md
git commit -m "docs(email): record judge-loop dispositions" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Publish the PR, resolve review threads, and wait for CI

**Files:**
- Update PR body only; no merge.

**Interfaces:**
- Consumes: committed branch, green local verification, live evidence, and judge dispositions.
- Produces: pushed branch and open PR with green/accurately reported CI and zero unresolved AI-review threads.

- [ ] **Step 1: Run completion verification immediately before publishing**

Invoke `superpowers:verification-before-completion`, then run its required evidence commands including a fresh `pnpm verify`, `git status --short`, and branch ancestry check.

- [ ] **Step 2: Push the existing branch**

```bash
git push origin feat/email-jobs-provisioning
```

- [ ] **Step 3: Create or update the PR with a decision record**

Use `gh pr list --head feat/email-jobs-provisioning --json number,url,state` to find an existing PR. Create one only if absent; otherwise update it. The body must contain:

```markdown
## User outcomes
- Draft holders receive timezone-correct, replay-safe close reminders.
- Announcement unsubscribes suppress later blasts without silencing transactional mail.
- Fresh events mint hotel, flight, and presentation work when a speaker is accepted.

## Decision record
- Merged current main append-only; no rebase.
- Kept main's rendered-decision-email implementation as the shared-renderer authority.
- Used durable outbox identities instead of a new queue.
- Kept announcement compliance inseparable in sendAnnouncement.
- Provisioned task/form statements in the event-creation atomic batch.

## Verification
- Targeted tests: copy the exact Vitest summary produced in Task 6.
- pnpm verify: copy the exact final command result produced in Task 6.
- Live worktree: record announcement/outbox, logged-out unsubscribe/suppression, reminder replay/toggle, and fresh-event assignment evidence from Task 7.

## Judge-loop dispositions
- Record the exact round count and fixed/rejected totals, and link `docs/reviews/email-jobs-dispositions.md`.

## Known limits
- Only limits already authorized by binding scope/GAP rulings.

DO NOT MERGE — lane handoff only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Wait for CI and report the observed result**

```bash
PR_NUMBER="$(gh pr list --head feat/email-jobs-provisioning --json number --jq '.[0].number')"
gh pr checks "$PR_NUMBER" --watch --interval 30
```

If CI fails, inspect the failing job/log, reproduce locally, fix test-first, rerun `pnpm verify`, commit, push, and watch again.

- [ ] **Step 5: Resolve every inline AI-review thread**

Query unresolved review threads through GitHub GraphQL. For each thread, verify the claim against current code. Apply valid feedback test-first; reply with evidence for invalid or already-fixed feedback; then resolve the thread through `resolveReviewThread`. Push any fixes and re-run CI. Repeat until the unresolved thread count is zero.

- [ ] **Step 6: Stop without merging and print the complete lane report**

The final report must include the PR number/link, observed CI state, per-fix test and live evidence, merge/main reconciliation decision, every judge and AI-review disposition, remaining authorized limits, and an explicit statement that the PR was not merged.
