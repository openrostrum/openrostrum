# Verification A — Submission Form Builder & Create-Contact

**Status:** VERIFIED against authoritative visual evidence (official Guidde step-by-step walkthrough screenshots) + the live public form schema.

**Evidence base:**
- `docs/reference/guidde/01-form-builder/01.jpg … 37.jpg` (37 screenshots, all read)
- `docs/reference/guidde/02-create-contact/01.jpg … 12.jpg` (12 screenshots, all read)
- `docs/reference/guidde/ALL-CAPTIONS.md` — sections "01-form-builder" (37 steps) and "02-create-contact" (12 steps)
- `docs/reference/public-form-definition.json` — the LIVE rendered form schema (event "AI.Engineer Sandbox Event"; the screenshots are from a separate demo event "Sessionboard Conference", so field *values* differ but the UI structure is identical)

> ⚠️ **SUPERSEDED STRUCTURAL CLAIM — do not build from this headline.** The 4-page-wizard finding below describes Sessionboard's *newest* UI generation; the authoritative build target is the **7-step builder** per `SCOPE.md` P0 #1 and [`VERSION-NOTE.md`](VERSION-NOTE.md). The **field-level inventories** in this doc remain valid and are why it's kept.

~~**Headline result:** The builder in THIS generation is a **4-page wizard**, not 6–7.~~ (Superseded — see banner above.) The pages observed in the newest UI were Welcome Screen → Session Information → Speaker Information → Form Settings, with notifications inside Form Settings.

---

## 1. Screen-by-screen confirmed inventory

### 1.0 Wizard chrome (constant across all 4 pages)
Seen on every builder screen (`01-form-builder/06.jpg`–`37.jpg`):
- Modal titled **"Edit Session Form"** with an **✕** close button (top-right).
- A 4-node horizontal stepper with connector line: **Welcome Screen · Session Information · Speaker Information · Form Settings**. Completed nodes show a filled check; the active node/label is blue. (`06.jpg` active=Welcome; `09.jpg` active=Session Information; `19.jpg` active=Speaker Information; `26.jpg` active=Form Settings.)
- Footer buttons: **Back** (except page 1) + an orange primary button that names the next page — **"Next: Session Information"** (`06.jpg`), **"Next: Speaker Information"** (`09.jpg`), **"Next: Form Settings"** (`19.jpg`), and **"Save"** on the last page (`26.jpg`, `34.jpg`).
- **Confidence: High.** The 4-step rail is legible and identical in all shots.

### 1.1 Entry points & Forms list

**Entry point A — Dashboard** (`01-form-builder/02.jpg`): Speakers/Exhibitors/Sponsors dashboard tabs; a **"Session Submission Form"** panel with a blue **"+ Manage Forms"** button; below it a scrollable list of forms each showing "N submission / N drafts", a green **OPEN** badge, and an orange **Open** button. Right rail stat tiles: Session Submission count, Accepted Speakers (35), Accepted Sessions (8), Pending Sessions (1), Declined Sessions (2).

**Entry point B — Sessions → Submissions → Forms** (`03.jpg`): left nav **Sessions ▸ Submissions**; breadcrumb-style tabs **Submissions / Submissions / Forms** (Forms active). Header **"Session Submission Forms"** with subtitle "Create session submission forms to collect session and speaker information for your event". A search box "Search forms…", a blue **"+ Create Submission Form"** button (`04.jpg`), tabs **All Forms (2) · Open (2) · Closed (0)**, and **"Sort by: Most Pending ▾"**. Form rows: numbered badge, name (e.g. "Session Submission Form"), **OPEN** badge, "N submission · Created on: <date>", and a **⋯** menu.

**Per-form ⋯ menu** (`05.jpg` + `36.jpg`): **Open · Edit · View Results · View Draft Submissions · Duplicate · Delete**. (Note: label is **"View Results"**, and **"View Draft Submissions"** — not "View Submissions".)

- **Confidence: High.** **Residual unknown:** the "max 20 forms" cap (caption text) is not visible in any screenshot; the list here shows only 2 forms.

