# Walk — 06-agenda (design-side, pre-swarm)

Walked 2026-08-09 against: `app/db/schema.ts` (events agenda columns, submissions
scheduling columns, formats, rooms, participants, contacts), `docs/ROUTE-MAP.md`
(`admin.agenda.tsx`, Wave 3), `docs/rules/tech-stack.md` (dnd-kit, D1 rules), `SCOPE.md` P0 #6,
`docs/flows/06-agenda-embeds.md` (agenda parts), `docs/flows/verification/D`,
`docs/reference/discord/CLARIFICATIONS.md` #8, `drizzle/seed.sql`.

Design facts this whole walk leans on (verified in `schema.ts`):
- An accepted submission IS the session: scheduling lives on `submissions.starts_at /
  ends_at / room_id` — no separate sessions table, so review-module accepts surface on the
  agenda with zero import (AG-S1.6 is structural). ✅
- `events.agenda_day_start_min` (default 480 = 8:00) / `agenda_day_end_min` (default
  1080 = 18:00) / `schedulable_statuses` (JSON string[], **no default, seed leaves NULL**). ⚠️
- `formats.default_duration_mins` (Featured Keynote seeded 45 ✅).
- There is NO conflicts table → conflicts are compute-on-read (viability judged at AG-S3).

Timestamps: unix epoch seconds; event TZ America/Los_Angeles (PDT = UTC-7 in Oct 2026), so
`2026-10-12 09:30 PDT` = `unixepoch('2026-10-12 16:30')` (UTC in SQL literals below).

## Gap summary (this file) — details inline

| # | Step(s) | Gap | Severity |
|---|---|---|---|
| H1 | all literal counts/fixtures | `drizzle/seed.sql` has 2 rooms / 2 formats / 2 tracks / 2 accepted submissions — not the baseline's 3 rooms (Main Hall, Workshop Room B, Room 305), 4 formats (Featured Keynote 45 · Talk 30 · Panel 60 · Workshop 90), 47 scheduled + 11 unscheduled accepted, named fixtures, or the "GPU Pricing Deep Dive" queue fixture. Same root cause as walk-05 G2; one seed rewrite fixes both. | BLOCKER |
| H2 | AG-S1.2/4, AG-S5.3 | `events.schedulable_statuses` NULL-interpretation unspecified: no schema default, seed doesn't set it, yet the baseline demands "[Accepted]". Every panel/alert/grid query needs the rule "NULL ⇒ ['accepted']" (or the seed must write `'["accepted"]'`) — stated nowhere. | MAJOR |
| H3 | AG-S2.2–4 | Timezone conversion rule for agenda writes unspecified: the DB stores UTC epochs, the grid speaks event-TZ wall clock. Nothing states the drop payload's format or that the SERVER converts using `events.timezone` — a build agent using the browser TZ passes locally and breaks for any judge outside PT. The scenario's DB assertion ("start is 2026-10-12 09:30 event TZ") is unimplementable deterministically until this is pinned. | MAJOR |
| H4 | AG-S5.4 (+ any direct POST) | Server-side enforcement of schedulable statuses on the DROP action unspecified: the panel only *offers* schedulable sessions, but the schedule action must itself reject a submission whose status ∉ schedulableStatuses (repo rule: UI-only checks are vulnerabilities — 09-data-exposure). | MINOR |
| H5 | AG-S2.5, AG-S6.6 | Duration rule stated only in scenarios: initial drop derives `ends_at` from `formats.default_duration_mins`; a MOVE preserves the existing duration; re-scheduling after unschedule re-derives (starts_at was NULL). Also: fallback duration when `format_id` IS NULL is undefined (30min?). Needs one written rule. | MINOR |
| H6 | AG-S3.3–4 | Compute-on-read for conflicts is implicit (no conflicts table). Viable — judged inline at AG-S3 — but unstated: a Wave-3 agent may request a conflicts table or a "recompute" job. State: conflicts are derived per request by the two queries below; refresh-based is acceptable (matches Sessionboard "conflicts update on page refresh"). | MINOR |
| H7 | AG-S3.2 | Grid drop granularity unspecified: AG-S3/S4 require 15-minute drop positions (10:15, 9:30); schema has no interval setting (Sessionboard has one). The grid must support ≤15-min snap — stated nowhere. | MINOR |
| H8 | AG-S5.1–2 | Route ownership for the Agenda Settings screen is unpinned: `admin.agenda.tsx` (a Settings tab, matching Sessionboard) vs `admin.settings.tsx` both plausibly claim the `events.agenda_*` UPDATE — the exact parallel-agent collision ROUTE-MAP exists to prevent. | MINOR |
| H9 | AG-S3/S4 | Conflict-detection status scope unspecified: detect among schedulable-visible sessions only, or any row with times? (A withdrawn-but-still-scheduled session — walk-05 G20 — would otherwise still generate conflicts.) | MINOR |

