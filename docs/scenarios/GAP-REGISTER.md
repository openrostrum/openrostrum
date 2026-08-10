# Gap register — scenario walk findings (2026-08-09)

Consolidated from the 5 walk files in `docs/scenarios/walks/` (62 scenarios,
every step walked to a concrete artifact). Status: FIXED = design change landed
(schema/code/docs); SPEC'D = binding spec written for the build agent; OPEN =
decision still needed. Corroboration = how many walkers hit it independently.

## BLOCKERS

| # | Gap | Corroboration | Resolution |
|---|-----|---------------|------------|
| G1 | **Single-fetch `_routes` auth bypass**: layout-loader-only GET auth is bypassable (`?_routes=` runs the child loader alone, skipping the layout's `requireAdmin`) — the golden path's own comment taught this hole | seams walker (verified vs `.react-router` types) | FIXED: every protected loader self-authenticates; golden path + `admin.tsx` + CLAUDE.md corrected; ESLint rule extended to loaders |
| G2 | **No current-event mechanism**: golden path `findMany({limit:1})` serves the first event forever; create-event produced events you could never switch into | auth walker (poisons every multi-event scenario) | FIXED: `users.activeEventId` + `getActiveEvent()` helper + switcher; golden path pattern updated |
| G3 | **Built-in-trigger rules unrepresentable**: `questionRule.fieldId` only references `fields.id`; Format/Track/Level are relational columns | 2 walkers + eval kit | FIXED: `questionRule.trigger = {kind:'field',fieldId} \| {kind:'builtin',ref}` |
| G4 | **Built-in field per-form config homeless**: no `form_fields` rows for built-ins → locked/required/order/removable unstorable | 2 walkers | FIXED: `formFields.builtinRef` (nullable, XOR with `fieldId`) + `unique(formId, builtinRef)` |
| G5 | **Suppression/unsubscribe unimplementable**: port has no bulk/transactional distinction, no suppression check anywhere, no unsubscribe route/token design | 2 walkers | FIXED (port contract + check) / SPEC'D (signed unsubscribe link + route) |
| G6 | **`portals` table missing**: `/portals/:eventSlug/:portalId` dangles; success-redirect + email links unconstructible | 4 walkers | FIXED: `portals` table; created with the event; seeded |
| G7 | **Reviewer path broken end-to-end**: no reviewer-facing route (403 everywhere), role-blind login redirect, no set-password route, and `passwordResets.userId NOT NULL` means you can't invite an account-less co-speaker into existence | 3 walkers | FIXED (login redirect by role; blessed sentinel-hash invite pattern documented) / SPEC'D (my-reviews + set-password routes in ROUTE-MAP) |
| G8 | **New events are dead shells**: no default email templates, no portal row provisioned at creation | auth walker | SPEC'D: `app/domain/createEvent.ts` provisions templates + portal (Wave 0/1, integration-owned) |

## MAJOR (selected — full detail in walk files)

| Gap | Resolution |
|-----|------------|
| Accept-spine idempotency: no unique constraint can work (NULL `submissionId` distinct in SQLite) | SPEC'D: `WHERE NOT EXISTS` guards in `app/domain/accept.ts` spec |
| Auto-assigned tasks have no due-date source | FIXED: `tasks.dueInDays` column; dueAt = acceptedAt + days |
| File deny state unrepresentable | FIXED: `files.reviewStatus` + `files.reviewNote` |
| Language options homeless | FIXED: `languages` table (Library-managed, like levels) |
| Email case-sensitivity: cased signup mints duplicate identity | FIXED: `normalizeEmail()` in auth; all lookups/writes lowercase |
| R2 presigned-PUT mandate broken locally + no byte-serving route | FIXED (tech-stack: Worker-mediated up/download) / SPEC'D (routes) |
| Merge-tag rendering unspecified | SPEC'D: tag list + `app/lib/email-render.ts` (Wave 1) |
| Manual-send dedupe/double-submit | SPEC'D: form-minted idempotency key in dedupeKey |
| .ics for unscheduled sessions | DECIDED (rev. 2 — see K14): accept email attaches .ics only if already scheduled, else says "schedule TBA"; the later scheduling triggers the batched schedule-update send with the invite |
| `statusChangedAt`/`notifiedAt` writers unassigned | SPEC'D: status-change action / bulk-send flow stamp them |
| Agenda timezone rule | SPEC'D: store UTC epoch, render in `events.timezone` |
| `schedulableStatuses` no default | FIXED: defaults to `["accepted"]` |
| Track delete cascade silently strips submissions' tracks | FIXED: `restrict` + Library shows "in use by N" |
| Withdraw leaves scheduled ghost on grid | SPEC'D: withdraw unschedules (nulls startsAt/endsAt/roomId) |
| `forms.status` lifecycle undefined | SPEC'D: publish sets `open`; public route reachable iff `open`; `closeAt` gates submission only |
| Wizard step-state carrier | ~~SPEC'D: draft row minted on first VALID submission-step save~~ **SUPERSEDED by K1 below**: draft save requires only a non-empty Title |
| `/api/v1` Hide-PII: Sessionboard models a per-token "Hide PII" flag (default on) + scopes; `api_tokens` has neither column | DECIDED (P1 #20 lane, ratifies walk-09 A2): v1 serializers mask unconditionally — every token is a masked consumer, fails closed. Per-token `hide_pii`/`scopes` columns + their settings UI are an integration-owner follow-up, built with the token-management screen |
| Draft-with-no-participants invisible in portal | SPEC'D: My Submissions = participant-linked ∪ own drafts (UNION) |
| Homeless committed routes (CSV export, email history, task responses, forgot-password, unsubscribe, my-reviews, set-password, files up/download, reviewer mgmt, contacts) | FIXED: ROUTE-MAP rows added |
| Seed ≠ scenario fixtures (named identities, limit=3, scale) | FIXED: seed enriched with scenario fixtures + scale layer |
| One-click accept marked "optional" vs committed scenario | DECIDED: committed (strike "optional") |
| Impersonation commitment ambiguity in SCOPE | DECIDED: stamped COMMITTED in SCOPE |

## Minor items
Tracked inline in the walk files; addressed opportunistically by build agents —
each is a one-line spec clarification already present in walks/scenarios.

## Eval-kit walk findings (2026-08-09) — swyx's v1 judging harness

Source: `docs/reference/killmysaas-evals/` (vendored). Full rubric→owner map:
`docs/eval-crosswalk.md`. Schema, SCOPE (P1 #15–21), and ROUTE-MAP changes
landed the same day; these rows record the binding spec corrections.

Design-time-gate disposition: the 2026-08-09 schema change is **additive only**
(new tables `evaluation_*`, `file_comments`, `submission_revisions`, `embeds`,
`api_tokens`, `airtable_links`; new defaulted columns `contacts.status`,
`contacts.logisticsNotes`, `submissions.contentStatus`,
`events.agendaPublishedAt`, `taskAssignments.reminderSentAt`) — no existing
walked artifact is invalidated, so no re-walk of the 62 scenarios is triggered.
The two behavior changes are K1 (supersedes the earlier wizard draft rule) and
K10 (new public-output gate; public surfaces had no scenarios — the eval kit's
spec YAMLs are their scenarios now, per CLAUDE.md).

| # | Finding | Resolution |
|---|---------|------------|
| K1 | **Draft save required a "valid step"** — kit CFP-07 (and Sessionboard's own docs) save a draft with ONLY a title | FIXED in SCOPE P1 #4: draft save requires only non-empty Title; required-field validation gates step ADVANCE only. Supersedes the earlier wizard-spec rule in this register |
| K2 | **Speaker editing of a SUBMITTED proposal was never committed** (only drafts) — kit CFP-09/16 + ABS-11 (co-author added by edit) depend on it | FIXED: SCOPE P1 #19 — edit-until-close via portal "View Submission"; read-only + editing-closed message after close |
| K3 | **Close-date fields must accept past dates** — the kit closes the CFP by backdating (CFP-S4), then reopens it (ABS-S1) | SPEC'D: no future-only validation on `forms.closeAt` |
| K4 | **Turnstile would zero the speaker path** — the harness is a Playwright agent; it cannot pass a real challenge | DECIDED: judged deploy ships keyless → port resolves to no-op pass (SCOPE cross-cutting note) |
| K5 | **Reviewer persona unreachable via email-only invites** — the agent has no inbox | SPEC'D: reviewer management shows a copyable invite link on-screen (reuses the G7 sentinel-hash pattern) |
| K6 | **User↔contact linking by email is assumed, not spec'd** — kit SPK-S2: speaker signs up with an email already on the roster and must see that contact's sessions/tasks | SPEC'D: on signup/login, link `users` → `contacts` rows by `normalizeEmail` match per event; portal scope = linked contact's data |
| K7 | **Native `confirm()` is not a guard** — the harness auto-accepts native dialogs | SPEC'D: destructive confirms are in-app modals (Radix) only |
| K8 | **Aggregate/ordering conventions** — people-lists alphabetical by surname (EMB-04/12); results table sortable both directions (ABS-10); weighted aggregate = Σ(value×weight)/Σ(weight) over rating questions (ABS-04) | SPEC'D (binding for the widget + evaluation builders) |
| K9 | **Personal schedule persistence** — kit accepts localStorage (EMB-11) | DECIDED: localStorage, no account required for browsing or starring |
| K10 | **Content approval gates public output** — approval ≠ accept decision (CNT-12) | FIXED: `submissions.contentStatus` (draft/in_review/approved); every public widget filters on approved; accept-spine sets `in_review` (rev. per K15) until the organizer approves (seed approves accepted demo rows) |
| K11 | **Publish is a real action** (AIA-07) | FIXED: `events.agendaPublishedAt` set by the agenda Publish button; gates agenda+itinerary widgets only |
| K12 | **Coverage math**: <60% rubric coverage → score withheld entirely | DECIDED: run the vendored kit against our deploy before submitting (VERIFICATION-CAPABILITIES #10) |

## UX-audit corrections (2026-08-09) — engineering-brain reversals

Found by auditing every DECIDED/SPEC'D row from the user's seat ("does this
protect the system at the expense of the person using it?"). The Airtable
delete rev. 2 (zombie rows → honor-the-delete) and webhook-first sync live in
`docs/airtable-sync-design.md`; these rows are the rest.

| # | Correction | Resolution |
|---|-----------|------------|
| K13 | **Suppression must never eat an acceptance.** Old rule classed accept/decline blasts as suppressible bulk → an unsubscribed speaker never learns they were accepted | FIXED: `kind:"bulk"` = general announcements ONLY (compose-to-speakers); confirmations, decisions, invites, resets, task/draft reminders, schedule updates are `transactional` and always deliver. Port contract comment + SCOPE cross-cutting updated; unsubscribe page copy states the split |
| K14 | **Accept-then-schedule-later never received a calendar invite** (accept email said "schedule TBA" and nothing followed up) | FIXED (SCOPE P0 #8): schedule changes accumulate per speaker → explicit "N speakers have unsent schedule updates → Send" batched action; .ics keeps stable UID + increments SEQUENCE so calendar clients update in place; dedupeKey = submission + schedule-version |
| K15 | **Triple gate (accepted → content-approved → agenda-published) reads as a bug** without affordances | FIXED (SCOPE P1 #18): accept spine sets `contentStatus='in_review'`; bulk "Approve all accepted"; dashboard alert "N accepted sessions aren't public yet"; Published/Unpublished chip on the agenda header. Supersedes K10's "stays draft" note — gate mechanics unchanged |
| K16 | **CSV import deduped silently** ("imported 100, why 97?") | FIXED (SCOPE P1 #17): import ends on a summary — added / merged-by-email / skipped with per-row reasons |
| K17 | **Task reminder never re-fires after a deadline extension** (one-shot `reminderSentAt`) | FIXED (SCOPE P1 #17): editing `dueAt` clears `reminderSentAt`; reminder `dedupeKey` includes the due date so outbox idempotency doesn't block the re-send |
