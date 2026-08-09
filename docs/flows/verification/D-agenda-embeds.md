# Verification D — Agenda Builder & Embeds

**Scope:** Confirm `docs/flows/06-agenda-embeds.md` and `SCOPE.md` (req 5, agenda) against the authoritative Guidde walkthroughs.
**Evidence:** 18 frames `docs/reference/guidde/06-agenda/01–18.jpg` + 10 frames `docs/reference/guidde/06-embeds/01–10.jpg`, plus the `06-agenda` / `06-embeds` captions in `docs/reference/guidde/ALL-CAPTIONS.md`. Read pass done 2026-08-08.
**Headline:** These frames are the first images we have of the **populated** agenda and the **live** conflicts/embed wizard — earlier research only had the empty agenda and reconstructed the embed flow from KB text + production JS. The frames confirm most of our doc and correct two material things: the **embed "types" are layouts nested under one Styled-HTML format**, and **conflict detection is speaker-OR-location-in-same-timeslot** (no track collisions).

Two admin UI variants appear across the frames and both are real:
- **VD account** (agenda 02–10, 13–17): `Embeds` is a **left-rail item** under Sessions; agenda sub-nav is `List · Day · Week · Month · Rooms · Conflicts · Settings`.
- **MC / other account** (agenda 11–12, embeds 02–08): `Embeds` is an **Agenda sub-tab**; sub-nav is `List · Day · Week · Month · Rooms · Conflicts · Embeds · Settings`; top nav reads `Submissions · Evaluation · Agenda · Speakers · Settings`.

---

## 1. Screen-by-screen confirmed inventory

### 1.1 Agenda shell & view tabs — `agenda/02,03,04`
- Page title **"Agenda — Manage your event agenda and the information that your attendees will see."**
- View tabs (confirmed present, in order): **List · Day · Week · Month · Rooms · Conflicts · Settings** (+ **Embeds** in the sub-tab variant).
- Left panel of List view: `Sample` saved-view selector, **Edit View**, **Show/Hide Fields**, **Filters → Add Filter +**, **Sort By → Add Sort By +**.
- Top-right toolbar: **Drafts** button, **Options ▾**, **+ Add** (orange).
- Confidence: **High.**

### 1.2 List view (WITH sessions) — `agenda/02,03,04`
- Table tabs are **time-based, not status-based**: `All Sessions (9)` · `Upcoming (1)` · `Past (7)`.
- Every row carries a green **Accepted** pill — the view is Accepted-only in this event (see §2.3).
- Columns visible: checkbox · edit-pencil · sort arrows · **Status** · **Title** · **CEU Credits** · **Description** · **Starts At** … (horizontal scroll bar shows more columns off-screen). CEU shows a value only for "Lunch" (1.00); others show "–".
- Footer: **"9 rows"**, **Show: 100 ▾** pagination.
- Confidence: **High.**

### 1.3 Day view — `agenda/05`
- Toolbar: **Go To Date ▾**, **< >** nav, month label ("August 2025"), **Drafts**.
- Single day column header **"Tue 5"**, hourly gutter 9am→8pm (bounded by Day Start/End settings).
- One scheduled block, track-colored (purple/blue = Academia): top line **"5:00 - 6:00"**, second line the full title **"Graduate STEM Education for the 21st Century: Findings and Recommendations."**
- Right **Sessions** panel: tabs **Scheduled (8)** / **Unscheduled (1)**; a search box; sessions grouped under day headers (`TUE, AUG 5`, `WED, AUG 6`). Each card = **title + colored track pill ("Academia") + time range ("5:00 PM - 6:00 PM") + edit-pencil**.
- Confidence: **High.**

### 1.4 Week view — `agenda/06` and `agenda/11`
- 7 day columns (Sun 3 → Sat 9), hourly gutter, `Go To Date / < > / Drafts`.
- Blocks are **track-colored**: Academia = blue/purple, Leadership = green (`06`); a richer December set (`11`) adds teal, orange, and grey blocks.
- **`11` is the load-bearing frame:** grey/faded blocks = **draft** sessions (shown with Drafts on, e.g. "9:00–10:00 Session Manager New Session", "2:00–3:00 Closing Remarks"); and two **orange** 9:00 blocks on Thu 18 each carry a **red circular clock/warning icon** in the corner — the **in-calendar conflict marker** (see §2.5). Right panel here reads **Scheduled (16) / Unscheduled (5)**; an unscheduled "Draft Submission" card has **no track pill**.
- Confidence: **High** (marker icon shape **Medium** — small at frame resolution).

