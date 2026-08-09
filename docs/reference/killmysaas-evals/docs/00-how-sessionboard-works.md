# How SessionBoard works — end-to-end reference

> This document describes **SessionBoard's** behavior as documented on sessionboard.com and learn.sessionboard.com. It is the *target being cloned*: submissions to this eval kit are graded against the functionality described here, never against SessionBoard's pixels or navigation labels. Where the research could not confirm a detail and had to extrapolate from category norms (Sessionize, Cvent, EasyChair), the detail is marked **(inferred)**.

---

## 1. What SessionBoard is, and the product map

SessionBoard is a **speaker and content management platform** for event organizers. It covers everything between "we announced a call for papers" and "the final agenda is live on our website with speaker headshots and approved slide decks": collecting talk proposals, grading them with a review committee, notifying speakers, onboarding accepted speakers through branded portals, collecting their deliverables (headshots, bios, slides), building a conflict-free schedule, and publishing the result as embeddable public widgets.

### The core pipeline

Every module feeds the next. The connective tissue is the **session record** (a proposal that becomes a scheduled talk) and the **contact record** (a person who becomes a speaker):

```
  CFP form  ──►  Submissions  ──►  Evaluation  ──►  Accept /   ──►  Speaker    ──►  Content     ──►  Agenda    ──►  Public
  (public,       (Sessions          plans           Decline         portal          collection       builder        widgets
   builder-       table, 5-         (anonymized,    (status         (tasks,         (files,          (5 views,      (embeds,
   made form)     stage status      weighted        pill + bulk;    branding,       versions,        drag-drop,     program
                  pipeline)         rubrics)        emails sent     invitation      comments)        conflict       site)
                                                    separately)     acceptance)                      detection)
```

### Module inventory

| Module | What it does | Feeds |
|---|---|---|
| **Event Settings** | Event name, URL slug, type, website, location, timezone, start/end date-times, theme description, logo (300×300), background (1500×500); record settings (submission limits, portal auto-access, ID prefixes) | Everything — event is the container all data is scoped to |
| **Forms (Sessions > Forms)** | 4-section CFP form builder: Welcome screen, Session Information, Speaker Information, Form Settings. Up to 24 forms/event. Public shareable link, no login needed to submit | Submissions |
| **Sessions** | Submissions table with 5-stage status pipeline (Pending → Accepted queue → Accepted / Decline queue → Declined), customizable dashboard columns, manual session creation, clone, subsessions, drafts view | Evaluation, Agenda, Portals |
| **Evaluations** | Evaluation plans: anonymized review, 1–5 or 1–20 rating scales, weighted rubrics summing to 100%, evaluator assignment, session filters, field-visibility control, custom questions, multi-round workflows, AI evaluations | Accept/decline decisions |
| **Communications** | Templated email (and SMS) composer launched from any records table; per-recipient preview; 100-recipient cap per send; no attachments; history log. Status changes deliberately **never** auto-email | Speaker notification |
| **Contacts / Speakers** | Contacts are event-level people records; a contact becomes a *speaker* only when assigned to a session via its Participants tab. Speakers support display ordering and a public-visibility toggle | Portals, widgets |
| **Portals** | Branded logged-in workspaces for speakers (plus exhibitor/sponsor group portals): tasks (general, file request, form), resources (files, wiki pages), field-level visibility, appearance theming, invitation acceptance, completion tracking | Content collection |
| **Agenda (Sessions > Agenda)** | 5 views (List / Day / Week / Month / Rooms), drag-and-drop scheduling of accepted sessions into date/time/room slots, track-driven color coding, conflict detection (room overlaps + double-booked speakers), AI agenda builder | Public widgets |
| **Embeds / Program site** | Embeddable public agenda and speaker widgets for external sites; hosted program site; hidden speakers/sessions are excluded | Attendee-facing web |
| **Speaker CRM** (org-level) | Cross-event contact database: custom fields, segments, pipeline board (inferred: kanban), interest forms, data import, contact history | Sourcing speakers for future events |
| **Adjacent add-ons** | Sponsors/exhibitors, reporting & dashboard views with CSV/XLSX export, event team & roles, Insights AI, Studio, marketing suite, awards, integrations (Cvent, Swapcard, Zapier, webhooks, API, SSO) | Out of core scope |

