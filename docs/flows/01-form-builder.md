# Flow 01 — Submission Form Builder

Sources: learn.sessionboard.com knowledge base, fetched 2026-08-08 (all pages returned HTTP 200, server-rendered HTML — no JS-only pages, no login used). Two doc generations coexist and describe the same feature at different product versions:

- **Sessions 2.0 builder (current):** https://learn.sessionboard.com/applications/building-your-submission-form — 7-step wizard, Abstract-vs-Session, custom roles, payments.
- **Legacy builder (1.0):** https://learn.sessionboard.com/sessions/submission-forms — 4-section editor. Matches the older tutorial video https://learn.sessionboard.com/videos/video-session-submission-form (embedded Guidde player: `https://embed.app.guidde.com/playbooks/mSrgwf2XuNfULw3SX8Aiqa`).

The 2.0 page is the one to clone (it matches the demo video in `00-demo-walkthrough.md`); 1.0 facts are kept where they fill gaps (reminder emails, form actions, layout tools' char limits).

---

## 1. Purpose & actors

The submission form is "the first point of contact between submitters/speakers and Sessionboard. It gathers session and speaker information and creates records admins can work with" (https://learn.sessionboard.com/sessions/submission-forms). **Admins** build up to 20 forms per event in a step-wizard (7 steps in 2.0), then share each form's unique public URL; **submitters** (public users, account required at submit time) fill the multi-page form, optionally pay a fee, and become Contacts attached to a Session/Abstract record; **participants** (speakers/chairpersons/moderators) are the people the submitter names on the participant page (https://learn.sessionboard.com/applications/building-your-submission-form, https://learn.sessionboard.com/concepts/participant-roles).

## 2. Flows

### 2.1 Admin creates a form (Sessions 2.0 wizard)

Source: https://learn.sessionboard.com/applications/building-your-submission-form (all steps below).

1. Admin navigates **Program → Forms**, clicks **Add → Create Form**. Builder opens on **Submission Setup**. (Legacy path: Sessions module → Forms; a default form ships with every event and is edited via ⋯ → Edit — https://learn.sessionboard.com/sessions/submission-forms. The video adds a second entry point: Dashboard → "Manage Forms" button — https://learn.sessionboard.com/videos/video-session-submission-form.)
2. **Submission Setup** — picks submission type **Abstract** or **Session**. Effect downstream: abstract submissions land under Program's **Abstracts** tab, session submissions under **Sessions**; both visible in **All Submissions**. Docs' guidance: Abstract = call-for-papers content that gets reviewed before becoming a session; Session = proposals that become sessions directly. Also here: enable which of the 3 core roles (Speaker / Chairperson / Moderator) the form uses, with min/max per role.
3. After Setup, the sidebar shows the remaining steps: **Welcome Screen, Session Information, Participant Information, Payments & Fees, Form Settings, Notifications**.
4. **Welcome Screen** — Title + rich-text Description (instructions, eligibility, deadlines). First thing submitters see.
5. **Session Information** — per-step Section Title (internal), Page Heading (submitter-facing), Description & Instructions (rich text). **Title is the only required field and is Locked (cannot be removed); Description is no longer mandatory** (1.0 had both Title and Description locked — https://learn.sessionboard.com/videos/video-session-submission-form). Each field row shows its type + constraint under the label (e.g. "Text · Max 10 chars", "Wysiwyg · Max 5,000 chars"). Admin adds fields via **+ Add Field** → three choices: *Add Section Element* (layout), *Create Field* (new), *Search existing fields* (reuse event-level fields, e.g. "Custom Track"). Per row: **Required** toggle + ⋯ menu → *Customize question* (label / placeholder / help text / required), *Edit field* (name, type, options — affects every form using the field), *Use question rules* (conditional logic). Bottom of step: sub-session toggles — "Allow submitters to select a parent session" and "Allow submitters to submit sub-sessions".
6. **Participant Information** — Section Title, Page Heading, and a **"Check participant limit"** checkbox that enforces the role min/max at submit time. Fields split into **Required** (First Name, Last Name, Email — always required, cannot be removed) and **Additional** (Mobile Phone, Biography, custom fields; each with Required toggle + ⋯ menu). Role panel: check each core role to enable, set **Min/Max per role**, plus **Total min/Total max across all roles**. Roles can carry custom labels mapped to a core type (e.g. "Author" → Speaker Min 1 Max 1, "Co-author" → Chairperson Min 0 Max 3). **Conditional participant limits**: `+ Add rule` → WHEN ALL MATCH (session field + operator + value, e.g. "Format is Workshop") THEN APPLY PER ROLE min/max overrides, optional total override; **first matching rule wins**, overrides merge onto defaults. **Unique Contact Settings**: (a) "Allow users to submit new information for existing contacts" — off means existing contacts must log into the portal to update themselves; (b) "Notify existing contacts that they have been added to a submission" — on sends them an email to review/update in the portal.
7. **Payments & Fees** ("Fees, gateway, and promo codes") — *When to Collect Payment*: **Do Not Collect Payment** or **Upon Submission** (charged when the submission completes). Gateway dropdown lists org-level gateways (shows "None" if unconfigured; "Manage Payment Settings" link; 100+ gateways, zero platform transaction fees). **Base Fee** (e.g. $50 USD) charged to everyone before rules. **Pricing Rules** (`+ Add Rule`: Field / Operator ("is", "is not", "contains") / Value / Action add-or-adjust / Amount) — e.g. different fee per format or track. **VAT Rules** (Type percentage|fixed, Amount, Label shown at checkout). **Promo Codes** (Code, Type percentage|fixed, Amount) entered by the submitter at checkout.
8. **Form Settings** ("Deadlines, limits, and success page") — two tabs; full inventory in §3.3.
9. **Notifications** — pick admin recipients for "new session submitted" and "existing session updated"; toggle + customize 3 email templates (Submission Confirmation to submitter; New Submission Alert and Submission Revision Alert to admins).
10. Admin clicks **Preview** to walk the form as a submitter (field order, conditional logic, payment steps). There is **no separate publish/open step**: "Once your form has been finalized, there's no separate 'open' step required. Simply share the submission form link" (https://learn.sessionboard.com/faq/how-do-i-share-my-submission-form). Distribution = unique direct URL per form, and/or listing on the event's Program Site.

### 2.2 Admin shares the form

Source: https://learn.sessionboard.com/faq/how-do-i-share-my-submission-form.

1. Sessions > Forms → ⋯ next to the form → **Copy Link** (opens the form in a new tab; admin copies the page URL).
2. Link is used in emails, hyperlinked buttons, or on the event site. **The form cannot be embedded in an external website — link only.**
3. **No open date exists.** The form is live as soon as the link is shared; only a **close date+time** can be set, and "Submitters will be able to submit session proposals up until that date and time."

### 2.3 What the submitter experiences

1. Opens the link → **Welcome Screen** (title + rich-text description) (https://learn.sessionboard.com/applications/building-your-submission-form).
2. Steps through pages: the **submitter contact is created on page 2** of the form; **speakers are created through page 4** (https://learn.sessionboard.com/concepts/participant-roles) — i.e. page order Welcome → submitter account/info → session info → participants.
3. While typing, sees per-field type/limit captions and, if cross-field rules exist, **a live character counter per rule**; formatting is stripped from rich text before counting, whitespace counts (https://learn.sessionboard.com/applications/building-your-submission-form).
4. Conditional questions appear only when their trigger answer matches (§4 Q1).
5. If payments are on: pays base fee ± pricing rules ± VAT, may enter promo code at checkout.
6. On success: sees the customizable **success page**; if "Automatically redirect to the user's portal after 10 seconds" is ON they are auto-redirected, if OFF they get a **"Continue to portal"** button. The Submission Confirmation email is sent if enabled (https://learn.sessionboard.com/applications/building-your-submission-form).
7. **Repeat submissions:** allowed by default — submitter revisits the same link; admins can include a "submit another" link on the success page. Caveat in docs: "Submitting more than once creates duplicate contacts when the same speakers appear on each submission" — Sessionboard recommends a post-close dedupe audit. Cap it with **Set Submission Limit** in Form Settings (https://learn.sessionboard.com/faq/can-end-users-submit-more-than-one-submission).

### 2.4 Cause → effect of each setting (downstream behavior)

| Setting | When it triggers | Observable effect |
|---|---|---|
| Submission type = Abstract/Session | at creation | Records labeled + filed under Abstracts vs Sessions tab (All Submissions shows both) (applications/building-your-submission-form) |
| Close Date (date+time+timezone) | when it passes | Form "will automatically stop accepting new submissions"; legacy doc: deadline applies to **new submissions and edits** (applications/…; sessions/submission-forms). Exact closed-state UI copy is not documented (§6). |
| Reminder email (legacy, tied to close date) | 5 days and 1 day before close | Automated emails to submitters **with draft submissions in progress** (sessions/submission-forms; videos/video-session-submission-form) |
| Set Submission Limit | at submit time | Caps submissions per user for this event; "must be within the event-level limit if one is set" (applications/…) |
| Speaker limit (legacy) | at submit time | Up to 15 speakers per session via the form; "Admins can assign more than 15 speakers to a session from the back end if needed" (sessions/submission-forms; videos/…) |
| Check participant limit | at submit time | Enforces role min/max (+ totals, + conditional overrides) (applications/…) |
| Auto-redirect toggle | 10 s after success page | ON: auto-redirect to portal. OFF: "Continue to portal" button (applications/…) |
| Unique-contact toggle (a) | participant email matches existing contact | ON: submitter may overwrite contact data. OFF: contact must self-update via portal (applications/…) |
| Unique-contact toggle (b) | existing contact added to a submission | ON: contact emailed to review/update. OFF: silent (applications/…) |
| Submitter Requirements (Membership & Access) | form access | Only users matching Organization Settings → Membership criteria can access the form (applications/…) |
| Participant Validation | at submit time | Participant data POSTed to a configured Validation URL; JSON request/response config decides acceptance (applications/…) |
| Question rule on a field | while filling | Field hidden until trigger condition met, then becomes visible (applications/…) |
| Cross-field character limit rule | while filling | Live counter; error (default or custom message naming the rule) when combined count exceeded (applications/…) |
| Editing a field definition | anytime | "Editing a field affects all forms that use it" (sessions/submission-forms) |
| Deleting a form | anytime | Permanent (sessions/submission-forms) |
| Remove field from form | anytime | Removes from this form **without deleting the field** — reusable later (videos/…) |

### 2.5 Admin manages forms after creation

Per-form ⋯ menu: **Edit, View Submissions, View Draft Submissions, View Form, Duplicate, Delete** (https://learn.sessionboard.com/sessions/submission-forms). Field names are visible to evaluators when Evaluation Plans are used (same page).

## 3. Complete inventory

### 3.1 Field model & types

**Three storage scopes** — the scope of a field decides which form section it can appear in and which module the data lands in (https://learn.sessionboard.com/concepts/field-types):

| Scope | Used in | Data lands in |
|---|---|---|
| Session fields | Session Information step | Sessions module |
| Speaker / individual fields | Participant (Speaker) Information; intake & portal forms | Contacts module |
| Group fields | Sponsor/exhibitor intake & portal forms (not session forms) | Sponsors / Exhibitors module |

**Text limits** (https://learn.sessionboard.com/concepts/field-types, https://learn.sessionboard.com/faq/add-a-field-character-capactiy): Text = 255 chars max, Text area = 5,000 chars max; the limit is customizable within those ranges via Fields module → ⋯ Edit → **Maximum Length**. Some system fields (e.g. Address) have fixed limits.

**Field type vocabulary.** No page enumerates the create-field type dropdown exhaustively. Types explicitly named when creating: *dropdown, file, text, checkbox* (https://learn.sessionboard.com/faq/how-to-create-and-delete-custom-fields), *text box / drop-down / checkbox* (video). Types observed across the standard-field tables (https://learn.sessionboard.com/concepts/sessionboard-standard-fields): **text, textarea, wysiwyg, dropdown, checkbox, number, currency, datetime, email, phone, file, countries, languages, user**. Question rules can only *trigger from* Checkbox, Dropdown, Number fields (§4 Q1).

**Field definition attributes** (https://learn.sessionboard.com/sessions/submission-forms, /faq/how-to-create-and-delete-custom-fields, video): name; type (**immutable after save** — delete + recreate to change); description (internal-only, invisible to submitters); level = **event field** (this event only) vs **global field** (all events); options (for dropdowns); Maximum Length (text/textarea). Custom fields are managed in **Library > Fields** under 4 tabs: Contact, Group, Session, Evaluation Plan; delete via Actions column.

**Per-form field presentation** (overrides that don't touch the definition): custom label, placeholder, help text, required toggle (https://learn.sessionboard.com/applications/building-your-submission-form).

**Layout elements** (not data): Section Header (255-char limit), Divider, Rich Text box (images, hyperlinks, formatted text). 2.0: `+ Add Field → Add Section Element`; 1.0: hover between fields → blue `+` (https://learn.sessionboard.com/applications/building-your-submission-form, /sessions/submission-forms).

### 3.2 Standard fields

Source: https://learn.sessionboard.com/concepts/sessionboard-standard-fields (complete lists).

**Contact fields (39):** Address (text), Address Line 2 (text), Annual Revenue (dropdown), Audience Type (dropdown), Availability (text), Biography (wysiwyg), Brand (dropdown), City (text), Company Name (text), Country (countries), Educational Affiliation (text), Email (email), Ethnicity (dropdown), Facebook URL (text), First Name (text), Gender (dropdown), Global Region (dropdown), Headcount (dropdown), Headshot (file), Highest Level of Education (dropdown), Home Phone (phone), Honorific (text), Industry (dropdown), Job Title (text), Languages (languages), Last Name (text), LinkedIn URL (text), Mobile Phone (phone), Opt-in to receive text message updates (checkbox), Organization Contact (user), Organization Structure (dropdown), Past Companies (text), Preferred Session Format (dropdown), Pronouns (dropdown), Salutation (text), Speaker Fee (currency), Speaker Score (dropdown), State (text), Target Age Range (dropdown), Topic / Expertise (dropdown), Twitter URL (text), Website (text), Years in Operation (number), Zip (text).

**Session fields (15):** CEU Credits (number), Client Session ID (text), Description (wysiwyg), Ends At (datetime), Format (dropdown), Language (dropdown), Level (dropdown), Location (dropdown), Speakers (dropdown), Starts At (datetime), Status (dropdown), Submitter (dropdown), Tags (dropdown), Title (text), Track (dropdown).

**Group fields (18):** Address (text), Address Line 2 (text), Attachments (file), Banner Image (file), City (text), Country (countries), Description (wysiwyg), Facebook URL (text), LinkedIn URL (text), Logo (file), Name (text), Phone Number (phone), Postal Code (text), Score (dropdown), State/Region (text), Tier (dropdown), Twitter URL (text), Website (text).

### 3.3 Form settings & toggles (all documented)

**Per-form — Form Settings step, General tab** (https://learn.sessionboard.com/applications/building-your-submission-form unless noted):
- Close Date (date + time + timezone)
- Set Submission Limit (toggle + number; within event-level limit)
- Automatically redirect to the user's portal after 10 seconds (toggle)
- Customize the success page message (rich text)
- Cross-field character limits — per rule: Rule name (appears in the error), Combined character limit (positive integer), Fields in this rule (text/long text/rich text only; **all from the same step** — all session fields or all speaker fields; speaker-scope counted per speaker, session-scope once per submission), optional Custom error message. Removing a referenced field flags the rule for editing.
- Legacy General extras (https://learn.sessionboard.com/sessions/submission-forms): Reminder email (5-day + 1-day before close, to draft holders), Speaker limit (≤15), Confirmation message (email body).

**Per-form — Membership & Access tab:** Submitter Requirements (membership-criteria gate); Participant Validation (Validation URL + JSON request/response format; advanced, for external membership DBs).

**Per-form — Notifications step:** admin recipient dropdowns ×2 (new submitted / updated); Submission Confirmation (submitter, toggle + Customize); New Submission Alert (admins, toggle + Customize); Submission Revision Alert (admins, toggle + Customize).

**Per-form — other steps' toggles:** submission type; role enablement + min/max + totals; Check participant limit; conditional participant-limit rules; sub-session toggles ×2; unique-contact toggles ×2; payment collection mode; gateway; base fee; pricing/VAT/promo rules; per-field Required toggles; question rules.

**Event-wide — Settings > Submission Forms** (https://learn.sessionboard.com/settings/submission-form-settings; must be enabled by support@sessionboard.com; **applies to ALL forms in the event**):
- Appearance: Logo Image + Alt-Text; Background Image + Alt-Text; Background Color; Primary Button Color + Text Color; Secondary Button Color + Text Color.
- Typography: System Font; Form Title / Section Header / Section Description / Question Labels — each Font Size + Color.

**Documented limits:** 20 forms per event (both text pages; the legacy video says 24 — discrepancy, trust 20); Title locked; First/Last/Email locked; text 255 / textarea 5,000; section header 255; page headers 15 chars (video only); 15-speaker form cap (legacy); success-page → portal redirect 10 s.

### 3.4 Participant roles semantics

Sources: https://learn.sessionboard.com/concepts/participant-roles, https://learn.sessionboard.com/applications/building-your-submission-form.

- **Core role types are exactly three: Speaker, Chairperson, Moderator.** Custom roles are labels mapped onto one of the three (e.g. Author→Speaker, Co-author→Chairperson, or Panelist/Discussant/Presenter). The mapped category "determines representation in integrations and embeds" (https://learn.sessionboard.com/sessions/program-settings).
- Per enabled role on a form: **Min** (required count per submission) and **Max** (allowed count per submission); plus **Total min/Total max** across all roles; plus conditional overrides (first-match-wins rules keyed on session fields).
- **Session submitter** is a distinct actor, not a role slot: created on page 2 of the form, "may or may not participate in the session as a speaker", can receive emails and tasks.
- **Speaker:** presents; multiple per session; created via page 4 of the form; appears in the Speakers module; can receive email/SMS and tasks.
- **Chairperson / Moderator:** oversight/facilitation; **only event admins can assign them** (they are not created by the public form in the 1.0 model — 2.0 lets forms enable them as roles); they live in the Contacts module, **not** the Speakers module; emailed via Sessions module (Send → Send Emails → Chairperson/Moderators/Participants/Everyone) or Contacts.
- Docs caveat: "The roles below reflect general definitions… organizers may assign or interpret these roles differently."

## 4. OPEN QUESTION ANSWERS

### Q1 — Does Sessionboard offer conditional logic? YES.

Verbatim from https://learn.sessionboard.com/faq/does-sessionboard-offer-conditional-logic:

> "Yes, conditional logic (referred to as 'question rules' in Sessionboard) can be used when creating your session submission form or portal form. Question rules are not available in the sponsor or exhibitor intake forms."

Same page, the constraints (paraphrase-close): create and add all fields to the form **and save it** before applying question rules; rules are applied **on the question that is conditional** (the one that appears/hides), not on the trigger; example given — Q1 "Are you a member?", Q2 "Provide your Member ID" appears only if Q1 = "Yes".

Corroborating mechanics (https://learn.sessionboard.com/applications/building-your-submission-form and /sessions/submission-forms): rule = trigger field + operator + value; when met, the target field **becomes visible**; question rules "can be applied to fields of type: Checkbox, Dropdown, and Number". So: show-on-match only (no documented hide/skip/jump logic), single-condition rules (no documented AND/OR for question rules), and trigger fields limited to 3 types.

Note conditional logic appears in **three distinct places** in the builder, easy to conflate: (1) question rules (show/hide fields), (2) conditional participant limits (WHEN ALL MATCH → per-role min/max overrides, first-match-wins), (3) pricing rules (field match → fee adjustment).

### Q2 — "Category-based routing": what exists and what doesn't

**There is no routing of submissions at the form level.** The word "routing" appears nowhere in the 13 form-builder pages; a category/track answer on a form never redirects a submission to a different form, queue, inbox, or approver. What Sessionboard actually has:

1. **Track/Category are plain dropdown taxonomy fields.** Track is a standard single-select session field (https://learn.sessionboard.com/concepts/sessionboard-standard-fields); tracks are "broad thematic categories for filtering (e.g., 'Industry & Business')" configured in Program Settings and used for agenda filtering/card colors (https://learn.sessionboard.com/sessions/program-settings). Selecting one just stores a value.
2. **Coarse "routing" = separate forms.** Up to 20 forms per event, deliberately used to "run multiple calls in parallel, for example, one form for abstract submissions and another for invited session proposals" (https://learn.sessionboard.com/applications/building-your-submission-form) or "one form for internal speakers and another for external speakers" (video). Routing is manual: whoever gets the link.
3. **Submission type routes records to tabs.** Abstract vs Session determines whether the record files under the Abstracts or Sessions tab (https://learn.sessionboard.com/applications/building-your-submission-form).
4. **Real field-based routing lives downstream, in Evaluations.** The round-based evaluation Assignment Wizard is where submissions are routed **to evaluators** by field values — verbatim from https://learn.sessionboard.com/evaluations/setting-up-round-based-evaluations: "**By submission filters:** Narrow by standard and custom submission fields (status, format, tags, etc.). Use this to **route specific types of submissions to the most relevant evaluators**." And in its best practices: "Use field filtering for targeted assignments: Take advantage of the new field filtering in the Assignment Wizard to route specific types of submissions (by language, format, level, etc.) to the most relevant evaluators." Filterable fields include Format, Tags, Level, Language, Status, Submitter, **Track**, Location, and other dropdown-type fields; distribution modes All-to-All / Per Submission / Per Reviewer / Individual Reviewer with workload caps (reviewers per submission, max submissions per evaluator).
5. **Within-form category conditionals** (not routing, but category-driven behavior): question rules keyed on a dropdown (e.g. track) show extra fields; conditional participant limits ("Format is Workshop" → more presenters); pricing rules ("charge a different fee depending on the session format or submission track" — https://learn.sessionboard.com/applications/building-your-submission-form).

**Clone implication:** we do not need submission-time routing. We need (a) taxonomy dropdowns on the form, (b) multiple forms per event, and (c) a filter-based evaluator-assignment rule engine in the evaluations flow (see `05-evaluations`).

## 5. Screenshots

43 screenshots downloaded from the KB pages (all verified as real PNGs via `file`, 9 KB–1 MB). Stored in `img/01-form-builder/`.

**Builder wizard — from https://learn.sessionboard.com/applications/building-your-submission-form:**

| File | Caption |
|---|---|
| `img/01-form-builder/builder-01-submission-setup.png` | Submission Setup step: Abstract vs Session picker |
| `img/01-form-builder/builder-02-participant-roles-setup.png` | Role enablement + min/max in Submission Setup |
| `img/01-form-builder/builder-03-welcome-screen.png` | Welcome Screen editor (title + rich-text description) |
| `img/01-form-builder/builder-04-session-information.png` | Session Information step header config |
| `img/01-form-builder/builder-05-add-field-menu.png` | + Add Field menu: section element / create / search existing |
| `img/01-form-builder/builder-06-field-row-menu.png` | Field row ⋯ menu incl. "Use question rules" |
| `img/01-form-builder/builder-07-customize-question.png` | Customize question dialog (label, placeholder, help, required) |
| `img/01-form-builder/builder-08-layout-tools.png` | Layout elements: Section Header / Rich Text / Divider |
| `img/01-form-builder/builder-09-subsession-settings.png` | Sub-session toggles |
| `img/01-form-builder/builder-10-participant-information.png` | Participant Information step header + limit checkbox |
| `img/01-form-builder/builder-11-participant-default-fields.png` | Required vs Additional participant fields |
| `img/01-form-builder/builder-12-role-min-max-totals.png` | Role min/max + totals panel |
| `img/01-form-builder/builder-13-conditional-participant-limits.png` | Conditional participant-limit rule editor |
| `img/01-form-builder/builder-14-unique-contact-settings.png` | Unique Contact Settings toggles |
| `img/01-form-builder/builder-15-when-to-collect-payment.png` | When to Collect Payment options |
| `img/01-form-builder/builder-16-base-fee.png` | Gateway + Base Fee |
| `img/01-form-builder/builder-17-pricing-rules.png` | Pricing rule editor (field/operator/value/action/amount) |
| `img/01-form-builder/builder-18-promo-codes.png` | Promo codes editor |
| `img/01-form-builder/builder-19-form-settings-general.png` | Form Settings › General (close date, limit, redirect, success msg) |
| `img/01-form-builder/builder-20-membership-access.png` | Membership & Access tab (submitter requirements, participant validation) |
| `img/01-form-builder/builder-21-notifications.png` | Notifications step (recipients + 3 templates) |
| `img/01-form-builder/builder-22-question-rules.png` | Question-rule (conditional logic) editor |
| `img/01-form-builder/builder-23-preview-publish.png` | Preview / share |

**Conditional logic FAQ — from https://learn.sessionboard.com/faq/does-sessionboard-offer-conditional-logic:** `faq-conditional-01-question-rules-menu.png` (Use question rules menu entry), `faq-conditional-02-example.png` (member-ID conditional example).

**Field management — from https://learn.sessionboard.com/faq/add-a-field-character-capactiy:** `fields-01-module-tabs.png` (Fields module: Contact/Group/Session/Evaluation Plan tabs), `fields-02-edit-ellipsis.png`, `fields-03-maximum-length.png` (Maximum Length input), `fields-04-save-changes.png`. From https://learn.sessionboard.com/faq/how-do-i-save-a-field: `fields-05-contact-profile-save.png` (Save Changes on a profile field).

**Custom fields — from https://learn.sessionboard.com/faq/how-to-create-and-delete-custom-fields:** `customfield-01-library.png` (Library > Fields), `customfield-02-add-button.png`, `customfield-03-create-modal.png` (name + type dropdown), `customfield-04-search.png`, `customfield-05-delete.png`.

**Sharing — from https://learn.sessionboard.com/faq/how-do-i-share-my-submission-form:** `share-01-copy-link.png` (⋯ → Copy Link), `share-02-form-url.png` (public form in browser), `share-03-close-date.png` (close-date setting).

**Multiple submissions — from https://learn.sessionboard.com/faq/can-end-users-submit-more-than-one-submission:** `multisub-01-success-page.png` (success page with "submit another" link), `multisub-02-submission-limit.png` (Set Submission Limit).

**Event-wide branding — from https://learn.sessionboard.com/settings/submission-form-settings:** `branding-01-settings-nav.png` (Settings > Submission Forms), `branding-02-appearance.png` (Appearance panel), `branding-03-typography.png` (Typography panel).

(The video page embeds no images; its player URL is `https://embed.app.guidde.com/playbooks/mSrgwf2XuNfULw3SX8Aiqa` — https://learn.sessionboard.com/videos/video-session-submission-form.)

## 6. Gaps — what the docs do NOT specify

- **Closed-form UX:** no page shows or quotes what a submitter sees after Close Date passes (message text, whether the page is reachable). Only "automatically stop accepting new submissions" (+ legacy "and edits").
- **Public URL structure** of a form is never documented (the demo video suggests `/submit/<event>/<form-id>` — see `00-demo-walkthrough.md`, not the KB).
- **Operator lists:** question-rule operators are never enumerated; pricing-rule operators only exemplified ("is", "is not", "contains"); conditional-participant-limit operators unspecified.
- **Question-rule composition:** whether one target field can have multiple conditions (AND/OR), whether rules can chain (conditional on a conditional), and why triggers are limited to Checkbox/Dropdown/Number — all unstated.
- **Complete field-type dropdown** for Create Field is never listed; §3.1's 14-type vocabulary is reconstructed from the standard-field tables.
- **Draft behavior on the form** (autosave vs explicit save, resume mechanics) is not covered in these pages (it lives in participant-portal docs).
- **Form count limit conflict:** text docs say 20 forms/event; the video says 24.
- **Versioning:** what happens to already-received submissions when an admin edits/reorders fields on a live form — undocumented beyond "editing a field affects all forms that use it".
- **File-upload fields on the form:** allowed extensions/size at submission time are not given in these pages (Program Settings mentions 1.95 GB per file for speaker uploads — https://learn.sessionboard.com/sessions/program-settings — but that is the portal/files context).
- **Payments edge cases:** refunds, failed payments, whether a submission exists in a pending state before payment completes — undocumented.
- **Participant Validation contract:** the exact JSON request/response schema for the external HTTP lookup is not published.
- **"Per Submission" / "Per Reviewer"** distribution modes are named in the evaluations feature list but only All-to-All and Individual Reviewer are described in the wizard walkthrough.