No SCENARIO-ERROR in this file: every scenario sits inside SCOPE P0 #6's committed floor —
day/room grid + drag-drop + conflict detection (speaker double-book + same-room/time ONLY,
per CLARIFICATIONS #8 and verification D §2.2), Agenda Settings (day start/end, schedulable
statuses, per-format default duration), unscheduled panel, and the "N accepted sessions
still need a time slot" alert. AG-S4's negative track-collision probe correctly encodes the
"NO track collisions" clarification (SCOPE req-5's "across rooms and tracks" wording is
superseded — verification D §2.2 flags exactly this).

---

## AG-S1 — Unscheduled panel + real alert count

**Route:** `admin.agenda.tsx` (`/admin/agenda`, Wave 3, ROUTE-MAP ✅). Loader
`requireAdmin` via `admin.tsx` layout for GET; all agenda actions self-authenticate.

**Step 1 — reset + open the Rooms grid for Oct 12.** Loader reads settings + day rows:

```sql
SELECT agenda_day_start_min, agenda_day_end_min, schedulable_statuses, timezone, starts_at, ends_at
FROM events WHERE id = :eventId;   -- 480 / 1080 / NULL ⚠ / America/Los_Angeles / Oct 12 / Oct 14

SELECT id, name, capacity, display_order FROM rooms
WHERE event_id = :eventId AND visible = 1
ORDER BY display_order, name;      -- Main Hall · Workshop Room B · Room 305 (H1: seed has Room A/B)

-- scheduled blocks for the visible day (Oct 12 00:00–24:00 PDT = 07:00 UTC → 07:00 UTC next day):
SELECT s.id, s.title, s.starts_at, s.ends_at, s.room_id, f.default_duration_mins,
       t.name AS track_name, t.color AS track_color
FROM submissions s
LEFT JOIN formats f ON f.id = s.format_id
LEFT JOIN submission_tracks st ON st.submission_id = s.id
LEFT JOIN tracks t ON t.id = st.track_id
WHERE s.event_id = :eventId
  AND s.status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses, '["accepted"]')))  -- ← H2
  AND s.starts_at >= unixepoch('2026-10-12 07:00')
  AND s.starts_at <  unixepoch('2026-10-13 07:00');
```
`GAP H2 [MAJOR]` on the `COALESCE(…, '["accepted"]')` — that default is this walk's
invention. `GAP H1 [BLOCKER]` on fixtures/counts.

**Step 2 — panel counts.**

```sql
SELECT
  SUM(CASE WHEN starts_at IS NOT NULL THEN 1 ELSE 0 END) AS scheduled,     -- 47
  SUM(CASE WHEN starts_at IS NULL     THEN 1 ELSE 0 END) AS unscheduled    -- 11
FROM submissions
WHERE event_id = :eventId
  AND status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses, '["accepted"]')));
```
Served by `submissions_event_status_idx` (event_id, status) + row filter. `OK` (modulo H1/H2).

**Step 3 — unscheduled cards are accepted-only.**

```sql
SELECT s.id, s.title FROM submissions s
WHERE s.event_id = :eventId AND s.status = 'accepted' AND s.starts_at IS NULL
ORDER BY s.title;                    -- 11 rows, incl. 'Closing Keynote: The Post-SaaS Stack'
```
DB cross-check = the same COUNT. `OK`.

**Step 4 — negative probes.** "SOC 2 for Startups: A War Story" (`status='pending'`) and
"GPU Pricing Deep Dive" (`status='accept_queue'`) both fail the status predicate at
baseline (`['accepted']`) → absent from the panel and its search. `OK` — structural, given
H2 is resolved so the baseline predicate really is `['accepted']`.

**Step 5 — the alert.**

