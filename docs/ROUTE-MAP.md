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
| Dashboard | `admin._index.tsx` | `/admin` | 0/3 | stub |
| Submissions (all) | `admin.submissions.tsx` | `/admin/submissions` | 0/1 | done (golden path) |
| Abstracts / Sessions tabs | `admin.abstracts.tsx` · `admin.sessions.tsx` | `/admin/abstracts` · `/admin/sessions` | 1 | todo |
| Submission detail/edit | `admin.submissions.$id.tsx` | `/admin/submissions/:id` | 1 | todo |
| Form builder (list) | `admin.forms.tsx` | `/admin/forms` | 1 | todo |
| Form builder (editor) | `admin.forms.$formId.tsx` | `/admin/forms/:formId` | 1 | todo |
| Evaluation | `admin.evaluation.tsx` | `/admin/evaluation` | 3 | todo |
| Agenda | `admin.agenda.tsx` | `/admin/agenda` | 3 | todo |
| Tasks dashboard | `admin.tasks.tsx` | `/admin/tasks` | 3 | todo |
| Email templates | `admin.emails.tsx` · `admin.emails.$key.tsx` | `/admin/emails` | 1 | todo |
| Event settings | `admin.settings.tsx` | `/admin/settings` | 1 | todo |
| Library (taxonomies) | `admin.settings.library.tsx` | `/admin/settings/library` | 0/1 | todo |
| Portals admin | `admin.portals.tsx` · `admin.portal-forms.tsx` · `admin.file-requests.tsx` | `/admin/portals` … | 3 | todo |
| Public CFP | `submit.$eventSlug.$formId.tsx` (+ `.step.*`) | `/submit/:eventSlug/:formId` | 2 | todo |
| Speaker portal | `portals.$eventSlug.$portalId.tsx` (+ `home/submissions/profile/tasks`) | `/portals/:eventSlug/:portalId/*` | 2 | todo |
| Create event | `admin.events.new.tsx` | `/admin/events/new` | 1 | todo |
| Event switcher (action) | `admin.events.switch.tsx` | `/admin/events/switch` (POST → sets `users.activeEventId`; membership-guarded) | 0/1 | done |
| Reviewer management | `admin.reviewers.tsx` | `/admin/reviewers` (add reviewer + track assignment + invite) | 1 | todo |
| Reviewer "My Reviews" (reviewer role) | `reviews.tsx` · `reviews.$id.tsx` | `/reviews` · `/reviews/:id` (NOT under `admin.*`) | 1 | todo |
| Set / reset password (invite + forgot landing) | `set-password.$token.tsx` | `/set-password/:token` | 1 | todo |
| Forgot password (request) | `forgot-password.tsx` | `/forgot-password` (`// @public`) | 1 | todo |
| Unsubscribe | `unsubscribe.$token.tsx` | `/unsubscribe/:token` (signed token; `// @public`) | 1 | todo |
| Email history log | `admin.emails.history.tsx` | `/admin/emails/history` | 1 | todo |
| Task response view (admin) | `admin.tasks.$assignmentId.tsx` | `/admin/tasks/:assignmentId` | 1 | todo |
| File upload (presign/mediate) + download | `files.upload.tsx` · `files.$id.tsx` | `/files/upload` (POST) · `/files/:id` (GET bytes, authz-checked) | 1 | todo |
| Contact record (admin) | `admin.contacts.$id.tsx` | `/admin/contacts/:id` | 1 | todo |
| CSV export (resource route) | `admin.submissions.export[.csv].tsx` | `/admin/submissions/export.csv` (COMMITTED, P2 #3) | 2 | todo |
| Contacts / speaker roster (list) | `admin.contacts.tsx` | `/admin/contacts` (search, status filter, + Add) — P1 #17 | 1 | todo |
| Speaker CSV import | `admin.contacts.import.tsx` | `/admin/contacts/import` (upload → map → dedupe) | 1 | todo |
| Compose bulk email to speakers | `admin.contacts.compose.tsx` | `/admin/contacts/compose` (merge fields + preview) | 1 | todo |
| Evaluation plan editor | `admin.evaluation.$planId.tsx` | `/admin/evaluation/:planId` (rounds/scorecards/pools/assignments) | 3 | todo |
| Evaluation results export | `admin.evaluation.export[.csv].tsx` | `/admin/evaluation/export.csv` | 3 | todo |
| Embeds admin | `admin.embeds.tsx` · `admin.embeds.$id.tsx` | `/admin/embeds` (P1 #16, EMB-15) | 2 | todo |
| Files ZIP bundle (resource) | `admin.files.export[.zip].tsx` | `/admin/files/export.zip` (latest versions, grouped) | 2 | todo |
| Team admins (org members) | `admin.settings.team.tsx` | `/admin/settings/team` (org-member invite + remove w/ last-member guard, P1 #21/#22 Wave D) | 1 | todo |
| Organizer sign-up | `signup.tsx` | `/signup` (`// @public`; existing-email → decided sign-in message; P1 #22 Wave C) | 2 | todo |
| Org onboarding | `onboarding.tsx` | `/onboarding` (one form: org name + first event; auth'd, membership-less users only; P1 #22 Wave C) | 2 | todo |
| Public sessions list | `sessions.$eventSlug.tsx` | `/sessions/:eventSlug` (P1 #16a) | 2 | todo |
| Public speakers directory | `speakers.$eventSlug.tsx` | `/speakers/:eventSlug` (P1 #16b — promoted from P2) | 2 | todo |
| Public agenda grid | `schedule.$eventSlug.tsx` | `/schedule/:eventSlug` (P1 #16c — promoted from P2) | 2 | todo |
| Public itinerary + personal schedule | `itinerary.$eventSlug.tsx` | `/itinerary/:eventSlug` (P1 #16d) | 2 | todo |
| Public speaker gallery | `gallery.$eventSlug.tsx` | `/gallery/:eventSlug` (P1 #16e) | 2 | todo |
| Public feeds (JSON/XML/iCal) | `feeds.$eventSlug.$kind[.$format].tsx` | `/feeds/:eventSlug/sessions.json` · `.xml` · `/feeds/:eventSlug/agenda.ics` (`// @public`) | 2 | todo |
| Configured embed render | `embed.$publicId.tsx` | `/embed/:publicId` (snippet target; `// @public`) | 2 | todo |
| Compat API (Hono splat) | `api.v1.$.tsx` | `/api/v1/*` (x-access-token; read-only; P1 #20) | 3 | todo |
| Harness aliases (redirects) | `dashboard.tsx` · `organizer.tsx` · `sessions._index.tsx` · `speakers._index.tsx` · `schedule._index.tsx` · `agenda.tsx` | `/dashboard` `/organizer` → `/admin`; bare `/sessions` `/speakers` `/schedule` `/agenda` → default event's public page (`// @public`) | 2 | todo |
| Airtable webhook receiver | `hooks.airtable.tsx` | `/hooks/airtable` (POST; HMAC-verified via `X-Airtable-Content-MAC`, no session auth — `// @public`; P1 #15) | 2 | todo |

If you need a route not listed here, add the row on the integration branch first
(so no one else claims the same file), then build it in your worktree.
