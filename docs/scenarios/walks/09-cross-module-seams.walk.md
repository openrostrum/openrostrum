# Walk — 09 cross-module seams

Design-side validation, pre-swarm. For every step: the concrete artifact that serves it
(actual SQL against `app/db/schema.ts`, actual JSON, actual route, actual port call) then
`OK` / `GAP` / `SCENARIO-ERROR`. Severities: **BLOCKER** = unservable · **MAJOR** =
workaround-only or committed-but-homeless · **MINOR** = underspecified.

Design read: `app/db/schema.ts` (all 27 tables) · `drizzle/migrations/0000_charming_magdalene.sql`
(actual `ON DELETE`) · `app/lib/auth.ts` · `app/ports/*` · `app/jobs/registry.ts` ·
`workers/app.ts` · `app/routes/*` + `docs/ROUTE-MAP.md` · `react-router.config.ts` +
`vite.config.ts` (single-fetch / no `v8_middleware`) · `SCOPE.md` · `CLAUDE.md` ·
`docs/flows/02,03,04,06,07,09`.

**Note on "session record":** there is NO separate `sessions` table. An accepted submission
IS the session — `submissions` carries `starts_at`/`ends_at`/`room_id`. So "auto-provision the
session" is a no-op for the record itself (it already exists from submit); the accept transition
only flips `status` and provisions `task_assignments`. This removes an entire dual-write race —
it is the one seam that is *well* modeled. The `submission_answers`/`participants`/tracks all
hang off `submissions.id` and therefore survive accept+schedule untouched (XM-S3.7 passes for free).

---

## XM-S1 — the full spine (public submit → accept → portal → agenda → dashboard)

**Step 1** [admin] locate form, Copy Link.
`SELECT public_id FROM forms WHERE event_id='e_demo' AND internal_name='Call for Speakers 2026'`
→ URL `/submit/ai-engineer-sandbox/<public_id>` (route `submit.$eventSlug.$formId.tsx`, per
ROUTE-MAP). `close_at`, `submission_limit`, `success_html` all live columns on `forms`. **OK**

**Step 2** [anon] open URL; welcome + close-date banner.
Loader: `SELECT external_title, welcome_html, show_welcome, close_at, submission_limit FROM forms
WHERE public_id=?`. Banner renders `close_at` in event TZ. Public route, no session. **OK**

**Step 3** [anon] email-first → branch to signup, create account.
Lookup `SELECT id FROM users WHERE email = ?` → miss → `INSERT INTO users (id,email,password_hash,
name,role) VALUES (uuid, 'maya.chen@example.com', hashPassword('Kms!2026demo'), 'Maya Chen',
'speaker')` (hash via `app/lib/auth.ts`), then `INSERT INTO contacts (id,event_id,user_id,email,
first_name,last_name) VALUES (uuid,'e_demo',<user>,'maya.chen@example.com','Maya','Chen')`.
**GAP [MAJOR]** — email identity is not case-normalized anywhere. `users_email_unique` and
`contacts_event_email_uq` are BINARY-collation (no `COLLATE NOCASE` in the migration), and
`login.tsx` does `eq(users.email, raw)`. The design never states "lowercase email before
insert/lookup." Load-bearing for XM-S4.7. (Filed once under XM-S4; noted here as its origin.)

**Step 4** [anon] empty-Title validation, then fill fields incl. Format "Workshop".
Golden-path pattern: `insertSubmissionSchema.pick({title}).extend({title: z.string().min(1)})`.
`format_id` resolved from `SELECT id FROM formats WHERE event_id='e_demo' AND name='Workshop'`.
Inline error + no data loss = client form state. **OK** (the Format-*as-conditional-trigger*
defect is XM-S3, not exercised here).

**Step 5** [speaker] add speaker 2 Diego; live email validation.
`INSERT INTO contacts (…, email='diego.alvarez@example.com', first_name='Diego', last_name=
'Alvarez')`; participant rows created at submit (step 6). Client `type=email` + server zod
`.email()`. **OK**

**Step 6** [speaker] Review → Submit; success page + confirmation email.
`db.batch([ INSERT submissions {event_id:'e_demo', form_id:<form>, type:'session', title:
'Serving 10B Tokens…', status:'pending' (server-default, never client), submitter_id:<Maya.user>,
format_id:<workshop>, level_id, language:'English'}, INSERT participants ×2 {submission_id,
contact_id, role:'speaker', is_primary:(Maya true/Diego false), position} ])`. Success reads
`forms.success_html`. Then `getEmailSender(env).send({to:'maya.chen@example.com', subject, html:
<portal link>, dedupeKey:'confirm:'+<submissionId>, templateId:'et_confirm', eventId:'e_demo'})`
→ row in `email_outbox`. Signals: `SELECT count(*) FROM email_outbox WHERE "to"=
'maya.chen@example.com'` = 1; `SELECT * FROM submissions WHERE title LIKE '%Shoestring%'` = 1
(pending); `SELECT count(*) FROM participants p JOIN submissions s ON s.id=p.submission_id
WHERE s.title LIKE '%Shoestring%'` = 2. **OK** (D1 has no interactive tx — `db.batch()` per
tech-stack.md; the multi-insert must use it). EXPERIENCE (phone, <3 min) = UI.

