# AI Agenda & Schedule Builder — feature reference

## What this is

This documents SessionBoard's AI Agenda area — the target behavior a clone is graded
against. It is an organizer-facing agenda/schedule builder with an embedded "AI Agenda
Management Assistant." Organizers build multi-track, multi-day programs by placing
sessions into time slots across rooms and tracks (calendar-style drag-and-drop implied
by the marketing copy). The AI layer continuously monitors the agenda and flags
conflicts — speaker double-bookings across time slots, room capacity/booking overlaps,
track sequencing issues, content dependency conflicts — and suggests resolutions
(alternative slots, room swaps, speaker substitutions). A "Scheduler Agent" auto-packs
sessions into rooms and tracks from configured constraints, generating a conflict-free
draft schedule. The agenda is connected to the speaker database, submission records,
and content management, and publishes to the event website. Marketing claims 83%
faster agenda launch (a case-study metric, not a testable feature).

**Eval scope note:** this area is deprioritized to BASICS ONLY. The rubric covers
agenda-builder fundamentals — structure configuration (days/tracks/rooms/slots),
placing accepted sessions, conflict detection (speaker double-booking, room overlap),
edit/move, and publishing. The "AI" auto-scheduling claims are judged as weight-1
polish: any assisted/auto-place capability counts.

## Personas & user journeys

Personas from research:

- **Event organizer / admin** (primary): builds and maintains the agenda, runs the AI
  scheduler, approves changes.
- **Speaker**: availability and double-booking constraints are checked against them;
  receives update notifications.
