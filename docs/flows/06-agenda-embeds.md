# Flow 06 — Agenda Builder & Public Embeds

Sources: learn.sessionboard.com knowledge base fetched 2026-08-08 (all pages HTTP 200, server-rendered Astro/Starlight HTML — no login used), plus **production embed assets** (loader scripts at `embeds.sessionboard.com`, live example pages on sessionboard.com) and the deployed reference schedule the brief cites, `https://wf2025.ai.engineer/schedule`. Primary pages:

- Agenda (CRITICAL): https://learn.sessionboard.com/sessions/agenda
- Program settings (rooms/tracks/agenda settings): https://learn.sessionboard.com/sessions/session-settings
- Embeds (CRITICAL): https://learn.sessionboard.com/sessions/embeds
- Subsessions: https://learn.sessionboard.com/sessions/create-a-subsession · https://learn.sessionboard.com/sessions/converting-a-session-to-a-subsession · https://learn.sessionboard.com/sessions/reverting-a-subsession-back-to-a-parent-session · https://learn.sessionboard.com/sessions/viewing-subsessions-within-the-agenda
- Program site: https://learn.sessionboard.com/site/program-site · Print agendas: https://learn.sessionboard.com/marketing/print-agendas
- Tutorial videos (Guidde embeds, transcripts on-page): https://learn.sessionboard.com/videos/video-agenda-building · https://learn.sessionboard.com/videos/video-embeds
- Verified embed mechanics (fetched 2026-08-08): https://www.sessionboard.com/embeds/sessions-list-1 · https://www.sessionboard.com/embeds/embed-speaker-gallery · https://www.sessionboard.com/embeds/speakers-list-1 and the five loader bundles under `https://embeds.sessionboard.com/v0/`

Cross-reference: demo walkthrough Part F (8:17 "agenda + embeds") in `00-demo-walkthrough.md` — frames `f_083` (agenda views + Add Session), `f_087`–`f_091` (embed editor + live preview).

---

## 1. Purpose & actors

