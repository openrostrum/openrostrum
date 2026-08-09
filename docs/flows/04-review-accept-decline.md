# Flow 04 — Submission review & accept/decline (admin)

Sources: Sessionboard Help Center (learn.sessionboard.com), fetched 2026-08-08. Primary pages:

- https://learn.sessionboard.com/sessions/accept-decline (statuses, review, status updates)
- https://learn.sessionboard.com/videos/decline-sessions (video transcript — queue semantics, bulk edit)
- https://learn.sessionboard.com/speakers/speaker-acceptance (participant-level acceptance, withdrawal)
- https://learn.sessionboard.com/sessions/draft-submissions
- https://learn.sessionboard.com/sessions/create-a-session
- https://learn.sessionboard.com/sessions/session-settings and https://learn.sessionboard.com/sessions/program-settings (both titled "Program settings"; the former is the older/longer revision)
- https://learn.sessionboard.com/sessions/enable-upload-download-content
- https://learn.sessionboard.com/contacts/create-assign-a-session-submitter
- https://learn.sessionboard.com/speakers/create-assign-speakers
- https://learn.sessionboard.com/contacts/add-a-moderator-chairperson
- https://learn.sessionboard.com/faq/clone-a-session
- https://learn.sessionboard.com/faq/how-to-filter-contacts-by-session-status

Supporting pages (context on emails, portals, forms): /communications/create-send-emails, /communications/automated-emails, /faq/how-to-create-a-portal-for-accepted-speakers, /portals/inviting-users-to-the-event-portal, /faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal, /concepts/participant-roles, /applications/building-your-submission-form, /sessions/submission-forms, /participants/access-portal.

---

## 1. Purpose & actors

**Purpose.** After the CFP closes (or as submissions arrive), the event team reviews each submission — alongside evaluator feedback from Evaluation Plans — and moves it through a status pipeline that decides what lands on the agenda and what the speaker eventually learns. The pipeline is deliberately decoupled from notification: **changing a status never emails anyone**; the two "queue" statuses exist precisely so admins can stage decisions internally, send accept/decline emails on their own schedule, and only then flip the visible status. (accept-decline; videos/decline-sessions)

**Actors.**

| Actor | Role in this flow |
|---|---|
| Event admin | Reviews submissions, sets session statuses (single or bulk), creates/sends accept & decline emails, manages participants, grants portal access. (accept-decline) |
| Evaluators / AI Personas | Provide scores/feedback consumed during review (Evaluation Plans, AI Personas in Program Settings). Not decision-makers. (accept-decline; program-settings) |
| Session submitter | Contact who filled the form (page 2 of the form); may not be a speaker. Sees status in their portal. (concepts/participant-roles; create-assign-a-session-submitter) |
| Speaker / Chairperson / Moderator | Session participants. Speakers come from the form (page 4) or admin assignment; chairperson & moderator are admin-assigned only. Each can additionally confirm/decline their own participation (participant acceptance). (concepts/participant-roles; speaker-acceptance) |

---

## 2. Flows

### 2a. Session status lifecycle — the exact machine

**The five built-in session statuses** (accept-decline; videos/decline-sessions transcript):

| Status | Meaning | What the speaker/submitter sees in their portal |
|---|---|---|
| ⏳ **Pending** | Default for newly submitted sessions; awaiting review/decision. | "Pending" |
| 📥 **Accepted Queue** ("Accept Queue") | Recommended or held for acceptance, **not yet finalized**. | **"Pending"** — a pending icon, without the specific status name |
| ✅ **Accepted** | Officially approved and included in the event; typically shown on the agenda. | "Accepted" |
| 📥 **Decline Queue** | Being considered for rejection, **not yet declined**. | **"Pending"** — a pending icon, without the specific status name |
| ❌ **Declined** | Officially rejected and excluded from the event. | "Declined" |

**Queue semantics — the load-bearing detail.** The queues are *staging* states, not triggers. From the decline-sessions video transcript: "sessions in accept queue or declined queue will display a pending icon without showing the specific status name. These queue statuses are typically used by teams that prefer to notify speakers of their session outcomes **via email before the status becomes visible in the portal**." Nothing is automated off a queue: no email is sent on entering a queue, and there is no "flush the queue" send action documented — the admin later sends accept/decline emails (Flow 2b) and then manually moves sessions from queue → final status. (videos/decline-sessions; accept-decline)

