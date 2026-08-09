# Speaker CRM (Cross-Event Speaker Database) — feature reference

> Documents SessionBoard's behavior as the target to clone. In SessionBoard this is
> an org-level paid **add-on**; in the eval kit it is an **optional extra-credit
> area** (`optional: true`) — clones may omit it entirely without failing core areas.

## What this is

Speaker CRM is SessionBoard's organization-level add-on: a persistent, cross-event
speaker database that sits above individual events. Its modules are **Dashboard**
(org-wide metrics: total events, contacts, accepted/returning speakers; widgets for
Speaker Engagement Flow, Top Companies, Speaker Source, Areas of Focus, Contacts by
Region), **Pipeline** (kanban sourcing workflow with 8 system stages from
Researching to Confirmed/Future Fit/Declined, drag-and-drop, enroll with
score+rationale, stage history, notes, exit via Assign to event), **Directory** (all
contacts — speakers, moderators, chairpersons, sponsor contacts, submitters — with
search and a categorized Filter panel), **Segments** (dynamic auto-updating segments
vs manually curated lists saved from filtered searches), **Fields** (custom + system
contact fields in Profile / Attribute / Communication categories), and **History**
(campaign and per-email logs with open/click/bounce status). Contacts enter via
smart import (CSV/XLSX, ≤1000 rows, auto-mapping, issue flagging), public Interest
Forms (year-round intake that auto-creates contacts and Identified-stage pipeline
cards), or event submissions. Contact profiles carry bio, headshot, custom fields,
internal notes, event/session connections, files, and a full activity log;
near-duplicates (70–80% email/name match) can be merged. Bulk actions: Communicate
(templated email with merge tags), Invite To Event, and + Add To Event.

Research caveat: SessionBoard's Speaker CRM could not be trialed directly (paid
add-on), so all behavior comes from vendor marketing and the knowledge base;
screenshot layouts were only available as alt-text and pixel-level UI is inferred.

## Personas & user journeys

Personas from research: **Organizer/Admin** (event marketing team / content curator:
sources, imports, segments, emails speakers org-wide), **Org team member** (invited
via Settings > Team with Organization Access or Selected Events permissions), and
**Speaker/Prospect** (submits a public Interest Form, tracks "My Submissions",
receives outreach). The eval scenarios exercise the organizer persona only.

### 1. Source and confirm a speaker through the pipeline (Organizer/Admin)

Steps:
1. Open org-level CRM Dashboard, see totals for events/contacts/returning speakers
2. Go to Directory, click Filter, filter by expertise tag "AI" AND Job Title "CTO"
3. Open a matching contact profile (pencil icon), review bio, past sessions, ratings, notes
4. Enroll the contact in the Pipeline via + Enroll, set starting stage Identified, Score 85, Rationale text
5. Select contact in Directory, click Communicate, send templated outreach email
6. Drag pipeline card Contacted -> Interested -> Confirmed
7. Click Assign to event on the card to hand off into the event speaker workflow

Filled state: kanban board with 15–25 cards spread across
Researching/Identified/Contacted/Interested/Confirmed columns, each card showing
name, company, score; Confirmed column has 3–4 cards; card detail shows stage
history timestamps and 2 internal notes.

### 2. Import and organize the speaker network (Organizer/Admin)

Steps:
1. Go to Library/Fields, + Add Field: dropdown "Speaker Type" (Internal/External), global level
2. In Directory, open Import, generate/download the import template
3. Upload CSV of 50 speakers, review auto-mapped columns, fix flagged issues (missing email, bad phone format)
4. Complete import, verify 50 rows in Directory with custom column visible via Columns button
5. Open a profile flagged with duplicates, click Merge Duplicates, pick Primary, choose values side-by-side, Merge
6. Run a filtered search, click Save Segment, save "AI Experts" as Dynamic Segment and "2025 Keynotes" as Curated List

Filled state: Directory table with ~50 contacts, columns for Name, Email, Company,
Job Title, Tags, Speaker Type; Segments list showing 2 segments with contact counts;
one merged contact with unified history.

### 3. Year-round speaker intake via Interest Form (Speaker/Prospect + Organizer/Admin)

