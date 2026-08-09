# E1 — Verification: Portal admin content-creation (Tasks · Portal Forms · File Requests)

**Method.** Frame-by-frame read of the three official Guidde walkthroughs — `07-tasks/01–16.jpg`, `07-portal-forms/01–20.jpg`, `07-file-requests/01–15.jpg` — cross-checked against `ALL-CAPTIONS.md` (their narration), `docs/flows/07-portals-tasks.md` (our doc under test), and `SCOPE.md` Appendix I. In each set image `01` is the Sessionboard title card and the last image (`16`/`20`/`15`) is the blue "presented by" outro — no product content in either; they are not cited below.

**Verdict.** Our `07-portals-tasks.md` model is substantially correct. The assign-to-portal spine, the three type targets, Use Field, one-file-per-request, and PDF-on-confirmation all hold. The corrections are UI-label and mechanic-level, not conceptual: the ellipsis menu is richer than documented, "Edit Tasks" lands inside a 4-step portal wizard (step 2 = "Assign items"), portal-form Form Setup has **no Page Heading**, "Extended Due Date" is a *derived column* not an editable field, and file-request instructions are labelled "Criteria / Instructions".

---

## 1. Screen-by-screen confirmed inventory

### 1A. TASKS (`07-tasks/`)

**Tasks list — `02`, `03`.** Reached via left nav **Portals ▸ Tasks**. Header "Tasks / Create tasks that can be assigned to your portals". Search box + **`+ Add Task`** (blue, top-right). Table columns: **Name · Type · Method · URL Value · Actions (Edit | Delete)**. `Type` renders singular — **Contact / Group / Session**. `Method` shows **Manual** for every row (this is the create-method, distinct from the portal-vs-manual *assignment* method). `URL Value` shows the task link (e.g. `http://www.google.com`, a `docs.google.com` URL, or `-` when none).

**Add Task modal — `04`–`08`.**
- Info banner: *"Create tasks for portal users to review resources (files and links) that are hosted outside of the portal. Tasks can share the same resource or use a contact field to display unique data in each portal."*
- **Task \*** (label is literally "Task", not "Task Name") — **0/100 characters** counter.
- **Type \*** — three selectable cards: **People** *(Contacts, Speakers)* · **Groups** *(Sponsors, Exhibitors)* · **Sessions** *(Sessions)*. People is the default selection.
- **Description** — radio pair: **Enter Description** (opens a rich-text editor: **B, I, U, x², x₂, link, bullet list, numbered list, outdent, indent, ⋯**) vs **Use Field** (shows a picker box reading "No field selected" with an **Edit** pencil to bind a field). Example static text seen: *"Access the registration site using the link attached to register for the event."*
- **Task Link** — radio pair: **Enter Task URL** (input placeholder `e.g. https://www.google.com`) vs **Use Field**.
- Footer: **Add Task** (orange) · Cancel.

**Assign-to-portal — `09`–`14`.**
- **Portals module (`09`)**: `+ Create Portal`, a pencil icon (reorder), info banner *"Contacts that match multiple portal criteria are assigned to the top portal. Edit portal order to rearrange portal visibility."*, tabs **People Portals (2)** / **Group Portals (1)**, portal cards ("Moderators — Moderator is checked · Filters: 1 · Assigned to: 1 · Created by … "), each with an ellipsis `⋯`.
- **Portal ⋯ menu (`10`)**: **Copy Link · Edit Criteria · Edit Tasks · Edit Settings · Edit Appearance · Duplicate · Delete**.
- **Edit Tasks → portal editor (`11`)**: opens a 4-step wizard — **① Select participants → ② Assign items → ③ Configuration → ④ Appearance**. Header = portal name + pencil, "Can be assigned to people", created-by line, `< Edit Filters`, `Continue`. Landing step is **② Assign items**, which stacks these widgets, each with a `⊘ Not Configured` / `✓ N Assigned` status and three buttons **Assign … / Manage … / Learn more**:
  - **Assign Tasks** — *"Assign tasks for users to complete on this portal."*
  - **Collect Form Submissions** — *"Assign forms for users to fill out on this portal."*
  - **Collect Files** — *"Let users submit files (e.g. contracts, headshots, documents) electronically."*
  - **Share Files** — *"Upload files for users to view and download on this portal."*
  - **Assign Pages** — *"Let users assign pages electronically."*