### 1.5 Month view — `agenda/07`
- Full-month grid (August 2025). Sessions render as **uniform blue/teal blocks** with `time + truncated title` (e.g. "5p Graduate STEM Education…", "11a Satisfying Student Demand…", "2:30p Advancing Diversity and Inclus…", "10:30a Lunch").
- **Track colors are NOT applied in Month view** — every block is the same blue. Confirms the doc's claim.
- Confidence: **High.**

### 1.6 Rooms view — `agenda/08,09,10`
- Header: **two layout-toggle icons** (the timeline flip), **Go To Date / < >**, **zoom-out / 100% / zoom-in**, **Drafts**, and a single-day date label ("Wednesday, August 06, 2025").
- **Room columns** across the top, each with capacity: **"Room A (capacity 30)" · "Room 307" · "Unassigned"** (the Unassigned column holds scheduled-but-unroomed sessions).
- Blocks are track-colored and placed under a room column: "11:00–12:00 Satisfying Student Demand…" (purple, Room A), "6:00–7:00 Defining Your Professional Trajectory" (green, **Unassigned**).
- Right panel **Scheduled (8) / Unscheduled (1)**. `10` shows the **Unscheduled** tab: card **"The future of AI"** with an **"Academia"** pill and edit-pencil.
- Confidence: **High.**

### 1.7 Scheduled vs Unscheduled side panel & drag-to-schedule
- Panel is persistent on every calendar view (Day/Week/Month/Rooms), right side, collapsible (chevron handle visible at panel edge in `05/08`).
- **Scheduled** = has date/time (grouped by day). **Unscheduled** = no date/time (flat list). Counts update per view (8/1 in Aug event, 16/5 in Dec event).
- The drag interaction itself is not a still-frame artifact; caption 11 ("click and drag the session to your desired date and time") is our only source. Confidence on drag: **Medium** (caption-only, no frame shows a drag in progress).

### 1.8 Conflicts tab (WITH conflicts) — `agenda/12`
- Title **"Conflicts"**; subtitle verbatim: **"View sessions where speakers or locations are shared with other sessions in the same timeslot."** ← the authoritative definition of a conflict.
- Section header **"Unresolved"**, right-aligned **"↻ Refreshed Monday, May 19 at 9:07 PM CDT"** (a refresh timestamp — recompute is on-refresh, not live).
- Table columns: **Session ID · Title · Conflicts · [Open]**.
- Row content (both directions listed):
  - `SESS-28` — "Graduate STEM Education for the 21st Century…" — Conflicts: **"Andrew Wu is also scheduled in \"How do we know that our approach is effective?…\" during this time."** — **Open** (blue link).
  - `SESS-47` — "How do we know that our approach is effective?…" — Conflicts: **"Andrew Wu is also scheduled in \"Graduate STEM Education…\" during this time."** — **Open**.
- So a single double-booking produces **two reciprocal rows**; the conflict cell names the **person** and the **other session**. **Open** launches the session editor. This example is a **speaker double-book**; a location clash would read against the shared room per the subtitle.
- Confidence: **High.**

### 1.9 Agenda Settings — `agenda/14,15,16,17`
Page "Agenda Settings — Customize the settings for building your agenda" under **Session Settings**. Left sub-nav: `Agenda · Criteria · Personas · Rooms · Tracks · Tags · Levels · Formats · Languages · Files · Statuses`.
- **Day Start Time** (9:00am) / **Day End Time** (11:00pm) — each a time input with clear-× and dropdown. (`16` shows a 12:00am–11:00pm variant.)
- **Session Statuses**: chip multi-select — **Accepted** (green), **Accept Queue** (green), **Pending** (yellow) — with a dropdown to add more. These are the statuses that become schedulable / appear on the agenda.
- **Session Format → Default Duration**: paired rows mapping each format to a preset length. Observed: `Lightning Talk → 15min`, `Session → 1h 30min`, `Keynote → 1h` (`14`); `Lightning Talk → 30min`, `Roundtable → 1h` (`15/17`). **+ Add format** link; each row has remove-×. Scheduling a session of that format auto-computes its end time from the start time.
- **Room Visibility**: radio **Show all rooms** / **Select individual rooms** (selected), then a room chip multi-select showing `Name (capacity N)` — e.g. "Room 307 (capacity -)", "Room A (capacity 30)", "Room A (capacity 45)", "Room B (capacity -)".
- **Save** (orange).
- Confidence: **High.**