The eval kit's seven graded areas map onto this pipeline: **01 Call for Papers** (form builder + public submission), **02 Abstract Management** (statuses, evaluation, decisions), **03 Speaker Management** (contacts, speakers, portal), **04 Content Management** (files, versions, approvals), **05 AI Agenda** (agenda builder), **06 Public Widgets** (embeds), **07 Speaker CRM** (optional, extra credit).

---

## 2. The organizer journey, step by step

The organizer persona (fixtures: **Jordan Alvarez**, jordan.organizer@sbek-test.example.com) runs the whole lifecycle. SessionBoard's own getting-started materials sequence it like this:

### 2.1 Create and configure the event

Settings captures: event name, app URL slug, event type, website URL, location, timezone, start/end date-times, and a theme description (the AI features consume type/URL/location/theme). Two image slots: logo (300×300) and background (1500×500). Record settings add toggles for submission limit per user, automatic portal access on contact creation, additional-contacts collection, primary speaker designation, participant (speaker) acceptance workflow, headshot file restrictions, and record ID prefixes (3–6 uppercase chars).

**Filled state:** a settings page showing a complete event profile — e.g. *DevFlow Conf 2027*, slug `devflow-conf-2027`, Moscone West San Francisco, 2027-05-12 → 05-14, both images uploaded — where every edited value survives a page reload.

### 2.2 Build the submission form

Sessions > Forms hosts a default editable CFP form with four sections:

1. **Welcome screen** — internal form name, external title, headers (15-char limit), welcome message.
2. **Session Information** — Title and Description are required and non-removable; organizers add custom questions (dropdowns, checkboxes, numbers, long text) with labels and help text.
3. **Speaker Information** — First name / Last name / Email are locked; extra fields (bio, company, headshot upload) can be added.
4. **Form Settings** — close date (blocks new submissions *and* edits), automatic reminder emails 5 and 1 day before close, admin notification on new submission, speaker limit up to 15 per session, submission limit per submitter, custom confirmation message with an automatic 10-second redirect to the portal.

Layout elements (section headers — 255-char max, dividers, rich text blocks) are inserted via a blue + icon; conditional logic (question rules) is available on Checkbox, Dropdown, and Number fields. New fields can be event-level or global; editing a global field affects all forms using it. Up to 24 forms per event. The form is shared as a public URL and submitters can save drafts.

**Filled state:** form builder shows 4 tabbed sections with ~10 mixed-type questions; the public form renders a welcome screen then paginated session and speaker questions; the forms list shows each form with an open/closed status and an ellipsis menu (Edit / View Submissions / View Draft Submissions / View Form / Duplicate / Delete).

### 2.3 Collect and manage submissions

Incoming submissions land in the Sessions table as **Pending**. The table's dashboard views are customizable — any submission-form answer can become a column, and views are savable. Organizers can also create sessions manually, clone them, manage subsessions, and see draft submissions separately.

**Filled state:** a Sessions table of ~30 rows with mixed status pills (e.g. 18 Pending, 4 Accepted queue, 5 Accepted, 1 Decline queue, 2 Declined) and form-answer columns like track and format populated.

### 2.4 Evaluate with the review committee

Sessions > Evaluation > Evaluation Plans > **Add Plan**. Plan configuration: name, instructions with scoring guidance, open/closed state with due date, **anonymized review** (hides speaker names from evaluators), weekly Monday evaluator reminder emails, session-file access toggle, session filters (track, tags, format, level, language, status), evaluator-visible field selection, and custom rating questions (dropdown, comment box). Grading setup is **immutable after creation**: faces/numbers on a 1–5 scale or stars/hearts on 1–20, optional weighted rubric whose criteria must sum to 100%, and a max-evaluations cap per submission.

Evaluators must first be added to the event team; the plan must be closed to assign them. Roles: Evaluator, Evaluator Session Manager, Admin. Results are admin-only, with per-plan and cumulative report exports and plan duplication. Multi-round workflows advance submissions through successive review rounds, and **AI Evaluations** auto-score submissions (inferred: AI produces suggested ratings organizers review).

