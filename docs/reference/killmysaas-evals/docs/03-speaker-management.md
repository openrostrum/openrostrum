# Speaker Management — feature reference

## What this is

This documents **SessionBoard's speaker-management behavior as the target to clone**. It merges three research areas: `speaker-management` (the core capability page: portals, tasks, comms, progress tracking), `conference-speaker-management` (the end-to-end lifecycle page, which overlaps heavily — deduped here, keeping only its distinct deltas: document requests for contracts/COI, travel-preference fields, dashboard framing), and `learn-participant` (the knowledge-base view of the speaker portal from the participant's side: login flow, dashboard widgets, task mechanics, profile/account settings).

Speaker management is the post-acceptance workflow hub between the CFP and agenda publishing. Organizers maintain a per-event speaker directory/CRM (profiles with bio, headshot, title/company, social links, statuses, session assignments). Each speaker gets a personalized, event-branded portal scoped to only their own sessions, tasks, files, and resources, where they self-serve profile updates (within organizer-set field-level locks), upload requested files, and track deadlines. Organizers create tasks with due dates, assign them individually or in bulk, track completion in a filterable progress dashboard, and run bulk email/SMS with templates and merge fields, all logged to a communications history.

**Scope boundary:** file-request tasks, file uploads, versioning, comment threads on session files, the deliverables dashboard, deliverables-reminder emails, and content approval are owned by the **content-management spec** (see `docs/*content-management*`) — this area owns general/action tasks (mark-complete, due dates, portal visibility) and general bulk comms (e.g. welcome emails). Full session scheduling, room/time conflict detection, and agenda publishing are owned by the agenda area; this spec only checks speaker↔session assignment *visibility*. Headshot upload IS owned here — via portal profile editing (SPK-08), not via a file-request task.

## Personas & user journeys

Personas in scope: **organizer** (event team member managing speakers, tasks, communications) and **speaker** (portal user completing profile and deliverables). Research also names collaborators (co-presenters, assistants, agency contacts) and exhibitor/sponsor group-portal members — documented below but unscored (see Rubric rationale).

### 1. Onboard confirmed speakers (organizer)
1. Log in and open the Speakers section of an event
2. Add or import speakers (name, email, title, company, bio, headshot)
3. Set each speaker's status (Invited/Confirmed/Declined)
4. Create tasks — headshot file request, bio form, slides upload — with due dates
5. Assign tasks to all confirmed speakers in bulk
6. Send portal invitation email via template with merge fields

**Filled state:** speaker list shows 12+ speakers with headshot thumbnails, titles, companies, status badges; each confirmed speaker has 3–4 assigned tasks with due dates visible in a tasks view.

### 2. First portal login (speaker)
1. Click the portal link from the confirmation email
2. New user: create a password; returning user: enter it ("Forgot your password?" at bottom right of login box)
3. Click "Continue to portal" and pick a portal if you have several
4. Land on the branded dashboard

**Filled state:** dashboard with event logo, accent color, welcome message; widgets: My Sessions (1 submission, status Accepted), Tasks (3 items, 2 incomplete), Files, Resources; top nav with Submissions/Files/Resources; initials avatar top right.

### 3. Speaker completes deliverables (speaker)
1. Open the personalized portal
2. See only own profile, sessions, and task list with due dates
3. Edit bio and social links; upload a new headshot
4. Open a file-request task and upload the requested file
5. Mark tasks complete; watch status flip

**Filled state:** portal shows the speaker's name/photo, their 1–2 sessions, a task list with mixed states (2 completed with checkmarks, 1 pending with a due date), and a resources/info section. Per the participant docs, each task row shows name, red asterisk if required, description, due date **with timezone**, and Incomplete/Complete status; the expanded view offers "Open Link" (when a URL is attached), "Mark as Complete", and "Done" (exit without changing status).

### 4. Chase incomplete deliverables / reminder blast (organizer)
1. Open the speaker tasks/progress dashboard
2. Filter to incomplete or overdue tasks
3. Select the lagging speakers and send a bulk reminder email using a template with auto-filled name/session/deadline merge fields
4. Extend the due date for one priority speaker who asked for more time
5. Verify a late upload is accepted and the dashboard updates

**Filled state:** dashboard shows per-speaker completion (e.g., 8/12 complete, or "3/5 tasks" per row), overdue tasks highlighted, filter chips active (e.g. "Missing: contract" with 3 rows), composer preview showing resolved merge fields, and a communication history entry "Reminder sent" timestamped today.