Steps:
1. Organizer: CRM > Interest Forms > + Create Form; wizard: name/title/description, Opens At/Closes At, mode "Speakers Only"
2. Select future events, add fields (First Name, Last Name, Email required), assign managers, configure confirmation email
3. Publish form and Copy Link
4. Speaker: open public link in fresh session, click Start Submission, fill fields, submit, see on-screen confirmation
5. Organizer: verify new contact appears in Directory and a new card sits in the Pipeline Identified stage tagged with its source
6. Triage: move card or Assign to event

Filled state: Interest Forms dashboard showing 1 open form with submission count and
unique speaker count; Pipeline Identified column contains fresh cards tagged with
the form as source; Directory has the new contacts with Speaker Source = submission
form. *(Not covered by a rubric item in this optional area's condensed rubric; see
Rubric rationale.)*

### 4. One-voice bulk outreach with tracking (Organizer/Admin)

Steps:
1. Settings > Email Templates > + Add Template with merge tags, Reply To, CC/BCC
2. In Directory, open the "AI Experts" segment, select all via checkboxes
3. Click Communicate, insert template, Review to preview resolved personalization, Send Now
4. Open History module: CAMPAIGNS tab shows subject, total recipients, unique opens, sent by, sent at; SENT EMAILS tab shows per-recipient status (Open/Clicked/Bounced/Spam)

