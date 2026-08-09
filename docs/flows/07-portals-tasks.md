# Flow 07 — Portals administration: portals, tasks, forms, file requests, resources

Sources: Sessionboard public KB (learn.sessionboard.com), fetched 2026-08-08. Every claim cites its page. Screenshots in `img/07-portals/` were downloaded from the KB pages and are captioned with their source.

Key source pages:
- Portals 101: https://learn.sessionboard.com/portals/portals-101
- Create custom portals: https://learn.sessionboard.com/portals/creating-custom-portals
- Inviting users: https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal
- Create & assign tasks: https://learn.sessionboard.com/portals/assign-tasks
- Assign tasks to records (manual/bulk): https://learn.sessionboard.com/portals/task-assignment
- Create & assign portal forms: https://learn.sessionboard.com/portals/create-assign-forms
- Collect documents / file requests: https://learn.sessionboard.com/portals/collect-documents
- Upload & share portal files: https://learn.sessionboard.com/portals/share-files
- Wiki pages / resources: https://learn.sessionboard.com/portals/assign-pages
- Portal settings (global): https://learn.sessionboard.com/settings/portal-settings

---

## 1. Purpose & actors

**Purpose.** Portals give event contacts (speakers, moderators, chairpersons, session submitters) and groups (sponsors, exhibitors) "a centralized hub to access event information and complete tasks" (https://learn.sessionboard.com/portals/portals-101). Admins push work OUT to participants (tasks, forms, file requests) and share content (files, wiki pages) without email ping-pong; participants complete everything self-serve in one branded page.

**Actors.**
| Actor | What they do here |
|---|---|
| Event admin (back-end user) | Creates portals + filters, creates tasks/forms/file requests/files/pages, assigns them to portals, sets due dates, reviews & approves file submissions, tracks completion in module dashboards, marks tasks done on behalf of users, previews portals, grants/revokes portal access |
| Portal user — contact | Speaker / Moderator / Chairperson / Session Submitter / Sponsor-individual / Exhibitor-individual; logs in with their **Portal Username**, sees ONE portal (the one they were matched to), completes tasks, submits forms & files, edits profile (https://learn.sessionboard.com/portals/creating-custom-portals, https://learn.sessionboard.com/faq/why-can-t-a-portal-user-see-any-tasks-assigned-to-them) |
| Portal user — group | A Sponsor or Exhibitor organization acting collectively in a Groups portal (only when sponsor/exhibitor modules are enabled) (https://learn.sessionboard.com/portals/creating-custom-portals) |

---

## 2. Flows

### 2a. The portal model — what a portal IS and who gets in

A **portal is a per-audience-segment configuration set**, not a per-user page: one login URL for the whole event, and each contact/group is resolved to exactly one portal whose content (tasks, forms, file requests, files, pages, appearance, settings) they see.

1. **Defaults exist out of the box.** Every event includes three default portals: **Default People**, **Default Exhibitor**, **Default Sponsor** (https://learn.sessionboard.com/portals/portals-101).
2. **Custom portals are filter-defined.** Admin clicks **+ Create Portal** in the Portals module, names it (internal name), and picks the portal type: **Contacts Portal** (Speakers, Chairperson, Moderator, Sponsor Individual Contacts, Exhibitor Individual Contacts, Session Submitters) or **Groups Portal** (Sponsor and Exhibitor Groups — only if those modules are enabled). Then adds filters; the dashboard live-previews who matches (https://learn.sessionboard.com/portals/creating-custom-portals).
   - Contact-portal filters: contact fields (name, email, job title, custom contact fields) or a **limited set of session fields (format, track, tag, level, languages)**. You canNOT filter by the submission form type or other session fields.
   - Group-portal filters: group fields (name, level, custom group fields).
   - Sponsors/Exhibitors automatically also get a contacts portal, so admins can assign tasks to individuals vs. the whole organization.

   ![Create Portal — pick type + filters](img/07-portals/create-portal-type-filters.png)
   *Create-portal modal: portal type (Contacts vs Groups) + filter builder. Source: https://learn.sessionboard.com/portals/creating-custom-portals (image: https://learn.sessionboard.com/images/kb/7aae0960-image-png-Feb-25-2026-02-38-19-7881-PM.png)*

   ![Filter example](img/07-portals/portal-filter-example.png)
   *Example: session filter "FORMAT contains BREAKOUT SESSION" groups all contacts on breakout sessions. Source: https://learn.sessionboard.com/portals/creating-custom-portals (image: /images/kb/34001a14-image-png-Feb-25-2026-02-34-37-1927-PM.png)*

3. **One portal per contact/group, first-match-wins.** "Contacts/Groups can only be assigned to one portal at a time. If they match the criteria of multiple portals, they will be assigned the first portal they match with" — portal ORDER is therefore load-bearing; admins drag-reorder portals via a pencil icon. Anyone matching no custom portal falls into the Default Portal, so it must be configured too (https://learn.sessionboard.com/portals/creating-custom-portals).

   ![Reorder portals](img/07-portals/reorder-portals.png)
   *Drag-and-drop portal ordering decides which portal a multi-match contact lands in. Source: https://learn.sessionboard.com/portals/creating-custom-portals (image: /images/kb/071f02da-image-png-Feb-25-2026-02-42-10-5573-PM.png)*

   ![Assigned Portal field](img/07-portals/assigned-portal-field.png)
   *TIP from the KB: add the "Assigned Portal" field to a dashboard view to see each contact's resolved portal. Source: https://learn.sessionboard.com/portals/creating-custom-portals (image: /images/kb/fce896d1-image-png-Feb-25-2026-02-42-38-8023-PM.png)*

   ![Portals module overview](img/07-portals/portals-module-overview.png)
   *Portals module: list of portals with ellipsis actions (Edit Tasks, Copy Link, Duplicate, Delete). Portals can also be duplicated and deleted from here. Source: https://learn.sessionboard.com/portals/creating-custom-portals (image: /images/kb/acdcad06-Screenshot-2025-10-09-at-2.46.26-PM.png)*

4. **Access is a separate switch from portal assignment.** Matching a portal's filters decides WHICH portal a contact sees; whether they can log in at all is "portal access":
   - **Automatic option:** Settings → Record Settings → **"Automatically provision contact portal access"** grants access as contacts are added/imported (https://learn.sessionboard.com/faq/how-to-grant-portal-access-to-an-event-contact).
   - **Manual:** module → select contact(s) → More → **Manage Portal Access** → **Give Portal Access** (https://learn.sessionboard.com/faq/how-to-grant-portal-access-to-an-event-contact, https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal).
   - Cross-ref: submitters coming through a public submission form land in the portal right after submitting ("Continue to portal" on the success page — see Flow 00 Part C), consistent with "Session Submitters" being a contact-portal audience.
5. **One login URL for every portal.** "Every portal has the same link": `https://app.sessionboard.com/portal-login/[event-slug]`, copyable via any portal's ellipsis → Copy Link (https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal). Two invite paths:
   - Send an email (from Contacts/Speakers/Sponsors/Exhibitors/Sessions modules) pasting the link or using the **Portal Login Link merge tag**.
   - Manage Portal Access popup → send the invite as an email OR copy a personal invitation link. Invite email subject: "You've been invited to the <Event Name> portal".

   ![Give Portal Access](img/07-portals/manage-portal-access.png)
   *Manage Portal Access popup — Give Portal Access per contact. Source: https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal (image: /images/kb/b521bd76-image-png-Feb-25-2026-03-04-35-5042-PM.png)*

   ![Portal invite email](img/07-portals/portal-invite-email.png)
   *The invite email a contact receives. Source: https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal (image: /images/kb/95b3fc75-Screenshot-2023-03-17-at-11_54_41-AM-1.png)*

6. **Login identity is the Portal Username field, NOT the communication email.** They are independent fields on the contact profile; changing one does not change the other. #1 support issue for "user sees no tasks": logging in with the wrong address. Fix #2: reset portal access (Manage Portal Access → remove access → Give Portal Access again) (https://learn.sessionboard.com/faq/why-can-t-a-portal-user-see-any-tasks-assigned-to-them).
7. **"Accepted speakers only" is NOT a native filter.** Two documented recipes (https://learn.sessionboard.com/faq/how-to-create-a-portal-for-accepted-speakers):
   - **Option 1 (recommended dynamic):** contacts portal filtered on role "Speaker is checked" (includes pending/declined/accepted alike), then on portal Configuration (page 3) disable **Always Show Tasks** → tasks/forms/file requests become visible only to speakers with **accepted** sessions. All speakers can still log in; only accepted ones see work.
   - **Option 2 (manual gate):** create a custom checkbox contact field (e.g. "Accepted Speaker"), tick it per accepted speaker (bulk edit), filter the portal on it. Caveat: it does NOT auto-update with session status.

   ![Always Show Tasks toggle](img/07-portals/always-show-tasks-toggle.png)
   *Portal Configuration — disabling "Always Show Tasks" hides tasks from non-accepted speakers. Source: https://learn.sessionboard.com/faq/how-to-create-a-portal-for-accepted-speakers (image: /images/kb/4c1c21e5-image-png-Feb-24-2026-10-38-07-1221-PM.png)*

8. **Portal session sections (when participant acceptance is ON).** A participant's sessions split into three renamable sections — **Invited Sessions** (invited, unanswered), **My Submissions** (their submissions), **Confirmed Participation** (everything accepted). Per-portal toggles: show/hide the separate Confirmed section (collapse to two), show/hide subsessions inside My Submissions (Invited Sessions always shows the specific subsession). Titles renamable up to 100 chars; auto-translated when multi-language is on. Controls live in Portals → [portal] → Configuration → Participation sections and only appear when acceptance is enabled and the portal shows sessions (https://learn.sessionboard.com/portals/portals-101).
9. **Four-step launch checklist** (https://learn.sessionboard.com/portals/portals-101): (1) create portals & filters; (2) create & assign tasks + resources; (3) configure settings — Always Show Tasks, Extend Task Deadlines (Final Deadline = days after the due date before tasks lock; default 7), Manage Profile, Manage Related Sessions & Participants, Send Weekly Digest Email; (4) customize appearance — welcome message, accent color, logo, background per portal, plus **Show/Hide Fields** controlling which contact/session fields users can view or edit (lock = view-only, hide = gone).

### 2b. Tasks — create → assign → complete → track

1. **Create** (Portals → Tasks → Add Task) with fields (https://learn.sessionboard.com/portals/assign-tasks):
   - **Task Name** — what users see.
   - **Task Type** — target entity: **Contacts** (speakers, moderators, chairpersons, session submitters, sponsor/exhibitor contacts), **Groups** (sponsor & exhibitor groups), **Sessions**.
   - **Description** — "Enter Description" (same text for everyone) or **Use Field** (a contact/group/session field's value renders as a per-user description) (https://learn.sessionboard.com/faq/task-use-field).
   - **Task Link** — "Enter Task URL" (shared) or **Use Field** (per-user URL, e.g. personal registration links). Must include `http(s)://` prefix. The Use Field workflow: create/pick a text field (Library → Fields; text-area recommended for links), populate it per record manually or via CSV import ("Update record if already exists" = TRUE), then bind it in the task (https://learn.sessionboard.com/faq/task-use-field).

   ![Add Task modal](img/07-portals/add-task-modal.png)
   *Add Task modal: name, type, description (enter vs use field), task link (enter vs use field). Source: https://learn.sessionboard.com/portals/assign-tasks (image: /images/kb/42f82de6-image-png-Feb-17-2026-10-09-53-2478-PM.png)*

2. **Assign to portal(s)** — portal ellipsis → **Edit Tasks** → Tasks widget → Add → pick tasks. A task can be assigned to more than one portal. Per-portal-assignment settings (pencil under Actions) (https://learn.sessionboard.com/portals/assign-tasks):
   - **Alias** (per-portal display name), **Required** toggle, **Due Date**, **Extended Due Date** (allow completion past due), **Make Completed Tasks View-Only** (user cannot flip back to "Incomplete"), **Assign By Filter** (SESSION tasks only, max 3 filters — task shows only for sessions matching, e.g. `Track is Leadership`).

   ![Task assignment settings row](img/07-portals/task-assignment-settings.png)
   *Assigned-task row: alias, required, due date, actions pencil. Source: https://learn.sessionboard.com/portals/assign-tasks (image: /images/kb/4d5714a8-image-png-Feb-17-2026-10-13-55-1912-PM.png)*

   ![Session task filter](img/07-portals/session-task-assign-by-filter.png)
   *Assign By Filter on a session task (max 3 filters). Source: https://learn.sessionboard.com/portals/assign-tasks (image: /images/kb/0ee5f32d-image-png-Feb-17-2026-10-16-54-3269-PM.png)*

3. **Assign manually / in bulk to records** — from Contacts, Sponsors, or Exhibitors modules (NOT to individual sessions) (https://learn.sessionboard.com/portals/task-assignment):
   - Single: click the plus icon in the task's column on the record row → confirm Assign → reopen → Options for due date/required.
   - Bulk: checkbox-select records → bulk **Assign** menu → Task / Forms / File Requests → pick items → set due dates, required, and "close once complete" → Assign.
   - **Unassign**: click the task icon on the record. "Tasks assigned via the portal can not be unassigned from a record" — portal assignment is computed, manual assignment is a per-record override.
4. **What the portal user sees.** Task cards with name, description, optional link, due date, and a manual complete control; the portal home splits **My Tasks** (contact/group scope) vs **Submission Tasks** (session scope) (https://learn.sessionboard.com/faq/how-are-tasks-ordered-within-the-portal; see also Flow 00 C1).

   ![Portal user task view](img/07-portals/task-in-portal-user-view.png)
   *A task as seen by the portal user. Source: https://learn.sessionboard.com/portals/assign-tasks (image: /images/kb/a9226192-Screenshot-2025-10-09-at-2.51.30-PM.png)*

5. **Completion mechanics.**
   - **User marks done manually.** Explicit KB caution: completing an action on a third-party site "will not automatically mark the task as complete. Users must return to their portal and manually mark the task as complete" (https://learn.sessionboard.com/portals/assign-tasks).
   - **Admin can complete on behalf of a user**: contact profile (pencil on the contact row) → scroll below Sessions and Notes → **Portal Tasks** section → all assigned portal tasks + statuses; changes reflect immediately in the user's portal (https://learn.sessionboard.com/faq/mark-tasks-complete-for-portal-users).
   - **File requests are two-phase**: upload puts them in "Pending Feedback" until an admin approves (see 2d) (https://learn.sessionboard.com/portals/collect-documents).
   - **View-Only lock**: with "Make Completed Tasks View-Only" on, a completed task is closed — users cannot revert it to Incomplete (https://learn.sessionboard.com/portals/assign-tasks).
   - **Deadline lock**: Extend Task Deadlines / Final Deadline — tasks lock N days (default 7) after the original due date (https://learn.sessionboard.com/portals/portals-101).
6. **Ordering — per-portal "Task display order", three modes** (https://learn.sessionboard.com/faq/how-are-tasks-ordered-within-the-portal):
   - **Smart (default):** `Required > Incomplete > Type > Due Date > Name`.
   - **Due Date:** chronological across all three types; no-due-date items grouped last; alphabetical tiebreak. Fully automatic, no manual reorder.
   - **Custom:** one unified drag-drop order interleaving tasks/forms/file requests, in a two-tab panel — **My Tasks** (direct assignments) and **Submission Tasks** (session-scoped; each session group ordered independently). New assignments append to the end until repositioned; per-widget drag reorder is disabled while Custom is active.

   ![Task display order — Smart](img/07-portals/task-display-order-smart.png)
   *Task display order setting, Smart mode. Source: https://learn.sessionboard.com/faq/how-are-tasks-ordered-within-the-portal (image: /images/kb/58d3bb22-Screenshot-2026-07-15-at-15.17.14.png)*

   ![Task display order — Custom](img/07-portals/task-display-order-custom.png)
   *Custom mode with unified reorder panel. Source: https://learn.sessionboard.com/faq/how-are-tasks-ordered-within-the-portal (image: /images/kb/afb91feb-Screenshot-2026-07-15-at-15.17.39.png)*

7. **Tracking completion** — there is no dedicated report screen; admins add **task reporting fields as columns** in the matching module dashboard and save the view: People tasks → Contacts/Speakers module, Group tasks → Sponsor/Exhibitor module, Session tasks → Sessions module. Views are filterable by task status (e.g. only incomplete) (https://learn.sessionboard.com/faq/how-to-track-task-completion-in-the-event-portal, https://learn.sessionboard.com/portals/assign-tasks). Status icon legend:

   | Icon | Meaning |
   |---|---|
   | Green check mark | Task complete |
   | Yellow clock | File request pending approval (new AND declined submissions) |
   | Orange checklist | Task assigned manually, not completed |
   | Blue circle (blue file for file requests) | Task assigned via portal, not completed |
   | Grey plus sign | Task not assigned (click to assign) |

   ![Reporting fields in a dashboard view](img/07-portals/task-reporting-fields-view.png)
   *Task reporting columns in a module view. Source: https://learn.sessionboard.com/portals/assign-tasks (image: /images/kb/8f18493f-image-png-Feb-17-2026-10-17-46-4020-PM.png)*

### 2c. Portal forms — create → attach → submit → confirm

1. **Create** (Portals → Forms → Add Form): title + target type (Contacts / Groups / Sessions), then a 3-page builder (https://learn.sessionboard.com/portals/create-assign-forms):
   - **Form Setup:** Internal Form Name (back-end only), External Form Title (shown in portal), Page Heading.
   - **Form Questions:** sections with title + description/instructions; **+ Add Field** searches existing library fields or creates custom ones. If the record already has data for a mapped field (First Name, Company, Session Title…), the portal user sees it prefilled and can update it — forms double as record-update surfaces. Per-field: required toggle; ellipsis → Customize question (label + help text), Use question rules (conditional logic based on previous answers), Edit field (options etc.), Remove from form (keeps field in library) (form builder details from the official video transcript, https://learn.sessionboard.com/videos/video-forms; standard fields recommended when syncing to integrations like Grip/Swoogo).
   - **Form Settings:** **Send Confirmation Email** toggle — submitter gets an email with a customizable body and a **PDF of their form results attached**.

   ![Form setup](img/07-portals/form-setup-page.png)
   *Form Setup page. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/e4f9b75b-image-png-Jul-07-2026-04-57-37-2639-PM.png)*

   ![Form questions](img/07-portals/form-questions-page.png)
   *Form Questions builder with Add Field. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/4110ed7a-image-png-Jul-07-2026-04-59-29-1099-PM.png)*

   ![Form settings](img/07-portals/form-settings-confirmation.png)
   *Form Settings: confirmation email. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/69826540-image-png-Jul-07-2026-05-00-35-8225-PM.png)*

   ![Confirmation email example](img/07-portals/form-confirmation-email.png)
   *Confirmation email with PDF of responses attached. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/189130b5-Screenshot-2025-12-11-at-4.03.31-PM.png)*

2. **Attach to portal** — a form is not "attached to a task"; it IS a task-like item in its own widget: portal ellipsis → Edit Tasks → Forms widget → Add. Multi-portal allowed. Per-assignment settings: Form Title Alias, Due Date, Extended Due Date, **Allow edits** (after submission), Required, Make Completed Tasks View-Only, Assign By Filter (session forms only, max 3 filters) (https://learn.sessionboard.com/portals/create-assign-forms).
3. **Submission → results.** Admins get NO email on form submission (explicit FAQ answer); they check Portals → Forms → ellipsis → **View Submissions**. Results grid supports Columns / Filters / Sorting; **Options → export CSV/XLSX**; checkbox + **Download Forms** produces PDFs (only if Send Confirmation Email is enabled on the form). No limit on number of forms (https://learn.sessionboard.com/portals/create-assign-forms).

   ![View submissions](img/07-portals/form-view-submissions.png)
   *Form results grid via View Submissions. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/b024e429-image-png-Jul-07-2026-05-05-41-4760-PM.png)*

4. **Bulk-download file-field uploads.** From a module (Contacts/Speakers/Sessions/Sponsors/Exhibitors): select records → More → **Download Files** → check file categories (Form file uploads, Headshots, File requests, Session files, Custom field files, Awards files, Speaker contracts) → choose zip folder structure (**By submitter / By field / By record**) → review count + estimated size → **Generate Download** → Download zip; a "Your file is ready" email with the link is also sent. Only file-type fields are included (https://learn.sessionboard.com/portals/create-assign-forms).

   ![Bulk download files modal](img/07-portals/bulk-download-files-modal.png)
   *Download Files modal with file-category checkboxes. Source: https://learn.sessionboard.com/portals/create-assign-forms (image: /images/kb/2adf155a-image-png-Jul-07-2026-05-10-55-5008-PM.png)*

5. **Tracking:** same reporting-field/column mechanism and icon legend as tasks (https://learn.sessionboard.com/portals/create-assign-forms).

### 2d. File requests — create → upload → review/approve → export

1. **Create** (Portals → File Requests → Add File Request): **Title**, **Type** (Contacts / Groups / **Submissions** = sessions), **Instructions**, optional **sample file(s)** the user can download as reference. Constraints: **one file per request** (users can upload new *versions*), max **1.95 GB**. KB steering: multiple files → use a form instead; headshots → use the Headshot field in a portal form; session presentations/handouts → use session **Files** so they bulk-zip cleanly (https://learn.sessionboard.com/portals/collect-documents).

   ![Create file request](img/07-portals/file-request-create-modal.png)
   *Add File Request modal: title, type, instructions, sample file. Source: https://learn.sessionboard.com/portals/collect-documents (image: /images/kb/dbf5e1c1-image-png-Jul-08-2026-09-43-21-4277-PM.png)*

2. **Assign to portal(s)** — Edit Tasks → File Requests widget → Add; same per-assignment settings as tasks (Alias, Required, Due Date, Extended Due Date, Make Completed Tasks View-Only, Assign By Filter for session requests, max 3) (https://learn.sessionboard.com/portals/collect-documents).
3. **User uploads → "Pending Feedback".** After upload the item shows in the user's portal as **Pending Feedback** with an orange circle; the reporting icon flips to the yellow clock. Admin reviews at Portals → File Requests → ellipsis → **View Submissions** → pencil on the contact row → preview (hover filename) or download → **approve (green check) / deny (red x) / Revert to pending** (https://learn.sessionboard.com/portals/collect-documents).
   - **Deny sends NO notification** — KB recommends using the built-in message thread so the user knows to resubmit; a denied user can submit a new file as a new version.

   ![Pending feedback in the portal](img/07-portals/file-request-pending-feedback.png)
   *User's portal view while their file awaits review. Source: https://learn.sessionboard.com/portals/collect-documents (image: /images/kb/7b09968c-Screen-Shot-2023-02-01-at-11_47_20-AM-1.png)*

   ![Approve / deny](img/07-portals/file-request-approve-deny.png)
   *Admin review popup: approve, deny, download, revert to pending. Source: https://learn.sessionboard.com/portals/collect-documents (image: /images/kb/ff23f0f5-image-png-Feb-23-2026-11-23-15-9364-PM.png)*

4. **Where files land — stored with the request, not attached to the record.** Uploads live in the file request's own submissions store (Portals → File Requests → View Submissions), versioned and approval-gated; they do NOT become "Session files" attached to the session record. Evidence: the bulk Download Files modal treats "**File requests** — files submitted to document/file requests" and "**Session files** — files attached to sessions (presentations, handouts…)" as distinct categories, and the KB explicitly tells admins to collect presentations via session Files instead "so that you can download all presentations as one zip file" (https://learn.sessionboard.com/portals/create-assign-forms, https://learn.sessionboard.com/portals/collect-documents). Clone implication: file-request submissions need their own table (request_id, record_id, version, status pending/approved/denied), separate from record attachments.
5. **Download/export**: (a) individually — Actions → Option, or the download icon inside the review popup; (b) bulk — most recent versions only; raise pagination to 100 to export up to 100 at once; (c) via the cross-module More → Download Files zip flow ("File requests" category) (https://learn.sessionboard.com/portals/collect-documents, https://learn.sessionboard.com/portals/create-assign-forms).
6. **Per-request message thread.** Admins message a contact/group from the review popup; the user gets an email "<Admin Name> sent a message about '<Task Name>' in <Event Name>". When a contact replies, ALL back-end users with access to Portals Tasks get "<Contact Name> sent a message about…" — and admins cannot disable these notifications (https://learn.sessionboard.com/portals/collect-documents).

### 2e. Resources — static files & wiki pages assigned to portals

1. **Files** (static, downloadable): Portals → Files → **Add File** → upload a file (≤1.95 GB) OR provide an external link; Title (name in portal) + Description (helper text on the portal home under the title). Assign via Edit Tasks → Files widget → Add → Add Selected; multi-portal allowed (https://learn.sessionboard.com/portals/share-files).

   ![Add file modal](img/07-portals/add-file-modal.png)
   *Add File: upload or external link + title + description. Source: https://learn.sessionboard.com/portals/share-files (image: /images/kb/66a3e31a-image-png-Feb-25-2026-02-54-50-1793-PM.png)*

2. **Wiki pages / Resources** (dynamic, admin-editable, viewed in-platform, real-time updates): Portals → Resources → **Add Page** → Title (portal home), Subtitle (under title), Page Content (rich text/images/links with formatting tools) → Save Page. Assign via Edit Tasks → Pages widget → Add → Add Selected; multi-portal allowed (https://learn.sessionboard.com/portals/assign-pages, https://learn.sessionboard.com/videos/wiki-pages). Use cases: "Know Before You Go", venue address, parking, dress code.

   ![Wiki page in the portal](img/07-portals/wiki-page-in-portal.png)
   *Resources as the portal user sees them. Source: https://learn.sessionboard.com/portals/assign-pages (image: /images/kb/7f8db1b3-resources.png)*

3. Portal edit-screen widget names (from the tutorial videos): **Assign Tasks**, **Collect Form Submissions**, **Collect Files**, **Assign Pages** — all reached via portal ellipsis → **Edit Tasks** (https://learn.sessionboard.com/videos/video-tasks, /videos/video-forms, /videos/video-file-requests, /videos/wiki-pages).

### 2f. Admin previewing a portal ("View portal as…")

1. From the admin screen top-right, click **View Portal** → **View portal as…** → popup: search a contact or group by name/email; each match lists their **assigned portal** (https://learn.sessionboard.com/faq/how-can-i-view-a-portal-as-an-admin).
2. Select the contact → their portal opens in a new window.
3. **Preview-only mode: tasks and assignments can be viewed, but NOT completed.** (Admins complete on behalf of users via the contact profile's Portal Tasks section instead — 2b.5.)

   ![View portal as](img/07-portals/view-portal-as-admin.png)
   *"View portal as…" search showing each match's assigned portal. Source: https://learn.sessionboard.com/faq/how-can-i-view-a-portal-as-an-admin (image: /images/kb/174eec4e-image-png-Jan-28-2026-09-36-23-1190-PM.png)*

### 2g. Related portal-user recipes (FAQ-sourced, for parity awareness)

- **Let portal users add speakers to accepted sessions** — Option 1: reopen the submission form (Form Settings → future Close Date), create a portal task instructing "add speakers by editing your original submission", enable **View Session Submission Form** in portal settings so users get a direct link back. Option 2: a Sessions-type portal form collecting new-speaker details (include the session Title field); admin reviews submissions and manually creates/attaches the contact (https://learn.sessionboard.com/faq/how-to-allow-portal-users-to-add-speakers-to-their-accepted-session).

---

## 3. Inventory

**Task entity fields** (https://learn.sessionboard.com/portals/assign-tasks, /faq/task-use-field): Task Name · Task Type (Contacts | Groups | Sessions) · Description (static text | Use Field → contact/group/session field) · Task Link (static URL | Use Field; http(s) prefix required).

**Per-portal item assignment settings** (tasks & file requests; forms add two) (https://learn.sessionboard.com/portals/assign-tasks, /portals/create-assign-forms, /portals/collect-documents): Alias / Form Title Alias · Required (toggle, also inline in Required column) · Due Date · Extended Due Date · Make Completed Tasks View-Only · Assign By Filter (session items only, ≤3 filters) · [forms only] Allow edits after submission.

**Manual/bulk record assignment options** (https://learn.sessionboard.com/portals/task-assignment): due date · required · close once complete; bulk menu covers Tasks, Forms, File Requests; portal-derived assignments can't be unassigned per record.

**Portal-level configuration** (https://learn.sessionboard.com/portals/portals-101, /faq/how-are-tasks-ordered-within-the-portal, /faq/how-to-create-a-portal-for-accepted-speakers, /faq/how-to-allow-portal-users-to-add-speakers-to-their-accepted-session): internal name · type (Contacts | Groups) · audience filters · Always Show Tasks · Extend Task Deadlines + Final Deadline (default 7 days) · Manage Profile · Manage Related Sessions & Participants · Send Weekly Digest Email · View Session Submission Form · Task display order (Smart | Due Date | Custom) · Participation sections (Confirmed section on/off, subsessions in My Submissions on/off, 3 renamable section titles ≤100 chars) · appearance (welcome message, accent color, logo, background image) · Show/Hide Fields per contact/session field (editable | locked view-only | hidden).

**Global portal settings** (Settings → Portals; support must enable; applies to ALL portals) (https://learn.sessionboard.com/settings/portal-settings): Login Page — logo 100×100 + alt, background 1500×400 + alt, button color, button text color, background color, welcome-message font/size/color, login message. Home Page — logo 100×100 + alt, background (Legacy 1500×200 / Pro 1920×200) + alt, full-width toggle, background color, accent color.

![Global portal appearance settings](img/07-portals/portal-appearance-settings.png)
*Settings → Portals: home-page appearance. Source: https://learn.sessionboard.com/settings/portal-settings (image: /images/kb/0858d47b-Screenshot-2025-10-09-at-2.41.20-PM.png)*

**Form builder** (https://learn.sessionboard.com/portals/create-assign-forms, /videos/video-forms): 3 pages (Setup: internal name / external title / page heading · Questions: sections + fields · Settings: confirmation email + PDF). Field options: library search or create-custom (dropdown, file, text, checkbox, text area, …) · required toggle · custom label + help text · conditional question rules · edit field options · remove-from-form (non-destructive). Prefill from existing record data.

**File request entity** (https://learn.sessionboard.com/portals/collect-documents): Title · Type (Contacts | Groups | Submissions) · Instructions · sample file(s) · 1 file/request · versions · 1.95 GB cap · statuses: pending feedback → approved | denied (| reverted to pending) · per-request message thread.

**Resource types** (https://learn.sessionboard.com/portals/share-files, /portals/assign-pages): File (upload ≤1.95 GB | external link; title + description) · Wiki Page (title + subtitle + rich-text content).

**Reporting** (https://learn.sessionboard.com/faq/how-to-track-task-completion-in-the-event-portal): per-item reporting fields (columns) in Contacts/Speakers, Sponsor/Exhibitor, Sessions modules; 5-state icon legend (see 2b.7); filterable; "Assigned Portal" field on records.

---

## 4. Screenshots

29 screenshots downloaded to `img/07-portals/` (all verified PNG via `file`); each is embedded above with caption + source page + original image URL. Full set: portals-module-overview, portal-filter-example, create-portal-type-filters, reorder-portals, assigned-portal-field, always-show-tasks-toggle, manage-portal-access, portal-invite-email, task-in-portal-user-view, add-task-modal, task-assignment-settings, session-task-assign-by-filter, task-reporting-fields-view, task-display-order-smart, task-display-order-custom, form-setup-page, form-questions-page, form-settings-confirmation, form-confirmation-email, form-view-submissions, bulk-download-files-modal, file-request-create-modal, file-request-pending-feedback, file-request-approve-deny, add-file-modal, add-wiki-page-modal, wiki-page-in-portal, view-portal-as-admin, portal-appearance-settings. (Two not embedded inline: `add-wiki-page-modal.png` — Add Page fields, source https://learn.sessionboard.com/portals/assign-pages, image /images/kb/02232d5f-undefined-Feb-25-2026-02-48-22-5333-PM.png.)

---

## 5. Gaps

- **Arcade-only pages.** https://learn.sessionboard.com/get-started/update-a-portal-field-label and https://learn.sessionboard.com/get-started/upload-a-file-to-a-session contain ONLY an embedded interactive demo (demo.arcade.software iframes) — no extractable text. The former presumably covers per-portal field-label overrides (Show/Hide Fields area), the latter the portal user's session file upload; exact click paths unverified.
- **Form completion semantics.** The KB never states explicitly that submitting a form marks its portal item complete (strongly implied by the completion-reporting section of /portals/create-assign-forms). Whether "Allow edits" reopens a completed status is undocumented.
- **Approval notification.** Deny is documented as silent; whether APPROVING a file request notifies the user is not documented (https://learn.sessionboard.com/portals/collect-documents).
- **Weekly Digest Email** — toggle named in Portals 101; content, schedule, and trigger conditions undocumented.
- **Reminder emails on due dates** — "Due Date: … the portal user can track and receive notifications on" (/portals/assign-tasks) is the only mention; cadence/template unknown.
- **Portal auth flow** (password creation, "How to access my portal?" and "change portal username" articles) referenced but outside the fetched set; portal-login page behavior unverified.
- **Session-task fan-out** — "contacts/groups who are associated with a session … will see this task" implies every participant of a matching session sees a Submission Task, but per-role scoping (speaker vs moderator) is undocumented.
- **Task display order** is described "per portal (config set)" in the FAQ but its exact location in the portal edit UI isn't shown.
- **Deleting a portal**: confirmation dialog documented; where its members get reassigned (presumably re-resolved to next matching/default portal) is not stated (https://learn.sessionboard.com/portals/creating-custom-portals).
- **Multi-language portals** referenced in Portals 101 (auto-translated section titles) but the language-variants page was not in scope.