The **agenda** is where accepted submissions become a scheduled program: admins drag sessions onto dates/times/rooms across five calendar-style views, with automatic conflict detection for overlaps and double-booked people (https://learn.sessionboard.com/sessions/agenda). **Embeds** are the public output: auto-refreshing feeds of the agenda, sessions, and speakers that organizers paste into their own event website — "no manual sync or push required" — as styled HTML (a JS widget), basic HTML, JSON, XML, or iCal (https://learn.sessionboard.com/sessions/embeds).

Actors:
- **Admin / event team** — configures agenda settings, schedules sessions, resolves conflicts, creates embeds and hands the code to the web team (https://learn.sessionboard.com/sessions/agenda, https://learn.sessionboard.com/sessions/embeds).
- **Web team / developer** — pastes the one-line script (styled HTML) or consumes HTML/JSON/XML/iCal output (https://learn.sessionboard.com/sessions/embeds).
- **Attendee (public)** — browses the embedded schedule/speakers on the event website, searches, filters by format/track, adds sessions to their calendar (https://learn.sessionboard.com/videos/video-embeds).
- **Speakers/chairpersons/moderators** — the participants whose double-booking the conflict detector flags (https://learn.sessionboard.com/sessions/agenda).

## 2. Flows

### 2a. Scheduling: getting sessions onto the agenda

1. **Prerequisite — configure Program Settings** (recommended before scheduling: "we recommend beginning with configuring your agenda settings before scheduling sessions", https://learn.sessionboard.com/videos/video-agenda-building). Agenda settings live at **Sessions → Settings → Agenda** (https://learn.sessionboard.com/sessions/agenda); the settings page itself is titled "Program Settings" with tabs Overview / Agenda / Personas / Rooms / Tracks / Tags / Levels / Formats / Languages / Files / Roles / Statuses (screenshot `agenda-settings.png`, source https://learn.sessionboard.com/sessions/session-settings). The Agenda tab holds:
   - **Day Start Time / Day End Time** — earliest and latest times sessions can be scheduled each event day (https://learn.sessionboard.com/sessions/session-settings).
   - **Interval** — timeline granularity (e.g. 30 min; visible in `agenda-settings.png`, not described in KB text).
   - **Agenda content** — radio: Sessions (non-abstract program items) / Abstracts / Both (visible in `agenda-settings.png`).
   - **Program Statuses** — status chips (e.g. Accepted, Accept Queue, Pending) that "appear on the public agenda"; lets teams schedule sessions beyond just Accepted (https://learn.sessionboard.com/sessions/session-settings, `agenda-settings.png`).
   - **Session Format & Default Duration** — per-format preset length; scheduling a 30-min-default "Lightning Talk" at 8:00 auto-sets end 8:30 (https://learn.sessionboard.com/videos/video-agenda-building).
   - **Room Visibility** — which rooms show when scheduling in Rooms view, for events with many rooms (https://learn.sessionboard.com/sessions/session-settings).
2. **Rooms are defined in Program Settings → Rooms** ("Add and edit rooms in Session Settings", https://learn.sessionboard.com/sessions/agenda). Each room has **Name**, **Order** (controls left-to-right ordering in the agenda embed, ascending; ties or missing values fall back to alphabetical), **Capacity** (shown in the admin agenda view but *not* in embeds); limit 100,000 rooms; the list shows a Uses count and an Add dropdown with "Add Room" / "Copy from…" another event (https://learn.sessionboard.com/sessions/session-settings, `rooms-settings.png`). **Tracks** (with a color that "will also be reflected in the admin agenda view as well as the embeds"), Tags, Levels, Formats, Languages, Statuses are defined in sibling tabs; Rooms/Track/Level/Format/Language are single-select per session, Tags multi-select (https://learn.sessionboard.com/sessions/session-settings).
3. **Open the agenda**: Sessions → Agenda. By default **only submissions with an Accepted status appear**; Agenda Settings can include additional statuses (https://learn.sessionboard.com/sessions/agenda).
4. **Scheduled vs unscheduled panel**: on the right side of any view, sessions are grouped into **Scheduled** (have an assigned date and time) and **Unscheduled** (no date/time) (https://learn.sessionboard.com/videos/video-agenda-building). So an accepted-but-unplaced session sits in the Unscheduled list until dragged in.
5. **Scheduling is drag-and-drop**: "Drag and drop accepted sessions to assign dates, times, or rooms depending on the view" (https://learn.sessionboard.com/sessions/agenda); "to schedule an unscheduled session, click and drag the session to your desired date and time" (https://learn.sessionboard.com/videos/video-agenda-building). Clicking a session card opens its details for adjustments (same video) — i.e. times can also be edited via the session editor form, and the demo shows an **Add Session** button on the agenda toolbar (`00-demo-walkthrough.md` F1, `f_083`).

### 2b. Conflict detection

Exactly what Sessionboard documents (https://learn.sessionboard.com/sessions/agenda):

1. **What is detected** — two classes only:
   - **Overlapping sessions** ("the conflicts page helps you quickly identify overlapping sessions", https://learn.sessionboard.com/videos/video-agenda-building). The KB does **not** state whether this means any time overlap or only same-room overlap — see Gaps.
   - **Double-booked participants**: speakers, chairpersons, moderators booked into two sessions at once (https://learn.sessionboard.com/sessions/agenda).
   - Track collisions are **not** mentioned anywhere — no evidence Sessionboard flags two same-track sessions at the same time.
2. **Where surfaced** — a dedicated **Conflicts** tab: Sessions → Agenda → Conflicts lists each conflict with an **Open** button that "launches the session editor" to resolve it (https://learn.sessionboard.com/sessions/agenda, https://learn.sessionboard.com/videos/video-agenda-building).
3. **In-calendar marker** — "Sessions with conflicts show a **red dot** in the agenda view" (https://learn.sessionboard.com/sessions/agenda).
4. **Recomputation** — not live: "Conflicts update on page refresh" (https://learn.sessionboard.com/sessions/agenda); "conflicts are automatically updated when the page is refreshed" (https://learn.sessionboard.com/videos/video-agenda-building).

### 2c. Views

Five layouts (https://learn.sessionboard.com/sessions/agenda, https://learn.sessionboard.com/videos/video-agenda-building):

| View | Shows |
|---|---|
| **List** (default) | Sessions in a table |
| **Day** | Hourly timeline for a single day |
| **Week** | Seven-day calendar |
| **Month** | Full-month calendar layout |
| **Rooms** | Sessions organized by room assignment |

- **Track colors** color session blocks in Day, Week, and Rooms views; **not** in Month view (https://learn.sessionboard.com/sessions/agenda).
- **Rooms view extras**: zoom out to see all rooms without scrolling; a **timeline icon** flips the layout to put rooms on the x-axis (https://learn.sessionboard.com/sessions/agenda). Room set shown is governed by the Room Visibility setting (https://learn.sessionboard.com/sessions/session-settings).
- **Draft vs published semantics**: the KB documents **no publish step** for the agenda. The closest notions are (1) the Program Statuses setting choosing which statuses "appear on the public agenda" (`agenda-settings.png`), (2) embeds showing "approved sessions" (https://learn.sessionboard.com/sessions/embeds), and (3) the embed cache refreshing every 60 minutes. `00-demo-walkthrough.md` F1 mentions "drafts" on the agenda screen, but no KB page describes a draft agenda state — see Gaps.

### 2d. Embeds

**Five embed types** (https://learn.sessionboard.com/sessions/embeds):

| Type | What it shows |
|---|---|
| **Schedule itinerary** | Searchable sessions with multiple filters; prominent speaker headshots and bios |
| **Speaker gallery** | Speakers alphabetically by last name, with headshots and details |
| **Agenda** | Approved sessions in a grid by location and time |
| **Session list** | Sessions with speakers, filterable by format, language, tag, track, location |
| **Speaker list** | Speakers with their sessions and info |

Search scope varies: itinerary & session list match session titles **and** speaker names; speaker gallery & list match speaker names only; descriptions, tags, levels, audience, and custom fields are excluded from search (https://learn.sessionboard.com/sessions/embeds).

**Creation flow** (https://learn.sessionboard.com/sessions/embeds; video places the same UI as an **Embeds tab on the agenda page**, https://learn.sessionboard.com/videos/video-embeds):

1. Deliver module → **Embeds** → **Add Embed**; enter an internal name. Multiple embeds per event are supported, e.g. one embed per track for different site pages (https://learn.sessionboard.com/videos/video-embeds).
2. **Choose a format**:
   - **Embed Styled HTML** — "one line of JavaScript" for an interactive agenda/session/speaker list;
   - **Embed HTML** — raw HTML for developers to restyle;
   - **JSON / XML** — expanded properties for apps or databases;
   - **iCal** — a calendar link with all approved sessions as events (https://learn.sessionboard.com/sessions/embeds).
3. **Style & filter** (Styled/HTML only): display options, colors, optional custom CSS; then filters such as specific tracks or statuses (https://learn.sessionboard.com/sessions/embeds). The video enumerates: light/dark **theme**, **primary color**, **date & time format**, attendee-facing **filter controls** (by format or track), and an **add-to-calendar** toggle (https://learn.sessionboard.com/videos/video-embeds).
4. **Select fields** per card column — **Agenda** (fields shown when clicking a session card in the agenda embed), **Speaker** (fields on each speaker card), **Session** (fields when clicking a session card in itinerary/session-list embeds). Grey fields are required; blue fields are preselected but customizable (https://learn.sessionboard.com/sessions/embeds, https://learn.sessionboard.com/videos/video-embeds).
5. **Save** → retrieve the embed code; **Preview** opens it in a new window (https://learn.sessionboard.com/sessions/embeds).
6. **Updates**: embeds auto-update **every 60 minutes**; for faster updates use Embeds → ⋯ → **Refresh Cache**. **Edit** (⋯ → Edit) can change styling and fields but **not the data type** — a type change requires a new embed (https://learn.sessionboard.com/sessions/embeds).

**How the embed code actually works** — verified against production assets on 2026-08-08 (not documented in the KB):

- The "one line of JavaScript" is a per-type loader from `https://embeds.sessionboard.com/v0/`; five bundles exist (each a ~230–260 KB self-contained React app): `sessionboard-agenda-embed.js`, `sessionboard-schedule-embed.js`, `sessionboard-session-embed.js`, `sessionboard-speaker-embed.js`, `sessionboard-speaker-gallery-embed.js` (observed on https://www.sessionboard.com/embeds/sessions-list-1, /embeds/embed-speaker-gallery, /embeds/speakers-list-1; agenda & schedule bundle URLs confirmed HTTP 200).
- **It is not an iframe.** Each bundle registers a **web component** `customElements.define("sessionboard-embed", …)` that attaches an **open shadow DOM** and renders React inside the host page. Usage observed verbatim on Sessionboard's own example pages:
  ```html
  <script src="https://embeds.sessionboard.com/v0/sessionboard-session-embed.js"></script>
  <sessionboard-embed embed-id="da52f88f-71c0-4ecf-903a-7c7aba35269f" widget-type="session"></sessionboard-embed>
  ```
  The `widget-type` enum inside every bundle is `{AGENDA:"agenda", SCHEDULE:"schedule", SESSIONS:"session", SPEAKERS:"speaker", SPEAKERS_GALLERY:"speaker-gallery"}`; missing/invalid `embed-id` or `widget-type` renders an error (loader source).
- **Data fetch**: the component calls `GET https://api.sessionboard.com/embed/v2/{embed-id}/async-data?dataType={widget-type}&tz={IANA timezone from the visitor's browser}&ran={timestamp}` (cache-busting `ran`), so the embed re-fetches fresh (server-cached) JSON on every page load — this is the "auto-update, no push" mechanism, with the 60-minute server cache from the KB on top.
- **Config travels in the payload**: keys observed in the bundles include `theme`, `primaryColor`, `showSearch`, `show_add_to_calendar`, and `extraCss` (custom CSS injected as a `<style>` tag), plus per-embed visible-field lists. Theming is exposed as CSS custom properties on `:host` (`--color-primary: #1e62d8`, `--color-primary-hover`, `--color-text-primary`, …), so host pages can also override via CSS.
- **URL parameters (deep links)**: the widget reads the **host page's** query string — `?sb-speaker-id=` (speaker & speaker-gallery bundles) and `?sb-session-id=` / `?sb-session-ids=` (session, schedule, agenda bundles) — to open the corresponding detail modal on load (loader source; matches the `?sb-speaker-id=` observed in the brief).
- **Filter option keys** in the bundles: `filter_session_by_format`, `_language`, `_level`, `_track`, `_tags`, `_location`, `_description`. Default session-card fields: `title, description, date, location, speakers, starts_at, ends_at, created_at, ceu_credits`; speaker-card fields: `full_name, about, photo, title, company`; participant roles rendered: speaker, chairperson, moderator (loader source).
- **What the rendered embeds look like**: schedule itinerary = day chips → time-group headers → session cards with colored track pill, time range + room, speaker rows (headshot, linked name, title, company), "Powered by Sessionboard" footer; speaker gallery = event-name header bar, search box, paginated headshot grid (`embed-schedule-itinerary.png`, `embed-speaker-gallery.png`, source https://www.sessionboard.com/blog/sessionboard-introduces-embeddable-speaker-gallery-schedule-itinerary-for-event-websites). Session detail modals include an **Add to Calendar** button, CEU credit hours, and a **Subsessions (n)** tab (`subsessions-in-embed.png`, https://learn.sessionboard.com/sessions/create-a-subsession).

**Adjacent public outputs** (context, not embeds):
- **Program Site** (Enterprise Abstract Management add-on) is a hosted hub at `https://sites.sessionboard.com/s/[slug]` centralizing CFP/submission/awards forms and reviewer access with branding, custom pages, SSO login, 5+ languages, WCAG 2.1+ — it is a submitter/reviewer hub, **not** the attendee-facing schedule (https://learn.sessionboard.com/site/program-site).
- **Print agendas** (Early Access, Program → Print): generates printable documents from event data — six templates (Program Book, Daily Schedule Sheet, Session Handout, Speaker View, Awards Program, Sponsorship Guide), AI-drafted copy, PDF / Large Book PDF / Markdown export, and a public share link that always shows the latest published version (https://learn.sessionboard.com/marketing/print-agendas).

### 2e. Subsessions (parent/child model)

1. **Model**: a **parent session** "appears on your agenda [and] acts as the overarching container"; a **subsession** happens within the parent's timeframe (e.g. full-day workshop → individual presentations). Subsessions have their own titles, speakers, and details (https://learn.sessionboard.com/sessions/create-a-subsession).
2. **Hard rules**:
   - Subsession date/time **must fall within** the parent's date/time (https://learn.sessionboard.com/sessions/create-a-subsession).
   - **Speakers are linked upward**: adding a speaker to a subsession also adds them to the parent (same page).
   - Moderators, chairpersons, sponsors, exhibitors attach to **parent sessions only** (same page, FAQ).
   - Limit: **200 subsessions** per event admin (same page).
   - Ordering: chronological within the parent; same-time ties order alphabetically by title (same page, FAQ).
   - **Integrations do not sync subsessions**; they are exposed via Sessionboard's open API (same page, FAQ).
3. **Create from scratch**: Sessions module → pencil icon on the session → **Connections** tab → **Create subsession** → fill name, time, format, description, speakers → **Create Session** (https://learn.sessionboard.com/sessions/create-a-subsession; `create-subsession-button.png`, `subsession-form.png`).
4. **Convert an existing session**: pencil on the intended parent → **Subsessions** page → **Convert Sessions** → pick session(s) → Confirm → review → **Save**. On save the converted subsession **takes on the parent's date and time**; it can then be re-timed within the parent window (https://learn.sessionboard.com/sessions/converting-a-session-to-a-subsession; `convert-sessions-button.png`).
5. **Revert**: parent → Subsessions tab → ellipsis next to the subsession → **Unlink** → confirm warning; it becomes a standalone session again (https://learn.sessionboard.com/sessions/reverting-a-subsession-back-to-a-parent-session; `unlink-subsession.png`).
6. **In the agenda**: parents with subsessions carry an **icon** on their card; hovering shows a summary of the parent with its subsessions; **dragging the parent keeps subsessions inside the parent's interval** (https://learn.sessionboard.com/sessions/viewing-subsessions-within-the-agenda; `agenda-subsession-icon.png`, `agenda-subsession-hover.png`).
7. **In embeds**: subsessions are visible — the session modal grows a "Subsessions (n)" tab (https://learn.sessionboard.com/sessions/create-a-subsession; `subsessions-in-embed.png`).

### 2f. Reference target: wf2025.ai.engineer/schedule (what buyers use today)

Fetched 2026-08-08. Important caveat: this page is powered by **Sessionize, not Sessionboard** (the page itself says "the Sessionize schedule is the most up to date source of truth") — the brief cites it as the UX target for our public schedule, not as a Sessionboard artifact. Structure (static Next.js export, page `/schedule`; all facts from the fetched HTML and its JS chunks `pages/schedule-*.js`, `828-*.js`):

1. **Header block**: title "World's Fair 2025 Schedule", venue card (SF Marriott Marquis, June 3–5 2025, per-floor room notes, Google Maps + floor-plan links).
2. **Machine-readable exports offered inline**: iCal link (`https://sessionize.com/api/v2/e70d4iqk/view/All`), curated JSON (`https://ai.engineer/sessions-speakers-details.json`), raw sessions JSON (`https://sessionize.com/api/v2/w3hd2z8a/view/All`), speakers JSON (`…/view/Speakers`) — explicitly published "for hackers… for your own vibecoded view", plus links to four community-built schedule apps.
3. **Grid view**: a full-width, 90vh **iframe** of Sessionize's hosted **GridSmart** view (`https://sessionize.com/api/v2/hyxh7ov6/view/GridSmart`) — rooms-by-time grid with day switching, sandboxed `allow-scripts allow-same-origin`.
4. **List View** (custom React, below the grid): client-side fetch of the Sessionize "All" JSON; joins `sessions`×`speakers`×`rooms`; derives a track per session (bundled static session→track mapping, with fallbacks: room name containing "keynote" → Keynote, `isServiceSession` → Service, room containing "workshop" → Workshop, else General Session); sorts chronologically and groups by date. UI:
   - **Sticky day-tab bar**: one anchor tab per date (all days render on one page; tabs scroll to `#<date>` sections and underline the active day).
   - **Track filter** `<select>` writing `?filter=<track>` into the URL (shareable filtered links); "show plenary" and **Expand All** toggles persisted in localStorage.
   - **Session rows** (collapsed): start time, speaker name / company pairs, title, track name colored from a hardcoded 11-track color map (Keynote #F9512D, Agents #F87B45, Multimodality #4285F4, …); hover reveals Room + markdown description; a "Video Available" indicator when `recordingUrl` exists.
   - **Expanded card** (click): time range, track, room, speaker headshots + taglines/companies, full description, close button; every session has a slug anchor (`/schedule#<session-slug>`) for deep links.
   - **No separate speaker or session pages** on this route — session detail is the expanded row; speakers live on the homepage `/#speakers` section.

Takeaway for the clone: the buyer-visible bar is "day tabs + track filter + colored track pills + expandable session cards + iCal/JSON exports + deep-linkable sessions" — everything Sessionboard's agenda/schedule embeds provide via `widget-type="agenda"|"schedule"` plus `?sb-session-id=` deep links, minus the raw-JSON links which map to Sessionboard's JSON/XML/iCal embed formats.

## 3. Inventory

**Agenda page controls** (https://learn.sessionboard.com/sessions/agenda, https://learn.sessionboard.com/videos/video-agenda-building, demo `f_083`):
- View tabs: **List · Day · Week · Month · Rooms**; plus **Conflicts** tab and **Embeds** tab on the same page.
- Right-hand panel: **Scheduled / Unscheduled** session lists (drag source).
- **Add Session** button (demo video frame `f_083`; not in KB text).
- Rooms view: **zoom-out** control, **timeline icon** (rooms on x-axis).
- Conflict affordances: red dot on session cards; Conflicts list with per-row **Open**.
- Session card click → session editor.

**Program Settings inventory** (https://learn.sessionboard.com/sessions/session-settings, `agenda-settings.png`, `rooms-settings.png`):
- Agenda tab: Day Start Time, Day End Time, Interval, Agenda content (Sessions/Abstracts/Both), Program Statuses (multi-chip), per-Format Default Duration, Room Visibility, Save Changes.
- Rooms tab: search, table (Name / Capacity / Uses / ⋯), Add → Add Room | Copy from…; room fields Name, Order (drives embed room ordering), Capacity (admin-only display), max 100,000.
- Tracks tab: name + **color** (colors admin agenda + embeds). Tags (multi-select), Levels, Formats, Languages, Roles, Statuses tabs alongside.

**Embed configuration options** (https://learn.sessionboard.com/sessions/embeds, https://learn.sessionboard.com/videos/video-embeds, loader bundles):
- Types: Schedule Itinerary · Speaker Gallery · Agenda · Session List · Speaker List (`widget-type`: `schedule` · `speaker-gallery` · `agenda` · `session` · `speaker`).
- Output formats: Embed Styled HTML (JS widget) · Embed HTML · JSON · XML · iCal.
- Style: theme (light/dark), primary color, date & time format, custom CSS (`extraCss`), search toggle (`showSearch`), add-to-calendar toggle (`show_add_to_calendar`); CSS vars `--color-primary` etc. on `:host`.
- Admin-side filters: tracks, statuses "such as" (KB) — attendee-side filter controls by format/track (video); bundle filter keys: format, language, level, track, tags, location, description.
- Field pickers per column: Agenda / Speaker / Session cards; grey = required, blue = preselected; default session fields `title, description, date, location, speakers, starts_at, ends_at, created_at, ceu_credits`; speaker fields `full_name, about, photo, title, company`.
- Row actions: Preview, ⋯ → Edit (style/fields only, never data type), ⋯ → Refresh Cache; 60-minute auto-refresh.
- Deep-link params on the host page: `?sb-speaker-id=`, `?sb-session-id=`, `?sb-session-ids=`.
- Data endpoint: `GET https://api.sessionboard.com/embed/v2/{embed-id}/async-data?dataType={type}&tz={viewer-IANA-tz}&ran={ts}`.

## 4. Screenshots

All in `img/06-agenda-embeds/`, downloaded 2026-08-08 and verified as PNG with `file`. The two CRITICAL KB pages (agenda, embeds) ship **zero screenshots**, so visuals come from the Program-settings page, the subsession pages, and Sessionboard's blog.

| File | Caption | Source |
|---|---|---|
| `agenda-settings.png` | Program Settings → Agenda: Day Start/End, Interval, Agenda content (Sessions/Abstracts/Both), Program Statuses chips ("appear on the public agenda") | https://learn.sessionboard.com/images/kb/227088a2-image-png-Jul-08-2026-06-25-01-3717-PM.png (from /sessions/session-settings) |
| `rooms-settings.png` | Program Settings → Rooms: Name/Capacity/Uses table, Add Room / Copy from… | https://learn.sessionboard.com/images/kb/d5bdf4ba-image-png-Jul-08-2026-06-33-13-6576-PM.png (from /sessions/session-settings) |
| `tracks-settings.png` | Tracks with per-track color (colors agenda views + embeds) | https://learn.sessionboard.com/images/kb/67280e9c-image-png-Feb-25-2026-03-12-44-8691-PM.png (from /sessions/session-settings) |
| `agenda-subsession-icon.png` | Parent session card in the agenda with subsession icon | https://learn.sessionboard.com/images/kb/98026d36-image-png-Feb-25-2026-07-07-15-6125-PM.png (from /sessions/viewing-subsessions-within-the-agenda) |
| `agenda-subsession-hover.png` | Hover summary: parent + its subsessions | https://learn.sessionboard.com/images/kb/d2b8e4ea-image-png-Feb-25-2026-07-07-38-6504-PM.png (same page) |
| `create-subsession-button.png` | Session editor → Connections tab → Create subsession | https://learn.sessionboard.com/images/kb/60973689-image-png-Jul-07-2026-03-11-34-9733-PM.png (from /sessions/create-a-subsession) |
| `subsession-form.png` | Subsession form: name, time, format, description, speakers | https://learn.sessionboard.com/images/kb/11d049c7-image-png-Jul-07-2026-03-12-03-2368-PM.png (same page) |
| `subsessions-in-embed.png` | Embed session modal with "Subsessions (1)" tab, Add to Calendar, CEU hours | https://learn.sessionboard.com/images/kb/608daa99-image-png-Jul-07-2026-03-15-08-2715-PM.png (same page) |
| `convert-sessions-button.png` | Convert Sessions button on the parent's Subsessions page | https://learn.sessionboard.com/images/kb/87b3d70d-image-png-Feb-09-2026-08-27-19-3397-PM.png (from /sessions/converting-a-session-to-a-subsession) |
| `unlink-subsession.png` | Ellipsis → Unlink to revert a subsession | https://learn.sessionboard.com/images/kb/fe7072db-image-png-Jan-30-2026-08-44-24-0869-PM.png (from /sessions/reverting-a-subsession-back-to-a-parent-session) |
| `embed-schedule-itinerary.png` | Rendered Schedule Itinerary embed: day chip, time groups, track pills, speaker rows, Powered-by footer | https://cdn.prod.website-files.com/627d5c68d5739680264cfd2c/64d50478d991b85a8e7d11f8_About.png (from sessionboard.com blog post on embeds) |
| `embed-speaker-gallery.png` | Rendered Speaker Gallery embed: search, pagination, headshot grid | https://cdn.prod.website-files.com/627d5c68d5739680264cfd2c/64d5046472aa042c9957929a_3.png (same blog post) |

Admin agenda views and the embed editor have no KB screenshots; use demo-video frames `f_083`, `f_087`–`f_091` (`../reference/video-frames/`) as the visual reference for those.

## 5. Gaps

1. **Exact session-overlap rule undefined.** "Overlapping sessions" (https://learn.sessionboard.com/sessions/agenda) never specifies same-room-overlap vs any-time-overlap. For the clone, room overlap + participant double-booking is the sensible reading, but it is unverified. Track collisions are not mentioned → assume not detected.
2. **No draft/publish semantics documented.** No KB page describes publishing the agenda; public visibility appears to be status-driven (Program Statuses → "appear on the public agenda") + the 60-min embed cache. Demo F1 mentions "drafts" on the agenda screen — unresolved; check the demo video frames.
3. **Agenda/Embeds KB pages have zero screenshots**, so List/Day/Week/Month/Rooms visuals, the Conflicts tab, and the embed editor UI are only available via the tutorial videos (Guidde players `https://embed.app.guidde.com/playbooks/vh4SAkH4xhNe3U3jxXwqhz` and `…/sJuU3xz5JGraG1huVJzEai`, not frame-extracted here) and demo frames f_083–f_091.
4. **Non-styled formats unverified**: the URL/shape of the basic-HTML, JSON, XML, and iCal embed outputs is not shown in the KB and no public example was found (only the styled-HTML web-component path was verified end-to-end).
5. **`widget-type="schedule"` ↔ "Schedule Itinerary" mapping is inferred** from the enum + bundle name (`sessionboard-schedule-embed.js`); the admin UI label-to-type mapping wasn't directly observed.
6. **Timezone handling**: embeds send the viewer's browser IANA timezone (`tz=` param); whether the server localizes times to viewer vs event timezone is unverified.
7. **"Add Session" from the agenda** (demo f_083) and List-view columns/sorting are undocumented in the KB.
8. **Location vs Room in embeds**: embed filters use `location` where the agenda uses Rooms — likely the same field, unconfirmed.
9. **AI agenda builder** exists as a sibling feature (https://learn.sessionboard.com/studio/ai-agenda-builder, next-page link from the agenda KB page) — out of scope here, not researched.
10. The wf2025 reference is **Sessionize-based**; nothing on it exercises Sessionboard's `?sb-*` params. The `?sb-speaker-id=` behavior was verified from the loader source, not from a live buyer site.