- **Attendee**: consumes the published agenda on the event website (out of scope for
  this area's rubric beyond the published-view check).

### Journey 1: Manually build a multi-track agenda (organizer)

1. Open the event's Agenda/Schedule builder.
2. Configure event days, time slots, rooms, and tracks.
3. See accepted/unscheduled sessions in a pool or sidebar.
4. Drag (or click-assign) sessions onto specific day/time/room slots.
5. Tag each session with a track; edit session metadata inline.
6. Observe real-time conflict badges appear/disappear as sessions move.

**Filled state:** a 2-day calendar grid with rooms as columns and 30–60 min time slots
as rows; 12+ sessions placed, color-coded by 3 tracks; a small pool of unscheduled
sessions remaining; one visible conflict badge on a double-booked speaker.

### Journey 2: AI auto-schedule then review conflicts (organizer)

1. With sessions accepted but unscheduled, trigger the AI auto-schedule (Scheduler Agent).
2. AI packs sessions into rooms/tracks/slots per constraints (speaker availability,
   track balancing, sequencing rules).
3. Review the generated draft schedule.
4. Any residual conflicts are flagged with resolution options (alternative slot, room swap).
5. Accept or reject suggested resolutions; approve schedule to go live.

**Filled state:** a fully populated grid produced in one action, zero or few conflict
flags, a review panel listing AI placement decisions and any flagged conflicts with
one-click resolution suggestions.

### Journey 3: Handle a last-minute change (organizer)

1. A speaker cancels or a room becomes unavailable mid-event-prep.
2. Drag the affected session to a new slot/room.
3. System instantly checks speaker availability and flags any new overlaps or broken
   dependencies.
4. System suggests alternative slots or speaker substitutions.
5. Change passes through approval flow before the public agenda updates.

**Filled state:** grid mid-edit with one session highlighted, a warning panel showing
"speaker unavailable at this time" plus 2–3 suggested alternative slots, and a
pending-approval indicator on the change.

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| Agenda builder grid | Yes | Calendar-style agenda builder for multi-track, multi-day programs; organizers place sessions into time slots across rooms/tracks, drag-and-drop with inline session metadata editing (inferred from "agenda builder" + category norms). | Schedule/timeline view: time axis, rooms or tracks as columns, day switcher/tabs, session cards placed in slots, a pool/sidebar of unscheduled sessions, drag-drop or click-to-assign placement. |
| Tracks, rooms, and time slot configuration | Yes | Organizers define event days, time slots, rooms, and tracks that structure the agenda; sessions are assigned a track and a room+slot (setup UI inferred; entities explicitly named throughout copy). | Settings or inline controls to add/edit rooms (with capacity), tracks (with name/color), days and slot durations; new rooms/tracks immediately appear in the grid. |
| Automatic conflict detection | Yes | AI continuously monitors the agenda and flags speaker double-bookings across time slots, room capacity/booking overlaps, track sequencing issues, and content dependency conflicts as the agenda is built or edited. | Visible conflict indicators (badge/highlight on session cards, warning toast, or conflicts panel) that appear immediately when a conflicting placement is made and clear when resolved. |
| AI auto-scheduling (Scheduler Agent) | Yes (downgraded to polish in this eval) | A Scheduler Agent "packs sessions into rooms and tracks without conflicts" — generates a conflict-free schedule from configured constraints in one action; double-bookings flagged, resolutions suggested. | An "Auto-schedule" / AI assistant trigger in the agenda builder; after running, unscheduled sessions are placed into slots/rooms; residual conflicts surfaced for human decision. |
| Conflict resolution suggestions | No | When conflicts are flagged, the system presents actionable resolution options: alternative time slots, room swaps, speaker substitutions; organizer applies with a click. | Conflict detail panel/popover listing 1+ concrete suggested fixes, each applicable directly from the suggestion. |
| Rule-based agenda logic | No | Organizers create rules that shape the program: session sequencing (dependencies/ordering), speaker constraints (availability windows), track balancing; rules are enforced or violations warned during scheduling. | A rules/constraints UI (per-session dependency field, per-speaker availability, or a rules list); violating a rule during placement produces a visible warning. |
| Speaker availability checks | No | Before/when moving a session, instantly see if the change impacts a speaker's ability to present or attend other sessions. | Warning when a session is moved to a time its speaker is unavailable or already booked; availability stored on the speaker record (inferred). |
| Audit and approval flows | No | Agenda changes pass through review/approval so nothing goes live without oversight; change history auditable (mechanics inferred — draft vs. published states are the category norm). | Draft/pending state on edits, an approve/publish action, and a change log or audit trail view. |
| Real-time recommendations | No | AI suggests schedule updates in real time as the organizer edits, embedded inside the agenda builder rather than a separate tool. | Suggestions appear contextually during editing (inline hints, assistant panel) without page reloads or switching tools. |

Because the eval scope is basics-only, the optional features above (resolution
suggestions, rule-based logic, speaker availability windows, approval flows, real-time
recommendations) are not separately rubric-scored; conflict clearing on edit and the
publish action stand in for the essential slices of them.

## Rubric rationale

- **AIA-01** (w3, auto): the builder view itself — time dimension, rooms/tracks, day
  navigation — is the area's foundation; fully observable from screenshots, so auto.
- **AIA-02** (w2, auto): configuring rooms/tracks is important but a clone might
  pre-seed structure from event setup elsewhere; the scenario handles that by adding
  one extra room/track to prove configurability. Creation forms and the resulting
  grid columns are directly verifiable, so auto.
- **AIA-03** (w3, auto): placing a session into a day/time/room slot is the core
  workflow — the area is pointless without it; placement plus a reload check is fully
  agent-verifiable.
- **AIA-04** (w3, auto): speaker double-booking detection is the headline conflict
  feature and the explicit basics-scope requirement; triggered deterministically by
  overlapping two Priya Raman sessions, so auto.
- **AIA-05** (w2, auto): room overlap is the second named conflict class; either
  block-on-drop or a visible flag passes, both observable in-browser.
- **AIA-06** (w2, auto): edit/move with conflicts clearing proves the agenda is live
  and consistent, not a static render; verified by moving sessions and re-screenshotting.
- **AIA-07** (w2, auto): the publish/go-live action and its confirmation are the payoff
  of the whole workflow; the agent triggers publish and takes a handoff glimpse of the
  public surface in the same browser, so auto rather than auto-partial. The public
  schedule rendering itself is graded once, by EMB-06 in public widgets, to avoid
  double-counting one public agenda page across areas.
- **AIA-08** (w1, auto): per the deprioritized scope, "AI" auto-scheduling is polish
  judged generously as "some assisted/auto-place capability exists"; presence and a
  one-shot placement result are agent-observable. Whether the auto-generated result
  is conflict-free is recorded but not gating (conflict detection is scored by
  AIA-04/05, not here).

## Sources

- https://www.sessionboard.com/capabilities/ai-agenda
- https://www.sessionboard.com/products/ai

Research gaps noted: the marketing pages contain no product screenshots, so concrete
layout details (grid orientation, unscheduled-session sidebar, conflict badge styling,
auto-schedule button placement) are inferred from category norms
(Sessionize/Cvent/Grip-style builders). Not learnable from sources: how speaker
availability is captured, the exact rules-engine UI, approval-flow mechanics (draft
vs. published states inferred), whether auto-scheduling is one-click batch vs.
conversational, room-capacity conflict thresholds, and attendee-facing published-agenda
behavior. The 83% agenda-launch-time claim is a case-study metric, not a testable
feature.