**Filled state:** plan list shows *"Round 1 Committee Review"* with evaluator count and due date; the reviewer's view lists filtered, anonymized sessions with rating widgets; the admin summary shows per-session average scores and completed-evaluation counts.

### 2.5 Decide and notify — two separate deliberate steps

Decisions are made on the Sessions table by clicking a status pill and choosing among **Pending / Accepted queue / Accepted / Decline queue / Declined** (custom statuses creatable in Program settings), including bulk updates on multi-selected rows. Crucially, **changing status never auto-emails anyone**. Notification is its own step: select the accepted (or declined) records → **Send Emails** → a two-pane compose modal with recipient scope, reply-to, send-from, CC/BCC (up to 5 each), subject, rich body, a Template button for prebuilt templates (e.g. the fixture *Acceptance Notification* with merge fields), and per-recipient preview by clicking each contact. Hard cap: 100 recipients per send; no attachments (files are shared via the portal); default sender no-reply@notify.sessionboard.com unless the custom-domain add-on is active. Email/SMS history logs per-message tracking.

**Filled state:** compose modal listing the selected speakers on the left, templated subject/body on the right with merge fields resolving in the per-recipient preview; afterwards a history log entry per recipient.

### 2.6 Turn contacts into speakers

Contacts module > Add Contact (first name, last name, email required). A contact appears in the **Speakers** module only once assigned to a session: edit session > Participants tab > Session Participants dropdown (event contacts only) > Save. Speakers can be drag-reordered for display order and toggled public/hidden (hidden speakers are excluded from embeds). Moderators/chairpersons, additional contacts, duplicate merging, and a New/Returning badge round out the module.

### 2.7 Onboard accepted speakers via portals

Three default portals ship (People, Exhibitor, Sponsor); custom portals can be filtered by role/session type/tier. Per portal, the organizer configures:

- **Tasks** — general task with deadline, file request (e.g. "Upload headshot"), or form (e.g. bio confirmation); bulk assignment.
- **Resources** — static files and wiki pages.
- **Visibility** — Always Show Tasks toggle (off = only accepted speakers see tasks), field-level view/edit/hide for contact and session data, reminder frequency, deadline extension with a Final Deadline defaulting to +7 days.
- **Appearance** — welcome message, accent color, logo, background image.

Organizers invite users to the portal, can view the portal as a user, track per-contact task completion, and mark tasks complete on behalf of users.

**Filled state:** portal admin view lists 3 tasks with completion counts (e.g. "12/20 headshots uploaded"); the speaker-side preview shows a branded welcome screen and a task checklist with due dates.

### 2.8 Build and de-conflict the agenda

Rooms and tracks are defined under Sessions > Settings (tracks drive session colors). Sessions > Agenda offers five views — **List** (default table), **Day** (hourly timeline), **Week**, **Month**, and **Rooms** (rooms on the x-axis, zoomable). Organizers drag accepted sessions onto date/time slots and rooms; only Accepted sessions appear by default (configurable). An **AI agenda builder** can auto-propose the schedule (inferred behavior). Sessions > Agenda > **Conflicts** detects overlapping sessions and double-booked participants (same speaker in concurrent sessions); conflicted sessions carry a red dot in agenda views, and the list refreshes on page reload.

**Filled state:** Day view shows a color-coded grid across 4 rooms and 3 days; the Conflicts tab lists remaining issues; the List view shows every accepted session with date, time, room, and track.

### 2.9 Publish

Embeddable public agenda and speaker widgets are generated for external sites, alongside a hosted program site, print agendas, and document generation. Hidden speakers/sessions never appear publicly. (The embed/program-site flow is the documented publishing outlet; the exact generation UI is thinly documented — treat "produces a copyable snippet/iframe rendering accepted content" as the expectation. (inferred))

---

## 3. The participant/speaker journey, step by step

The participant persona (fixtures: **Priya Raman**, priya.speaker@sbek-test.example.com) covers speaker, submitter, and exhibitor/sponsor group member. Everything centers on a per-event portal.

### 3.1 Submit a proposal (with draft save)

