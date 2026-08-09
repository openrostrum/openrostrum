# Design walk — 07 tasks-portal-forms (2026-08-09)

Walked against: `app/db/schema.ts` (current), `app/lib/auth.ts`, `app/ports/*`,
`docs/ROUTE-MAP.md`, `drizzle/seed.sql`, `SCOPE.md` P0 #4/#7 + P1 #3/#8,
`docs/flows/07-portals-tasks.md`, `docs/flows/09-data-exposure.md`, and the
golden path `app/routes/admin.submissions.tsx`. Every step below produces the
concrete artifact the step needs, or files a gap. IDs like `ta_priya_hotel` are
placeholders for `crypto.randomUUID()` values; seeded IDs (`task_hotel`,
`pf_hotel`, `e_demo`…) are literal from `drizzle/seed.sql`.

**Verdict summary: 0 BLOCKER · 7 MAJOR · 9 MINOR · no SCENARIO-ERROR**
(one borderline flag on TK-S3.9, see there). Ranked list at the bottom.

---

## TK-S1 — Accepting a submission auto-assigns the onboarding task set

### TK-S1.1 — Admin locates the pending submission
Priya is NOT in `drizzle/seed.sql` (seeded speakers are Sam/Alex) — the scenario
allows "submitted via the public CFP form first", so the fixture path is
`submit.$eventSlug.$formId.tsx` (ROUTE-MAP, Wave 2) creating:
`users(u_priya)`, `contacts(c_priya, eventId='e_demo', userId='u_priya', email='priya.sharma@example.com')`,
`submissions(s_priya, status='pending', title='Scaling Vector Search at the Edge')`,
`participants(p_priya, submissionId='s_priya', contactId='c_priya', role='speaker', isPrimary=1)`.
Locate query (list route `/admin/submissions`, exists):
```sql
SELECT s.id, s.title, s.status
FROM submissions s
WHERE s.event_id = 'e_demo' AND s.status = 'pending'
  AND s.title = 'Scaling Vector Search at the Edge';
-- served by submissions_event_status_idx (event_id, status)
```
**OK** (search/pagination on the list is committed P0 #4; the current loader is
the golden-path stub with `limit: 100`).

### TK-S1.2 — Accept transition
Design location: shared domain function `app/domain/accept.ts` (CLAUDE.md Wave 2
— "build the spine as a shared domain function, not inlined"). D1 forbids
interactive transactions → `db.batch()` (tech-stack rule). Status flip:
```ts
db.update(submissions)
  .set({ status: "accepted", statusChangedAt: clock.now() })
  .where(and(eq(submissions.id, "s_priya"), eq(submissions.eventId, "e_demo")));
```
"Create Session + Speaker records": in THIS schema the accepted submission IS
the session (schema.ts:410 comment) and the contact IS the speaker — both
already exist from the CFP submit. The accept spine's remaining provisioning is
the task-assignment set (next step).
**OK**

### TK-S1.3 — Auto-provisioning: the taskAssignments INSERT
Source set: `tasks WHERE isOnboardingDefault = 1` → seeded `task_hotel`
(type `contact`, portalFormId `pf_hotel`), `task_flight` (contact, `pf_flight`),
`task_slides` (type `submission`, isFileRequest should be 1 — see note). Target
per TASK_TYPE, matching the seed's own shape (`ta_1/ta_2` contact-only,
`ta_3` contact+submission):
```sql
INSERT INTO task_assignments (id, task_id, contact_id, submission_id, status, due_at, created_at)
SELECT
  <uuid>,                       -- crypto.randomUUID() app-side
  t.id,
  p.contact_id,                                            -- 'c_priya'
  CASE WHEN t.type = 'submission' THEN s.id ELSE NULL END, -- 's_priya' for task_slides
  'incomplete',
  NULL,                         -- ← see GAP (b): nothing supplies a due date
  unixepoch()
FROM tasks t
JOIN submissions s   ON s.id = 's_priya'
JOIN participants p  ON p.submission_id = s.id AND p.role = 'speaker' AND p.is_primary = 1
WHERE t.event_id = s.event_id AND t.is_onboarding_default = 1;
```
Produces exactly 3 rows: (task_hotel,c_priya,NULL), (task_flight,c_priya,NULL),
(task_slides,c_priya,s_priya).
- **GAP (a) — idempotency has no mechanism.** Confirmed: `taskAssignments`
  (schema.ts:648–678) carries only three NON-unique indexes
  (`task_idx`, `contact_status_idx`, `submission_idx`) — there is **no
  `unique(taskId, contactId)`** (nor `unique(taskId, contactId, submissionId)`),
  and no design text specifies an app-level `WHERE NOT EXISTS` guard in the
  accept spine. Replaying accept inserts a second full set. **[MAJOR]**
