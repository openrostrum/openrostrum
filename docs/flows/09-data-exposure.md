# Flow 09 — Data-Exposure Matrix (who sees what, where, and who can edit it)

Synthesized 2026-08-08 from flow docs [01](01-form-builder.md)–[08](08-settings-data-api.md) (each citation-backed against learn.sessionboard.com / apidocs.sessionboard.com), plus one extra KB fetch: https://learn.sessionboard.com/faq/what-does-the-eye-icon-mean-next-to-a-speakers-name.

**The core fact this document encodes:** the admin UI/API expose the union of all fields; **every other surface is a deliberate, narrow projection** — sometimes a field whitelist configured by the admin (embeds, evaluator view, co-participant view, portal fields), sometimes a hardcoded transform (queue statuses → "Pending", Hide-PII email/phone masking). The clone must implement each projection **server-side**; none of these are cosmetic.

Legend used in all matrices: **R** read · **W** read + write · **M** masked/transformed (visible but altered) · **H** hidden (absent from payload) · **–** surface not applicable · letters = conditional rule, resolved in §3.

---

## 1. Actors & surfaces

| Actor | Auth | Surfaces they touch | Scope tier ([SCOPE.md](../../SCOPE.md)) |
|---|---|---|---|
| **Anonymous web visitor** | none | Public form URL `/submit/:eventSlug/:formId` welcome + account steps; unauthenticated form-definition endpoint (`GET /portal/submit/{formId}?userId=0`); embed data endpoint (`GET api…/embed/v2/{id}/async-data`); exported file URLs ([02 §1](02-public-submission-and-portal.md), [06 §2d](06-agenda-embeds.md), [08 §2c](08-settings-data-api.md)) | P0 (form), P1 #16 (embeds) |
| **Form submitter** | email+password account created inline at the Account step ([02 §3](02-public-submission-and-portal.md)) | Public form wizard, own drafts hub, success page, own portal after submit | P0 |
| **Speaker / portal user** (speaker, moderator, chairperson, session submitter; identity = Portal Username field, not Email) | email+password; one login URL per event, resolved to exactly one portal (first-match filter) ([07 §2a](07-portals-tasks.md)) | Portal: Home, Submissions (My Sessions), Profile, Tasks, Messages, Resources, Files; View Submission (form re-entry) | P0 (Home/Submissions/Profile/Tasks); Messages/Resources OUT |
| **Evaluator** | event user; 2.0: passwordless login link via Program Site ([05 §2b](05-evaluations.md)) | My Reviews → assigned plans/rounds only; scoring UI. "Deliberately limited access… only have access to complete evaluation plans assigned to them" (https://learn.sessionboard.com/faq/will-evaluators-have-the-same-access-to-my-event-that-i-do-as-an-admin) | P0 (thin), rounds P1 |
| **Event admin / team** | full login; per-role campaign permissions exist but otherwise full event access | Every module; sees the union of all data; "View portal as…" read-only impersonation ([07 §2f](07-portals-tasks.md)) | P0 |
| **API token consumer** | `x-access-token` (org-generated, scoped, Hide-PII flag, event restrictions) or OAuth 2.1 read-only ([08 §2e](08-settings-data-api.md)) | 177-op public API; webhooks (push of full resource objects) | P1 #20 |
| **Public site visitor via embeds** | none | 5 embed widgets + JSON/XML/iCal feeds; deep links `?sb-session-id=`, `?sb-speaker-id=` ([06 §2d](06-agenda-embeds.md)) | P1 #16 |
| **Email recipient** | none (inbox) | Transactional + manual emails; merge-tag-rendered record data; portal links; form-results PDF; "file ready" download links ([03 §2a](03-emails-communications.md), [07 §2c](07-portals-tasks.md)) | P0 (confirmation "must have"), templates P1 |

Not modeled further (OUT per SCOPE.md): sponsor/exhibitor group portal users, SMS recipients, Awards reviewers, org-level roles.

---

## 2. Entity-by-entity exposure matrices

### 2.1 Submission / Session

Columns: **Form** = submitter filling/editing the public form · **P-own** = portal user linked to the session · **P-co** = portal user viewing a co-participant's session detail · **Eval** = evaluator scoring UI · **Embed** = public embeds/feeds · **API** = token consumer · **Admin** = admin UI.

| Field group | Form | P-own | P-co | Eval | Embed | API | Admin |
|---|---|---|---|---|---|---|---|
| Title | W ᵃ | R (+W via View Submission ᵃ) | R ᵈ | R ᵇ (always: card heading) | R ᶜ | R/W | R/W |
| Description, taxonomy (format/track/tags/level/language) | W ᵃ | R/W ᵃ | R ᵈ | R ᵇ | R ᶜ (field picker) | R/W | R/W |
| Status (5 built-ins + custom) | H | **M** ᵉ — Accept Queue & Decline Queue render as "Pending" | M ᵉ | R ᵇ (Status is a whitelistable field) | **H below Accepted** ᶠ — only Accepted sessions exist publicly | R (raw enum incl. `accept_queue`/`decline_queue`) | R/W |
| Custom status name | H | M ᵍ ("Show custom status name" toggle) | M ᵍ | R ᵇ | H ᶠ | R (`custom_status`) | R/W |
| Schedule (starts/ends, room) | H (admin schedules) | R | R ᵈ | R ᵇ | R ᶜ | R/W | R/W |
| Room capacity | H | H | H | H | **H** — "visible in agenda view, not embeds" ([06 §2a](06-agenda-embeds.md)) | R (`capacity`) | R/W |
| Avg evaluation score / eval progress | H | **H — never** ʰ | H | H (own review only; others per rule k) | H | H (no eval endpoints in public API) | R |
| Source form, `admin_url`, drafts of others | H | H | H | H | H | R (`admin_url` is in the schema) | R |
| Submitter identity | W (page 2 creates it) | R (self) | R ᵈ | **M** ⁱ when Anonymized Review on; R ᵇ otherwise | H (embeds never show submitter) | R | R/W |
| Participants list (speakers etc.) | W ᵃ (participant step) | R; edit via View Submission ᵃ | R ᵈ | M ⁱ / R ᵇ ("Visible Participant Fields") | R ᶜ, minus `is_public=false` speakers ʲ | R (incl. hidden speakers, flagged `is_public:false`) ʲ | R/W (+ eye-icon toggle) |
| Per-speaker public/hidden flag | H | H | H | H | applied, not shown | R (`is_public`) | W ʲ |
| Session files | – (form file fields ≠ session Files) | R/W ˡ (portal Files, if enabled) | H | R ᵐ ("Include Uploaded Files" toggle) | H | R/W (`session files` endpoints, `write:sessions`) | R/W |
| Withdrawal metadata (who/why) | – | own withdrawal action only | H | H | H | H (not in schema) | R ([04 §2a](04-review-accept-decline.md)) |
| Sub-sessions | W ᵃ (if enabled) | R (per-portal toggle) | R ᵈ | R (plan "Include Sub-Sessions") | R ("Subsessions (n)" tab) | R (`expand=subsession_details`) | R/W |
| Own draft (pre-submission) | W (until close) | R/resume/delete | H | H | H | H | R (Drafts filter; pencil shows answers) ([04 §2a](04-review-accept-decline.md)) |
| CEU credits / client session ID / custom fields | W if on the form | R ᵃ | R ᵈ | R ᵇ | R ᶜ (ceu_credits is a default embed field) | R/W | R/W |

### 2.2 Contact / Speaker profile

Columns: **Form** = submitter entering participant data · **P-self** = portal Profile tab (own record) · **P-co** = co-participant detail view · **Eval** = evaluator (participant details pane) · **Embed** = speaker cards/gallery · **API** = token.

| Field group | Form | P-self | P-co | Eval | Embed | API | Admin |
|---|---|---|---|---|---|---|---|
| First/Last name | W (locked-required fields) | R/W ᵒ | R ᵈ | M ⁱ / R ᵇ | R (`full_name`) | R | R/W |
| Email | W | R/W ᵒ | **M** ᵈ — mail icon only if admin exposed the Email field | H [GAP — our call: never send email to evaluators] | **H** — not in speaker card field set (`full_name, about, photo, title, company`) ([06 §2d](06-agenda-embeds.md)) | **M** ᵖ — `j***@a***.com` when Hide PII on (default) | R/W |
| Portal Username (login identity) | H (auto = signup email) | W (Account Settings → Email Address) | H | H | H | H (not in Contact schema) | R/W |
| Phone(s) | W (if on form) | R/W ᵒ | R ᵈ if exposed | H ᵇ | H | M ᵖ — `***-***-4567` | R/W |
| Biography | W (if on form) | R/W ᵒ (the swyx-annotated "update own bio") | R ᵈ | R ᵇ if whitelisted | R (`about`) if picked ᶜ | R | R/W |
| Headshot | W (if on form) | R/W ᵒ (size/type limits per Record Settings) | R ᵈ | R ᵇ [GAP: masked under anonymization? undocumented — our call: hide] | R (`photo`) — "appears on the event agenda, program site, and any speaker embeds" ([02 §2c](02-public-submission-and-portal.md)) | R (`photo_url`, public URL) | R/W |
| Job title / company / social URLs / website | W (if on form) | R/W ᵒ | R ᵈ | R ᵇ | R ᶜ (`title`, `company`; links if picked) | R | R/W |
| Speaker Score, Speaker Fee, internal notes | H | **H** ᵒ (admin hides via Show/Hide Fields) | H | H | **H** | R (⚠ in Contact schema: `speaker_score`, `speaker_fee`) | R/W |
| Demographics (pronouns, gender, ethnicity…) | W only if admin put them on the form | R/W ᵒ | H unless exposed ᵈ | R ᵇ only if whitelisted | H unless picked ᶜ | R | R/W |
| Assigned Portal, task-status columns | H | H (implicit — they see the portal) | H | H | H | H | R |
| Sessions linked to the contact | – | R — **all statuses, cannot hide declined** ᶜᶜ | R ᵈ | – | Accepted only ᶠ | R (`/contacts/{id}/sessions`) | R/W |

### 2.3 Evaluation data (scores / comments / plans)

Columns: **Ev-own** = evaluator, own review · **Ev-oth** = evaluator, other reviewers' work · **P** = submitter/speaker portal · **API** · **Admin**.

| Field group | Ev-own | Ev-oth | P | API | Admin |
|---|---|---|---|---|---|
| Plan/round config (name, instructions, deadlines, scorecard) | R (own assignments only) | R (same plan) | H | H (no public eval endpoints; SbQL early-access reads legacy tables) | R/W |
| Own scores + comments | W until round close, then locked ᵏ | – | **H** — "ratings/comments never reach submitters unless an admin chooses to share them" ([05 §1](05-evaluations.md)) | H | R (Individual Grades Report) |
| Other evaluators' scores | – | **H by default; R only with "Show Scores From Other Evaluators"** ᵏ (comments: undocumented → [GAP — our call: scores only]) | H | H | R |
| Aggregates (Avg score, Top-10, Thought-Provoking, completion) | H | H | H | H | R (Summary + Cumulative Grades Report) |
| Submission fields shown while scoring | R — **whitelist only** ᵇ (Visible Fields / Filterable Fields / Card Fields / Visible Participant Fields) | same | – | – | R/W (configures the whitelist) |
| Submitter/participant identity | **M** ⁱ under Anonymized Review; R ᵇ otherwise | same | – | – | R |
| Abstain + reason | W (toggle + reason) | H | H | H | R ("notifies your administrator") |
| Evaluator identity & assignment list | R (self) | R? [GAP — whether evaluators see the reviewer roster is undocumented; our call: H] | **H** — portal reviewer Q&A: "reviewer identities stay anonymous" ([02 §4](02-public-submission-and-portal.md)) | H | R/W |

### 2.4 Tasks & file requests

Columns: **P-own** = assigned portal user · **P-co** = co-participant · **API** · **Admin**. (Note: the public API has **zero** task/file-request/portal-form endpoints — this entity is UI-only. [08 §3](08-settings-data-api.md))

| Field group | P-own | P-co | API | Admin |
|---|---|---|---|---|
| Task existence + name/description/link/due date | R — but **H until session Accepted when "Always Show Tasks" is off** ⁿ | R ᵈ (can see co-participants' tasks) | – | R/W |
| Task completion status | W (mark complete) — locked by View-Only-after-complete and by Final-Deadline lock (default 7 days past due) ([07 §2b](07-portals-tasks.md)) | R ᵈ; **cannot complete unless assigned as that person's additional contact** ([02 §2e](02-public-submission-and-portal.md)) | – | R/W (complete on behalf; via contact profile → Portal Tasks) |
| Per-user task link/description ("Use Field" binding) | R (own resolved value) | H [GAP — presumably own value only; our call: H] | – | R/W |
| Portal form questions + prefilled record data | R/W (prefill from own record; submit; re-edit only if "Allow edits") | H | – | R/W; results grid + CSV/XLSX export + PDF download |
| File-request upload | W (1 file, versioned, ≤1.95 GB); sees status Pending Feedback → approved/denied; **deny is silent — no notification** ([07 §2d](07-portals-tasks.md)) | H | – | R/W (approve/deny/revert; download) |
| File-request message thread | R/W (own thread; email on admin message) | H | – | R/W; **contact replies email ALL admins with Portals-Tasks access, cannot be disabled** ([07 §2d](07-portals-tasks.md)) |
| Task assignment tracking (icon columns, Assigned Portal) | H | H | – | R (module dashboard columns) |

### 2.5 Files

| File class | P-own | Eval | Embed/public | API | Export | Admin |
|---|---|---|---|---|---|---|
| Session files (presentations/posters/handouts + versions + comments) | R/W ˡ (upload, new versions, comment → goes to admins; comments generate no notifications) | R ᵐ if plan "Include Uploaded Files" | H | R/W (`read/write:sessions` file endpoints) | zip via Download Files (latest versions only) | R/W |
| File-request uploads | W (own request only) | H | H | – | zip category "File requests" | R/W (approval-gated store, **not** attached to the record — [07 §2d.4](07-portals-tasks.md)) |
| Headshots / logos | W (own) | R ᵇ | R (public URL) | R (`photo_url`) | zip category "Headshots" | R/W |
| Organizer-shared portal files & wiki pages | R (download; per-portal assignment) | H | H | – | – | R/W |
| **Any file field in a module export** | – | – | ⚠ becomes reachable by URL | – | **M→public: "File-type fields export as publicly hosted URL links"** ([08 §2c](08-settings-data-api.md)) | R |

### 2.6 Event settings & taxonomies (tracks/tags/formats/levels/languages/rooms/statuses/fields)

| Field group | Public form | Portal | Eval | Embed | API | Admin |
|---|---|---|---|---|---|---|
| Taxonomy option lists | R (dropdown options on the form) | R (session detail) | R (filter dropdowns admin enabled) | R (filters + track colors) | R + W (`write:metadata`) | R/W |
| Track color | H | H | H | R (paints cards) | R | R/W |
| Rooms (name/order) | H | R (session room) | R ᵇ | R (name + order drives column order) | R/W | R/W |
| Room capacity | H | H | H | **H** | R | R/W |
| Custom statuses (name/category/color/order/portal-name toggle) | H | M ᵉᵍ | R ᵇ | H ᶠ | R/W | R/W |
| Field definitions — label/placeholder/help | R (rendered) | R (portal forms) | R (field labels visible to evaluators — [01 §2.5](01-form-builder.md)) | R (picked fields) | R/W (`write:fields`) | R/W |
| Field definition **description** attribute | **H — "internal-only, invisible to submitters"** ([01 §3.1](01-form-builder.md)) | H | H | H | R | R/W |
| Form config (close date, limits, welcome copy, branding tokens) | R — the **unauthenticated** form-definition endpoint returns section copy, limits, role config, styling ([02 §1](02-public-submission-and-portal.md)) | R (View Submission) | – | – | H (no forms API) | R/W |
| Form notification recipients, payment/gateway config | **H** [GAP — our call: must be stripped from the public form payload; Sessionboard's payload contents beyond what 02 lists are unverified] | H | – | – | H | R/W |
| Event details/branding | R (logo, banner, colors on form) | R (portal appearance) | – | R (event-name header) | R (`GET /v1/events`: id, name, timezone, features only) | R/W (UI-only CRUD — no event-write API) |

### 2.7 Emails

| Field group | Recipient | Other portal users | API | Admin |
|---|---|---|---|---|
| Template subject/body, themes, merge-tag definitions | rendered result only | H | H (no comms API) | R/W |
| Merge-tag-resolved record data (name, portal link, session title/date/track…) | R (in their own email; per-recipient preview shown to admin pre-send) | H | H | R (Review & Preview per recipient) |
| Status outcomes (accept/decline) | R **only when an admin manually sends** — status changes never auto-email ([04 §2a](04-review-accept-decline.md)) | H | H | W (manual send, ≤100/batch) |
| Delivery history (Delivered/Opened/Clicked/Bounced/Spam/Dropped), campaign metrics | H | H | H | R (History → Emails) |
| Portal form confirmation **PDF of form results** | R (attached to their confirmation email) | H | H | R (Download Forms) |
| "Your file is ready" export links | R (link in email) | H | H | R |
| Unsubscribe state | W (self-serve) | H | H | R (campaigns auto-exclude) |

---

## 3. Masking & conditional-visibility rules — complete catalog

Superscript letters from §2 resolve here. Tier = where SCOPE.md places the surface.

| # | Rule | Exact behavior | Source | Tier |
|---|---|---|---|---|
| a | **Submitter edit window** | Edit own submission any time **before form close date**; after close, "editing is no longer available" (legacy: close blocks new submissions *and* edits). Post-acceptance, View Submission may be removed — admin-gated ("If you don't see a View Submission option… contact your event admin"). | https://learn.sessionboard.com/participants/edit-submission; [02 §2b](02-public-submission-and-portal.md) | P0/P1 |
| b | **Evaluator field whitelist** | Evaluators see only admin-checked fields, four lists per round: Visible Fields (default all on, uncheck to hide), Filterable Fields (checkbox/dropdown/multi-select only; category always included), Card Fields (Title + ≤3), Visible Participant Fields. Never admin access, never event browsing, view-only over the event, no contact with speakers. | [05 §2a.4, §1](05-evaluations.md); https://learn.sessionboard.com/faq/will-evaluators-have-the-same-access-to-my-event-that-i-do-as-an-admin | P0 |
| c | **Per-embed field pickers** | Each embed carries its own field whitelist per card type (Agenda/Speaker/Session); grey = required, blue = preselected-editable. Defaults: session `title, description, date, location, speakers, starts_at, ends_at, created_at, ceu_credits`; speaker `full_name, about, photo, title, company`. Embed search deliberately excludes descriptions, tags, levels, audience, custom fields. | [06 §2d](06-agenda-embeds.md) | P2 |
| cc | **Own portal never hides non-accepted sessions** | "You will see every session that person is linked to… accepted, declined, or pending." Declined can only disappear by removing the speaker or deleting the session (both discouraged). | https://learn.sessionboard.com/faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal | P0 |
| d | **Co-participant visibility (the "other participants" rule)** | **Off by default.** Admin must enable **Manage Sessions** in portal Configuration and explicitly expose/lock chosen session & contact fields (lock-all recommended → view-only). Then: My Sessions → session → Participants tab → contact detail shows only exposed fields; **a mail icon reveals email only if the Email field was exposed**. Co-participants' tasks are visible but completable only by their designated additional contact. | https://learn.sessionboard.com/faq/how-can-session-participants-view-other-associated-participants-information; [02 §2e](02-public-submission-and-portal.md) | not tiered — suggest skip v1, keep model ready |
| e | **Queue statuses masked as "Pending"** | Accept Queue and Decline Queue "display a pending icon without showing the specific status name" in the portal — staging so admins can email outcomes before the status becomes visible. Pending/queues all render "Pending"; Accepted/Declined render truthfully. | https://learn.sessionboard.com/videos/decline-sessions; [04 §2a](04-review-accept-decline.md) | **P0 #4 (explicit)** |
| f | **Public = Accepted only** | Attendee-facing agenda/embeds "will only display accepted sessions", regardless of the admin-side Program Statuses setting (which can surface Accept Queue/Pending **in admin agenda views only**). | https://learn.sessionboard.com/faq/can-sessions-that-are-not-accepted-be-hidden-from-a-users-portal; [06 §2a](06-agenda-embeds.md) | P2 embeds; rule itself P0 (portal ≠ public) |
| g | **Custom status portal name toggle** | "Show custom status name" ON → portal users see the custom name; OFF → [GAP — our call] portal shows the mapped category's default label (mirrors queue behavior; not explicitly stated). | [04 §2a](04-review-accept-decline.md) | P1 #11 |
| h | **Eval results never reach submitters** | Ratings and comments are never shown to submitters/speakers "unless an admin chooses to share them" (sharing itself is manual, e.g. email — no product feature). | [05 §1, §2d](05-evaluations.md) | P0 |
| i | **Anonymized Review** | Per-plan/round toggle hides submitter and participant identity from evaluators; 1.0 wording: "first and last names of session speakers are removed from submission details". Exact masked field set (photos, bios, company) undocumented → **[GAP — our call: when on, suppress the entire Participant Details pane + submitter field, not just names]**. | [05 §2a.1, §5.5](05-evaluations.md) | not tiered — cheap, build with plan settings |
| j | **Eye icon / per-speaker `is_public`** | Default visible. Hidden (crossed-out eye): "hidden from all embeds"; API Get/Search Sessions still return the speaker with `is_public: FALSE`. Toggled by clicking the name in the Session participants widget. | https://learn.sessionboard.com/faq/what-does-the-eye-icon-mean-next-to-a-speakers-name; [04 §2d](04-review-accept-decline.md) | P1 #16 (embeds) — flag in data model now |
| k | **Evaluator cross-visibility + round lock** | Default: evaluators cannot see other evaluators' scores or comments. 2.0 opt-in "Show Scores From Other Evaluators" (scores; comments unstated → our call: scores only). Reviews editable while round open; "Once the round closes, evaluations are locked and cannot be modified". | [05 §2a.1, §2b.7](05-evaluations.md) | P0/P1 |
| l | **Portal file upload gate** | Session file upload from the portal only when the event's Files feature is enabled (Sessions → Settings → Files); ≤1.95 GB; versions kept, all history visible to the uploader. | [04 §2e](04-review-accept-decline.md); [02 §2c](02-public-submission-and-portal.md) | P1 #3 |
| m | **Evaluator file access gate** | Evaluators can download session files only if the plan's "Include Uploaded Files" is on. | [05 §2a.1](05-evaluations.md) | P1 |
| n | **Task visibility gated on acceptance** | With portal "Always Show Tasks" OFF, tasks/forms/file requests are visible **only to speakers assigned to accepted sessions** — flipping a session to Accepted is what lights up the to-do list. (ON = everyone in the portal sees them.) | https://learn.sessionboard.com/faq/how-to-create-a-portal-for-accepted-speakers; [07 §2a.7](07-portals-tasks.md) | P0 #7 |
| o | **Portal Show/Hide Fields** | Per portal, each contact/session field is editable, **locked** (view-only), or **hidden** for the portal user — this is how Speaker Score/Fee and other internal contact fields stay invisible on the user's own profile. | [07 §2a.9, §3](07-portals-tasks.md) | P0 (Profile tab implies a default whitelist) |
| p | **API Hide PII** | Per-token flag, **default ON**: emails → `j***@a***.com`, phones → `***-***-4567`. Plus per-token event restrictions, scopes (legacy empty-scope tokens = all reads, never writes), full audit log; OAuth tokens read-only and inherit the authorizing user's permissions dynamically. | https://learn.sessionboard.com/integrations/api-tokens; [08 §2e](08-settings-data-api.md) | P1 #20 |
| q | **Export file-field transform** | Module exports render file-type fields as **publicly hosted URL links** — exporting is an act of publishing those file URLs. | https://learn.sessionboard.com/reporting/exporting-data; [08 §2c](08-settings-data-api.md) | P1 #17 |
| r | **Status change never notifies** | No automated accept/decline email exists; outcomes travel only via manual sends/campaigns. The only submission-lifecycle automations: confirmation, draft reminders (5d/1d), admin new/revised alerts, "added to a submission", invoice. | [04 §2b](04-review-accept-decline.md); [03 §2a](03-emails-communications.md) | P0 |
| s | **Existing-contact protection on the form** | Unique Contact Settings: (a) OFF → a submitter cannot overwrite an existing contact's data (contact must self-update via portal); (b) ON → the existing contact is emailed that they were added, to review/update. [GAP — whether the form ever *prefills/reveals* an existing contact's stored data to a different submitter is undocumented; our call: never reveal, only accept input.] | [01 §2.1.6](01-form-builder.md) | P1 |
| t | **Draft exposure** | Drafts are private to the submitter on the public side, but **admins see all drafts** (Drafts filter: title, submitter, source form; pencil opens answered-so-far). | [04 §2a](04-review-accept-decline.md) | P1 #4 |
| u | **Withdrawal metadata** | Who withdrew and why: admin-only (Sessions → Submissions). | [04 §2a](04-review-accept-decline.md) | P1 #11 |
| v | **Messages scoping** | Admins see all session threads; participants only their own. Portal reviewer Q&A: "Replies are shared with the review team; reviewer identities stay anonymous." | [03 §2d](03-emails-communications.md); [02 §4](02-public-submission-and-portal.md) | OUT (Messages tab) |
| w | **Admin impersonation is read-only** | "View portal as…" shows the user's exact portal but tasks "can be viewed, but NOT completed"; on-behalf completion goes through the contact profile instead. | https://learn.sessionboard.com/faq/how-can-i-view-a-portal-as-an-admin; [07 §2f](07-portals-tasks.md) | P2 #6 |
| x | **Portal notification gate** | Portal task/digest emails only sent "IF they have created an account/accessed their portal previously"; per-portal on/off; identity keyed on Portal Username, not Email. | [03 §2a #17–18, §2e](03-emails-communications.md) | P1 |
| y | **File-request review states** | Deny sends no notification (silent); reply-thread messages from contacts broadcast to all admins with Portals-Tasks access (non-disableable). | [07 §2d](07-portals-tasks.md) | P1 #8 |
| z | **Unauthenticated read surfaces** | By design, no auth on: form definition payload (`/portal/submit/{formId}?userId=0` — includes copy, limits, roles, styling), contact-exists / user-search lookups on the account step, embed data endpoint, exported file URLs, iCal feed. Treat all four as public projections requiring explicit whitelists. | [02 §1, §2a.3](02-public-submission-and-portal.md); [06 §2d](06-agenda-embeds.md) | P0/P2 |

**Count: 27 cataloged rules** (a–z + cc), of which 5 carry a [GAP — our call] component (g, i co-scope, k comments, s prefill, d task-detail scope in §2.4).

---

## 4. Write-permission map

| Actor | Can mutate | Constraints / windows | Source |
|---|---|---|---|
| **Submitter** | Own submission (all form fields incl. participants) | Until form **close date**, never after; drafts save/resume/delete until close; per-user submission limits (form + event level); post-acceptance edits admin-gated (View Submission may be removed) | [02 §2b](02-public-submission-and-portal.md) |
| | Own account password/login email | Anytime (Account Settings) | [02 §3](02-public-submission-and-portal.md) |
| **Portal user** | Own contact profile (bio, headshot, links, phone…) | Anytime, **but only fields the portal marks editable** (Show/Hide Fields: editable vs locked vs hidden); headshot/logo size/type limits per Record Settings | [07 §2a.9](07-portals-tasks.md); [08 §2a](08-settings-data-api.md) |
| | Task completion, portal form submissions, file-request uploads, session file uploads | Task lock: Final Deadline (due + N days, default 7); View-Only-after-complete; form re-edit only with "Allow edits"; file requests 1 file/request, new versions allowed after deny; session files need event Files enabled | [07 §2b–2d](07-portals-tasks.md) |
| | Participation confirm / withdraw | Confirm only on **Accepted** sessions; Withdraw only if "Allow Submission Withdrawal" on | [04 §2b](04-review-accept-decline.md) |
| **Evaluator** | Own scores/comments/abstain per assigned submission | Only within assigned plan+round; editable while round open, **locked at round close**; nothing else event-wide (view-only) | [05 §2b](05-evaluations.md) |
| **Admin** | Everything: records, statuses (single/bulk), participants + eye toggle, on-behalf task completion, file approve/deny, promote/demote rounds, all config/whitelists, manual emails (≤100/send) | Some 1.0 immutables: grading options post-creation, round type post-creation; imports ≤1,000 rows | [04](04-review-accept-decline.md), [05](05-evaluations.md), [08 §2b](08-settings-data-api.md) |
| **API token** | Sessions, contacts, sponsors, exhibitors, metadata catalogs, fields, agenda drafts, personas, dashboards/queries — each behind its `write:*` scope | Rate limit 100 req/15 min/token/category; **daily write quota 10,000/day/token**; bulk ≤100 ops; optimistic concurrency via `updated_at` → 409; event restrictions per token; OAuth tokens **cannot write at all**; no write path exists for: evaluations, tasks, portals, forms, emails, events | [08 §2e, §3](08-settings-data-api.md) |
| **Anonymous** | Nothing (form writes require the account step first; draft save requires login) | — | [02 §2b](02-public-submission-and-portal.md) |

---

## 5. Clone implications

**Role model (minimum viable):** `anonymous` · `submitter/portal-user` (one identity — a submitter becomes a portal user at submit) · `evaluator` · `admin` · `api-token` (with `scopes[]`, `hide_pii`, `event_ids[]`). Evaluator and portal-user can be the same account with different grants; admin is per-event (single admin is enough per SCOPE).

**The one pattern to enforce everywhere: explicit field whitelist per surface, applied server-side.** Never serialize an ORM entity to a non-admin surface. Concretely, one projection function per (entity, surface): `sessionForPortal()`, `sessionForEvaluator(planRoundConfig)`, `sessionForEmbed(embedFieldConfig)`, `contactForEmbed()`, `contactForCoParticipant(portalExposedFields)`, `sessionForApi(token)`. The admin-configured whitelists (embed field pickers c, evaluator view config b, portal Show/Hide Fields o, co-participant exposure d) are **data**, not code — store them per embed/plan-round/portal and resolve at query time.

**Server-side mandatory (a UI check is a vulnerability):** status masking e/g (map queue→"Pending" in the portal serializer — never ship the raw enum to the portal client); Accepted-only filter f + `is_public` filter j on the embed data endpoint; evaluator scoping (assignment-tuple check on every eval read/write) + whitelist b + anonymization i; round-close and form-close write locks a/k; portal Show/Hide o and co-participant d projections; Hide-PII masking p and token scopes/event restrictions; task visibility n (compute "has accepted session" in the query, not the component); stripping notification/admin config from the public form payload z.

**Cosmetic-only is acceptable for:** track colors, card layout, filter chips, i18n of the "Pending"/"Confirmation Needed" labels (the *value* is already masked server-side), red-dot conflict markers.

**Where a naive implementation leaks — the 8 to guard in code review/tests:**

1. **Portal session payload with raw status + eval data.** Returning the full session row to `/portal` exposes `accept_queue`/`decline_queue` (the outcome before the admin's email), avg evaluation score, source form, and `admin_url`. Serialize: masked status label + whitelisted fields only. (Rules e, h.)
2. **Embed endpoint returning full contact objects.** The embed data feed is **unauthenticated**; joining speakers naively ships emails, phones, speaker fee/score to the open internet. Project to `full_name, about, photo, title, company` + picked fields; drop `is_public=false` speakers and any non-Accepted session before serialization. (Rules c, f, j, z.)
3. **Evaluator payload including identity during anonymized rounds** — or including non-whitelisted fields at all. The evaluator view must be built from the plan-round's four whitelist lists; anonymization must remove the submitter field and participant pane server-side, not blur them client-side. (Rules b, i.)
4. **Evaluator reusing admin endpoints.** If the evaluator UI calls the same `/sessions` list as admin with client-side filtering, an evaluator can read the whole event. Every eval route must verify (evaluator, plan, round, submission) assignment. (Rule b.)
5. **Co-participant detail returning the full Contact record** — portal username, phone, speaker fee, demographics — instead of the portal's exposed-field list; and the mail-icon email reveal done client-side. (Rules d, o.)
6. **API without the PII/scope layer.** Shipping the P1 #20 API without Hide-PII default-on, event restrictions, and per-scope write checks turns any leaked token into a full CRM dump; also remember OAuth-style tokens must never write. (Rule p.)
7. **File URLs.** Exports intentionally publish file fields as public URLs (rule q) — acceptable for headshots, **not** for file-request uploads (contracts, unreleased decks). Our call: signed, expiring URLs for file-request/session files in exports; truly public URLs only for embed-visible assets (headshots/logos).
8. **Status-change side channels.** Emails, webhooks, and the notifications bell must not fire on entering a queue status (Sessionboard is silent by design, rule r); and the public form-definition endpoint must not carry admin notification recipients or internal field descriptions (rules z, §2.6).

Test fixture that catches most of the above: one seeded session in **Decline Queue** with one `is_public=false` speaker, an internal Speaker Fee on the contact, an eval score, and a file-request upload — then assert the portal shows "Pending", the embed shows nothing, the evaluator sees only whitelisted fields, and the export/API mask what their flags say.