The speaker opens the public form link, reads the welcome screen, and fills paginated session then speaker questions (required fields gate page advancement; co-speakers addable up to the configured limit). Entering at least a Title enables **Save as draft** (bottom right); a banner marks draft mode; returning users get a resume-draft prompt, and **Reset saved data** discards the draft. On submit, the custom success message renders and a **confirmation email carrying the portal link** is sent.

**Filled state:** form pre-filled with draft data (e.g. the fixture proposal *"Taming 40-Minute CI: Incremental Builds at Monorepo Scale"*, Talk, Platform & Infra), draft banner at top, Reset control visible.

### 3.2 First portal login

From the confirmation-email link, a new user creates a password, clicks **Continue to portal**, and — if they have access to several — picks a portal from a list. "Forgot your password?" (bottom right of the login box) sends a reset from no-reply@sessionboard.com.

**Filled state:** branded dashboard (event logo, accent color, welcome message) with widgets — My Sessions/My Submissions (with status), Invited Sessions, Confirmed Participation, Tasks, Files, Resources — a top nav (Submissions / Files / Resources), an initials avatar top right, and an event switcher top left.

### 3.3 View and edit the submission (until the deadline)

Clicking a session in My Sessions opens a sidebar; **View Submission** at the bottom opens the original form pre-populated and editable. Editing is allowed any time before the submission close date; after it passes, the form is read-only with an editing-closed message and changes require the event team.

### 3.4 Accept the session invitation

When participant acceptance is enabled, **Invited Sessions** lists sessions the speaker was invited to but hasn't answered. Accepting moves the session to **Confirmed Participation** (section names renameable, up to 100 chars). Exact accept/decline button labels are undocumented **(inferred from category norms)**.

### 3.5 Complete portal tasks

The task list shows per task: name, a red asterisk if required, description, due date with timezone, and Incomplete/Complete status. Clicking expands the full view (deadline status "Open") with **Open Link** when an external link is attached, **Mark as Complete** to finish, and **Done** to exit *without* changing status — completion is explicit and persistent, not a side effect of closing. Task types span reading terms, external links, confirmations, file requests, and headshot/bio forms.

**Filled state:** "Sign speaker agreement *" (required, due date + timezone, Incomplete), "Register for the event" (Open Link, Incomplete), "Read T&C" (Complete).

### 3.6 Upload final content, version it, and talk to the organizers

Top-nav Submissions > select session > **Files** button beneath the session name. Drag-and-drop or browse to upload; each file is designated **Presentation, Poster, or Handout**. A later upload can be marked as a **new version** of a previous file, with all versions viewable/downloadable via History / Expand All. A **Comment** thread on session content lets speakers read admin notes ("Please use the event template") and reply — direct speaker↔admin communication attached to the deliverable.

**Filled state:** Files panel listing "keynote-slides.pptx — Presentation — v2" with expandable history showing v1 and v2, plus a comment thread with an admin note and the speaker's reply.

### 3.7 Consume resources and manage the account

Portal **Files** lists organizer-shared downloads (e.g. "Speaker Guide.pdf"); **Resources** lists wiki pages that render as readable formatted content. The initials menu > **Account Settings** lets the user change the login email (green SAVE CHANGES button); profile fields (bio, headshot) respect the admin's field-level editable/view-only/hidden settings. Headshots feed the agenda, program site, and speaker embeds — hence the guidelines (well-lit, neutral background, single person).

### 3.8 Multi-portal and group access

**Switch Portals** (top-right name menu) moves between user and group portals; the top-left event dropdown lists other events tied to the same email, alphabetically. Exhibitors/sponsors are *groups*: teammates added by the admin each get their own login and see the same group info and tasks.

---

## 4. Video walkthrough catalog — the feature-surface map

learn.sessionboard.com hosts a 29-video tutorial catalog across 8 sections. Three featured videos signal the product's core loop: *create a session*, *build the submission form*, *send emails*. The catalog doubles as a map of every surface a faithful clone should have. Eval-area codes: 01 CFP, 02 Abstract Management, 03 Speaker Management, 04 Content Management, 05 AI Agenda, 06 Public Widgets, 07 Speaker CRM (optional).