### 5. Answer a speaker question (organizer + speaker) — unscored here
1. Speaker posts a comment/message from their portal on a session or task
2. Organizer sees the thread tied to that speaker/session and replies
3. Speaker sees the reply in their portal thread

**Filled state:** a two-way message thread with 2–3 messages, timestamps, and author names attached to a specific speaker or session. (Comments on session *files* are exercised in the content-management spec; per-speaker threads are documented but not rubric-scored here — see Rubric rationale.)

### 6. Sourcing returning speakers from the CRM (organizer) — unscored here
1. Open the org-wide Speaker CRM spanning past events
2. Search/filter by expertise tag and past rating
3. Open a returning speaker profile showing session history, ratings, communication log, travel preferences
4. Add speaker to the new event; bio and headshot prefill

**Filled state:** CRM list shows 20+ speakers with tags and event-count badges; profile shows 2 prior events, 3 past sessions, a 4.6 rating, a stored travel-preference note; new-event record arrives pre-populated. (Cross-event reuse requires a second event and time; kept as documentation, not rubric.)

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| Speaker directory/roster | Yes | Central per-event list with search, filters (status, task completion, tags), bulk selection for high volumes (12–400+ speakers). | List/card grid with headshot thumbnail, name, title/company, status badge; search box; filters; checkbox bulk-select with bulk-action menu. |
| Speaker profile record | Yes | Full record: bio, headshot, contact info, social links, custom fields, session assignments, change history with timestamps/attribution. Organizer-editable. | Profile detail page with photo, editable fields, sessions list, tabs for files/history/comments; save persists on reload. |
| Bulk speaker import (CSV) | No (inferred from "add or import speakers" + CRM "smart import with auto-mapping") | Import multiple speakers at once; auto-mapped columns. | Import control accepting CSV; optional column-mapping step; roster populated with imported rows. |
| Workflow statuses incl. custom statuses | No | Speakers/sessions carry statuses (Invited, Confirmed, Accepted, Declined); organizers create custom statuses mapped to system statuses (e.g. "Pending Contract") and filter by them. | Status badge on records, dropdown to change, settings screen for custom statuses, status filter in lists. |
| Personalized speaker portal | Yes | Per-speaker workspace scoped to that speaker only: their sessions, tasks with deadlines, files, profile editing, resource/wiki pages. Mobile-friendly, event-branded. Access via emailed link/credentials (inferred: magic-link or account login, per category norms). | Distinct speaker-facing view greeting the speaker by name, showing only their own content; nav for profile, tasks, sessions, resources. |
| Portal login & account creation | Yes | Portal link arrives in confirmation email; new users create a password, click "Continue to portal", pick a portal; forgot-password sends reset email. | Login page with email+password, forgot-password link, continue button, portal-picker for multi-portal users. |
| Profile self-service w/ field locks | Yes | Speakers update bio, headshot, social links from the portal; organizer-configured field-level locking restricts editable fields; edits sync to the organizer view. | Editable portal profile form with headshot image upload; locked fields read-only; changes visible in organizer's record. |
| Headshot upload & guidelines | No (listed non-must in participant docs, but feeds agenda/program site/embeds) | Headshot collected via profile field or a headshot/bio form task (upload location inferred); do/don't guidance (well-lit, neutral background). | Image field with upload and preview (inferred); rendered thumbnail on roster and profile. |
| Tasks and deliverables | Yes | Tasks with title, description, due date, and type: general action item, file request, or form. Assigned individually, in bulk, or automatically from session/contact data; content auto-fills contact values (personalized tasks). | Task creation modal with type selector, due-date picker, multi-select assignee picker; tasks appear on speaker records and in portals. |
| Portal task list & completion | Yes | Task rows show name, required asterisk, description, due date + timezone, Incomplete/Complete; detail view has "Open Link", "Mark as Complete", "Done". Tasks may be hidden until accepted unless "Always Show Tasks". | Task widget with required markers, due dates, status chips; expandable detail with completion controls. |
| Document/file collection (incl. contracts & COI) | Yes | File requests explicitly cover contracts and certificates of insurance with deadlines, reminders, per-request tracking; collection-only, no e-signature claimed (inferred: signed docs uploaded as files). Uploaded files tracked against task/speaker/session with name and timestamp. | Named document request with type/assignee/deadline; pending row flips complete on upload; organizer file list with filename, uploader, time, download control. *Versioning/approval owned by content-management.* |
| Task progress dashboard | Yes | Real-time per-speaker/per-task completion across tasks and sessions; filterable by complete/incomplete/overdue. | Table/board of speakers × tasks with status indicators, progress counts, status filters; updates after a portal completion. |
| Automated deadline reminders | Yes | System emails reminders to speakers with incomplete tasks based on due dates (inferred cadence: before due date and when overdue, per category norms). | Reminder settings on tasks/portal config; sent reminders in communication history. |
| Per-speaker deadline extension | No | Organizer extends a task due date by 1–31 days for one speaker; late completions accepted. Documented quirk: the speaker keeps seeing the original due date while the backend honors the extension. | Extend-deadline control on a per-speaker task assignment; previously-overdue task becomes completable. |
| Bulk email and SMS | Yes | Email (and SMS) to filtered speaker groups; scheduling and campaigns; every send logged in communications history. SMS undetailed (provider/opt-in unknown). | Compose with recipient filter/multi-select, subject/body editor, send/schedule; history page listing sends with recipients and timestamps. |
| Email templates with merge fields | No | Pre-built and custom templates with tokens auto-filling speaker details (name, session, task, portal link) per recipient. | Template picker in compose; body shows tokens or a per-recipient preview substituting real data. |
| Direct messaging and comments | No | Threaded messages tied to a speaker or session; organizers post, speakers reply from the portal; history preserved. | Thread panel on speaker/session detail (organizer) and matching portal thread, with authors and timestamps. |
| Session assignment visibility | Yes | Accepted-submission data flows to speaker+session records without re-entry; sessions link to speakers and show in the portal ("Assign sessions confidently"). Scheduling, conflict detection, and agenda publishing owned by agenda/CFP areas. | Speaker record lists assigned session(s); portal shows the speaker's own session details. |
| Collaborator access | No | Co-presenters, assistants, agency contacts added with role-based permissions and scoped portal access ("everyone sees what they need and nothing else"). | Add-collaborator control with role selection; collaborator listed with role. |
| Cross-event speaker CRM reuse | No | Org-wide persistent records: bio, headshot, session history, ratings, comm logs carry across events; returning speakers pre-populate; dynamic auto-updating lists. | Org-level database view outside a single event with multi-event history and cross-event search. |
| Travel-preference profile fields | No | Travel is NOT booked in-app — SessionBoard scopes logistics/registration out (integrations: Cvent/Bizzabo/Swoogo). CRM profiles store travel preferences as data fields (custom-field norm inferred). | Editable travel/logistics or custom fields persisting on the profile; no flight/hotel booking UI expected. |
| Multi-portal & multi-event switching | No | "Switch Portals" in the name menu switches among user/group portals; top-left event dropdown lists other events on the same email. | Portal-switcher dropdown; event dropdown, alphabetical. |
| Shared group (exhibitor/sponsor) portals | No | Groups share one portal; teammates get individual credentials and see identical info and tasks. | Group portal identical for all members; per-member logins. |

