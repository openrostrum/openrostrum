# Data model — the verified Sessionboard shape (LOCKED)

**The mandate is PARITY.** We are killing Sessionboard, so our data model matches
Sessionboard's — a gap between the two is a defect to close, never a scope to cut.
This doc is the canonical reference for what the objects, fields, statuses, and
relationships *are*. Implementation lives in `app/db/schema.ts` (the SSOT); this
doc says what that schema must be faithful to.

## Ground truth (pinned, not inferred)

Sessionboard publishes a **public REST API with a full OpenAPI spec** — the
authoritative, machine-readable field schema of the system we clone. It is
vendored at [`reference/sessionboard-openapi.yaml`](reference/sessionboard-openapi.yaml)
(fetched 2026-08-09 from `apidocs.sessionboard.com`). Anchor every field name,
type, and enum to that file, **not** to the eval kit's
`00-how-sessionboard-works.md` (that doc is our own LLM research pass — good for
workflow shape, ~15 claims marked "(inferred)", and already wrong on one number:
it says 24 forms/event, live docs say 20). When the two disagree, the API spec wins.

## Airtable reality (settled)

**There is no native Sessionboard↔Airtable integration.** Sessionboard's own blog
states data reaches Airtable "through its Zapier integration." Four real mirror
paths: the **REST API** (`public-api.sessionboard.com`, token auth, full CRUD +
search), **webhooks** (create/update/delete/associate on contact, session,
sponsor, exhibitor), **Zapier** (read/trigger-oriented; writes go via REST), and
**CSV/XLSX** export/import (per-module, app-generated templates with a column-
mapping step). Stable external key = **`friendly_id`**; webhook sync handle =
`resource_url`. Evaluations and portal tasks have **no** API/webhook surface —
they only leave Sessionboard via CSV or manual entry.

The team's Airtable base is therefore a hand-rolled mirror of these objects, not a
fixed template. `fixtures/speakers.csv` (name,email,title,company,bio) is **eval
test data for a fictional event**, NOT Sessionboard's import schema — do not model
against it.

## Core objects (from the API spec)

| Object | Key fields | Notes |
|---|---|---|
| **Contact / Speaker** | `email` (req, unique/event), `first_name`, `last_name`, `company_name`, `title`, `about` (bio), `photo_url`, `pronouns`, `honorific`, `salutation`, `gender`, `phone_home`/`phone_mobile`, address_*, `website_url`, `linkedin_url`/`twitter_url`/`facebook_url`, `speaker_score`, `speaker_fee`, `custom_fields[]` | A "speaker" is a Contact attached to a session with a role. Real record = **locked core + arbitrary custom fields** (First/Last/Email are split & locked). |
| **Session / Submission** | `title` (req), `description`, `status`, `custom_status_id`, `is_abstract`, `is_public`, `starts_at`/`ends_at`, `capacity`, `ceu_credits`, `parent_session_id` (subsessions), `room_id`/`track_id`/`level_id`/`format_id`/`language_id`, `tag_ids[]`, `custom_fields[]` | A submission and a session are the SAME object; `is_abstract=true` = a CFP submission. |
| **Participant** (session↔speaker junction) | full Contact + `participant_role{core_role}` | **`core_role` ∈ {speaker, chairperson, moderator}**; display label is event-configurable. |
| **Sponsor / Exhibitor** (Group) | `name` (req), `description`, `logo_image_url`, `banner_image_url`, address_*, socials (+ instagram/snapchat/tiktok), `contacts[]` | Tier/Score are admin group fields, not core API fields. |
| **Lookups** | Track (`name`,`color`,`order`), Tag, Format, Level, Language, Room (`name`,`capacity`,`order`), **Session Status** | Session Status is a first-class object — custom statuses supported. |
| **Session Content / File** | `url`, `title`, `filename`, `size`, `mimetype`, assigned-participant, versions | Separate Recordings + Transcriptions object families exist. |

## Status pipeline (verified in the spec)

Core enum (`app/db/constants.ts` mirrors it): **`pending → accept_queue → accepted`
/ `decline_queue → declined`** — five stages, confirmed in `openapi.yaml`.
Sessionboard *additionally* supports **organizer-created custom statuses**
("Offered", "Pending Contract", …) via `custom_status_id`; a session carries
**both** a core `status` and an optional custom status. Our schema does the same:
the fixed enum plus a `session_statuses` table + `submissions.customStatusId`.

- Our `draft` and `withdrawn` are **our additions** (draft = pre-submit save state,
  which Sessionboard shows in a separate Drafts view; withdrawn = our lifecycle).
  They are not in Sessionboard's five documented decision stages — keep them, but
  do not claim the enum "matches exactly."

## Parity closures (2026-08-09, this lock)

Adversarial review found four gaps against Sessionboard; all closed to parity in
`app/db/schema.ts` (migration `0001_supreme_peter_parker.sql`):

1. **Custom statuses** → `session_statuses` table + `submissions.customStatusId`.
2. **Per-speaker visibility** → `contacts.publicVisible` (hidden speakers must
   never surface in embeds/program site — the public/private boundary).
3. **Subsessions** → `submissions.parentId` self-reference (+ `parent`/`subsessions`
   relations).
4. **Portal appearance** → `portals.welcomeMessage/accentColor/logoKey/backgroundKey`.

## Organization & Event Team (verified 2026-08-10)

Verified against learn.sessionboard.com ("Inviting organization team members",
"Invite & Manage Event Team Members"), the "Introducing Custom Roles" product
update, the vendored OpenAPI spec, and the eval kit's CRM research
(`reference/killmysaas-evals/docs/07-speaker-crm.md`):

- **Organization = the tenant.** Events belong to an organization ("View all my
  organizations" in the switcher); org-level API endpoints exist
  (`/v1/organization/{orgId}/contacts`); **API tokens are generated at
  "Organization Settings → API Tokens"** — org-scoped, with per-token event
  restrictions ([flows/09](flows/09-data-exposure.md) rule p).
- **No owner role exists — at either level.** Org-level invites (Settings →
  "Invite User": Email, First Name, Last Name, "Active User" toggle) all receive
  the **"Admin User"** permission. Event-level default roles: Admin, Session
  Manager, Evaluator Session Manager, Coordinator, Portal User — plus admin-built
  custom roles via a permission on/off matrix. Any Admin invites, edits, and
  removes team members.
- **Per-member access scope**: "Organization Access" (all events) or "Selected
  Events" (event-scoped Admin User).

**Our parity mapping** (design: [`multi-tenancy-design.md`](multi-tenancy-design.md)):
`organizations` + `organization_members` with **no role/owner column** — members
are equal admins, member management is a member capability, and the only
invariant is that an org never loses its last member. "Selected Events" scoping
and the custom-role matrix are deliberately deferred (SCOPE #22 register / OUT
table respectively).

## Residual unknowns (team-specific, cosmetic — absorbed by the sync layer)

Their specific custom fields, custom-status *names*, whether they mirror
Sponsors/Exhibitors, and their exact column labels are unknowable without swyx's
team. The object model is fully known; only their local dialect isn't — which the
base-agnostic sync engine + remappable field-class map
([`airtable-sync-design.md`](airtable-sync-design.md)) is built to absorb.
