# Walk — 01-auth-event-setup (design-side, executed on paper against schema.ts / auth.ts / routes / ROUTE-MAP)

Walker discipline: every step gets the concrete serving artifact (real SQL/Drizzle against
`app/db/schema.ts` columns, real route files per `docs/ROUTE-MAP.md`, real port calls, real
JSON) — or a filed GAP. "The mechanism handles it" is not a walk.

Legend: `OK` = artifact producible from the current design. `GAP: … [BLOCKER|MAJOR|MINOR]`.

---

## AE-S1 — Admin signs in; logged-out access is gated

### Step 1 — logged-out deep links to /admin and /admin/submissions

```ts
// app/routes/admin.tsx (exists, done) — layout loader gates ALL admin.* GET navigation:
const user = await requireAdmin(context.cloudflare.env, request);
// app/lib/auth.ts requireUser → no cookie/session row →
throw redirect(`/login?redirectTo=${encodeURIComponent("/admin/submissions")}`);
```
Both URLs (`/admin` → `admin._index.tsx`, `/admin/submissions` → `admin.submissions.tsx`)
render inside `admin.tsx`, so the single layout loader serves the gate. No admin data is
fetched before the throw. **OK**

### Step 2 — wrong password

```ts
// app/routes/login.tsx action (exists):
const ok = await verifyPassword("definitely-wrong-99", user?.passwordHash ?? DUMMY_HASH);
if (!user || !ok) return { error: "Incorrect email or password." };
```
Single inline, non-disclosing error (same message for unknown email vs wrong password;
DUMMY_HASH equalizes timing). **OK**

### Step 3 — failed attempt created no session

```sql
-- createSession() is only reached AFTER verifyPassword succeeds (login.tsx line order):
SELECT COUNT(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.com');
-- unchanged by the failed POST; the response set no Set-Cookie header.
```
**OK**

### Step 4 — email retained, correct password, session established