| Section | Video | What it demonstrates | Eval area |
|---|---|---|---|
| Program & Agenda | Create a session | Manual session creation in the Program module (featured: "start here"); title/description/format/track fields | 02 |
| Program & Agenda | Session settings | Session-level configuration; rooms and tracks live here and feed agenda colors (details inferred) | 02 / 05 |
| Program & Agenda | Agenda building | Scheduling accepted sessions into day/time/room slots (grid/drag-drop inferred) | 05 |
| Program & Agenda | AI agenda builder | AI-assisted schedule generation from accepted sessions (behavior inferred) | 05 |
| Program & Agenda | Accept & decline sessions | Decisioning on submissions incl. bulk; visible status change feeding agenda and notifications | 02 |
| Program & Agenda | Embeds | Embeddable public widgets (agenda/speakers) for external sites (content types inferred) | 06 |
| Submissions & Forms | Session submission form | The 4-part form builder: welcome / session info (Title+Description locked) / speaker info (name+email locked) / settings (close date, reminders, 15-speaker limit) | 01 |
| Submissions & Forms | Forms | Additional forms, up to 24 per event | 01 |
| Submissions & Forms | Fields | Custom field types, labels, help text, section headers, rich text, dividers | 01 |
| Submissions & Forms | File requests | Requesting named files (slides, headshots) from speakers and tracking receipt (tracking inferred) | 04 |
| Contacts & Data | Create a contact | Manual contact creation (first/last/email) | 03 / 07 |
| Contacts & Data | Importing data | Bulk CSV import with column mapping (wizard inferred) | 07 |
| Contacts & Data | History | Per-record activity/audit timeline | 07 |
| Portals | Portals (Pro) | The branded logged-in speaker workspace (Pro-tier gated) | 03 |
| Portals | Custom portals | Additional portals filtered by role/session type | 03 |
| Portals | Portal settings & appearance | Branding: welcome message, accent color, logo, background | 03 |
| Portals | Tasks | Task creation and bulk assignment; speaker checklist; completion tracking | 03 |
| Portals | Files | General document collection in the portal | 04 |
| Portals | Session files | Per-session deliverable uploads (slide decks) with typing and versioning | 04 |
| Portals | Resources & wiki pages | Organizer-authored reference content readable in the portal | 03 |
| Evaluations | Evaluation plans | Full plan wizard: evaluators, anonymized review, filters, field visibility, custom questions, star/heart/face/number ratings, weighted rubrics totaling 100% | 02 |
| Evaluations | AI evaluations | AI-generated scoring/feedback alongside human plans (behavior inferred) | 02 |
| Communications | Creating & sending emails | In-app composer targeting speakers/submitters (featured: "reach participants without leaving Sessionboard") | 02 / 03 |
| Communications | Email templates | Reusable templates (acceptance/decline inferred); merge fields (inferred) | 02 / 03 |
| Reporting & AI | Reports | Reporting over submissions/sessions/evaluations (report types inferred) | cross-cutting (touched by 02/07 exports) |
| Reporting & AI | AI content remix | AI repurposing of session content (behavior inferred) | not covered (out of scope) |
| Event Team & Settings | Event team | Inviting team members with roles; prerequisite for evaluator assignment | 02 (reviewer access) |
| Event Team & Settings | Event details | Event-level metadata configuration | 01 (event setup) |
| Event Team & Settings | Record settings | Record-level defaults and limits | cross-cutting |

Caveats from research: 26 of 29 video cards carry no subtitle text and embedded players are not transcribable, so only the submission-form and evaluation-plans videos yielded step-level UI detail; numeric limits quoted from tutorial text (24 forms/event, 15 speakers, 15-char headers, 5-day/1-day reminders, Monday reminders) may have changed.

---

## 5. Cross-cutting expectations for clones

These properties span every eval area. A clone can pass individual feature checks and still fail the product if it misses these.

### 5.1 Multi-persona authentication and role separation

At minimum four distinguishable personas: **organizer/admin** (full event control), **evaluator/reviewer** (event-team member whose access is limited to assigned evaluation plans — an evaluator should not see admin settings), **speaker/submitter** (portal user; sees only their own submissions, tasks, and files), and the **public** (submits via the CFP form and views widgets with no login at all). Speakers reach auth *through* the flow — the confirmation email's portal link prompts first-time password creation — rather than through an upfront registration wall. Group (exhibitor/sponsor) members share a portal's data but hold individual credentials.

