# SCOPE — OpenRostrum (Kill My SaaS 1): the open-source Sessionboard alternative

> 🎯 **NORTH STAR — READ THIS LENS FIRST.** We are building the **actual Sessionboard replacement**: production-ready software a real event team runs their conference on — same product, except **free of charge and open source**. The judge-replay path below is an **ordering device, not a definition of done**. Never justify a cut with "the demo won't show it" — cuts are justified only by product-value ÷ effort, never by a de-scope list: if the rubric scores it, it is in scope. Assume real scale — hundreds of contacts, submissions, and sessions — not the seed data. If a screen would embarrass a real organizer on day 30 of real usage (no search, no pagination, hardcoded event, unhandled states), it is not done.

> ✅ **BUILD GATE: LIFTED (2026-08-10)** — all 10 verification capabilities are provisioned and smoke-proven; build work may proceed. [`VERIFICATION-CAPABILITIES.md`](VERIFICATION-CAPABILITIES.md) is now the swarm's oracle-access manual (cold-start how-tos per row: live instance at openrostrum.com, seeded logins, DB query, email outbox + inbox worker, .ics, R2, Airtable, eval kit).

**Deadline:** Wednesday **Aug 12, 2026, 10:00 PM PT**. Submission = form + open-source repo + deployed site judges test against swyx's walkthrough.
**Judging:** AIE team (not swyx) evaluates independently; tiebreaker goes to "subjective judgment calls for the product we would actually use/buy". $10k.
**Sources of truth:** video walkthrough (transcript + frames in `docs/reference/`), Google Doc brief **PDF** (`docs/reference/brief.pdf` — gitignored, exists only on the owner's main checkout; worktrees get `brief.txt`, which hides the PDF's strikethroughs and red priority callouts — the tiers below already encode them), Discord for clarifications. **Requirements froze with the Aug 9 eval-kit release** — the vendored kit (`docs/reference/killmysaas-evals/`) is the scoring truth; where Discord and the kit conflict, the kit wins.