**Step 7** [admin] find row, inline status → Accept Queue.
`UPDATE submissions SET status='accept_queue', status_changed_at=unixepoch() WHERE id=?`
(action `requireAdmin`). NO email (SCOPE P0 #4 "status changes NEVER auto-send"). **OK**
SCALE: `admin.submissions.tsx` loader currently `limit:100` with no `offset`, no search
`WHERE`, no per-status `count`. **GAP [MINOR]** — the golden path it copies has no pagination
cursor / search / status-tab counts; the 25/page + search-'Shoestring'-<1s + per-tab-count
signal needs those added when the real list is built (title has no index/FTS, `LIKE` is fine
at hundreds).

**Step 8** [speaker] portal shows "Pending" not "Accept Queue"; no new email.
Portal loader must project `accept_queue → 'Pending'` **server-side** before serialization.
**GAP [MAJOR]** — see XM-S6: there is no shared masking function anywhere in the design (no
`app/domain`, no helper in `constants.ts`). Outbox unchanged: trivially true (step 7 sent
nothing). The mask is the risk.

**Step 9** [admin] bulk accept 3 rows → send template + .ics → flip to Accepted.
Per selected row: `getEmailSender(env).send({to:<speaker>, subject:<from emailTemplates key=
'accept'>, html, ics:<VCALENDAR built by the `ics` util>, dedupeKey:'accept:'+<subId>,
templateId:'et_accept'})` then `UPDATE submissions SET status='accepted', notified_at=
unixepoch() WHERE id IN (…)`. `email_outbox.ics_attachment` column holds the VEVENT text
(≤100/send = app loop cap). Signal: `SELECT ics_attachment FROM email_outbox WHERE "to"=
'maya…'` parses BEGIN:VCALENDAR. **OK** (schema supports; suppression check on
`email_suppressions` before bulk send per SCOPE cross-cutting).

**Step 10** [speaker] onboarding tasks auto-appear (hotel + flight), created by the transition.
The accept transition must run:
`INSERT INTO task_assignments (id,task_id,contact_id,submission_id,status,created_at)
 SELECT randomblob-uuid, t.id, <speakerContactId>, NULL, 'incomplete', unixepoch()
 FROM tasks t WHERE t.event_id='e_demo' AND t.is_onboarding_default=1 AND t.type='contact'`
→ `created_at = now()` satisfies "within seconds of the flip." Seed already has
`tasks.is_onboarding_default=1` on `task_hotel`/`task_flight`. **GAP [MAJOR — the spine]**:
(a) `app/domain/accept.ts` is DOC-ONLY (no `app/domain/` dir exists); the transition is
unbuilt and the golden-path action does not do it. CLAUDE.md names the side effects
(speaker+session+tasks) but leaves three things unspecified: (b) **fan-out** — do the
contact-type onboarding tasks assign to *every* speaker contact or only the submitter?
(Maya is submitter+speaker; is Diego assigned hotel/flight too?) (c) **idempotency** — a
second accept (re-accept after withdraw) must not double-insert (there is no
`unique(task_id,contact_id,submission_id)` on `task_assignments`, so nothing stops
duplicates). (d) the `submission`-type task `task_slides` (`is_onboarding_default=1`,
`type='submission'`) should assign with `submission_id` set, not `contact_id` — the query
above only handles `type='contact'`. The schema *supports* all of this; the binding spec does not.

**Step 11** [speaker] fill hotel task, submit.
`UPDATE task_assignments SET response=json('{"Check-in date":"2026-10-11","Check-out date":
"2026-10-15","Room preference":"Non-smoking, high floor"}'), status='complete', completed_at=
unixepoch() WHERE id=? AND contact_id=<Maya>` (portal action `requireUser` + ownership).
EXPERIENCE (flips to Complete, no full reload) = RR `useFetcher`. **OK**

**Step 12** [admin] task-response detail readable.
`SELECT response FROM task_assignments WHERE id=?` → render JSON verbatim (route
`admin.tasks.tsx`). **OK**

**Step 13** [admin] session sits in Unscheduled; drag → end auto-fills (Workshop 90 min).
Unscheduled panel: `SELECT * FROM submissions WHERE event_id='e_demo' AND status IN
(<schedulable>) AND starts_at IS NULL`. Drag writes
`UPDATE submissions SET starts_at=unixepoch('2026-10-13 10:00'), ends_at = starts_at +
(SELECT default_duration_mins FROM formats WHERE id=submissions.format_id)*60, room_id='room_a'
WHERE id=?`. Track color from `tracks.color`. Signal: `ends_at - starts_at = 5400`. **OK**
(`events.schedulable_statuses` JSON drives the status filter; end-time from
`formats.default_duration_mins` computed at drag-time and *stored*.)

**Step 14–15** [admin] manual Add Submission (Diego) → conflict → resolve.
Manual insert: `INSERT submissions {title:'Office Hours…', status:'accepted', event_id}` +
`INSERT participants {contact_id:<Diego>, role:'speaker'}`; schedule onto 10:30 Room B.
Conflict query (speaker double-book + same-room overlap — the two Sessionboard classes,
no track collision per flow 06):
```sql
SELECT a.id, b.id FROM submissions a JOIN submissions b ON a.id<b.id
 AND a.event_id=b.event_id AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
WHERE (a.room_id=b.room_id)
   OR EXISTS (SELECT 1 FROM participants pa JOIN participants pb
              ON pa.contact_id=pb.contact_id
              WHERE pa.submission_id=a.id AND pb.submission_id=b.id);
```
Reciprocal pair naming Diego. Resolve = `UPDATE submissions SET starts_at=…13:00 WHERE id=
<office hours>` → re-run query, empty. **OK** (schema supports; conflict recompute-on-refresh
per flow 06 — matches the "Conflicts tab" model).

**Step 16** [admin] outstanding-tasks dashboard: Maya = 1 (Flight only).
```sql
SELECT c.first_name, c.last_name, count(*) AS outstanding
FROM task_assignments ta JOIN contacts c ON c.id=ta.contact_id
WHERE ta.status='incomplete' AND c.event_id='e_demo'
GROUP BY c.id;
```
Uses index `task_assignments_contact_status_idx`. After step 11 hotel=complete → Maya
outstanding=1 (Flight). **OK**

---

## XM-S2 — config → public propagation

**Step 1–2** rename field, change close date + success message; verify on live public form.
`UPDATE fields SET name='Special requirements' WHERE id=<fld>` ·
`UPDATE forms SET close_at=unixepoch('2026-08-20 23:59'), success_html='Decisions go out the
week of August 24.' WHERE id=<form>`. Public form loader reads `fields.name` via
`form_fields → fields` join and `forms.close_at`/`success_html` **live** — no snapshot, no
republish. **OK.** (Caveat, not a gap: `fields` is a shared library — renaming propagates to
*every* form using that field; flow 01 confirms this is the intended Sessionboard behavior.
There is no per-placement label override column on `form_fields`.)

**Step 3–4** rename track "Developer Experience" → "DevEx & Tooling"; verify everywhere.
`UPDATE tracks SET name='DevEx & Tooling' WHERE id=<track>` — single row. Every surface reads
through the `submission_tracks → tracks` join (public dropdown, admin pills in
`admin.submissions.tsx`, portal detail, agenda card), so all reflect the rename with no copy.
Facet count: `SELECT track_id, count(*) FROM submission_tracks GROUP BY track_id`. **OK** —
well modeled (no copy-on-write; the "40 stale copies" failure is structurally impossible).

**Step 5** format duration 30→20; drag a new Lightning Talk; old sessions keep times.
`UPDATE formats SET default_duration_mins=20 WHERE name='Lightning Talk'`. New drag computes
`ends_at = starts_at + 20*60` (9:00→9:20). Previously-scheduled sessions keep their **stored**
`starts_at`/`ends_at` (end time is materialized on the row at drag-time, never recomputed from
the format). **OK** — no recompute cascade.

**Step 6** delete track "Web3" (4 submissions) → must refuse-with-count or force reassignment.
Actual FK: `submission_tracks.track_id … ON DELETE cascade` (migration line 320) and
`reviewer_tracks.track_id … ON DELETE cascade`. **GAP [MAJOR]** — a naive
`DELETE FROM tracks WHERE id=<web3>` **silently cascade-deletes** the 4 join rows (and any
reviewer routing rows), stripping the submissions of their track rather than refusing. The
DB-level orphan signal ("0 orphaned rows") passes *trivially* because cascade leaves no
dangling rows — masking the real product defect: submissions silently lose a track and drop
out of reviewer routing. The "refuse-with-count OR force reassignment" behavior must be
enforced in the delete action (`admin.settings.library.tsx`); it is specified NOWHERE. The
reassignment path also needs care — `UPDATE submission_tracks SET track_id=<AI-Infra> WHERE
track_id=<web3>` can violate the composite PK `(submission_id,track_id)` if a submission
already carries AI-Infra, so it must be `INSERT OR IGNORE` the new pairs then delete old.
**GAP [MINOR]** for that PK-collision detail.

**Step 7** close date → yesterday; public shows closed message; replayed POST rejected.
`UPDATE forms SET close_at=unixepoch('2026-08-08') WHERE id=?`. Public loader renders a
closed message when `Clock.now() > close_at` (`app/ports/clock.ts` exists). Replayed POST:
the submit **action** must re-check `close_at` server-side and 4xx. **GAP [MINOR]** — the
close-date server-check in the submit action is not stated in the design (the Clock port
exists but no rule says the public submit action calls it); a UI-only check would let the
replayed POST through.

---

## XM-S3 — built-in ↔ custom field seam (the permanent regression)

**Step 1** create custom field "Workshop prerequisites" (Required) + rule: show WHEN built-in
Format IS "Workshop".
Needed rule JSON, keyed on the **built-in Format dropdown**:
```json
{ "trigger": "Format", "operator": "equals", "value": "Workshop" }
```
Schema shape `form_fields.question_rule`:
```ts
{ fieldId: string; operator: string; value: string } | null   // fieldId REFERENCES fields.id
```
The built-in Format control is NOT a `fields` row — it is `submissions.format_id` driven by the
`formats` taxonomy. There is no `fields.id` to put in `question_rule.fieldId` for Format (nor
for the other built-ins Track/Tags/Level/Language). **GAP [BLOCKER] — CONFIRMED, the known
defect.** A rule triggered by Format is unrepresentable: it can only reference custom/library
fields.

**Minimal schema change that fixes it** (integration-owner, `app/db/schema.ts`):
```ts
questionRule: text("question_rule", { mode: "json" }).$type<{
  trigger:
    | { kind: "field";   fieldId: string }              // references fields.id (custom/library)
    | { kind: "builtin"; ref: "format" | "track" | "tags" | "level" | "language" };
  operator: "equals" | "not_equals" | "contains";        // flow 04/01: Checkbox/Dropdown/Number triggers
  value: string;
} | null>()
```
The public-form rule engine then reads the current value of the built-in control (for `format`,
the selected `format_id`'s name) when `kind:"builtin"`, and the answer value when `kind:"field"`.

**Step 2–3** field hidden by default; toggles on Format=Workshop, off on Featured Keynote,
back-and-forth; ZERO reloads.
Client evaluates the rule against the in-memory Format selection — pure React state, single
page session, no `.data` navigation. **OK once step 1 is fixed** (blocked today because the
rule cannot name Format as its trigger). EXPERIENCE (<100ms, preserve typed content) = UI.

**Step 4** with field hidden, submit succeeds; hidden required NOT blocking, NOT stored.
Two behaviors required and specified **nowhere binding**: (a) validation must SKIP the
`required` check for a field whose question rule is unmet; (b) no `submission_answers` row is
written for it. The golden-path pattern (`insertSubmissionSchema … .min(1)` on every required
field) validates *all* required fields regardless of visibility — a naive copy BLOCKS this
submit. **GAP [MAJOR]** — no validation-logic spec states "hidden-by-rule ⇒ not required, not
stored." Its home would be the public submit action's server-side validator; needs to compute
rule visibility, then validate/store only visible fields.

**Step 5–6** second submission Format=Workshop, fill prereqs, submit; admin detail renders it.
`INSERT submission_answers (id, submission_id, field_id=<prereq>, value='Bring a laptop with
Node 22 and a Cloudflare account')`. Admin detail (`admin.submissions.$id.tsx`):
`SELECT f.name, sa.value FROM submission_answers sa JOIN fields f ON f.id=sa.field_id WHERE
sa.submission_id=?`. **OK** (once the rule works so the field is reachable).

**Step 7** accept + schedule; answer still attached.
Accept/schedule only `UPDATE submissions SET status/starts_at/…`; `submission_answers` is keyed
on `submission_id` and untouched. **OK** — the submission-IS-session model means there is no
provisioning step that could drop answers.

**CSV** custom answer for Lena's row — see XM-S7 pivot. **GAP** carried there.

---

## XM-S4 — identity seam

**Step 1–2** Priya submits A; Rahul adds Priya to B (same event).
Contact reuse: `SELECT id FROM contacts WHERE event_id='e_demo' AND email=?` → reuse existing
Priya contact (created with `user_id` at her signup). Rahul's participant row:
`INSERT participants {submission_id:<B>, contact_id:<Priya's one contact>, role:'speaker'}`.
`contacts_event_email_uq` guarantees one row per (event,email). Signal
`SELECT count(*) FROM contacts WHERE event_id='e_demo' AND email='priya.raman@example.com'`=1.
**OK** for exact-case; **see step 7 for the case gap**. **GAP [MINOR]** — the reverse order
(added as co-speaker *before* she ever signs up → contact with `user_id=NULL`, then link
`UPDATE contacts SET user_id=? WHERE …` on signup) is a linking path the design does not
describe; XM-S4's order (A first) avoids it, but the swarm needs the rule.

**Step 3** Priya's portal lists both A and B under one login.
```sql
SELECT s.* FROM submissions s
 JOIN participants p ON p.submission_id=s.id
 JOIN contacts c ON c.id=p.contact_id
WHERE c.user_id=<Priya.user> AND c.event_id='e_demo';
```
One contact row → both submissions surface. **OK** — verified via the participants join.

**Step 4–5** edit bio once; both admin participant views show new bio.
`UPDATE contacts SET bio='Head of Inference at Nimbus Labs. 10 years in distributed systems.'
WHERE id=<Priya contact>`. Both submissions' participant panes read the same `contacts.bio`.
**OK** — identity lives on `contacts`, not copied per participant (schema comment §28-29). The
co-speaker-privacy signal (Rahul doesn't see Priya's private fields) is a portal projection
concern (flow 09 rule d, "off by default") — model-ready, not exercised destructively here.

**Step 6** email-first lookup offers login, blocks second signup.
`SELECT id FROM users WHERE email=?`. Today `login.tsx` uses `eq(users.email, parsed.data.email)`
with the raw string. EXPERIENCE (inline swap, no reload) = UI. **OK for exact case.**

**Step 7** case variant "Priya.Raman@Example.com" → matched, no new identity.
`users_email_unique` and `contacts_event_email_uq` are default BINARY collation (confirmed in
migration — no `COLLATE NOCASE`), and no code lowercases email before insert/compare.
**GAP [BLOCKER for this step]** — a differently-cased email evades both unique constraints AND
the lookup, creating a duplicate `users` row and a duplicate `contacts` row; Priya then has two
identities and the signal "exactly one identity row, case-insensitively unique" fails. Fix:
normalize (`email.trim().toLowerCase()`) at every write/lookup, or add `COLLATE NOCASE` to the
two email unique indexes (schema change, integration owner). This is the single highest-value
identity fix and it is unspecified. SCALE (search 'Raman' <1s, one row) uses
`contacts_event_idx`; fine once dedup holds.

---

## XM-S5 — lifecycle / deletion seam

**Step 1** precondition: seeded accepted+scheduled submission with tasks. (Data.) **OK**

**Step 2** [speaker] withdraw from portal with reason.
`UPDATE submissions SET status='withdrawn', withdrawn_at=unixepoch(), withdrawn_by_id=
<Noor.user>, withdrawn_reason='Schedule conflict with another conference.' WHERE id=?`
(portal action `requireUser` + ownership). `withdrawn_by_id` references `users` — a speaker or
admin can withdraw. EXPERIENCE (self-serve, no email-the-organizer, list updates w/o reload)
= UI + `useFetcher`. **OK**

**Step 3** admin sees Withdrawn + who/why; agenda no longer shows it as a normal block;
reviewer queues drop it.
Admin detail: `SELECT withdrawn_by_id, withdrawn_reason FROM submissions WHERE id=?`. **OK.**
Agenda ghost: the withdrawn row still has `starts_at`/`ends_at`/`room_id` set. **GAP [MAJOR]** —
the withdraw transition does not clear scheduling, and nothing requires the agenda query to
exclude `status='withdrawn'`. If the grid query is "`WHERE starts_at IS NOT NULL`" (the natural
one) the withdrawn session is a **silent stale block** — the scenario's explicit failure mode.
Fix: either withdraw also nulls `starts_at/ends_at/room_id`, or the agenda query filters
`status IN (<schedulable, minus withdrawn>)`; specify one. Reviewer queue:
`SELECT … WHERE status IN ('pending','accept_queue','decline_queue')` must exclude withdrawn —
**GAP [MINOR]** (the reviewer "My Reviews" status filter is unspecified).

**Step 4** hard-delete junk submission with real confirm guard.
`DELETE FROM submissions WHERE id=?` behind a confirm action (P1 #14). **OK** (guard = app;
cancel path does nothing).

**Step 5** deleted submission gone everywhere; counts recomputed.
Actual cascades on `submissions` delete (migration verified): `participants` cascade ·
`submission_answers` cascade (field FK is RESTRICT but the *submission* FK cascades) ·
`submission_tracks` cascade · `submission_tags` cascade · `reviews` cascade ·
`task_assignments.submission_id` cascade · `files.submission_id` **set null** (file row
survives, submission link cleared). Admin lists / dashboard counts / CSV all re-query live, so
counts decrement automatically. **OK** — cascades correctly modeled. SCALE (export vs table
count on 200 rows) = query consistency.

**Step 6–7** [admin] "delete my data": delete contact Leo (co-speaker on a panel, 2 open tasks).
`DELETE FROM contacts WHERE id=<Leo>` cascades: `participants.contact_id` cascade (Leo's role
rows gone) · `task_assignments.contact_id` cascade (Leo's 2 tasks gone) · `files.contact_id`
set null. The panel submission row survives; Ana's participant row survives. Signal
`SELECT count(*) FROM participants WHERE submission_id=<panel>` = 1 (Ana); no dangling Leo
refs; dashboard drops Leo. **OK — well modeled.** **GAP [MINOR]** — "delete my data" scope is
underspecified: deleting the *contact* does not touch Leo's `users` row (`contacts.user_id` is
the FK; there is no contact→user cascade), so "Leo's portal login no longer resolves" is only
half-true — he can still authenticate but lands on an empty portal. Decide whether delete-my-data
also removes/anonymizes the `users` row and orphaned `files` (set-null leaves them addressable).

---

## XM-S6 — queue-mask consistency

**Step 1** record outbox count; set 3 → Accept Queue, 2 → Decline Queue. No sends.
`UPDATE submissions SET status='accept_queue'|'decline_queue', status_changed_at=unixepoch()
WHERE id IN (…)`. `SELECT count(*) FROM email_outbox` before == after. **OK** EXPERIENCE
(inline pill commit, tab counts update, no reload) = `useFetcher` + revalidation.

**Step 2–3** every speaker surface shows "Pending"; served HTML/JSON has ZERO
`accept_queue`/`decline_queue`.
Speaker-visible surfaces in **committed** scope, each needing the same mask:
(1) portal Home status pill, (2) Submissions tab, (3) submission detail — all P0 #3.
(Confirmation/accept/decline emails are admin-composed and don't render the queue enum; .ics
`STATUS` is CONFIRMED/TENTATIVE, not the submission enum — no leak surface there.)
**GAP [MAJOR] — single source of the mapping is missing.** There is no `app/domain/`, and
`app/db/constants.ts` (the client-safe home for `SUBMISSION_STATUS`) has no mask helper. Each
portal surface could re-implement the map inconsistently — exactly the leak flow 09 §5.1
warns about. **Proposal:** a pure function beside the enum so it's client-safe and single-sourced:
```ts
// app/db/constants.ts
export function speakerVisibleStatus(s: (typeof SUBMISSION_STATUS)[number]) {
  return s === "accept_queue" || s === "decline_queue" ? "pending" : s;
}
```
applied **server-side** in the portal loader's projection before serialization (never ship the
raw row to the portal client). The grep-for-`accept_queue`-in-payload signal is then structurally
satisfiable.

**Step 4** admin surfaces show TRUE pills; tab counts Accept Queue(3)/Decline Queue(2);
CSV carries true statuses.
`SELECT status, count(*) FROM submissions WHERE event_id='e_demo' GROUP BY status`
(index `submissions_event_status_idx`). Admin reads the raw enum — never masked. **OK**

**Step 5** send decline template to 2 rows → 2 emails → finalize Declined; Yuki portal reads
"Declined".
Loop `EmailSender.send({templateId:'et_decline', …})` → 2 rows in `email_outbox`; then
`UPDATE submissions SET status='declined', notified_at=unixepoch()`. Portal now shows "Declined"
(not masked — `declined` maps to itself). **OK**

---

## XM-S7 — CSV export seam (committed, P2 #3)

**Step 1** preconditions (S1/S2/S3/S5 ran). (Data.) **OK**

**Step 2** create submission titled `Benchmarks, "Lies", and Streaming Metrics`.
Standard insert; the comma+quotes matter only at serialization (step 4). **OK**

**Step 3** All tab count N; Options → Export CSV.
**GAP [MAJOR — committed-but-homeless]** — CSV export is explicitly COMMITTED (SCOPE P2 #3:
"CSV export for submissions + speakers is COMMITTED") but there is **no export route in
`docs/ROUTE-MAP.md`** and no file owner. It needs a route (e.g. `admin.submissions.export.tsx`
or a `?export=csv` resource response on `admin.submissions.tsx`) added to ROUTE-MAP on the
integration branch. Until then the "Options → Export CSV → downloads directly" step is unservable.

**Step 4** parse CSV with a real parser.
Concrete query + column model the export must serialize (true admin statuses, current taxonomy
names, both speakers, custom answers):
```sql
SELECT s.id, s.title, s.status, s.language,
       fmt.name AS format,
       group_concat(DISTINCT tr.name)                          AS tracks,
       group_concat(DISTINCT c.first_name||' '||c.last_name)   AS speakers
FROM submissions s
LEFT JOIN formats fmt ON fmt.id=s.format_id
LEFT JOIN submission_tracks st ON st.submission_id=s.id
LEFT JOIN tracks tr ON tr.id=st.track_id
LEFT JOIN participants p ON p.submission_id=s.id
LEFT JOIN contacts c ON c.id=p.contact_id
WHERE s.event_id='e_demo'
GROUP BY s.id;
```
Custom-field columns = a **pivot** of `submission_answers`: enumerate the event's answered
fields `SELECT DISTINCT f.id, f.name FROM submission_answers sa JOIN fields f ON f.id=sa.field_id
JOIN submissions s ON s.id=sa.submission_id WHERE s.event_id='e_demo'`, emit one column per
field, and per row `SELECT value FROM submission_answers WHERE submission_id=? AND field_id=?`
→ so Lena's row carries "Bring a laptop with Node 22 and a Cloudflare account". RFC-4180: the
title with comma+embedded quotes serializes as `"Benchmarks, ""Lies"", and Streaming Metrics"`
(app-side quoting, not string-split). `status` column = raw enum incl. `accept_queue` (admin
artifact, never masked — flow 09). Row count == on-screen N; deleted (S5) absent; withdrawn
present as `withdrawn`. **GAP [MAJOR]** — the pivot + RFC-4180 + "export documents custom-field
handling" behavior is unspecified beyond the schema shape; needs a written export contract when
the (homeless) route is built.

**Step 5** Accepted-tab export = filtered count.
`… WHERE s.event_id='e_demo' AND s.status='accepted'`. Contract (filtered vs full) must match
the visible tab count. **OK** once the route exists.

---

## XM-S8 — impersonation seam (SCOPE P2 #6)

**SCENARIO-ERROR (scope):** XM-S8 exercises **P2 #6 "Admin impersonation"**, which SCOPE places
in the *opportunistic* P2 band ("Ranked follow-ups... take from the top only") — it is NOT in
the committed floor. Within P2, only #3 CSV export is annotated "COMMITTED"; #6 is not. So this
whole scenario tests an uncommitted feature. Walked anyway (design must not preclude it):

**Step 1–2** preconditions; open "View portal as…", search "maya" across 300 contacts.
Search `SELECT id, first_name, last_name FROM contacts WHERE event_id=? AND (first_name LIKE
'%maya%' OR last_name LIKE '%maya%')` — uses `contacts_event_idx`, fine at hundreds.
**GAP [MAJOR — homeless mechanism]** — `app/lib/auth.ts` has NO impersonation primitive. The
session model is cookie→`auth_sessions`→one `users` row; there is no "admin acting as contact X"
state (no impersonator id, no preview flag). SCOPE says enforce preview-only "once in the shared
portal auth helper" — that helper does not exist (portal is Wave 2, unbuilt), and auth.ts offers
nothing to build it on. The design needs: an impersonation token/flag carried in the session (or
a signed param) exposing `{ adminUserId, impersonatedContactId, readOnly:true }`, resolved in the
portal auth helper.

**Step 3** preview == real login (masks included).
Same queue-mask projection as XM-S6 (shared `speakerVisibleStatus`). **GAP** inherited from S6.

**Step 4–5** UI blocks task completion; replayed POST rejected server-side.
The portal task-completion action must reject when the resolved context is `readOnly`
(`return 403` before any `UPDATE task_assignments`). **GAP [MAJOR]** — "preview-only enforced in
the shared auth layer, not by hiding buttons" (the step-5 replayed-POST trap) has no home: no
shared portal action guard is designed, and the ESLint `require-auth-in-actions` rule only checks
that *an* auth helper is *called* — it cannot see that a preview session must be blocked from
mutating. Needs a `requirePortalActor(env,request,{allowPreview:false})`-style helper spec.

**Step 6** "Back to Admin Mode" returns cleanly.
Drop the impersonation flag, keep the admin `auth_sessions` row intact — no re-login. Feasible
once the primitive exists. **GAP** (same root).

---

## XM-S9 — auth boundary sweep

**Step 1** [anon] GET every protected URL → login gate, ZERO record data in bodies.
GET navigation to `/admin/*` is gated by the `admin.tsx` layout loader (`requireAdmin`), which
`throw redirect('/login?redirectTo=…')`. For a full document GET this holds. **GAP [BLOCKER] —
the single-fetch `_routes` bypass.** `react-router.config.ts` enables SSR single fetch and does
**not** enable `future.v8_middleware`; the golden path (blessed by CLAUDE.md + tech-stack.md)
puts auth ONLY in the layout loader and leaves child loaders unauthenticated
(`admin.submissions.tsx` loader comment: "No auth check here"). React Router's single-fetch
handler honors a client-controlled `_routes` filter (`filterMatchesToLoad: (m) => !loadRouteIds
|| loadRouteIds.has(m.route.id)`, `chunk-G3INQAYP.mjs:826`). So an **unauthenticated**:
```
GET /admin/submissions.data?_routes=routes/admin.submissions
```
runs ONLY the `routes/admin.submissions` loader — the `routes/admin` layout loader (the sole
`requireAdmin`) is skipped, no redirect is thrown — and the response is a 200 single-fetch
stream containing every submission title, participant, and contact. (Route ids confirmed in
`.react-router/types/+routes.ts`: layout `routes/admin`, child `routes/admin.submissions`.)
This is the exact "auth at a seam" defect class the suite exists to catch, and it is the
**pattern ~50 agents will copy** into every admin child route. Signal "response bodies contain
ZERO record data" fails. **Fix:** every loader that returns protected data must authenticate
itself (call `requireAdmin` in the child loader too — the layout gate is necessary but NOT
sufficient under single fetch), OR enable `future.v8_middleware` and move auth into route
middleware. The design's current "layout loader gates GET for all children" guidance is unsafe
as written and must be corrected. This also undermines XM-S1/S6/S7 admin-data confidentiality.

**Step 2** [anon] replay a protected mutation (status-change POST) logged out.
Actions self-authenticate (`admin.submissions.tsx` action calls `requireAdmin`), enforced by the
`openrostrum/require-auth-in-actions` ESLint rule (wired in `eslint.config.mjs`, rule file
`tooling/eslint-rules/require-auth-in-actions.mjs`). Logged-out POST → redirect/401, no write.
**OK.** **GAP [MINOR]** — the lint rule is satisfied by merely *calling* an auth helper and
accepts `getUser` (which returns `null` for anon **without throwing**); an action that calls
`getUser` but ignores the result passes lint yet is unauthenticated. The rule checks presence,
not that the result gates the write.

**Step 3** [anon] public CFP form still works logged out.
`submit.$eventSlug.$formId.tsx` is public (no `requireUser` in loader; submit action opts out via
`// @public` like `login.tsx`). **OK**

**Step 4** [speaker] Maya hits admin URLs → explicit denial; POST replay changes nothing.
`requireAdmin` → role `speaker` ∉ `['admin']` → `redirect('/403')`; `403.tsx` renders a branded
page. POST → same deny. **OK for documents** — but the same `_routes` `.data` bypass (step 1)
returns data to *any* session including a speaker's, so the "never a data page" signal fails via
that channel too. **GAP [BLOCKER]** (same root as step 1).

**Step 5** [reviewer] Omar: My Reviews works; admin-only GETs denied; status POST rejected.
**GAP [MAJOR — homeless actor].** The reviewer "My Reviews" queue has no route it can reach. The
only evaluation route in ROUTE-MAP is `admin.evaluation.tsx`, a child of `admin.tsx` whose loader
is `requireAdmin` — a `reviewer`-role user is redirected to `/403` on every `admin.*` route, so a
reviewer can reach nothing. SCOPE P0 #5 requires track-based reviewer routing to be demonstrable
("Reviewer 'My Reviews' queue"), but there is no reviewer-accessible surface: either evaluation
must move out from under the admin-only shell and use `requireRole(env,request,'admin','reviewer')`,
or a separate reviewer route must be added to ROUTE-MAP. The routing query itself is sound —
`SELECT DISTINCT s.* FROM submissions s JOIN submission_tracks st ON st.submission_id=s.id JOIN
reviewer_tracks rt ON rt.track_id=st.track_id WHERE rt.user_id=<Omar> AND s.event_id='e_demo'` —
but it has nowhere to run. Admin-only GET denial + reviewer status-POST rejection are otherwise
fine (`requireAdmin` on those actions).

**Step 6** [anon→admin] login from the gate lands on the originally requested page.
`requireUser` builds `redirect('/login?redirectTo='+encodeURIComponent(pathname))`; `login.tsx`
`action` reads `redirectTo` and `safeRedirect`s (same-origin only, blocks `//host`/scheme tricks).
Deep link preserved. **OK** — EXPERIENCE met. Denial pages humane (`403.tsx` branded, generic
`ErrorBoundary`, no stack traces). **OK**

---

## Ranked gap list (scenario-id.step → gap → severity)

| # | Where | Gap | Severity |
|---|---|---|---|
| 1 | XM-S9.1 / .4 (also weakens S1,S6,S7) | Single-fetch `_routes` bypass: layout-loader-only auth (blessed by CLAUDE.md/tech-stack, no `v8_middleware`) lets `GET /admin/*.data?_routes=<child>` skip `requireAdmin` and return record data to anon/speaker. Every admin child loader that copies the golden path ("no auth here") leaks. Fix: authenticate in each protected loader, or enable route middleware. | **BLOCKER** |
| 2 | XM-S3.1–3 | `form_fields.question_rule` `{fieldId→fields.id}` cannot reference the built-in Format (or Track/Tags/Level/Language) dropdown — those are `submissions.format_id` + taxonomy, not `fields` rows. The named permanent-regression defect. Fix: `question_rule.trigger = {kind:'field',fieldId} | {kind:'builtin',ref}`. | **BLOCKER** |
| 3 | XM-S4.7 (origin XM-S1.3) | Emails not case-normalized; `users_email_unique` + `contacts_event_email_uq` are BINARY collation and no code lowercases. A cased-variant signup creates a duplicate identity → "one identity, case-insensitively unique" fails. Fix: lowercase at write/lookup or `COLLATE NOCASE`. | **BLOCKER** (for S4.7) |
| 4 | XM-S1.8/10, S6.2, S8.3 | No single source for the queue→"Pending" speaker mask (no `app/domain`, no helper in `constants.ts`); each portal surface can leak the raw enum. Fix: pure `speakerVisibleStatus()` applied server-side in the portal projection. | **MAJOR** |
| 5 | XM-S1.10 | Accept spine (`app/domain/accept.ts`) is DOC-ONLY; provision-by-transition underspecified: task fan-out (which speakers), idempotency (no `unique(task,contact,submission)` on `task_assignments`), and `submission`-type vs `contact`-type task handling. | **MAJOR** |
| 6 | XM-S7.3–4 | CSV export is COMMITTED (P2 #3) but homeless — no route in ROUTE-MAP and no custom-field pivot / RFC-4180 contract specified. | **MAJOR** |
| 7 | XM-S9.5 | Reviewer "My Reviews" (P0 #5 routing) is homeless — the only eval route sits under the admin-only `admin.tsx` shell; a `reviewer` role is 403'd everywhere. Needs a reviewer-reachable route / `requireRole(admin,reviewer)`. | **MAJOR** |
| 8 | XM-S2.6 | Deleting a track with submissions: `submission_tracks`/`reviewer_tracks` ON DELETE **cascade** silently strips associations instead of refuse-with-count / reassign. Guard must live in the delete action; unspecified. (DB orphan-signal passes trivially, masking the defect.) | **MAJOR** |
| 9 | XM-S5.3 | Withdraw doesn't clear `starts_at/ends_at/room_id` and no rule forces the agenda query to exclude `status='withdrawn'` → ghost block on the grid (the scenario's stated failure). | **MAJOR** |
| 10 | XM-S8 (all) | No impersonation primitive in `auth.ts`; "enforce preview-only once in the shared portal auth helper" has no helper to live in, and the replayed-POST block (S8.5) is unmodeled. | **MAJOR** (also a scope-exceed, below) |
| 11 | XM-S3.4 | "Hidden-by-rule required field must not block submission and must not be stored" is stated nowhere binding; the golden-path `.min(1)`-on-all-required pattern would block it. | **MAJOR** |
| 12 | XM-S1.7 | Golden-path list loader has `limit:100`, no offset/search/per-status counts — the SCALE signals (25/page, search <1s, tab counts) need real pagination added. | **MINOR** |
| 13 | XM-S2.7 | Public submit action's server-side close-date check (via `Clock` port) not specified; UI-only check would pass the replayed POST. | **MINOR** |
| 14 | XM-S5.6 | "Delete my data" scope undefined — deleting the `contacts` row leaves Leo's `users` row (still logs in) and orphaned set-null `files`. | **MINOR** |
| 15 | XM-S2.6 | Track reassignment `UPDATE submission_tracks SET track_id` can violate PK `(submission_id,track_id)`; needs INSERT-OR-IGNORE + delete. | **MINOR** |
| 16 | XM-S4.2 | Link-contact-to-user-on-signup path (co-speaker added before signup → `user_id=NULL`) undescribed. | **MINOR** |
| 17 | XM-S5.3 | Reviewer "My Reviews" status filter (exclude withdrawn/declined) unspecified. | **MINOR** |
| 18 | XM-S9.2 | `require-auth-in-actions` lint accepts `getUser` and only checks the helper is *called*, not that its result gates the write — an unauthenticated action can pass CI. | **MINOR** |

## SCENARIO-ERRORs

- **XM-S8 (whole scenario)** exercises **P2 #6 Admin impersonation**, which SCOPE.md ranks in the
  opportunistic P2 band ("take from the top only") — NOT the committed floor (only P2 #3 CSV export
  carries the explicit "COMMITTED" annotation). Testing it as a required seam exceeds the committed
  tiers. Walked for design-readiness, but it should not gate the swarm.