```sql
SELECT COUNT(*) FROM submissions
WHERE event_id = :eventId AND status = 'accepted' AND starts_at IS NULL;   -- 11
-- rendered as: "11 accepted sessions still need a time slot"
```
Same predicate as the panel ⇒ cannot drift; recomputed per loader run ⇒ never stale/
hardcoded, and it moves when AG-S2 schedules one. `OK`. (Note: the alert counts ACCEPTED
specifically — if schedulableStatuses is widened (AG-S5), the alert text stays
accepted-scoped per its own wording; the panel scopes by settings. Two different predicates,
both above.)

**Step 6 — dependency check.** RV-S4's accept flipped `status='accepted'` on the same
`submissions` row with `starts_at IS NULL` → it satisfies step 3's query with no import
step. `OK` — the accepted-submission-IS-the-session design makes this a non-event.

**Step 7 — scale.** Oct 13 grid = step-1 day query with shifted bounds (~16 rows); full
grid holds 47 blocks. Rendering-quality signal (legible blocks, no overlap glitches, panel
search instant) has no binding design statement beyond SCOPE cross-cutting performance —
noted for build agents, same as walk-05 RV-S1. dnd-kit + lazy-loading rule
(tech-stack: "Tiptap and dnd-kit are lazy-loaded / code-split") covers payload weight. `OK`
as design; experience bar carried by scenario + SCOPE prose.

---

## AG-S2 — Drag to schedule, end auto-fill from format, then move

**Step 1 — confirm the format mapping.**

```sql
SELECT name, default_duration_mins FROM formats
WHERE event_id = :eventId AND name = 'Featured Keynote';   -- 45 ✅ (seeded 45 in drizzle/seed.sql)
```
Editable via the taxonomy screens (Wave 0) or Agenda Settings (route ownership → H8). `OK`.

**Step 2/3 — the drop.** dnd-kit drag from panel card → grid cell (Main Hall × 9:30).
Drop handler posts a fetcher form (no modal, no navigation):

```json
{ "intent": "schedule", "submissionId": "<closing_keynote_id>",
  "roomId": "<main_hall_id>", "day": "2026-10-12", "startMinutes": 570 }
```
(`startMinutes` = event-TZ wall-clock minutes; 570 = 9:30 — the server converts using
`events.timezone`. That convention is `GAP H3 [MAJOR]` — my proposal, stated nowhere.)

Action (self-authenticates; end-time auto-fill = the actual read+compute):

```ts
await requireAdmin(env, request);
const sub = await db.query.submissions.findFirst({
  where: and(eq(submissions.id, p.submissionId), eq(submissions.eventId, event.id)),
  with: { format: true },
});
// H4: reject if sub.status not in schedulableStatuses (server-side, not just panel-side)
const durationMins = sub.format?.defaultDurationMins ?? 30;   // NULL-format fallback: H5
const startsAt = zonedWallClockToUtc(p.day, p.startMinutes, event.timezone); // 09:30 PDT → 16:30 UTC
const endsAt = new Date(startsAt.getTime() + durationMins * 60_000);         // 45min → 10:15
await db.update(submissions).set({ startsAt, endsAt, roomId: p.roomId })
  .where(and(eq(submissions.id, sub.id), eq(submissions.eventId, event.id)));
```

```sql
UPDATE submissions
SET starts_at = unixepoch('2026-10-12 16:30'),   -- 09:30 PDT
    ends_at   = unixepoch('2026-10-12 17:15'),   -- 10:15 PDT = 09:30 + formats.default_duration_mins (45)
    room_id   = :main_hall_id,
    updated_at = unixepoch()
WHERE id = :closing_keynote_id AND event_id = :eventId;
```
Block renders 9:30–10:15 from the same row. `OK` for mechanism; `GAP H3 [MAJOR]` (TZ rule),
`GAP H5 [MINOR]` (NULL-format fallback), `GAP H4 [MINOR]` (status enforcement on drop).

**Step 4 — DB check + counts.** AG-S1.2 panel query → Scheduled 48 / Unscheduled 10;
AG-S1.5 alert query → 10. Both recomputed in the revalidated loader. `OK`.

**Step 5 — move it (duration preserved).**

