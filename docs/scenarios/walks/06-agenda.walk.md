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

## AG-S3 — Same-room overlap: red clocks, one logical row, resolve clears all

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
 AND b.id > a.id                                   -- each logical pair once in SQL and UI
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

Conflicts tab row (one logical row from one SQL row):

```
Live Demo ↔ Panel CFP | "Shares Main Hall (overlapping 10:15–10:30)." | Open first | Open second
```
The row carries both titles, room, and overlap window; either Open path reaches the corresponding editor. `OK`.

**Step 5 — Open → editor.** The two row links target each session's
`/admin/submissions/:id` route (`admin.submissions.$id.tsx`, ROUTE-MAP Wave 1 ✅). `OK`.

**Step 6 — resolve.**

```sql
UPDATE submissions SET starts_at=unixepoch('2026-10-12 18:30'), ends_at=unixepoch('2026-10-12 19:30')
WHERE id=:panel_cfp_id AND event_id=:eventId;   -- 11:30–12:30 PDT, same room
```
Now `b.starts_at (18:30) < a.ends_at (17:30)` is false → the pair vanishes from the query
result. `OK`.

**Step 7 — both markers and the logical row gone.** Conflicts are derived, never stored → nothing to
orphan; both markers and the pair's single row disappear in the same query run. `OK` — compute-on-read makes
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
cross-room by construction. The logical row names the person and both sessions from the query
("Marco Silva is also scheduled in 'Live Demo…' during this time" beside the two titles — wording
matches verification D while the product shows the pair only once). `OK`.

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

---

## AG-S7 — Conflict-aware publish and public handoff

**Step 1 — recreate one unresolved clash.** Reuse AG-S3's Panel update while Live Demo
remains in Main Hall at 10:00–10:30:

```sql
UPDATE submissions
SET starts_at=unixepoch('2026-10-12 17:15'), ends_at=unixepoch('2026-10-12 18:15'),
    room_id=:main_hall_id
WHERE id=:panel_cfp_id AND event_id=:eventId;
UPDATE events SET agenda_published_at=NULL WHERE id=:eventId;
```

**Step 2 — confirmation artifact.** `detectConflicts` yields one room `Conflict` pair;
`buildConflictRows` preserves one logical row. `PublishAgendaDialog` receives that array and
renders an `alertdialog` naming both titles, the overlap sentence, Cancel, and Publish anyway.
No native dialog API exists in this path. `OK`.

**Step 3 — Cancel.** Cancel only clears route-local `publishOpen`; it submits no form.

```sql
SELECT agenda_published_at FROM events WHERE id=:eventId; -- NULL
```

The public schedule loader returns no surface while the value is NULL. `OK`.

**Step 4 — publish or retry.** Publish anyway submits `intent=publish` through the guarded
fetcher; `useBusy()` disables publish controls while any agenda mutation is in flight.

```sql
UPDATE events SET agenda_published_at=unixepoch() WHERE id=:eventId;
SELECT agenda_published_at IS NOT NULL AS published FROM events WHERE id=:eventId; -- 1
```

The dialog remains mounted while `publishedAt` is NULL, so a failed action's `formError`
renders in context; successful loader revalidation supplies non-NULL `publishedAt`, hides the
dialog, and exposes `/schedule/:eventSlug`. Organizer authority is preserved because the
server action does not reject unresolved conflicts. `OK`.

**Step 5 — public overlap legibility + track.** The public room column computes
`max(200, peakLaneCount * 160)`; two lanes produce a 320px column and roughly 156px cards
inside the existing horizontal scroller. Each card keeps `title={block.title}` and a compact
track chip; short tracked cards omit the time line before they omit title or track. `OK`.

**Step 6 — explicit detail metadata.** `SessionDetail` renders `MetaRow label="Track"` from
`session.tracks.map(name)`, gated by the same embed field visibility as its header chips,
alongside Format/Level/Language. `OK`.

**EXPERIENCE.** One in-app consequence preview, an honest Cancel path, organizer-authoritative
Publish anyway, and a public result whose overlaps and tracks remain readable. `OK`.