```ts
// login.tsx action success path:
const cookie = await createSession(env, user.id, isSecureRequest(request));
// → INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (<uuid>, 'u_admin', now+30d)
// → "Set-Cookie: __session=<uuid>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
return redirect(safeRedirect(""), { headers: { "Set-Cookie": cookie } }); // → /admin
```
Email retention: the `<input name="email">` is uncontrolled; under client-side `<Form>`
re-render the DOM value survives the error response. But `login.tsx` passes **no
`defaultValue={...}` from actionData** (no-JS/full-document fallback wipes it), and the
inputs are **placeholder-only — no `<label>`, no `autocomplete="email" / "current-password"`**,
which the success signal explicitly demands ("labeled email/password inputs that autofill
cleanly").
`GAP: login.tsx inputs are unlabeled and carry no autocomplete attributes; email not echoed back server-side — password-manager/autofill signal of AE-S1 not met by the done route [MINOR]`

### Step 5 — arrival on the seed event: switcher/header names the event; submissions listed

```ts
// Submissions list: app/routes/admin.submissions.tsx loader (exists) —
const rows = await db.query.submissions.findMany({ with: { format: true, participants: …, submissionTracks: … }, limit: 100 });
// seed guarantees 8 rows across every status → populated list. OK for the list half.
```
The event-name half has **no serving artifact**: `admin.tsx` (wave-0, marked *done*) renders
only `loaderData.user.name ?? email` in the header — there is no event switcher and no event
name anywhere in the shell, and no nav/registry entry provides one. SCOPE Appendix A commits
the switcher ("Left rail: logo, event switcher …"). The only event lookup pattern in the
codebase is `db.query.events.findMany({ limit: 1 })` (first-row hack in admin.submissions.tsx).
`GAP: admin shell (done) has no event switcher/name display and no data source for "the current event" — AE-S1.5's "switcher/header names the seed event" cannot be screenshotted from the current design [MAJOR]` (root cause escalates to BLOCKER in AE-S2.4)

### Step 6 — logout, gate returns

```ts
// app/routes/logout.tsx action (exists):
const cookie = await destroySession(env, request);
// → DELETE FROM auth_sessions WHERE id = <cookie value>; Set-Cookie: __session=; Max-Age=0
return redirect("/login", { headers: { "Set-Cookie": cookie } });
// Re-open /admin → step-1 artifact again.
```
**OK** — with one note: no route sets `Cache-Control: no-store` on admin responses; the
"no admin content served from cache" signal relies on the browser not bfcache-restoring the
admin document after logout.
`GAP: no cache-control policy stated anywhere for authenticated pages [MINOR]`

### EXPERIENCE (sub-1s login→dashboard, autofill)
Server-rendered RR7 + D1 local: no schema obstacle. Autofill covered by the step-4 MINOR.

---

## AE-S2 — Create a brand-new event; nothing leaks from the seed event

### Step 1 — login
AE-S1 step-4 artifact. **OK**

### Step 2 — create-event flow, blank-name rejection

Blank-name validation is pattern-servable (golden path):
```ts
const NewEvent = createInsertSchema(events)
  .pick({ name: true, slug: true, type: true, websiteUrl: true, location: true, timezone: true, theme: true, startsAt: true, endsAt: true })
  .extend({ name: z.string().min(1, "Name is required"), slug: z.string().min(1) });
// action returns { fieldErrors } → inline error, other typed values re-rendered.
```
But there is **no route to put it in**: ROUTE-MAP assigns `admin.settings.tsx` = "Event
settings" (edit) only. SCOPE P1 #5 commits "**+ create-event flow (same form, one more
route)**" — that route is unassigned (no `admin.events.new.tsx` / equivalent row), and
ROUTE-MAP's own rule says unlisted routes must first be claimed on the integration branch.
`GAP: committed create-event flow has no route file in ROUTE-MAP — no filename any build agent may create without an integration-branch edit [MAJOR]`

### Step 3 — save the new event

```ts
await db.insert(events).values({
  name: "DevOps Days Lyon 2027",
  slug: "devops-days-lyon-2027",
  type: "Conference",
  websiteUrl: "https://devopsdays-lyon.example.com",
  location: "Lyon, France",
  timezone: "Europe/Paris",
  startsAt: new Date(1812610800 * 1000), // 2027-06-10T09:00+02:00
  endsAt:   new Date(1812729600 * 1000), // 2027-06-11T18:00+02:00
  theme: "Two days of DevOps war stories for platform teams.",
});
```
Every column exists on `events` (name, slug UNIQUE, type, website_url, location, timezone,
theme, starts_at, ends_at). **OK** (route gap above notwithstanding)

### Step 4 — event switcher lists both events; switch into the new one

There is **no mechanism for "current event" anywhere in the design**:
- URLs carry no event segment (`/admin/submissions`, not `/admin/:event/submissions` — ROUTE-MAP fixes the event-less shape).
- `auth_sessions` has no `active_event_id` column; no cookie is specified.
- No switcher route/action exists or is assigned.
- The canonical loader pattern is `db.query.events.findMany({ limit: 1 })` — i.e. **every admin screen built by copying the golden path serves the FIRST event forever**, regardless of any switch.

The artifact that WOULD be needed (either):
```sql
ALTER TABLE auth_sessions ADD COLUMN active_event_id TEXT REFERENCES events(id);
-- + a switcher action: UPDATE auth_sessions SET active_event_id = :eventId WHERE id = :sessionId;
-- + every admin loader: WHERE event_id = session.activeEventId
```
or an event-scoped URL scheme (`admin.$eventSlug.*`) — which contradicts every filename
already assigned in ROUTE-MAP.
`GAP: no current-event selection mechanism exists (no schema column, no route, no URL segment, and the golden-path pattern hardcodes the first event) — switching into "DevOps Days Lyon 2027" is unservable; this also poisons every event-scoped step in AE-S3/S4/S5 and all FB-S* [BLOCKER]`

### Step 5 — walk the new event's screens: empty + isolated

Isolation proof queries are all writable (every table carries `event_id`):
```sql
SELECT COUNT(*) FROM submissions WHERE event_id = :newEventId; -- 0
SELECT COUNT(*) FROM forms       WHERE event_id = :newEventId; -- 0
SELECT COUNT(*) FROM tracks      WHERE event_id = :newEventId; -- 0
SELECT COUNT(*) FROM contacts    WHERE event_id = :newEventId; -- 0
```
Empty states are a binding requirement (SCOPE Cross-cutting: "Empty states for every list").
Target routes exist in ROUTE-MAP (`admin.submissions.tsx` done; `admin.forms.tsx`,
`admin.settings.library.tsx`, `admin.evaluation.tsx` todo). **OK per table** — but the
screens can only SHOW the new event's zeros once the step-4 BLOCKER is resolved (today they
would show the seed event's data). Inherits `AE-S2.4 [BLOCKER]`.

### Steps 6–7 — edit details, persist across hard reload

```sql
UPDATE events
   SET location = 'Cité Internationale, Lyon, France',
       ends_at  = 1812816000  -- 2027-06-12T18:00+02:00
 WHERE id = :newEventId;
```
Reload re-runs the settings loader (`admin.settings.tsx`, assigned) → same row. **OK**

### Step 8 — switch back to the seed event
Same mechanism as step 4. Inherits `[BLOCKER]`.

---

## AE-S3 — Library: tracks, tags, formats, levels, rooms; edit one, delete one

Route: `admin.settings.library.tsx` → `/admin/settings/library` (assigned, wave 0/1, todo).
All writes below assume the AE-S2.4 current-event mechanism to supply `:eventId` — noted
once, not repeated.

### Step 2 — tracks (+ blank-name rejection)

```ts
// blank name: z.string().min(1) refinement → { fieldErrors: { name: ["Name is required"] } }
// (color selection survives because the action re-renders with the submitted values)
await db.insert(tracks).values([
  { eventId, name: "AI Infrastructure",    color: "#7C3AED" },
  { eventId, name: "Developer Experience", color: "#F59E0B" },
  { eventId, name: "Security",             color: "#0EA5E9" },
]);
```
`tracks.name`, `tracks.color` exist. **OK**

### Step 3 — tags

```ts
await db.insert(tags).values([{ eventId, name: "Hands-on" }, { eventId, name: "Sponsored" }]);
```
**OK**

### Step 4 — formats with default durations

```ts
await db.insert(formats).values([
  { eventId, name: "Talk (30 min)",     defaultDurationMins: 30,  position: 0 },
  { eventId, name: "Workshop (120 min)", defaultDurationMins: 120, position: 1 },
  { eventId, name: "Panel (45 min)",    defaultDurationMins: 45,  position: 2 },
]);
```
`formats.default_duration_mins` exists. **OK**

### Step 5 — levels

```ts
await db.insert(levels).values([
  { eventId, name: "Beginner", position: 0 }, { eventId, name: "Intermediate", position: 1 },
  { eventId, name: "Advanced", position: 2 }, { eventId, name: "Expert", position: 3 },
]);
```
**OK**

### Step 6 — rooms with capacities

```ts
await db.insert(rooms).values([
  { eventId, name: "Auditorium A",   capacity: 300, displayOrder: 0 },
  { eventId, name: "Workshop Room 1", capacity: 40, displayOrder: 1 },
]);
```
`rooms.capacity` exists. **OK**

### Step 7 — edit track

```sql
UPDATE tracks SET name = 'Security & Privacy', color = '#DC2626' WHERE id = :securityTrackId;
```
**OK**

### Step 8 — delete level "Expert" and verify no dropdown offers it

```sql
DELETE FROM levels WHERE id = :expertLevelId;
-- submissions.level_id is REFERENCES levels(id) ON DELETE SET NULL → existing rows survive.
```
Every Level dropdown is fed by `SELECT id, name FROM levels WHERE event_id = :eventId ORDER BY position`
(form builder + Add Submission drawer both read the same table) → "Expert" disappears
everywhere with zero denormalized copies. **OK**

### Step 9 — reload persistence
Plain loader re-reads. **OK**

### EXPERIENCE — add/edit/delete reflected <1s, no page-reload-per-row
Client component behavior (RR7 `useFetcher` revalidation) — no schema gap possible. But NO
binding document states "no full-page reload per row": not in `docs/flows/01…08`, not in
SCOPE (its cross-cutting perf line says "<1s page loads, instant table interactions" — a
latency bar, not a no-navigation bar), not in tech-stack. Only the scenario's EXPERIENCE
line binds it.
`GAP: interaction-quality requirement ("no reload per row") exists ONLY in scenario EXPERIENCE lines — a build agent reading flows/SCOPE alone can ship a full-POST-per-row screen that passes every other signal [MINOR]`

---

## AE-S4 — Custom-field library: six types, event vs global scope, edit, delete

Route: fields CRUD belongs to the Library (`admin.settings.library.tsx`, SCOPE P1 #5:
"Library: manage Tags, Tracks, Formats, Levels **and Fields**").

### Step 2 — blank name rejected, type preserved
Same `.min(1)` + re-render-with-values pattern as AE-S3.2. **OK**

### Step 3 — create five fields

```ts
await db.insert(fields).values([
  { eventId: null, scope: "global", name: "T-shirt size", type: "dropdown", options: ["S","M","L","XL"] },
  { eventId, scope: "event", name: "Years of speaking experience", type: "number" },
  { eventId, scope: "event", name: "Requires visa letter", type: "checkbox" },
  { eventId, scope: "event", name: "Earliest arrival date", type: "date" },
  { eventId, scope: "event", name: "Scratch field", type: "text", maxLength: 255 },
]);
```
All six FIELD_TYPE values used across AE-S4/FB-S2 (`dropdown, number, checkbox, date, text,
textarea`) exist in the enum; `max_length`, `options` (json), `scope` all exist. **OK** — with
one design smell: **global-ness is encoded twice** (`scope = 'global'` AND `eventId` nullability,
schema comment "eventId null = global"). Nothing forbids `scope='global', event_id='e_x'`,
in which case the field shows in every event's picker (if queried by scope) yet **cascades
away when that one event is deleted** (`onDelete: "cascade"`).
`GAP: dual encoding of global scope (fields.scope vs fields.event_id NULL) with no stated invariant — pickers and cascade can disagree; one rule needed: scope='global' ⇔ event_id IS NULL [MINOR]`

### Step 4 — rename

```sql
UPDATE fields SET name = 'Years of experience' WHERE id = :yearsFieldId;
-- form_fields/answers reference field_id → the rename shows everywhere; single definition. 
```
**OK**

### Step 5 — delete "Scratch field"

```sql
DELETE FROM fields WHERE id = :scratchFieldId;
-- form_fields.field_id → ON DELETE CASCADE (placements vanish);
-- submission_answers.field_id → ON DELETE RESTRICT — no answers exist here, so the DELETE succeeds.
```
**OK** — note: for a field WITH answers this DELETE throws; no doc defines the admin-facing
copy/behavior for that path. `GAP: restricted-delete UX undefined (error path an admin will hit on day 30) [MINOR]`

### Step 6 — scope boundary from the SEED event's picker

```sql
SELECT id, name, type, scope FROM fields
 WHERE event_id = 'e_demo' OR (scope = 'global' AND event_id IS NULL)
 ORDER BY name;
-- returns 'T-shirt size' (global); 'Requires visa letter' (event_id = :newEventId) is excluded.
```
**OK** (contingent on the step-3 invariant being adopted)

### Step 7 — picker in the new event: 4 fields, type+scope labels, search "arriv"

Same query with `:newEventId`; type/scope render from the selected columns; search is a
client-side filter over the already-loaded list (dozens of rows — no server round-trip
needed). **OK** — EXPERIENCE binding caveat identical to AE-S3's MINOR.

---

## AE-S5 — Provision a reviewer: account, tracks, invite email, login, admin walled off

### Step 1 — create reviewer + track assignments

```ts
await db.batch([
  db.insert(users).values({
    id: nadiaId, email: "nadia.kessler@example.com", name: "Nadia Kessler",
    role: "reviewer",
    passwordHash: "<???>", // NOT NULL — but Nadia has no password until step 4
  }),
  db.insert(reviewerTracks).values([
    { userId: nadiaId, trackId: aiInfraTrackId },
    { userId: nadiaId, trackId: securityPrivacyTrackId },
  ]),
]);
```
Two gaps:
1. `users.password_hash` is `NOT NULL` — an invited account has no password yet. Only
   servable by inserting a sentinel unverifiable string (any non-`pbkdf2$…` value makes
   `verifyPassword` return false, so it is safe) — but no doc names this convention.
   `GAP: invited-user state not expressible; requires an undocumented sentinel-hash workaround [MAJOR]`
2. Where does this UI live? ROUTE-MAP has no reviewer-management route. `admin.evaluation.tsx`
   ("Evaluation", wave 3) is the nearest candidate, but reviewer provisioning is SCOPE **P0 #5**
   ("admin adds a reviewer (account + track assignment) and an invite email goes out") — a
   committed P0 feature with no assigned home, gated behind a wave-3 file at best.
   `GAP: reviewer-provisioning UI has no route in ROUTE-MAP [MAJOR]`

### Step 2 — reviewer list with track assignments

```sql
SELECT u.id, u.name, u.email, GROUP_CONCAT(t.name) AS tracks
  FROM users u
  JOIN reviewer_tracks rt ON rt.user_id = u.id
  JOIN tracks t ON t.id = rt.track_id AND t.event_id = :newEventId
 WHERE u.role = 'reviewer'
 GROUP BY u.id;
```
Works — but note `reviewer_tracks` is the ONLY thing tying a reviewer to an event: a
reviewer with zero tracks belongs to no event and vanishes from every event's list.
`GAP: reviewers are event-scoped only transitively via tracks; a track-less reviewer is unlistable [MINOR]`

### Step 3 — invite email with a working set-password link

```ts
const token = crypto.randomUUID();
await db.insert(passwordResets).values({ userId: nadiaId, token, expiresAt: new Date(Date.now() + 7 * 864e5) });
const result = await getEmailSender(env).send({
  to: "nadia.kessler@example.com",
  subject: "You've been invited to review for DevOps Days Lyon 2027",
  html: `<p>…</p><a href="${origin}/reset-password?token=${token}">Set your password</a>`,
  dedupeKey: `reviewer_invite:nadia.kessler@example.com:${nadiaId}`,
  eventId: newEventId,
});
// local adapter → INSERT INTO email_outbox (to, subject, html, dedupe_key, event_id, status, sent_at)
// VALUES ('nadia.kessler@example.com', …, 'sent', unixepoch())  ← the queryable outbox row.
```
Port + outbox: **OK**. The LINK is not: **no set-password/reset route exists in ROUTE-MAP**
(`login/logout/403` are the only auth routes; flow 02 documents Sessionboard's `/reset/:resetId`
but no filename is assigned here). SCOPE P0 #5 explicitly says the invite "reuses
`passwordResets` tokens + the EmailSender port" — the table and port exist; the URL has no
route to land on.
`GAP: no route file assigned for the set-password/activation page — the invite link's href has no resolvable target [MAJOR]`
Also: no `email_templates` key exists for reviewer invites (seed has confirmation/accept/
decline/reminders only), so the subject/body above are hardcoded rather than event-editable.
`GAP: reviewer-invite template key undefined in emailTemplates [MINOR]`

### Step 4 — open link, set password "Rev!ewer2027", logged in

```ts
// would live in the (missing) reset route's action:
const [reset] = await db.select().from(passwordResets)
  .where(and(eq(passwordResets.token, token), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
await db.batch([
  db.update(users).set({ passwordHash: await hashPassword("Rev!ewer2027") }).where(eq(users.id, reset.userId)),
  db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id)),
]);
const cookie = await createSession(env, reset.userId, isSecureRequest(request));
```
All helpers exist (`hashPassword`, `createSession`). Inherits the step-3 route `[MAJOR]`.

### Step 5 — Nadia lands in her reviewer context; empty queue with designed empty state

**Unservable.** Two independent holes:
1. Post-login destination: `login.tsx` `safeRedirect()` defaults to **`/admin`** for every
   role; `admin.tsx` `requireAdmin` then bounces a `reviewer` to **`/403`**. Nadia's first
   logged-in screen is the access-denied page.
2. There is **no reviewer-facing route at all**: ROUTE-MAP's only evaluation surface is
   `admin.evaluation.tsx` (inside the admin shell → `requireAdmin`). SCOPE P0 #5 commits a
   reviewer "My Reviews" queue (submissions whose tracks overlap `reviewer_tracks`), and the
   query is writable today —
```sql
SELECT DISTINCT s.* FROM submissions s
  JOIN submission_tracks st ON st.submission_id = s.id
  JOIN reviewer_tracks rt ON rt.track_id = st.track_id
 WHERE rt.user_id = :nadiaId AND s.status = 'pending';  -- empty for the new event → empty state
```
— but no filename may serve it, and nothing routes a reviewer to it.
`GAP: no reviewer queue route exists or is assigned, and login's role-blind redirect sends reviewers to /admin → /403 — the reviewer journey dead-ends by design [BLOCKER]`

### Step 6 — direct navigation to an admin URL → proper access denied

```ts
// admin.tsx loader: requireUser(env, request, ["admin"]) → role mismatch → throw redirect("/403");
// app/routes/403.tsx renders the designed page; no admin loader data is fetched before the throw.
```
**OK** — with a signal shortfall: `403.tsx` is "403 / You do not have access to this page."
with **no way back and no branding**, while the signal demands "branded, with a way back".
`GAP: 403 page lacks the required way-back affordance [MINOR]`

### Step 7 — logout, log back in

`users.password_hash` now holds the real PBKDF2 hash; `login.tsx` verifies it; durable
account. **OK** (destination on success re-hits the step-5 BLOCKER).

---

## Gap summary (this file)

| Step | Gap | Severity |
|---|---|---|
| AE-S2.4 (poisons S2.5/8, all of S3–S5 + FB-*) | No current-event mechanism: no schema column/cookie/URL segment/switcher route; golden-path pattern hardcodes first event | **BLOCKER** |
| AE-S5.5 | No reviewer-facing route; login redirect is role-blind (`/admin` → `/403` for reviewers) | **BLOCKER** |
| AE-S5.3/4 | Set-password/activation route missing from ROUTE-MAP — invite link has no target | MAJOR |
| AE-S5.1 | Reviewer-management UI has no assigned route (P0 #5 feature) | MAJOR |
| AE-S5.1 | `users.password_hash NOT NULL` can't express "invited, no password yet" (sentinel-hash workaround undocumented) | MAJOR |
| AE-S2.2 | Committed create-event flow has no route file in ROUTE-MAP | MAJOR |
| AE-S1.5 | Admin shell (done) has no event switcher/name display | MAJOR |
| AE-S4.3 | Global-scope dual encoding (`scope` vs `event_id NULL`) with no invariant | MINOR |
| AE-S1.4 | Login inputs unlabeled, no autocomplete attrs, email not echoed server-side | MINOR |
| AE-S5.2 | Reviewer↔event scoping only via tracks; track-less reviewer unlistable | MINOR |
| AE-S5.3 | No emailTemplates key for reviewer invite | MINOR |
| AE-S5.6 | 403 page lacks way-back/branding | MINOR |
| AE-S3 EXP (systemic) | "No reload per row / instant" stated ONLY in scenario EXPERIENCE lines, in no spec doc | MINOR |
| AE-S4.5 | Restricted-delete (field with answers) UX undefined | MINOR |
| AE-S1.6 | No cache-control policy for authenticated pages | MINOR |

SCENARIO-ERRORs: none — every step maps to a SCOPE-committed tier (create-event = P1 #5,
fields CRUD/scope = P1 #5, reviewer provisioning = P0 #5, taxonomies = wave 0 / P1 #5).

---

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Walked against the landed schema (`app/db/schema.ts`: `organizations`, `organization_members`,
`events.organizationId` NOT NULL, `api_tokens.organizationId` NOT NULL + nullable `eventId`,
`fields.scope` DROPPED → org/event XOR), the updated `drizzle/seed.sql` (org_demo / om_admin /
e_demo backfill), `app/lib/auth.ts`, and `docs/multi-tenancy-design.md` (cited by line).
Wave B/C/D commitments (design L129–134) are cited, not re-filed as gaps, per the gate rule.

State notes (walk-record corrections observed DURING this walk — not tenancy verdicts):
- The 2026-08-09 AE-S2.4 BLOCKER's root cause is gone: `users.activeEventId` +
  `getActiveEvent()` (auth.ts L236–251) now exist and `admin.submissions.tsx` scopes by them.
  The still-missing switcher **UI** remains the AE-S1.5 MAJOR, unchanged.
- AE-S5.5's BLOCKER is half-resolved: `login.tsx` now redirects via `homePathForRole()`
  (reviewer → `/reviews`); the `/reviews` route itself is still missing — pre-existing, on record.
- AE-S5.1's sentinel-hash MAJOR is now documented in-schema (`passwordResets` doc comment,
  schema.ts L73: "a sentinel-hash user + one of these tokens = set-password onboarding").
- AE-S4.3's dual-encoding MINOR (`scope` vs `event_id NULL`) is **resolved by this migration**:
  `scope='global' AND event_id='e_x'` is no longer expressible. Residual both-null/both-set rows
  remain app-enforced XOR — exactly the committed design (L79–83, formFields precedent), not a gap.

### AE-S1 step 1 — UNCHANGED
`requireAdmin` → `getUser` reads `auth_sessions`/`users` only; neither gained tenancy columns,
and the redirect throws before any event/org read.

### AE-S1 step 2 — UNCHANGED
Wrong-password path queries `users` by email and returns; no tenancy table is touched.

### AE-S1 step 3 — UNCHANGED
`auth_sessions` is untouched by the migration; the no-session-on-failure proof query is identical.

### AE-S1 step 4 — UNCHANGED
`createSession` inserts (`id`, `user_id`, `expires_at`) — no org column exists or is needed.
(The 2026-08-09 autofill MINOR stands; it is not tenancy-related.)

### AE-S1 step 5 — UNCHANGED
The serving query is byte-identical; only the seed data grew an org spine, which satisfies it:
```sql
-- getActiveEvent(u_admin): users.active_event_id = 'e_demo' (seed.sql L98) →
SELECT * FROM events WHERE id = 'e_demo' LIMIT 1;
-- row now carries organization_id = 'org_demo' (NOT NULL FK satisfied, seed.sql L67–69);
-- submissions list: WHERE event_id = 'e_demo' → the 8 seeded rows, as before.
```
`getActiveEvent` does not check membership today — u_admin IS org_demo's member (`om_admin`,
seed.sql L64–65), so interim behavior is correct; the check itself is covered: Wave B
membership check (design L92–96, wave table L132). The missing switcher/name display in the
shell is the pre-existing AE-S1.5 MAJOR — unchanged by tenancy, except that when built it must
serve the org-scoped list (artifact at AE-S2.4 below; covered: Wave B, design L100).

### AE-S1 step 6 — UNCHANGED
`destroySession` = `DELETE FROM auth_sessions WHERE id = <cookie>`; no tenancy surface.
(Cache-control MINOR stands, unrelated.)

### AE-S1 EXPERIENCE — UNCHANGED
Sub-1s + autofill are runtime/markup concerns; no tenancy table is on the path.

### AE-S2 step 1 — UNCHANGED
AE-S1 step-4 artifact, verbatim.

### AE-S2 step 2 — UNCHANGED
Blank-name validation is the same `.min(1)` refinement; `createInsertSchema(events)` now also
carries `organizationId`, but the form schema `.pick(...)` never included it (server-derived, like
`eventId` everywhere else). The missing create-event route MAJOR (2026-08-09) stands, unrelated.

### AE-S2 step 3 — CHANGED
`events.organizationId` is a new NOT NULL FK — the insert artifact changes:
```ts
// create-event action (route still unassigned — the 2026-08-09 MAJOR stands):
const memberships = await db
  .select({ organizationId: organizationMembers.organizationId })
  .from(organizationMembers)
  .where(eq(organizationMembers.userId, user.id));
// u_admin → [{ organizationId: 'org_demo' }] (seed row om_admin)
await db.insert(events).values({
  organizationId: memberships[0].organizationId, // NEW — NOT NULL FK
  name: "DevOps Days Lyon 2027",
  slug: "devops-days-lyon-2027",
  type: "Conference",
  websiteUrl: "https://devopsdays-lyon.example.com",
  location: "Lyon, France",
  timezone: "Europe/Paris",
  startsAt: new Date(1812610800 * 1000),
  endsAt: new Date(1812729600 * 1000),
  theme: "Two days of DevOps war stories for platform teams.",
});
```
Producible for the walked persona (single membership → unambiguous). Two edges at the derivation:
a **multi-org member** (reachable once Wave D invites land) has no committed rule or picker for
which org owns the new event — the design doc is silent on it; a **zero-org admin** dead-ends
(cannot insert), but that path is explicitly deferred by decision (org creation for existing
accounts → identity-unification follow-up, design L53–55) and is unreachable pre-Wave D.
`GAP: create-event's organizationId derivation is undefined for a user with >1 membership — no committed rule/org-picker in the design doc; single-org walk unaffected, reachable only after Wave D invites [MINOR]`

### AE-S2 step 4 — CHANGED
The current-event mechanism now exists (state note above); tenancy changes what the switcher
must LIST — org-scoped, not all-events:
```sql
-- the query the switcher must serve (covered: Wave B "event-switcher org scoping", design L100, L132):
SELECT e.id, e.name, e.slug
  FROM events e
  JOIN organization_members om ON om.organization_id = e.organization_id
 WHERE om.user_id = 'u_admin'
 ORDER BY e.created_at;
-- → 'AI.Engineer Sandbox Event' (e_demo) + 'DevOps Days Lyon 2027' — both org_demo, both listed.

-- switch action (unchanged shape):
UPDATE users SET active_event_id = :newEventId WHERE id = 'u_admin';
```
Interim (post-A, pre-B): a forged `active_event_id` pointing at a foreign org's event would be
served, because `getActiveEvent` has no membership check yet — that is exactly the hole Wave B
exists to close (design L92–96); only one org exists in seed, so not judge-visible. Covered, not a gap.

### AE-S2 step 5 — UNCHANGED
The isolation count queries are identical — no event-scoped table gained an org column; org is
derived via `events.organizationId`, never denormalized downward:
```sql
SELECT COUNT(*) FROM submissions WHERE event_id = :newEventId; -- 0 (likewise forms/tracks/contacts)
```
Both events sit in org_demo, so the scenario's isolation axis stays event-level; the new org-level
axis is exercised by the design's cross-tenant denial tests (design L140–143), not this step.

### AE-S2 step 6 — UNCHANGED
`UPDATE events SET location = …, ends_at = …` touches no tenancy column; `organization_id`
is immutable through the settings form (it is never in the picked schema).

### AE-S2 step 7 — UNCHANGED
Loader re-read of the same row; the extra `organization_id` column rides along unread.

### AE-S2 step 8 — CHANGED
Same artifact as step 4 (org-scoped list + `active_event_id` update back to `'e_demo'`);
same Wave B coverage citation.

### AE-S3 step 1 — UNCHANGED
Opening `/admin/settings/library` is a route/nav concern; no tenancy table on the path.

### AE-S3 step 2 — UNCHANGED
`tracks` gained no org column (`event_id` NOT NULL FK as before); the three inserts and the
blank-name rejection are byte-identical to the 2026-08-09 artifacts.

### AE-S3 step 3 — UNCHANGED
`tags` — no tenancy columns; identical insert.

### AE-S3 step 4 — UNCHANGED
`formats` — no tenancy columns; identical insert.

### AE-S3 step 5 — UNCHANGED
`levels` — no tenancy columns; identical insert.

### AE-S3 step 6 — UNCHANGED
`rooms` — no tenancy columns; identical insert.

### AE-S3 step 7 — UNCHANGED
`UPDATE tracks SET name, color` — no tenancy surface.

### AE-S3 step 8 — UNCHANGED
`DELETE FROM levels` + the dropdown-feed query are event-scoped only; cascade semantics untouched.

### AE-S3 step 9 — UNCHANGED
Loader re-read; nothing tenancy-touched to persist differently.

### AE-S3 EXPERIENCE — UNCHANGED
Interaction-quality concern; the 2026-08-09 MINOR (binding lives only in EXPERIENCE lines) stands.

### AE-S4 step 1 — UNCHANGED
Route/nav only; the Fields list query changes at steps 6–7 below, not the navigation.

### AE-S4 step 2 — UNCHANGED
Same `.min(1)` + re-render pattern. Note `createInsertSchema(fields)` no longer emits a `scope`
key — nothing references it in a committed artifact, so no validation contract breaks.

### AE-S4 step 3 — CHANGED
`fields.scope` is dropped; "GLOBAL" is now expressed as **org-wide** via the XOR (design L79–83):
```ts
const event = await getActiveEvent(env, user); // DevOps Days Lyon 2027 → organizationId 'org_demo'
await db.insert(fields).values([
  // scenario "scope GLOBAL" → org-wide: organizationId set, eventId null
  { organizationId: event.organizationId, eventId: null, name: "T-shirt size", type: "dropdown", options: ["S", "M", "L", "XL"] },
  // scenario "scope Event" → eventId set, organizationId null (org derived via event)
  { organizationId: null, eventId: event.id, name: "Years of speaking experience", type: "number" },
  { organizationId: null, eventId: event.id, name: "Requires visa letter", type: "checkbox" },
  { organizationId: null, eventId: event.id, name: "Earliest arrival date", type: "date" },
  { organizationId: null, eventId: event.id, name: "Scratch field", type: "text", maxLength: 255 },
]);
```
Every scenario assertion still holds for the walked data (new event and seed event share
org_demo), but the scenario/success-signal TEXT can no longer be executed literally: the DB
check names a `scope` column that no longer exists, and "global" now means "this organization",
not "this deployment".
`GAP: AE-S4's step-3/6 wording and DB-check success signal reference the dropped fields.scope column ("scope GLOBAL", "carrying global scope") — scenario text is stale and must be re-expressed as organizationId IS NOT NULL / "org-wide"; semantics for the walked persona are preserved [MINOR]`

### AE-S4 step 4 — UNCHANGED
`UPDATE fields SET name = 'Years of experience'` — the rename touches no tenancy column;
single-definition propagation via `field_id` references is as before.

### AE-S4 step 5 — UNCHANGED
`DELETE FROM fields WHERE id = :scratchFieldId` — cascade (`form_fields`) / restrict
(`submission_answers`) semantics are untouched by the migration. (Restricted-delete-UX MINOR stands.)

### AE-S4 step 6 — CHANGED
The scope-boundary query is rewritten against the XOR:
```sql
-- seed event's picker (was: event_id = 'e_demo' OR (scope='global' AND event_id IS NULL)):
SELECT f.id, f.name, f.type,
       CASE WHEN f.organization_id IS NOT NULL THEN 'Org-wide' ELSE 'Event' END AS scope
  FROM fields f
 WHERE f.event_id = 'e_demo'
    OR f.organization_id = (SELECT organization_id FROM events WHERE id = 'e_demo') -- 'org_demo'
 ORDER BY f.name;
-- 'T-shirt size' (organization_id 'org_demo', event_id NULL) IS returned;
-- 'Requires visa letter' (event_id = :newEventId, organization_id NULL) is NOT. Both directions hold.
```
The boundary is now a real tenant boundary: a field org-wide in org_demo is invisible to every
other organization by construction (no `WHERE` clause can accidentally leak it without joining
through the org id).

### AE-S4 step 7 — CHANGED
Same rewritten query with `:newEventId` → the four survivors ("T-shirt size" labeled Org-wide,
three labeled Event); the scope label renders from the `CASE` expression above instead of the
dropped enum. Search "arriv" stays a client-side filter over the loaded rows. EXPERIENCE caveat
identical to AE-S3's standing MINOR.

### AE-S5 step 1 — UNCHANGED
`users` + `reviewer_tracks` gained no tenancy columns. Deliberately so: reviewers are NOT org
members — membership is the organizer capability; reviewers stay event-scoped via assignments
(design L36–38). No `organization_members` row is minted for Nadia. The 2026-08-09 MAJORs
(no reviewer-management route) stand; the sentinel-hash MAJOR is now schema-documented (state note).

### AE-S5 step 2 — UNCHANGED
The reviewer-list query joins `users`/`reviewer_tracks`/`tracks` and scopes by `t.event_id` —
no org join required or possible; identical artifact. (Track-less-reviewer MINOR stands.)

### AE-S5 step 3 — UNCHANGED
`password_resets`, the EmailSender port, and `email_outbox` all carry no org column
(`email_outbox.event_id` is unchanged). Identical artifact; the missing set-password route
MAJOR and template-key MINOR stand, unrelated to tenancy.

### AE-S5 step 4 — UNCHANGED
Token lookup + `users.password_hash` update + `createSession` — none tenancy-touched.

### AE-S5 step 5 — UNCHANGED
The queue query (`submissions` ⋈ `submission_tracks` ⋈ `reviewer_tracks`) touches no tenancy
column; reviewer surfaces are outside org membership by design (L36–38). State note: login now
routes reviewers to `/reviews` via `homePathForRole`; the missing `/reviews` route is the
pre-existing gap on record, not a tenancy effect.

### AE-S5 step 6 — UNCHANGED
Today: `requireAdmin` checks `users.role` — Nadia (`role='reviewer'`) → `/403`, as before;
`users.role` deliberately survives this design (L107–109). Post-Wave B the guard becomes a
membership check (design L97, L132) — Nadia has no `organization_members` row, so she is denied
under both regimes; no interim window opens. (403-page MINOR stands.)

### AE-S5 step 7 — UNCHANGED
Real PBKDF2 hash verify + session mint — no tenancy surface.

---

### Re-walk gap summary

| Step | Gap | Severity |
|---|---|---|
| AE-S2.3 | `events.organizationId` derivation at create-event undefined for a multi-org member (no committed rule/picker; reachable post-Wave D) | MINOR |
| AE-S4.3/6 | Scenario text + DB-check signal still name the dropped `fields.scope` column / "global" wording — must be re-expressed as `organizationId` / org-wide | MINOR |

37 steps walked (+2 EXPERIENCE lines): 6 CHANGED (AE-S2.3/4/8, AE-S4.3/6/7), 31 UNCHANGED,
0 BLOCKER, 0 MAJOR. Everything the migration leaves open on this file's path is an explicit
Wave B/C/D commitment, cited per step. One prior gap is resolved by the migration itself
(AE-S4.3 dual encoding); three others changed status (see state notes).

## 2026-08-11 re-walk — calendar revision ledger and provider send claims (design-time gate)

**Gate trigger.** Branch `fix/schedule-scale-hardening` changes `app/db/schema.ts`, `app/ports/email.ts`,
`app/domain/accept.ts`, `app/domain/schedule-update.ts`, `app/lib/ics.ts` and `app/routes/admin.agenda.tsx`.
This file's `touches:` names `emailOutbox` and `ports: [EmailSender]`, so the gate selects it. The schema and
migration edits are integration-owned: they were authored under the sanctioned `ALLOW_SCHEMA_CHANGE=1`
override and ship from `integration/schedule-scale-hardening`, which is why this gate runs at all. Every one of
the 37 steps is walked below — none pre-filtered — and each gets either the changed concrete artifact or the
reason it is unchanged.

### Shared structural findings (established once, cited per step)

- **S1 — the schema delta is purely additive.** Migration `0013_schedule_calendar_ledger.sql` creates
  `calendar_invite_revisions`, `calendar_invite_processed_outbox` and `calendar_invite_sequence_frontiers`,
  and adds two NULLABLE columns to `email_outbox` (`send_claim_id`, `send_claim_expires_at`). No existing
  column changes type, nullability or default; no existing index is dropped. Every step that only reads or
  writes pre-existing columns is byte-identical to `origin/main`.
- **S2 — the port's public shape is unchanged.** `EmailMessage`, `EmailResult` and
  `EmailSender.send(msg): Promise<EmailResult>` stay compatible with `origin/main`. The delta lives inside
  the two adapters plus one OPTIONAL `onInFlight?: "dedupe" | "reject"` field whose default (`"dedupe"`)
  reproduces main's behavior exactly. Callers that do not set it are unaffected.
- **S3 — newly observable adapter behavior requires a `dedupeKey` collision with a prior row.** The local
  adapter retries a non-`sent`/`bounced` collision in place (`deduped: false`). The Resend adapter wraps
  provider/network faults in `EmailDeliveryError` — main already threw plain `Error`s from the same points,
  so this is not a caller-visible change — and throws `EmailSendInFlightError` ONLY when the caller passes
  `onInFlight: "reject"`, which on this branch is exactly two call sites (`app/domain/accept.ts:891`,
  `app/domain/schedule-update.ts:1368`), neither reachable from this scenario file.

### AE-S1 — admin signs in (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Logged-out deep-link gating reads `authSessions`/`users` only; no touched file is on this path (S1). |
| 2 | UNCHANGED | Wrong-password rejection writes nothing; `email_outbox` is not read. |
| 3 | UNCHANGED | Re-probe of the admin URL is the same session lookup as step 1. |
| 4 | UNCHANGED | Successful login inserts `authSessions`; no touched column. |
| 5 | UNCHANGED | Seed-event submissions list reads `submissions`/`events`; the three new tables are additive and unjoined here (S1). |
| 6 | UNCHANGED | Logout deletes the session row; no email or calendar path. |

### AE-S2 — create a brand-new event (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Same login path as AE-S1.4. |
| 2 | UNCHANGED | Blank-name inline error is form validation only. |
| 3 | UNCHANGED | Event insert touches `events`; `calendar_invite_processed_outbox.event_id` is a new FK *into* `events`, adding no constraint to inserts. |
| 4 | UNCHANGED | Switcher lists `events` rows. |
| 5 | UNCHANGED | Empty states across submissions/forms/library/evaluation. The new event has no `email_outbox` rows, so normalization has nothing to resume; the Agenda continuation affordance (the only new UI) is not on any of these screens. |
| 6 | UNCHANGED | Location/end-date edit writes `events`; agenda-relevant columns (`agendaDayStartMin`, timezone) are unchanged by this branch. |
| 7 | UNCHANGED | Hard-reload persistence is a plain reread. |
| 8 | UNCHANGED | Seed event untouched — nothing in this branch writes cross-event state; the cross-event guard added to normalization *fails closed* rather than mutating. |

### AE-S3 — build the library (9 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Library screen reads `tracks`/`tags`/`formats`/`levels`/`rooms`. |
| 2 | UNCHANGED | Track create + blank-name error; no touched table. |
| 3 | UNCHANGED | Tag create. |
| 4 | UNCHANGED | Format create with default durations. `formats.defaultDurationMins` feeds agenda end-time auto-fill, which this branch does not modify. |
| 5 | UNCHANGED | Level create. |
| 6 | UNCHANGED | Room create. `rooms` is read by the ICS `LOCATION` builder, but only at send time (scenario 06/08), not here. |
| 7 | UNCHANGED | Track rename + recolor. |
| 8 | UNCHANGED | Level delete and dropdown propagation. |
| 9 | UNCHANGED | Reload persistence. |

### AE-S4 — custom-field library (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Fields area reads `fields`. |
| 2 | UNCHANGED | Blank-name error, type retained. |
| 3 | UNCHANGED | Five field creates across all six types; org-wide vs event scope is unaffected by S1. |
| 4 | UNCHANGED | Rename. |
| 5 | UNCHANGED | Delete + picker removal. |
| 6 | UNCHANGED | Cross-event scope check reads `fields` with `eventId IS NULL`. |
| 7 | UNCHANGED | Picker search narrowing is client-side over `fields`. |

### AE-S5 — provision a reviewer (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Reviewer create writes `users`/`reviewerTracks`. |
| 2 | UNCHANGED | Admin-side reviewer list. |
| 3 | **CHANGED — same oracle, different failure surface.** | The invite send goes through `app/ports/email.ts`. The oracle is unchanged: an outbox row addressed to `nadia.kessler@example.com` with a working set-password link. What changed is the *duplicate* path. `mintInviteToken` derives its token deterministically (`sha256Hex("reviewer-invite:" + userId + ":" + sendKey)`, `app/lib/reviewers.ts:143`) and `admin.reviewers.tsx` only format-checks `sendKey` without consuming it, so a double-clicked Invite button produces a colliding `dedupeKey`. On `origin/main` the second request returned `{ deduped: true }`. Mid-branch it threw `EmailSendInFlightError`, which this route does not catch — a 500 page for a send that actually succeeded. Fixed before this gate closed by defaulting `onInFlight` to `"dedupe"` (S2), restoring main's behavior for this and every other un-opted-in caller. Regression test: `test/email.resend.test.ts` — "reports a concurrent claim as a duplicate for a caller that keeps no delivered-state". |
| 4 | UNCHANGED | Invite link → set password → login reads `passwordResets`; the token row is written by `mintInviteToken`, not by the port. |
| 5 | UNCHANGED | Empty reviewer queue. |
| 6 | UNCHANGED | Admin-URL 403 for a reviewer. |
| 7 | UNCHANGED | Logout / re-login durability. |

### Re-walk verdict

**37/37 steps re-walked. 1 CHANGED (AE-S5.3), 36 UNCHANGED, 0 BLOCKER, 0 MAJOR.** The single change is a
regression this gate *found and fixed*: the branch's strict in-flight signal is now opt-in, so the ~12
un-audited single-recipient route send sites — this invite among them — keep `origin/main`'s double-submit
behavior. No `touches:` update required; `emailOutbox` and `ports: [EmailSender]` already select this file.