### 1.10 Embeds list — `embeds/02`, `embeds/08`, `agenda/13`
- Page: **"Embeds — Export a feed of your agenda, sessions, or speakers to place in your app or website."** Search box; **+ Add Embed**.
- Two list renderings, both real: **cards grouped by Format** ("Styled HTML 4", "JSON 1"; each card = name + Enabled badge + ⋯) in `embeds/02,08`; a **table** (Name · Format · Enabled · ID · Actions) in `agenda/13` where actions are inline **Edit | Delete | Get Code | Refresh Cache**.
- Per-embed **⋯ menu** (`embeds/08`): **Edit · Get Code · Refresh Cache · Delete**.
- Confidence: **High.**

### 1.11 Add-Embed wizard — `embeds/03,04,05,06,07`
Five-step stepper: **1 Select Type · 2 Style Options · 3 Filters · 4 Field Options · 5 Get Code**.

- **Step 1 — Select Type (`03`):** **Name*** field (+ info) and an **Enabled** toggle; **Format*** radio group: **Embed Styled HTML** (selected; "Configure settings for styled HTML feeds including **Agenda, Session List, Schedule Itinerary, Speaker List, and Speaker Gallery**. Each embed can be placed directly in your website and will auto-update…"), **Embed HTML** ("Create a feed that you can style with CSS."), **JSON Feed** ("…organizing and sharing information…in a structured way."). More formats scroll below (XML / iCal per KB). Footer: **Cancel / Next: Style Options**.
- **Step 2 — Style Options (`04`):** "Select style options for your HTML embed."
  - **Website Color Theme** dropdown (**Light** shown → Light/Dark).
  - **Primary Color** hex field + swatch (`#1b6ec2`, with a Hex Color picker).
  - **Date/Time Format** dropdown ("English (US): Fri, June 3, 2022 at 11…" — locale-driven).
  - **Extra CSS Code** textarea with warning: "Sessionboard doesn't validate or provide custom code support. This can break existing styles. Recommended for expert users or developers only." (placeholder `.someClass { some-css-property: value; }`).
  - **Embed Options** panel, two groups:
    - **SESSION AND SPEAKER**: *Click session or speaker to open pop-out view* · *Display schedule in browser timezone* · *Show add to calendar button* · *Search session/speaker by name* (on) · *Order session speakers alphabetically* (on).
    - **SHOW FILTERS** (attendee-facing controls): *Filter sessions by format* · *by language* · *by level* · *by location* (all on) … (more below the fold; track expected).
  - Footer: **Back / Next: Filters**.
- **Step 3 — Filters (`05`):** "Filter Sessions and Speakers — Set a filter to only include relevant sessions and related contacts." A **field / operator / value** row (e.g. `Ends At` / `Is after` / `04-04-26`) with remove-×, **+ Add filter**, and a live green banner: **"✓ 2 sessions and 68 speakers match this filter. Note: Some embed styles will not show sessions if they do not have a start and end time defined."** Footer: **Back / Next: Field Options**.
- **Step 4 — Field Options (`06`):** "Select which fields to display in each section of the embed." Filter-fields search + three checkbox columns, each with **Select All**:
  - **Agenda**: Title✓, Starts At✓, Ends At✓, Speakers✓, Description✓, Track✓, Format✓, Location✓, Tags✓…
  - **Speaker**: Salutation○, Full Name✓, Honorific○, Email○, Job Title○, Company Name○, Headshot○, Biography○, Website…
  - **Session**: Title✓, Starts At✓, Ends At✓, Description✓, Speakers✓, Location○, Track○, Level○, Tags○…
  - Footer: **Back / Save**.