---

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Re-walked per `docs/rules/process.md` design-time gate against: post-migration `app/db/schema.ts`
(`organizations` L95, `organization_members` L101, `events.organizationId` NOT NULL FK
L121–125, `fields` scope-XOR L390, `api_tokens.organizationId`+nullable `eventId` L1185),
`docs/multi-tenancy-design.md`, `app/lib/auth.ts` (`getActiveEvent` L236–251, `requireAdmin`
L226), `drizzle/seed.sql` (org backfill rows).

Structural finding, established once and cited per step: **every serving artifact in the
2026-08-09 walk above is scoped `WHERE event_id = :eventId`, and none of this module's
touched tables gained an org column.** Verified in the new schema: `submissions` (L558),
`formats` (L204), `rooms` (L233), `tracks` (L155), `submission_tracks` (L632),
`participants` (L721), `contacts` (L498 — `event_id` NOT NULL survives; contacts did NOT
move to org scope despite Sessionboard's org-level contacts endpoint) all still scope
through `events`. Tenancy therefore enters this module at exactly one point — how
`:eventId` is resolved (`requireAdmin` + `getActiveEvent`) — walked as the changed artifact
at AG-S1 step 1. The `fields` XOR and `api_tokens` changes touch nothing in this file: the
agenda uses no library fields, and these admin surfaces are cookie-auth, never token-auth.
Public agenda/embeds are slug-resolved and logged-out, and this yaml excludes them anyway
(header: "embeds are P2, not covered here") — nothing here for tenancy to gate.

Carried-gap status (pre-existing, neither caused nor fixed by this migration — not
re-filed):

- **H1 [BLOCKER] still open.** The Wave A seed rewrite minted `org_demo`/`om_admin` and
  attached `e_demo` (`organization_id = 'org_demo'`) but added no fixtures: still 2 rooms
  (Room A/B), 2 formats (Featured Keynote 45 / Breakout 30), 2 accepted submissions — not
  the baseline's 3 rooms / 4 formats / 47+11 sessions.
- **H2 [MAJOR] premise shifted, gap still open.** `events.schedulableStatuses` now carries
  a Drizzle `$defaultFn(() => ["accepted"])` (schema L142–144) — an app-side insert default
  that covers Drizzle-created events (the create-event flow) but NOT the raw-SQL seed:
  `drizzle/seed.sql`'s events INSERT names no `schedulable_statuses` column, so `e_demo`
  still reads NULL and the `COALESCE(…,'["accepted"]')` rule remains this walk's invention.
- H3–H9 carried unchanged (TZ write rule, drop-side status enforcement, duration rule,
  detector spec, 15-min snap, settings route ownership, detection status scope) — none
  interacts with an org column.

**New tenancy gaps filed by this re-walk: none.** 39 steps walked: 1 CHANGED, 38 UNCHANGED,
0 GAP.

**AG-S1 — Unscheduled panel + real alert count**

### AG-S1 step 1 — CHANGED

Two artifacts change under `events.organizationId` NOT NULL. (1) "Reset to the seed
baseline" now requires the org rows or the events INSERT violates NOT NULL/FK — landed in
`drizzle/seed.sql`:

```sql
INSERT INTO organizations (id, name, created_at) VALUES
 ('org_demo', 'Demo', unixepoch());
INSERT INTO organization_members (id, organization_id, user_id, created_at) VALUES
 ('om_admin', 'org_demo', 'u_admin', unixepoch());
INSERT INTO events (id, organization_id, name, slug, type, timezone, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'org_demo', 'AI.Engineer Sandbox Event', 'ai-engineer-sandbox', 'Conference',
  'America/Los_Angeles', unixepoch('2026-10-12'), unixepoch('2026-10-14'), unixepoch());
```

(2) "Log in as admin → Agenda" — event resolution. `requireAdmin` still checks the global
role (auth.ts L226–228); `u_admin` has `role='admin'` and `users.role` is retained by
design ("membership gates *which events*; the enum gates *which surface*" — design doc
§Authorization). The seed's users INSERT names no `active_event_id` → NULL → today's
`getActiveEvent` fallback (auth.ts L249) runs

```sql
SELECT * FROM events LIMIT 1;   -- e_demo, row now carrying organization_id = 'org_demo'
```

org-blind, but it cannot cross a tenant boundary at Wave A: the DB holds exactly one
organization, and the only mint path for a second (`/signup`) is Wave C — which the build
order lands AFTER Wave B replaces this exact query. Covered: Wave B ("The any-event
fallback is the hole Wave B exists to close … first event across MY orgs, else null — with
a test on the null-`activeEventId` path" — design doc §Authorization bullet 1 + build-order
row B). Wave B's committed shape, for the record:

```sql
SELECT e.* FROM events e
JOIN organization_members m
  ON m.organization_id = e.organization_id AND m.user_id = :userId
ORDER BY e.created_at LIMIT 1;   -- no row → null → create-event flow
```

The `user.activeEventId` branch gains the membership check (event → org → member) and the
admin guard swaps role for membership in the same wave (design doc §Authorization bullets
1–2, build-order row B) — covered, not gaps. The loader's settings/rooms/day queries
themselves are walked at step 2. `OK` under the gate.

### AG-S1 step 2 — UNCHANGED

Panel-count SQL is `WHERE event_id = :eventId` on `submissions` (no org column, L558);
tenancy enters upstream at step 1's resolution. H1/H2 carried.

### AG-S1 step 3 — UNCHANGED

Accepted-with-no-time query and DB cross-check are event-scoped on `submissions` — a table
the migration did not touch.

### AG-S1 step 4 — UNCHANGED

Negative probes are status predicates over the same event-scoped rows; no org-aware
predicate exists to add.

### AG-S1 step 5 — UNCHANGED

Alert COUNT shares step 3's predicate, recomputed per loader run against the resolved
event; the resolved event is step 1's (covered) concern.

### AG-S1 step 6 — UNCHANGED

RV-S4's accept flips `status` on the same event-scoped `submissions` row; the review module
resolves its event through the same `getActiveEvent` chokepoint, so no cross-org path
exists for an accept to arrive from.

### AG-S1 step 7 — UNCHANGED

Same day query with shifted bounds; rendering/scale concern with no schema surface.

**AG-S2 — Drag to schedule, auto-fill, move**

### AG-S2 step 1 — UNCHANGED

`formats` kept `event_id` NOT NULL and gained no org column (L204–217); the mapping query
survives verbatim.

### AG-S2 step 2 — UNCHANGED

The drop payload (`intent/submissionId/roomId/day/startMinutes`) names no tenant data —
the server derives everything tenant-relevant from the resolved event. H3 (TZ rule)
carried.

### AG-S2 step 3 — UNCHANGED

The schedule action survives byte-identical: its row verification
`and(eq(submissions.id, …), eq(submissions.eventId, event.id))` is exactly the row-level
check the design keeps ("Row-level `eventId` verification continues per the data-exposure
matrix" — design doc §Authorization bullet 5); a submission's org derives via its event,
never stored, so there is no second column to verify. H4/H5 carried.

### AG-S2 step 4 — UNCHANGED

Recomputed panel/alert queries from AG-S1 steps 2/5 — event-scoped, see above.

### AG-S2 step 5 — UNCHANGED

Move UPDATE with the same `id + event_id` row verification; duration-preserve rule (H5)
carried, no tenancy surface.

### AG-S2 step 6 — UNCHANGED

Committed UPDATE + loader re-read; persistence has no org dimension.

**AG-S3 — Same-room overlap conflicts**

### AG-S3 step 1 — UNCHANGED

AG-S2 action artifact, event-scoped UPDATE — see AG-S2 step 3.

### AG-S3 step 2 — UNCHANGED

Same action, second row; 15-min snap (H7) carried.

### AG-S3 step 3 — UNCHANGED

Red-clock markers come from the detector query below run in the grid loader — event-scoped,
see step 4.

### AG-S3 step 4 — UNCHANGED

The class-(a) self-join pairs rows only under
`a.event_id = :eventId AND b.event_id = a.event_id` — cross-event, hence cross-org, pairing
is impossible by construction, and no `organizations` join or predicate belongs in the
detector (rooms and submissions both scope via the event). H6/H9 carried.

### AG-S3 step 5 — UNCHANGED

"Open" links to `/admin/submissions/:id`; that loader's existing eventId row check is the
full tenancy story per design doc §Authorization bullet 5 (org derived via event, never
stored where derivable).

### AG-S3 step 6 — UNCHANGED

Resolve is the move UPDATE — same event-scoped artifact as AG-S2 step 5.

### AG-S3 step 7 — UNCHANGED

Conflicts stay compute-on-read; nothing stored means nothing org-attributable to orphan.

**AG-S4 — Speaker double-book across rooms; track/time is NOT a conflict**

### AG-S4 step 1 — UNCHANGED

Precondition state from AG-S3 — event-scoped rows, no new columns involved.

### AG-S4 step 2 — UNCHANGED

Schedule-action UPDATE, `id + event_id` verified — see AG-S2 step 3.

### AG-S4 step 3 — UNCHANGED

The class-(b) detector joins `participants` (submission_id/contact_id, L721) and `contacts`
(L498) — neither gained an org column, `contacts.event_id` NOT NULL survives, and the join
constrains `b.event_id = a.event_id` under `:eventId`. Cross-room by construction, still
single-tenant by construction.

### AG-S4 step 4 — UNCHANGED

The negative probe is structural absence: `submission_tracks` appears nowhere in the
detector, and the migration added no query that could reintroduce it.

### AG-S4 step 5 — UNCHANGED

Move UPDATE; the strict-inequality boundary argument is untouched by tenancy.

### AG-S4 step 6 — UNCHANGED

Both detector queries return zero rows for the resolved event; other orgs' rows were never
in scope (step 4's join bounds).

**AG-S5 — Settings drive the grid**

### AG-S5 step 1 — UNCHANGED

`SELECT agenda_day_start_min, agenda_day_end_min FROM events WHERE id = :eventId` names its
columns; the new `organization_id` column is simply not read.

### AG-S5 step 2 — UNCHANGED

`UPDATE events SET agenda_day_start_min…` touches no new column — `organizationId` NOT NULL
constrains INSERTs, and the settings action never inserts events. Preventing a cross-org
settings write is resolution + admin guard, covered: Wave B (design doc §Authorization
bullets 1–2). H8 (route ownership) carried.

### AG-S5 step 3 — UNCHANGED

Status gating is the AG-S1 step 3 predicate; H2 carried (see header note — `$defaultFn` now
exists but the raw-SQL seed still leaves `e_demo` NULL).

### AG-S5 step 4 — UNCHANGED

`UPDATE events SET schedulable_statuses = '["accepted","accept_queue"]'` — JSON column
update on the resolved event's row; no tenancy surface.

### AG-S5 step 5 — UNCHANGED

Same UPDATE restoring `'["accepted"]'`; symmetric to step 4.

### AG-S5 step 6 — UNCHANGED

'pending' never enters the JSON; predicate logic only.

### AG-S5 step 7 — UNCHANGED

Window-restore UPDATE, same shape as step 2.

**AG-S6 — Unschedule round-trip**

### AG-S6 step 1 — UNCHANGED

Reads AG-S1 steps 2/5 queries — event-scoped, walked above.

### AG-S6 step 2 — UNCHANGED

Unschedule UPDATE clears `starts_at/ends_at/room_id` on the `id + event_id`-verified row —
same row-verification story as AG-S2 step 3.

### AG-S6 step 3 — UNCHANGED

Card/cell/DB assertions all read the same single event-scoped row.

### AG-S6 step 4 — UNCHANGED

Recomputed counts — AG-S1 artifacts.

### AG-S6 step 5 — UNCHANGED

Committed UPDATE persists; no org dimension.

### AG-S6 step 6 — UNCHANGED

Re-drag is the AG-S2 schedule action with NULL `starts_at` ⇒ re-derive from format
(H5 carried); `formats` untouched by the migration.

---

## Re-walk 2026-08-11 — official evaluation conflict/publish/render correction

Changed artifacts: `SCOPE.md` P0 #6, `docs/scenarios/06-agenda.yaml`, `app/agenda/lib.ts`
(logical conflict projection), `app/agenda/board.tsx` (readable lane width),
`app/routes/admin.agenda.tsx` (table/badge + guarded publish dialog), and
`app/widgets/surfaces.tsx` (public lane/track/detail rendering). No table, port, route, or
persistence contract changed. The official evaluation supersedes Sessionboard's reciprocal
row presentation: OpenRostrum now counts one user-visible row per logical clash while keeping
both editor paths.

**AG-S1 — Unscheduled panel + scale**

- Steps 1–6 — **UNCHANGED:** auth/event resolution, scheduled/unscheduled predicates, negative
  fixtures, alert SQL, and accepted-spine dependency use the same loader artifacts.
- Step 7 — **CHANGED:** `GridColumn` computes `peakLaneCount` from `layoutLanes`; its minimum
  width is `max(148, peakLaneCount * 140)` inside the existing horizontal scroller. Dense
  overlap clusters widen instead of shrinking titles below a readable lane.

**AG-S2 — Schedule and move**

- Steps 1–6 — **UNCHANGED:** format-duration lookup, schedule UPDATE, count changes, move,
  and reload persistence are untouched. Lane width changes rendering only when placements
  overlap; the drop/action artifacts remain exactly those walked above.

**AG-S3 — Same-room conflict**

- Steps 1–3 — **UNCHANGED:** both schedule writes and two red-clock markers still derive from
  the same strict-overlap pair.
- Step 4 — **CHANGED:** `buildConflictRows([pair])` returns `{rows:[pair], total:1}`; the table
  renders both titles, one human sentence, and Open first/Open second links. The tab count is 1.
- Step 5 — **CHANGED:** both `/admin/submissions/:id` links live on the same logical row.
- Step 6 — **UNCHANGED:** moving Panel makes the strict overlap predicate false.
- Step 7 — **CHANGED:** both markers disappear and the one logical row leaves the table.

**AG-S4 — Speaker conflict / no track collision**

- Steps 1–2 — **UNCHANGED:** AG-S3 precondition and Office Hours schedule write are unchanged.
- Step 3 — **CHANGED:** the speaker detector still yields one pair; one table row names Marco
  Silva and both sessions and retains both editor paths.
- Steps 4–6 — **UNCHANGED:** no track query exists, the resolution write is unchanged, and the
  final detector result remains empty.

**AG-S5 — Settings**

- Steps 1–7 — **UNCHANGED:** window reads/writes, schedulable-status JSON, negative Pending
  fixture, persistence, and restore artifacts do not consume conflict-row or public-render code.

**AG-S6 — Unschedule round-trip**

- Steps 1–6 — **UNCHANGED:** counts, NULL-clearing UPDATE, reload, and format-derived re-drop
  remain exactly as walked above.

**AG-S7 — Publish/public handoff**

- Steps 1–6 — **NEW:** fully walked in the AG-S7 section above: concrete overlap/publish SQL,
  one logical `alertdialog` preview, no-POST Cancel path, guarded retryable publish, 320px
  two-lane public room, track chip, and labeled Track metadata row.

Result: 45 scenario steps walked — 34 unchanged, 5 changed, 6 new, 0 gaps.

## 2026-08-11 re-walk — calendar revision ledger and provider send claims (design-time gate)

**Gate trigger.** This file's `touches:` names `routes: [admin.agenda.tsx]`, and this branch changes
`app/routes/admin.agenda.tsx` (+137/−41). All 45 steps are walked below — none pre-filtered. Shared
structural findings **S1**, **S2** and **S3** are stated in full in `01-auth-event-setup.walk.md`
§"2026-08-11 re-walk".

### Concrete artifacts — what changed in `admin.agenda.tsx`

The route delta is entirely on the **schedule-update maintenance surface**: the stale-speaker InfoBar, the
`intent="schedule-updates"` action, and the outcome banners. The grid, drag/drop placement, conflict
detection, Agenda Settings, unschedule, and publish paths are untouched. Four concrete changes:

1. **Loader now surfaces `event.scheduleScanBlocked` and `event.scheduleBlockedSessions`** alongside the
   pre-existing `scheduleScanTruncated` (`admin.agenda.tsx:308`), fed by
   `ScheduleChangeSet.blockedSessions` (`app/domain/schedule-update.ts:73`).
2. **A truncated scan is no longer a dead end.** The old banner read "Matching invite history exceeded the
   check limit, so schedule-update counts may be incomplete." and offered nothing. It now renders inside an
   `InfoBarActionRow` with a **"Continue checking invite history"** POST button (the same
   `intent="schedule-updates"` form, extracted as `scheduleUpdateForm`), so the organizer has an actionable
   continuation path instead of a permanent warning.
3. **A new held-back-sessions banner**, naming the sessions whose speaker holds a delivered invite we
   cannot read back, with a `TextLink` to `/admin/emails/history` and the assurance that every other
   session still sends. The quarantine is per recipient address, so it withholds those sessions rather
   than the event: the banner coexists with the stale-speaker banner and the send stays available.
4. **The action normalizes before it sends.** `intent="schedule-updates"` now runs
   `normalizeCalendarInviteHistory(db, event.id)` first; if it did any work it returns early with
   `{ normalization: { processed, remaining } }` and renders
   `ScheduleHistoryNormalizationOutcome` — "N invite-history records normalized. More history remains;
   continue before any email is sent." / "History is ready; continue to send the pending updates." — plus a
   **"Continue schedule updates"** button. The delivery banner
   (`ScheduleUpdateDeliveryOutcome`) gained one clause: "— N deliveries still in progress", so an active
   claim held by a concurrent request reads as in-flight rather than as a failure.

**Baseline precondition (governs the UNCHANGED verdicts below).** `computeScheduleChanges` only considers
submissions with a non-NULL `notified_at` (`app/domain/schedule-update.ts:853`), and the seed sets
`notified_at` nowhere. At the seed baseline there is therefore no calendar-bearing outbox history: the
normalization preflight finds nothing, `staleSpeakers` is 0, `truncated` is false and `blockedSessions` is
empty — so
**none of the changed banners render on a baseline Agenda load**, and every screenshot oracle in this file
is byte-identical to `origin/main`.

### AG-S1 — Unscheduled panel at scale (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Seed reset + admin login → Oct 12 day×room grid. Loader runs the same change-set scan as on main; baseline precondition means it returns EMPTY and renders no banner. |
| 2 | UNCHANGED | Scheduled (47) / Unscheduled (11) counts come from `submissions.starts_at`, untouched. |
| 3 | UNCHANGED | Accepted-only card spot-check + DB cross-check. |
| 4 | UNCHANGED | Negative probe on Pending / Accept Queue titles. |
| 5 | UNCHANGED | "11 accepted sessions still need a time slot" alert. |
| 6 | UNCHANGED | RV-S4 dependency check — provisioning is untouched (see `05-review-accept.walk.md` RV-S4). |
| 7 | UNCHANGED | Oct 13 density scroll over 47 scheduled sessions. |

### AG-S2 — drag to schedule, format default, then move (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Agenda Settings format mapping. |
| 2 | UNCHANGED | Drag from Unscheduled to Main Hall 9:30. |
| 3 | UNCHANGED | 45-min auto-fill, no modal. |
| 4 | UNCHANGED | DB start/end + panel recount + alert. The placement action (`intent="place"`) is untouched; it does **not** send email, so no outbox row, no claim, no calendar-ledger write. |
| 5 | UNCHANGED | Move across day and room, duration preserved. |
| 6 | UNCHANGED | Placement persists across reload. |

Note on the seam: after step 4 the session is scheduled but was never notified, so it still does not enter
the change set — the stale-speaker banner stays absent, exactly as on main.

### AG-S3 — same-room overlap conflicts (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Place the Talk at 10:00–10:30. |
| 2 | UNCHANGED | Place the Panel at 10:15–11:15. |
| 3 | UNCHANGED | Red-clock markers on both blocks. |
| 4 | UNCHANGED | Exactly 1 logical Conflicts row naming both sessions and the shared slot. |
| 5 | UNCHANGED | Open link launches the session editor. |
| 6 | UNCHANGED | Resolve by moving to 11:30. |
| 7 | UNCHANGED | Markers and row clear. Conflict detection reads `submissions`/`rooms` only — no email, port, or ledger involvement. |

### AG-S4 — speaker double-booking vs. track collision (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Precondition carried from AG-S3. |
| 2 | UNCHANGED | Cross-room overlap with a shared speaker. |
| 3 | UNCHANGED | Markers + one logical row naming Marco Silva and both sessions. |
| 4 | UNCHANGED | Negative probe: same track, no shared speaker → no conflict. |
| 5 | UNCHANGED | Resolve by moving to 1:00 PM. |
| 6 | UNCHANGED | Conflicts tab empty. |

### AG-S5 — Agenda settings drive the grid (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Baseline 8 AM–6 PM gutter. |
| 2 | UNCHANGED | 7 AM–10 PM after save (before/after screenshots). The settings action is untouched, and the baseline precondition keeps the changed banners off both screenshots. |
| 3 | UNCHANGED | Schedulable statuses baseline = [Accepted]. |
| 4 | UNCHANGED | Adding Accept Queue surfaces the card. |
| 5 | UNCHANGED | Removing it hides the card again. |
| 6 | UNCHANGED | Pending never schedulable. |
| 7 | UNCHANGED | Restore baseline window. |

### AG-S6 — unscheduling returns the session (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Record N and panel counts. |
| 2 | UNCHANGED | Drag back to Unscheduled. |
| 3 | UNCHANGED | Card returns, cell empty, DB start/end cleared. |
| 4 | UNCHANGED | Alert reads N+1; counts move by exactly one. |
| 5 | UNCHANGED | Survives reload. |
| 6 | UNCHANGED | Re-drag restores the clean end state. |

Seam note: clearing a scheduled slot on a *notified* submission is what puts it in the change set. That path
is exercised by scenario 08 (EM-S5/EM-S6), already re-walked in `08-emails.walk.md`; at the seed baseline
used here, no submission is notified, so the behavior in these six steps is identical to main.

### AG-S7 — publishing with unresolved conflicts (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Recreate one unresolved logical conflict. |
| 2 | UNCHANGED | In-app confirmation (never a native dialog) listing exactly 1 conflict and both sessions. The `publish` intent is a separate branch of the same action; the normalization preflight added in this branch is scoped to `intent === "schedule-updates"` only, so Publish is not gated on invite history. |
| 3 | UNCHANGED | Cancel writes nothing; `agenda_published_at` stays NULL. |
| 4 | UNCHANGED | Publish anyway; guarded while pending; header flips to Published. Double-submit hygiene here is the existing `busy` disable on the publish fetcher — the extracted `scheduleUpdateForm` helper shares the same `busy` flag but is a different form and does not affect it. |
| 5 | UNCHANGED | Public schedule renders both overlapping cards with min width, title tooltips, and track badges. |
| 6 | UNCHANGED | Session detail exposes the Track row. |

### Re-walk verdict

**45/45 steps re-walked. 0 CHANGED, 45 UNCHANGED, 0 BLOCKER, 0 MAJOR.** The route's delta is real but lands
entirely on the schedule-update maintenance surface, which no AG step exercises and which is dormant at the
seed baseline. The changed surface is covered by scenario 08 (`08-emails.walk.md`, EM-S1–EM-S6) and by
`test/admin.agenda.route.test.ts`. No `touches:` update required — `routes: [admin.agenda.tsx]` already
selects this file.