```ts
const duration = sub.endsAt.getTime() - sub.startsAt.getTime();   // preserve, do NOT re-derive (H5)
const startsAt = zonedWallClockToUtc("2026-10-13", 840, event.timezone); // 2:00 PM PDT → 21:00 UTC
await db.update(submissions)
  .set({ startsAt, endsAt: new Date(startsAt.getTime() + duration), roomId: workshopRoomBId })
  .where(and(eq(submissions.id, sub.id), eq(submissions.eventId, event.id)));
```

```sql
UPDATE submissions
SET starts_at = unixepoch('2026-10-13 21:00'),   -- 2:00 PM PDT
    ends_at   = unixepoch('2026-10-13 21:45'),   -- 2:45 PM (45min preserved)
    room_id   = :workshop_room_b_id
WHERE id = :closing_keynote_id AND event_id = :eventId;
```
The Main Hall 9:30 cell empties because the block is the same row — one row can't render
twice. `OK`; the preserve-don't-re-derive rule is `GAP H5 [MINOR]` (scenario-only today).

**Step 6 — reload persists.** Committed UPDATE; loader re-reads. `OK`.

**EXPERIENCE.** Direct manipulation = dnd-kit `onDragEnd` → `fetcher.submit` → loader
revalidation. No full-page reload is framework-natural but stated only in SCOPE's generic
performance bullet — same note as AG-S1.7.

---

## AG-S3 — Same-room overlap: red clocks, reciprocal rows, resolve clears both

**Step 1/2 — the two drops.** AG-S2 action twice:

```sql
-- 'Live Demo: Agent Swarms in Production' (Talk → 30):
UPDATE submissions SET starts_at=unixepoch('2026-10-12 17:00'), ends_at=unixepoch('2026-10-12 17:30'),
       room_id=:main_hall_id WHERE id=:live_demo_id AND event_id=:eventId;    -- 10:00–10:30 PDT
-- 'Panel: Is the CFP Dead?' (Panel → 60):
UPDATE submissions SET starts_at=unixepoch('2026-10-12 17:15'), ends_at=unixepoch('2026-10-12 18:15'),
       room_id=:main_hall_id WHERE id=:panel_cfp_id AND event_id=:eventId;    -- 10:15–11:15 PDT
```
10:15 drops require 15-minute grid snap → `GAP H7 [MINOR]`. `OK` otherwise.

**Step 3/4 — CONFLICT DETECTION (the actual SQL).** No conflicts table exists → computed
on read by the agenda/conflicts loader. Class (a), same-room time overlap:

```sql
SELECT a.id AS a_id, a.title AS a_title, b.id AS b_id, b.title AS b_title,
       r.name AS room_name,
       MAX(a.starts_at, b.starts_at) AS overlap_start,   -- 10:15
       MIN(a.ends_at,   b.ends_at)   AS overlap_end      -- 10:30
FROM submissions a
JOIN submissions b
  ON b.event_id = a.event_id
 AND b.id > a.id                                   -- each pair once; UI emits both directions
 AND b.room_id = a.room_id
 AND b.starts_at < a.ends_at                       -- STRICT inequalities: touching blocks
 AND a.starts_at < b.ends_at                       --   (end == next start) are NOT conflicts
JOIN rooms r ON r.id = a.room_id
WHERE a.event_id = :eventId
  AND a.room_id IS NOT NULL
  AND a.starts_at IS NOT NULL AND b.starts_at IS NOT NULL
  AND a.status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses,'["accepted"]')))   -- scope: H9
  AND b.status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses,'["accepted"]')));
```