- **Step 5 — Get Code (`07`):** "Embed Styled HTML — Copy and paste one code into your webpage. Do not use multiple codes on the same webpage." One **snippet per layout**, each with **Copy | Preview**:
  - *Schedule Itinerary*: `<script src="https://api.sessionboard.com/sessionboard-schedule-embed.js"></script>` + `<sessionboard-embed embed-id="89ad0ae6-…-ef592880432d" widget-type="schedule"></sessionboard-embed>`.
  - *Speaker Gallery*: `…/sessionboard-speaker-gallery-embed.js` + `widget-type="speaker-gallery"`.
  - (Agenda / Session List / Speaker List follow, same `embed-id`, differing `widget-type`.)
  - Footer: **Back / Done**.
- Confidence: **High.**

### 1.12 Rendered public embed (Schedule Itinerary) — `embeds/09`
- Blue banner **"2025 HINOMA Research Annual Conference"**; heading **"Itinerary"**.
- **Search session by title** box + attendee filter dropdowns: **Level · Track · Format · Location · Tags · Language**.
- **Day tabs**: "Thursday, December 14" / "Friday, December 15".
- **Time-group header** "🕐 09:00 AM", then a session card: green **Leadership** track pill + linked title "GRADFair: A Career Fair for Graduate Students and Postdocs"; "🕐 09:00 AM - 10:00 AM  📍 Room 307".
- **Speakers** block: headshot grid, each with linked name + job title + company.
- Metadata footer row: `LANGUAGE: English | LOCATION: Room 307 | LEVEL: Intermediate | TAGS: CPOI Credit Eligible | TRACK: Leadership | FORMAT: Roundtable`.
- Confidence: **High.**

### 1.13 Cache / Refresh — `embeds/08` + caption
- **Refresh Cache** confirmed as a ⋯-menu action (and an inline action in the table variant).
- The **60-minute auto-refresh** figure is caption-only (`06-embeds` step 8): "Embeds automatically update every 60 minutes… select 'Refresh Cache' from the three dots column." No frame shows the interval numerically. Confidence: **Medium** (caption-only).

---

## 2. Corrections & new facts vs our docs

### 2.1 CORRECTION — embed "types" are layouts under one Styled-HTML format
Our `06-agenda-embeds.md` §2d presents **five embed types** (Schedule itinerary / Speaker gallery / Agenda / Session list / Speaker list) as the type choice, and separately lists output formats. The wizard (`embeds/03,07`) shows the real hierarchy:
- The **Format** radio is: **Embed Styled HTML · Embed HTML · JSON Feed · (XML · iCal)**.
- The **five layouts live *inside* "Embed Styled HTML"** — one Styled-HTML embed (one `embed-id`) yields **all five** widget snippets at Get Code, each distinguished by `widget-type` (`schedule`, `speaker-gallery`, `agenda`, `session`, `speaker`).
- The embed **list groups by Format** ("Styled HTML", "JSON"), not by layout.
Net: keep the five layouts and the `widget-type` enum, but re-file them as **sub-outputs of the Styled-HTML format**, not top-level types. SCOPE P2 #2 (public `/schedule` + `/speakers`) is unaffected — it maps to the `schedule`/`speaker-gallery` layouts.