Filled state: History module with 2–3 campaigns and 20+ sent-email rows with mixed
statuses; template library with 2 named templates sorted A–Z.

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| Cross-Event Contact Directory (`crm-directory`) | Yes | Org-level "Directory" module holding all contacts across every event: speakers, moderators, chairpersons, sponsor/exhibitor contacts, submitters. Persistent across events — returning speakers' bio, headshot, and session history are already in the system. Table search plus per-row edit (pencil icon) to open profile. | Table/list with configurable columns (Columns button, up to 25), text search bar, row checkboxes for bulk actions, pencil/edit icon opening contact profile; sits at organization level, not inside a single event. |
| Advanced Search & Filters (`crm-advanced-search`) | Yes | "Filter" button beside the search bar opens categorized panel: Demographics, Relevance, Company, History & Connections, Sessions, Custom. AND logic between different filters, OR within a filter; attribute values show contact counts (e.g. "CEO (560)"). | Filter button right of search bar; slide-out panel with grouped categories, checkbox values with counts, X to exit; result table updates to matching contacts. |
| Segments & Dynamic Lists (`crm-segments`) | No | Save a filtered search as a segment: "Dynamic Segment" auto-updates as new contacts match; "Curated List" is static until manually managed. Segments module lists saved segments for reuse in campaigns. | "Save Segment" button top-right after filtering; naming dialog with Dynamic vs Curated type choice; Segments section listing segments with contact counts, clickable to member list. |
| Custom & System Contact Fields (`crm-contact-fields`) | No | Fields module manages contact attributes in four categories: Custom, Profile (Name, Pronouns, Honorific, Job Title, Company Name, Headshot, Bio), Attribute (Audience Type, Ethnicity, Languages, Speaker Fee), Communication (Phone, Email, Address). "+ Add Field" with name (max 255 chars), type (text, dropdown, checkbox), description, field level (Global applies across all events). Attribute field type immutable after creation. | Library > Fields page with field list by category; + Add Field dialog; Save Changes; fields surface as directory columns and editable profile inputs; right-click "Edit Column" to rename in views. |
| Contact Profile with History (`crm-contact-profile`) | Yes | Central per-contact hub with five tabs: Profile (fields, headshot, bio, address/social, global attributes, custom fields, portal task progress, additional contacts), Notes (internal, not visible to contact), Connections (events, sessions, segments), Files (contact + session files), Activity (all communications sent plus record changes). Accumulates cross-event history: sessions delivered, ratings, content, communication logs. | Profile detail view/drawer with 5 named tabs (or equivalents); editable fields; notes composer; chronological activity feed; lists of linked events/sessions/segments. |
| Smart Import (`crm-import`) | No | Import contacts via generated template that auto-maps columns; flags data issues before commit. Accepts CSV/XLSX/XLS, max 1000 records/file; modes for New Contacts vs Update Existing. Requires First Name, Last Name, unique Email; cannot import file attachments (headshots) or currency fields (documented limits). | Import entry point in CRM module with template download, file upload, column-mapping/validation step showing flagged issues, then confirmation; imported rows appear in Directory. |
| Duplicate Detection & Merge (`crm-dedupe-merge`) | No | System surfaces likely duplicates at 70–80% match on email or name. "Merge Duplicates" action at top of affected profiles: check 2–3 contacts, designate one Primary, side-by-side comparison to pick which values to retain; primary inherits event-level fields, notes, additional contacts. Merge is irreversible (warning shown). | Merge Duplicates button/banner on affected profiles; selection step, Primary designation, side-by-side field chooser, Merge confirm with cannot-be-undone caution, success message; single surviving record afterward. |
| Speaker Sourcing Pipeline / Kanban (`crm-pipeline`) | Yes | Kanban workflow with 8 system stages: Researching, Identified, Approved, Contacted, Interested (Open); Confirmed (Won); Future Fit (Nurture); Declined (Lost). Stages renameable (behavior preserved), reorderable, plus "+ Add custom stage". Contacts enroll via "+ Enroll" (prospect, starting stage, optional Score 0–100 and Rationale) or automatically from Interest Form submissions (land in Identified, tagged with source). Cards move via drag-and-drop or "Move to"; "Assign to event" exits the pipeline into normal event speaker workflows. | Kanban board with named stage columns, draggable cards showing contact name/company/score; + Enroll button; card detail with Move to menu and Assign to event action; Stages management UI for rename/reorder/add. |
| Pipeline Card Notes & Stage History (`crm-pipeline-card-detail`) | No | Opening a card reveals activity logs filterable by User/Agent/System/Rule, internal Notes, scouting reports, and "Stage History" listing every stage transition with timestamps. | Card detail panel/modal with notes composer, activity feed with source filter, and timestamped stage-transition history. |
| Interest Forms — Year-Round Intake (`crm-interest-forms`) | No | Public forms collecting speaker/session interest outside CFP windows. Modes: "Sessions & Speakers" or "Speakers Only". 5-step wizard: Form Details, Events (future-dated only), Form Fields (First/Last/Email required), Managers, Notifications. On submission: contact auto-created in CRM and pipeline card auto-created in Identified stage. Dashboard tabs: Forms, Submissions, Speakers; quick actions View Form, Edit Form, Copy Link. | + Create Form button launching multi-step wizard; forms list with submission and unique-speaker counts; shareable public URL rendering a submission form without login; confirmation screen after submit. |
| Bulk Communication & Event Invites (`crm-communications`) | No | Select contacts in Directory to reveal "Communicate" (custom email) and "Invite To Event" (session submission invitations). Compose flow: recipients, "Replies sent to", subject, body with template insertion and merge tags; "Review" preview then "Send Now". Templates managed at Settings > Email Templates (name, type, Reply To, up to 5 CC/BCC, subject, body; listed A–Z). Default sender no-reply@sessionboard.com unless custom domain configured (inferred equivalent for clones: any default sender). | Checkbox selection reveals Communicate / Invite To Event buttons; composer modal with template picker and merge-tag personalization; Review preview step before Send Now; template CRUD screen. |
| Email History & Engagement Tracking (`crm-email-history`) | No | "History" module logs every email sent by the team. CAMPAIGNS tab: Subject Line, Module, Total Recipients, Unique Opens, Sent By, Sent At. SENT EMAILS tab: per-recipient rows with name/email, Subject, Status (Open/Clicked/Bounced/Spam), Sent By, Sent At. | History section with two tabs; sortable tables of campaigns and individual sends with engagement status badges. |
| CRM Dashboard & Analytics (`crm-dashboard`) | No | Org-wide metrics: total events, contacts, accepted and returning speakers, plus quick-start tools. Widgets: Speaker Engagement Flow/Funnel, Top Companies, Speaker Source (submission forms, applications, manual/import), Areas of Focus (driven by Tags), Contacts by Region. Clicking a company or focus area drills into a segmented contact list. | Dashboard landing page with KPI counters and 4–5 chart widgets; widget elements clickable through to filtered Directory views. |
| Add Contacts to Event (`crm-add-to-event`) | No | From Directory, check contacts and click "+ Add To Event"; modal to select the target event and confirm. One event per action. CRM data carries into the event context without re-keying (role assignment on add not documented; standard behavior is speaker/contact role selection **(inferred)**). | + Add To Event toolbar button appearing on selection; event-picker modal; contact subsequently visible in that event's contacts/speakers module with profile data intact. |
| Team & Access Management (`crm-team-permissions`) | No | Settings > Team: "Invite User" (Email, First Name, Last Name), "Active User" toggle, "Organization Access" for CRM-wide rights, or "Selected Events" for event-scoped permissions. Org settings also cover Details, Email templates, Integrations, API tokens. | Team settings page listing members with status; Invite User form with access-scope controls (org-wide vs selected events). |