- **Assign tasks → Select & Save (`12`)**: modal titled "N task assigned"; Search; **SELECT ALL | NONE**; checkbox list of every task; footer "N selected · Select all · Clear selected" + orange **Save**.
- **Assigned-task row (`13`)**: table columns **Name · Alias · Due Date · Extended Due Date · Required (toggle) · Actions (✎ pencil, ✕)**. Required flips inline.
- **Per-assignment edit modal (`14`, "Edit Session task")**: yellow banner *"You are editing a session task. Session tasks will show under each session the user sees in their portal."* Fields: **Alias** · **Due Date** (`MM/DD/YYYY @ hh:mm a` + calendar) · **Required** (toggle) · **Make Completed Tasks View-Only** (toggle) · **Assign By Filter** (toggle → filter rows `Format | is | Keynote`, `+ Add filter`, ✕). Footer **Update**.

**Portal-user task view — `15`.** A "Tasks (N)" panel with tabs **All / My Tasks / Sessions** and two groups: **Session Tasks** (empty state "No session tasks found") and **My Tasks** (card = circle-check + name + description). Clicking opens a right slide-over: **Details** tab, status chips **OPEN** + **⚠ Incomplete** (orange), the description, an **Open Link ↗** button (renders only when the task carries a link), and footer buttons **Done** / **Mark as Complete** (blue). Confirms the "return and mark complete manually" mechanic.

---

### 1B. PORTAL FORMS (`07-portal-forms/`)

**Forms list — `02`, `03`.** Left nav **Portals ▸ Forms**. Header "Forms / Create forms that can be assigned to your portals to collect information". `+ Create Form`. Tabs: **All Forms (9) / People Forms (4) / Group Forms (3) / Session Forms (2)**. Sort "Most Results". Cards: submission-count badge, title, "N submissions", target-type icon (Contact), created-by, `⋯`. (Examples: "Headshot & Bio Collection", "Post Event: Please share any receipts for reimbursement".)

