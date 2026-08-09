# Flow 08 — Event Settings, Data Import/Export, Dashboards & the Public API

Sources: learn.sessionboard.com knowledge base and apidocs.sessionboard.com developer docs (Mintlify), all fetched 2026-08-08 over plain GET (server-rendered HTML / `.md` mirrors / `llms.txt` / OpenAPI spec — no login). The API docs' canonical machine-readable spec is `https://apidocs.sessionboard.com/api-reference/openapi.yaml` ("Sessionboard Public API 1.0", 177 operations across 131 paths); an older partial spec ("Sessions 1.0", 18 read-only ops) is still served at `/api-reference/openapi.json` — ignore it. The Mintlify site at `https://sessionboard.mintlify.app/` redirects/mirrors `apidocs.sessionboard.com`; its sitemap enumerates all 193 doc pages.

---

## 1. Purpose

This flow covers the "plumbing" around the core program modules: configuring an event (details, record settings, branding assets, per-event metadata), getting data in (CSV/XLSX import) and out (module exports, custom reports), personalizing module list views ("dashboard views"), and the entire Public API surface — auth, pagination, rate limits, webhooks, and a 177-endpoint inventory that is the compatibility target for our bonus-points API.

## 2. Flows

### 2a. Event setup

**Event details** (https://learn.sessionboard.com/events/event-details) — configured in the event's **Settings** module after creating an event:

| Field | Example from docs |
|---|---|
| Event Name | ACME Conference 2025 |
| Event Slug | `app.sessionboard.com/acme-conference-2025` |
| Event Type | Conference |
| Event Website URL | https://www.sessionboard.com/ |
| Event Location | San Francisco, CA |
| Timezone | (GMT-5:00) America/New_York |
| Starts / Ends At | 12/02/2025 8:00am → 12/05/2025 5:00pm |
| Theme | short description of event focus/audience |
| Logo image | 300 × 300 |
| Background image | 1500 × 500, "use an image with no words" |

**Record settings** (same page) — event-level toggles:
- **Set submission limit** — max sessions a user can submit across all forms.
- **Automatically provision contact portal access** — contacts get portal access when added or imported.
- **Collect additional contacts** — gather additional contacts for speakers via the submission form.
- **Enable primary speakers** — designate specific speakers/authors as "Primary" across sessions.
- **Enable Participant Acceptance** — participants accept/decline each role they hold on a submission, with optional withdrawal and custom portal status wording.
- **Enable speaker headshot limitations** — restrict headshot file types, size, dimensions (blocks non-conforming uploads; does **not** auto-downsize).
- **Enable sponsor & exhibitor logo limitations** — control logo formats/sizes/dimensions (**auto-downsizes** larger uploads).
- **Record IDs** — 3–6 uppercase-character prefixes for submissions, contacts, and groups; option to keep the parent ID on subsessions.

**Branding asset dimensions** (https://learn.sessionboard.com/settings/branding-assets-dimensions):

| Asset | Size | Where it shows |
|---|---|---|
| Event Logo | 300 × 300 px | session submission form, portal, group intake forms, all emails sent through Sessionboard |
| Event Banner | 1500 × 500 px | session submission form, group intake forms, portal — must not include text |

Upload flow: Settings module → Event Details page → **Upload** next to the image type → Save. See `img/08-settings-api/branding-dimensions-1.png` and `branding-event-details-upload.png`.

**Per-event "library" metadata (fields/tags/etc.).** Each event carries its own metadata catalogs, surfaced in the API's *Event Settings* group (https://apidocs.sessionboard.com/llms.txt): **fields** (standard + custom, per module), **tags**, **tracks**, **formats**, **levels**, **languages**, **rooms**, and **session statuses** (custom statuses). Custom fields are created in the Fields module per record type (Contact, Group, Session) and must be added to the module's table view before they participate in imports (https://learn.sessionboard.com/settings/importing-data). All eight catalogs have full CRUD over the API (`write:metadata` / `write:fields` scopes). **Personas** exist only as an API construct: "attendee personas for schedule evaluation" under Agenda Planning (https://apidocs.sessionboard.com/api-reference/agenda-planning/list-personas) — no KB page describes a UI for them in the provided sources.

**Clone an event** (https://learn.sessionboard.com/faq/clone-an-event) — self-serve, Org → Events → event actions → **Clone**; runs as a background job with progress; selections are remembered for next time. Copyable elements: Contacts (referenced from the org CRM, not duplicated), Sponsors, Exhibitors, Views (saved contact/session views), Session submission forms (questions only, not submissions), Sessions (with speakers, tags, tracks, locations — reset start/end times), Session settings (rooms/tracks/tags/format/level/languages — must be selected for sessions to copy correctly), Evaluation plans (copied **closed**; set a new due date to reopen), Custom portals, Event team (all non-portal users), Email templates, Tasks/forms/file requests, Shared files & resources, Reports, Applications. Branding: leave "Start with this event's own branding" unchecked to carry over portal branding (a banner afterwards lists what carried over: Event branding, Portal Home, Portal Login, per-portal appearance); tick it to clear logos/background/colours/custom CSS.

**No archive** (https://learn.sessionboard.com/faq/can-i-archive-events-in-sessionboard) — there is no archive feature; all events remain accessible unless an admin deletes them (deliberate: past-event reference, cloning, audit).

**Language variants** (https://learn.sessionboard.com/settings/language-translation-variant — out of scope for the clone, brief note): admin-only translated *field labels* for session/contact/group standard fields in 7 variants (German, English UK, Spanish, French, French CA, Portuguese, Portuguese BR); default is English (US); not supported in embeds or external-facing forms; translated fields are accessible through the API (`expand=translated_fields`, https://apidocs.sessionboard.com/api-reference/overview).

### 2b. Data import

Source: https://learn.sessionboard.com/settings/importing-data unless noted.

**What can be imported:** event **contacts** (incl. speakers/moderators/chairpersons), **sessions**, **exhibitors**, **sponsors**, and **event team members** (Team module has its own Import button). Import both creates new records and updates existing ones. There is **no import API endpoint** — import is UI-only; the API equivalent is the `/bulk` write endpoints (max 100 ops/request).

**File requirements:**
- CSV/XLSX saved as **UTF-8** (CSV UTF-8 preferred over .xlsx per https://learn.sessionboard.com/faq/common-csv-xlsx-import-issues-and-how-to-fix-them).
- Max **1,000 records per file**.
- Phone numbers: `+1 (123)456-7891` (country code + area code required).
- URLs (website, LinkedIn, headshots): full `https://…` form.
- Multi-select fields (e.g. tags): pipe-separated (`Convertible | Two Door`).
- **Currency and file field types cannot be imported** (headshot URL is the exception).
- Session dates/times: `YYYY-MM-DD HH:mm` (e.g. `2024-08-14 09:30`); format Excel cells as Text to stop auto-reformatting.

**Import wizard (create):**
1. Create custom fields first and **add them to the module table view** — otherwise they won't appear in the template or the mapping step.
2. Module → **Options > Import** → **Generate Import Template** (downloads a CSV whose headers match the current view). In the Sessions template, leave **Session Friendly ID** blank — IDs are assigned on import; the column is only for updates. (`img/08-settings-api/import-options-menu.png`, `import-generate-template.png`)
3. **Upload a file to import** (or copy/paste into a table) → declare whether the file has a header row → **map fields** (event fields on the left, file columns on the right; "Ignore this column" for anything you don't want touched) → **validate** (invalid cells highlighted red; click to see the error) → **Submit** → confirmation message. (`import-map-fields.png`, `import-validate-rows.png`)

**Import to update existing records:** export current data first, keep the unique identifier column, edit, then add a column **"Update record if already exists"** = `TRUE` on every row to update (without it Sessionboard may create duplicates). Identifiers/required columns per module:
- Contacts: **Email** is the matcher; First Name + Last Name required.
- Sponsors/Exhibitors (groups): **Name** is the matcher.
- Sessions: **Session ID** (Friendly ID from a Sessionboard export — never invent one) is the matcher; Status + Title required.
(`import-update-existing-column.png`)

**Common issues** (https://learn.sessionboard.com/faq/common-csv-xlsx-import-issues-and-how-to-fix-them):
1. *"All records valid" but import fails* — validation checks formatting, not backend constraints (duplicates, file size, temp issues). Fix: split under 1,000 rows, strip special characters (`"`, `&`, `<`, `>`), re-download a fresh template, try another browser. (`csv-import-fail-error.png`)
2. *Date/time fields fail after Google Sheets* — Sheets re-exports dates as `3/25/2026 9:00 AM`; fix the column's custom date format to `YYYY-MM-DD HH:mm`, use Excel, or skip re-import and use Bulk Edit.
3. *Existing data wiped* — an empty mapped column means "set this field to empty", not "skip"; use **Ignore this column** on anything not intentionally changed, and export a backup first.
4. *Session Friendly ID confusion* — blank for new records; from an export for updates.
5. *Rooms* — the Room/Location value must exactly match the room name in event settings.
6. *Custom fields missing from mapping* — add them to the module table view, re-download the template.

**Bulk edit** (https://learn.sessionboard.com/settings/bulk-edit-fields) — the in-app alternative to re-import for one-field changes: select records in a module (contacts, speakers, session, sponsor, exhibitor) → **Edit** button at top → pick the field in the dropdown → Save. (`bulk-edit-button.png`)

### 2c. Export

- **Module exports** (https://learn.sessionboard.com/reporting/exporting-data): every module (Sessions, People/Contacts, Sponsors, Exhibitors) exports the current list as **CSV or Excel** via Options > Export. File-type fields export as **publicly hosted URL links**. Headshot bulk download is a separate flow ("How to download headshots"). (`export-button.png`)
- Exports reflect the current view: "Exports include all visible columns and can be filtered before downloading. Use the export button in the top-right corner of any list view" (https://apidocs.sessionboard.com/integrations).
- The import-update flow uses export as its first step (see 2b), so export must round-trip cleanly with import (same headers, Friendly ID column included).
- **Custom reports** (https://learn.sessionboard.com/reporting/custom-reports): Reports module → **Add Report**. Types: **Session reports** (sessions on the Y-axis, joined contact data), **Contact reports** (contacts on Y-axis, joined session + sponsor/exhibitor data), **Group reports** (groups on Y-axis), **Evaluation plan reports** (evaluator details and grades). Canned reports ship for the usual joins (Sessions with Speaker Details, Speakers with Session Details, Sponsors/Exhibitors with Contact and Session Details, evaluator/grade reports). Builder steps: name + description → choose **Relationships** (each becomes a column, e.g. session speakers, evaluation plans) → pick fields (categorized Sessions/People/Groups, drag to reorder) → filters (dropdown is/is not; checkbox is/is not checked; number/text empty/not empty/contains/does not contain; file empty/not empty; optional **Must match all filters**) → **Run Report** → **XLSX or CSV**. Manage via gear icon: Edit / Delete / Duplicate.
- **API-side export**: saved queries ("Reports") can be listed and run over the API, and ad-hoc SbQL executed — see 2e.

### 2d. Dashboards / module table views

The KB page titled "dashboard-views" is about **module table views** — the configurable list grids of each module — not analytics dashboards (https://learn.sessionboard.com/reporting/dashboard-views):

- **Views** are named column/filter/sort configurations, created and seen by **all admins**. Save explicitly or changes are lost ("Do not forget to SAVE your updated view"). Navigate via the View button's dropdown; Rename View / Delete View from the same menu. (`views-save-view.png`)
- **Columns**: add, order, and hide fields; task-completion columns can be added to track task status per session/group/contact. Apply Changes to commit. (`views-columns.png`)
- **Filters**: + Add Filter → pick field → operator: `contains`, `does not contain`, `is`, `is not`, `is empty`, `is not empty`, `starts with`, `ends with`. (`views-filter-operators.png`)
- **Sort**: single field, ascending/descending.
- Limitation: in Contacts and Speakers modules, `[Session] Track`, `[Session] Language`, and `Sessions` are display-only (cannot filter or sort).
- Saved views are clone-able ("Views" element in event clone, https://learn.sessionboard.com/faq/clone-an-event).

**Analytics dashboards** exist as a separate, early-access surface ("Insights: AI reports & dashboards", KB page `/reporting/insights-ai` — adjacent in the KB nav but not among our sources) and are fully API-managed: dashboards contain **widgets** backed by SbQL queries, at event scope (`/v1/event/{eventId}/dashboards`), explicit org scope (`/v1/organization/{orgId}/dashboards`) or token-resolved org "convenience" scope (`/v1/dashboards`) (https://apidocs.sessionboard.com/api-reference/overview, https://apidocs.sessionboard.com/insights/overview). "Reports, Dashboards, and related query APIs are currently available to select organizations" (early access), gated by org-level AI/analytics enablement plus the `read:insights` token scope.

### 2e. Public API

#### Auth flow

Two mechanisms (https://apidocs.sessionboard.com/authentication):

1. **API tokens** (server-to-server). Generated in the admin app: **Organization Settings → API Tokens → Generate Token**, choosing a name, **scopes**, an **MCP Access** toggle (for AI assistants), **Hide PII** (default on — emails come back as `j***@a***.com`, phones as `***-***-4567`), and optional **event restrictions** (https://learn.sessionboard.com/integrations/api-tokens). Token value shown **once**, unrecoverable even by staff. Sent as header **`x-access-token: YOUR_TOKEN`** on every request. All calls are audit-logged with source, method, response time, token ID.
2. **OAuth 2.1 + PKCE** (AI clients — Claude/ChatGPT/MCP) (https://apidocs.sessionboard.com/oauth): `GET /oauth/authorize` (S256 PKCE, `response_type=code`) → consent at `appv2.sessionboard.com/oauth/consent` → `POST /oauth/token` (`authorization_code` grant, `code_verifier`, no client secret) → `Authorization: Bearer <access_token>`. Access tokens live **1 hour**; refresh tokens **7 days, rotated on each use**. `POST /oauth/revoke` (RFC 7009, always 200); metadata at `GET /oauth/.well-known/oauth-authorization-server` (RFC 8414). OAuth tokens are **read-only** (no `write:*` scopes) and inherit the authorizing user's permissions dynamically (revoking "AI Access" kills the token on the next request).

Base URLs: `https://public-api.sessionboard.com` (US) and `https://public-api-eu.sessionboard.com` (EU) (https://apidocs.sessionboard.com/introduction). MCP server: `https://mcp.sessionboard.com/mcp` (US) / `mcp-eu` (EU), 27 tools, requires `read:insights` + MCP Access (https://learn.sessionboard.com/integrations/api-tokens).

**Scopes** (https://apidocs.sessionboard.com/authentication): reads — `read:events`, `read:sessions`, `read:contacts`, `read:reports`, `read:dashboards`, `read:insights` (Reports/Dashboards/SbQL + MCP), `read:transcriptions`, `read:media`; writes — `write:sessions`, `write:contacts`, `write:exhibitors`, `write:sponsors`, `write:fields`, `write:metadata`, `write:transcriptions`, `write:media`, `write:events` (agenda drafts, rules, personas, dashboards, widgets, saved reports). Legacy tokens (empty scope array) get all reads implicitly, never writes.

#### Conventions (https://apidocs.sessionboard.com/introduction, /api-reference/overview)

- **Pagination**: `page` + `pageSize` (default 25, max 100); responses carry `pagination: {currentPage, pageSize, totalPages, totalResults}`. Legacy search endpoints wrap rows in `results`, newer ones in `data` — check per endpoint.
- **Search vs create**: search is `POST` on the collection path with `filters`/`sort`/`expand` in the body; creation uses a **`/create` suffix** (`POST …/sessions` searches, `POST …/sessions/create` creates). Transcriptions/recordings/files use plain REST instead.
- **Sorting**: body `sort` object — field `createdAt`|`updatedAt`, direction `asc`|`desc`.
- **Expand**: `translated_fields` (most reads), `subsession_details`, `linked_sources`, `composition` (session search/get).
- **Optimistic concurrency**: send `updated_at` on updates; stale writes get **409** (re-fetch and retry).
- **Rate limits** (https://apidocs.sessionboard.com/rate-limiting): **100 req / 15 min per token per category** (~11 independent buckets: entity reads, session writes, contact writes, …, insights). Headers `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`; 429 carries `Retry-After`. Legacy read/search endpoints (`GET /v1/events`, the POST search family, GDPR, org contacts) enforce **no** limits today. Custom limits per token via support.
- **Write quota**: create endpoints are additionally "subject to … daily write quota (10,000/day per token)" (https://apidocs.sessionboard.com/llms.txt entries for create-a-contact/session/sponsor/exhibitor). Bulk endpoints take max **100 operations** and count as one request.
- **Caching**: `GET …/sessions/{sessionId}` and `POST …/sessions` (search) cached **3 minutes**; webhooks are real-time.
- **Errors**: 200/400/401/403/404/409/429/500 with `{"error": "...", "message": "..."}` bodies.

#### Key resource shapes (from https://apidocs.sessionboard.com/api-reference/openapi.yaml)

`Session` (37 props): `id` (uuid), `friendly_id`/`friendly_id_raw`, `title`, `description`, `status` (`accepted|accept_queue|pending|decline_queue|declined`), `custom_status_id`/`custom_status`, `starts_at`/`ends_at`, `is_public`, `is_abstract`, `composition_status`, `composition`, `external_url`, `client_session_id`, `created_at`/`updated_at`, `ceu_credits`, `capacity`, `custom_fields`, `translated_fields`, `speakers`/`chairpersons`/`moderators` (legacy role arrays), `participants` (Sessions 2.0, each with `participant_role {slug,name,name_plural,core_role}`), `sponsors`, `exhibitors`, `content`, `tags`, nested `language`/`track`/`level`/`format`/`room` objects (`{}` when unassigned on search, `null` on CRUD-proxy routes), `subsessions[]`, `admin_url`.

`Contact`: `id`, `friendly_id`, name/email fields, `photo_url`, `company_name`, `title`, `about`, phones, address fields, social URLs, `honorific`, `pronouns`, `gender`, speaker profile fields (`speaker_score`, `speaker_fee`, `availability`, `preferred_session_format`, `topic_expertise`, …), org fields (`annual_revenue`, `headcount`, `industry`, …), `organization_contact`, `translated_fields`, `custom_fields`, `admin_url`.

**Search sessions** — the most important endpoint (`POST /v1/event/{eventId}/sessions`):

```jsonc
// Request body
{
  "filters": {
    "createdAt": { "before": "ISO-8601", "after": "ISO-8601" },
    "updatedAt": { "before": "ISO-8601", "after": "ISO-8601" },
    "status": "accepted",          // accepted | accept_queue | pending | decline_queue | declined
    "isAbstract": false
  },
  "sort": { "order": "updatedAt", "sort": "desc" },   // order: createdAt|updatedAt
  "expand": ["subsession_details", "composition"]      // + translated_fields, linked_sources
}
// page & pageSize travel as query/body params; response:
{ "results": [ /* Session[] */ ], "pagination": { "currentPage": 1, "pageSize": 25, "totalPages": 10, "totalResults": 250 } }
```

**Create session** (`POST /v1/event/{eventId}/sessions/create`, `write:sessions`): body `{ title* , description, starts_at, ends_at, capacity, room_id, track_id, level_id, format_id, language_id, parent_session_id, tag_ids[], status, is_public, is_abstract, custom_fields{} }` — only `title` is required.

**List events** (`GET /v1/events`): query `page`/`pageSize`; returns `results: [{ id, name, timezone, features }]` + `pagination`. Speaker/contact/sponsor/exhibitor searches all take the same generic `{filters:{createdAt,updatedAt,status}, sort, expand}` body (`RecordSearchBody`).

#### Webhooks (https://apidocs.sessionboard.com/webhooks)

Created in the admin UI at **Settings > Integrations > Webhooks** → Add Endpoint (public HTTPS URL) → pick events → save; optional **custom headers** for authenticating deliveries (no HMAC signature scheme documented). A **Testing** tab sends sample payloads (docs suggest Svix Play for inspection); per-endpoint delivery logs show payloads and status codes; failed deliveries retry with exponential backoff.

**Event catalog — 20 events, 4 entities:**

| Entity | Events |
|---|---|
| Contact | `contact.created`, `contact.updated`, `contact.deleted`, `contact.event.associated`, `contact.event.disassociated` |
| Session | `session.created`, `session.updated`, `session.deleted`, `session.speaker.attached`, `session.speaker.detached` |
| Exhibitor | `exhibitor.created`, `exhibitor.updated`, `exhibitor.deleted`, `exhibitor.event.associated`, `exhibitor.event.disassociated` |
| Sponsor | `sponsor.created`, `sponsor.updated`, `sponsor.deleted`, `sponsor.event.associated`, `sponsor.event.disassociated` |

Payload: `{ data: <full resource object + sourceOfChange>, metadata: { action, actor_id (null for system), event_id (null for org-level), org_id, resource_url, version: 1, datetime } }`. Consumers must ignore unknown fields; breaking changes bump `metadata.version`.

#### Other sync channels (https://apidocs.sessionboard.com/integrations)

- **Embeds**: unauthenticated JSON/XML/HTML feed URLs per event, refreshed every **60 minutes**; configured at **Event Settings > Integrations > Embeds**.
- **Zapier**: beta, enabled per org by support.
- **Insights / SbQL** (https://apidocs.sessionboard.com/insights/sbql): SQL-like `SELECT … FROM sessions WHERE …` with JOINs and aggregates; `FIND Session` = program sessions only, `FIND Abstract` = CFP submissions; schema discovery endpoints return entities/fields/relationships incl. per-event `session_participant_roles`; `POST /v1/insights/ai/generate` converts natural language to SbQL. Early access.

## 3. API endpoint inventory (compatibility target)

All 177 operations from `openapi.yaml` (fetched 2026-08-08), grouped by tag. Auth: `x-access-token` header or `Authorization: Bearer` on every `/v1/*` route. All search (`POST` collection) endpoints take the `filters`/`sort`/`expand` body + `page`/`pageSize` and return `{results|data, pagination}`. Scope notes from https://apidocs.sessionboard.com/llms.txt; endpoints without a scope note require only the default read access of the token.

#### Events (1)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/events` | List events |  |

#### Sessions (4)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/sessions` | Search sessions | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/sessions` | List sessions (CRUD proxy) |  |
| POST | `/v1/event/{eventId}/sessions/status` | Search sessions by status | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}` | Get a session |  |

#### Session Writes (6)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| PUT | `/v1/event/{eventId}/sessions/{sessionId}` | Update a session | `write:sessions` |
| DELETE | `/v1/event/{eventId}/sessions/{sessionId}` | Soft-delete a session | `write:sessions` |
| PUT | `/v1/event/{eventId}/sessions/{sessionId}/fields` | Update session custom fields | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/create` | Create a session | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/restore` | Restore a deleted session | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/bulk` | Bulk session operations | `write:sessions` |

#### Speakers (2)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/speakers` | Search speakers | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/speakers/{contactId}` | Get a speaker |  |

#### Contacts (6)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/organization/{orgId}/contacts` | Search organization contacts | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/organization/{orgId}/contacts/{contactId}` | Get an organization contact |  |
| POST | `/v1/event/{eventId}/contacts` | Search event contacts | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/contacts/{contactId}` | Get an event contact |  |
| GET | `/v1/event/{eventId}/contacts/{contactId}/sessions` | Get a contact's sessions |  |
| GET | `/v1/organization/{orgId}/contacts/{contactId}/sessions` | Get an org contact's sessions |  |

#### Contact Writes (5)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| PUT | `/v1/event/{eventId}/contacts/{contactId}` | Update a contact | `write:contacts` |
| DELETE | `/v1/event/{eventId}/contacts/{contactId}` | Soft-delete a contact | `write:contacts` |
| POST | `/v1/event/{eventId}/contacts/create` | Create a contact | `write:contacts` |
| POST | `/v1/event/{eventId}/contacts/{contactId}/restore` | Restore a deleted contact | `write:contacts` |
| POST | `/v1/event/{eventId}/contacts/bulk` | Bulk contact operations | `write:contacts` |

#### Sponsors (2)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/sponsors` | Search sponsors | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/sponsors/{sponsorId}` | Get a sponsor |  |

#### Sponsor Writes (5)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| PUT | `/v1/event/{eventId}/sponsors/{sponsorId}` | Update a sponsor | `write:sponsors` |
| DELETE | `/v1/event/{eventId}/sponsors/{sponsorId}` | Soft-delete a sponsor | `write:sponsors` |
| POST | `/v1/event/{eventId}/sponsors/create` | Create a sponsor | `write:sponsors` |
| POST | `/v1/event/{eventId}/sponsors/{sponsorId}/restore` | Restore a deleted sponsor | `write:sponsors` |
| POST | `/v1/event/{eventId}/sponsors/bulk` | Bulk sponsor operations | `write:sponsors` |

#### Exhibitors (2)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/exhibitors` | Search exhibitors | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/exhibitors/{exhibitorId}` | Get an exhibitor |  |

#### Exhibitor Writes (5)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| PUT | `/v1/event/{eventId}/exhibitors/{exhibitorId}` | Update an exhibitor | `write:exhibitors` |
| DELETE | `/v1/event/{eventId}/exhibitors/{exhibitorId}` | Soft-delete an exhibitor | `write:exhibitors` |
| POST | `/v1/event/{eventId}/exhibitors/create` | Create an exhibitor | `write:exhibitors` |
| POST | `/v1/event/{eventId}/exhibitors/{exhibitorId}/restore` | Restore a deleted exhibitor | `write:exhibitors` |
| POST | `/v1/event/{eventId}/exhibitors/bulk` | Bulk exhibitor operations | `write:exhibitors` |

#### Event Settings (16)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/fields` | List fields |  |
| POST | `/v1/event/{eventId}/fields` | Search fields | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/tags` | List tags |  |
| POST | `/v1/event/{eventId}/tags` | Search tags | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/languages` | List languages |  |
| POST | `/v1/event/{eventId}/languages` | Search languages | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/formats` | List formats |  |
| POST | `/v1/event/{eventId}/formats` | Search formats | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/tracks` | List tracks |  |
| POST | `/v1/event/{eventId}/tracks` | Search tracks | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/levels` | List levels |  |
| POST | `/v1/event/{eventId}/levels` | Search levels | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/rooms` | List rooms |  |
| POST | `/v1/event/{eventId}/rooms` | Search rooms | body: `filters`/`sort`/`expand` + `page`,`pageSize` |
| GET | `/v1/event/{eventId}/statuses` | List session statuses |  |
| POST | `/v1/event/{eventId}/session-statuses` | Search session statuses | body: `filters`/`sort`/`expand` + `page`,`pageSize` |

#### Metadata Writes (22)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/rooms/create` | Create a room | `write:metadata` |
| PUT | `/v1/event/{eventId}/rooms/{id}` | Update a room | `write:metadata` |
| DELETE | `/v1/event/{eventId}/rooms/{id}` | Delete a room | `write:metadata` |
| POST | `/v1/event/{eventId}/tracks/create` | Create a track | `write:metadata` |
| PUT | `/v1/event/{eventId}/tracks/{id}` | Update a track | `write:metadata` |
| DELETE | `/v1/event/{eventId}/tracks/{id}` | Delete a track | `write:metadata` |
| POST | `/v1/event/{eventId}/tags/create` | Create a tag | `write:metadata` |
| PUT | `/v1/event/{eventId}/tags/{id}` | Update a tag | `write:metadata` |
| DELETE | `/v1/event/{eventId}/tags/{id}` | Delete a tag | `write:metadata` |
| POST | `/v1/event/{eventId}/formats/create` | Create a format | `write:metadata` |
| PUT | `/v1/event/{eventId}/formats/{id}` | Update a format | `write:metadata` |
| DELETE | `/v1/event/{eventId}/formats/{id}` | Delete a format | `write:metadata` |
| POST | `/v1/event/{eventId}/levels/create` | Create a level | `write:metadata` |
| PUT | `/v1/event/{eventId}/levels/{id}` | Update a level | `write:metadata` |
| DELETE | `/v1/event/{eventId}/levels/{id}` | Delete a level | `write:metadata` |
| POST | `/v1/event/{eventId}/languages/create` | Create a language | `write:metadata` |
| PUT | `/v1/event/{eventId}/languages/{id}` | Update a language | `write:metadata` |
| DELETE | `/v1/event/{eventId}/languages/{id}` | Delete a language | `write:metadata` |
| POST | `/v1/event/{eventId}/statuses/create` | Create a session status | `write:metadata` |
| PUT | `/v1/event/{eventId}/statuses/{id}` | Update a session status | `write:metadata` |
| DELETE | `/v1/event/{eventId}/statuses/{id}` | Delete a session status | `write:metadata` |
| POST | `/v1/event/{eventId}/statuses/{id}/restore` | Restore a deleted session status | `write:metadata` |

#### Agenda Planning (22)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/agenda-drafts` | List agenda drafts |  |
| POST | `/v1/event/{eventId}/agenda-drafts/create` | Create an agenda draft | `write:events` |
| GET | `/v1/event/{eventId}/agenda-drafts/{draftId}` | Get an agenda draft |  |
| PUT | `/v1/event/{eventId}/agenda-drafts/{draftId}` | Update an agenda draft | `write:events` |
| DELETE | `/v1/event/{eventId}/agenda-drafts/{draftId}` | Delete an agenda draft | `write:events` |
| GET | `/v1/event/{eventId}/agenda-drafts/{draftId}/changes` | Preview draft changes |  |
| POST | `/v1/event/{eventId}/agenda-drafts/{draftId}/commit` | Commit an agenda draft | `write:events` |
| GET | `/v1/event/{eventId}/agenda-drafts/{draftId}/sessions` | List draft sessions |  |
| POST | `/v1/event/{eventId}/agenda-drafts/{draftId}/sessions/create` | Create a draft session | `write:events` |
| PUT | `/v1/event/{eventId}/agenda-drafts/{draftId}/sessions/{draftSessionId}` | Update a draft session | `write:events` |
| DELETE | `/v1/event/{eventId}/agenda-drafts/{draftId}/sessions/{draftSessionId}` | Remove a draft session | `write:events` |
| POST | `/v1/event/{eventId}/agenda-drafts/{draftId}/sessions/bulk` | Bulk draft session operations | `write:events` |
| GET | `/v1/event/{eventId}/rules` | List event rules |  |
| POST | `/v1/event/{eventId}/rules/create` | Create an event rule | `write:events` |
| GET | `/v1/event/{eventId}/rules/{ruleId}` | Get an event rule |  |
| PUT | `/v1/event/{eventId}/rules/{ruleId}` | Update an event rule | `write:events` |
| DELETE | `/v1/event/{eventId}/rules/{ruleId}` | Delete an event rule | `write:events` |
| GET | `/v1/event/{eventId}/personas` | List personas |  |
| POST | `/v1/event/{eventId}/personas/create` | Create a persona | `write:events` |
| GET | `/v1/event/{eventId}/personas/{personaId}` | Get a persona |  |
| PUT | `/v1/event/{eventId}/personas/{personaId}` | Update a persona | `write:events` |
| DELETE | `/v1/event/{eventId}/personas/{personaId}` | Delete a persona | `write:events` |

#### Insights (28)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/dashboards` | List dashboards | `read:insights` |
| POST | `/v1/event/{eventId}/dashboards/create` | Create a dashboard | `write:events` |
| GET | `/v1/event/{eventId}/dashboards/{id}` | Get a dashboard | `read:insights` |
| PUT | `/v1/event/{eventId}/dashboards/{id}` | Update a dashboard | `write:events` |
| DELETE | `/v1/event/{eventId}/dashboards/{id}` | Delete a dashboard | `write:events` |
| POST | `/v1/event/{eventId}/dashboards/{dashboardId}/widgets/create` | Create a widget | `write:events` |
| PUT | `/v1/event/{eventId}/widgets/{widgetId}` | Update a widget | `write:events` |
| DELETE | `/v1/event/{eventId}/widgets/{widgetId}` | Delete a widget | `write:events` |
| GET | `/v1/event/{eventId}/queries` | List saved queries for an event | `read:insights` |
| POST | `/v1/event/{eventId}/queries/create` | Create a saved query | `write:events` |
| PUT | `/v1/event/{eventId}/queries/{queryId}` | Update a saved query | `write:events` |
| DELETE | `/v1/event/{eventId}/queries/{queryId}` | Delete a saved query | `write:events` |
| POST | `/v1/event/{eventId}/queries/{queryId}/run` | Run a saved query for an event | `write:events` |
| POST | `/v1/event/{eventId}/insights/execute` | Execute a SbQL query (event-scoped) | `read:insights` |
| POST | `/v1/event/{eventId}/insights/ai/generate` | Generate a SbQL query from natural language (event-scoped) | `read:insights` |
| GET | `/v1/event/{eventId}/insights/schema` | Get event-scoped insights schema | `read:insights` |
| GET | `/v1/event/{eventId}/insights/suggestions` | Get event-scoped query suggestions | `read:insights` |
| GET | `/v1/event/{eventId}/insights/queries` | List saved queries (event-scoped insights) | `read:insights` |
| POST | `/v1/event/{eventId}/insights/queries/{queryId}/run` | Run a saved query (event-scoped insights) | `read:insights` |
| GET | `/v1/event/{eventId}/insights/dashboards/{id}` | Get a dashboard (event-scoped insights) | `read:insights` |
| POST | `/v1/insights/execute` | Execute a SbQL query | `read:insights` |
| POST | `/v1/insights/ai/generate` | Generate a SbQL query from natural language | `read:insights` |
| GET | `/v1/insights/schema` | Get insights schema | `read:insights` |
| GET | `/v1/insights/events/{eventId}/schema` | Get event-specific insights schema | `read:insights` |
| GET | `/v1/insights/suggestions` | Get query suggestions | `read:insights` |
| GET | `/v1/insights/queries` | List saved queries | `read:insights`; paginated (`page`,`pageSize`) |
| POST | `/v1/insights/queries/{queryId}/run` | Run a saved query | `read:insights` |
| GET | `/v1/insights/dashboards/{id}` | Get a dashboard | `read:insights` |

#### Dashboards & Widgets (8)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/dashboards` | List org dashboards (convenience) | `read:insights` |
| POST | `/v1/dashboards/create` | Create an org dashboard (convenience) | `write:events` |
| GET | `/v1/dashboards/{id}` | Get an org dashboard (convenience) | `read:insights` |
| PUT | `/v1/dashboards/{id}` | Update an org dashboard (convenience) | `write:events` |
| DELETE | `/v1/dashboards/{id}` | Delete an org dashboard (convenience) | `write:events` |
| POST | `/v1/dashboards/{dashboardId}/widgets/create` | Create an org widget (convenience) | `write:events` |
| PUT | `/v1/widgets/{widgetId}` | Update an org widget (convenience) | `write:events` |
| DELETE | `/v1/widgets/{widgetId}` | Delete an org widget (convenience) | `write:events` |

#### Reports & Queries (5)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/queries` | List org saved queries (convenience) | `read:insights`; paginated (`page`,`pageSize`) |
| POST | `/v1/queries/create` | Create an org saved query (convenience) | `write:events` |
| PUT | `/v1/queries/{queryId}` | Update an org saved query (convenience) | `write:events` |
| DELETE | `/v1/queries/{queryId}` | Delete an org saved query (convenience) | `write:events` |
| POST | `/v1/queries/{queryId}/run` | Run an org saved query (convenience) | `write:events` |

#### GDPR (2)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/gdpr/requests` | List GDPR requests |  |
| POST | `/v1/gdpr/requests` | Create a GDPR request |  |

#### Field Writes (3)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/fields/create` | Create a custom field | `write:fields` |
| PUT | `/v1/event/{eventId}/fields/{fieldId}` | Update a custom field |  |
| DELETE | `/v1/event/{eventId}/fields/{fieldId}` | Delete a custom field |  |

#### OAuth (4)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/oauth/authorize` | Validate authorization request |  |
| POST | `/oauth/token` | Exchange code for tokens |  |
| POST | `/oauth/revoke` | Revoke a token |  |
| GET | `/oauth/.well-known/oauth-authorization-server` | Authorization server metadata |  |

#### Transcriptions (13)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/content` | List composed session content for an event |  |
| GET | `/v1/event/{eventId}/content/event` | Get event-level content artifacts | `read:transcriptions` |
| GET | `/v1/event/{eventId}/content/items/{itemId}` | Get a single content item | `read:transcriptions` |
| GET | `/v1/event/{eventId}/content/documents/{documentType}` | Download an event content document | `read:transcriptions` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/content` | Get composed content for a session |  |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/content/documents/{documentType}` | Download a session content document | `read:transcriptions` |
| GET | `/v1/event/{eventId}/transcriptions` | List transcriptions for an event | `read:transcriptions` |
| GET | `/v1/event/{eventId}/transcriptions/{transcriptionId}` | Get a transcription by ID | `read:transcriptions` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/transcriptions` | List transcriptions for a session | `read:transcriptions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/transcriptions` | Create a transcription artifact | `write:transcriptions` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/transcriptions/{transcriptionId}` | Get a session transcription by ID | `read:transcriptions` |
| PUT | `/v1/event/{eventId}/sessions/{sessionId}/transcriptions/{transcriptionId}` | Update a transcription artifact | `write:transcriptions` |
| DELETE | `/v1/event/{eventId}/sessions/{sessionId}/transcriptions/{transcriptionId}` | Delete a transcription artifact | `write:transcriptions` |

#### Session Recordings (4)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/sessions/{sessionId}/recordings` | List session audio recordings | `read:transcriptions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/recordings` | Initiate session audio upload | `write:transcriptions` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/recordings/{recordingId}` | Get a session audio recording | `read:transcriptions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/recordings/{recordingId}/complete` | Finalize session audio upload | `write:transcriptions` |

#### Media (5)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/event/{eventId}/sessions/{sessionId}/media/upload/initiate` | Start multipart media upload | `write:media` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/media/upload/sign-part` | Sign multipart upload parts | `write:media` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/media/upload/abort` | Abort multipart upload | `write:media` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/media/upload/complete` | Complete multipart media upload | `write:media` |
| GET | `/v1/event/{eventId}/sessions/{sessionId}/media/{mediaItemId}` | Get media item status | `read:media` |

#### Session Files (7)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/v1/event/{eventId}/sessions/{sessionId}/files` | List files attached to a session | `read:sessions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/files` | Initiate session file upload | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/files/upload` | Upload a session file (simple) | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/files/{fileId}/complete` | Finalize session file upload | `write:sessions` |
| POST | `/v1/event/{eventId}/sessions/{sessionId}/files/{fileId}/replace` | Replace session file bytes | `write:sessions` |
| PUT | `/v1/event/{eventId}/sessions/{sessionId}/files/{fileId}` | Update session file metadata | `write:sessions` |
| DELETE | `/v1/event/{eventId}/sessions/{sessionId}/files/{fileId}` | Delete a session file | `write:sessions` |
Not in the OpenAPI spec but documented on the OAuth guide (https://apidocs.sessionboard.com/oauth): `POST /oauth/authorize/consent` (user approval → auth code) and `GET /oauth/eligible-orgs` (orgs where the user has AI Access) — implement these too for OAuth parity.

## 4. Screenshots

All downloaded 2026-08-08 into `img/08-settings-api/` and verified with `file(1)` (the four `webhooks-*` files are JPEGs served by Mintlify's CDN despite the source `.png` names).

| File | Caption | Source |
|---|---|---|
| `branding-dimensions-1.png` | Event logo (300×300) & banner (1500×500) dimension reference card | https://learn.sessionboard.com/settings/branding-assets-dimensions (`/images/kb/132ad9b9-Screenshot-2025-09-30-at-6.59.40-PM.png`) |
| `branding-event-details-upload.png` | Event Details page in Settings — where logo/banner are uploaded | https://learn.sessionboard.com/settings/branding-assets-dimensions (`/images/kb/e4f91aa2-image-png-Jul-08-2026-05-59-11-1519-PM.png`) |
| `import-options-menu.png` | Module `Options > Import` entry point | https://learn.sessionboard.com/settings/importing-data (`/images/kb/0894e81a-…`) |
| `import-generate-template.png` | Import modal — "Generate Import Template" (CSV) | https://learn.sessionboard.com/settings/importing-data (`/images/kb/bc7e60db-…`) |
| `import-map-fields.png` | Field-mapping step (event fields ↔ file columns, Ignore this column) | https://learn.sessionboard.com/settings/importing-data (`/images/kb/73e507f2-…`) |
| `import-validate-rows.png` | Validation step — invalid cells highlighted red | https://learn.sessionboard.com/settings/importing-data (`/images/kb/82381418-…`) |
| `import-update-existing-column.png` | "Update record if already exists" = TRUE column for update imports | https://learn.sessionboard.com/settings/importing-data (`/images/kb/5c295274-…`) |
| `csv-import-fail-error.png` | "File upload was unable to be processed" failure after clean validation | https://learn.sessionboard.com/faq/common-csv-xlsx-import-issues-and-how-to-fix-them (`/images/kb/55005eef-…`) |
| `bulk-edit-button.png` | Bulk Edit button on a module list | https://learn.sessionboard.com/settings/bulk-edit-fields (`/images/kb/4e3f12f0-…`) |
| `export-button.png` | Options > Export (CSV/Excel) on a module list | https://learn.sessionboard.com/reporting/exporting-data (`/images/kb/e492b75b-…`) |
| `views-columns.png` | Columns editor for a module table view | https://learn.sessionboard.com/reporting/dashboard-views (`/images/kb/588de5fc-…`) |
| `views-filter-operators.png` | Filter operator list (contains/is/is empty/starts with/…) | https://learn.sessionboard.com/reporting/dashboard-views (`/images/kb/e10b1ffe-…`) |
| `views-save-view.png` | Save-view control (views persist per module, visible to all admins) | https://learn.sessionboard.com/reporting/dashboard-views (`/images/kb/09d8ce85-…`) |
| `webhooks-settings-panel.jpg` | Settings > Integrations > Webhooks panel | https://apidocs.sessionboard.com/webhooks (mintcdn `images/webhooks1.png`) |
| `webhooks-add-endpoint.jpg` | Add Endpoint dialog with event subscription picker | https://apidocs.sessionboard.com/webhooks (mintcdn `images/webhooks2.png`) |
| `webhooks-testing.jpg` | Webhook Testing tab (send sample payload) | https://apidocs.sessionboard.com/webhooks (mintcdn `images/webhooks3.png`) |
| `webhooks-delivery-logs.jpg` | Webhook delivery logs with status codes | https://apidocs.sessionboard.com/webhooks (mintcdn `images/webhooks5.png`) |
| `integration-methods-diagram.png` | Sessionboard's own decision diagram: API+Webhooks vs Embeds vs Zapier vs Exports | https://apidocs.sessionboard.com/integrations (mintcdn `images/sessionboard-integration-workflow.png`) |

## 5. Gaps

- **No event CRUD over the API.** `GET /v1/events` is the only Events endpoint — events (and their details/branding/record settings) are created and edited in the UI only. Our clone needs UI-side event settings regardless of API parity.
- **Import/export have no API.** CSV import and module export are UI-only; the API substitute is `/bulk` writes (100 ops max) + search endpoints. If judges test import, it's a UI feature.
- **"Library" of fields/tags/personas**: the provided KB pages document per-event fields/tags/tracks/etc. and the API documents event-scoped CRUD for them, but no source describes an org-level shared library UI. Personas appear only in the Agenda Planning API (schedule-evaluation constructs); no KB coverage.
- **Webhook security**: only "custom headers" are documented for verifying deliveries; no HMAC/signature scheme, no delivery ordering or retry schedule specifics (beyond "exponential backoff"). Svix is referenced for testing, hinting at Svix-based infra.
- **Insights/SbQL/dashboards are early access** ("available to select organizations") and org-gated; SbQL grammar is only sketched (SELECT/FROM/WHERE/JOIN/GROUP BY examples, `FIND Session`/`FIND Abstract`), with the full grammar in an internal `sbql-reference.md` we can't fetch. Evaluation-plan data in SbQL reads legacy tables and may not match Sessions 2.0 UI/exports.
- **Two spec artifacts disagree**: `/api-reference/openapi.json` is a stale "Sessions 1.0" spec (18 read ops, `API Key` scheme without header name); `/api-reference/openapi.yaml` (177 ops, `x-access-token` + Bearer) is canonical.
- **Response envelope inconsistency** (`results` vs `data`, `{}` vs `null` for unassigned nested metadata) is documented per-endpoint; a compatible clone must reproduce it endpoint-by-endpoint, not normalize it.
- **KB webhooks page** (https://learn.sessionboard.com/integrations/webhooks) is a stub deferring to apidocs; KB "dashboard views" page covers table views, and the analytics dashboards KB page (`/reporting/insights-ai`) was outside the source list — analytics-dashboard UI behavior is documented here only via the API.
- **Not stated anywhere fetched**: webhook payload delivery SLA, API uptime/SLA, export row limits, whether exports run async for large datasets, XLSX vs CSV fidelity differences.
