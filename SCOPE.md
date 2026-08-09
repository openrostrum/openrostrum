# SCOPE — Kill My SaaS 1: open-source Sessionboard clone

> 🚧 **BUILD GATE (2026-08-08):** no build work — no scaffolding, code, screens, or agent swarm — until the verification-capability list is solved. See [`VERIFICATION-CAPABILITIES.md`](VERIFICATION-CAPABILITIES.md). Strategy: provide the agents every tool needed to *functionally* self-verify each feature (email inbox, DB query, .ics parse, Airtable, running instance, etc.); the agent picks the method. Gate status: 🔴 OPEN.

**Deadline:** Wednesday **Aug 12, 2026, 10:00 PM PT**. Submission = form + open-source repo + deployed site judges test against swyx's walkthrough.
**Judging:** AIE team (not swyx) evaluates independently; tiebreaker goes to "subjective judgment calls for the product we would actually use/buy". $10k.
**Sources of truth:** video walkthrough (transcript + frames in `docs/reference/`), Google Doc brief **PDF** (`docs/reference/brief.pdf` — the PDF matters: it shows strikethroughs and red priority callouts that plain text hides), Discord for clarifications. **Requirements freeze after the Sunday Aug 9 clarification video — re-check Discord/doc before locking anything.**

**Stack: LOCKED — canonical spec [`docs/tech-stack.md`](docs/tech-stack.md).** SCOPE-specific point only: Airtable is a **P2 one-way sync, never the primary store** — its 5 req/s + latency conflict with the performance bonus and swyx's on-camera "it's slow" complaint.

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
| **P0** | Demo-critical | The end-to-end path judges will walk. If any step breaks, we lose. Ship first, thin but working. |
| **P1** | Firm-requirement depth | Completes the 6 firm requirements + everything swyx annotated. Ship before adding anything from P2. |
| **P2** | Ranked follow-ups | Bonus points and optionals, strictly ordered by judge-visible value ÷ effort. Take from the top only. |
| **OUT** | Explicitly ignored | With the reason, so we never relitigate. |

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

## P0 — Demo-critical path (thin slice of all 6 requirements)

This is the literal sequence judges will replay from the walkthrough. Each step lists its acceptance criterion.

**0. Seeded demo event + auth.**
- Admin account + login. One pre-seeded event ("AI.Engineer Sandbox Event"-equivalent) with tracks, tags, formats, levels, rooms, and a few sample submissions so every screen has data.
- Submitter accounts: email + password signup/login at the public form (mirrors walkthrough), password manager friendly. Forgot-password can be a stub in P0 → real in P1.