**Create Portal Form modal — `04`.** "Who do you want to collect information from?" — three cards **Contacts** *(Speakers, People)* · **Groups** *(Sponsors, Exhibitors)* · **Sessions** *(Sessions)*. Footer **Save & Build Form** (orange) · Cancel. *(Note the Contacts sub-label reads "Speakers, People" here vs "Contacts, Speakers" on the Task/File-Request cards — Sessionboard's own copy is inconsistent.)*

**Form wizard = 3 steps** (progress bar): **Form Setup → Form Questions → Form Settings**.
- **Form Setup (`05`)**: *"Give your form an internal name, public title, and select what kind of form you want to build."* Fields: **Name** (internal) · **Title** (public) · **Type \*** (Contacts/Groups/Sessions cards). Button **Next: Form Questions**. **There is no Page Heading field here.**
- **Form Questions (`06`–`11`)**: subtitle *"Add questions you want your contacts to answer. Each question will update the relevant fields on the contact profile."* → **Section Title** + **Description & Instructions** (plain textarea). Then the **Form Questions** list: columns **QUESTION LABEL · SET AS REQUIRED (toggle) · ACTIONS (⋯)**; drag handles for reorder. Locked defaults **First Name / Last Name / Email** ship required-on. **`+ Add Question`** opens the **Select fields** modal (`08`): "Filter fields…" search; tabs **All Fields / Global / Event**; left = checkbox library list with per-field type ("Text", "Dropdown") and a globe (global) or calendar (event) scope icon; right = **Selected Fields** reorderable list (✓ / ✕ per field); **Select All | Remove All**; footer **Cancel / Done / `+ Create New Field`**. Per-question `⋯` (`11`): **Customize question · Use question rules · Edit field · Remove from form**.
- **Form Settings (`12`)**: **Send Confirmation Email** toggle (on) — subtitle *"Submitters will receive an email with a link to access their submission in the portal."* — plus a rich-text body editor (default *"Thank you for submitting your form. Here is a link to your submission."*). Footer **Back / Save** (orange).

**Assign-to-portal — `13`–`18`.** Identical spine to Tasks: Portals home (`13`) → portal `⋯` → **Edit Tasks** (`14`) → step ② Assign items → **Collect Form Submissions** widget → **Assign forms** (`15`) → "N form assigned" Select-&-Save modal (`16`) → **Save** → assigned row (`17`, columns **Name · Alias · Due Date · Extended Due Date · Required · Actions**). Per-form edit modal (`18`, "Edit session task"): **Form Title Alias · Due Date ·** green banner *"This form is accepting new submissions" ·* **Allow edits** (toggle, on) · **Mark this form as required** (toggle) · **Make Completed Tasks View-Only** (toggle) · **Assign By Filter** (session forms) · **Update**.

**Portal-user form view — `19`.** Rendered as a full page: event banner image, Sessionboard logo, **← Back to Homepage**, the public **Title** ("Update Your Information"), the Description & Instructions line, then the fields — **First Name \*** (0/255 Characters), **Last Name \*** (0/255), **Email \***.

---

### 1C. FILE REQUESTS (`07-file-requests/`)

**File Requests list — `02`, `03`.** Left nav **Portals ▸ File Requests**. Header "File Requests / Create requests to collect files (e.g. documents, contracts) in your portals". `+ Create Request`. Tabs: **All Requests (4) / Open (4) / Closed (0)** — a *status* split. Sort "Most Pending". Cards: result-count badge, title (often suffixed "(Session)" / "(Contact)"), "N result(s)", target-type icon, created-by, `⋯`.

**Add File Request modal — `04`–`07`.** Fields: **File Request Title \*** (example "Speaker Agreement") · **Type \*** (People/Groups/Sessions cards) · **Criteria / Instructions** — a rich-text editor (B/I/U, x²/x₂, link, lists, indent, **image insert**, clear-formatting, ⋯) with subtitle *"Provide information such as what files are accepted, naming conventions, etc."* · **Include sample file(s) with this request** — subtitle *"Would you like to include documents/files with this request? E.g. a sample document or a blank document"* + a paperclip **upload dropzone**. Footer **Save File Request** (orange).

**Assign-to-portal — `08`–`13`.** Same spine: Portals home (`08`) → portal `⋯` → **Edit Tasks** (`09`) → step ② Assign items → **Collect Files** widget (`10`) → **Assign file requests** → "N file request assigned" Select-&-Save modal (`11`) → **Save** → assigned row (`12`, columns **Name · Alias · Due Date · Extended Due Date · Required · Actions**). Per-request edit modal (`13`, "Edit Session Presentation"): yellow session banner + **Alias · Due Date · Required · Make Completed Tasks View-Only · Assign By Filter** (session) · **Update**. *(No "Allow edits" — that field is forms-only.)*

**Portal-user file-request view — `14`.** Right slide-over "Speaker Agreement" with tabs **Details | Messages**. Status **OPEN + ⚠ Incomplete**. A **CRITERIA** block (the instructions text). A **SAMPLE DOCUMENT** block with a downloadable PDF chip ("Speaker Agree… PDF"). A **Files** block = a **single** dropzone *"Drag and drop a file here or click to choose one from your computer."* Footer **Done / Submit** (Submit disabled until a file is attached). Confirms one-file-per-request, downloadable sample, and the per-request **Messages** thread.

---

## 2. Corrections & new facts vs `07-portals-tasks.md`

| # | Our doc says | Walkthrough shows | Fix |
|---|---|---|---|
| C1 | Portal `⋯` menu = "Edit Tasks, Copy Link, Duplicate, Delete" (§2a img caption) | 7 items: **Copy Link · Edit Criteria · Edit Tasks · Edit Settings · Edit Appearance · Duplicate · Delete** (`tasks/10`, `forms/14`, `file-requests/09`) | Add Edit Criteria / Edit Settings / Edit Appearance |
| C2 | "Edit Tasks → Tasks widget → Add → pick tasks" (§2b.2) | **Edit Tasks opens a 4-step portal wizard** (Select participants → **Assign items** → Configuration → Appearance); the widget is **Assign Tasks** and the button is **Assign tasks** (not "Add") (`tasks/11`) | Reframe: menu item "Edit Tasks" ≠ a lone widget; it is the portal editor's step ② |
| C3 | Widget names "Assign Tasks, Collect Form Submissions, Collect Files, Assign Pages" (§2e.3) | Confirmed **+ Share Files** exists as its own widget (portal Files/resources) (`forms/15`, `file-requests/10`). Each widget also has a **Manage …** button and a **Learn more** button. | Add "Share Files"; add Manage/Learn-more buttons |
| C4 | Per-assignment settings include an editable "Extended Due Date" (§2b.2, Inventory) | The edit modal contains **Alias · Due Date · Required · Make Completed Tasks View-Only · Assign By Filter** only. **"Extended Due Date" is a read-only *column*, not a modal field** — it is derived from the portal-level "Extend Task Deadlines" setting (`tasks/14`, `file-requests/13`, `forms/18`) | Downgrade Extended Due Date from "editable per-assignment" to "derived display column" |
| C5 | Task fields = "Task Name … Task Type (Contacts/Groups/Sessions)" (§2b.1) | Field label is **"Task" (0/100)**; type cards are **People / Groups / Sessions** with sub-labels; list column shows **Contact/Group/Session** (singular) | Use the real labels; note 100-char cap |
| C6 | Portal-form Form Setup = "Internal Form Name, External Form Title, **Page Heading**" (§2c.1) | Portal-form Form Setup = **Name + Title + Type only. No Page Heading.** (`forms/05`) | Remove Page Heading from portal forms (it belongs to the *submission/CFP* form builder, not portal forms) |
| C7 | Confirmation email "PDF of their form results attached" (§2c.1) | Two co-existing facts: the **in-UI toggle copy** says *"an email with **a link to access their submission** in the portal"* (`forms/12`); the **narration** (caption 07-portal-forms step 12) says *"an email … with **a PDF of their form responses attached**."* | Keep PDF (narration-confirmed) **and** add the submission link — the email carries both |
| C8 | File-request "Instructions" field (§2d.1) | Field is labelled **"Criteria / Instructions"**, is **rich-text with image insert**, and the sample section reads "sample **file(s)**" (plural allowed) (`file-requests/04`,`06`,`07`) | Rename field; note multiple sample files allowed |
| C9 | Portal task groups "My Tasks vs **Submission Tasks**" (§2b.4) | Actual labels are **My Tasks** and **Session Tasks**; the tab is **Sessions** (`tasks/15`, `file-requests/14`) | Use "Session Tasks" / "Sessions" (the "Submission Tasks" label from the CFP portal home may be a separate/older surface) |
| C10 | File-request tabs "All / Contact / Group / Submission Requests" (SCOPE App. I) | Actual tabs are **All Requests / Open / Closed** (status, not type) (`file-requests/02`) | Correct the tab set |
| C11 | Forms tabs "All / Contact / Group / Submission Forms" (SCOPE App. I) | Actual tabs are **All Forms / People Forms / Group Forms / Session Forms** (`forms/02`) | Correct the tab set |
| C12 | Assign-By-Filter "for SESSION tasks only" (§2b.2) | **Confirmed** — the edit modal only surfaces Assign By Filter on the session-type variant, and the "Edit **session** task" banner appears (`tasks/14`, `forms/18`, `file-requests/13`) | No change (verified) |

**New facts worth capturing (not previously in our doc):**
- The Select-&-Save assignment modal is a uniform component across all three types: title "N … assigned", search, **SELECT ALL | NONE**, checkbox list, "N selected / Select all / Clear selected", orange **Save**.
- The per-assignment table is identical across Tasks / Forms / File Requests: **Name · Alias · Due Date · Extended Due Date · Required · Actions (✎ ✕)** with drag handles.
- "Required" is worded **"Mark this form as required"** inside the form edit modal (plain "Required" for tasks/file-requests).
- Form Questions explicitly **write back to the contact profile** ("Each question will update the relevant fields on the contact profile") — corroborates our prefill/record-update claim, now with the exact source string.
- File-request user detail pane has a dedicated **Messages** tab (the per-request thread from §2d.6) sitting next to **Details**.

---

## 3. Confidence grade per screen + residual unknowns

**Legend:** ✅ High = read directly off a clear frame · 🟡 Medium = visible but partial/one-instance · ⚪ Low = inferred, needs KB.

| Screen | Grade | Notes |
|---|---|---|
| Task create dialog (Task/Type/Description/Use Field/Task Link) | ✅ High | Every field & both radio states seen (`04`–`08`) |
| Task list + Method/URL columns | ✅ High | `02`/`03` |
| Portal ⋯ menu (7 items) | ✅ High | Seen identically in all three sets |
| Portal editor wizard (4 steps) + Assign-items widgets | ✅ High | `tasks/11`, `forms/15`, `file-requests/10` |
| Select-&-Save modal | ✅ High | All three sets |
| Per-assignment row + Required toggle | ✅ High | `13`/`17`/`12` |
| Per-assignment edit modal (session variant) | ✅ High | `tasks/14`, `forms/18`, `file-requests/13` |
| Assign-By-Filter mechanics | 🟡 Medium | Toggle + one filter row + `+ Add filter` seen; **the "max 3 filters" cap is NOT visible** (only one row shown) |
| Portal-form wizard (all 3 steps) | ✅ High | `05`–`12` |
| Form field picker / Create New Field | ✅ High | `08` |
| Form confirmation email | 🟡 Medium | Toggle + body seen; **PDF-attach is narration-only, not visible in-frame**; UI copy stresses the link |
| Portal-form user view | ✅ High | `19` |
| File-request create dialog | ✅ High | `04`–`07` |
| File-request one-file upload + sample + Messages | ✅ High | `14` (single dropzone, Submit, sample PDF, Messages tab) |
| File-request approve/deny review popup | ⚪ Low | **NOT in this walkthrough** — approve/deny/revert-to-pending, "Pending Feedback", yellow-clock reporting icon all come from the KB (`collect-documents`), unverified here |
| Non-session (People/Group) edit modal | 🟡 Medium | Only the **session** variant of the edit modal was captured for all three types; the People/Group modal presumably omits Assign-By-Filter + the session banner, but that exact frame wasn't shown |
| "Extend Task Deadlines" duration | ⚪ Low | Not in these frames. Portal-appearance walkthrough narration says **up to 31 days**; our doc says **Final Deadline default 7 days** — reconcile before locking (likely: default 7, max 31) |

**Residual unknowns (carry forward):**
1. Assign-By-Filter maximum filter count (KB says 3; unconfirmed on-screen).
2. Whether the form confirmation email genuinely attaches a PDF *and* a link, or the narration is loose — needs a real submission test.
3. The entire file-request **review/approval** loop (Pending Feedback → approve/deny/revert, silent-deny, reporting icons) is undocumented in this video set.
4. People/Group (non-session) per-assignment edit modal layout.
5. Extend-Task-Deadline window: 7 vs 31 days.
6. Reporting-column/icon-legend tracking (§2b.7) not shown in any of these three walkthroughs.

---

## 5-line summary

1. **Assign-to-portal model (uniform for all 3 types):** create the item under Portals ▸ Tasks/Forms/File Requests → open a portal's `⋯` → **Edit Tasks** → the portal editor's step ② **Assign items** → the matching widget (**Assign Tasks / Collect Form Submissions / Collect Files**, plus **Share Files** & **Assign Pages**) → **Assign …** → tick items in the Select-&-Save modal → **Save** → set **Required** inline and open the **✎ Actions** modal for Alias/Due Date/View-Only and (session items only) **Assign By Filter**.
2. **Type targets are identical** — People *(Contacts, Speakers)* / Groups *(Sponsors, Exhibitors)* / Sessions — and session-type items fan out under each session in the user's portal.
3. **The three differ at the payload:** Tasks = a link/resource pointer (URL or **Use Field**) the user opens then **marks complete**; Forms = multi-field data collection that writes back to the contact profile and fires a confirmation email (link **+** PDF of responses); File Requests = **one** file upload (versioned resubmit), a downloadable sample doc, and a per-request **Messages** thread.
4. **Top corrections:** the portal `⋯` menu has 7 items (adds Edit Criteria/Settings/Appearance); "Edit Tasks" opens a 4-step wizard, not a lone widget; **Extended Due Date is a derived column, not an editable field**; portal-form Form Setup has **no Page Heading**; file-request instructions are labelled **"Criteria / Instructions"**; list tabs are status/type-based differently than we recorded.
5. **Residual unknowns:** the file-request approve/deny review loop and reporting icons aren't in these videos; the Assign-By-Filter 3-filter cap, the confirmation-email PDF, and the Extend-Deadline window (7 vs 31 days) are unconfirmed on-screen.