### 5.2 Event-scoped data

The event is the container: sessions, forms, speakers, portals, agendas, and settings all belong to one event, addressed by its URL slug. Contacts exist at the organization level (the CRM) and are *attached* to events; a user tied to multiple events switches between them from the portal header without re-login. Cloned or archived events keep data isolated.

### 5.3 The contact → speaker → public-speaker ladder

A person's visibility escalates deliberately: creating a contact does not make them a speaker; assigning them to a session does; and even then a per-speaker visibility toggle controls whether they appear in public embeds. Clones that collapse these distinctions (every contact public, every submitter a "speaker") miss the model.

### 5.4 Decisions never auto-notify

SessionBoard deliberately decouples status changes from communication: moving 20 sessions to Declined sends nothing. Notification is an explicit, previewable, templated bulk-email step with its own guardrails (100-recipient cap, per-recipient preview, history log). Clones that fire automatic emails on status change diverge from documented behavior; clones with *no* way to notify fail the loop entirely.

### 5.5 Notifications and transactional email surface

Documented automated email touchpoints: submission confirmation (carrying the portal link), form-close reminders (5 days and 1 day before), admin notification on new submission, weekly Monday evaluator reminders, portal task reminders and weekly digests, and password reset. These are the classic "works in the UI, unverifiable in the browser" surface — the eval kit routes actual-delivery checks to the manual checklist and only auto-grades the in-app halves (settings exist, send reports success, history logs the message).

### 5.6 Deadlines change behavior

Dates are enforcement points, not decoration: a passed form close date blocks new submissions *and* locks speakers' editing of existing ones; task due dates display with timezones; portal deadline extensions have a Final Deadline (+7 days default). A clone whose deadlines are display-only fails these checks.

### 5.7 The public/private boundary

Evaluation results are admin-only; anonymized review actually hides speaker identity from evaluators; hidden speakers/sessions never leak into embeds; portal users see only fields the admin marked visible (view-only vs editable vs hidden). Judges look for leakage in both directions.

### 5.8 Filled-state fidelity

Because grading is implementation-agnostic, the rubrics describe what populated screens must *communicate*, not how they look: a sessions table that visibly mixes statuses, an agenda grid whose blocks are color-coded by track, a portal checklist with due dates and completion states, a version history that really lists v1 and v2. All scenario inputs come from `fixtures/sample-data.json` (the fictional **DevFlow Conf 2027**), so the judge knows exactly which titles, names, and dates to look for.

---

## Sources

Research JSON: `docs/research/learn-organizer.json`, `docs/research/learn-videos.json`, `docs/research/learn-participant.json`. Primary URLs fetched by the research pass:

- https://learn.sessionboard.com/get-started/overview
- https://learn.sessionboard.com/get-started/onboarding-checklist.html
- https://learn.sessionboard.com/events/event-details
- https://learn.sessionboard.com/sessions/submission-forms
- https://learn.sessionboard.com/sessions/accept-decline
- https://learn.sessionboard.com/sessions/agenda
- https://learn.sessionboard.com/evaluations/evaluation-plans
- https://learn.sessionboard.com/communications/create-send-emails
- https://learn.sessionboard.com/speakers/create-assign-speakers
- https://learn.sessionboard.com/portals/portals-101
- https://learn.sessionboard.com/videos/overview
- https://learn.sessionboard.com/videos/video-session-submission-form
- https://learn.sessionboard.com/videos/video-evaluation-plans
- https://learn.sessionboard.com/videos/portals-pro
- https://learn.sessionboard.com/participants/overview (plus the 13 participant-guide articles: access-portal, edit-submission, save-a-submission-as-a-draft, add-or-edit-speaker-information, updated-portal(s), upload-files, view-and-download-files, headshot dos-and-donts, change-portal-username-or-email, access-additional-event-portals, exhibitor-portal)
- https://learn.sessionboard.com/en/knowledge-base/portal-users
- https://learn.sessionboard.com/en/knowledge-base/6284020-configure-customize-portals
- https://learn.sessionboard.com/sitemap-0.xml (full ~200-article KB enumeration)