Known research gaps (kept from research): exact pipeline card layout beyond
score+rationale; the role a contact receives when added to an event (inferred);
dashboard chart types and exact drill-through behavior; whether the directory
supports export; SMS at CRM level; the duplicate-detection algorithm beyond
"70–80% match on email or name"; "scouting reports" on cards mentioned but
undefined; AI-agent/rule activity filters on cards implied but undocumented.

## Rubric rationale

- **CRM-01** (w3, auto): the persistent org-level directory *is* the area — a cross-event speaker database without it is pointless; fully verifiable by navigating, viewing rows, and searching in one browser.
- **CRM-02** (w2, auto): attribute filtering is how organizers actually find candidates in a large database; applying/clearing filters is directly observable.
- **CRM-03** (w2, auto): "records with history" is a headline promise of the area; identity fields, a persisted note after reload, and a history surface are all screenshot-verifiable. (Notes internal-visibility to contacts is not independently verifiable, so the criterion only requires the note to persist.)
- **CRM-04** (w1, auto): custom fields/tags are enrichment polish on top of the core record; creation and persistence are observable, and tags are accepted as a lighter equivalent.
- **CRM-05** (w2, auto): the assignment supplies a speakers.csv fixture and bulk import is the realistic on-ramp for a database of this kind; upload → directory rows is fully agent-verifiable (validation/flagging counted as stronger evidence, not required, since our 3-row speakers.csv fixture contains no bad rows).
- **CRM-06** (w1, auto): dedupe/merge is a documented but secondary hygiene feature; the agent can manufacture the duplicate pair itself, so it is fully auto-testable.
- **CRM-07** (w2, auto): the sourcing pipeline is the second pillar of the area (explicitly named in the area focus); board rendering, enrollment, stage moves, and reload persistence are all observable in one session.
- **CRM-08** (w1, auto): card-level notes and stage history are depth on top of CRM-07; timestamped entries after the scenario's moves are screenshot-verifiable.
- **CRM-09** (w1, auto): segments are a documented not-must-have convenience; save-and-reopen is observable (the dynamic-vs-curated auto-update check from research was demoted to bonus evidence to keep the scenario tractable).
- **CRM-10** (w2, auto): "reuse across events" is the third pillar of the area focus; the add-to-event handoff and the contact's appearance inside DevFlow Conf 2027 are both observable. The role assigned on add is marked (inferred) in research, so it is not graded.
- **CRM-11** (w1, auto-partial): the composer, personalization preview, and in-app send confirmation are agent-verifiable, but real delivery and merge-tag rendering in an actual inbox need a human mailbox check — hence auto-partial with manual instructions.
- **CRM-12** (w1, auto): the dashboard is a value-proving analytics layer, not core; KPI counts can be cross-checked against the directory row count and widgets screenshotted.

Dropped from the draft research rubric to fit the 8–12 optional-area budget:
interest forms (draft CRM-10; requires a logged-out public-form pass better covered
by the call-for-papers area's public-form checks), email history as its own item
(draft CRM-12; folded into CRM-11's evidence), and team permissions (draft CRM-15;
org administration, peripheral to the speaker-database focus).

## Sources

- https://www.sessionboard.com/products/speaker-crm
- https://www.sessionboard.com/capabilities/speaker-management
- https://learn.sessionboard.com/en/knowledge-base/8576387-add-on-speaker-crm
- https://learn.sessionboard.com/en/knowledge-base/crm-best-practices
- https://learn.sessionboard.com/en/knowledge-base/creating-crm-fields
- https://learn.sessionboard.com/en/knowledge-base/crm
- https://learn.sessionboard.com/speaker-crm/pipeline.html
- https://learn.sessionboard.com/contacts/contact-profile.html
- https://learn.sessionboard.com/contacts/merge-duplicates.html
- https://learn.sessionboard.com/speaker-crm/speaker-crm-interest-forms.html
- https://learn.sessionboard.com/speaker-crm/crm-add-contact-to-events.html
- https://learn.sessionboard.com/en/knowledge-base/feature-overview-guides
- https://www.sessionboard.com/blog/new-speaker-crm-dashboards-unlock-insights-drive-activation-and-prove-value
