# Submissions UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make submission navigation, public draft resume, rich-text focus, and decision-email dispatch reliable and explicitly reviewable.

**Architecture:** Fix navigation and hydration at their source, keep the canonical Tiptap editor, and separate visual labels from composite controls. Extract a read-only decision-email plan from the existing sender so preview and confirmed delivery render identical recipients/content while the existing outbox, dedupe key, and finalize logic remain authoritative.

**Tech Stack:** React Router 7, React 19, Tiptap/ProseMirror, Drizzle/D1, Cloudflare workerd Vitest, Tailwind.

## Global Constraints

- Every bug fix gets a regression test that fails without the fix.
- Use local D1/workerd and the local email sink only; never access remote bindings or production data.
- Keep decision queues silent; only explicit confirmed sends notify and finalize.
- Preserve `decision:${decision}:${idempotencyKey}:${submissionId}` dedupe identity and partial-failure behavior.
- Use in-app confirmation only; never native `confirm()`.
- Run `pnpm verify` before committing implementation.
- Run exactly one judge-loop round with suffix `-F2`; do not merge the PR.

---

### Task 1: Reliable organizer submission navigation

**Files:**
- Modify: `app/ui/table.tsx`
- Modify: `app/routes/admin.submissions.tsx`
- Test: `test/admin.submissions.route.test.ts`

**Interfaces:**
- Consumes: existing `/admin/submissions/:submissionId` detail route.
- Produces: `Tr` forwards standard row HTML props; every All Submissions title is a `Link`, and non-control row clicks call `navigate()`.

- [ ] Add a failing rendered-route test asserting the title anchor has `href="/admin/submissions/s1"`.
- [ ] Run `pnpm test -- test/admin.submissions.route.test.ts`; expect the anchor assertion to fail.
- [ ] Extend `Tr` with `ComponentPropsWithoutRef<"tr">`, merge `className`, and forward remaining props.
- [ ] Import `Link`/`useNavigate`; render the title as a link and add a row click handler that returns when `event.target.closest("a,button,input,select,textarea,label")` matches.
- [ ] Run the targeted test; expect PASS.

### Task 2: Hydration-safe public draft resume

**Files:**
- Modify: `app/routes/submit.$eventSlug.$formId.step.session.tsx`
- Modify: `app/cfp/ui.tsx`
- Test: `test/cfp-wizard.route.test.ts`

**Interfaces:**
- Consumes: `formatInTz(date, event.timezone)` and layout loader timezone.
- Produces: deterministic draft/last-saved strings and a flow-content `FootNote` that may legally contain a form.

- [ ] Add failing tests asserting event-timezone draft timestamps and `<div>`-based `FootNote` markup containing a form.
- [ ] Run `pnpm test -- test/cfp-wizard.route.test.ts`; expect timestamp/tag assertions to fail.
- [ ] Replace both no-argument `toLocaleString()` calls with `formatInTz(new Date(value), layout.event.timezone)`; pass timezone into `DraftsHub`.
- [ ] Change `FootNote` from `<p>` to `<div>` without changing styling.
- [ ] Run the targeted test; expect PASS and no `p > form` output.

### Task 3: Prevent RichText label activation

**Files:**
- Modify: `app/ui/field.tsx`
- Modify: `app/cfp/fields.tsx`
- Modify: `app/routes/submit.$eventSlug.$formId.step.participant.tsx`
- Modify: `app/routes/admin.emails_.$key.tsx`
- Modify: `app/routes/admin.portal-forms.tsx`
- Modify: `app/routes/admin.forms.$formId.tsx`
- Test: `test/ui.field.test.tsx`

**Interfaces:**
- Produces: `Field({ composite?: boolean })`; composite mode renders a `<div>`, while default mode preserves native `<label>` behavior.

- [ ] Add a failing server-render test proving default Field uses `<label>` and composite Field uses `<div>` around toolbar buttons.
- [ ] Run `pnpm test -- test/ui.field.test.tsx`; expect composite markup to fail.
- [ ] Implement `composite` with one shared content block and conditional container.
- [ ] Apply `composite` to every Field wrapping RichText and to public multi-dropdown checkbox groups; add direct `ariaLabel` values to contenteditables that relied on outer labels.
- [ ] Run the targeted test; expect PASS.

