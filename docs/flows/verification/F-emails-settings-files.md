# Verification F — Emails (Templates + Sending), Event Settings, Session Files

**Date:** 2026-08-08. **Method:** Frame-by-frame read of the four Guidde walkthroughs (`docs/reference/guidde/03-email-templates/*.jpg` 1–17, `03-sending-emails/*.jpg` 1–13, `08-event-settings/*.jpg` 1–16, `04-session-files/*.jpg` 1–21) cross-checked against `docs/reference/guidde/ALL-CAPTIONS.md`, `docs/flows/03-emails-communications.md`, `docs/flows/08-settings-data-api.md`, and `SCOPE.md`.

**Bottom line:** Our docs are directionally correct on all four surfaces, but the authoritative walkthroughs contradict several specifics we had wrong — the template **Type** labels, the accept/decline **send-flow recipient list**, the classic-template **merge-tag token format**, and the exact shape of the Email Templates landing page. Corrections in §2.

---

## 1. Screen-by-screen confirmed inventory

### 1a. Email Templates page — `03-email-templates`

**Navigation** (img 02–03): Settings (left rail) → Event Settings → **Email Templates** in the settings sub-nav (sub-nav order: Event Details · Record Settings · Portals ▾ [Login Page, Appearance] · Submission Forms · **Email Templates** · Integrations).

**Landing layout is card-based, not a table** (img 03, 04, 16). Two stacked sections:
- **Custom Templates** — with a `+ Add` button (orange, top-right). Empty state: *"You haven't added any templates yet — Custom email templates make it easy to send common emails quickly."*
- **Standard Templates** — read/edit-only cards. Confirmed cards: **Accept Sessions** (*"Send this template to submissions that you have accepted"*), **Decline Sessions** (*"Send this template to submissions that you have declined"*), and **Session Form – One Day Reminder** (partially visible below the fold). The caption/KB also lists a Five-Days reminder. Click a standard card to edit it.

**Editor modal — "Create Custom Template"** (img 07–15), top-to-bottom:
| Field | Detail |
|---|---|
| **Template Name** | free text, ⓘ tooltip (img 07) |
| **Type** | dropdown, ⓘ; options **Contacts / Exhibitors/Sponsors / Sessions** (default Contacts) (img 08) |
| EMAIL section header | — |
| **Reply To** | single field, ⓘ ("supports a single email address" per caption) (img 09) |
| **CC** / **BCC** | two side-by-side fields, each ⓘ (limit 5 each, invalid ignored — per caption, not shown on-screen) (img 10–11) |
| **Subject Line** | single field, ⓘ (img 12) |
| **Message Body** | rich-text editor + **Merge Tags** button (img 13–14) |
| Footer | **Save** (orange) / **Cancel** (img 15) |

**Body toolbar** (img 05, 13): Bold · Italic · Underline · superscript (x²) · subscript (x₂) · link · bullet list · numbered list · outdent · indent · image · clear-formatting (Iₓ) · code `<>` · overflow `···`. A word counter sits bottom-right of the editor.

**Standard Accept template contents** (img 05, and re-shown in the send modal img 09): Subject = *"Your submission has been accepted"*; body uses triple-brace merge tags — `{{{recipient.first_name}}}`, `{{{recipient.last_name}}}`, `{{{title}}}`, `{{{event.name}}}`, `{{{starts_at}}}`, `{{{ends_at}}}`, `{{{location}}}`.

**Merge tags differ by Type** — confirmed (caption step 14: *"merge tags differ based on module type… select the appropriate module first"*). The on-screen Merge Tags picker contents per type were not shown.

### 1b. Sending emails — `03-sending-emails`

**Where from** (img 02, caption step 2): Contacts, Exhibitors, Sponsors, and **Sessions** modules. Walkthrough uses Sessions → **Submissions**.

**List → selection** (img 03–04):
- Status filter chips with live counts: **View All · Accepted · Accept Queue · Pending · Decline Queue · Declined · Drafts**.
- Pagination selector bottom-right — walkthrough recommends **Show: 100** because *"emails can only be sent in batches"* of 100 (caption step 3).
- Header-row checkbox selects all on the page → action bar appears: **Edit · Send Emails · Download Files · Delete · More ▾ · Clear selected** ("N Selected" counter).

**Send Email modal — 3-step wizard** (progress bar: **Setup Email → Review → Send**):

