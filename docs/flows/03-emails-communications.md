# 03 — Emails & Communications

Research date: 2026-08-08. All claims sourced from the public Sessionboard Help Center (learn.sessionboard.com); source URL cited per claim. A full mirror of all 226 KB pages was grepped for the calendar-invite question (see §4).

---

## 1. Purpose & actors

Sessionboard's communications layer covers five things: (1) transactional/system emails fired by platform events, (2) manual one-off emails sent from any record module, (3) a newer Email Campaigns product (audiences, scheduling, analytics, unsubscribes), (4) SMS blasts, and (5) an in-app notification center with email/Slack delivery channels.

| Actor | Role in comms |
|---|---|
| Event admin / team member | Composes and sends manual emails, campaigns, SMS; manages templates & themes; reads History; receives admin notifications (new submission, file-request message, AI evaluation ready) |
| Session submitter | Receives submission confirmation, draft-deadline reminders, invoice receipt |
| Speaker / moderator / chairperson | Receives portal task notifications, weekly digest, portal messages/@mentions, manual emails (acceptance/decline are manual — see §2b) |
| Sponsor / exhibitor contact | Same portal notification suite; reachable via Groups-type emails |
| Evaluator / reviewer | Evaluation plan open notification, Monday weekly reminders; (Awards) reviewer invite + deadline reminders |
| Sessionboard platform | Sends everything from `no-reply@sessionboard.com` / `no-reply@notify.sessionboard.com` via SendGrid unless a custom domain add-on is configured (§2e) |

---

## 2. Flows

### 2a. Automated emails — trigger → recipient → timing

Source (complete catalog): https://learn.sessionboard.com/communications/automated-emails — "The following are emails that are sent by Sessionboard to your event contacts or event users. Some emails can be customized as well as turned on/off."

**Account & sign-in** ("always on — these protect account access and cannot be disabled or customized"):

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 1 | Reset password | User requests a password reset → that user → immediate |
| 2 | Two-factor code | Login/verification → user → immediate (one-time code) |
| 3 | Two-factor reset by admin | Admin resets a user's 2FA → that user → immediate |
| 4 | Organization invite (new or existing user) | User invited to an organization → invitee → immediate |
| 5 | Event invite (new or existing user) | User invited to an event team → invitee → immediate. Detailed as "New Team Member Invitation": "can not be turned off/disabled"; "Imported contacts have the option to not be notified upon import." Customization: none |
| 6 | Org portal magic link | Passwordless sign-in requested for org portal → user → immediate |
| 7 | Live Transcribe magic link | Passwordless sign-in for Live Transcribe → user → immediate |

**Sessions & submission forms:**

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 8 | Submission confirmation | Submitter completes submission form → submitter → immediate. Subject: `[Event Name] Your session has been submitted`. Body editable in form settings; cannot be disabled |
| 9 | Submission closing reminder (draft reminder) | Form close date approaching → submitters with **draft** submissions → "five days and one day before the submission form closes (this email cadence can not be altered)", only when reminders enabled on the form. Subject + body customizable from Email Templates page |
| 10 | New submission (admin) | New submission received → selected admins → immediate |
| 11 | Submission revised (admin) | Submission revised → selected admins → immediate |
| 12 | Added to a submission | Speaker added to a submission → that speaker → immediate |
| 13 | Invoice receipt | Payment on a paid submission → payer → immediate |

**Intake & application forms:**

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 14 | Intake/application confirmation | Applicant completes intake/application form → applicant → immediate. Subject: `[Event Name - Form Name] Your application has been submitted`. Body editable in form settings; cannot be disabled |
| 15 | New or revised intake/application (admin) | New/updated application → admins → immediate |
| 16 | Follow-up form confirmation | Follow-up form submitted → submitter → immediate |