Class (b), same-speaker overlap via the participants join, is walked at AG-S4. Viability of
compute-on-read (the prompt's question): the self-join is bounded by scheduled rows per
event (~50 seed, hundreds at NORTH STAR); with `submissions_event_status_idx` +
`submissions_room_idx` this is a sub-millisecond scan in SQLite — **viable, and it matches
Sessionboard's own "conflicts update on page refresh" semantics. But it is stated nowhere**:
`GAP H6 [MINOR]`. Detection scope (which statuses can conflict): `GAP H9 [MINOR]`.

Red-clock markers: the grid loader runs the same query and flags both block ids —
refresh-based detection is explicitly allowed by the scenario ("refresh the page if
detection is refresh-based"). `OK`.

Conflicts tab rows (reciprocal pair from one SQL row):

```
SESS(Live Demo)  | "…is also scheduled in Main Hall with 'Panel: Is the CFP Dead?' 10:15–10:30." | Open
SESS(Panel CFP)  | "…is also scheduled in Main Hall with 'Live Demo: Agent Swarms…' 10:15–10:30." | Open
```
Human-readable text (room + other session) comes straight from the query's columns. `OK`.

**Step 5 — Open → editor.** Row links to `/admin/submissions/:id`
(`admin.submissions.$id.tsx`, ROUTE-MAP Wave 1 ✅). `OK`.

**Step 6 — resolve.**

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 18:30'), ends_at=unixepoch('2026-10-12 19:30')
WHERE id=:panel_cfp_id AND event_id=:eventId;   -- 11:30–12:30 PDT, same room
```
Now `b.starts_at (18:30) < a.ends_at (17:30)` is false → the pair vanishes from the query
result. `OK`.

**Step 7 — both markers/rows gone.** Conflicts are derived, never stored → nothing to
orphan; both sides disappear in the same query run. `OK` — compute-on-read makes
"no stale conflict" structural (this is the argument for NOT adding a conflicts table).

---

## AG-S4 — Speaker double-book across rooms; same track/time is NOT a conflict

**Step 2 — the drop.**

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 17:15'), ends_at=unixepoch('2026-10-12 17:45'),
       room_id=:room_305_id WHERE id=:office_hours_id AND event_id=:eventId;  -- 10:15–10:45 PDT
```

**Step 3 — class (b): same-speaker overlap (the actual SQL).**

```sql
SELECT a.id AS a_id, a.title AS a_title, b.id AS b_id, b.title AS b_title,
       c.first_name || ' ' || c.last_name AS person,
       MAX(a.starts_at, b.starts_at) AS overlap_start,   -- 10:15
       MIN(a.ends_at,   b.ends_at)   AS overlap_end      -- 10:30
FROM submissions a
JOIN participants pa ON pa.submission_id = a.id
JOIN participants pb ON pb.contact_id = pa.contact_id AND pb.submission_id <> a.id
JOIN submissions b   ON b.id = pb.submission_id AND b.event_id = a.event_id AND b.id > a.id
JOIN contacts c      ON c.id = pa.contact_id
WHERE a.event_id = :eventId
  AND a.starts_at IS NOT NULL AND b.starts_at IS NOT NULL
  AND b.starts_at < a.ends_at AND a.starts_at < b.ends_at        -- strict, as in AG-S3
  AND a.status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses,'["accepted"]')))
  AND b.status IN (SELECT value FROM json_each(COALESCE(:schedulableStatuses,'["accepted"]')));
-- → one row: Marco Silva, Live Demo (Main Hall) × Office Hours (Room 305), 10:15–10:30
```
Index check: `participants_contact_idx` serves the pa→pb self-join; `participants_submission_idx`
the other direction. ✅ Room is deliberately ABSENT from the predicates — detection is
cross-room by construction. Row text names the person from the query
("Marco Silva is also scheduled in 'Live Demo…' during this time" — matches verification D's
observed wording). `OK`.

**Step 4 — negative probe (NO track collisions).**

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 18:30'), ends_at=unixepoch('2026-10-12 20:00'),
       room_id=:room_305_id WHERE id=:workshop_email_id AND event_id=:eventId; -- 11:30–1:00 PDT (Workshop → 90)
```
Against "Panel: Is the CFP Dead?" (Main Hall 11:30–12:30, same track Developer Experience):
- class (a): `b.room_id = a.room_id` fails (Room 305 ≠ Main Hall) → no row;
- class (b): no shared `participants.contact_id` → the pa/pb join yields nothing;
- there is **no third query** — `submission_tracks` appears nowhere in the detector.
Zero conflicts, structurally. `OK` — the design does exactly speaker + same-room/time,
nothing more (CLARIFICATIONS #8; SCOPE req-5's "and tracks" wording is superseded per
verification D §2.2 — cited here so nobody "fixes" the detector against the brief).

**Step 5 — resolve the speaker clash.**

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 20:00'), ends_at=unixepoch('2026-10-12 20:30')
WHERE id=:office_hours_id AND event_id=:eventId;   -- 1:00–1:30 PM PDT
```
Boundary check the scenario silently performs: Workshop occupies Room 305 until 13:00 and
Office Hours now starts at 13:00 in the same room — `a.starts_at < b.ends_at` is
`20:00 < 20:00` = false → NOT a conflict. The strict-inequality choice in the artifacts is
load-bearing; an implementation using `<=` fails this step. (Carried by the SQL above;
folded into H6's "state the detector spec".)

**Step 6 — Conflicts tab empty.** Both queries return zero rows event-wide. `OK`.

---

## AG-S5 — Settings drive the grid; schedulable statuses gate the panel

**Step 1 — read the baseline.**

```sql
SELECT agenda_day_start_min, agenda_day_end_min FROM events WHERE id = :eventId;  -- 480, 1080
-- gutter renders minute-of-day 480 → 1080 (8:00 AM → 6:00 PM) in events.timezone
```
Schema defaults 480/1080 match the scenario baseline ✅. `OK`.

**Step 2 — change the window.** Settings action (route ownership → `GAP H8 [MINOR]`):

```sql
UPDATE events SET agenda_day_start_min = 420, agenda_day_end_min = 1320 WHERE id = :eventId;
-- 7:00 AM / 10:00 PM; grid loader re-reads → gutter spans 7AM–10PM
```
`OK`. Validation the action needs: start < end, 0–1440, multiples of the grid snap (H7).

**Step 3 — baseline gating.** With `schedulable_statuses` = `['accepted']` (via H2's
NULL-default or an explicit seed value), "GPU Pricing Deep Dive" (`accept_queue`) fails
AG-S1.3's predicate → absent. `OK` modulo `GAP H2 [MAJOR]`.

**Step 4/5 — widen then restore.**

```sql
UPDATE events SET schedulable_statuses = '["accepted","accept_queue"]' WHERE id = :eventId;
-- panel query now: status IN ('accepted','accept_queue') → GPU Pricing Deep Dive appears
UPDATE events SET schedulable_statuses = '["accepted"]' WHERE id = :eventId;
-- → disappears
```
Values are `SUBMISSION_STATUS` enum strings (the JSON column is `$type<string[]>` —
label-vs-enum choice folded into H2's rule). The settings UI offers status chips per
verification D §1.9 (Accepted / Accept Queue / Pending). `OK`. What ENFORCES the gate on a
drop (not just the panel): the schedule action's status check — `GAP H4 [MINOR]`, stated
nowhere.

**Step 6 — Pending never schedulable here.** 'pending' is never written into the JSON in
steps 3–5, so "SOC 2 for Startups: A War Story" fails the predicate throughout. `OK`.

**Step 7 — restore window.**

```sql
UPDATE events SET agenda_day_start_min = 480, agenda_day_end_min = 1080 WHERE id = :eventId;
```
`OK`. Persistence across reload is a committed row + loader re-read; "no restart/reseed"
holds because nothing is cached outside the loader. `OK`.

---

## AG-S6 — Unschedule round-trip

**Step 1 — note counts.** AG-S1.2 + AG-S1.5 queries → N. `OK`.

**Step 2/3 — unschedule (drag back to panel / remove affordance).**

```sql
UPDATE submissions
SET starts_at = NULL, ends_at = NULL, room_id = NULL, updated_at = unixepoch()
WHERE id = :live_demo_id AND event_id = :eventId;
```
All three columns cleared — `room_id` included, or the "no stale room value" signal fails
on re-schedule. Card reappears via AG-S1.3 (`starts_at IS NULL`); the grid cell empties
(same single row). `OK`.

**Step 4 — counts follow.** Panel ±1 each direction, alert N+1 — same recomputed queries. `OK`.

**Step 5 — reload.** Committed UPDATE. `OK` — persisted, not UI-only.

**Step 6 — re-drag.** AG-S2 action again: `starts_at` was NULL ⇒ derive duration from the
format (Talk → 30) ⇒ 10:00–10:30 in Main Hall:

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 17:00'), ends_at=unixepoch('2026-10-12 17:30'),
       room_id=:main_hall_id WHERE id=:live_demo_id AND event_id=:eventId;
```
Round-trip integrity: NULL → re-derived from `formats.default_duration_mins`, no residue.
`OK`; the derive-vs-preserve rule is `GAP H5 [MINOR]` (must be written once, not carried by
two scenarios).

**EXPERIENCE.** Same gesture both ways = dnd-kit droppable panel + fetcher; counts update
via loader revalidation without full reload. Binding statement: SCOPE performance prose
only — noted, consistent with AG-S1/AG-S2.