## Rubric rationale

- **SPK-01 (w3, auto):** the roster is the area's front door — no list of speakers, no speaker management; search/filter is fully browser-verifiable.
- **SPK-02 (w3, auto):** manually adding and editing a speaker record with persistence is the minimum organizer capability; a sentinel bio makes persistence objectively judgeable.
- **SPK-03 (w2, auto):** CSV import is important at real event volumes and exercisable with the provided `speakers.csv` fixture, but the area functions without it. The fixture CSV repeats the two manually added speakers plus one new person (Dana Kowalski); Dana appearing as a new record is the pass signal, and dedupe-by-email of the existing rows must not be penalized.
- **SPK-04 (w2, auto):** statuses drive filtering and comms targeting; important but not existential. Custom-status creation is treated as bonus, matching the "(inferred)"-thin documentation.
- **SPK-05 (w2, auto):** general/action task creation with due dates and multi-speaker assignment is the onboarding-task engine of this area; file-request tasks, uploads, and the deliverables pipeline are graded once, in content management (CNT-01/02/07).
- **SPK-06 (w2, auto-partial):** invitation/onboarding is how speakers reach the portal, but the agent can only verify the control and its success state — email arrival needs a human inbox (manual half).
- **SPK-07 (w3, auto-partial):** a portal scoped to exactly one speaker's content is the defining feature of SessionBoard speaker management; scoping is verifiable by checking the other fixture speakers are absent. Auto-partial because the agent can only exercise password sign-in/sign-up — SessionBoard's own documented first login goes through an emailed portal link, so a faithful emailed-link-only clone needs the manual inbox check.
- **SPK-08 (w3, auto):** self-service bio + headshot (headshot upload owned here, `headshot.png` fixture) syncing back to the organizer record is the core two-sided data loop.
- **SPK-09 (w2, auto):** general tasks appearing portal-side with due dates and persistent mark-complete states is the speaker half of onboarding tracking; persistence checked via reload. The upload-against-task flow is graded once, by CNT-02.
- **SPK-10 (w2, auto-partial):** organizers must be able to retrieve what speakers submitted; the agent verifies the listing/metadata/download response but not file bytes (manual half). Deeper versioning/approval is content-management's rubric.
- **SPK-11 (w2, auto):** session assignment *visibility* both sides is owned here; weight 2 because scheduling mechanics live in the agenda area.
- **SPK-12 (w2, auto):** the list-level progress view over general onboarding tasks ("who needs a nudge") is judged from the deliberately mixed completion state set up in SPK-S2; the full deliverables dashboard (uploads, filtering depth) is graded once, by CNT-07.
- **SPK-13 (w3, auto-partial):** general bulk comms (the welcome email to all speakers) with a logged history is core organizer workflow; actual delivery is the manual half. Deliverables-reminder emails to speakers with outstanding tasks are owned by CNT-08.
- **SPK-14 (w2, auto):** merge-field templates make bulk comms usable at scale; token resolution is objectively checkable in a preview.
- **SPK-15 (w1, auto):** conference extra that survived dedupe — travel/logistics as persisted profile data only (SessionBoard explicitly scopes out booking), so polish weight.
- **SPK-16 (w2, manual):** automated reminders need time passage and a real inbox — precise human checklist provided, including the documented extension/original-due-date quirk so clones aren't mis-penalized.