**No transition emails, ever.** "Changing a session status does not automatically email the submitter or speakers. Create and send accept/decline emails to notify participants." (accept-decline, Caution box; repeated in the video transcript.)

**Transition side-effects that ARE automatic:**

- **Accepted → Agenda**: "Once a session is set to Accepted, it becomes visible in the Agenda for your event team." (accept-decline). Program Settings → Agenda has a **Program statuses** setting that can additionally surface non-Accepted statuses (e.g. Accept Queue, Pending) in agenda views, so teams can tentatively schedule queued sessions before finalizing. (program-settings; session-settings)
- **Attendee-facing agenda/embeds only ever show Accepted sessions**, regardless of the above admin-side setting. (faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal)
- **Integration sync**: sessions with an Accepted(-category) status sync to native integration partners; and only participants with an Accepted participant status *on an accepted session* sync. (session-settings, Statuses; speaker-acceptance FAQ)
- **Portal visibility of the record**: all sessions a contact is linked to — accepted, pending, declined — remain visible on their profile and in their portal. The only ways to hide a non-accepted session are removing the speaker from it or deleting it, both discouraged because they destroy the historical record. (faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal)

**How the admin changes a status** (accept-decline; videos/decline-sessions):

1. **Single**: Sessions module → click the session's current status in the Status column → pick the new status from the dropdown.
2. **Bulk**: check the boxes next to sessions → click **Edit** at the top of the page → in the pop-up, pick the field to update (**Status**) → choose the status to assign → **Update**.