### 1.2 Page 1 — Welcome Screen (`06.jpg`, `07.jpg`, `08.jpg`, `09.jpg`)
Heading **"Welcome Screen"**, subtitle "The first screen a user will see before submitting their session."
- **Internal Form Name** — text input (value "Session Submission Form"). Internal-only. (`06.jpg`)
- **External Form Title** — text input (value "Welcome to our event!"). Submitter-facing. (`07.jpg`)
- **Page Heading** — text input with inline label **"(15 char max)"** (value "Welcome"). (`08.jpg`)
- **Welcome Message** — rich-text editor with a **"✕ Remove welcome message"** action and a **live word counter** ("167 words"). Toolbar (left→right): **B, I, U, x² (superscript), x₂ (subscript), link, ƒx (formula/equation), bulleted list, numbered list, outdent, indent, image, clear-formatting, `<>` (source/HTML), `{;}` (merge tags)**. (`09.jpg`)
- **Confidence: High.**

### 1.3 Page 2 — Session Information (`10.jpg`–`18.jpg`)
Heading **"Session Information"**, subtitle "Collect information about the submitted session."
- **Section Title** — text input (value "Tell us about your session"). Shown at top of the page to submitters. (`10.jpg`)
- **Page Heading (15 char max)** — text input (value "Session Data"). (`11.jpg`)
- **Description & Instructions** — plain multi-line textarea (value "What do you want to present? Fill out the following information to tell us more."). (`12.jpg`) *(Note: on the builder pages this is a plain textarea, not rich text.)*
- **Form Questions** table with column headers **QUESTION LABEL · SET AS REQUIRED · ACTIONS** (`13.jpg`).
  - **Title** — locked row: shows **"+ Add help text"** link and a green ✓ in the required column; **no toggle, no ⋯** (cannot be removed / always required). (`13.jpg`)
  - **Description** — locked row: same "+ Add help text" + green ✓; no toggle. (`13.jpg`)
  - **Format, Tags, Track, Level** (and Language, per JSON) — each is a draggable row (⋮⋮ handle) with a **Required toggle** (all shown OFF/grey here) and a **⋯** menu. (`13.jpg`, `14.jpg`, `17.jpg`)
  - **"⊕ Add Question"** button at the bottom of the list. (`14.jpg`)
- **Inline "+" layout inserter** — hovering between two rows reveals a blue horizontal line with a **+**; clicking it opens a small popover with three icons: **H1** (Section Header), **T̲T̲ / Tt** (Rich Text box), **—** (Divider). (`25.jpg` shows this popover on the Speaker page; same control on `13.jpg`/`14.jpg`.)
- **Confidence: High.**

**"Add Question" → Select fields dialog** (`15.jpg`): modal **"Select fields"** with:
- A **"Filter fields…"** search box.
- **Select All · Remove All** links.
- Three scope tabs: **All Fields · 🌐 Global · 🗓 Event**.
- Left list of available fields, each a checkbox + name + **type sub-label** + a scope icon (globe=global, calendar=event). Visible examples: **Capacity (Number), Display Session (Checkbox), Ends At (Datetime), Evaluator Feedback (Textarea), Format (Dropdown, checked), Format Pt. 2 (Dropdown), Global Field (Text)**.
- Right **"Selected Fields"** panel with a **Remove All** link; rows: **Title** and **Description** show a red ✓ and *no* remove ✕ / drag handle (locked); **Format, Tags, Track, Level, Language** are draggable (⋮⋮) with a ✓ and an ✕ to remove.
- Footer: **Cancel · Done** (Done is the orange primary), and a **"⊕ Create New Field"** button (bottom-right).
- **Confidence: High.**

**"Create New Field" → Add Field dialog** (`16.jpg`): modal **"Add Field"** with:
- **Field Name \*** (required text).
- **Field Type \*** — dropdown, default value **"Text"** (options not expanded in shot).
- **Field Description** — textarea with an ⓘ info icon, placeholder "Description of field…" (internal use).
- **Maximum Length** — text input, placeholder **"Default character limit: 255"**.
- **Field Level** — dropdown, default **"🗓 Event Field"** (the other level being Global, per the Select-fields scope tabs).
- Footer: **Save** (disabled until valid) · **Cancel**.
- **Confidence: High.** **Residual unknown:** the full Field Type option list is never expanded on screen.

**Field row ⋯ menu** (`18.jpg`): **Customize question · Use question rules · Edit field · Remove from form**.
- *Customize question* = per-form label / help text / required (matches "+ Add help text").
- *Use question rules* = conditional logic (show/hide).
- *Edit field* = edit the shared field definition.
- *Remove from form* = removes from this form without deleting the field.
- **Confidence: High.** **Residual unknown:** the question-rules editor UI itself is NOT shown in these 37 screenshots (only the menu entry).