- **GAP (b) — dueAt has no source.** `tasks` has no default-due column
  (no `dueInDays`/`defaultDueAt`), SCOPE P0 #7 never mentions due dates for the
  auto-assigned set, and the spine spec (SCOPE P0 #4) is silent. Seeded
  assignments carry `due_at` only because the seed writes assignment rows
  directly. Accept-time assignments get `NULL`. **[MAJOR]** (also breaks
  TK-S1.5's "due date must render").
- **GAP (c) — co-speaker fan-out unspecified.** Multi-speaker submission: do
  ALL speaker participants get the contact tasks, or only the primary? SCOPE
  says "assign the onboarding task set" without a target rule. Walked above as
  primary-only (matches seed). Decision needed. **[MINOR]**
- Note: seed sets `task_slides.is_file_request = 0` while TK-S3 treats it as a
  file-request task — seed should set it to 1 (folded into MINOR list).

### TK-S1.4 — Priya opens the portal Tasks tab
Route: `portals.$eventSlug.$portalId.tsx` (+ tasks child) per ROUTE-MAP.
**GAP (d) — `:portalId` references no schema entity.** There is no `portals`
table anywhere in schema.ts; the only "portal" noun is `portalForms`. Appendix E
copies Sessionboard's `/portals/<event-slug>/<portal-uuid>/…` URL, but in this
design nothing mints or resolves a portal uuid (contact id? access token? static
segment?). Every portal deep link (incl. the email portal-link merge tag,
EM-S3) dangles on this. **[MAJOR]**
The loader query itself is walkable once identity is resolved via the session
user (ownership never comes from the URL):
```sql
SELECT ta.id, ta.status, ta.due_at, ta.response IS NOT NULL AS has_response,
       t.name, t.description, t.link_url, t.is_file_request, t.portal_form_id
FROM task_assignments ta
JOIN tasks t    ON t.id = ta.task_id
JOIN contacts c ON c.id = ta.contact_id
WHERE c.user_id = :sessionUserId AND c.event_id = 'e_demo'
ORDER BY (ta.due_at IS NULL), ta.due_at;
-- contacts_user_idx → contact; task_assignments_contact_status_idx → assignments
```
**GAP filed above; query OK.**

### TK-S1.5 — Three tasks listed incomplete, each with a visible due date
Listing + incomplete state: served by the TK-S1.4 query (all 3 rows
`status='incomplete'`). Due date: the rows from TK-S1.3 carry `due_at = NULL` —
there is nothing to render. Same root cause as GAP (b). **GAP [MAJOR, dup of
TK-S1.3(b)]**

### TK-S1.6 — Replay the accept: still exactly one assignment per task
Verification query the scenario runs:
```sql
SELECT task_id, COUNT(*) AS n
FROM task_assignments
WHERE contact_id = (SELECT id FROM contacts WHERE event_id='e_demo' AND email='priya.sharma@example.com')
GROUP BY task_id HAVING n > 1;   -- must return 0 rows
```
With the current design the replayed INSERT…SELECT of TK-S1.3 succeeds again →
`n = 2` for all three tasks. No constraint stops it, no spec text prevents it.
**GAP [MAJOR, same as TK-S1.3(a)]** — fix is either
`unique("task_assignments_task_contact_uq").on(t.taskId, t.contactId, t.submissionId)`
(integration-owned schema change; note SQLite treats NULLs as distinct in
unique indexes, so submission-scoped rows need contactId always set — the seed
already does this) or a specified `WHERE NOT EXISTS` in `app/domain/accept.ts`
(safe under D1's single-writer).

---

## TK-S2 — Speaker completes the hotel portal form; organizer reads the response

### TK-S2.1–2 — Open "Hotel Stay Requirements" → renders the attached portal form
Resolution: assignment → `tasks.portalFormId = 'pf_hotel'` → `portal_forms.schema`.
Seeded schema JSON (seed.sql:135):
```json
[{"name":"Hotel name","type":"text","required":true},
 {"name":"Check-in date","type":"date","required":true}]
```
Rendered form = iterate array in order: text input "Hotel name" (required),
date input "Check-in date" (required). Not a bare mark-done checkbox ✓.
- **GAP — seed/scenario mismatch:** the scenario fills a check-out date
  (2026-10-14) but `pf_hotel` has NO "Check-out date" field. Seed needs
  `{"name":"Check-out date","type":"date","required":true}` appended. **[MINOR]**
- **GAP — field identity is the display name.** `schema` entries have no stable
  id; `response` (walked below) must key on the name string, so renaming a
  field orphans every stored answer. Decision (add `id` per field, or freeze
  names) needed. **[MINOR]**
**OK with 2 MINOR gaps.**

### TK-S2.3 — Unhappy: empty required check-in date
Server-side validator derived from the schema JSON (per the golden-path zod
pattern — required ⇒ `.min(1)` so blank strings can't pass):
```ts
const shape = Object.fromEntries(
  portalForm.schema.map((f) => [
    f.name,
    f.required ? z.string().min(1, `${f.name} is required`) : z.string().optional(),
  ]),
);
const parsed = z.object(shape).safeParse(Object.fromEntries(formData));
if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
// ← returns BEFORE any db write: response row absent/unchanged ✓
```
**OK** (no util exists yet, but it is a direct application of the committed
validation pattern; no schema/spec change required).

### TK-S2.4–5 — Submit with concrete values; task flips complete without reload
```sql
UPDATE task_assignments
SET status = 'complete',
    response = '{"Hotel name":"Marriott Marquis","Check-in date":"2026-10-11","Check-out date":"2026-10-14"}',
    completed_at = unixepoch()
WHERE id = 'ta_priya_hotel'
  AND EXISTS (SELECT 1 FROM contacts c
              WHERE c.id = task_assignments.contact_id AND c.user_id = :sessionUserId);
```
`response` is `text(..., {mode:"json"}).$type<Record<string, unknown>>` ✓ —
keys = schema field names (see TK-S2.2 naming caveat). No-reload flip: RR7
`useFetcher()` form → loader revalidation, standard framework behavior ✓.
**OK**

### TK-S2.6–7 — ADMIN READS THE RESPONSE (committed, SCOPE P0 #7)
The query (join taskAssignments + tasks + portalForms + contacts):
```sql
SELECT ta.id, ta.status, ta.response, ta.completed_at, ta.due_at,
       t.name  AS task_name,
       pf.name AS form_name, pf.schema AS form_schema,
       c.first_name, c.last_name, c.email
FROM task_assignments ta
JOIN tasks t             ON t.id = ta.task_id
LEFT JOIN portal_forms pf ON pf.id = t.portal_form_id
JOIN contacts c          ON c.id = ta.contact_id
WHERE ta.id = 'ta_priya_hotel';
```
Render: iterate `form_schema` order, print `response[name]` → "Marriott
Marquis" and "2026-10-11" verbatim ✓.
- **GAP — no route owns this surface.** ROUTE-MAP assigns `admin.tasks.tsx`
  (`/admin/tasks`, "Tasks dashboard") and the three portals-admin files, but NO
  file/URL for the per-assignment response detail (e.g.
  `admin.tasks.$assignmentId.tsx`). SCOPE P0 #7 commits "Admin can READ
  submitted form responses (`taskAssignments.response` detail view)" — a
  committed P0 surface with no route assignment. ROUTE-MAP's own rule: routes
  not in the table must be claimed on the integration branch first. **[MAJOR]**

### TK-S2.8 — DB cross-check
```sql
SELECT status, json_extract(response,'$."Hotel name"')    AS hotel,
       json_extract(response,'$."Check-in date"')          AS check_in,
       json_extract(response,'$."Check-out date"')         AS check_out
FROM task_assignments WHERE id = 'ta_priya_hotel';
-- → 'complete' | 'Marriott Marquis' | '2026-10-11' | '2026-10-14'
```
**OK**

---

## TK-S3 — Slides file request: upload → deny → re-upload → approve

### TK-S3.1–2 — Upload v1
Upload transport per tech-stack mandatory rule: browser PUTs directly to R2
(`BLOBS` binding) via presigned URL — note: presigning against local Miniflare
R2 needs the dev-only fallback of streaming through the Worker or wrangler's
local S3 shim; the rule is written for prod (informational, not a gap).
Recording the upload:
```sql
INSERT INTO files (id, event_id, submission_id, contact_id, task_assignment_id,
                   r2_key, file_name, kind, content_type, size_bytes, version, created_at)
VALUES (<uuid>, 'e_demo', 's_priya', 'c_priya', 'ta_priya_slides',
        'tasks/ta_priya_slides/v1/vector-search-keynote-v1.pdf',
        'vector-search-keynote-v1.pdf', 'slides', 'application/pdf', 2411520, 1, unixepoch());

UPDATE task_assignments
SET status = 'pending_feedback',
    file_key = 'tasks/ta_priya_slides/v1/vector-search-keynote-v1.pdf'
WHERE id = 'ta_priya_slides'
  AND EXISTS (SELECT 1 FROM contacts c
              WHERE c.id = task_assignments.contact_id AND c.user_id = :sessionUserId);
```
- **GAP — dual home for the upload.** Both `taskAssignments.fileKey` (single
  key) and `files` rows (versioned) model the upload; nothing states which is
  canonical or that `fileKey` means "latest version". **[MINOR]**
- Version numbering convention (`version = 1 + max(version) per
  task_assignment_id`) is derivable but unstated — folded into the same MINOR.
**OK with MINOR gap.**

### TK-S3.3 — Task shows pending-review state
`TASK_STATUS` includes `pending_feedback` ✓; portal query (TK-S1.4) surfaces it.
**OK**

### TK-S3.4 — Admin sees the file on the submission, downloadable
Committed P1 #3 ("files listed on the submission (admin side)"). Query:
```sql
SELECT f.id, f.file_name, f.version, f.r2_key, f.content_type, f.size_bytes, f.created_at
FROM files f
WHERE f.submission_id = 's_priya'
ORDER BY f.created_at DESC;         -- files_submission_idx
```
Download: a loader streaming `env.BLOBS.get(r2Key)` with
`Content-Disposition: attachment; filename="vector-search-keynote-v1.pdf"`.
- **GAP — no route in ROUTE-MAP serves file listing/download** (submission
  detail `admin.submissions.$id.tsx` exists for the listing; the byte-serving
  URL, e.g. `files.$fileId.tsx` or a resource route, is unassigned). **[MINOR]**

### TK-S3.5 — Admin DENIES the upload
The only status vocabulary in the design is assignment-level
`incomplete | complete | pending_feedback`. The deny transition can only be:
```sql
UPDATE task_assignments SET status = 'incomplete' WHERE id = 'ta_priya_slides';
```
- **GAP — deny is unrepresentable beyond the flip-back.** (1) No home for a
  deny REASON (`files` has no status/feedback column; `taskAssignments` has no
  feedback field — stuffing it into `response` is unspecified). (2) After deny,
  `incomplete` + existing `files` rows is indistinguishable from "fresh task
  where someone uploaded then admin reverted" — the portal can only *infer*
  "denied, please re-upload" from files-exist ∧ status=incomplete. Sessionboard
  semantics (flows/07 §2d: pending → approved/denied per FILE, deny silent,
  new version allowed) need a per-file status. SCOPE P1 #3 claims this core is
  "schema-ready" — it is only partially: the FLOW works via assignment status,
  the AUDIT TRAIL does not. Needs `files.status`
  (`pending|approved|denied`) + optional `files.reviewNote`, or an explicit
  design note that deny state is assignment-level only. **[MAJOR]**

### TK-S3.6 — Priya sees re-upload enabled
With deny = `incomplete`, the portal task card shows incomplete + upload
control again (uploadable ✓). "Clearly allows a new upload" and "denied ≠
silently stuck" depends on rendering the deny distinctly — blocked by the
TK-S3.5 gap. **GAP [dup of TK-S3.5, MAJOR]**

### TK-S3.7–8 — Re-upload v2; admin approves
```sql
INSERT INTO files (id, event_id, submission_id, contact_id, task_assignment_id,
                   r2_key, file_name, kind, content_type, size_bytes, version, created_at)
VALUES (<uuid>, 'e_demo', 's_priya', 'c_priya', 'ta_priya_slides',
        'tasks/ta_priya_slides/v2/vector-search-keynote-v2.pdf',
        'vector-search-keynote-v2.pdf', 'slides', 'application/pdf', 2683904, 2, unixepoch());
UPDATE task_assignments SET status='pending_feedback',
       file_key='tasks/ta_priya_slides/v2/vector-search-keynote-v2.pdf'
WHERE id='ta_priya_slides';
-- APPROVE:
UPDATE task_assignments SET status='complete', completed_at=unixepoch()
WHERE id='ta_priya_slides';
```
Approve-and-only-approve completes ✓ (deny path never writes `complete`).
**OK**

### TK-S3.9 — DB retains both versions "with their statuses"
Retention ✓ — both `files` rows persist (v1 is never overwritten; new INSERT
per version):
```sql
SELECT version, file_name FROM files
WHERE task_assignment_id = 'ta_priya_slides' ORDER BY version;
-- 1 | vector-search-keynote-v1.pdf
-- 2 | vector-search-keynote-v2.pdf
```
"v1 denied, v2 approved" ✗ — no column records per-file status (TK-S3.5 gap).
**GAP [MAJOR, dup of TK-S3.5]**. Borderline SCENARIO-ERROR note: SCOPE P1 #3
commits the approve/deny CORE but says "message thread/**version UI** stay
out"; if the integration owner rules per-version status out of the core, this
scenario line should relax to "both file rows retained" — otherwise add
`files.status`. One of the two must happen; filed as design gap first.

---

## TK-S4 — Admin creates a contact task with a portal form and assigns it

### TK-S4.1 — Create task "AV Requirements Check"
```sql
INSERT INTO tasks (id, event_id, name, type, description, portal_form_id,
                   is_file_request, required, is_onboarding_default, created_at)
VALUES (<uuid>, 'e_demo', 'AV Requirements Check', 'contact',
        'Tell us your microphone and display needs so the crew can prep your room.',
        :pfAvId, 0, 1, 0, unixepoch());
```
- **GAP — task-CRUD route unassigned.** ROUTE-MAP: `admin.tasks.tsx` is the
  outstanding DASHBOARD; `admin.portals.tsx` is portal appearance;
  `admin.portal-forms.tsx` / `admin.file-requests.tsx` own their nouns. Nobody
  owns task create/edit (Sessionboard: Portals → Tasks). Plausibly
  `admin.tasks.tsx` doubles up, but the map doesn't say — one filename = one
  owner is the map's whole point. **[MINOR]**
- **GAP — TASK_TYPE `'group'` is a dead value.** The enum offers
  contact|group|submission (P1 #8 commits the three types), but there is no
  groups entity anywhere in schema and `taskAssignments` has no `groupId`
  column — a group task can be created and never assigned to anything.
  (Sponsors/exhibitors are OUT per SCOPE.) Drop `group` from the UI or define
  its semantics. **[MINOR]**

### TK-S4.2 — Attach portal form with a required dropdown
Route `admin.portal-forms.tsx` ✓ (ROUTE-MAP). Intended row:
```sql
INSERT INTO portal_forms (id, event_id, name, title, target_type, schema, created_at)
VALUES (<uuid>, 'e_demo', 'AV Requirements', 'AV Requirements', 'contact',
 '[{"name":"Microphone","type":"dropdown","required":true,"options":["Handheld","Lavalier","Podium"]},
   {"name":"Display notes","type":"textarea","required":false}]', unixepoch());
```
- **GAP — the schema CONTRACT has no `options`.** `portalForms.schema` is typed
  `Array<{ name: string; type: string; required: boolean }>` (schema.ts:605) —
  a dropdown's choices have no specified home. The JSON column physically
  tolerates extra keys, but the drizzle `$type` contract (the SSOT every
  builder/renderer/validator codes against) forbids them; the seeded hotel/
  flight forms never exercise a dropdown so nothing caught it. Widen to
  `{ name; type; required; options?: string[] }` (type-only change, no
  migration). **[MAJOR]** — without it TK-S4.2 (builder), TK-S4.6 (render +
  validate-in-options) are unwalkable.

### TK-S4.3 — Assign to accepted speakers, due 2026-10-01
Mechanically expressible:
```sql
INSERT INTO task_assignments (id, task_id, contact_id, status, due_at, created_at)
SELECT <uuid>, :taskId, c.id, 'incomplete', unixepoch('2026-10-01'), unixepoch()
FROM contacts c
WHERE c.event_id = 'e_demo'
  AND EXISTS (SELECT 1 FROM participants p
              JOIN submissions s ON s.id = p.submission_id
              WHERE p.contact_id = c.id AND s.status = 'accepted');
```
(Manual assignment CAN carry a due date — contrast with the accept-spine dueAt
gap in TK-S1.3.)
- **GAP — assign-to-whom semantics unspecified.** SCOPE P0 #7 specifies only
  auto-assign-on-accept; P1 #8 commits "task types, portal forms attachable,
  file-request tasks" but names NO manual-assignment surface (all accepted
  speakers? contact picker? Sessionboard's portal-membership + per-record
  model from flows/07 §2b is documented parity but nothing commits a clone
  mechanism). The scenario's step is undischargeable against any committed
  spec text. Decision needed: minimum viable = "assign to: [all accepted
  speakers | pick contacts]" on the task form. **[MAJOR]**
- Duplicate-assignment on re-run: same missing-uniqueness issue as TK-S1.3(a).

### TK-S4.4 — Unhappy: empty task name
Golden-path validation, `insertTaskSchema` refined:
```ts
const NewTask = insertTaskSchema
  .pick({ name: true, type: true, description: true, portalFormId: true })
  .extend({ name: z.string().min(1, "Task name is required") });
// parse fail → return { fieldErrors } — no INSERT executed, no orphan row ✓
```
**OK**

### TK-S4.5 — Priya's portal shows the task with description + due date
Served by the TK-S1.4 portal query — row: name='AV Requirements Check',
description=…, due_at=unixepoch('2026-10-01') renders 2026-10-01 ✓.
**OK** (given TK-S4.3's assignment happened)

### TK-S4.6 — Complete with "Lavalier"; admin reads it
Speaker submit (same shape as TK-S2.4):
```sql
UPDATE task_assignments
SET status='complete', response='{"Microphone":"Lavalier","Display notes":""}',
    completed_at=unixepoch()
WHERE id='ta_priya_av' AND EXISTS (SELECT 1 FROM contacts c
  WHERE c.id=task_assignments.contact_id AND c.user_id=:sessionUserId);
```
Validation that "Lavalier" ∈ options requires the options key — blocked by
TK-S4.2 gap. Admin read: same query as TK-S2.6 → same missing-route gap.
**GAP [dups: TK-S4.2 MAJOR, TK-S2.6 MAJOR]**

---

## TK-S5 — Outstanding-tasks dashboard at ~100 speakers

### TK-S5.1–2 — Scale fixture
Bulk-accept/seed until ~100 accepted speakers × 3 onboarding assignments;
Priya fixed at hotel=complete, flight=incomplete, slides=incomplete. State is
expressible entirely in seeded rows (mechanism is tooling, not design).
**OK**

### TK-S5.3–4 — The dashboard queries (route `admin.tasks.tsx` = `/admin/tasks` ✓ ROUTE-MAP)
Per-speaker list (paginated):
```sql
SELECT c.id, c.first_name, c.last_name, c.email,
       COUNT(*)                    AS outstanding,
       GROUP_CONCAT(t.name, ', ')  AS outstanding_tasks
FROM task_assignments ta
JOIN contacts c ON c.id = ta.contact_id
JOIN tasks t    ON t.id = ta.task_id
WHERE c.event_id = 'e_demo'
  AND ta.status <> 'complete'
GROUP BY c.id
ORDER BY outstanding DESC, c.last_name
LIMIT 25 OFFSET 0;
```
Headline counts (the independent-aggregation oracle is the same SQL):
```sql
SELECT COUNT(DISTINCT ta.contact_id) AS speakers_with_outstanding,
       COUNT(*)                      AS total_outstanding
FROM task_assignments ta
JOIN contacts c ON c.id = ta.contact_id
WHERE c.event_id = 'e_demo' AND ta.status <> 'complete';
```
Index fit: `task_assignments_contact_status_idx (contact_id, status)` gives
per-contact status lookups; at 100 speakers × ~3–5 assignments (≤500 rows) the
scan is trivially <1s. Priya → outstanding = 2 ✓.
- **GAP — is `pending_feedback` outstanding?** Walked as `status <> 'complete'`
  (an uploaded-but-unreviewed file is still outstanding work). If instead only
  `= 'incomplete'` counts, Priya's number changes the moment she uploads
  slides. Nothing in SCOPE P0 #7 decides. Record the choice. **[MINOR]**
- **Consistency rule (note, covered by TK-S1.3 walk):** submission-type
  assignments MUST always carry `contactId` (the seed does; the spine INSERT
  above does) or they silently vanish from this per-speaker aggregation.

### TK-S5.5–6 — Priya completes flight; dashboard re-aggregates
Seeded `pf_flight` schema is `[{"name":"Airline",...},{"name":"Amount (USD)",...}]`
— the scenario's values fit exactly:
```sql
UPDATE task_assignments
SET status='complete', response='{"Airline":"United","Amount (USD)":"412.50"}',
    completed_at=unixepoch()
WHERE id='ta_priya_flight' AND <ownership EXISTS as in TK-S2.4>;
```
Dashboard is loader-driven (no cache layer exists in the design) → refresh
re-runs the GROUP BY → 1 outstanding ✓ totals drop ✓.
**OK**

### TK-S5.7 — Search "Priya" among ~100
```sql
... AND (c.first_name LIKE '%Priya%' OR c.last_name LIKE '%Priya%' OR c.email LIKE '%Priya%')
```
LIKE-scan over ≤ a few hundred event contacts (contacts_event_idx narrows) —
instant at this scale. **OK**

---

## TK-S6 — Authorization probe

### TK-S6.1–2 — Mallory exists with own tasks; Priya's tasks absent from her portal
Fixture via CFP + accept (same path as TK-S1). Mallory's portal list is the
TK-S1.4 query keyed on `c.user_id = :mallorySessionUser` — Priya's rows can't
appear (different contact). **OK**

### TK-S6.3–4 — Forged GET + POST on Priya's assignment id
The ownership check the design supports (assignment.contactId →
contacts.userId → session user):
```ts
// GET loader of the task detail route
const user = await requireUser(env, request);            // app/lib/auth.ts:186
const [row] = await db
  .select({ id: taskAssignments.id })
  .from(taskAssignments)
  .innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
  .where(and(
    eq(taskAssignments.id, params.assignmentId),         // Priya's 'ta_priya_flight'
    eq(contacts.userId, user.id),                        // Mallory's user id → no match
  ))
  .limit(1);
if (!row) throw new Response("Not found", { status: 404 });   // leak nothing
```
Forged POST: the action self-authenticates (`requireUser`) — enforced by the
`require-auth-in-actions` ESLint rule (tech-stack) — and the mutation carries
the same ownership predicate INSIDE the UPDATE (see TK-S2.4's
`AND EXISTS (...c.user_id = :sessionUserId)`), so a forged body affects 0 rows
→ respond 404. DB byte-identical ✓:
```sql
SELECT status, response FROM task_assignments WHERE id='ta_priya_flight';
-- unchanged
```
- **GAP — no shared ownership helper is specified.** The contactId→userId rule
  is the only viable path in this schema and flows/09 mandates server-side
  projections, but each portal route re-derives it by hand; P2 #6 already
  observes portal auth must live in ONE helper. A `requirePortalContact(env,
  request, {assignmentId})` seam should be named in the design. **[MINOR]**
- **GAP — contact-without-user.** `contacts.userId` is nullable (seeded
  `c_alex` is NULL): an admin-added co-speaker has assignments no login can
  ever reach (the ownership join excludes them by construction — safe, but the
  tasks are permanently uncompletable and no invite/claim flow is specified
  outside reviewer provisioning). Decision needed. **[MINOR]**

### TK-S6.5 — Logged-out GET
`requireUser` → `throw redirect("/login?redirectTo=" + pathname)`
(auth.ts:193–195) — never renders task content ✓. Clean error page: the route
`ErrorBoundary` pattern (golden path admin.submissions.tsx:221) renders the
styled generic page for the 404 thrown above; `/403` exists for role
mismatches. **OK**

---

## Ranked gaps (this file)

| # | Where | Gap | Severity |
|---|---|---|---|
| 1 | TK-S1.3/1.6 (+TK-S4.3) | No idempotency for task assignment: no `unique(taskId, contactId, submissionId)` on `taskAssignments`, no specified app-level guard — replaying accept duplicates the onboarding set | MAJOR |
| 2 | TK-S1.3/1.5 | `dueAt` has no source for auto-assigned tasks: no default-due column on `tasks`, spine spec silent → speakers see no due dates (scenario step 5 fails) | MAJOR |
| 3 | TK-S2.6 / TK-S4.6 | Committed admin response view (SCOPE P0 #7) has NO route in docs/ROUTE-MAP.md | MAJOR |
| 4 | TK-S3.5/3.6/3.9 | Deny state unrepresentable: no per-file status (`files.status pending/approved/denied`), no deny-reason home; deny→`incomplete` indistinguishable from fresh task | MAJOR |
| 5 | TK-S4.2/4.6 | `portalForms.schema` `$type` lacks `options` — dropdown portal-form fields (committed P1 #8 flow) can't carry their choices or be validated | MAJOR |
| 6 | TK-S4.3 | Manual task-assignment semantics (assign to whom, via what surface) specified nowhere in SCOPE/ROUTE-MAP | MAJOR |
| 7 | TK-S1.4 / TK-S6.3 | `portals.$eventSlug.$portalId.tsx` `:portalId` references no schema entity (no portals table; identifier unminted/unresolvable) | MAJOR |
| 8 | TK-S2.2 | Seeded `pf_hotel` lacks the "Check-out date" field the scenario fills | MINOR |
| 9 | TK-S2.2 | Portal-form field identity = display-name string; rename orphans stored responses | MINOR |
| 10 | TK-S3.2 | Dual home for uploads (`taskAssignments.fileKey` vs versioned `files` rows); canonical source + version-numbering convention unstated | MINOR |
| 11 | TK-S3.4 | File download/byte-serving route unassigned in ROUTE-MAP | MINOR |
| 12 | TK-S4.1 | Task-CRUD route unassigned (dashboard vs CRUD ownership of `admin.tasks.tsx` ambiguous) | MINOR |
| 13 | TK-S4.1 | `TASK_TYPE 'group'` is a dead enum value (no groups entity, no `groupId` target column) | MINOR |
| 14 | TK-S5.4 | Whether `pending_feedback` counts as outstanding is undecided (changes dashboard numbers) | MINOR |
| 15 | TK-S1.3 | Co-speaker fan-out on accept (primary only vs all speakers) unspecified | MINOR |
| 16 | TK-S6.3 | No shared portal-ownership helper named; contact-without-user (`contacts.userId` NULL) yields permanently uncompletable assignments | MINOR |
| 17 | TK-S1.3/TK-S3 | Seed sets `task_slides.is_file_request = 0` though it's the file-request fixture | MINOR |

**SCENARIO-ERRORS: none.** Borderline: TK-S3.9's "with their statuses (v1
denied, v2 approved)" exceeds the schema-ready claim of SCOPE P1 #3 (which
excludes "version UI"); resolve by adding `files.status` or relaxing that one
assertion to row retention (gap #4 covers it).