**Custom statuses.** Created in Program Settings → Statuses (Add Status). Each custom status has: **Name** (visible to portal users), **Category** (mandatory — every status maps to one of the built-in categories and *behaves* as that category does, e.g. an Accepted-category custom status syncs to integrations), **Color**, **Display order** (position in the status dropdown), and **Show custom status name** (when enabled the custom name is shown to portal users — otherwise the portal presumably shows the category's default label, mirroring the queue behavior). (session-settings, Statuses; program-settings)

**Adjacent states that are not among the five statuses:**

- **Draft** — a *pre-submission* state, not a session status: the submitter saved the form without submitting. Drafts live behind a **Drafts** filter above the search bar in Sessions → Submissions (showing title, submitter, and source form) and via each form's ⋯ → View Draft Submissions; the Dashboard shows totals of submissions vs drafts per form. Admins can open a draft with the pencil icon to see what was answered so far. Reminder emails (customizable via Settings → Email Templates) go to draft holders 5 days and 1 day before the form's close date, when enabled in Form Settings. (draft-submissions)
- **Withdrawn** — produced by the *participant acceptance* feature when a portal user withdraws a submission. Withdrawn submissions appear in Sessions → Submissions; opening one shows **who withdrew it and why**, and offers three admin resolutions at the bottom of the page: delete the session, set it to **Declined**, or **undo the withdrawal**. (speaker-acceptance)
- **Cloning resets status**: duplicating sessions (checkbox → More → Duplicate Sessions → confirm) copies all session information **except** status (reset to **Pending**) and uploaded files (not copied). (faq/clone-a-session)

### 2b. What the speaker sees / receives at each transition

**Portal status display** is the only automatic speaker-facing signal, per the table in 2a: Accepted shows "Accepted", Declined shows "Declined", and Pending/Accept Queue/Decline Queue all show "Pending". (accept-decline; videos/decline-sessions)

**Emails are 100% manual.** The automated/system email catalog contains *no* accept or decline email — the only submission-lifecycle automations are: submission confirmation (to submitter, body editable in form settings, cannot be disabled), draft-close reminders (5 days & 1 day before close), new/revised submission alerts (to admins), "Added to a submission" (to a speaker when they're added to a submission), and invoice receipts for paid submissions. (communications/automated-emails)

To notify outcomes the admin uses **Create & Send Emails**: from the Sessions module, check the target sessions → Send Emails; choose recipients (from the Sessions module the audience can be Chairperson, Moderators, Participants, or Everyone), reply-to, from-address, CC/BCC (≤5 each), compose or apply a **Template**, preview per-recipient, Send Now. Hard limit: **100 emails per send** — larger cohorts go in batches. Default sender: no-reply@notify.sessionboard.com unless a custom domain add-on is configured. (communications/create-send-emails; concepts/participant-roles) The stock Email Templates list includes "Accept Sessions" and "Decline Sessions" templates (seen in the product walkthrough — see `00-demo-walkthrough.md` A2/f_031; the fetched KB pages reference templates generically via Settings → Email Templates in draft-submissions).

**Portal access is NOT granted by acceptance.** Portal access is independent of status: submitters get the portal link in their submission confirmation email; otherwise admins share the event-wide portal login link (`https://app.sessionboard.com/portal-login/[event-slug]…` — every portal shares one link) by email (with a Portal Login Link merge tag) or via Contacts → select → More → **Manage Portal Access** → Give Portal Access → send invite email or copy the invitation link. (portals/inviting-users-to-the-event-portal; participants/access-portal)

**Acceptance's real portal side-effect is task visibility.** There is no built-in "accepted speakers only" portal filter. The recommended pattern: build a Contacts portal filtered on role "Speaker is checked" (which includes speakers on pending/declined sessions too) and disable the portal configuration setting **"Always Show Tasks"** — then tasks (forms, file requests, etc.) become visible **only to speakers assigned to accepted sessions**. So flipping a session to Accepted is what lights up the speaker's portal to-do list. Alternative: a manually-maintained custom checkbox contact field ("Accepted Speaker") used as the portal filter — explicitly warned as not auto-updating with session status. (faq/how-to-create-a-portal-for-accepted-speakers)

**Participant-level acceptance (second, per-person status machine).** Optional feature (Settings → Record Settings → Participant Acceptance; support-enabled if missing) that lets each participant confirm or decline **each role they hold** on a submission from the portal instead of by email (someone who is both speaker and moderator confirms each separately). (speaker-acceptance)

- Participant statuses are fixed — 🟨 Pending, 🟩 Accept(ed), 🟧 Decline(d) — no custom participant statuses; only the *pending* wording can be rebranded via **Portal Status Verbiage** (two 60-char labels: "Invited (awaiting confirmation)" → default "Confirmation Needed", and "Submitted (in review)").
- **Participants can only confirm for Accepted sessions**: a Confirm button appears per accepted session in the portal's My Sessions widget → dialog to accept/decline → Save. So the session must be Accepted *first*; participant confirmation is downstream of the session decision.
- **Allow Submission Withdrawal** toggle adds a Withdraw button to the acceptance task (see Withdrawn in 2a). Admins can restrict *which* participants see acceptance invitations (e.g. confirm one track/role at a time), and the portal groups a participant's sessions into configurable sections when acceptance is on.
- Admin override: session pencil → Participants page → per-person Status dropdown (Accepted/Pending/Declined) → Save Changes.
- A sub-toggle scopes acceptance to subsessions/stand-alone submissions only (not parent submissions with children).
- Sync consequence: only Accepted participants on accepted sessions sync to native integrations.

### 2c. Manual session creation vs form-sourced submissions (and abstracts vs sessions)

**Two entry paths for session records** (create-a-session):

1. **Form-sourced** — the session submission form creates the session record, the submitter contact (form page 2) and speaker contacts (form page 4 / Participant Information). Source form is tracked per submission (visible e.g. in the Drafts list "source" column). (create-a-session; concepts/participant-roles; draft-submissions)
2. **Manual (admin)** — Sessions module → Submissions → **Add Session** (top right) → pop-up with **Details** (session fields) and **Participants** (speakers, moderators, sponsors, exhibitors, chairpersons). **Title and Status are the only required fields.** Participants must already exist in Contacts to be searchable. **Custom fields cannot be filled in the creation pop-up**: create the session first, then open its profile (pencil icon) and scroll to the bottom to populate custom fields — or add the field as a dashboard column and edit inline. (create-a-session)

**Abstracts vs Sessions (Sessions 2.0).** When creating a form you choose the **submission type**: *Abstract* or *Session*. They are distinct submission types platform-wide: abstract submissions land under Program → **Abstracts**, session submissions under **Sessions**, with a combined **All Submissions** tab. Guidance: choose Abstract for calls-for-papers/posters — "content that goes through a review process before being accepted as a finalized session"; choose Session when proposals become sessions directly. The agenda can be set to show session-based items, abstract-based items, or both (**Agenda content** setting). Up to 20 forms per event enables parallel calls (e.g. one abstract CFP + one invited-session form). (applications/building-your-submission-form; program-settings)

### 2d. Assigning participants to a session

All assignment happens on the session's **Participants** tab (pencil icon next to the session in the Sessions module), always ending with **Save Changes**. Contacts must exist first (Contacts → Add Contact → Add new contact; first name, last name, email required; returning contacts findable by search). (speakers/create-assign-speakers; contacts/add-a-moderator-chairperson)

| Role | How assigned | Notes |
|---|---|---|
| **Speaker** | Participants tab → Session Participants box → search name | Only existing event contacts appear in the dropdown. A contact only appears in the **Speakers module** once assigned to a session. Drag-and-drop to reorder display order. Per-speaker **public/hidden toggle**: public by default (`is_public = TRUE` in the Open API Get/Search Sessions; hidden speakers excluded from embeds). (speakers/create-assign-speakers) |
| **Session submitter** | Participants tab → Session Participants box: remove the existing submitter, search and attach the new contact | Submitter = who filled the form; may not speak (e.g. an assistant). Admins reassign for existing sessions or set one on manually created sessions. (contacts/create-assign-a-session-submitter) |
| **Chairperson** | Participants tab → Chairperson field → select contact | Admin-assigned only (never created by a form, in classic Sessions). Lives in Contacts module, not Speakers module. (contacts/add-a-moderator-chairperson; concepts/participant-roles) |
| **Moderator** | Participants tab → Moderator field → select contact | Same as chairperson. Both are emailable from the Sessions module (Send → Send Emails → Chairperson / Moderators / Participants / Everyone) or Contacts module, and can be assigned tasks. (concepts/participant-roles) |

**Custom roles.** Program Settings → **Roles** maps display roles to one of three categories (Speaker / Chairperson / Moderator); category determines representation in integrations and embeds; a **Manage** toggle surfaces the role under Event → Contacts; ⋯ renames, Add Role creates a custom role (category + icon + manage flag). In Sessions 2.0 forms, "Speaker Information" became **Participant Information** with fully custom role labels (Author, Co-author, Panelist…) mapped to the core categories, per-role min/max counts, an overall total min/max, and **conditional participant limits** (WHEN field-match rules THEN per-role min/max overrides; first matching rule wins). (program-settings; applications/building-your-submission-form)

Adding an existing contact to a submission can trigger the automated "Added to a submission" email / portal-review notification, controlled by the form's **Unique Contact Settings** (allow updating existing contacts' info; notify existing contacts they were added). (communications/automated-emails; applications/building-your-submission-form)

### 2e. Session settings that matter for review (taxonomy → forms → agenda)

Defined in **Program Settings** (Program module). These are the pick-lists that categorize submissions and later drive agenda filtering, card colors, and default durations. (program-settings; session-settings)

| Setting | Type | Purpose / flow |
|---|---|---|
| **Rooms** | Single-select | Physical/virtual locations; per-room display order (agenda embed ordering, ties → alphabetical) and capacity (≤100,000; visible in agenda view, not embeds). Room visibility controls which rooms show when scheduling. |
| **Tracks** | Single-select | Broad thematic categories; attendee agenda filtering; track color paints admin agenda cards and embeds. |
| **Tags** | **Multi-select** | Granular keywords for search, presentation flags ("Sponsored Session", "Live-Streamed"), and reporting. |
| **Levels** | Single-select | Audience expertise ("Beginner"…). |
| **Formats** | Single-select | Session style ("Panel", "Workshop", "Keynote"). Also feeds **Program format & default duration** — preset durations per format when scheduling. |
| **Languages** | Single-select | Session language. |
| **Statuses** | — | Custom session statuses (see 2a). |
| **Roles** | — | Role display names → categories (see 2d). |
| **Files** | — | Speaker upload support, ≤1.95 GB/file, versions + comments (see below). |
| **Agenda** | — | Day start/end, interval, agenda content (sessions/abstracts/both), program statuses shown, room visibility. |
| **Personas** | — | AI virtual evaluators (name, role, bio, feedback style Positive/Neutral/Constructive/Critical, 3 likes/3 dislikes) assignable to evaluate sessions. |

**How they flow into forms:** these exist as event-level fields; in the form builder the admin adds them to the Session Information step via **Add Field → search existing fields** (avoiding recreating fields already defined). Standard vs custom fields are shown on the Select Fields page; fields can be event-level or global (reusable across events); editing a field affects every form using it. Question rules (conditional logic) apply to Checkbox, Dropdown, and Number fields. (applications/building-your-submission-form; sessions/submission-forms)

**Files (content collection after acceptance).** Sessions → Settings → Files → toggle **Enable File Upload** ON: speakers *with portal access* can upload files (≤1.95 GB) to their sessions; admins upload any time via session pencil → Files tab. A **Files** column in the module view shows per-session file counts (excluding versions). Files are viewable in Library → Files or per-session; per-file comment threads between speakers and admins exist but **generate no notifications** — the KB tells admins to email speakers that comments exist. Bulk export: select sessions → Download Files → choose "Group files by" → Generate Download → email "[Sessionboard] Your file is ready" (latest versions only; older versions must be downloaded from the session content tab). Share-by-link avoids downloads. Suggested pattern: a portal task "Upload Session Presentation" — which, combined with "Always Show Tasks" off, only appears once the session is Accepted (see 2b). (enable-upload-download-content; program-settings; faq/how-to-create-a-portal-for-accepted-speakers)

---

## 3. Inventory

**Session/submission record** (fields observed across the sources):

- Title (required), Status (required) — the only two mandatory fields on manual creation. (create-a-session)
- Description (no longer mandatory in 2.0 forms; Title is the only locked form field). (applications/building-your-submission-form)
- Taxonomy fields: Format, Track, Tags, Level, Language, Room (from Program Settings). (program-settings)
- Source (which form the submission came from). (draft-submissions)
- Participants: session submitter, speakers (ordered, each public/hidden), chairperson, moderator, sponsors/exhibitors; per-participant acceptance status (Pending/Accepted/Declined) per role. (create-a-session; speakers/create-assign-speakers; speaker-acceptance)
- Custom fields (event-level or global), editable on the session profile (bottom) or inline in dashboard views. (create-a-session; sessions/submission-forms)
- Files tab: uploaded files with versions and comment threads; Files count column. (enable-upload-download-content)
- Sub-sessions: parent/child submission linkage. (applications/building-your-submission-form; speaker-acceptance)
- Withdrawal metadata: who withdrew and why. (speaker-acceptance)
- Note: the Sessions module holds *session* fields only; speaker fields (company, job title, bio) are viewed via dashboard views in Contacts → Speakers. (accept-decline)

**Bulk actions (Sessions module):**

- Bulk status change: checkboxes → Edit → pick field (Status) → pick value → Update. (videos/decline-sessions)
- Send Emails to selection (≤100/send; audience Chairperson/Moderators/Participants/Everyone). (communications/create-send-emails; concepts/participant-roles)
- Download Files for selected sessions (zip, group-by options). (enable-upload-download-content)
- More → Duplicate Sessions (clone; status resets to Pending, files excluded). (faq/clone-a-session)
- Contacts module analog: select → More → Manage Portal Access (bulk portal invites). (portals/inviting-users-to-the-event-portal)

**Filters & views:**

- Sessions → Submissions: **Drafts** filter above the search bar; column picker (Columns) to add form questions, Status, Files, Speakers fields; dashboard views per module. (draft-submissions; accept-decline; enable-upload-download-content)
- Program (2.0): Abstracts / Sessions / All Submissions tabs. (applications/building-your-submission-form)
- Contacts by session status — two methods: (1) pre-set one-click filters atop Speakers/Chairpersons/Moderators views: **Session – Accepted / Session – Pending / Session – Declined**; (2) manual: Columns → enable `[Session] Status - Accepted` (checkbox-style fields) → Filter → Add Filter → condition "Is checked"/"Is not checked" → Apply; views can be saved. (faq/how-to-filter-contacts-by-session-status)
- Participant acceptance status columns: add the Sessions field to Contacts views or the Speakers field to Sessions views (🟨/🟩/🟧 indicators). (speaker-acceptance)

---

## 4. Screenshots

Downloaded into `img/04-review/` from learn.sessionboard.com (`/images/kb/…`), verified as PNG. Note: the rewritten core pages (accept-decline, speaker-acceptance, create-a-session, create-assign-speakers, clone-a-session, program-settings) currently ship **no screenshots**; images below come from the illustrated pages. The decline walkthrough is a Guidde video embed (`https://embed.app.guidde.com/playbooks/vkKfsrRbD6Zsvb41hxSdwS`) on videos/decline-sessions.

| File | Caption | Source page |
|---|---|---|
| ![Add Status](img/04-review/custom-status-add-button.png) | Program Settings → Statuses: status list with Add Status button (custom statuses alongside the five built-ins). | https://learn.sessionboard.com/sessions/session-settings |
| ![Create status pop-up](img/04-review/custom-status-create-popup.png) | Create-status pop-up: Name, Category (mandatory), Color, Display Order, Show custom status name. | https://learn.sessionboard.com/sessions/session-settings |
| ![Status dropdown](img/04-review/status-dropdown-on-session.png) | Assigning a (custom) status to a session via the Status field dropdown. | https://learn.sessionboard.com/sessions/session-settings |
| ![Agenda settings](img/04-review/agenda-settings-session-statuses.png) | Agenda Settings: day start/end, Session Statuses included in agenda views (e.g. Accepted + Accept Queue), format default durations, room visibility. | https://learn.sessionboard.com/sessions/session-settings |
| ![Pre-set contact filters](img/04-review/contacts-preset-status-filters.png) | Speakers view pre-set filters: Session – Accepted / Pending / Declined. | https://learn.sessionboard.com/faq/how-to-filter-contacts-by-session-status |
| ![Manual status filter](img/04-review/contacts-manual-status-filter.png) | Manual filter on `[Session] Status - …` fields with Is checked condition. | https://learn.sessionboard.com/faq/how-to-filter-contacts-by-session-status |
| ![Drafts tab](img/04-review/drafts-tab-submissions-module.png) | Sessions → Submissions with the Drafts filter: title, submitter, source form. | https://learn.sessionboard.com/sessions/draft-submissions |
| ![Reminder email setting](img/04-review/draft-reminder-email-setting.png) | Form Settings: Send Reminder Email (enabled once a Close Date exists; fires 5 days & 1 day before close). | https://learn.sessionboard.com/sessions/draft-submissions |
| ![Participants tab](img/04-review/session-participants-tab-submitter.png) | Session → Participants tab, Session Participants box (submitter/speaker attach & remove). | https://learn.sessionboard.com/contacts/create-assign-a-session-submitter |
| ![Chairperson & moderator](img/04-review/chairperson-moderator-fields.png) | Chairperson & Moderator single-contact fields on the Participants tab. | https://learn.sessionboard.com/contacts/add-a-moderator-chairperson |

---

## 5. Gaps

- **No queue → send → finalize automation is documented.** The KB implies the loop is fully manual (queue as bookmark; email via Create & Send Emails; then bulk-set final status). Whether the product offers any "notify & finalize queue" shortcut is unverified — nothing in the fetched pages suggests one exists.
- **Accept/Decline email template content**: "Accept Sessions" / "Decline Sessions" stock templates are visible in the product (demo video, flow 00) but no KB page fetched documents their merge tags or default copy. Settings → Email Templates is referenced only generically (draft-submissions).
- **Naming drift**: the KB table says "Accepted queue"; the video transcript says "Accept Queue"; agenda settings examples say "Accept Queue". Treat as the same status.
- **Custom status category list is not enumerated** — pages only say every status "maps to a category and behaves accordingly" with Accepted as the example; presumably the five built-ins are the categories, unconfirmed.
- **Withdrawn's exact representation** (a sixth status vs a flag on the submission) is not specified; it "shows in Sessions → Submissions" with who/why plus three resolution actions, but no status-column value is documented.
- **Bulk-edit scope**: the video shows bulk Status edit via Edit → field picker; a /settings/bulk-edit-fields page exists (nav link) but was not fetched — full list of bulk-editable fields unverified.
- **100-email send cap** means bulk acceptance notifications for large CFPs must be batched manually; no documented mass-mail/queue integration.
- **What "Show custom status name = off" displays** in the portal is not stated explicitly (inferred: the category's default label, matching queue → "Pending" behavior).
- **No screenshots** exist on the current accept-decline / speaker-acceptance / create-a-session / clone-a-session pages; the decline video is an embedded Guidde playbook not extractable via plain GET.
- **Evaluation → decision linkage**: how evaluator scores surface in the review UI (columns? summary?) lives in the Evaluations articles (/evaluations/evaluation-plans, /evaluations/evaluation-summary), out of scope here.