*Step 1 — Setup Email* (img 05–09):
- Left column, "N selected participants":
  - **Who should receive this email?** (ⓘ) dropdown. Full option list (img 05): **Everyone (Submitters, Speakers, Chairpersons, Moderators)** · **Session Participants (Speakers, Chairpersons, Moderators)** · **Session Speakers** · **Session Chairpersons** · **Session Moderators** · **Session Submitters** · **Select Individual Contacts**.
  - **Include additional contacts:** (ⓘ) dropdown (img 06): *Select… · Include additional contacts of recipients (CC) · Send only to additional contacts of recipients · Do not include additional contacts* (default). Additional contacts get their own separate but identical copy.
  - **Replies sent to:** (ⓘ) — pre-filled **`no-reply@sessionboard.com`**, editable, single address (img 07).
  - **CC:** / **BCC:** fields, each ⓘ (img 08).
- Right column: **Insert a message template ▾** (applies a saved template into subject+body — img 09) and **Merge Tags** button; **subject** field (*"Enter your email subject…"*); rich-text body (same toolbar as templates); **Review** button (orange, enabled once valid) / Cancel.

*Step 2 — Review & Preview* (img 10): left = *"N people will receive emails"* with **Name / Email / Action** columns; the **Action** column has a radio per recipient to pick whose rendered email to preview. Right = **Preview As: [name]**, Subject, CC, BCC, then the fully-rendered email (Sessionboard-logo header wrapper + *"Dear [name],"* body). Footer: **Back** / **Send Emails** (orange).

*Step 3 — Send* (img 11): confirmation *"Just to confirm — You're about to send N emails. Ready to go? Hit 'Send' below."* + green **Send N emails** button.

**History** (img 12, caption step 12): History module → **Emails** tab (siblings: SMS, Integrations, Exports, Audit). Sub-tabs **Campaigns (n) · Sent Emails (n) · Errors (n)**. Columns: Recipient · Email · Subject · **Status** (Open / Delivered / Dropped seen) · Sent By (System) · Sent At. Paginated (Show: 25).

### 1c. Event Settings → Event Details — `08-event-settings`

Nav (img 02–03): Settings → Event Settings → **Event Details** (first sub-nav item). Fields (img 03–15), two-column:
| Field | Notes |
|---|---|
| **Event Name** | text (img 04) |
| **Event Slug** | text, ⓘ (e.g. `sessionboard-conference`) (img 05) |
| **Event Type** | dropdown, clearable ×, ⓘ (e.g. "Conference") (img 06) |
| **Event Website URL** | text, ⓘ, placeholder `ex: https://www.youreventwebsite.com` (img 07) |
| **Event Location** | text, ⓘ, placeholder `ex: San Francisco, CA (or Zoom, On24, etc.)` (img 08) |
| **Timezone** | dropdown, clearable ×, ⓘ (e.g. "(GMT-8:00) America/Los_Angeles") (img 09) |
| **Starts At** / **Ends At** | date+time pickers, ⓘ, format `MM/DD/YYYY @ hh:mm a` (img 10) |
| **Theme** | textarea, **0/1000 characters** counter; helper *"This helps improve search, recommendations, and how content is organized."* (img 11) |
| **Image Settings → Logo Image** | Upload New; **Recommended 300 w × 300 h**; Clear Value link (img 12, 14) |
| **Image Settings → Background Image** | Upload New; **Recommended 1500 w × 500 h**; Clear Value link (img 13) |
| **Save** | orange, bottom (img 15) |

### 1d. Session Files — `04-session-files`

**Enable + settings** (Sessions → Settings → **Files** sub-tab; sub-nav: Agenda·Criteria·Personas·Rooms·Tracks·Tags·Levels·Formats·Languages·**Files**·Statuses) (img 02–04):
- **Enable File Upload** toggle (*"This will let the user add files to the session."*).
- **Due Date** (ⓘ, date+time, e.g. `02/28/2026 @ 11:59 pm`).
- **Accepted File Formats** — multi-select chips (e.g. PDF, PPT, Word), each removable ×, dropdown to add.
- **File Limit** — numeric stepper, "number of files that can be uploaded per session" (e.g. 3).
- **Limit File Size** toggle → blue banner: *"Enter custom values in order to restrict the allowed file size. The maximum permitted file size is **1.95 GB**."* Then **Minimum** / **Maximum** numeric + **Type** unit dropdown (GB) (img 03–04).
- **Enable Comments** toggle (*"allow speakers to communicate directly with event organizers"*).
- **Save** (orange).

