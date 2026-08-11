# Route map — canonical file → URL ownership

File-based routing (`@react-router/fs-routes`) removes the shared-`routes.ts`
chokepoint, but two agents could still independently create the same filename or
resolve to the same URL. This table is the **authoritative assignment**: build
your feature's route only at the path listed here. One filename = one owner. Add
your sidebar entry as `app/nav/<feature>.nav.ts` (never a shared nav file).
`$param` = dynamic segment; `admin.*` routes render inside the `admin.tsx` shell.

| Feature | Route file | URL | Wave | Status |
|---|---|---|---|---|
| Home | `_index.tsx` | `/` | 0 | done |
| Login / Logout / 403 | `login.tsx` · `logout.tsx` · `403.tsx` | `/login` `/logout` `/403` | 0 | done |
| Admin shell (layout) | `admin.tsx` | `/admin/*` | 0 | done |
| Dashboard | `admin._index.tsx` | `/admin` | 0/3 | done |
| Submissions (all) | `admin.submissions.tsx` | `/admin/submissions` | 0/1 | done (golden path) |
| Abstracts / Sessions tabs | `admin.abstracts.tsx` · `admin.sessions.tsx` | `/admin/abstracts` · `/admin/sessions` | 1 | done |
| Submission detail/edit | `admin.submissions_.$id.tsx` (flat `_`: `admin.submissions.tsx` is a page, not a layout) | `/admin/submissions/:id` | 1 | done |
| Form builder (list) | `admin.forms.tsx` | `/admin/forms` | 1 | done |
| Form builder (editor) | `admin.forms.$formId.tsx` | `/admin/forms/:formId` | 1 | done |
| Evaluation | `admin.evaluation.tsx` | `/admin/evaluation` | 3 | done |
| Agenda | `admin.agenda.tsx` | `/admin/agenda` | 3 | done |
| Tasks dashboard | `admin.tasks.tsx` | `/admin/tasks` | 3 | done |
| Email templates | `admin.emails.tsx` · `admin.emails_.$key.tsx` (underscore: the editor must not nest inside the list route) | `/admin/emails` · `/admin/emails/:key` | 1 | done |
| Event settings | `admin.settings.tsx` (shell: header+tabs) · `admin.settings._index.tsx` (details + images) | `/admin/settings` | 1 | done |
| Library (taxonomies + fields) | `admin.settings.library.tsx` | `/admin/settings/library` | 0/1 | done |
| Portals admin | `admin.portals.tsx` (list + "View portal as" preview) · `admin.portal-forms.tsx` (portal-form builder) | `/admin/portals` · `/admin/portal-forms` | 3 | done — `admin.file-requests.tsx` proposed dropped: file requests already ship as `isFileRequest` task definitions (owner ratifies by merging the portal-admin PR that carries this row) |
| Public CFP | `submit.$eventSlug.$formId.tsx` (+ `.step.*`) | `/submit/:eventSlug/:formId` | 2 | done |
| Speaker portal | `portals.$eventSlug.$portalId.tsx` (+ `_index/home/submissions/submissions_.$submissionId/profile/tasks/tasks_.$assignmentId/files/files_.$fileId/headshot/logo` children) | `/portals/:eventSlug/:portalId/*` | 2 | done |
| Portal resolver (speaker login landing) | `portal.tsx` | `/portal` (resolves the user's portal, else designed empty state) | 2 | done |
| Create event | `admin.events.new.tsx` | `/admin/events/new` | 1 | done |
| Event switcher (action) | `admin.events.switch.tsx` | `/admin/events/switch` (POST → sets `users.activeEventId`; membership-guarded) | 0/1 | done |
| Reviewer management | `admin.reviewers.tsx` | `/admin/reviewers` (add reviewer + track assignment + invite) | 1 | done |
| Reviewer "My Reviews" (reviewer role) | `reviews.tsx` · `reviews.$id.tsx` | `/reviews` · `/reviews/:id` (NOT under `admin.*`) | 1 | done |
| Set / reset password (invite + forgot landing) | `set-password.$token.tsx` | `/set-password/:token` | 1 | done |
| Forgot password (request) | `forgot-password.tsx` | `/forgot-password` (`// @public`) | 1 | done |
| Unsubscribe | `unsubscribe.$token.tsx` | `/unsubscribe/:token` (signed token; `// @public`) | 1 | done |
| Email history log | `admin.emails_.history.tsx` (underscore: sibling of the list route, not its child) | `/admin/emails/history` | 1 | done |
| Task response view (admin) | `admin.tasks_.$assignmentId.tsx` | `/admin/tasks/:assignmentId` (trailing `_` opts out of nesting under the dashboard) | 1 | done |
| File upload (presign/mediate) + download | `files.upload.tsx` · `files.$id.tsx` | `/files/upload` (POST) · `/files/:id` (GET bytes, authz-checked) | 1 | done |
| Central files library + file detail | `admin.files.tsx` · `admin.files_.$id.tsx` | `/admin/files` (library, CNT-13) · `/admin/files/:id` (versions, approve/deny, comments) | 1 | done |
| Contact record (admin) | `admin.contacts_.$id.tsx` | `/admin/contacts/:id` | 1 | done |
| Contact headshot bytes (admin, resource route) | `admin.contacts_.$id.headshot.tsx` | `/admin/contacts/:id/headshot` (GET bytes, admin-authz, event-scoped) | 1 | done |
| CSV export (resource route) | `admin.submissions.export[.csv].tsx` | `/admin/submissions/export.csv` (COMMITTED, P2 #3; honors `type`/`status` filters) | 2 | done |
| Contacts / speaker roster (list) | `admin.contacts.tsx` | `/admin/contacts` (search, status filter, + Add) — P1 #17 | 1 | done |
| Speaker CSV import | `admin.contacts_.import.tsx` | `/admin/contacts/import` (upload → map → dedupe) | 1 | done |
| Compose bulk email to speakers | `admin.contacts_.compose.tsx` | `/admin/contacts/compose` (merge fields + preview) | 1 | done |
| Evaluation plan editor | `admin.evaluation.$planId.tsx` | `/admin/evaluation/:planId` (rounds/scorecards/pools/assignments) | 3 | done |
| Evaluation results export | `admin.evaluation.export[.csv].tsx` | `/admin/evaluation/export.csv` | 3 | done |
| Embeds admin | `admin.embeds.tsx` · `admin.embeds_.$id.tsx` (trailing `_`: the editor renders standalone, not nested under the list) | `/admin/embeds` · `/admin/embeds/:id` (P1 #16, EMB-15) | 2 | done |
| Files ZIP bundle (resource) | `admin.files.export[.zip].tsx` | `/admin/files/export.zip` (latest versions, grouped) | 2 | done |
| Team admins (org members) | `admin.settings.team.tsx` | `/admin/settings/team` (org-member invite + remove w/ last-member guard, P1 #21/#22 Wave D) | 1 | done |
| API tokens (org) | `admin.settings.api.tsx` | `/admin/settings/api` (list/create/revoke org API tokens; show-once mint, per-token event restriction; flows/09 rule p) | 3 | done |
| Organizer sign-up | `signup.tsx` | `/signup` (`// @public`; existing-email → decided sign-in message; P1 #22 Wave C) | 2 | done |
| Org onboarding | `onboarding.tsx` | `/onboarding` (one form: org name + first event; auth'd, membership-less users only; P1 #22 Wave C) | 2 | done |
| Public sessions list | `sessions.$eventSlug.tsx` | `/sessions/:eventSlug` (P1 #16a) | 2 | done |
| Public speakers directory | `speakers.$eventSlug.tsx` | `/speakers/:eventSlug` (P1 #16b — promoted from P2) | 2 | done |
| Public agenda grid | `schedule.$eventSlug.tsx` | `/schedule/:eventSlug` (P1 #16c — promoted from P2) | 2 | done |
| Public itinerary + personal schedule | `itinerary.$eventSlug.tsx` | `/itinerary/:eventSlug` (P1 #16d) | 2 | done |
| Public speaker gallery | `gallery.$eventSlug.tsx` | `/gallery/:eventSlug` (P1 #16e) | 2 | done |
| Public feeds (JSON/XML/iCal/basic HTML + widget.js) | `feeds.$eventSlug.$kind.tsx` (the segment carries the extension — flat-routes can't put a param after an escaped dot) | `/feeds/:eventSlug/sessions.json` · `.xml` · `.html` · `speakers.*` · `agenda.ics` · `widget.js` (`// @public`) | 2 | done |
| Configured embed render | `embed.$publicId.tsx` | `/embed/:publicId` (snippet target; `// @public`) | 2 | done |
| Compat API (Hono splat) | `api.v1.$.tsx` | `/api/v1/*` (x-access-token; read-only; P1 #20) | 3 | done |
| Harness aliases (redirects) | `dashboard.tsx` · `organizer.tsx` · `sessions._index.tsx` · `speakers._index.tsx` · `schedule._index.tsx` · `agenda.tsx` · `itinerary._index.tsx` · `gallery._index.tsx` | `/dashboard` `/organizer` → `/admin`; bare `/sessions` `/speakers` `/schedule` `/agenda` `/itinerary` `/gallery` → the default event's public page (default = oldest event by createdAt; `/agenda` and `/schedule` both land on the grid) (`// @public`) | 2 | done |
| CFP entry alias (redirect) | `cfp.tsx` | `/cfp` → the default event's oldest open submission form at `/submit/:eventSlug/:formId` (the homepage "Call for speakers" link — stable URL over the per-form uuid; no open form → `/`; `// @public`) | 2 | done |
| Airtable webhook receiver | `hooks.airtable.tsx` | `/hooks/airtable` (POST; HMAC-verified via `X-Airtable-Content-MAC`, no session auth — `// @public`; P1 #15) | 2 | done |
| Theme preference | `theme.tsx` | `/theme` (POST; persists the tri-state System/Light/Dark cookie; `// @public` — per-browser, works pre-login) | — | done |
| Airtable sync status | `admin.settings.airtable.tsx` | `/admin/settings/airtable` (last sync, breaker alert + resume, Sync now; explicit not-configured states; P1 #15) | 2 | done |
| Speaker CRM shell (org-level) | `admin.crm.tsx` | `/admin/crm/*` (header + module tabs; children below) | 3 | done |
| CRM overview dashboard | `admin.crm._index.tsx` | `/admin/crm` (org KPIs + widgets, CRM-12) | 3 | done |
| CRM directory | `admin.crm.directory.tsx` | `/admin/crm/directory` (cross-event union by email; filters, add-to-event, enroll, save-segment; CRM-01/02/06/09/10) | 3 | done |
| CRM person profile | `admin.crm.person.$email.tsx` | `/admin/crm/person/:email` (appearances, notes, duplicates, enroll, add-to-event; CRM-03) | 3 | done |
| CRM sourcing pipeline | `admin.crm.pipeline.tsx` | `/admin/crm/pipeline` (kanban board + enroll + move; CRM-07) | 3 | done |
| CRM pipeline card detail | `admin.crm.pipeline_.$cardId.tsx` (trailing `_`: renders beside the board, not nested in it) | `/admin/crm/pipeline/:cardId` (notes + stage history + assign-to-event; CRM-08) | 3 | done |
| CRM saved segments | `admin.crm.segments.tsx` | `/admin/crm/segments` (dynamic segments over directory filters; CRM-09) | 3 | done |

If you need a route not listed here, add the row on the integration branch first
(so no one else claims the same file), then build it in your worktree.
