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
| Accept-spine idempotency: no unique constraint can work (NULL `submissionId` distinct in SQLite) | RESOLVED (owner ruling 2026-08-10): idempotency splits by scope — two partial unique indexes on `task_assignments`: `(taskId, contactId) WHERE submission_id IS NULL` for contact tasks, `(taskId, contactId, submissionId) WHERE submission_id IS NOT NULL` for submission tasks. A multi-talk speaker gets one submission-task assignment PER accepted talk; re-accepts stay no-ops; `accept.assignment_skipped` fires only for true duplicates. Race guard is a targetless `onConflictDoNothing` (SQLite cannot address a partial index as an ON CONFLICT target) |
| Decision-send flow depth (template pick + per-recipient preview + in-app confirm, review scenarios RV-S3/RV-S5) | FIXED (submissions-ux F2, 2026-08-11): bulk accept/decline actions first build a read-only server plan with exact recipients, rendered subject/body, attachment state, and explicit skips. Cancel writes nothing; confirmation requires the plan fingerprint and selection-stable idempotency key before the existing outbox/send/finalize spine runs. The shared Modal primitive provides the in-app boundary. |
| Failed decision sends have no Queue/DLQ (tech-stack email rule) | DECIDED (integration owner, 2026-08-10, with T1/C3): bounded retry ACCEPTED for the window — sends run inline, bounded by the 100/send cap + selection-stable idempotency keys (a retry after any failure dedupes already-sent rows). Queue infra = follow-up S1 |
| Auto-assigned tasks have no due-date source | FIXED: `tasks.dueInDays` column; dueAt = acceptedAt + days |
| File deny state unrepresentable | FIXED: `files.reviewStatus` + `files.reviewNote` |
| Language options homeless | FIXED: `languages` table (Library-managed, like levels) |
| Email case-sensitivity: cased signup mints duplicate identity | FIXED: `normalizeEmail()` in auth; all lookups/writes lowercase |
| R2 presigned-PUT mandate broken locally + no byte-serving route | FIXED (tech-stack: Worker-mediated up/download) / SPEC'D (routes) |
| Merge-tag rendering unspecified | SPEC'D: tag list + `app/lib/email-render.ts` (Wave 1) |
| Manual-send dedupe/double-submit | SPEC'D: form-minted idempotency key in dedupeKey |
| .ics for unscheduled sessions | DECIDED (rev. 3, accept-spine PR — supersedes rev. 2's "only if scheduled"): the accept email ALWAYS attaches an .ics — exact times + room when scheduled, else a save-the-date hold spanning the event with "schedule to be announced" body copy (scenario 09 blesses the hold; SCOPE P0 #8 wants invites on acceptance). Stable UID = `icsUidForSubmission()` in `app/domain/accept.ts`, accept-time SEQUENCE 0; the batched schedule-update send (K14, unchanged) revises the same UID with SEQUENCE ≥1 — that lane derives the sequence from its schedule-version |
| `statusChangedAt`/`notifiedAt` writers unassigned | SPEC'D: status-change action / bulk-send flow stamp them |
| Agenda timezone rule | SPEC'D: store UTC epoch, render in `events.timezone` |
| `schedulableStatuses` no default | FIXED: defaults to `["accepted"]` |
| Track delete cascade silently strips submissions' tracks | FIXED: `restrict` + Library shows "in use by N" |
| Withdraw leaves scheduled ghost on grid | SPEC'D: withdraw unschedules (nulls startsAt/endsAt/roomId) |
| Public headshot bytes have no anonymous route: program surfaces mint `/files/:id` photo URLs (`app/lib/program.ts#latestHeadshots`) but `files.$id` was `requireUser`-gated, so populating the headshot chain turned anonymous gallery/speaker tiles into broken images | FIXED (demo-seed lane): the route delegates to the public-program projection for the one anonymous case — only the current headshot of a public-visible speaker on an accepted, content-approved top-level session. Missing, private, hidden, pending, and superseded files all return a bodiless 404; route tests pin the policy |
| Legacy `contacts.twitter_url` bare handles: admin edit + CSV import stored `@handle` verbatim while the portal's strict URL rule dead-ended EVERY profile save for such speakers | FIXED (speaker-mgmt-majors PR): `normalizeXUrl` canonicalizes on all three write paths, and the portal accepts a field's already-stored value verbatim so stored data never blocks an unrelated save / OPEN (integration owner, two decisions): (a) one-time migration normalizing stored `twitter_url` rows; (b) whether admin edit + CSV import become strict after it — strict lets the portal's stored-value acceptance be deleted; staying permissive (organizer-written junk never dead-ends a speaker's save) keeps that acceptance load-bearing |
| Photo avatars have no `app/ui` home: `app/components/headshot-avatar.tsx` renders the headshot `<img>` (Avatar-matching radius) because `Avatar` is image-blind and `app/ui` is integration-owned; the portal profile keeps its own inline img branch | OPEN (integration-owner request): give `Avatar` a `src` variant at the next integration sweep and collapse both call sites onto it |
| `forms.status` lifecycle undefined | SPEC'D: publish sets `open`; public route reachable iff `open`; `closeAt` gates submission only |
| Agenda ships feature-local primitives (`app/agenda/board.tsx`: FilterChip, ToggleChips, InfoBar, SectionLabel, Strong, ConflictClock) because `app/ui` is integration-guarded and the agenda grid/settings need controls no `~/ui` primitive covers | OPEN (integration-owner): adopt the generic ones into `app/ui` (+ a `clock` path in `Icon`) and delete the locals, or bless `app/agenda` as that feature's component home — components are token-bound so a re-skin via tokens still applies |
| Wizard step-state carrier | ~~SPEC'D: draft row minted on first VALID submission-step save~~ **SUPERSEDED by K1 below**: draft save requires only a non-empty Title |
| `/api/v1` Hide-PII: Sessionboard models a per-token "Hide PII" flag (default on) + scopes; `api_tokens` has neither column | DECIDED (P1 #20 lane, ratifies walk-09 A2): v1 serializers mask unconditionally — every token is a masked consumer, fails closed. Per-token `hide_pii`/`scopes` columns + their settings UI are an integration-owner follow-up, built with the token-management screen. UPDATE (shell-api-polish lane, 2026-08-10): the token-management screen now exists (`/admin/settings/api`: list/create show-once/revoke, per-token event restriction) but ships WITHOUT `hide_pii`/`scopes` — those need schema columns a feature lane cannot mint; serializers still mask unconditionally (fails closed, unchanged). OWNER: add the columns + their toggles on this screen |
| Draft-with-no-participants invisible in portal | SPEC'D: My Submissions = participant-linked ∪ own drafts (UNION) |
| Homeless committed routes (CSV export, email history, task responses, forgot-password, unsubscribe, my-reviews, set-password, files up/download, reviewer mgmt, contacts) | FIXED: ROUTE-MAP rows added |
| Seed ≠ scenario fixtures (named identities, limit=3, scale) | FIXED: seed enriched with scenario fixtures + scale layer |
| One-click accept marked "optional" vs committed scenario | DECIDED: committed (strike "optional") |
| Impersonation commitment ambiguity in SCOPE | DECIDED: stamped COMMITTED in SCOPE |

## Minor items
Tracked inline in the walk files; addressed opportunistically by build agents —
each is a one-line spec clarification already present in walks/scenarios.

## Lane deferrals (2026-08-10) — event-settings lane

Recorded here per the No-shortcuts rule (deferrals live in the register, never
in code). Each needs an owner decision or a cross-lane change.

| # | Deferral | Owner follow-up |
|---|----------|-----------------|
| L1 | Event branding previews render as inline `data:` URIs on `/admin/settings` (uploads capped at 2 MB each) — the byte-serving route (`files.$id`) is the files lane's assigned file. Interim cost the owner is accepting: with both images at the cap, the details page carries ~5 MB of base64 per full load, against the sub-second page bar (typical 300×300/1500×500 branding images are far smaller) | When `files.$id` lands: serve `events.logoKey`/`backgroundKey` by URL (settings AND the public form/portal surfaces that show branding), then delete the inline-preview path — one way to serve stored images |
| L2 | Theme + field-description inputs are single-line `Input`s — no Textarea primitive exists and `app/ui` is integration-owned | Add a `Textarea` primitive (control skin), swap the call sites |
| L3 | Bytes→base64 exists three times; the settings copy is now the shared `app/lib/base64.ts`, but `app/lib/auth.ts` and `app/ports/email.ts` keep private copies (auth core + email port are other lanes' active surfaces) | Point both remaining copies at `app/lib/base64.ts` |
| L4 | `/onboarding` keeps its own event form + timezone machinery; the shared `app/settings/event-form` covers settings/create-event only (onboarding now shares the slug-taken detection) | Converge onboarding onto the shared form (cross-lane) |
| L5 | Library + event-details validation hand-rolls Zod objects. Deriving via `createInsertSchema` is callable in-lane, but FormData delivers strings, so every numeric/optional column needs an override — for these small name(+1 column) tables the derivation would redefine every key it derives | Owner call: mandate derived-then-overridden schemas anyway, or add form-level insert schema exports to `schema.ts` |
| L6 | The earlier "Track delete cascade" fix landed only half: `submission_tracks.track_id` and `reviewer_tracks.track_id` are still `cascade` in schema.ts (integration-owned). The Library compensates app-side — the delete statement itself embeds a no-references condition, so the strip cannot happen through this surface — but any other write path could still cascade | Schema change request: `cascade` → `restrict` on both FKs so the DB enforces the register decision everywhere |
| L7 | `FIELD_TYPE` lives only in `app/db/schema.ts`, so the fields UI keeps a client-safe duplicate in `app/settings/event-form.tsx` (label map is compile-pinned to the schema union; the array is membership-pinned only) | Move `FIELD_TYPE` to `app/db/constants.ts` (the stated home for client-safe enums) and delete the duplicate |

## Lane deferrals (2026-08-10) — ai-review lane

| # | Deferral | Owner follow-up |
|---|----------|-----------------|
| A1 | Bulk AI review runs 5 submissions per click (concurrent, inside one request) with an honest "N still unscored — run again" report. At real scale (hundreds of submissions) that is dozens of clicks; the right long-term shape is a background scorer — an opt-in "score new submissions automatically" event setting driving a cron/queue job (both cadences already exist in `wrangler.json`). That needs an event-settings column (integration-owned schema) and a product decision on spend-without-intent, so it exceeds this lane. Residual accepted with it: saves are compare-and-set (a raced write is skipped, never an overwrite), but two admins triggering the same run concurrently still both pay for inference — a claim-before-run ledger needs a schema column and belongs to the same follow-up | Owner call: accept click-batched scoring for the judging window (each batch is bounded by 5×45s worst-case), or schedule the background scorer (settings column + `app/jobs/ai-review.scheduled.ts`, claim-before-run) with a Wave-3 lane |

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

## Build-lane deferrals (recorded for the integration owner)

| # | Deferral | Status |
|---|----------|--------|
| T1 | **Task-reminder email sends (cron + bulk) have no Queue DLQ** — tech-stack's email rule wants failed sends queued. Both paths are retry-safe without it (cron: `reminderSentAt` stays unstamped on failure so the next tick retries; bulk: occurrence-keyed `dedupeKey` = contact+day+outstanding-set makes an admin retry resume, not duplicate — both pinned by tests), and the bulk send is a synchronous per-speaker loop that will meet subrequest caps at very large rosters. Queues + the `workers/app.ts` consumer + `wrangler.json` are integration-owned, so the queue-backed send is an OWNER decision, not a lane one. | DECIDED (integration owner, 2026-08-10): the bounded-retry model is **ACCEPTED** for the hackathon window — no email path exceeds the caps it is bounded by, and every failure path re-sends without duplicating (test-pinned). Queue+DLQ infra is REGISTERED as the post-submission follow-up S1 below; tech-stack's email rule amended to record the accepted model |
| T2 | **Task-due cron + bulk deliverables reminder shipped in the TASKS lane** though SCOPE P1 #17/#18 nominally file them under roster/content-management. Owner: reconcile the scope rows so those lanes don't build duplicates (two `*.scheduled.ts` jobs would double-email). | OPEN — scope-row reconciliation |
| T3 | **Airtable poll cadence is daily, design commits hourly** — `docs/airtable-sync-design.md` binds "the hourly full-base reconciliation poll stays as the safety net", but `wrangler.json` (owner-owned) carries only the `0 9 * * *` daily cron. Until the webhook is provisioned (secret/id are provisioning-lane), the poll is the ONLY Tier-2 path, so team edits land once per day. The sync job is idempotent and lock-guarded — safe at any cadence. | FIXED (integration sweep, 2026-08-10): `"0 * * * *"` added to `triggers.crons`; jobs now declare a cadence (`ScheduledJob.cron`) and `workers/app.ts` dispatches per `controller.cron` — Airtable polls hourly, reminders stay daily (`test/scheduled.dispatch.test.ts` pins routing + the wrangler lockstep) |
| T4 | **Airtable sync run-state lives in reserved `$sync` rows inside `airtable_links`** (`state` / `lock` / `webhook`; plus the `$remoteDeleted` snapshot marker) — a schema-shaped need built as documented reserved shapes because `schema.ts` is owner-owned (declared in `docs/airtable-sync-design.md` Decision 5; filtered out of all reconciliation; tested). | DECIDED (integration owner, 2026-08-10): **deferred — the reserved rows STAND.** They are documented, reconciliation-filtered, and test-pinned; a `sync_state` table during the freeze is schema churn that buys nothing the reserved shapes don't already deliver. A dedicated table is REGISTERED as follow-up S2 below |
| C1 | **Bulk compose sends carry no unsubscribe LINK yet** — the email port contract says `kind:"bulk"` carries the unsubscribe footer, but the signed-token route (`unsubscribe.$token.tsx`, G5) is still unbuilt (emails lane). Suppression itself is enforced at the port (unsubscribed recipients are skipped and reported — test-pinned); the compose footer identifies why the recipient got the email and offers reply-to opt-out (reply-to = the composing organizer). | FIXED (email-jobs lane, 2026-08-10): the compose blast now goes through `sendAnnouncement` (`app/lib/announcements.ts`), which couples the signed footer + suppression + required dedupeKey for every announcement caller; engineering.md's announcement rule bans direct `kind:"bulk"` port calls, so the coupling holds one level above the port (the port stays the shared transactional seam). Route-level test pins the footer link verifying per recipient |
| C4 | **Seeded demo-event reminder templates still carry literal day-count copy** ("Five days left to submit" / "The form closes in five days.") that `provisionEventDefaults` dropped for merge-tag copy leaning on `{{form_close_date}}` — the reminder windows are ranges (a late toggle-on or missed tick sends 2–5 days out), so a literal "five days" can reach a recipient when no longer true. The demo event is the judged surface, and `drizzle/seed.sql` is owner-guarded, so this lane cannot converge them. Mitigation until then: the job-appended resume block always carries the true form title and close date. | OPEN — integration owner: refresh `et_rem5`/`et_rem1` seed copy to the `provisionEvent.ts` defaults |
| C3 | **The compose bulk blast has no Queue DLQ either** — same mandatory-rule deviation T1 records for task-reminder sends, same shape: the compose action sends synchronously per recipient; a mid-loop failure surfaces as a form error and the retry resumes instead of duplicating (the echoed `sendKey` scopes per-recipient `dedupeKey`s — test-pinned), and the 100-recipient parity cap bounds the loop well inside subrequest limits. Queues + `workers/app.ts` + `wrangler.json` are integration-owned. | DECIDED (integration owner, 2026-08-10): folded into T1's ruling — bounded retry **ACCEPTED** for the window; queue infra = follow-up S1 below |
| C2 | **Speaker-CRM shared-affordance consolidation, remainder owner-owned** — PARTIALLY DONE (integration sweep, 2026-08-10): `Textarea` and `ConfirmButton` are now `app/ui` primitives (the `app/components` skin copies are deleted; `app/components` composes). Remaining owner adoptions: fold `CONTACT_STATUS_TONE` (`app/components/contact-status.ts`) into `app/ui/status-badge.tsx` beside `SUBMISSION_STATUS_TONE`; fold `schema.ts`'s `CONTACT_STATUS` onto the `app/db/constants` import (SUBMISSION_STATUS precedent; a lockstep test pins the tuples until then). | OPEN — integration owner (tone map + constant only) |

## Post-submission follow-ups (integration owner rulings, 2026-08-10 sweep)

Registered here so an accepted trade-off cannot silently become the permanent
design. Each row needs its own re-walk when picked up.

| # | Follow-up | Why registered |
|---|-----------|----------------|
| S1 | **Queue + DLQ for email sends** — declare a queue in `wrangler.json`, dispatch decision/compose/task-reminder sends through it, dead-letter permanent failures (the `queue()` consumer stub in `workers/app.ts` is already reserved for this) | The bounded-retry model accepted in T1/C3 is correct at hackathon scale; at real scale (1000+ recipient blasts) the synchronous loop hits subrequest caps and a queue is the right shape |
| S2 | **Dedicated `sync_state` table** for Airtable run-state; migrate the reserved `$sync` rows out of `airtable_links` and drop the reserved-shape filter from reconciliation | Reserved rows (T4) are sound but every future reader of `airtable_links` must know to filter them — a real table removes the trap |
| S3 | **`session_statuses` parity: `category` + "Show custom status name" toggle** — Sessionboard custom statuses carry Name, mandatory **Category** (behaves as its built-in category, e.g. Accepted-category syncs to integrations), Color, Display order, and a **portal-name toggle** (off → the portal shows the category's default label, mirroring queue behavior; `docs/flows/04` §Custom statuses). Our table has name/color/position only — no category mapping, no toggle | Custom statuses currently can't drive category behavior or hide their name from speakers — visible parity gap once custom statuses are exercised |
| S4 | **Portals behavior/field config** — Sessionboard portal configuration carries behavior toggles (e.g. **"Always Show Tasks"** — off is what gates tasks to accepted speakers, `docs/flows/07`) and per-portal field/filter config; our `portals` table landed appearance parity only (welcomeMessage/accentColor/logoKey/backgroundKey) | The accepted-speakers portal pattern (flow 04 §portal side-effect) is unbuildable until the toggle exists |
| S5 | **Cross-tenant relational integrity constraints** — `submissions` can pair a form, status, parent, format, level, or room from another event; participant/join rows can pair a submission with a foreign contact/track/tag/field; files and task assignments can carry roots from different events; restricted API tokens can name an event outside their organization | Queries in this lane scope externally supplied roots, but D1 does not enforce these cross-column invariants. Integration owner must add composite parent keys plus foreign keys (or equivalent triggers) and re-walk affected tenancy scenarios before accepting schema-level consistency |

## Evaluation-lane escalations (2026-08-10) — No-shortcuts valve, owner decisions pending

Raised by the evaluation lane (PR "Evaluation 2.0"); each is deliberately NOT
built in-lane because the correct home is integration-owned. OPEN until the
owner decides.

| # | Escalation | Status |
|---|-----------|--------|
| E1 | **Multi-line compose surfaces need a `Textarea` primitive (and rich text needs the shared `<RichText/>`)**: reviewer feedback, decision comments, plan/reviewer instructions, and free-text scorecard answers currently render as single-line `Input` — functional, judged-passable, but below the WYSIWYG expectation. A shadow textarea outside `app/ui` would circumvent the design system, so the lane shipped `Input` and swaps in place when the primitive lands. A `Checkbox` primitive would likewise replace the native multi-`Select` pickers. | PRIMITIVES LANDED (integration sweep, 2026-08-10): `Textarea` + `Checkbox` in `~/ui`, `RichText` at `~/ui/rich-text`. OPEN for the evaluation surfaces to swap them in |
| E2 | **Status→tone maps for evaluation/decision states** (`EVAL_STATUS_TONE`, `REVIEW_DECISION_TONE`) live in `app/lib/evaluation.ts` because their precedent home (`app/ui/status-badge.tsx` next to `SUBMISSION_STATUS_TONE`) is owner-guarded. Move them there on acceptance. | OPEN (owner: accept into `app/ui/status-badge.tsx`) |
| E3 | **`admin.evaluation._index.tsx` / `reviews._index.tsx` ROUTE-MAP rows**: both list routes double as layouts via a pathname discriminator because the map pins only the parent filenames; adding `_index` rows lets each loader go single-purpose. | OPEN (owner: add ROUTE-MAP rows, then split) |
| E4 | **`REVIEW_DECISION` / `EVALUATION_STATUS` tuples → `app/db/constants.ts`**: client-side option lists and exactly-typed tone maps need the enums in the client-safe module; today they are defined in `schema.ts` (integration-owned), so the reviewer surface hardcodes the three option labels. | OPEN (owner: move tuples in the same pattern as `SUBMISSION_STATUS`) |

## Form-builder lane escalations (2026-08-10) — integration-owner dispositions needed

| # | Request | Why |
|---|---------|-----|
| F1 | **Promote the form-builder interims into `app/ui`**: `RichText` (Tiptap, lift from `admin.forms.$formId.tsx` — the email + public-CFP lanes need WYSIWYG next and must not mint editor #2), `ConfirmDialog`, `Menu` (⋯ actions), `SortableRow` (owns drag transform/transition + drag-state skin; also closes the ref-callback inline-style gap `ui-primitives-only` can't see), `Switch` (On/Off selects are the stand-in), and move `FORM_STATUS_TONE` beside `SUBMISSION_STATUS_TONE` | The lane is hook-blocked from `app/ui/`; until promotion the repo carries route-local stand-ins that violate the shared-primitive rule |
| F2 | **Seed the demo forms' built-in placements** (`form_fields` rows with `builtin_ref` for the three seed forms, per `defaultBuiltinPlacements` in `app/lib/forms.ts`) | Until then pre-builder forms need the editor's explicit "Set up built-in questions" action, and the public renderer must handle builtin-less forms |
| F3 | **ROUTE-MAP question**: may the forms list move to `admin.forms._index.tsx` (list) so the editor stops paying a discarded layout-loader run per navigation? | Flat routes make `admin.forms.tsx` the editor's layout; the lane carries a pathname short-circuit + `useOutlet` bail as the in-boundary workaround |

## Contacts/CSV lane escalations (2026-08-10) — No-shortcuts valve, owner decisions pending

Raised by the contacts-CSV fix lane (PR `fix/contacts-csv`); each is deliberately
NOT built in-lane because the correct home is integration-owned or another
lane's active surface. OPEN until the owner decides.

| # | Escalation | Status |
|---|-----------|--------|
| CC1 | **Contact-level custom fields now share the field library without sharing submission answers.** `fields.recordType` separates Session and Contact definitions; Contact definitions are organization-scoped and excluded from Settings/Form Builder/public CFP resolution, including malformed direct placements. `contact_answers` keys values by organization + normalized directory email + field, and the Speaker CRM Fields tab plus person profile provide definition and value management across event appearances. | CLOSED (migration `0010_nasty_jasper_sitwell.sql`; real-D1 tenant/persistence tests + live create/save/reload verification) |
| CC2 | **Five sibling search boxes carry the judged empty-q hydration defect** — the roster fix (controlled input re-synced from the URL) is route-local because `admin.evaluation.tsx`, `admin.files.tsx`, `admin.emails_.history.tsx`, `admin.forms.tsx`, and `reviews.tsx` are other lanes' active surfaces (uncontrolled `defaultValue={q}` GET forms). Consolidation candidate: a URL-synced search-form composition in `app/components/` + a sweep of the five call sites | OPEN (owner: schedule the sweep; adopt the roster pattern as the house search-box shape) |
| CC3 | **Accessible error/notice semantics belong in primitives** — routes now wrap `ErrorText` in `<div role="alert">` at ~9 call sites (auth-pages precedent followed), and the duplicate-contact warning renders in `ErrorText` for lack of a caution-toned Notice primitive. Fold `role="alert"` into `app/ui/error-text.tsx` and add a Notice primitive, then delete the wrappers | OPEN (owner: `app/ui` change at the next integration sweep) |

## Stability lane escalation (2026-08-10) — No-shortcuts valve, owner decision pending

| # | Escalation | Status |
|---|-----------|--------|
| ST1 | **UI-only regressions have no test oracle**: the suite runs loaders/actions in workerd with no DOM/component rendering, so the Restore-staleness fix (content form remounts via `key={revisions[0]?.id}` in `admin.submissions_.$id.tsx`) ships with live-browser verification only — "a bug fix ships with the regression test" cannot be satisfied in-harness for remount/render behavior | OPEN (owner: add a component-render harness — new dev-deps, integration-owned — or bless recorded live-browser verification as the oracle for UI-only fixes; this bug is the first to pin when a render harness lands) |

## Forms-hygiene lane escalation (2026-08-10) — No-shortcuts valve, owner decision pending

| # | Escalation | Status |
|---|-----------|--------|
| FH1 | **Mutation busy guards had diverged across the app**: route-local navigation/fetcher locks did not cover concurrent requests consistently, and shared UI risked depending on application hooks. | FIXED (integration convergence sweep, 2026-08-10, through the merged portal-admin tree): every non-agenda mutation-rendering application component owns `useBusy()` and combines it with all existing eligibility/idempotency locks; hook-free UI primitives receive typed disabled inputs from their callers. GET search/filter/export controls remain unguarded. The agenda board's keyed optimistic mutation queue and operation-local fetcher guards are the sole documented carve-out because global disabling would break its deliberate concurrency model. |
| FH2 | **Invite-token idempotency is derived-token, not a schema column** — `mintInviteToken` derives the set-password token as sha256(userId, sendKey) so a replayed POST re-mints identically without a schema change (schema is owner-guarded). Two recorded trades: (a) the durable smaller shape is a unique `send_key` column on `password_resets` holding a plain random token; (b) with derivation, an observer of the admin's rendered page (which carries sendKey + userId) could pre-compute a token before it is minted — previously impossible with `crypto.randomUUID()`. Contained (admin-only action; the same page hands the admin the full invite link outright) but it is a new property and deserves sign-off. | OPEN — owner: bless the derived-token trade, or mint the `send_key` column and revert to random tokens |