### 2.2 CONFIRMED + RESOLVED GAP — conflict classes are exactly two, "same timeslot"
Doc Gap #1 ("overlap rule undefined; same-room vs any-time") is resolved by the Conflicts subtitle (`agenda/12`): **"speakers or locations… shared with other sessions in the same timeslot."**
- Class 1 = **shared speaker/participant** double-booked in the same timeslot (the frame's live example, "Andrew Wu…").
- Class 2 = **shared location (room)** in the same timeslot.
- **No track-collision detection** — nothing in the frames or captions flags two same-track sessions. This contradicts **SCOPE.md req 5's "conflict detection across rooms and tracks"**: Sessionboard does rooms + speakers only. Track-collision is a **differentiator we may add**, not parity. Flag for the build.

### 2.3 CONFIRMED (with nuance) — List view is Accepted-only by default
Caption 4 + `agenda/02–04` confirm all rows are Accepted. Nuance: the **List tabs are `All Sessions / Upcoming / Past` (time-based), not status tabs**; which statuses appear at all is governed by **Agenda Settings → Session Statuses**. Default = Accepted; this event was widened to Accepted + Accept Queue + Pending (`agenda/14,17`) yet still shows only Accepted rows because that's what exists. Our doc's phrasing holds.

### 2.4 CONFIRMED — default-duration-per-format
`agenda/14,15,17` show the exact **Format → Default Duration** row UI (Lightning Talk 15/30min, Session 1h30min, Keynote 1h, Roundtable 1h) with **+ Add format**. Matches the doc and the "Lightning Talk 8:00 → auto 8:30" caption example. No change.

### 2.5 CORRECTION — in-calendar conflict marker is a red clock/circle icon, not a "red dot"
`06-agenda-embeds.md` §2b3 says conflicting sessions "show a **red dot**". `agenda/11` shows conflicting sessions rendered as **orange blocks with a red circular clock/warning icon** in the corner. Update the doc: the marker is a **red circular (clock) icon on the session block**, not a bare dot. (Icon shape Medium-confidence; that a distinct red conflict glyph exists is High.)

### 2.6 NEW — style-options surface is richer/more precise than documented
Exact toggle labels now known (`embeds/04`): *Click session or speaker to open pop-out view*, *Display schedule in browser timezone*, *Show add to calendar button*, *Search session/speaker by name*, *Order session speakers alphabetically*; and attendee **Show Filters** toggles *by format / language / level / location* (track expected below fold). This **resolves doc Gap #6 (timezone)**: there is an explicit "Display schedule in browser timezone" toggle, so the viewer-timezone behavior is a user choice, not implicit. Theme is a **Light/Dark dropdown**; Primary Color is a **hex picker** (`#1b6ec2`); Date/Time Format is a **locale dropdown**; Extra CSS is a warned free-text box.

### 2.7 NEW — embed Filters are a field/operator/value builder with a live match count
Not previously documented (`embeds/05`): the same session-filter builder as elsewhere (field ▾ / operator ▾ / value), **+ Add filter**, and a live **"N sessions and M speakers match this filter"** banner, plus the caveat **"Some embed styles will not show sessions if they do not have a start and end time defined."** Useful: unscheduled sessions silently drop out of time-based embed layouts.

### 2.8 NEW/DISCREPANCY — Get-Code loader host
The Get-Code snippet (`embeds/07`) uses **`https://api.sessionboard.com/sessionboard-{type}-embed.js`**, whereas our doc's production-asset research recorded **`https://embeds.sessionboard.com/v0/sessionboard-{type}-embed.js`**. Both may resolve (CDN alias/redirect), but the **UI-issued** host is `api.sessionboard.com`. If we mirror the snippet shape for our clone, match what the product hands users. Low stakes for our build (we generate our own snippet).

### 2.9 NEW — draft sessions are grey and gated by the Drafts toggle
`agenda/11` shows grey/faded blocks = **draft** sessions surfaced when **Drafts** is toggled on, and an unscheduled **"Draft Submission"** card without a track pill. Partially resolves doc Gap #2 (draft/publish semantics): drafts are a **session state with a dedicated agenda toggle**, distinct from status-driven public visibility. Still no explicit agenda "publish" step observed.

### 2.10 NEW — two admin UI variants; "Unassigned" room column; reciprocal conflict rows
- Embeds sit either in the **left rail** or as an **Agenda sub-tab** (both real; see header).
- Rooms view has an **"Unassigned"** column for scheduled-but-unroomed sessions (`agenda/08–10`).
- Each double-booking yields **two reciprocal Conflicts rows** (`agenda/12`) — worth replicating so users see the clash from either session.

---

## 3. Confidence grade per screen + residual unknowns

| Screen | Frames | Confidence |
|---|---|---|
| Agenda shell / view tabs | 02–04 | High |
| List view (populated, Accepted-only) | 02–04 | High |
| Day view (block + panel) | 05 | High |
| Week view + track colors + drafts | 06, 11 | High |
| Month view (no track colors) | 07 | High |
| Rooms view (+ Unassigned, zoom, timeline flip) | 08–10 | High |
| Scheduled/Unscheduled panel + card anatomy | 05,06,08,10,11 | High |
| Conflicts tab (definition, rows, Open, timestamp) | 12 | High |
| Agenda Settings (Day times / Statuses / Format→Duration / Room Visibility) | 14–17 | High |
| Embeds list + ⋯ actions | 02,08,13 | High |
| Add-Embed wizard steps 1–5 | 03–07 | High |
| Rendered public itinerary embed | 09 | High |
| Drag-to-schedule interaction | — (caption 11) | Medium (caption-only) |
| 60-min cache interval | — (caption) | Medium (caption-only) |
| In-calendar conflict marker glyph | 11 | Medium (icon small) |
| Get-Code loader host | 07 | High (but conflicts with prior asset research) |

**Residual unknowns**
1. **Exact drag mechanics** (snap-to-interval, cross-view drag, keyboard) — no frame captures a drag; caption-only.
2. **Room-clash conflict wording** — every live conflict shown is a speaker double-book; the location-clash row text is inferred from the subtitle, not seen.
3. **XML & iCal format screens** — Select Type scrolls past JSON Feed; XML/iCal panels and their Get-Code output never shown.
4. **SHOW FILTERS full list** — only format/language/level/location visible; "by track" and any others are below the fold in `04`.
5. **Grey-block semantics beyond "draft"** — grey could also mean past/out-of-window; only "draft" is confirmed by the unscheduled "Draft Submission" card + Drafts toggle.
6. **Loader-host truth** (`api.` vs `embeds.` sessionboard.com) — UI shows one, prior production research the other; not reconciled.
7. **Agenda publish step** — still none observed; public visibility looks purely status- + cache-driven.
8. **Field Options required-vs-preselected styling** — checkboxes read as plain on/off; the doc's "grey=required, blue=preselected" split isn't distinguishable in `06`.

---

## 4. Five-line summary

1. **Populated agenda:** track-colored session blocks (Academia blue/purple, Leadership green, DEI blue) across Day/Week/Rooms; **Month uses uniform blue (no track color)**; a persistent right panel splits **Scheduled vs Unscheduled** (cards = title + track pill + time + edit-pencil); Rooms view adds room columns with capacity + an **Unassigned** column; grey blocks = drafts (Drafts toggle).
2. **Conflicts:** a dedicated tab defined verbatim as **"speakers or locations shared with other sessions in the same timeslot"** — two classes only (double-booked participant / same room), **no track collisions**; each clash lists **two reciprocal rows** (Session ID · Title · human-readable Conflicts text · **Open** → editor) with an on-refresh timestamp; in-calendar clashes show a **red clock icon** (not a plain dot).
3. **Default-duration behavior confirmed:** Agenda Settings maps each **Format → Default Duration** (e.g. Lightning Talk 30min, Keynote 1h) so a start time auto-fills the end time; alongside Day Start/End Time, schedulable Session Statuses (Accepted/Accept Queue/Pending chips), and Room Visibility (show-all vs selected rooms).
4. **Embed config surface:** one **Add-Embed wizard** (Select Type → Style → Filters → Field Options → Get Code); **Format = Styled HTML / HTML / JSON / XML / iCal**, and the five *layouts* (Agenda, Session List, Schedule Itinerary, Speaker List, Speaker Gallery) are **sub-outputs of Styled HTML**, emitted as one `<sessionboard-embed … widget-type>` snippet each; style = theme, hex primary color, locale date/time, extra CSS, and toggles for pop-out/browser-tz/add-to-calendar/search/alpha-order + attendee filter controls; a field/operator/value **Filters** step with a live match count; ⋯ → **Refresh Cache** over a 60-min auto-refresh.
5. **Top corrections:** (a) embed "types" are layouts nested under Styled HTML, not top-level formats; (b) conflicts are speaker/location-same-timeslot with **no track detection** — contradicts SCOPE req 5's "across rooms **and tracks**", so track-collision is a differentiator to build, not parity; (c) conflict marker is a red clock icon, not a red dot. **Residual unknowns:** exact drag mechanics, room-clash wording, XML/iCal screens, full filter list, and the `api.` vs `embeds.` loader host.