### 1.4 Page 3 — "Speaker Information" tab = "Contact Information" page (`19.jpg`–`25.jpg`)
IMPORTANT label mismatch: the **stepper node says "Speaker Information"** but the **page H1 is "Contact Information"**, subtitle **"Collect information for the account's primary contact / login user."** (`19.jpg`)
- **Section Title** — "Tell us about you". (`19.jpg`)
- **Page Heading (15 char max)** — "Speaker Info". (`20.jpg`)
- **Description & Instructions** — textarea "Give us information about yourself and your credentials for presenting at our event." (`21.jpg`)
- **Unique Contact Settings** — a titled block with exactly **two toggles** (`22.jpg`, `23.jpg`):
  1. **"Allow users to submit new information for existing contacts"** — toggle **OFF** by default. Help: "If enabled, users will be able to submit new information for existing contacts. If disabled, existing contacts will need to login to the portal to submit any additional information you want to collect." (maps to JSON `enable_unique_contact_edit: false`)
  2. **"Notify existing contacts that they have been added to a submission"** — toggle **ON** (green) by default. Help: "If enabled, existing contacts will receive an email notification to login to the portal to view and update their information. If disabled, existing contacts will not receive any notification upon submission." (maps to JSON `enable_unique_contact_notifications: true`)
- **Form Questions** (same table format). Locked rows (green ✓ + "+ Add help text", no toggle): **First Name** (`22.jpg`), **Email** (`24.jpg`) — and **Last Name** per caption/JSON (locked, between them). Additional draggable rows with Required toggles + ⋯ (`24.jpg`): **Biography (OFF), Headshot (OFF), Company Name (ON), Job Title (ON), Mobile Phone (ON), Home Phone (ON)**. **"⊕ Add Question"** at bottom.
- Same **inline "+" layout inserter** (H1 / Tt / —) between participant rows. (`25.jpg`)
- **Confidence: High** for structure. **Note:** field values differ from the live JSON (JSON's participant fields are First/Last/Email/Mobile Phone/Biography, all required; screenshots are the demo default set). The **is-speaker checkbox** "This person is a speaker / presenter" exists in the JSON participant section but is not visibly called out in the builder screenshots (**Med** confidence it renders as a form-question row).
- **No participant role min/max panel is visible on this page in these screenshots** (**Med/Low** — it may be off-screen; the JSON carries `allowed_role_ids`/`role_limits` = Speaker min 2 / max 4). **Residual unknown:** where role enablement + min/max + totals + conditional participant-limit rules are configured in THIS UI (not shown).

### 1.5 Page 4 — Form Settings (`26.jpg`–`34.jpg`)
Heading **"Form Settings"**. Contents top→bottom:
- **Close Date** — subtitle "If set, form and submissions will close after specified date"; a datetime input with a 📅 calendar picker; format hint **"MM/DD/YYYY @ hh:mm a"** (example value `09/22/2028 @ 03:31 pm`). (`26.jpg`, `27.jpg`)
- **Send Reminder Email** — toggle (OFF by default). Help: "Send an email reminder to submitters who have saved a draft but not completed the form five days and one day before the close date." (`27.jpg`, `28.jpg`)
- **"What admins should be notified when a new session is submitted?"** — a **"Select users… ▾"** multi-select dropdown. (`28.jpg`, `29.jpg`)
- **"What admins should be notified when an existing session is updated?"** — a second **"Select users… ▾"** dropdown. (`29.jpg`)
- **Set Speaker Limit** — a **stepper** (**−** / numeric value **6** / **+**). Help under it: "A link to the speaker portal will automatically be included in the email." **No max-15 cap is shown in this UI** (default value shown is 6, not 15). (`29.jpg`, `30.jpg`)
- **Set Submission Limit** — a **toggle (ON, green)** + stepper (value **1**). Help: "Limit the number of sessions one user can submit to this event. This must be within the event limit (if one is set)." (`30.jpg`)
- **"Customize the confirmation email message submittors receive when they submit a new session:"** — rich-text editor (full toolbar B I U x² x₂ link, lists, indent, image, clear, `<>`, `{;}`). Subtitle "A link to the speaker portal will automatically be included in the email." Default body: "Thank you for submitting your session. We will be in touch regarding its status soon. To access your speaker portal, click the button below to log in with your email address. If you already have a Sessionboard password, use it to sign in. Otherwise, you'll be prompted to set one. Or, if your organization uses Single Sign-On (SSO), you can sign in with those credentials." (`30.jpg`, `31.jpg`)
- **Automatically redirect to the user's portal after 10 seconds** — toggle (ON, green). Help: "If enabled, we will automatically redirect the user from the confirmation page to the user's portal after 10 seconds. If disabled, they will need to click the 'Continue to portal' button." (`32.jpg`)
- **"Customize the success page message:"** — rich-text editor. Default body: "**Thank you for submitting to present at our event!** You will receive a confirmation email shortly with a link to your speaker portal. We will review sessions over the next few weeks and then notify you regarding your status. Next, you will be logged into your speaker portal where you can see if there are any tasks to complete. If you would like to submit another session, please [click here](link) to return to the submission form." (`32.jpg`, `33.jpg`) — matches JSON `success_confirmation_message`.
- Footer **Save** (orange). (`34.jpg`)
- **Confidence: High.**

**After Save** (`35.jpg`, `36.jpg`): returns to the Forms list; the ⋯ menu (Open/Edit/View Results/View Draft Submissions/Duplicate/Delete) is used to **Open** the form in a new tab to preview. (`37.jpg` is the closing "presented by" slide — blank blue, no content.)

### 1.6 Create-A-Contact flow (`02-create-contact/01.jpg`–`12.jpg`)

**Contacts module** (`02.jpg`): left sub-nav under **Contacts**: **All Contacts, Speakers, Chairpersons, Moderators, Session Submitters, Additional Contacts**. Header "Contacts — Manage contacts associated with your event, including speakers, chairpersons, moderators, and exhibitor/sponsor primary contacts." Table/Grid toggle; a saved-view panel (Dashboard VIEWS ▾, Edit View, Show/Hide Fields, Filters/Add Filter, Sort By/Add Sort By); search "Search by name or email…"; **Options ▾**; an orange **"+ Add"** button; "Show All (74)" with a checkbox+pencil per row; pagination "Show: 100 ▾". Speakers sub-view (`03.jpg`) adds status tabs **All Speakers (41) · Primary Speakers (0) · Session – Accepted (35) · Session – Pending (3) · Session – Declined (17)** and columns Full Name / Airline / Payment Amount / Payment Confirmation.

**"Add People To Event" modal** (`04.jpg`, `05.jpg`, `06.jpg`): a **"Search by email or name…"** field; an ⓘ note "To avoid creating duplicates, always edit or use your existing contact before creating new ones." with an **"Add new contact"** button; when a query matches, "N contact(s) in organization" and a result list — each row a checkbox + avatar + name + email + an external-link ↗ icon; footer **Cancel · Add To Event** (orange). Checking a match + **Add To Event** adds an existing org contact to the event (`05.jpg`).

**"Add People to Organization" modal** (`07.jpg`) = the "Add new contact" form. Fields visible: **Email \*** (e.g. jan@sessionboard.com), **First Name \*** (Jan), **Last Name \*** (Doe), **Mobile Phone** (country-flag selector + "+1"), **Headshot** (file drop zone "Add files to this submission"); footer **Save** (orange) · **Cancel** · a **⚙ gear** icon (field/layout settings). More fields exist below the fold (scrollbar present). Required markers: Email, First Name, Last Name (red \*).

**Edit which fields show in the Add-Contact form** (`08.jpg`): **Settings → Record Settings → Layouts** tab → sub-tabs **Contact Fields / Group Fields** → a **"Show/Hide Fields"** button. Table columns **Name · Category · Type · Level**. Visible rows: Email (Communication/Email/Global), First Name (Profile/Text/Global), Last Name (Profile/Text/Global), Mobile Phone (Communication/Phone/Global), Headshot (Profile/File/Global), Biography (Profile/Wysiwyg/Global), Home Phone (Communication/Phone/Global). Caption states the default Add-Contact fields are **Email, First Name, Last Name, Phone, Headshot, Biography, Home Phone & Zip**.

**Edit a contact** (`09.jpg`): search a contact, click the **pencil** icon left of the row.

**Assign contact to a session** (`10.jpg`): a session detail view (SESS-1 "Lunch") with tabs **Details · Participants · Files · Subsessions**. **Participants → Session Participants** has role dropdowns: **Speakers** ("Select one or more speakers…", with **Bulk edit** and **Manage your speakers** links), plus additional speaker/participant dropdowns and a **"Select one Session Submitter…"** dropdown; a **Sponsors & Exhibitors** accordion below. Save button.

**Closing** (`11.jpg` dashboard, `12.jpg` blank blue "presented by").
- **Confidence: High** for all create-contact screens.

---

## 2. CORRECTIONS & NEW FACTS (vs. current `01-form-builder.md` and `SCOPE.md`)

**Resolved definitively — the builder in this generation is 4 pages:**

1. **PAGE COUNT = 4, not 6–7.** Names, in order: **Welcome Screen · Session Information · Speaker Information · Form Settings** (`06.jpg` stepper; confirmed on every page). SCOPE §"the wizard, 6 working steps" and flow-doc §2.1's 7-step list are both wrong for this UI.

2. **NO "Submission Setup" step and NO Abstract-vs-Session picker** appear in this wizard. The whole "Abstracts vs Sessions" first step + "Participants on/off toggle" (SCOPE steps 1 & the "Abstract Information" naming) is not present. This form calls page 2 **"Session Information"** (JSON section title "Tell us about your submission"), not "Abstract Information".

3. **NO Payments & Fees step — in any form.** Confirmed three ways: (a) not in the 4-node stepper; (b) not in any of the 37 screenshots; (c) the live schema sets **`"cfp_payment_step_in_wizard": false`**. The Payments step in flow-doc §2.7 and SCOPE step 5 does not exist in this generation. (SCOPE already flags Payments as "NOT NEEDED" — the walkthrough confirms it's absent from the product UI itself.)

4. **NO separate "Notifications" step.** The two admin-notify dropdowns — **"What admins should be notified when a new session is submitted?"** and **"…when an existing session is updated?"** — live **inside Form Settings** (`28.jpg`/`29.jpg`), not on their own page. The 3-template Notifications step described in flow-doc §2.9 / SCOPE step 7 collapses into: the two admin dropdowns + the single **confirmation-email rich-text editor**, all on the Form Settings page.

5. **Page-3 label vs heading mismatch (NEW):** stepper node = **"Speaker Information"**, but the page title = **"Contact Information"** with subtitle "Collect information for the account's primary contact / login user." (`19.jpg`) Our docs call it "Participant Information" — the UI uses both "Speaker Information" (nav) and "Contact Information" (H1).

6. **Speaker limit cap is NOT 15 in this UI.** "Set Speaker Limit" is a plain −/value/+ stepper defaulting to **6**, with helper text "A link to the speaker portal will automatically be included in the email." No "max 15 / admins can exceed from the back end" copy is visible (`29.jpg`, `30.jpg`). Treat the "≤15" figure (from the legacy video/KB) as **unconfirmed in the current generation**.

7. **The two "existing contact" toggles are confirmed and named** (`22.jpg`, `23.jpg`), with exact copy and defaults: **"Allow users to submit new information for existing contacts"** (default OFF) and **"Notify existing contacts that they have been added to a submission"** (default ON). They sit under a **"Unique Contact Settings"** header on the Speaker Information page.

8. **Field-creation dialog confirmed ("Add Field", `16.jpg`):** Field Name\*, Field Type\* (default "Text"), Field Description (ⓘ), Maximum Length ("Default character limit: 255"), Field Level ("Event Field" / Global), Save/Cancel. The **type options (dropdown/checkbox/textbox) are NOT enumerated on screen** — Field Type is a collapsed dropdown. Our docs' "specify field type — dropdown, checkbox, or text box" comes from the caption, not the visible UI.

9. **"Add Question" opens a two-pane "Select fields" reuse dialog** (`15.jpg`) with **All Fields / Global / Event** scope tabs, filter search, Select All/Remove All, a checkbox list with per-field type + scope icons, a "Selected Fields" panel (locked Title/Description with red ✓; draggable others), Cancel/**Done**, and **⊕ Create New Field**. This is more concrete than flow-doc's "+ Add Field → three choices" description.

10. **Field row ⋯ menu = exactly 4 items** (`18.jpg`): **Customize question · Use question rules · Edit field · Remove from form**. (Confirms "question rules" exist as a per-field action; the rules *editor* is not shown.)

11. **Success/confirmation config confirmed** (all in Form Settings): auto-redirect toggle "**after 10 seconds**" (default ON), a customizable **success page** rich-text message, AND a separate customizable **confirmation email** rich-text message, plus the reminder-email toggle ("five days and one day before the close date"). Matches JSON `enable_auto_redirect: true` and `success_confirmation_message`.

12. **Per-form ⋯ menu on the Forms list = Open · Edit · View Results · View Draft Submissions · Duplicate · Delete** (`05.jpg`) — note **"View Results"** (not "View Submissions") and **"View Draft Submissions"**.

13. **Welcome Message toolbar includes a `{;}` merge-tags control and a `ƒx` formula/equation button** (`09.jpg`) — richer than documented; also a live **word** counter (not char).

14. **Session-page Description & Instructions is a plain textarea** in the builder (`12.jpg`), even though session Description-the-field is WYSIWYG. Don't conflate the two.

15. **Create-contact "Add new contact" modal is titled "Add People to Organization"** (`07.jpg`) and is reached via **"Add People To Event" → Add new contact** (`04.jpg`/`06.jpg`). The default field set (Email\*, First\*, Last\*, Mobile Phone, Headshot, + Biography/Home Phone/Zip below fold) and the layout editor at **Settings → Record Settings → Layouts → Contact Fields → Show/Hide Fields** (`08.jpg`) are confirmed.

**Consistent with our docs (no change needed):** 15-char page-heading cap on every page; Title + Description locked/required on session page; First/Last/Email locked on participant page; submission-limit-within-event-limit; two entry points (Dashboard "Manage Forms" + Sessions→Submissions→Forms); success-page "Continue to portal" fallback; core roles = Speaker/Chairperson/Moderator (JSON `session_roles`).

---

## 3. Confidence grades & residual unknowns

| Screen / fact | Confidence | Notes |
|---|---|---|
| 4-page wizard + page names | **High** | Stepper legible in every builder shot; corroborated by JSON `cfp_payment_step_in_wizard:false`. |
| No Payments / no Submission-Setup / no separate Notifications step | **High** | Absent from stepper + all 37 shots + JSON flag. |
| Welcome / Session Info / Form Settings field inventories | **High** | Each field individually captured. |
| Speaker Information ("Contact Information") fields + 2 unique-contact toggles | **High** | Toggles + copy fully legible. |
| "Add Field" + "Select fields" + ⋯-menu dialogs | **High** | Fully captured. |
| Speaker limit has no 15-cap in UI | **High** | Stepper default 6, no cap copy. |
| Per-form ⋯ menu items | **High** | `05.jpg`/`36.jpg`. |
| Participant role min/max + totals + conditional participant-limit UI | **Low/Med** | JSON proves roles+limits exist (Speaker min2/max4), but the role-config panel is **not visible** on the participant page screenshots. |
| Question-rules editor UI | **Med** | Menu entry seen; editor screen never shown. |
| "is-speaker" checkbox as a rendered row | **Med** | In JSON; not clearly isolated in a screenshot. |
| Create-contact screens | **High** | All 12 legible (10–12 include a blank closing slide). |

**Still unknown after this evidence:**
- The **question-rules (conditional logic) editor** layout — operators, trigger-type restrictions, AND/OR — is not shown.
- **Where participant role enablement / min-max / totals / conditional participant-limit rules** are configured in this 4-page UI (data exists in JSON; UI panel not captured).
- The **full Field Type option list** in "Add Field" (dropdown never expanded).
- **Sub-session / parent-session toggles**: JSON has them all OFF/false; not visible in the wizard, so their UI location is unconfirmed.
- **Cross-field character-limit rules** UI (documented but not in any screenshot).
- **Max-forms cap** (20 per caption) — not visible.
- `37.jpg` and `02-create-contact/12.jpg` are blank "presented by" outro slides (no data).

---

## 5-line summary
- **Definitive page count: the builder is a 4-page wizard — Welcome Screen → Session Information → Speaker Information → Form Settings** (`01-form-builder/06.jpg`), NOT 6–7.
- **Top correction 1:** There is **no Payments & Fees step and no Submission-Setup/Abstract-vs-Session step** in this generation — confirmed by the stepper, the screenshots, and JSON `cfp_payment_step_in_wizard:false`.
- **Top correction 2:** There is **no separate Notifications step**; the two admin-notify dropdowns + the confirmation-email editor + reminder toggle all live inside **Form Settings** (`28–31.jpg`).
- **Top correction 3:** Page 3's stepper says "Speaker Information" but the page H1 is **"Contact Information"**; **Speaker Limit is a plain stepper (default 6) with no 15-cap** in the UI; the two "existing contact" toggles are "Allow users to submit new information for existing contacts" (OFF) and "Notify existing contacts…" (ON).
- **Still unknown:** the question-rules editor UI, and where participant role min/max + conditional participant-limit rules are configured in this 4-page layout (the data exists in the JSON — Speaker min 2/max 4 — but the config panel isn't in the screenshots).