**Stack: LOCKED — canonical spec [`docs/rules/tech-stack.md`](docs/rules/tech-stack.md).** SCOPE-specific point only: **Airtable is COMMITTED, NOT bonus (owner decision, 2026-08-09 — overrides the Discord "bonus points" framing; do not relitigate).** We must support it, tiered by build order: Tier 1 = one-way push (submissions/speakers/sessions rows land in the base, their automations fire); Tier 2 = "airtable as source of truth" — team edits in Airtable flow back via periodic/on-load pull (two-way, Airtable authoritative for team-editable fields). Design: `docs/airtable-sync-design.md` — its formerly-open decisions are **resolved and binding** (see that doc's RESOLVED section). Airtable I/O stays background-only — never in the request path — because its 5 req/s + latency conflict with the performance target; D1 stays the serving layer.

**Flow documentation:** `docs/flows/` — 00 (the P0 judge-replay script from the video) + 01–08 (per-module behavior researched from Sessionboard's official KB/API docs/live sandbox, with 198 official screenshots) + 09 (data-exposure/authorization matrix). `docs/flows/README.md` indexes them.

**⚑ ORGANIZER CLARIFICATIONS (Discord, 2026-08-08) — authoritative, override earlier inferences.** Full record + impact analysis in `docs/reference/discord/CLARIFICATIONS.md`. The load-bearing ones, now reflected below:
- **Review floor is a 3-state decision** (unreviewed → approve/maybe/deny), NOT a scorecard. Scorecards/rounds demoted to bonus. Bonus: email speaker with feedback at decision time.
- **Accepting a submission auto-creates speaker + session + onboarding tasks** (new required workflow — the spine linking review→portal→agenda).
- **"Category routing" = tracks are many-to-many:** submissions carry ≥1 track, reviewers cover ≥1 track, submissions route to reviewers by overlapping track. (Not the single-select dropdown originally assumed.)
- **Emails AND calendar invites must actually work (MVP)** — provider = Resend or Cloudflare Email; .ics elevated to P0.
- **Must-have onboarding tasks:** hotel-stay form + flight-reimbursement form (both are portal forms); optional: finalize talk desc, finalize bio/photos, announce participation, invite colleagues w/ discount.
- **Agenda floor = day/room + drag-drop + conflict detection** (week/month demoted to bonus). **Admin UI is the priority; the "agent" is minor.** End users are non-technical event producers — usability is the eval bar.

---

## How priorities work

| Tier | Meaning | Rule |
|------|---------|------|
| **P0** | Ship-first (judge path) | The end-to-end path judges will walk. If any step breaks, we lose. Ship first — thin but working, and still built to the NORTH STAR bar (real scale, production quality). |
| **P1** | Firm-requirement depth | Completes the 6 firm requirements + everything swyx annotated. Ship before adding anything from P2. |
| **P2** | Ranked follow-ups | Bonus points and optionals, strictly ordered by product value (incl. judge-visible) ÷ effort. Take from the top only. |

The 6 firm requirements (post-strikethrough version of the brief):
1. Custom call-for-speakers submission forms with conditional logic and category-based routing
2. Self-service speaker portal for bios, headshots, slides, supporting documents
3. Automated, templated speaker communications incl. reminders and calendar invites (Gmail/Outlook/iCal)
4. Submission evaluation and scoring workflows (~~AI-assisted multi-round~~ struck — optional)
5. Drag-and-drop schedule/agenda building, conflict detection across rooms and tracks; list/day/week/track/room views
6. Real-time dashboard showing which speakers still have outstanding onboarding tasks (screenshots label the *fancy* dashboard "optional, best efforts" — the outstanding-tasks view itself is the firm part)

swyx's red-pen annotations (from the PDF screenshots):
- **"must have"** → submitter Submission Confirmation email
- **"make sure this works"** → customizable success-page message + auto-redirect to speaker portal (~10s)
- **"kinda impt"** → form Close Date (drives reminder emails)
- **"nice to have"** → admin notifications on new/updated submissions
- **"NOT NEEDED"** → Payments & Fees
- emphasized → speaker updates their own bio data in the portal

---

## P0 — Ship-first: the judge-replay path (thin slice of all 6 requirements; sequencing, not the quality bar)

This is the literal sequence judges will replay from the walkthrough. Each step lists its acceptance criterion.

**0. Seeded demo event + auth.**
- Admin account + login. One pre-seeded event ("Northbound AI Summit 2026"-equivalent) with tracks, tags, formats, levels, rooms, and a few sample submissions so every screen has data.
- Submitter accounts: email + password signup/login at the public form (mirrors walkthrough), password manager friendly. Forgot-password can be a stub in P0 → real in P1.

**1. Admin creates a submission form (form builder). TARGET = the LATEST UI = 7-step wizard.**
(Now confirmed pixel-level: the latest 7-step builder is captured in `learn.sessionboard.com` static screenshots dated Feb–Jul 2026 — `docs/reference/hunt/guidde-round2/kb-screenshots/applications/building-your-submission-form/01–23.png` — and in the 2025-26 "Future of Abstract Management" webinar. Confirmed step rail: Submission Setup (incl. participant roles + sub-session toggle) → Welcome → Session Information → Participant Information → Payments → Form Settings → Admin Notifications → Preview/Publish. Sessionboard's OLDER KB video tutorials show a 4-page builder — do NOT target that. Full evidence map: `docs/reference/hunt/COVERAGE.md`.)
1. *Submission Setup* — type: Abstracts vs Sessions; Participants step on/off toggle.
2. *Welcome Screen* — internal name, external title, page heading (15-char cap), welcome message (rich text) + show/hide toggle.
3. *Abstract/Session Information* — section title/heading/instructions; default fields Title (locked, required) + Description (locked, rich text) + Format, Tags, Track, Level, Language (dropdowns, removable); per-field required toggle; drag to reorder; **Add Question** (reuse from field library, or Create New Field: Name, Type text/textarea/dropdown/checkbox/number/date, Description, Max Length, Event/Global scope); "Use question rules" for conditional logic; +line inserts section header / rich text / divider.
4. *Participant Information* — locked First/Last/Email; plus Company Name, Job Title, Mobile Phone, Home Phone, Biography, Headshot, Zip (toggleable); roles Speaker/Chairperson/Moderator **each with per-role min/max** (schema `role_*_min/max`); "Unique Contact Settings": *allow new info for existing contacts* (off), *notify existing contacts* (on).
5. *Payments & Fees* — **omit** (swyx red "NOT NEEDED"; the step exists in the latest UI but we skip building it).
6. *Form Settings* — **Close Date + time** ("kinda impt") + reminder-email toggle (5d/1d); submission limit per user; multiple-drafts toggle; **After submission: auto-redirect (~10s) + customizable success message ("make sure this works")**.
7. *Notifications* — submitter **Confirmation email ("must have")**; **admin-notify dropdowns** (new / updated submission, "nice to have").
- Header: Save, **Copy Link**, View Form. Per-form ⋯: Open / Edit / View Results / View Draft Submissions / Duplicate / Delete.
- Acceptance: create form → copy public URL → it works in incognito.

**2. Public CFP submission flow (the star of the demo).**
- Stepper: Welcome → Submission → Participant → Account → Review; top banner shows close date + submission limit.
- Submission step: Title (char counter), Description (rich text), Format/Tags/Track/Level/Language dropdowns — all driven by the form config, required-field validation.
- Participant step: role count enforcement ("2–4 speakers, 2 added"), per-speaker First/Last/Email (live validation)/Phone/Bio; Add Secondary Contact can be P1.
- Review step → Submit → success page with the admin-configured message → "Continue to portal" (+ auto-redirect).
- **Confirmation email actually delivered** with a link to the portal.
- Sane validation defaults (default min speakers = 1 — swyx tripped on his own min-2 mistake on camera).

**3. Speaker portal (req 2, thin).**
- Tabs: Home / Submissions / Profile / Tasks.
- Home: My Submissions with status pills (Pending/Accepted/…) — the "have I been accepted?" moment swyx called key; My Profile card; Tasks panel.
- Profile: bio (rich text), name fields, headshot upload, links (LinkedIn/X/Website). "Update your own bio data" is annotated in the doc.
- Logout / logged-in-as footer.

**4. Admin reviews submissions (req 4's entry point).**
- All Submissions + Abstracts + Sessions lists: status tabs with counts (All/Accepted/Accept Queue/Pending/Decline Queue/Declined/Withdrawn/Drafts), search, sort.
- Inline status change (click pill → pick status → save) and/or row edit.
- **Sessionboard semantics (confirmed by docs): status changes NEVER auto-send email.** Accept/Decline Queue statuses are staging that render as "Pending" in the portal; the admin then bulk-selects sessions → sends Accept/Decline template email (their cap: 100/send) → flips to final status. We replicate this model, plus a one-click "accept + send + finalize" as our improvement (COMMITTED — a scenario covers it).
- Final status immediately visible in the speaker portal (queues stay masked).
- **ON ACCEPT, auto-provision (confirmed required by swyx): create the Session record, create/link the Speaker + participant records, and assign the onboarding task set** (hotel-stay form, flight-reimbursement form, + optional tasks). This is the spine linking review → portal → agenda; build it explicitly, not as a side effect.

**5. Evaluation / review workflow (req 4, thin) — SIMPLIFIED per organizer.**
- Floor confirmed by swyx: each reviewer moves a submission **unreviewed → approve / maybe / deny** (+ optional comment). NOT a scorecard — scales/criteria/rounds are bonus (P2).
- Version note: the LATEST Sessionboard eval is **2.0** (round-based plans/assignments — swyx's dashboard shows "Evaluation 2.0 plans"). The KB tutorial shows the older 1.0 six-step wizard. If we build evaluation *depth* beyond the 3-state floor, target the 2.0 model in `docs/flows/05-evaluations.md`, not the 1.0 tutorial.
- **Track-based routing (confirmed requirement):** submissions carry ≥1 track; reviewers are assigned ≥1 track; each submission surfaces to reviewers whose tracks overlap. Reviewer "My Reviews" queue = submissions in their tracks.
- **Reviewer provisioning (required for routing to be demonstrable):** admin adds a reviewer (account + track assignment) and an invite email goes out (reuses `passwordResets` tokens + the EmailSender port). Without this the P0 routing requirement can't be shown.
- Admin sees the decision tally per submission and makes the final accept/decline.
- **COMMITTED (swyx named it twice — was bonus, must not slip):** compose + send an email to the speaker (request changes / attach feedback) when recording the decision. Textarea on the decision UI + the existing EmailSender port; exceeds Sessionboard parity.

**6. Agenda builder (req 5, thin).**
- Accepted sessions appear as unscheduled (right-side Scheduled/Unscheduled panel); drag onto a day×room grid; **conflict detection**: Sessionboard checks **speaker double-booking + same-room/time overlap only** (verified — NO track collisions; the brief's "across rooms and tracks" means track-collision is a *build-beyond* extra). Conflict marker = red clock icon; Conflicts tab lists one row per logical clash with both sessions and Open→editor paths.
- Agenda Settings: Day Start/End time, which statuses are schedulable, **per-format Default Duration (auto-fills end time)**, Room Visibility.
- Views: List + Day/Rooms grid in P0; Week/Month/Track in P1. (List defaults to Accepted-only.)
- Dashboard-style alert: "N accepted sessions still need a time slot."

**7. Tasks + outstanding-tasks dashboard (req 6, thin).**
- Onboarding task set auto-assigned on acceptance. **Must-have tasks (swyx-named): (1) hotel-stay requirement form, (2) flight-reimbursement form** — both are portal forms the speaker fills in. Optional extras to seed: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount.
- Task shows in the speaker portal; speaker completes it (marks done or submits the attached form/file).
- **Admin can READ submitted form responses** (`taskAssignments.response` detail view) — the hotel/flight forms are decorative if the organizer can't see arrival dates to book hotels.
- Admin dashboard view: which speakers still have outstanding onboarding tasks (counts + per-speaker list). This *specific view* is the firm part of req 6.

**8. Emails + calendar invites (req 3) — must actually work (MVP), confirmed by swyx.**
- Provider: Resend or Cloudflare Email (swyx named both). Deliverability tested end-to-end day 1.
- Transactional: submission confirmation (immediate, "must have"), Accept, Decline, reminder ×2 (5-days / 1-day before Close Date, via Cloudflare Workflows/cron). Templates editable (subject + rich body) at event level.
- **Calendar invites (.ics) attached to acceptance/scheduling emails** — Gmail/Outlook/iCal. Sessionboard has none, so this is a differentiator; elevated from P1 to P0 because swyx confirmed it must work.
- **Schedule-update emails close the .ics loop (K14).** Accepted-then-scheduled-later (the common order) must still get the invite: schedule changes (first placement, room/time moves) accumulate per speaker, and the agenda shows **"N speakers have unsent schedule updates → Send"** — explicit batched send, matching the status-changes-never-auto-email philosophy (an afternoon of drag-and-drop must not fire 15 emails per speaker). The .ics keeps one stable `UID` per session and increments `SEQUENCE` on updates so Gmail/Outlook update the existing calendar entry in place; `dedupeKey` = submission + schedule-version.

---

## P1 — Firm-requirement depth (in order)

> ⚖️ **EVAL-KIT REWEIGHTING (2026-08-09).** swyx published his v1 LLM-as-judge harness (`docs/reference/killmysaas-evals/` — vendored copy; crosswalk in `docs/eval-crosswalk.md`). It scores ~189 weighted rubric points across six required areas, and it **overrules earlier verbal de-scoping**: public widgets (struck in the brief) are a CORE area worth ~19% of the total; review-depth (called "bonus" on Discord) is graded core; file versioning/comments/history (cut earlier) are core items. Items #15–21 below and the expansions of #3/#10 exist because of this. Where Discord and the kit conflict, **the kit is what scores.**

1. ~~Calendar invites~~ — **moved to P0 #8** (swyx confirmed must work).
2. **Conditional logic ("question rules")** (req 1): show field B when field A matches a value (trigger types checkbox/dropdown/number, no AND/OR). "conditional fine for now" per swyx. (Track routing is now P0 in the evaluation step, not here.)
3. **Speaker file uploads + downloads** (req 2): headshot in profile + slides/documents via File Requests or task-attached uploads; files listed on the submission (admin side); **approve/deny review core** (upload → `pending_feedback` → admin approves or denies triggering re-upload; schema-ready); **portal Files list for organizer-shared downloads** (speaker kits, logos, templates — `files` table already models it). **UN-CUT (eval-kit core, 2026-08-09): version history UI** (re-upload = version+1, latest marked, old versions viewable — `files.version` was already in the schema) **and per-file comment threads** (speaker comments from portal, organizer replies from admin — `file_comments` table; CNT-04 w3 + CNT-05 w2). Upload UI must state accepted types + max size (CNT-06).
4. **Save as draft + resume** on the public form (drafts count toward limits; portal shows "resume draft"). **Draft save requires ONLY a non-empty Title** — required-field validation applies to step ADVANCE, never to draft save (Sessionboard-documented behavior + eval-kit CFP-07; this corrects the earlier "first VALID step save" wizard rule).
5. **Event Settings**: event details (name, slug, type, URL, location, timezone, start/end, theme), logo/background upload, **+ create-event flow (same form, one more route — NORTH STAR: nothing hardcoded to the seeded event)**; Library: manage Tags, Tracks, Formats, Levels **and Fields (CRUD, org-wide vs per-event scope — an eventId/organizationId XOR, the `fields.scope` enum is dropped per #22; section header/divider layout elements)** (feeds all dropdowns).
6. **Email template editor page** (list with category/type/trigger columns; edit subject/body; **reply-to per template** — real speaker replies must reach the organizer inbox; manual vs automatic triggers) + admin-notify pickers on forms ("nice to have" annotation) + **email history log** (admin list of `email_outbox` sends: to/subject/status/sent-at — the data already exists).
7. **Dashboard "Today"**: greeting + days-to-event, stat cards (Submissions, Accepted Speakers), status breakdown row, "Also check" alert links, recent submissions table, per-form submission progress.
8. **Portal Tasks depth**: task types (Contact/Group/Submission), portal forms attachable to tasks (the "fill out a form in a Task" flow from the screenshots), file-request tasks.
9. **Agenda views**: Week + Track views, drafts filter, search/filter by track/room. (Day/Rooms is the confirmed floor; these are bonus per swyx.) **Plus a one-action "Auto-place remaining" button** — greedy conflict-free placement of unscheduled sessions into open slots (eval-kit AIA-08 grades "any assisted placement" generously; ~an hour of work, no AI).
10. **Evaluation 2.0 depth** (schema landed: `evaluation_plans/rounds/round_evaluators/round_questions/evaluations/evaluation_answers`; model = `docs/flows/05-evaluations.md`). The 3-state floor stays the fast path; this adds the depth the eval kit grades as CORE (ABS-01…13) — build ALL of: plans with **≥2 rounds** each carrying own name/dates/scorecard (ABS-01); **per-round reviewer pools** (ABS-02); scorecard editor with **rating + dropdown + text** questions (ABS-03) and **per-criterion weights** feeding the aggregate (ABS-04); **explicit assignment** minting pending `evaluations` rows — queue = exactly the assigned set (ABS-05) — with caps/auto-distribute/track-filtered bulk assignment (ABS-06); **per-round anonymized review** hiding participant identity from reviewers only (ABS-07); **progress view** with per-reviewer assigned/completed counts (ABS-08) + **send-reminder action** on lagging reviewers (ABS-09); results table with **weighted aggregate per submission, sortable both directions** (ABS-10); **abstain/COI recusal** on the scoring pane (ABS-12); **results CSV export** (ABS-13). AI-assist stays P2.
11. **Withdrawn/Accept-Queue/Decline-Queue semantics** — queue statuses as staging before the accept/decline email fires. Sessionboard's VERIFIED core enum (per its OpenAPI spec, [`docs/data-model.md`](docs/data-model.md)) is exactly `pending → accept_queue → accepted / decline_queue → declined`; our `draft` and `withdrawn` are our own additions, and Sessionboard ALSO supports organizer-created custom statuses (now at parity: `session_statuses` table + `submissions.customStatusId`). Plus **per-participant acceptance**: portal Confirm/Withdraw buttons per person on Accepted sessions, driving `participants.acceptance_status` (schema-ready).
12. **Forgot password + auth polish.**
13. **Add Secondary Contact** on the public-form participant step (schema-ready: `PARTICIPANT_ROLE` carries `secondary`) — assists with tasks and communication.
14. **Guarded record deletion**: delete actions for junk submissions and "delete my data" contact requests (cascades are already correct in the schema; the action just needs a confirm guard).
15. **Airtable sync (COMMITTED — owner decision 2026-08-09, moved up from P2 #1; not bonus, do not relitigate).** Tier 1 first: one-way push of submissions/speakers/sessions rows on change (background job via the `AirtableSync` port; tolerate rate limits) — their automations fire on new rows. Then Tier 2: "airtable as source of truth" — periodic/on-load pull picks up team-side edits (two-way; Airtable wins conflicts on team-editable fields). Design = `docs/airtable-sync-design.md` (open decisions now RESOLVED there; `airtable_links` table landed in schema). Background-only I/O — never in the request path; D1 stays the serving layer.
16. **Public widget suite (eval-kit CORE — 36 pts, ~19% of the rubric; was P2 #2).** Five logged-out surfaces, all SSR reads of approved content (`contentStatus = 'approved'`), event-scoped by slug, alphabetical-by-surname where people are listed: **(a) Sessions list** — card per session (title, description + Show more, date/time, room, speakers w/ title+company, Format/Track tags), keyword search matching titles AND speaker names, faceted filters (Track/Format/Room) (EMB-01..03); **(b) Speakers directory** — photo/name/title/company entries, name search, detail view w/ bio + that speaker's sessions (EMB-04/05); **(c) Agenda grid** — day×room×time layout, day navigation, session detail w/ full time range + Back (EMB-06..08; gated on `events.agendaPublishedAt` — the agenda **Publish** action sets it, AIA-07); **(d) Schedule itinerary** — day tabs, chronological groups, full card anatomy, **personal schedule** (add/star → My Schedule view, localStorage persistence + .ics export) (EMB-09..11); **(e) Speaker gallery** — photo grid distinct from the directory, name search, detail modal, graceful missing-photo fallback (EMB-12/13). Plus: **embeds admin** (`embeds` table): per-widget snippet/share URL with type + output formats — styled-HTML script tag, basic HTML, **JSON + XML + iCal feeds** (near-free off the same loaders) — and filter/branding config (EMB-15). All surfaces reachable logged-out (EMB-14); data reads D1 live so organizer edits appear without republishing (EMB-16). Mobile-friendly per cross-cutting.
17. **Speaker roster module (eval-kit SPK-01..06/13..15).** Admin per-event contacts/speakers list (golden-path table: search, status filter) + **manual add/edit speaker** with profile fields; **contact workflow status** (`contacts.status`: pending/invited/confirmed/declined — changeable, persisted, filterable); **CSV import** (parse, column-map, dedupe by normalized email — the migration path off Sessionboard; ends on a **summary screen: X added / Y merged by email / Z skipped with per-row reasons** — nothing silent, K16); **portal invite button** (reuses the G7 sentinel-hash invite) logged to email history; **compose bulk email to selected/filtered speakers** (merge fields + per-recipient preview; suppression-aware `kind:"bulk"`); **travel/logistics field** (`contacts.logisticsNotes`). Includes the **task-due reminder cron** (`taskAssignments.reminderSentAt` guards double-fire; SPK-16/CNT-08's automated half; **editing `dueAt` clears the stamp** so an extended deadline re-arms the reminder, and the reminder's `dedupeKey` includes the due date — K17).
18. **Content-management depth (eval-kit CNT-09..14).** Central admin editing of session title/abstract (exists) **plus**: **change history + restore** (`submission_revisions` — snapshot per save, editor-attributed, restore writes back; CNT-11); **content-approval status** (`submissions.contentStatus` draft/in_review/approved) gating ALL public widget output (CNT-12) — **with the affordances that keep the accepted→approved→published gates from reading as bugs (K15)**: the accept spine sets `in_review` (not `draft`), the submissions list gets a one-click **"Approve all accepted"** bulk action, the dashboard "Also check" row shows "N accepted sessions aren't public yet", and the agenda header carries a Published/Unpublished chip next to the Publish button; **central files library** (all uploads w/ session/speaker, date, version count; CNT-13); **bulk ZIP export of latest file versions** with per-session grouping (Worker-side zip; CNT-14); **bulk deliverables reminder** from the tasks dashboard (CNT-08 manual half).
19. **Speaker edit-until-close (eval-kit CFP-09/16 + ABS-11).** Portal "View Submission" → edit the submitted (not just draft) proposal — including participants/co-authors — until the form's close date; after close the submission renders read-only with an editing-closed message and no save path. Organizer sees edited content (it's the same row).
20. **Sessionboard-compatible read API (was P2 #4).** Hono sub-app on `/api/v1/*`: core read/search set (sessions, speakers/contacts, submissions) with `x-access-token` auth (`api_tokens`, SHA-256), their pagination envelope (default 25/max 100) per `docs/flows/08`. Same serializers as the public JSON feeds. Write ops stay out.
21. **Team admins (small).** "Invite teammate" on settings: mints an admin user via the same invite/set-password mechanics as reviewers (G7) — **now an org-member invite** (#22; same mechanics, membership row instead of a bare admin user). Full roles/permissions matrix is deliberately unbuilt — all admins are equal, **confirmed at the org layer by the 2026-08-10 Sessionboard verification** ([`docs/data-model.md`](docs/data-model.md) → Organization & Event Team): Sessionboard has no owner role; org-level invites all receive "Admin User". One invariant replaces the owner concept: an organization can never lose its last member.
22. **Multi-tenancy & organizer sign-up (COMMITTED — owner decision 2026-08-10; design = [`docs/multi-tenancy-design.md`](docs/multi-tenancy-design.md), adversarially reviewed; do not relitigate).** Multi-org is committed. The tenant is an **organization** (Sessionboard parity): `/signup` (name/email/password; Turnstile via the existing port) → one-form onboarding (org name + first event) → own empty `/admin`; the seeded sandbox event moves into a **"Demo" org** the shared judge seat alone belongs to. Org members are **equal admins** (no owner/role column — verified parity). Tenancy lands in the existing auth chokepoints; `api_tokens` and `fields` become org-scoped in the same migration (fields: `scope` enum dropped for an eventId/organizationId XOR — amends #5's earlier wording). Ordering (owner call, recorded): tenancy waves A+B land ahead of remaining P0 so Wave-2 features build against the membership model. **Existing-email sign-up is decided**: blocked with a sign-in message while the global `users.role` enum lives. **Registered follow-ups (No-shortcuts valve — each needs its own re-walk when picked up):** (a) `users.role` enum removal (authority fully membership-derived), (b) per-org Airtable credentials — until then the env base binds to the Demo org only and other orgs see an explicit "Airtable isn't configured" state, (c) "Selected Events" event-scoped membership (Sessionboard parity gap, deliberately deferred), (d) verify-email flow (invite links prove ownership today), (e) the global event-slug namespace trade-off (first-come-first-served; revisit if it bites).

## P2 — Follow-ups, strictly ranked (take from the top)

1. ~~Airtable sync~~ — **MOVED TO P1 (owner decision 2026-08-09: Airtable is a real requirement we must support, NOT bonus — do not relitigate).** See P1 #15.
2. ~~Public embeds / schedule + speaker gallery~~ — **MOVED TO P1 #16** (eval-kit grades it CORE, ~19% of the rubric).
3. **CSV/XLSX export** — **CSV export for submissions + speakers + evaluation results is COMMITTED** (pure serialization of the list-loader queries; eval results per P1 #10/ABS-13). Speaker CSV **import** moved to P1 #17; files ZIP bundle moved to P1 #18. XLSX stays opportunistic.
4. ~~API (Sessionboard-compatible subset)~~ — **read-only core MOVED TO P1 #20**; write ops and the long tail of the 177-op spec stay out.
5. **Dashboard extras** — Submission Pacing chart, Participants/Evaluations tabs (missing-bio alerts, status donut), Speaker Tracking + Submissions Pipeline widgets. Nice demo shine, zero firm-requirement weight.
6. **Admin impersonation** — "View portal as…" with **per-contact search** (real events have hundreds of contacts) opening that contact's portal **preview-only** (tasks viewable, not completable) + "Back to Admin Mode" (swyx used it constantly). Build constraint: enforce preview-only **once** in the shared portal auth helper, never per-route.
7. **AI-assisted review** — struck through + "very optional, do if u feel like it". Only if hours remain: LLM pre-score/summary per submission feeding the evaluation round.
8. **Email themes / custom HTML+CSS** in templates.
9. **Forge hosting** — "very teeny bonus points". Mirror the repo there at the end if trivial.
10. **Saved views / column preference panels** on admin tables — cosmetic parity, skip unless free.

## Everything the rubric scores is in scope

There is no de-scope table. The test is the eval kit: **if it scores an area, we
build it.** A P0/P1/P2 tier is a queue, never a refusal, and no lane may decline
judged work as "out of scope." Speaker CRM is why this rule exists — it sat
marked out of scope while the judges scored it as its own area, and came back
**23.7%**.

Three things are unbuilt. Each is unscored by the kit *and* has a stated reason,
and none may be cited to skip anything else:

| Unbuilt | Why |
|---|---|
| Payments & Fees; portal wiki/resource pages; Accelevents; Integrations (Cvent, Swoogo, Zoom); microsite builder; Invoices; Awards; Digital Posters; Marketing module; multi-language forms; roles/permissions matrix | Unscored by the kit and explicitly refused in the brief — "NOT NEEDED" in red on payments, "We only care about English" on languages, struck through for the rest. Equal-admin parity is verified ([`docs/data-model.md`](docs/data-model.md)). |
| Metrics/aggregation stack (Analytics Engine, Prometheus-style telemetry) | `track()` events ([`docs/observability.md`](docs/observability.md)) answer every question we have a consumer for; aggregation without production traffic is speculative. Revisit when there is traffic to aggregate. |
| Visual-regression tooling (Storybook, screenshot diffing) | Needs a stable baseline skin to diff against; the skin is a deliberate neutral stand-in until the owner designs it (`docs/rules/engineering.md` → Design system). Revisit once a real skin exists. |

Pixel-fidelity to Sessionboard's design is not a goal — the brief says so, and the
rubric measures job-to-be-done parity instead.

## Cross-cutting (applies to every tier)

- **Performance is a scored feature.** Target: no skeleton-screen theater, <1s page loads, instant table interactions. The walkthrough shows Sessionboard's loading spinners repeatedly while swyx complains — that contrast is our cheapest win.
- **Empty states** for every list (judges start from a fresh event).
- **One shared rich-text editor** component (B/I/U, lists, links, alignment) reused everywhere Sessionboard shows WYSIWYG.
- **Seed script** that recreates the walkthrough state on demand (demo event, 3 forms, sample submissions across statuses, an eval plan, scheduled + unscheduled sessions, tasks).
- **Mobile-friendly public pages** (CFP form, portal, schedule embed). Admin can be desktop-only.
- **Email**: use a real provider (e.g. Resend) + verified domain early — deliverability of the "must have" confirmation email is a demo-day risk, test end-to-end on day 1.
- **Unsubscribe/suppression — announcements only (K13).** Suppression applies solely to general announcement blasts (the compose-to-speakers flow), which carry the unsubscribe footer. Everything that is a consequence of the recipient's own submission/account — confirmation, **accept/decline decisions**, invites, password resets, task-due + draft-close reminders, schedule updates — is `kind:"transactional"` and ALWAYS delivers: unsubscribing must never hide an acceptance. The unsubscribe page says so ("you'll still receive emails about your own submissions"). CAN-SPAM treats these as transactional/relationship content, so this is compliant, not just convenient.
- **Bot protection**: Turnstile on the public CFP form — the port (`app/ports/turnstile.ts`) exists with a local no-op; wire real keys in the capabilities phase. Listed here so it can't silently slip (it lives in no tier). **⚠️ The JUDGED deployment ships WITHOUT Turnstile keys** (capability resolution → no-op pass): the eval harness is a Playwright agent that cannot pass a real challenge — live bot protection would zero the entire speaker path's coverage. The same keyless window covers `/signup` (P1 #22) during judging — recorded here so it is a known state, not a discovery.

### Judging-harness readiness (eval kit = a Playwright agent with ~70 turns/scenario; anything unreachable → `cannot_judge`, <60% coverage voids the score)

- **Manual "+ Add Submission / Add Session" is COMMITTED** (the drawer in Appendix F): three kit areas use "create the session directly" as their chained-run fallback — without it, one broken upstream step cascades `cannot_judge` across areas.
- **Copyable reviewer/speaker invite link in the admin UI** (not email-only): the agent has no inbox; an on-screen link is the only way it can become the reviewer persona.
- **Route aliases + conventional nav labels**: `/dashboard`, `/organizer` → `/admin`; bare `/sessions`, `/speakers`, `/schedule`, `/agenda` redirect to the default event's public pages; nav says "Speakers", "Call for Papers", "Agenda". The homepage links every public surface (the anonymous widget tour starts at the base URL).
- **User↔contact linking by normalized email**: a speaker who signs up with an email the organizer already added to the roster must land in a portal showing that contact's sessions/tasks (kit SPK-S2 assumes it).
- **In-app confirm modals only — never native `confirm()`**: the harness auto-accepts native dialogs, so a native delete-confirm is no guard during a judged run.
- **Close-date fields accept past dates** (the kit closes the CFP by backdating, then reopens it in a later area).
- **`docs/JUDGING.md`** ships with the repo: seeded credentials, entry points, email-history location, API token, known behaviors — feeds the kit's `submissionNotes`.
- **Self-grade before submitting**: run the vendored kit against our deployed URL (VERIFICATION-CAPABILITIES #10) on Aug 11 and fix what it flags.

## Open questions — RESOLVED by research (2026-08-08; details in `docs/flows/README.md`)

1. **Conditional logic** → Sessionboard's "question rules": show-a-question-when-another-matches, triggers limited to Checkbox/Dropdown/Number, no AND/OR or chaining. Build exactly that (P1 #2). Source: learn.sessionboard.com FAQ.
2. **Category-based routing** → no submit-time routing exists in Sessionboard. It's evaluation-side: assignment rules filter submissions (track/format/tags/status) to evaluator pools; docs recommend one plan per track. Covered by evaluation scope; no routing engine needed.
3. **Calendar invites** → Sessionboard has NO per-speaker calendar invites (0 mentions of .ics in its entire KB; only a whole-agenda iCal embed feed). Requirement 3 is a **differentiator we build beyond parity** — keep P1 #1 and feature it in the submission writeup. Judges can't compare against the original; a standard .ics attachment satisfies Gmail/Outlook/iCal.
4. **Submitter auth** → email + password confirmed (email-first lookup → login or inline signup; deep links land on a password gate; no magic links). Mirror it in P0.

**All four also confirmed directly by the organizer in Discord (2026-08-08)** — see `docs/reference/discord/CLARIFICATIONS.md`, which additionally resolved: review floor = 3-state decision (not scorecard), accept auto-provisions speaker+session+tasks, tracks are many-to-many for routing, calendar invites must work, must-have onboarding tasks named, agenda floor = day/room+drag+conflicts, admin UI is the priority. The promised follow-up landed as three learn-center walkthroughs (Discord #general, Aug 8 22:13 — `videos/`, `participants/`, `get-started/`), already cited across these docs; the eval kit is still the final word on email/calendar depth.

---

# Appendix — Full UI inventory (forget-nothing checklist)

Every page, field, and control observed in the video (~100 frames) and the brief's screenshots. **Presence in this inventory ≠ commitment to build** — tiers above govern. This is the checklist to consult when building each page so nothing important is silently dropped.

## A. Admin shell
- Left rail: logo, event switcher ("AI.Engineer Sand… · Oct 12–14, 2026" ▾, "View all my organizations"), collapse arrow.
- Nav tree: Dashboard · **Program** (Overview; SUBMISSIONS: View All, Abstracts, Sessions, Files; COLLECT & REVIEW: Forms, Evaluation, Agenda, Invoices, Site; PORTALS: Portals, Tasks, Forms, File Requests, Resources, Files; CONFIGURE: Settings) · CRM › · Marketing · **CMS** (Overview, Embeds) · Reports · Studio · History · Event Team · Preview · Settings.
- Top bar: "Find or ask" (⌘K), **View Portal**, notifications bell with badge, help, avatar menu.

## B. Event Settings
- Overview cards: Event setup (Event Details, Record Settings, Portals, Submission Forms), Library (Fields, Tags, Personas), Communications (Email Templates, Email Themes), Configuration (Integrations "Connect Cvent, Swoogo, Zoom, and more").
- Event Details: Event Name*, Event Slug*, Event Type (dropdown, "Conference"), Event Website URL, Event Location, Timezone dropdown, Starts At* / Ends At* (date + time + TZ label, clearable ×), Theme textarea (18/1000 counter), Save.
- Exhibitors & Sponsors: two toggle cards (Exhibitors, Sponsors) with green checks.
- Image Settings: Logo (recommended 300×300) and Background (1500×500), each with drop zone + "Upload new ▾".
- Email Templates page: tabs All / Lifecycle (4) / Custom (0) with counts; table Name · Subject · Category · Type · Trigger; rows observed: **Accept Sessions** (Sessions, manual), **Decline Sessions** (Sessions, manual), **Session Form – One Day Reminder** (Submission Forms, auto "1 day before the close of a form"), **Session Form – Five Days Reminder** (auto, 5 days); "+ Add Template ▾"; "Add custom HTML & CSS" section with security warning banner; per-row ⋯ menu.

## C. Submission Forms (admin)
- List: title + "Collect abstract, session and participant information"; promo banner (dismissible); search; tabs All/Open/Closed with counts; sort "Most Pending ▾"; "+ Add ▾" → Create Form / Copy from…; form cards: pending-count badge, name, **Open** badge, "Abstracts & Participants" + "V2" chips, "N submissions · N drafts", "Closes Sep 15, 2026", created date, ⋯ → Edit.
- Editor header: "Edit Session Form" + internal name, ← Back to forms, **View Form**, **Copy Link**, **Save**.
- Step rail (FORM SETUP): Submission Setup → Welcome Screen → Abstract Information → Participant Information → Payments & Fees → Form Settings → Notifications; completed steps get checkmarks; Back/Next footer.
- Step 1 Submission Setup: "What kind of submissions do you want to collect?" — **Abstracts** ("collect abstract submissions for review before sessions are finalized") vs **Sessions** ("full session proposals with details for your program") cards; **Participants** toggle ("include a step to collect speaker and participant contact information"); note "You can adjust these choices later".
- Step 2 Welcome Screen: Internal Form Name* (…/255), External Form Title* (…/255), Page Heading* (**15 char max**), Welcome Message rich text + **Show message** toggle.
- Step 3 Abstract Information: Section Title* (…/255), Page Heading* (15 max), Description & Instructions* (rich text); Form Questions list: **Title** (Text, Max 255, Locked, Required) · **Description** (Wysiwyg, Max 5,000, Required toggle) · **Format** (Dropdown) · **Tags** (Dropdown) · **Track** (Dropdown) · **Level** (Dropdown) · **Language** (Dropdown); each row: drag handle, required toggle, ⋯ menu; **+ Add Field**.
- Step 4 Participant Information: Section Title*, Page Heading*, Description & Instructions*; fields: **First Name** (Text 255, Locked, Required), **Last Name** (Locked), **Email** (Email, Locked, Required), **Mobile Phone** (Phone, required toggle), **Biography** (Wysiwyg 5,000); Participant roles: ✓ **Speaker** (Min / Max numeric inputs), ○ Chairperson, ○ Moderator; "Send submission confirmation email" toggle ⓘ; "Total across all roles" limit.
- Step 5 Payments & Fees (unbuilt — swyx marked it "NOT NEEDED" in red): When to Collect Payment — "Do Not Collect Payment" (Selected) / "Upon Submission".
- Step 6 Form Settings: Deadlines — **Close Date** (date+time+TZ, clearable; "Set a close date to enable draft reminder emails"); **Send Reminder Email** toggle (copy: reminds those with saved drafts "five days" / "one day" before close); Submission capacity — **Set Submission Limit** toggle ("Event max: 3 applies when no form-level limit"), **Allow multiple draft submissions** toggle + "Effective behavior" explainer; After submission — **Auto-redirect to speaker portal** toggle ("after 10 seconds"), **Customize the success page message** (rich text; default copy about confirmation email, review timeline, portal, submit-another link); Validation rules — **Cross-field character limits** ("cap combined length of several text fields, e.g. printed program block") + Add rule.
- Step 7 Notifications: "What admins should be notified when a **new** submission is received?" (multi-select chips ×) · "…when an **existing** submission is updated?" (multi-select) · Submitter notifications (1 template): **Submission Confirmation** ("email sent to submitter after a successful submission") toggle + Customize · Admin notifications (2 templates) accordion.

## D. Public CFP flow
- URL shape: `/submit/<event-slug>/<form-uuid>` (+ `/step/auth`, `/step/session…`, `/step/participant`, `/step/confirm…`).
- Stepper: ①Welcome → ②Submission → ③Participant → ④Account → ⑤Review (checkmarks as completed).
- Persistent banner: "Form submissions will be accepted until September 15 at 11:59 PM PDT." + "Submission Limit: 3 submissions per user".
- Welcome: rich-text content (Call for Speakers copy, tracks list, helpful links — Speaker Agreement / FAQs / Speaker Tips, Dates and Deadlines), Get Started.
- Account: "Log in with your existing account" — Email*, Existing password*, **Forgot your password?**, Log In →, Back; (signup variant for new emails).
- Submission: Title* (2/255 counter), Description* rich text (3/5000; toolbar B I U x² x₂ link, lists, indent/outdent, table ▾, ⋯), Format* ▾ ("Featured Keynote"…), Tags* ▾, Track* ▾, Level* ▾ ("Introductory"…), Language* ▾ ("English"); footer: ← Back · Save as draft · Next step →.
- Participant: "2–4 Speakers allowed - 2 added."; per speaker: First Name* (3/255), Last Name*, Email* (inline "Enter a valid email address."), Mobile Phone* (country flag +1 selector), Biography* rich text ("Tell us a bit about yourself", 0/5000); **+ Add Secondary Contact** ("Secondary contacts can assist with tasks and communication"); ← Back · Save as draft · **Continue to review →**.
- Review → Submit.
- Success: green ✓, "Thank you for submitting to present at our event!", body copy (confirmation email + portal link + review timeline), "click here to submit another session", **Continue to portal →**; "Powered by" footer.
- Persistent: "You are logged in as X (email). Not you? Click here to log out."

## E. Speaker portal
- URL shape: `/portals/<event-slug>/<portal-uuid>/…`; header tabs **Home · Submissions · Profile · Tasks**; user chip ▾ → Profile / **Back to Admin Mode** (admin only) / Logout.
- Home: **My Submissions (N)** card + View All — rows "SESS-4 — title", format ("Featured Keynote"), status pill (Accepted green / Pending orange); **My Profile** card (initials avatar, name, email, View more); **Tasks** card — tabs All / My Tasks (0) / Submissions (0), Filter ▾, groups **Submission Tasks** ⓘ and **My Tasks** ⓘ with Open All/Collapse All and empty states.
- Submissions: search ("Search abstracts…"), submission cards.
- Profile: avatar; Profile Info tab; **General** accordion — Biography rich text (0/5,000 counter), Salutation, First Name, Last Name, Honorific, Pronouns ▾, Gender ▾, Job Title, Company Name; **My Links** accordion — LinkedIn URL, X (Twitter) URL, Facebook URL, Website.
- Tasks page: full task list.

## F. Admin — submissions review
- Pages: **All Submissions** (`/sessions/submissions`), **Abstracts** (`/abstracts`), **Sessions** — same table pattern.
- Header: title + subtitle, **⋯ Options** (→ **Import Sessions**, **Export .CSV**, **Export .XLSX**, **Download files bundle…**), **+ Add Submission/Abstract**.
- Status tabs with live counts: All · Accepted · Accept Queue · Pending · Decline Queue · Declined · Withdrawn · Drafts.
- Toolbar: search, layout toggle, **Saved Views ▾**, **Columns** (preferences panel: Fields/Reporting Fields, search, Session Details checklist — Capacity, CEU Credits, Chairperson, Client Session ID, Created At, Description, Ends At, Exhibitors, Files… "18/25 selected", drag-to-reorder Selected column list, Reset to Default, Apply), **Sort**, **Filter**.
- Table: checkbox, ✎ edit, **Status pill** (click → dropdown Accepted/Accept Queue/Pending/Decline Queue/Declined + chip + Clear/Cancel/**Save**), Source ("Session Submission Form…" / "Manual"), Title, Client Session ID, Description, Starts At, Ends At, Location, Speaker, Track (colored pill), Tags, Notified, Rating; pagination ("1 — 3 of 3 rows", Show 25 ▾).
- Add Submission drawer: tabs **Details / Participants**; Details: Title* (0/255), Status ▾ (default Pending), Description, Starts At / Ends At (datetime), Capacity ("number of attendees"), CEU Credits, Client ID, Format ▾ …; Cancel / **Create**.

## G. Evaluation
- Section tabs: **Summary · Evaluation Plans · My Evaluations · Evaluators · Evaluator Tags**.
- Summary: "View overall evaluation metrics and performance insights" (stat cards + charts).
- Evaluation Plans: search, filters All (1) / Open (0) / Closed (1) / AI (0), grid/list toggle, **+ Add Plan ▾**; plan card: name, status badge (Closed), v2 chip, **Evaluators** count, **Submissions**, **Total Evals**, "Progress (Round 1 · 0 completed)" + %, "Due (Round 1): date, time TZ", ⋯ menu.
- My Evaluations: the evaluator's personal queue.
- Evaluators: sub-tabs **Evaluators / Conflicts**; search, Grouped/Flat toggle, ⋯ Options, **+ Add**; description "Everyone enrolled on Evaluation Plan 2.0 across this event".
- Evaluator Tags: tag management.
- Scoring UI itself never shown in video → own design (score + comments per submission per round).

## H. Agenda
- Header: "Manage your event agenda and schedule"; view tabs **List · Day · Week · Month · Rooms · Conflicts**.
- Toolbar: search sessions, layout toggle, Saved Views ▾, Columns, Sort, Filter, **Drafts**, ⋯ Options, **+ Add Session**.
- Empty state: "Nothing here yet — Sessions will appear here in list view."
- Grid (seen via embed preview): date header, room columns ("Room A"), hourly gutter (8 AM…), session blocks (Track pill + title + room).
- Dashboard alert feeds from here: "1 accepted session still needs a time slot on the agenda."

## I. Portals admin (tasks / forms / file requests)
- **Portals**: branded portal appearance config.
- **Tasks**: tabs All (3) / Contact Tasks (1) / Group Tasks (0) / Submission Tasks (2); **+ Add ▾** → Add Task / Copy from…; cards: title, **Manual** badge, description, target icon+type ("Contact", "Session"); examples: "Hotel and Travel Reservations" (Contact), "Presentation Upload" (Session).
- **Forms** (portal forms, ≠ submission forms): tabs All / Contact / Group / Submission Forms; empty state "Create a form to collect information from participants"; wizard: *Form Setup* (Name*, Title*, Type cards **Contacts / Groups / Submissions**) → *Form Questions* (Section Title*, Description & Instructions rich text; "+ Add Field" ▾ → **Add Section Element / Create Field /** search existing field library: Client Session ID (text), Description (wysiwyg), Format/Language/Level/Tags (dropdown); Title row locked+required; per-row lock icon) → *Settings* (**Send Confirmation Email** toggle + rich message "Thank you for submitting your form. Here is a link to your submission."); header: Duplicate / Delete / **Save**; toast "Saved successfully — View All Forms".
- **File Requests**: tabs All / Contact / Group / Submission Requests; note "Uploaded files are stored here for download or export — they are not attached to a submission or contact record"; Add drawer: info banner ("Files are stored, not attached"), Title ("e.g. Upload Presentation Slides"), Type* cards Contacts/Groups/Submissions, Instructions rich text, Cancel / **Create File Request**.
- Resources (wiki pages — struck through in the brief), Files.

## J. Dashboard
- Header: weekday + date + "**65 DAYS TO EVENT**", "Good morning, Sw"; dot-tabs **Today · Review Progress · Speaker Tracking · Submissions Pipeline**; **+ Add Dashboard**.
- Today: stat cards **Submissions / Accepted Speakers / Exhibitors / Sponsors**; SUBMISSION STATUS row: Accepted · Pending ⓘ · Declined · Drafts · Withdrawn; "Also check" links ("1 accepted session still needs a time slot (Agenda) →", "3 submissions awaiting a decision (Participants) →", "+1 more"); section tabs **Submission Forms / Participants / Evaluations / Agenda**.
- Submission Pacing widget: Submissions, "vs prior (T-66d)", Days to event, "This week vs prior"; cumulative line chart; **Days before event / Calendar date** toggle; "Pick a prior event to compare submission pacing edition-over-edition."
- Your forms: SUBMISSION PROGRESS bar ("2 submitted"), per-form cards (name, Open badge, "Closes in a month", submitted count, **View** / **Manage**), "View 1 more".
- Recent Submissions table: Source · Title · Status · Speakers · Tags · Submitted (timestamps).
- Participants tab: alert rows ("3 submissions awaiting a decision → Review submissions", "2 accepted speakers are missing a bio or headshot (2 bios, 2 headshots) → View speakers"); **Program snapshot**: participants-by-role bar (unique count, dedupe note), submission-status donut ("3 awaiting decision"; legend with % per Accepted/Pending × abstracts/sessions).
- Evaluations tab: **Review progress** ("Reviewer assignments will appear here once evaluations begin"), Evaluation 2.0 plans · Evaluated submissions · Reviews in progress counts, "Most active plan", **Open evaluation** link.
- Speaker Tracking (CUSTOM DASHBOARD): Accepted Speakers, Outstanding Speaker Tasks, Speaker Confirmation Mix (chart), Top Speakers by Outstanding Tasks; **+ Add Widget**, Settings.
- Submissions Pipeline (CUSTOM DASHBOARD): "Funnel of submissions from received → reviewed → accepted, with per-form and per-track context"; Total Submissions, Pending Review, Submissions by Form (bar), Submissions by Track (bar).
- New Dashboard modal: tabs **Gallery / ✨AI prompt / Build manually**; templates: Event Overview (5 widgets), Submissions Pipeline (3), Speaker Tracking (3), Review Progress (5), Evaluation Plans by Tracks (4), Schedule Health (5).

## K. CMS → Embeds (P2 #2)
- List: "Export a feed of your agenda, sessions, or speakers to place in your app or website"; search by name/format/ID; chips All 1 / Enabled 1 / Disabled 0; **+ Add Embed ▾**; group "Styled HTML"; card: name, Enabled badge, copy icon, ⋯.
- Editor: ← back, Name* + **Enabled** toggle; Format: "Embed Styled HTML" (**Locked**) — "styled HTML feeds including Agenda, Session List, Schedule Itinerary, Speaker List, and Speaker Gallery… auto-update with speaker and session details"; accordions **Style Options / Filters (1) / Field Options**.
- Preview pane: **Preview / Get Code** tabs; content dropdown ("Agenda ▾"); desktop/mobile toggles; fake URL bar `https://www.yoursite.com/agenda?sb-speaker-id=abc123` + Go; **Copy code**; refresh; open-in-new-tab.
- Rendered: event title banner, date ("Mon, October 12, 2026"), room columns, time gutter, session cards (Track pill, title, room); click → detail modal: ← Back, ×, **Speakers** list (photo, name, job title, company), tabs **Session Details / Subsessions (0)**, description; "Powered by" footer.

## L. Emails (cross-module)
- Transactional: Submission Confirmation (**must have**), Accept, Decline, Reminders (5d/1d before close), portal-form confirmation, admin new/updated-submission notifications.
- Template editing: subject + rich body; Lifecycle vs Custom; manual vs automatic triggers; custom HTML/CSS (P2).
- Calendar invites: .ics attached to acceptance/scheduling emails (P1 #1).