**1. Admin creates a submission form (form builder). TARGET = the LATEST UI = 7-step wizard.**
(Now confirmed pixel-level: the latest 7-step builder is captured in `learn.sessionboard.com` static screenshots dated Feb–Jul 2026 — `docs/reference/hunt/guidde-round2/kb-screenshots/applications/building-your-submission-form/01–23.png` — and in the 2025-26 "Future of Abstract Management" webinar. Confirmed step rail: Submission Setup (incl. participant roles + sub-session toggle) → Welcome → Session Information → Participant Information → Payments → Form Settings → Admin Notifications → Preview/Publish. Sessionboard's OLDER KB video tutorials show a 4-page builder — do NOT target that. Full evidence map: `docs/reference/hunt/COVERAGE.md`.)
1. *Submission Setup* — type: Abstracts vs Sessions; Participants step on/off toggle.
2. *Welcome Screen* — internal name, external title, page heading (15-char cap), welcome message (rich text) + show/hide toggle.
3. *Abstract/Session Information* — section title/heading/instructions; default fields Title (locked, required) + Description (locked, rich text) + Format, Tags, Track, Level, Language (dropdowns, removable); per-field required toggle; drag to reorder; **Add Question** (reuse from field library, or Create New Field: Name, Type text/dropdown/checkbox, Description, Max Length, Event/Global scope); "Use question rules" for conditional logic; +line inserts section header / rich text / divider.
4. *Participant Information* — locked First/Last/Email; plus Company Name, Job Title, Mobile Phone, Home Phone, Biography, Headshot, Zip (toggleable); roles Speaker (min/max) — Chairperson/Moderator present; "Unique Contact Settings": *allow new info for existing contacts* (off), *notify existing contacts* (on).
5. *Payments & Fees* — **omit** (swyx red "NOT NEEDED"; the step exists in the latest UI but we skip building it).
6. *Form Settings* — **Close Date + time** ("kinda impt") + reminder-email toggle (5d/1d); submission limit per user; multiple-drafts toggle; **After submission: auto-redirect (~10s) + customizable success message ("make sure this works")**.
7. *Notifications* — submitter **Confirmation email ("must have")**; **admin-notify dropdowns** (new / updated submission, "nice to have").
- Header: Save, **Copy Link**, View Form. Per-form ⋯: Open / Edit / View Results / View Draft Submissions / Duplicate / Delete.
- Acceptance: create form → copy public URL → it works in incognito.

**2. Public CFP submission flow (the star of the demo).**
- Stepper: Welcome → Account → Submission → Participant → Review; top banner shows close date + submission limit.
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
- **Sessionboard semantics (confirmed by docs): status changes NEVER auto-send email.** Accept/Decline Queue statuses are staging that render as "Pending" in the portal; the admin then bulk-selects sessions → sends Accept/Decline template email (their cap: 100/send) → flips to final status. We replicate this model, plus an optional one-click "accept + send + finalize" as our improvement.
- Final status immediately visible in the speaker portal (queues stay masked).
- **ON ACCEPT, auto-provision (confirmed required by swyx): create the Session record, create/link the Speaker + participant records, and assign the onboarding task set** (hotel-stay form, flight-reimbursement form, + optional tasks). This is the spine linking review → portal → agenda; build it explicitly, not as a side effect.

**5. Evaluation / review workflow (req 4, thin) — SIMPLIFIED per organizer.**
- Floor confirmed by swyx: each reviewer moves a submission **unreviewed → approve / maybe / deny** (+ optional comment). NOT a scorecard — scales/criteria/rounds are bonus (P2).
- Version note: the LATEST Sessionboard eval is **2.0** (round-based plans/assignments — swyx's dashboard shows "Evaluation 2.0 plans"). The KB tutorial shows the older 1.0 six-step wizard. If we build evaluation *depth* beyond the 3-state floor, target the 2.0 model in `docs/flows/05-evaluations.md`, not the 1.0 tutorial.
- **Track-based routing (confirmed requirement):** submissions carry ≥1 track; reviewers are assigned ≥1 track; each submission surfaces to reviewers whose tracks overlap. Reviewer "My Reviews" queue = submissions in their tracks.
- Admin sees the decision tally per submission and makes the final accept/decline.
- **Bonus (swyx-named):** compose + send an email to the speaker (request changes / attach feedback) when recording the decision.

**6. Agenda builder (req 5, thin).**
- Accepted sessions appear as unscheduled (right-side Scheduled/Unscheduled panel); drag onto a day×room grid; **conflict detection**: Sessionboard checks **speaker double-booking + same-room/time overlap only** (verified — NO track collisions; the brief's "across rooms and tracks" means track-collision is a *build-beyond* extra). Conflict marker = red clock icon; Conflicts tab lists reciprocal rows with Open→editor.
- Agenda Settings: Day Start/End time, which statuses are schedulable, **per-format Default Duration (auto-fills end time)**, Room Visibility.
- Views: List + Day/Rooms grid in P0; Week/Month/Track in P1. (List defaults to Accepted-only.)
- Dashboard-style alert: "N accepted sessions still need a time slot."

**7. Tasks + outstanding-tasks dashboard (req 6, thin).**
- Onboarding task set auto-assigned on acceptance. **Must-have tasks (swyx-named): (1) hotel-stay requirement form, (2) flight-reimbursement form** — both are portal forms the speaker fills in. Optional extras to seed: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount.
- Task shows in the speaker portal; speaker completes it (marks done or submits the attached form/file).
- Admin dashboard view: which speakers still have outstanding onboarding tasks (counts + per-speaker list). This *specific view* is the firm part of req 6.

**8. Emails + calendar invites (req 3) — must actually work (MVP), confirmed by swyx.**
- Provider: Resend or Cloudflare Email (swyx named both). Deliverability tested end-to-end day 1.
- Transactional: submission confirmation (immediate, "must have"), Accept, Decline, reminder ×2 (5-days / 1-day before Close Date, via Cloudflare Workflows/cron). Templates editable (subject + rich body) at event level.
- **Calendar invites (.ics) attached to acceptance/scheduling emails** — Gmail/Outlook/iCal. Sessionboard has none, so this is a differentiator; elevated from P1 to P0 because swyx confirmed it must work.

---

## P1 — Firm-requirement depth (in order)

1. ~~Calendar invites~~ — **moved to P0 #8** (swyx confirmed must work).
2. **Conditional logic ("question rules")** (req 1): show field B when field A matches a value (trigger types checkbox/dropdown/number, no AND/OR). "conditional fine for now" per swyx. (Track routing is now P0 in the evaluation step, not here.)
3. **Speaker file uploads** (req 2): headshot in profile + slides/documents via File Requests or task-attached uploads; files listed on the submission (admin side).
4. **Save as draft + resume** on the public form (drafts count toward limits; portal shows "resume draft").
5. **Event Settings**: event details (name, slug, type, URL, location, timezone, start/end, theme), logo/background upload; Library: manage Tags, Tracks, Formats, Levels (feeds all dropdowns).
6. **Email template editor page** (list with category/type/trigger columns; edit subject/body; manual vs automatic triggers) + admin-notify pickers on forms ("nice to have" annotation).
7. **Dashboard "Today"**: greeting + days-to-event, stat cards (Submissions, Accepted Speakers), status breakdown row, "Also check" alert links, recent submissions table, per-form submission progress.
8. **Portal Tasks depth**: task types (Contact/Group/Submission), portal forms attachable to tasks (the "fill out a form in a Task" flow from the screenshots), file-request tasks.
9. **Agenda views**: Week + Track views, drafts filter, search/filter by track/room. (Day/Rooms is the confirmed floor; these are bonus per swyx.)
10. **Scorecard evaluation** (numeric scales / criteria / weighting) and **multi-round** (rounds with due dates) — bonus depth above the confirmed 3-state decision floor; AI-assist stays P2.
11. **Withdrawn/Accept-Queue/Decline-Queue semantics** — queue statuses as staging before the accept/decline email fires (matches Sessionboard's status set we observed).
12. **Forgot password + auth polish.**

## P2 — Follow-ups, strictly ranked (take from the top)

1. **Airtable one-way sync** — explicit bonus, their team's stack. Sync submissions/speakers/sessions tables on change (background job; tolerate rate limits).
2. **Public embeds / schedule + speaker gallery page** — struck as a requirement and labeled OPTIONAL, but it's the highest "product we'd actually use" tiebreaker value: a public, mobile-friendly `/schedule` + `/speakers` page (reference: wf2025.ai.engineer/schedule) with embeddable snippet. Session detail modal with speakers.
3. **CSV/XLSX export + import, "download files bundle"** — small effort, real operational value for a team migrating off Sessionboard.
4. **API (Sessionboard-compatible subset)** — bonus; concrete target documented in `docs/flows/08-settings-data-api.md`: canonical OpenAPI spec has 177 ops; we mirror the core read/search set (sessions, speakers, contacts) with `x-access-token` auth, their pagination (default 25/max 100) and response envelopes. Do after export (export proves the data model; API is a formalization).
5. **Dashboard extras** — Submission Pacing chart, Participants/Evaluations tabs (missing-bio alerts, status donut), Speaker Tracking + Submissions Pipeline widgets. Nice demo shine, zero firm-requirement weight.
6. **Admin impersonation** — "View Portal / Back to Admin Mode" toggle (tiny, and swyx used it constantly while demoing).
7. **AI-assisted review** — struck through + "very optional, do if u feel like it". Only if hours remain: LLM pre-score/summary per submission feeding the evaluation round.
8. **Email themes / custom HTML+CSS** in templates.
9. **Forge hosting** — "very teeny bonus points". Mirror the repo there at the end if trivial.
10. **Saved views / column preference panels** on admin tables — cosmetic parity, skip unless free.

## OUT — do not build (and why)

| Item | Why |
|------|-----|
| Payments & Fees | Red "NOT NEEDED" annotation |
| Accelevents integration | Struck through in brief |
| Resource/wiki pages in portal | Struck through in brief |
| CRM module (Speaker CRM, contacts, segments, exhibitor/sponsor mgmt) | swyx: "probably not really using the CRM side" |
| Marketing module (transcriptions, captions, content repurposing, media library) | Same — out of Program scope |
| CMS beyond embeds; Site/microsite builder; Invoices; Awards; Digital Posters | Never mentioned as needed |
| AI agents (Reviewer/Scheduler/Coordinator), "Find or ask" AI search | "I don't care about the AI workflow thing" — verbatim |
| Reports / Studio / History modules | Not in any requirement |
| Multi-language forms | "We only care about English" — verbatim |
| Multi-org, Event Team roles/permissions | Single admin is enough to judge |
| Integrations page (Cvent, Swoogo, Zoom) | Not requested |
| CEU credits / capacity / Client Session ID as *UI features* | Keep as plain optional columns in the data model; no dedicated UX |
| Pixel-fidelity to Sessionboard's design | Brief: explicitly not required — job-to-be-done + speed instead |

## Cross-cutting (applies to every tier)

- **Performance is a scored feature.** Target: no skeleton-screen theater, <1s page loads, instant table interactions. The walkthrough shows Sessionboard's loading spinners repeatedly while swyx complains — that contrast is our cheapest win.
- **Empty states** for every list (judges start from a fresh event).
- **One shared rich-text editor** component (B/I/U, lists, links, alignment) reused everywhere Sessionboard shows WYSIWYG.
- **Seed script** that recreates the walkthrough state on demand (demo event, 3 forms, sample submissions across statuses, an eval plan, scheduled + unscheduled sessions, tasks).
- **Mobile-friendly public pages** (CFP form, portal, schedule embed). Admin can be desktop-only.
- **Email**: use a real provider (e.g. Resend) + verified domain early — deliverability of the "must have" confirmation email is a demo-day risk, test end-to-end on day 1.

## Open questions — RESOLVED by research (2026-08-08; details in `docs/flows/README.md`)

1. **Conditional logic** → Sessionboard's "question rules": show-a-question-when-another-matches, triggers limited to Checkbox/Dropdown/Number, no AND/OR or chaining. Build exactly that (P1 #2). Source: learn.sessionboard.com FAQ.
2. **Category-based routing** → no submit-time routing exists in Sessionboard. It's evaluation-side: assignment rules filter submissions (track/format/tags/status) to evaluator pools; docs recommend one plan per track. Covered by evaluation scope; no routing engine needed.
3. **Calendar invites** → Sessionboard has NO per-speaker calendar invites (0 mentions of .ics in its entire KB; only a whole-agenda iCal embed feed). Requirement 3 is a **differentiator we build beyond parity** — keep P1 #1 and feature it in the submission writeup. Judges can't compare against the original; a standard .ics attachment satisfies Gmail/Outlook/iCal.
4. **Submitter auth** → email + password confirmed (email-first lookup → login or inline signup; deep links land on a password gate; no magic links). Mirror it in P0.

**All four also confirmed directly by the organizer in Discord (2026-08-08)** — see `docs/reference/discord/CLARIFICATIONS.md`, which additionally resolved: review floor = 3-state decision (not scorecard), accept auto-provisions speaker+session+tasks, tracks are many-to-many for routing, calendar invites must work, must-have onboarding tasks named, agenda floor = day/room+drag+conflicts, admin UI is the priority. Remaining watch item: swyx's promised follow-up video on email/calendar depth (not yet posted in #announcements).

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
- Step 5 Payments & Fees (OUT): When to Collect Payment — "Do Not Collect Payment" (Selected) / "Upon Submission".
- Step 6 Form Settings: Deadlines — **Close Date** (date+time+TZ, clearable; "Set a close date to enable draft reminder emails"); **Send Reminder Email** toggle (copy: reminds those with saved drafts "five days" / "one day" before close); Submission capacity — **Set Submission Limit** toggle ("Event max: 3 applies when no form-level limit"), **Allow multiple draft submissions** toggle + "Effective behavior" explainer; After submission — **Auto-redirect to speaker portal** toggle ("after 10 seconds"), **Customize the success page message** (rich text; default copy about confirmation email, review timeline, portal, submit-another link); Validation rules — **Cross-field character limits** ("cap combined length of several text fields, e.g. printed program block") + Add rule.
- Step 7 Notifications: "What admins should be notified when a **new** submission is received?" (multi-select chips ×) · "…when an **existing** submission is updated?" (multi-select) · Submitter notifications (1 template): **Submission Confirmation** ("email sent to submitter after a successful submission") toggle + Customize · Admin notifications (2 templates) accordion.

## D. Public CFP flow
- URL shape: `/submit/<event-slug>/<form-uuid>` (+ `/step/auth`, `/step/session…`, `/step/participant`, `/step/confirm…`).
- Stepper: ①Welcome → ②Account → ③Submission → ④Participant → ⑤Review (checkmarks as completed).
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
- Resources (OUT), Files.

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