**Portal:**

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 17 | Portal assignment notification | "a new task (i.e. task, form, or file request) is assigned to their portal" → speakers/exhibitors/sponsors in that portal → immediate. Subject: `You have a portal update for <event name>`. On/off **per portal**; no customization. Only sent "IF they have created an account/accessed their portal previously" |
| 18 | Weekly portal summary (Weekly Digest) | Scheduled → portal users → "every Monday at 7 AM UTC. The day of the week and time the email is sent can not be changed." Subject: `[Event Name] Portal Task Summary - <send date>`. On/off per portal; no customization; same "accessed portal previously" gate |
| 19 | New message / mentioned in a message | Portal communication message or @mention → mentioned participant / thread member → immediate |

**Evaluations:**

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 20 | Evaluation plan opened | Admin opens plan & notifies → assigned evaluators → on action. Subject: `[Event Name] Evaluator Invitation` (login/create-account link) |
| 21 | Evaluation reminder & weekly summary | Scheduled, when enabled → evaluators with assigned plans → "Mondays at 7 AM UTC", shows plan progress + count of unreviewed submissions. Can be disabled; no customization |
| 22 | [AI Evaluations] Virtual evaluations ready | AI evaluation generation completes → admin users → immediate. Subject: `Your Virtual Evaluation Results Are Ready` |

**Files, exports & reports:**

| # | Email | Trigger → recipient → timing |
|---|---|---|
| 23 | Report ready | Report export finishes → requester → immediate |
| 24 | Session content export ready | Content export finishes → requester → immediate |
| 25 | Scheduled report delivery | Insights report schedule fires → subscribers → per schedule |
| 26 | Document request comment (File Request New Message) | "a contact/group sends a message through a file request task" → **all event admins** → immediate. Subject: `<Contact Name> sent a message about "<Task Name>" in <Event Name>` |