**Speaker guidance task** (img 05–07): recommended pattern is a Portals → Tasks entry; the task's description/link points to the KB article *"How do I upload files to my session and make comments?"* (`support.sessionboard.com/en/articles/7096260-…`).

**Portal upload (speaker side)** (img 08): Speaker Resource Page → open session (e.g. "Keynote Session – Accepted") → right-panel tabs **Details · Tasks · Files · Participants** → **Files** tab → **Upload Files** (*"Upload up to 3 files… limited to: Pdf, Ppt. All content must be submitted by February 28, 2026 11:59 PM (PST)"*), drag-and-drop zone (*"We accept files between 0 gb and 1 gb"* — reflects this event's custom max), **Upload** button; **Session Files** list ("No files have been uploaded yet").

**Admin-side per session** (img 10): Sessions → Submissions → open session → **Files (n)** tab (siblings Details·Participants·Files·Subsessions·Audit) — same upload zone + **Session Files** list with per-file **Presentation** label, ⋯ menu, and **Comments (n)** / **History (n)** expanders.
- **Comments** (img 11): threaded comment box (*"Enter your comment" → Add Comment*), author + timestamp + Admin badge. **No email sent on comment** (caption step 11) — team must email speakers manually.
- **History / versions** (img 12): "Hide History (n)" reveals prior versions (v2, v1) each with upload timestamp; latest labeled "Latest Version (v3)".

**Expose Files column** (img 13–15): Sessions → Submissions → **Show/Hide Fields** → modal (Session Fields / Reporting Fields tabs; All Fields / Global / Event scope filters), search "Files", check **Files** (Text) → **Update View**. Column then shows **"1 Attached"** or **"-"** (img 15); remember to **Save** the view.

**Bulk download** — two paths:
1. **Sessions/Submissions module** (img 16–17): select rows → **Download Files** in the action bar. Recommend Show: 100 for max per pass.
2. **Content → Files module** (img 18, 20; sub-nav Remix·Documents·**Files**·Fields·Tags): *"Manage files attached to sessions in your agenda"* — columns Name (type+size)·Session·Uploaded At·Uploaded By·Comments·Last Comment At·Actions; select → **Download Files** ("N Selected", Clear selected).
- Downloading (either path) opens a **"group files by"** pop-up to organize the export into folders (caption step 19). An email is sent when the export is ready (caption step 20).

> Note: "Portals → Files" (img 09) is a *different* surface — portal shared resources (*"Manage files that can be shared to your portals"*, e.g. Agenda/Hotel Map, with **Add File**). Session-upload files live under **Content → Files**.

---

## 2. Corrections & new facts vs our docs

| # | Our docs said | Authoritative walkthrough shows | Impact |
|---|---|---|---|
| C1 | Template **Type** = **People / Groups / Sessions** (SCOPE §L, flow-03 §2c "Groups/Contacts/Sessions"; task brief "People/Groups/Sessions") | Actual dropdown labels are **Contacts / Exhibitors/Sponsors / Sessions** (img 08). Voiceover still *says* "People/Groups/Sessions" — same semantics, different UI text (People≈Contacts, Groups≈Exhibitors/Sponsors). | Use the real labels in our clone's template editor. |
| C2 | Email Templates page is a **table** with columns **Name · Subject · Category · Type · Trigger** and tabs All / Lifecycle (4) / Custom (0) (SCOPE Appendix B) | Guidde shows a **card layout**: "Custom Templates" (with + Add, empty state) + "Standard Templates" (Accept/Decline/Reminder cards). No Category/Trigger columns, no Lifecycle/Custom tab counts. | SCOPE's table is from the newer video-walkthrough UI; the Guidde tutorial shows an older/simpler UI. Both are real Sessionboard states — don't treat the column set as canonical. |
| C3 | Classic template merge tags use **`[PORTAL_LINK]`** bracket tokens (flow-03 §4, gap #1) | Standard Accept template uses **triple-brace** tokens: `{{{recipient.first_name}}}`, `{{{title}}}`, `{{{event.name}}}`, `{{{starts_at}}}`, `{{{ends_at}}}`, `{{{location}}}` (img 05, send-modal img 09) — same syntax family as Email Themes. | Adopt `{{{dotted.path}}}` Handlebars-style tokens for our templates, not `[BRACKET]`. |
| C4 | Accept/decline "send flow" recipient options unspecified beyond "recipient type dropdown … or select individual contacts" | Exact receiver list (img 05): **Everyone / Session Participants / Session Speakers / Session Chairpersons / Session Moderators / Session Submitters / Select Individual Contacts**; plus an **Include additional contacts** dropdown with 3 modes (CC copies / only additional / none) (img 06). Wizard is 3 steps: Setup → **per-recipient Review preview** → **Send N emails** confirm. | Our accept/decline send UI should mirror this recipient taxonomy and the preview-then-confirm gate. |
| C5 | 100/batch cap noted as a tension vs Campaigns (flow-03 gap #8) | Confirmed on-screen: pagination "Show: 100" is the recommended workaround because manual sends are capped per batch (caption step 3). Not a soft suggestion — it's the operational limit. | Keep our optional "accept+send+finalize" but design for ≤100 recipients per send. |
| C6 | Sender identity ambiguous: `no-reply@sessionboard.com` vs `no-reply@notify.sessionboard.com` (flow-03 gap #2) | The send modal's **Replies sent to** field pre-fills **`no-reply@sessionboard.com`** (img 07); History "Sent By" = **System**. | Display default resolved to `no-reply@sessionboard.com`; SMTP-envelope subdomain still unconfirmed. |
| C7 | File size limit stated as "1.95 GB" (SCOPE / task brief) | Confirmed verbatim: banner *"The maximum permitted file size is 1.95 GB"* (img 03–04). Note the admin sets a **custom** Min/Max (this event = 1 GB), and the portal upload zone echoes that custom cap ("between 0 gb and 1 gb"), not the platform 1.95 GB ceiling. | 1.95 GB is the hard ceiling; per-event max is admin-set. |
| C8 | Bulk download "group-by folders" (task brief) | Confirmed the option exists (caption step 19, "group files by") and export is async (email when ready, step 20). **Not visually confirmed** — the grouping choices (by session/speaker/track?) aren't shown in any frame. | Build a group-by-folder option on our download; exact groupings TBD. |
| C9 | (new) | Uploaded session files surface in **two** admin places: per-session **Files tab** AND the **Content → Files** module ("Manage files attached to sessions in your agenda") — the latter is the cross-session file inventory with Session/Uploaded By/Comment columns (img 18–20). | Our data model needs a global session-files view, not just per-session. |
| C10 | (new) | File **comments send no email**; **version History** keeps every re-upload (v1…vN, "Latest Version") (img 11–12, caption step 11–12). | Match: comments silent, versioned uploads retained. |

---

## 3. Confidence grade per screen + residual unknowns

| Screen | Confidence | Basis |
|---|---|---|
| Email Templates editor (fields, Type, toolbar, merge-tag format) | **High** | Every field shown individually (img 05–15). |
| Email Templates landing layout | **High** | Cards clearly shown (img 03–04, 16); reconciled with SCOPE's differing table view. |
| Sending emails wizard (recipients, additional-contacts, reply/CC/BCC, review, send, history) | **High** | Full 3-step flow captured end-to-end (img 03–12). |
| Event Details settings | **High** | All fields + image dims + Save shown (img 03–15). |
| Session Files settings + portal upload + admin views + versions/comments + Files column + bulk download | **High** | Settings, both upload sides, comments, history, column exposure, and both bulk-download paths all shown (img 02–20). |

**Residual unknowns:**
1. **Merge-tag picker contents per Type** — confirmed they differ, but the actual token lists for Contacts / Exhibitors-Sponsors / Sessions were never opened on-screen.
2. **CC/BCC "limit 5"** — from caption/KB only; not visibly enforced in any frame (template or send modal).
3. **"Group files by" options** — the folder-grouping dropdown (by session/speaker/track/etc.) is described but never shown; exact choices unknown.
4. **Standard template full roster** — Accept, Decline, and the two Session-Form reminders are confirmed; whether more standard templates exist below the fold is unverified.
5. **Event Type dropdown option list** — only "Conference" (the selected value) is visible; other options unseen.
6. **Record Settings / Portals / Integrations sub-pages** — visible in the settings nav but out of scope for these four walkthroughs (Record Settings detail lives in flow-08 §2a from KB, not verified here).
7. **SMTP envelope sender** (`notify.` subdomain) still unconfirmed (C6).