### Task 4: Shared decision-email preview plan

**Files:**
- Modify: `app/domain/accept.ts`
- Test: `test/accept.domain.test.ts`

**Interfaces:**
- Produces: `previewDecisionEmails(db, env, { event, rows, decision, origin })` returning template metadata, deliverable recipient rows (`submissionId`, `title`, `to`, `subject`, `html`, `hasCalendarAttachment`), skipped rows, and a deterministic SHA-256 fingerprint.
- `sendDecisionEmails` accepts optional `previewFingerprint`; a mismatch throws `StaleDecisionPreviewError` before sender/outbox/status writes.

- [ ] Add failing tests for exact rendered recipient preview, missing-email skips, zero outbox/status writes, stable fingerprint, and stale fingerprint rejection.
- [ ] Run `pnpm test -- test/accept.domain.test.ts`; expect missing exports/behavior failures.
- [ ] Extract template/recipient/merge/calendar preparation into an internal plan builder.
- [ ] Make preview map the plan without calling `getEmailSender`; compute fingerprint over rendered plan fields.
- [ ] Make send consume the same plan, compare an expected fingerprint before dispatch, then preserve current sender loop, notification stamps, dedupe keys, and results.
- [ ] Run domain tests; expect PASS, including existing replay/partial-failure tests.

### Task 5: Decision preview route and dialog

**Files:**
- Modify: `app/routes/admin.submissions.tsx`
- Test: `test/admin.submissions.decisions.route.test.ts`
- Test: `test/admin.submissions.route.test.ts`

**Interfaces:**
- Consumes: `previewDecisionEmails`, `StaleDecisionPreviewError`, and selection-scoped `sendKey`.
- Produces: `preview-accept`/`preview-decline` read-only intents and confirmed `send-accept`/`send-decline` intents requiring `previewFingerprint`.

- [ ] Add failing route tests: preview returns exact rendered recipients and writes no outbox/status/task rows; direct send without a preview fingerprint is rejected; matching confirmation sends/finalizes once; stale confirmation writes nothing.
- [ ] Run `pnpm test -- test/admin.submissions.decisions.route.test.ts`; expect failures.
- [ ] Add preview validation and a shared eligible-row loader; include route-level missing/ineligible skips.
- [ ] Require `previewFingerprint` in confirmed send schema and pass it into the existing send/finalize path; map stale preview to actionable copy.
- [ ] Change bulk send controls to `type="button"` and submit preview intents through a fetcher.
- [ ] Add route-local `DecisionPreviewDialog` showing selected/deliverable counts, template/reply-to, exact recipient list, skipped reasons, per-recipient subject/body in sandboxed `EmailPreview`, attachment state, Cancel, and explicit send/finalize copy.
- [ ] Confirm through the fetcher with the same `sendKey` and preview fingerprint; disable while busy and retain the key after failures.
- [ ] Run both targeted route tests; expect PASS.

### Task 6: Verification and delivery

**Files:**
- Modify only if verification reveals a defect.

- [ ] Run all targeted tests from Tasks 1–5.
- [ ] Run `pnpm verify`; require all checks green.
- [ ] Temporarily disable remote bindings only for local launch if needed, run `pnpm dev:worktree`, and use Chrome against local D1 to verify: title/row navigation while controls remain inert; one-click Resume with zero hydration errors; Description/Biography focus leaves Bold false and typed HTML plain; preview/cancel writes nothing; confirmed accept/decline sends once and finalizes through `email_outbox`.
- [ ] Restore any temporary dev-only config and confirm clean intended diff.
- [ ] Run `/judge-loop` exactly once with suffix `-F2`; fix or record every disposition.
- [ ] Re-run `pnpm verify`, commit implementation with the required co-author trailer, push `fix/submissions-ux-fix`, and open PR `fix(submissions): reliable navigation, draft resume, editor state, decision-email preview` with a decision-record body.
- [ ] Inspect PR checks and inline AI-review threads, apply valid fixes test-first, resolve every thread, push updates, and report actual CI state without merging.