**Awards module** (own notification suite, per program; each has an on/off toggle + Customize button for subject/body/merge tags — https://learn.sessionboard.com/awards/awards-notifications-email-templates):

| # | Email | Trigger → recipient |
|---|---|---|
| 27 | Submission confirmation | Entry submitted (after payment if charged) → submitter |
| 28 | Invoice / receipt | Payment completed → submitter |
| 29 | Deadline reminder | "five days and one day before the deadline" (per automated-emails page) → submitters with started-but-incomplete entries |
| 30 | Winner notification | Winner selected → winning submitter |
| 31 | Non-selection notification | Not selected → submitter |
| 32 | Review invitation | Reviewer added with "Send email invite" toggle on → reviewer (login link) |
| 33 | Reviewer deadline reminder | Round deadline approaching → reviewers with incomplete reviews |
| 34 | New submission alert | New entry → program admins |
| 35 | Round complete alert | All assigned reviews for a submission/round done → program admins |

**Portal invitation** (semi-automated, admin-initiated): Contacts/Sponsors/Exhibitors → More → Manage Portal Access → "send the portal invite as an email or copy the invitation link". Subject: `You've been invited to the <Event Name> portal`. — https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal

### 2b. Manual sends — including accept/decline emails

**Acceptance/decline is NOT automated.** From the Accept/Decline video transcript: "Please note that updating a session status will not automatically send an email to the submitters or speakers to notify them of their updated status and next steps. Be sure to watch the creating and sending emails training video." — https://learn.sessionboard.com/videos/decline-sessions. The "Accept Queue"/"Decline Queue" statuses exist precisely so teams can "notify speakers of their session outcomes via email before the status becomes visible in the portal" (portal shows only "Pending" for queue statuses) — same source; also https://learn.sessionboard.com/sessions/accept-decline.

Manual send flow (https://learn.sessionboard.com/communications/create-send-emails + https://learn.sessionboard.com/videos/video-creating-sending-emails):
1. In **Contacts, Sessions, Speakers, Sponsors, or Exhibitors** module, check target records (Sessions module has status filter chips — e.g. select all "Accepted" — batches capped at **100 recipients per send**).
2. Click **Send → Send Emails** (Contacts) or **Send Emails** button (other modules).
3. Configure left side: **Who should receive this email?** (recipient type dropdown — e.g. session speakers, speakers + additional contacts (CC copies), moderators/chairpersons only, or select individual contacts), **Replies sent to** (one address only), **Send from** (custom-domain only), **CC/BCC** (up to five addresses each).
4. Right side: compose subject/body or click **Template** to apply a pre-built template; merge tags personalize per recipient (e.g. `[PORTAL_LINK]` — https://learn.sessionboard.com/faq/how-to-email-moderators-chairpersons).
5. **Review & Preview**: click each contact to see the exact rendered email per recipient (this is the "test" mechanism — no separate test-send in this modal), then **Send Now**.
- Attachments are not supported: "Upload files to the portal instead."
- Moderators/chairpersons emailable from both Sessions and Contacts modules — https://learn.sessionboard.com/faq/how-to-email-moderators-chairpersons.

**Email Campaigns** (newer, event-level: Collect & Preview → Send — https://learn.sessionboard.com/communications/email-campaigns): 5-step wizard — (1) audience type: Individuals / Companies / Sessions (merge tags depend on it); (2) compose (subject, body, sender name & address, reply-to); (3) recipients with filters (participant role, submission status, **acceptance status**, session info, custom fields) + external addresses; (4) preview & **send a test email to any address**; (5) Send Now / Schedule for Later / **Recurring Campaign**. Statuses: Draft, Scheduled, Sending, Sent, Paused, Cancelled. Unsubscribed contacts auto-excluded. Per-role permissions: view/create/send campaigns, manage templates, manage themes.

**SMS** (https://learn.sessionboard.com/communications/sms-messaging): from Contacts/Speakers/Sponsors/Exhibitors (not Sessions); requires standard Mobile Phone field; one-way (no replies); merge tags supported in preview; STOP/START opt-out; sender number fixed by Sessionboard.

### 2c. Template editing

Classic **Settings → Email Templates** (https://learn.sessionboard.com/settings/email-templates):
- Unlimited templates, alphabetically ordered; edit/delete/duplicate via row ellipsis.
- Fields: Template Name (internal), **Type** — determines merge fields and where usable: **Groups** (Sponsor/Exhibitor modules), **Contacts** (Contacts, Speakers, Chairpersons, Moderators, Session Submitters), **Sessions** (Sessions module); Reply To (single address); Send From (custom-domain add-on only); CC/BCC (≤5 each); Subject Line; Message Body with merge tags.
- "If you change a template module after you begin typing the message body, the current merge tags will not be valid" — merge tags are module-scoped.
- Campaigns product adds **Copy From** to import templates from another event — https://learn.sessionboard.com/communications/email-campaigns.
- **"Lifecycle vs Custom" categories: not Sessionboard terminology.** The KB never uses these labels (grep of all 226 pages). The real split is: *system/lifecycle-like* emails live on the Automated emails page (per-email customization ranges from none, to body-only in form settings, to subject+body via Email Templates for draft reminders; Awards emails fully editable per notification), while *custom* templates are the admin-created ones above.
- What's editable per automated email: see §2a table — most are "Customization: None"; submission/application confirmations = body only; draft reminder = subject + body; all Awards notifications = subject + body + merge tags + on/off toggle.

**Email Themes** (Settings → Email Themes; enabled on request via support@sessionboard.com — https://learn.sessionboard.com/settings/email-themes):
- "Email Themes control the visual wrapper around your emails — the header, footer, background, colors, and layout... **only apply to emails sent manually via the 'Send Email' modal. Automated system emails are not affected.**"
- Templates = content (subject, body, merge tags); Themes = wrapper; template body injected via required `{{{content}}}` tag (editor warns if missing).
- Tabs: All Themes / Default (⭐, one active per event) / Custom. Built-in **Standard** theme is default, locked (no edit/duplicate/delete). Starters: **Plain** (Gmail-style) or **Event Logo**.
- Drag-and-drop editor: Blocks, Pages & Layers, Global Styles, Assets, Templates panels; toolbar with code editor / import HTML / desktop-mobile preview. Event-level, not org-level.

### 2d. Notifications center (in-app)

Source: https://learn.sessionboard.com/communications/notifications (Early Access feature).
- **Bell** in header with unread count; newest-first list; Mark all read; "This event/organization vs All" scope toggle; with AI Agents on, a second "Needs attention" tab.
- **Full inbox** at both Org → Notifications and Event → Notifications; Unread filter; Group by None/Event/Date.
- **Per-type, per-channel preferences**: channels = **In-product**, **Email** (immediately or daily summary — "Most notification types default to the daily summary. Conversational ones — new messages, mentions, and changes to session data — default to immediate"), **Slack** (DM from connected org Slack app; silently skipped if unavailable). Types grouped **Admin / Portal / System / Messages**.
- Event preferences override org defaults per user.
- **Organization policy** tab (org admins only): per type — On (default) / Off (nobody) / Required (can't opt out); members see locked rows "Required by your organization" / "Turned off by your organization".
- **Session messages**: threaded per-session conversations with @mentions; admins see all threads, participants only theirs; portal shows message indicator on submissions.

### 2e. Deliverability model

- Default sender: `no-reply@sessionboard.com` (automated-emails page) / `no-reply@notify.sessionboard.com` (create-send-emails FAQ) — the KB states both; treat as the sessionboard.com no-reply identity.
- All mail goes **through SendGrid from Sessionboard's fixed sending IPs**: `159.183.10.230`, `159.183.207.219`, `159.183.47.254` — "A custom email domain changes the sending address, not the sending infrastructure." — https://learn.sessionboard.com/communications/add-on-custom-email-domain
- **Custom Email Domain add-on** (paid): admin emails support@sessionboard.com with desired address → Sessionboard supplies DNS records (SendGrid domain authentication; automated SPF/DKIM) → admin adds records at registrar → Sessionboard verifies and attaches sender to the event. Requirements: corporate domain only (no Gmail/Outlook/Yahoo); address cannot be changed after setup. Unlocks the "Send From" field on templates/sends. — same URL
- Recipient-side failures are the dominant support issue: allowlist the 3 IPs + sender address per blocking org; History → Emails is the audit trail (statuses Delivered / Opened / Clicked / Bounced / Spam / Dropped) — https://learn.sessionboard.com/faq/why-am-i-not-receiving-emails, https://learn.sessionboard.com/communications/email-sms-history
- Gotcha for clones: **Email field ≠ Portal Username** — portal access + portal notifications follow Portal Username, not the contact Email field — https://learn.sessionboard.com/faq/why-am-i-not-receiving-emails
- Portal emails additionally gated per portal (notifications on/off per portal; portal assignment via filters) — same URL.
- Campaigns respect an event-level **Unsubscribe** list — https://learn.sessionboard.com/communications/email-campaigns

---

## 3. OPEN QUESTION ANSWER (Q3): calendar invites

**Sessionboard has NO documented per-speaker calendar-invite mechanism.** Nothing in the KB sends an invite/.ics to a speaker's own calendar (Gmail/Outlook/iCal), attaches .ics to any email, or syncs to personal calendars. Verified by grepping a full mirror of all 226 learn.sessionboard.com pages (sitemap-0.xml, fetched 2026-08-08): **zero** occurrences of `.ics`; `iCal` appears on exactly one page; "calendar invite" appears nowhere; Outlook/Gmail appear only in deliverability/spam-filter contexts. Web searches (`sessionboard speaker calendar invite ics "add to calendar"`, `"sessionboard" calendar invite speakers Outlook Gmail`) returned no Sessionboard results.

What DOES exist — two adjacent, attendee/website-facing mechanisms:

1. **iCal embed feed** (closest thing to calendar delivery): when creating an embed, one output format is "**iCal — a calendar link showing all approved sessions as events**". Embeds are feeds for your website/app ("The feed refreshes automatically"; auto-update every 60 minutes, manual Refresh Cache available). It is a whole-agenda subscription link, not a personalized per-speaker invite. — https://learn.sessionboard.com/sessions/embeds

2. **"Add to calendar" in agenda embeds** (attendee-facing button): the Embeds video describes "enabling **calendar integration so attendees can add sessions directly to their personal calendars**" as an optional styling feature of the styled-HTML agenda embed. — https://learn.sessionboard.com/videos/video-embeds

For speakers specifically, Sessionboard's documented answer is the **portal**, not calendars: "We recommend instructing Moderators and Chairpersons to log in to their portal to view their assigned sessions and relevant session details within the My Sessions widget" (https://learn.sessionboard.com/faq/how-to-email-moderators-chairpersons), plus SMS session reminders as a use case (https://learn.sessionboard.com/communications/sms-messaging).

**Implication for the clone:** the competition brief's "calendar invites delivered directly to each speaker's own calendar" is a feature Sessionboard does not document having — building per-speaker .ics attachments (METHOD:REQUEST on acceptance/schedule emails) or a personal iCal feed per speaker would be a differentiator, not parity. Checked as instructed: sessions/session-settings (now "Program settings" — no calendar content) and sessions/agenda (calendar = admin scheduling views only: week/month layouts).

---

## 4. Inventory

### Email types
Automated: 26 platform emails + 9 Awards notifications + portal invitation = §2a tables (triggers included there). System emails also logged in History: New Team Member Invitation, Session Submission Form Confirmation, Application Confirmation, Email Notification (portal task assignment), Weekly Email Digest, Evaluation Plan Weekly Reminders — https://learn.sessionboard.com/communications/email-sms-history.

### Merge tags
**Campaign merge tags** (vary by audience type; switching audience invalidates tags) — https://learn.sessionboard.com/communications/email-campaigns:
- Individuals: First Name, Last Name, Full Name, Email Address, Job Title, Company Name, Portal Link, custom contact fields
- Companies: Company Name, Point of Contact Name, Point of Contact Email, Portal Link
- Sessions: Session Title, Session Date & Time, Session Room/Location, Session Track, Speaker Name(s), Portal Link

**Classic template merge fields**: scoped by template Type (Groups/Contacts/Sessions); documented example token format `[PORTAL_LINK]` ("Portal Login Link" merge tag) — https://learn.sessionboard.com/settings/email-templates, https://learn.sessionboard.com/faq/how-to-email-moderators-chairpersons, https://learn.sessionboard.com/portals/inviting-users-to-the-event-portal.

**Theme merge tags** (triple-brace Handlebars) — https://learn.sessionboard.com/settings/email-themes:
`{{{content}}}` (required), `{{{event_name}}}`, `{{{event_logo_image_url}}}`, `{{{recipient_name}}}`, `{{{recipient_email}}}`, `{{{recipient_phone}}}`, `{{{subject}}}`, `{{{replyTo}}}`, `{{{sendFrom}}}`, `{{{cc}}}`, `{{{bcc}}}`, `{{{emailType}}}`.

### Theme options
Standard (locked default) + custom themes from Plain / Event Logo starters; drag-drop blocks, global styles, asset upload, raw HTML import; one default per event; manual sends only. Campaign themes additionally list: text styling, buttons, dividers/spacing, social sharing buttons, header/footer layout, brand colors & logo; reusable across events. — https://learn.sessionboard.com/settings/email-themes, https://learn.sessionboard.com/communications/email-campaigns

### Delivery statuses (History → Emails)
Delivered, Opened, Clicked, Bounced, Spam, Dropped (definitions on page). Campaign metrics: total recipients, unique opens, unique clicks, open/click/bounce/unsubscribe rates. — https://learn.sessionboard.com/communications/email-sms-history, https://learn.sessionboard.com/communications/email-campaigns

---

## 5. Screenshots

Downloaded to `docs/flows/img/03-emails/` (23 files, all verified PNG/WebP via `file`). Image URLs are `https://learn.sessionboard.com/images/kb/<id>.png`; "source" = page they're embedded in.

| File | Caption | Source page |
|---|---|---|
| `automated-team-invite-preview.png` | New Team Member Invitation email preview | /communications/automated-emails |
| `automated-submission-confirmation-preview.png` | Submission confirmation email preview | /communications/automated-emails |
| `submission-confirmation-edit-in-form-settings.png` | Editing confirmation body inside form settings | /communications/automated-emails |
| `draft-reminder-preview.png` | Draft submission reminder email preview | /communications/automated-emails |
| `draft-reminder-template-customization.png` | Draft reminder subject/body customization via Email Templates | /communications/automated-emails |
| `application-confirmation-preview.png` | Application confirmation email preview | /communications/automated-emails |
| `weekly-digest-portal-toggle.png` | Weekly digest on/off per portal | /communications/automated-emails |
| `portal-task-notification-toggle.png` | Portal task email notification toggle | /communications/automated-emails |
| `evaluation-plan-open-notify.webp` | Evaluation plan open & notify evaluators | /communications/automated-emails |
| `file-request-message-email.png` | File request new-message admin email | /communications/automated-emails |
| `campaign-step1-audience.png` | Campaign step 1 — audience type (Individuals/Companies/Sessions) | /communications/email-campaigns |
| `campaign-step2-compose.png` | Campaign step 2 — compose with merge tags | /communications/email-campaigns |
| `campaign-step3-recipients.png` | Campaign step 3 — recipient filters | /communications/email-campaigns |
| `campaign-step4-preview.png` | Campaign step 4 — preview & test send | /communications/email-campaigns |
| `campaign-step5-send-schedule.png` | Campaign step 5 — send now / schedule / recurring | /communications/email-campaigns |
| `campaign-merge-tags.png` | Campaign merge tag selector | /communications/email-campaigns |
| `email-template-editor.png` | Classic email template editor pop-up (Type, Reply-To, CC/BCC) | /settings/email-templates |
| `email-theme-editor.png` | Drag-and-drop theme editor | /settings/email-themes |
| `theme-merge-tags.png` | Theme merge tag ("Edit variable") panel | /settings/email-themes |
| `history-campaigns.png` | History → Campaigns list with engagement metrics | /communications/email-sms-history |
| `history-sent-emails.png` | History → Sent Emails log with delivery statuses | /communications/email-sms-history |
| `portal-invite-email-example.png` | Portal invitation email example | /portals/inviting-users-to-the-event-portal |
| `portal-link-merge-tag.png` | `[PORTAL_LINK]` merge tag in composer | /faq/how-to-email-moderators-chairpersons |

---

## 6. Gaps

1. **Full merge-tag lists for classic templates are undocumented.** KB says merge fields differ per Type (Groups/Contacts/Sessions) and shows `[PORTAL_LINK]`, but never enumerates them; only the Campaigns product has a published list. Needs an in-app check.
2. **Sender discrepancy**: `no-reply@sessionboard.com` (automated-emails, FAQs) vs `no-reply@notify.sessionboard.com` (create-send-emails, custom-domain page). Likely notify subdomain for actual SMTP envelope, root for display/support docs — unverified.
3. **"Lifecycle vs Custom" template categories** (from our brief) don't exist in Sessionboard's docs; mapping in §2c is our interpretation.
4. **Admin notification recipients** for "new submission (admin)" are "selected admins" — where that selection lives (form settings vs notification preferences) isn't specified.
5. **Awards deadline-reminder cadence** is "five days and one day before" per the automated-emails catalog, but the Awards page itself only says "as the deadline approaches".
6. **No documented calendar invites to speakers** (§3) — decide whether clone builds .ics-on-acceptance as differentiator.
7. **Notification type inventory**: the Preferences screen groups types into Admin/Portal/System/Messages, but the KB doesn't list every individual type.
8. **Batch limit tension**: manual sends capped at 100/batch (video) while Campaigns has no stated cap — Campaigns appears to be the successor path.
9. Some pages carry a 2026 redesign ("Collect & Preview > Send", "Deliver" module, "Program" module) while older pages reference "Sessions module" navigation — module naming in the clone should follow the newer IA.
