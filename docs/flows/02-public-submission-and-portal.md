# Flow 02 — Public Submission Flow & Speaker Portal (submitter/speaker side)

Sources: learn.sessionboard.com knowledge base + the **live public sandbox CFP form** (`https://appv2.sessionboard.com/submit/ai-engineer-sandbox-event/b7d4d7cd-3012-45c2-9c08-a8ee9185182f`), all fetched 2026-08-08 with read-only GETs (no account created, nothing POSTed). The sandbox URL serves a React SPA shell, so its client bundle (`https://appv2.sessionboard.com/assets/index-DY1MVJ6d.js`, 15.8 MB) and English i18n file (`https://appv2.sessionboard.com/locales/en/portal.json`) were also fetched and grepped for routes/UI copy, and the form definition was pulled from the same unauthenticated endpoint the SPA calls: `GET https://api.sessionboard.com/portal/submit/b7d4d7cd-3012-45c2-9c08-a8ee9185182f?userId=0` (HTTP 200). Facts sourced from bundle/API are marked **[bundle]** / **[live API]**; everything else cites a KB URL.

Two KB pages in scope are stubs whose real content is an embedded Arcade interactive demo (no text): see §6 Gaps.

---

## 1. Purpose & actors

The speaker/submitter side of Sessionboard is two connected surfaces: the **public submission form** (a multi-step wizard at a shareable URL, no invite needed) and the **event portal** ("If an event organizer invited you to Sessionboard as a speaker, sponsor, or exhibitor … Everything you need happens in your event portal — submitting a proposal, uploading a headshot, completing tasks, and keeping your session details current" — https://learn.sessionboard.com/participants/overview).

Actors:
- **Submitter** — anyone with the public form URL; creates (or logs into) a Sessionboard account during the form's Account step, and becomes a Contact + portal user on submit.
- **Participant / speaker** — a person named on a submission (speaker, moderator, chairperson…); works in the portal: profile, headshot, tasks, files, acceptance confirmations (https://learn.sessionboard.com/participants/overview).
- **Portal user with multiple hats** — one login can hold several portals (own speaker portal, a sponsor group portal, another speaker's portal as assistant) and switches between them (https://learn.sessionboard.com/participants/updated-portals).
- **Event team** — resends portal links, fixes access, controls what the portal exposes; they are the escalation path everywhere ("Your event organizer is the fastest route — they can see your portal and reset access" — https://learn.sessionboard.com/participants/overview).

## 2. Flows

### (a) First-time submitter: public link → account → submission → confirmation → portal

1. **Visitor opens the public form URL** `/submit/:eventSlug/:formId`. Client routes for the whole flow **[bundle]**: `/submit/:eventSlug/:formId` (welcome), `/submit/:eventSlug/:formId/logon` (account), `/submit/:eventSlug/:formId/step/:stepId` (wizard pages), `/submit/:eventSlug/:formId/submissions/:submissionId[/step/:stepId]` (reopen an existing submission), plus `/submit-callback` (SSO return). The stepper's step names **[bundle i18n `cfp.steps`]**: Welcome · Account · Your Information (optional submitter-info step) · Session Info · Participant Info · Review · Payment (optional) · Confirmation.
2. **Welcome step** — organizer-authored rich text. On the live sandbox form **[live API]** the welcome section is nav-titled "Welcome!", page-titled "Welcome to our event!", and contains a "Call for Speakers" pitch: event blurb, date placeholder, a tracks list (Topic A–D), "You can use the portal to keep up to date on the status of your submissions. If approved, you'll receive a list of tasks to complete within the portal.", and a "Helpful Tips and Important Information" link list (Speaker Agreement, Terms and Conditions, FAQs for Speakers). A banner over the form shows "Form submissions will be accepted until {{date}}." or, past close, "Form submissions are no longer being accepted." **[bundle i18n `banners`]**.
3. **Account step (logon)** — email-first: "Your Email Address:" → Next. The app looks the email up unauthenticated (`GET /portal/event/{eventId}/search-portal-users?email=` and `POST /portal/event/{eventId}/contact-exists/public`) **[bundle]**, then branches: existing account → "Log in with your existing account" / "Enter your existing password:"; new email → First Name, Last Name, "Create a password:" (rules: ≥8 chars, 1 special, 1 number, 1 capital) + "I agree to the Terms of Service and Privacy Policy" → "Create account". "Forgot your password?" sits on this step. SSO variants exist per form ("Log me in with {{provider}}", "Your email domain requires you to login or sign up using SSO"; SAML IdPs listed via `GET /sso/saml/idp/call-for-paper-form/{formId}/list`) **[bundle i18n `cfp.login`]**. Once authenticated the form shows "You are logged in as {{name}} ({{email}}). Not you? Click here to log out" **[bundle i18n `banners`]**.
4. **Session Info step** — sandbox: "Tell us about your submission" with Title (text, required), Description (rich text, required), Format/Tags/Track (dropdowns, required), Level/Language (dropdowns, optional) **[live API]**.
5. **Participant Info step** — sandbox: "Tell us about you" with "This person is a speaker / presenter" checkbox, First Name*, Last Name*, Email*, Mobile Phone, Biography (rich text); only the Speaker role is allowed on this form; additional contacts enabled **[live API]**. Participant emails are verified against existing contacts on blur/continue/submit depending on form config ("Participants are checked when you leave the email field, when you continue to review, and again when you submit") **[bundle i18n `cfp.page`]**.
6. **Review step** — "Review your submission — Check that everything looks correct. You can go back to make changes before submitting."; shows participant-requirement role counts and, when fees exist, "After you submit, you may be asked to complete payment before your submission is finalized." **[bundle i18n `cfp.review`]**. Submit → `POST /portal/submit/{formId}/session` after `…/session/validate` **[bundle]**.
7. **Confirmation step** — organizer-configured success message. Sandbox copy **[live API]**: "Thank you for submitting to present at our event! You will receive a confirmation email shortly with a link to your speaker portal. … Next, you will be logged into your speaker portal where you can see if there are any tasks to complete. If you would like to submit another session, please click here to return to the submission form." The form has `enable_auto_redirect: true`; the admin builder describes this as "After 10 seconds on the confirmation page. If off, submitters use Continue to portal." **[live API + bundle]**.
8. **Confirmation email → portal.** The portal link lives "in your session submission confirmation email (if you're the submitting individual)"; lost links are resent by the event team (https://learn.sessionboard.com/participants/access-portal). Opening it: enter password ("New users — you'll be prompted to create a password. Existing users — enter the password you created."), click **Continue to portal**, then "Choose your portal — Pick the portal you want to work in from the list of portals you have access to" (https://learn.sessionboard.com/participants/access-portal).
9. **Repeat submissions** — allowed: navigate back to the form link, or use the success-page "submit another" link; admins can cap it with Set Submission Limit (https://learn.sessionboard.com/faq/can-end-users-submit-more-than-one-submission). Sandbox: event-level limit of 3 submissions per user **[live API `event_submission_limit`]**. Re-submitting with the same co-speakers creates duplicate contacts admins are told to audit (same FAQ).

### (b) Returning submitter: edit a submission / resume a draft

**Edit window = until the form's close date, full stop.** "You can edit your submission any time before the submission close date. … Once the submission close date passes, editing is no longer available. Contact the event team if you need a change after the deadline." Path: log into portal → My Sessions widget → click the session → **View Submission** at the bottom of the sidebar → edit the form (https://learn.sessionboard.com/participants/edit-submission). After acceptance the same View Submission path is how speakers are added/edited, but it's admin-gated: "If you don't see a View Submission option or a portal task asking you to add speakers, please contact your event admin" (https://learn.sessionboard.com/participants/how-to-add-of-edit-speaker-information-for-an-accepted-session).

**Drafts:**
1. Save requires "at least a Title"; the **Save as draft** button is bottom-right of the form. "To progress to the next page, you will be required to fill out all required fields" — i.e. page-level validation still applies while drafting (https://learn.sessionboard.com/participants/save-a-submission-as-a-draft).
2. Saved → banner "highlighting that you are editing a draft submission" ("You are editing your draft." / "Last saved on {{date}}" **[bundle i18n]**) (same URL).
3. Resume: "When you access the submission form link and log back in, the system will prompt you to resume your draft submission" (same URL). Logged-in returners get a submissions hub: "Your submissions for this form — Resume a saved draft or complete payment for a submission waiting on payment", with rows (Title / Reference / Status / Last updated), statuses "Draft — not submitted" and "Payment due", and actions Resume draft, Complete payment, Delete draft ("This permanently deletes your saved draft… cannot be undone"), Start new submission **[bundle i18n `cfp.authSubmissions`]**.
4. Discard: "Reset saved data" on the right of the screen (https://learn.sessionboard.com/participants/save-a-submission-as-a-draft); confirm dialog "Reset saved data?" → "Draft cleared — You are now working on a new submission." **[bundle i18n]**.
5. Drafts require login ("Log in to save a draft." **[bundle i18n]**); per-form flag `allow_multiple_draft_submissions` (sandbox: false) **[live API]**. Draft save/submit share `POST /portal/submit/{formId}/session`; in-progress list via `GET /portal/submit/{formId}/in-progress-submissions` **[bundle]**. Admins see drafts in Sessions → Submissions → Drafts filter and get 5-day/1-day close-date reminder emails to nudge completion (https://learn.sessionboard.com/sessions/draft-submissions).

### (c) Speaker completes profile & uploads files

**Profile/headshot:** The portal Profile tab (nav: Home · Submissions · Profile · Tasks · Messages · Resources · Files **[bundle i18n `speakerPortal.nav`]**) carries bio and headshot. Headshot rules: it "appears on the event agenda, program site, and any speaker embeds". Do: face camera, smile naturally, well-lit, neutral background. Don't: uneven lighting, more than one person, busy backgrounds (https://learn.sessionboard.com/participants/speaker-headshot-dos-and-donts). Recommended size 300×300 px square; third-party caveats Swoogo 1 MB / Cvent 2 MB; admins can enforce a size cap in Event Record Settings (https://learn.sessionboard.com/faq/what-is-the-recommended-size-for-contact-headshots). With an image size limit enabled, headshot/logo uploads default to a 5 MB max (https://learn.sessionboard.com/faq/what-is-the-maximum-file-size-that-sessionboard-supports).

**Upload files (if Files is enabled for the event):** Submissions (top of portal) → pick session → sidebar opens right → **Files** button under the session name → drag-drop/browse → set details → Upload. File type defaults to **Presentation**, switchable to **Poster** or **Handout**; file versioning marks an upload as a new version of a previous file, "All versions stay accessible in the history" (History / Expand All to view & download old versions). Comments on session content go straight to event admins (https://learn.sessionboard.com/participants/upload-files).

**Download organizer-shared files:** portal **Files** button → Files widget → select file to view/download (https://learn.sessionboard.com/participants/pp-how-to-view-and-download-files-from-my-portal). Wiki pages: **Resources** button → Resources widget → pick a Wiki Page (https://learn.sessionboard.com/participants/updated-portals-1).

**Tasks (the organizer's asks):** each task shows name, required flag (red asterisk), description, due date/time in the event's time zone, and status Incomplete/Complete; the full task view adds Open/closed deadline state, Open Link for external links, **Mark as Complete**, and Done (https://learn.sessionboard.com/participants/updated-portal).

### (d) Password reset

1. Go to `https://app.sessionboard.com/forgot` or click **Forgot password?** on the sign-in page (portal login places it "at the bottom right of the login box").
2. Enter the account email → **Send Reset Link**.
3. Email arrives from `no-reply@sessionboard.com`, subject "Reset Your Sessionboard Password To Access Your Account", with reset instructions (https://learn.sessionboard.com/event-team/reset-password-user-instructions, https://learn.sessionboard.com/participants/access-portal). Reset link lands on `/reset/:resetId` **[bundle route]**.
4. Failure mode to clone: a login error usually means wrong email — specifically an email that doesn't match the account's **Portal Username** field (see §3) — and the fix is via the event team (https://learn.sessionboard.com/participants/access-portal, https://learn.sessionboard.com/faq/common-speaker-portal-issues-and-how-to-fix-them).

### (e) Portal view of accepted vs pending vs declined sessions

- **Everything shows.** "you will see every session that person is linked to. This includes sessions that are accepted, declined, or pending. … If a speaker submits two sessions, and one is accepted while the other is declined, both sessions will appear on their profile and in their portal" (https://learn.sessionboard.com/faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal).
- **Declined cannot be hidden** except by removing the speaker from the session or deleting the session — both explicitly discouraged ("removes the historical record"). The attendee-facing agenda is unaffected: it "will only display accepted sessions" (same URL).
- **Status grouping:** with Participant Acceptance on, the portal splits sessions into sections — i18n gives Confirmed Participation / Invited Sessions / My Submissions with filter chips All/Confirmed/Invited/Submitted (+counts) **[bundle i18n `speakerPortal.participation`]**. Accepted sessions grow a **Confirm** button ("Participants can only confirm for Accepted sessions") opening an accept/decline dialog, plus optional **Withdraw**; pending-status wording is admin-rebrandable ("Confirmation Needed" default, 60-char override) (https://learn.sessionboard.com/speakers/speaker-acceptance).
- **Seeing co-participants:** off by default; the admin must enable **Manage Sessions** in portal Configuration and expose/lock chosen session & contact fields (lock-all is recommended so it's view-only). Then: My Sessions widget → session → side panel → **Participants** tab → click a contact; a mail icon reveals email only if the Email field was exposed. Users can see co-participants' tasks but can only complete them if assigned as their additional contact (https://learn.sessionboard.com/faq/how-can-session-participants-view-other-associated-participants-information).

## 3. OPEN QUESTION — how do submitters/portal users authenticate?

**Answer: email + password accounts, created inline. No magic-link login, no OTP, for the documented speaker/submitter surfaces.** Two on-ramps create the same account type:

1. **Self-serve via the public form's Account step** — email-first lookup, then either log in or sign up (first/last name + "Create a password:" with 8-char/special/number/capital rules + ToS consent) **[bundle i18n `cfp.login`; matches the demo video's Account step]**. Optional per-form SAML/OAuth SSO can replace the password ("Your email domain requires you to login or sign up using SSO") **[bundle]**.
2. **Organizer-driven via emailed links** — the confirmation email (submitters) or a portal invitation (invited speakers/sponsors) carries the portal URL; the link is *not* self-authenticating — it lands on a password gate: "Enter your password — **New users — you'll be prompted to create a password. Existing users — enter the password you created.**" then "Continue to portal" (https://learn.sessionboard.com/participants/access-portal). Same pattern for event-team invites: invite email from `no-reply@sessionboard.com` ("<User Name> has invited you to join Sessionboard", buttons "View My Events" / "Join your event team") → "If this is your first time accessing Sessionboard, you'll be prompted to create a password to use for future logins." Returning logins go to `app.sessionboard.com` (https://learn.sessionboard.com/event-team/new-user-login).

Key identity quirk to replicate: **login identity is the contact's `Portal Username` field, not its `Email` field** — "In Sessionboard, the Email field and the Portal Username are separate fields. The portal checks the Portal Username, not the Email field. If someone is trying to log in with their email address but their Portal Username is a different email (or blank), they'll be blocked" (https://learn.sessionboard.com/faq/common-speaker-portal-issues-and-how-to-fix-them). Users change their own login email via app.sessionboard.com → avatar → Account Settings → Email Address → Save Changes (https://learn.sessionboard.com/participants/how-to-change-my-portal-username-or-email). One account spans events/portals: after login you pick a portal, and inside you can "Switch Portals" from the name menu (https://learn.sessionboard.com/participants/access-portal, https://learn.sessionboard.com/participants/updated-portals).

Bundle nuance (evidence, not docs): `magic_link_token` is handled as a URL param alongside `invite_hash`/`reset_token`, and magic-link copy exists — but scoped to other surfaces (speaker clip sharing "Per-person magic link", Cvent exhibitor sync); an OTP input component also exists with no documented speaker-portal use **[bundle]**. Portal routes include `/portal-login/:portalSlug/:portalId` + `/portal-login-callback`, `/portals/:portalSlug/:portalId`, `/me/portals` **[bundle]**. So: clone password auth; treat tokened links as deep-links that still require (or establish) a password session.

## 4. Inventory

**Portal navigation & pages** (nav labels from **[bundle i18n `speakerPortal`]**, behaviors from cited KB pages):

| Tab / page | Contents |
|---|---|
| Home | Dashboard cards: My Submissions, My Profile ("{{name}} Profile"), Tasks, Applications; Calendar; progress meter "{{percent}}% complete"; View All links **[bundle i18n]** |
| Submissions ("My Sessions" widget) | Sessions with status; sections Confirmed/Invited/Submitted + filters; per-session sidebar with **View Submission** (edit), **Files**, **Participants** tab, **Confirm**/**Withdraw** when acceptance is on (https://learn.sessionboard.com/participants/edit-submission, /participants/upload-files, /speakers/speaker-acceptance, /faq/how-can-session-participants-view-other-associated-participants-information) |
| Profile | Own contact fields incl. bio + headshot; admin-controlled field visibility/locking (https://learn.sessionboard.com/faq/how-can-session-participants-view-other-associated-participants-information) |
| Tasks | Task list + full task view (name, required, description, due date in event TZ, status, Open Link, Mark as Complete) (https://learn.sessionboard.com/participants/updated-portal) |
| Messages | "General" thread to organizers + per-session threads; anonymous reviewer questions ("Replies are shared with the review team; reviewer identities stay anonymous"); "Organizers reply here and by email"; seen-by receipts **[bundle i18n `speakerPortal.messages`]** |
| Resources | Wiki pages shared by organizers (https://learn.sessionboard.com/participants/updated-portals-1) |
| Files | Organizer-shared files to view/download (https://learn.sessionboard.com/participants/pp-how-to-view-and-download-files-from-my-portal) |
| Name menu | Switch Portals; Account Settings lives in the app dashboard, not the portal (https://learn.sessionboard.com/participants/updated-portals, /participants/how-to-change-my-portal-username-or-email) |

**File constraints:** platform max **5 GB** per file for file requests / content upload; admins may lower it in Settings → Record Settings; headshot/logo uploads default to **5 MB** when the image size limit is on. Accepted types: Word, Excel, PowerPoint, PDF, Image, Video, Audio (https://learn.sessionboard.com/faq/what-is-the-maximum-file-size-that-sessionboard-supports). (The headshot-size FAQ says "up to 2GB" — stale copy; see Gaps.) Upload metadata: type Presentation/Poster/Handout + versioning with full history (https://learn.sessionboard.com/participants/upload-files).

**Headshot recommendations:** 300×300 px square (https://learn.sessionboard.com/faq/what-is-the-recommended-size-for-contact-headshots); content rules per the do's-and-don'ts page (§2c).

**Live sandbox form facts worth cloning** **[live API]**: form title "AI.Engineer Sandbox Event - NYC - Welcome to our event!"; 3 authored sections (welcome / submission / participant) + system steps; `enable_auto_redirect: true` (10 s confirmation → portal); event submission limit 3; roles: Speaker only (Chairperson/Moderator defined on event); no fees, no sub-sessions, no translations; styling tokens (primary button `#4962E2`, secondary `#008858`, event logo/background) delivered with the form payload; drafts single (`allow_multiple_draft_submissions: false`).

## 5. Screenshots

Downloaded 2026-08-08 into `img/02-portal/` (all verified as PNG/JPEG via `file`). Source = the KB page embedding the image.

| File | Caption | Source |
|---|---|---|
| `img/02-portal/draft-save-as-draft-button.png` | Public form with Save as draft button (bottom-right) | https://learn.sessionboard.com/participants/save-a-submission-as-a-draft |
| `img/02-portal/draft-editing-banner.png` | "Editing a draft submission" banner atop the form | same |
| `img/02-portal/draft-resume-prompt.png` | Resume-draft prompt after re-opening the form link and logging in | same |
| `img/02-portal/draft-reset-saved-data.png` | "Reset saved data" control to discard a draft | same |
| `img/02-portal/portal-task-list.png` | Portal task list row (name, required asterisk, due date, status) | https://learn.sessionboard.com/participants/updated-portal |
| `img/02-portal/portal-task-detail.png` | Full task view: deadline state, description, Open Link, Mark as Complete | same |
| `img/02-portal/portal-switch-portals.png` | Name menu → Switch Portals | https://learn.sessionboard.com/participants/updated-portals |
| `img/02-portal/portal-resources-button.png` | Portal header with Resources button | https://learn.sessionboard.com/participants/updated-portals-1 |
| `img/02-portal/portal-wiki-widget.png` | Resources widget listing wiki pages | same |
| `img/02-portal/portal-files-button.png` | Portal header with Files button | https://learn.sessionboard.com/participants/pp-how-to-view-and-download-files-from-my-portal |
| `img/02-portal/portal-files-widget.png` | Files widget with downloadable files | same |
| `img/02-portal/headshot-dos-and-donts.jpg` | Headshot do/don't example collage | https://learn.sessionboard.com/participants/speaker-headshot-dos-and-donts |
| `img/02-portal/account-settings-menu.png` | Avatar → Account Settings menu (app dashboard) | https://learn.sessionboard.com/participants/how-to-change-my-portal-username-or-email |
| `img/02-portal/account-settings-email-field.png` | Profile page, Email Address field + Save Changes | same |
| `img/02-portal/dashboard-event-list.png` | Post-login dashboard listing events → click into portal | same |
| `img/02-portal/invite-email-sample.png` | Sample invite email from no-reply@sessionboard.com | https://learn.sessionboard.com/event-team/new-user-login |
| `img/02-portal/new-user-create-password.png` | First-login create-password screen | same |
| `img/02-portal/forgot-password-form.png` | Forgot-password form (email + Send Reset Link) | https://learn.sessionboard.com/event-team/reset-password-user-instructions |
| `img/02-portal/reset-password-email.png` | Sample "Reset Your Sessionboard Password…" email | same |
| `img/02-portal/portal-sessions-all-statuses.png` | Contact/portal showing accepted *and* declined sessions together | https://learn.sessionboard.com/faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal |
| `img/02-portal/portal-sessions-all-statuses-2.png` | Second view of mixed-status session list | same |
| `img/02-portal/portal-my-sessions-widget.png` | My Sessions widget, selecting a session | https://learn.sessionboard.com/faq/how-can-session-participants-view-other-associated-participants-information |
| `img/02-portal/portal-session-participants-tab.png` | Session side panel → Participants tab | same |
| `img/02-portal/portal-participant-detail.png` | Co-participant detail view (exposed fields, mail icon) | same |
| `img/02-portal/contact-record-portal-username.png` | Contact record: separate Email vs Portal Username fields | https://learn.sessionboard.com/faq/common-speaker-portal-issues-and-how-to-fix-them |
| `img/02-portal/record-settings-max-file-size.png` | Record Settings: event max-file-size control | https://learn.sessionboard.com/faq/what-is-the-maximum-file-size-that-sessionboard-supports |

## 6. Gaps

1. **Two stub pages** — https://learn.sessionboard.com/get-started/navigate-your-contact-portal and https://learn.sessionboard.com/participants/how-to-add-of-edit-speaker-information-for-an-accepted-session have no prose; their content is Arcade interactive demos (`https://demo.arcade.software/VYcfv9iqT0VnmrtePxCF` and `https://demo.arcade.software/eEzq27Kr0nh1mL0eWNiR`). The exact add/edit-speaker steps for an accepted session are therefore undocumented in text; only the fallback note survives.
2. **`enable_login` semantics** — the sandbox form payload has `enable_login: false` yet the demo video shows an Account step on this same form. Whether the flag gates the whole form behind login vs. merely moves when auth happens is unverified.
3. **Post-acceptance edit rules** — docs confirm close-date cutoff and that View Submission can be absent, but not *which admin setting* re-opens/locks editing per status.
4. **File-size contradiction** — max-file-size FAQ says 5 GB; the headshot-size FAQ says "Sessionboard supports files up to 2GB". Treat 5 GB as current (page is the dedicated FAQ), but it's an upstream inconsistency.
5. **Confirmation email body** — referenced everywhere, never shown for submitters (only team-invite and reset emails have samples). Content/template unknown.
6. **Portal-selection UX** — behavior when a user has exactly one portal (auto-enter vs. chooser) is not documented.
7. **OTP + magic-link surfaces** — present in the bundle (one-time-code input; `magic_link_token` param; clip-share magic links) with no participant-facing documentation; unclear if any submitter path ever uses them.
8. **Legacy vs new portal UI** — `event_enable_new_ui`/`enable_new_ui` flags **[live API]** imply an old portal skin still exists; KB screenshots mix generations. Clone the new one (sandbox has it enabled).