**Deliberately unscored (documented above, no rubric items):** per-speaker deadline extension (w1-grade polish; probed as a bonus observation in SPK-S3 step 9), direct messaging threads (overlaps content-management's comment threads; probing both would double-charge clones), collaborator roles, cross-event CRM reuse (needs a second event plus time), multi-portal switching, and group portals (need multiple simultaneous identities). Contract/COI document requests are file-request tasks owned by content management (CNT-01/02); the contract-specific framing remains a bonus observation in SPK-S3.

## Sources

- https://www.sessionboard.com/capabilities/speaker-management
- https://www.sessionboard.com/capabilities/conference-speaker-management
- https://www.sessionboard.com/capabilities/content-management
- https://www.sessionboard.com/products/speaker-crm
- https://www.sessionboard.com/feature/speaker-management
- https://www.sessionboard.com/blog/make-life-easy-for-your-speakers-with-personalized-tasks-sessionboard-product-update
- https://www.sessionboard.com/blog/product-update-custom-statuses-and-extending-portal-task-deadlines
- https://learn.sessionboard.com/en/knowledge-base
- https://learn.sessionboard.com/en/knowledge-base/participants/access-portal
- https://learn.sessionboard.com/en/knowledge-base/communications/create-send-emails
- https://learn.sessionboard.com/participants/overview
- https://learn.sessionboard.com/participants/access-portal
- https://learn.sessionboard.com/participants/edit-submission
- https://learn.sessionboard.com/participants/save-a-submission-as-a-draft
- https://learn.sessionboard.com/participants/how-to-add-of-edit-speaker-information-for-an-accepted-session
- https://learn.sessionboard.com/participants/updated-portal
- https://learn.sessionboard.com/participants/upload-files
- https://learn.sessionboard.com/participants/pp-how-to-view-and-download-files-from-my-portal
- https://learn.sessionboard.com/participants/speaker-headshot-dos-and-donts
- https://learn.sessionboard.com/participants/how-to-change-my-portal-username-or-email
- https://learn.sessionboard.com/participants/pp-how-to-access-additional-event-portals-you-are-associated-with
- https://learn.sessionboard.com/participants/exhibitor-portal
- https://learn.sessionboard.com/en/knowledge-base/portal-users
- https://learn.sessionboard.com/en/knowledge-base/6284020-configure-customize-portals
