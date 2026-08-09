# Public & Embeddable Widgets — feature reference

## What this is

This documents SessionBoard's public/embeddable widgets — the target behavior a clone must reproduce. SessionBoard's CMS/embeds area (admin: Deliver > Embeds) lets organizers publish live, self-updating event content into any website. The organizer picks one of **five widget types** — List of Sessions, List of Speakers, Agenda, Schedule Itinerary, Speaker Gallery — chooses an output format (styled HTML delivered as a single JS script tag rendering a shadow-DOM web component; basic HTML; JSON; XML; iCal), selects which fields appear on cards, sets colors/custom CSS, and applies content filters (tracks, statuses). The public widget renders the event's approved sessions/speakers to anonymous visitors with an event-title header, keyword search, faceted filters (Format/Track/Location), truncated descriptions with Show more, and drill-down detail views. Data auto-refreshes from SessionBoard roughly every 60 minutes, with a manual cache refresh — no republish needed. Search scope per the KB: itinerary and session list match session titles and speaker names; speaker gallery/list match speaker names only. Personal-schedule building (favoriting) is **not visible** in SessionBoard's live itinerary embed and is **(inferred)** from the widget's name and category norms (Sessionize favorites, Cvent personal agendas).

In sbek, clones are exercised against the fixture event **DevFlow Conf 2027** (2027-05-12..14, Moscone West SF; tracks AI Engineering / Platform & Infra / Developer Experience; formats Keynote 45m, Talk 30m, Lightning 10m, Workshop 120m, Panel 45m; rooms Main Stage, Room 2A, Room 2B, Workshop Lab). The filled-state descriptions below come from SessionBoard's own live example event ("2026 HINOMA Research Annual Conference") and describe what each screen should look like once populated.

## Personas & user journeys

Personas from research: event organizer/marketer (creates, brands, and filters embeds), attendee/event-site visitor (browses, searches, filters, plans a day), web developer/webmaster (pastes the script tag or consumes basic HTML / JSON / XML / iCal feeds), and speaker (indirect: verifies their public profile and session listings render correctly).

### 1. Browse the session catalog (Attendee)

Steps:
1. Open the event-site page containing the Sessions List embed
2. Scan cards; note the result count (e.g. "1 - 22 of 22")
3. Type a keyword in "Search by speaker details or session title"
4. Open Filters; check Track=DEI; the list narrows
5. Click Show more on a card to expand the full description
6. Read date/time, room, speakers (name/title/company), Format and Track tags

Filled state: Header "2026 HINOMA Research Annual Conference"; "Sessions 1 - 22 of 22"; search box + Filters button; vertical card list, each card: bold title, 2-3 line truncated abstract + Show more, "Friday, December 15: 04:00 PM - 05:00 PM", "Room 305", Speakers block (Joshua Abu-Shiraz / Associate Professor / Manitoba State Tech), chips "Format: Session", "Track: DEI".

### 2. Plan the day with the Schedule Itinerary (Attendee)

Steps:
1. Open the itinerary embed page
2. Switch day tabs (Thursday, December 14 / Friday, December 15)
3. Scroll the chronological list grouped under time headers (09:00 AM, 10:00 AM, ...)
4. Search by keyword or filter by track
5. Click View Details on a session to expand inline subsessions (own times + speakers); toggle Hide Details
6. (inferred) Star/add sessions to build a personal "my schedule" view

Filled state: "Itinerary" heading, search box, Filters button, two day-tab buttons; under "09:00 AM": card with track chip "Leadership", title "GRADFair: A Career Fair for Graduate Students and Postdocs", truncated abstract + Show more, "Thursday, December 14: 09:00 AM - 10:00 AM", "Room 307", 8 speakers with titles/companies, "FORMAT: Roundtable / TRACK: Leadership", View Details button; the expanded detail shows subsessions "Icebreakers 09:00-09:15", "Mingle and Connect", "Closing Remarks" with sub-speakers; a break item "Lunch" renders with no speakers.

### 3. Explore speakers via the gallery (Attendee)

Steps:
1. Open the Speaker Gallery embed page
2. Scan the photo grid, alphabetical by surname
3. Type a name in "Search speaker by name"
4. Click a speaker card
5. In the detail modal read the bio (Show more), Company Name, and "Sessions (2)" with date/time + room per session
6. Click Back / Close modal to return to the grid

Filled state: "Speakers" heading + name search; grid of 14 cards each with headshot, name, job title, company (one speaker intentionally missing photo/title to show fallback); detail view: "Back", photo, "Vika Nabila Bajaj Singh", "Co-founder and CEO", truncated bio + Show more, "Company Name: Agenea Sciences and SkinScan", "Sessions (2)" listing titles with "Friday, December 15: 01:00 PM - 02:00 PM / Room 306".

### 4. View the room-by-time agenda grid (Attendee)

Steps:
1. Open the Agenda embed page
2. See one day's grid: location columns x time rows
3. Use the day nav arrow (chevron) to switch days
4. Click a session block
5. The detail view shows the full time range, room, description, Format, Track, and Subsessions (N) tabs
6. Click Back to return to the grid

Filled state: Header + "Thu, December 14, 2023"; columns Room 305/306/307; time gutter 8:00 AM-6:00 PM; blocks placed at their slot showing track label ("Academia"), title ("Funding Graduate Student Internships"), room, optional speaker-count badge; detail: "Back", title, "Thursday, December 14: 01:30 PM - 02:30 PM", "Room 305", tabs "Session Details / Subsessions (0)", description + Show more, "Format: Roundtable", "Track: Academia".

### 5. Publish embeds to the event website (Organizer)

Steps:
1. In admin go to Deliver module > Embeds
2. Click Add Embed; choose the widget type (one of the 5) and output format (styled HTML / basic HTML / JSON / XML / iCal)
3. Configure display options, colors, optional custom CSS
4. Apply content filters (specific tracks, session statuses)
5. Pick fields for agenda/speaker/session cards (required fields locked, defaults preselected but editable)
6. Save; copy the embed code (styled HTML = single JS script line); preview in a new window
7. Paste into the website; the widget auto-refreshes ~every 60 min; trigger a manual cache refresh for faster updates

Filled state: Embeds list screen with existing embeds; builder with format picker, color/CSS inputs, filter selectors, field checkboxes (grey=required, blue=preselected); code snippet output like `<script src='https://embeds.sessionboard.com/v0/sessionboard-session-embed.js'>` + `<sessionboard-embed embed-id='...' widget-type='session'>`. (Organizer-side builder UI is documented from KB prose only, not observed live — screens are inferred.)

### 6. Speakers List variant (Attendee)

The List of Speakers embed (distinct from the gallery) is a directory that pairs each speaker with their sessions inline. Filled state: event header; "Speakers" heading with count "1 - 14 of 14"; search input; per-speaker entry: circular headshot, clickable name, job title, company, truncated bio + Show more; beneath, that speaker's sessions each showing clickable title, "Thursday, December 14: 10:00 AM - 11:00 AM", room, and "Roles: speaker". Speakers with missing photo/title/company render gracefully with fallbacks.

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| List of Sessions embed | Yes | Embeddable session-catalog widget showing all approved sessions with keyword search (matches session titles AND speaker names), faceted Filters panel (Format, Track, Location), result count, and expandable descriptions. The catalog view vs the date/time-focused agenda. Data pulls live and auto-refreshes (~60 min). | Event-name header; "Sessions" heading with range count; search input; Filters button opening checkbox facets Format/Track/Location with an X to close. Card list: title; truncated abstract + Show more; full date/time line; room; Speakers block (name, job title, company); Format/Track chips. Filter/search updates list and count in place. |
| List of Speakers embed | Yes | Embeddable speaker directory pairing each speaker with their sessions. Sorted alphabetically by surname; search narrows by speaker name (KB: name-only matching, though the placeholder reads "Search speakers and sessions"). Sessions listed under each profile click through to session detail. | Event header; "Speakers" heading with count; search input. Per-speaker entry: circular headshot, clickable name, job title, company, truncated bio + Show more; that speaker's sessions with title, date/time, room, "Roles: speaker". Graceful fallbacks for missing photo/title/company. |
| Agenda embed (grid by location and time) | Yes | Embeddable calendar-grid of approved sessions organized by location (columns) and time-of-day (rows), one day at a time, with day navigation and a per-session detail including subsessions. The "date and time focused view" alternative to the sessions list. | Event header; day label with prev/next chevrons; room column headers; left time gutter; blocks at their slot showing track label, title, room, optional speaker-count badge; non-session items like "Lunch" as blocks. Block click opens detail: Back, title, full time range, room, "Session Details" / "Subsessions (N)" tabs, description + Show more, Format, Track. |
| Schedule Itinerary embed | Yes | Embeddable chronological itinerary: sessions by day in time order with day tabs, keyword search (titles + speaker names), track/format/location filters, rich cards with full speaker lists, and inline View Details expansion showing timed subsessions. Personal schedule building — starring/adding to a saved "my schedule" and exporting — is not visible in SessionBoard's live example and is a category-norm extension **(inferred)**. | "Itinerary" heading; search; Filters; day tabs; time-group headers. Card: track chip, title, truncated description + Show more, full date/time, room with map-pin icon, complete speaker list (name/title/company, up to 8), FORMAT/TRACK rows, View Details expanding inline subsessions and toggling to Hide Details. Breaks render speaker-less. (inferred) star/add-to-schedule control per card plus a personal-schedule view and iCal/add-to-calendar export. |
| Speaker Gallery embed | Yes | Embeddable photo-grid gallery of speakers, alphabetical by surname, with name-only search; clicking a speaker opens a detail modal with biography, company, and their sessions. Marketed as mobile-friendly and more visual than the speaker list. | "Speakers" heading; "Search speaker by name" input; responsive grid of headshot/name/title/company cards (fallback rendering when photo/title missing). Card click opens detail modal: Back/Close, photo, name, title, truncated bio + Show more, "Company Name:" field, "Sessions (N)" list with full date/time and room per session. Closing returns to an intact grid. |
| Embed generation, formats & branding (organizer side) | No | Admin workflow (Deliver > Embeds > Add Embed) to create any of the five widgets: output format choice (styled HTML single-script web component; basic HTML; JSON/XML feeds; iCal subscription), display options, colors, custom CSS, content filters (tracks, statuses), and card-field selection (required fields locked grey, defaults preselected blue). Feeds update automatically ~every 60 min with a manual cache-refresh option; changing widget data type requires a new embed. Live detail: `embeds.sessionboard.com/v0/sessionboard-session-embed.js` + `<sessionboard-embed embed-id widget-type>` custom element with shadow DOM and CSS custom-property theming including a dark theme. (Builder UI inferred from KB prose, not observed.) | Embeds manager listing created embeds; Add Embed wizard with widget-type and format pickers, color inputs/custom-CSS box, filter selectors, field checkbox list; copyable code snippet and "preview in new window" action. Public side: widget inherits organizer colors; "Powered by" SessionBoard attribution in the footer. |

## Rubric rationale

- **EMB-01** (w3, auto): the session card with its full field anatomy IS the sessions-list widget; a browser agent can verify every field and the Show more toggle from screenshots.
- **EMB-02** (w2, auto): dual-scope search (titles + speaker names) is SessionBoard's documented behavior and directly exercisable by typing two queries and reading the narrowed list/count.
- **EMB-03** (w2, auto): faceted filtering is important but secondary to rendering; applying one track and checking surviving cards is fully automatable.
- **EMB-04** (w3, auto): a directory with photo/name/title/company per entry is the speakers-list widget's reason to exist; surname ordering is observable but demoted to partial credit since it is a convention, not the core capability.
- **EMB-05** (w2, auto): the detail drill-down (bio + that speaker's sessions) and name search complete the directory; both are click-and-observe verifiable.
- **EMB-06** (w3, auto): the day/room/time structure is the agenda's essence; the rubric accepts a time-slotted list equivalent because clones will not look like SessionBoard, but placement correctness is checked against a sampled session.
- **EMB-07** (w2, auto): day navigation is required for a multi-day event but is one control; verified by diffing two days' screenshots.
- **EMB-08** (w2, auto): the block detail view (full range, room, description, Format/Track) with Back is important drill-down polish; subsessions are bonus since many clones will not model them.
- **EMB-09** (w3, auto): chronological day-grouped listing with complete card anatomy is the itinerary widget's core browse behavior, observed directly in SessionBoard's live example.
- **EMB-10** (w1, auto): personal-schedule picking is **(inferred)** — absent from SessionBoard's live embed and suggested only by the widget's name and category norms (Sessionize favorites, Cvent personal agendas); weighted 1 to match the research's "weighted low" call, since a faithful clone of the observed product would lack it entirely. Fully automatable via add controls and a my-schedule view.
- **EMB-11** (w1, auto-partial): persistence across reload is agent-verifiable, but .ics correctness and cross-visit durability need a human with a calendar app — hence auto-partial with manual instructions, and weight 1 as polish on an inferred feature.
- **EMB-12** (w3, auto): the photo grid with card fields, name search, and missing-photo fallback is the gallery widget itself; all observable in one page visit.
- **EMB-13** (w2, auto): the detail modal (bio, company, Sessions (N) with date/time/room) is the gallery's drill-down half; verified by opening and closing one card.
- **EMB-14** (w3, auto): public no-login access is the defining property of ALL five widgets — embeds live on marketing sites; the whole area is pointless behind an auth wall. Verified by running EMB-S1/EMB-S2 logged out.
- **EMB-15** (w2, auto-partial): the organizer-side generator (types, formats, branding, filters, fields) is documented from KB prose (inferred screens); the agent can verify the builder and snippet, but real third-party embedding and feed contents need a human — hence auto-partial.
- **EMB-16** (w2, auto-partial): live-data consistency (no republish drift) is the widgets' value proposition; cross-widget and organizer-vs-public sampling gives an objectively judgeable point-in-time auto half, but edit-propagation to an already-embedded widget without republishing (and the ~60-min refresh cadence) is time-delayed and needs a human — hence the manual instructions.

Known gaps carried from research: the personal schedule builder is not present in SessionBoard's live itinerary embed (EMB-10/EMB-11 are inferred, weighted low); the organizer embed-builder UI is known from KB text only; JSON/XML schemas and iCal contents were not retrievable without an account; the ~60-min auto-refresh cadence and manual cache refresh come from KB text only and are not directly rubric-tested (folded into EMB-15/EMB-16 manual halves); agenda in-grid search/filter, speaker social links, pagination beyond ~22 items, and mobile layouts were not observable.

## Sources

- https://www.sessionboard.com/capabilities/sessions-list-1
- https://www.sessionboard.com/embeds/sessions-list-1
- https://www.sessionboard.com/embeds/speakers-list-1
- https://www.sessionboard.com/embeds/agenda-example-1
- https://www.sessionboard.com/embeds/embed-schedule-itinerary
- https://www.sessionboard.com/embeds/embed-speaker-gallery
- https://learn.sessionboard.com/en/knowledge-base/6949616-agenda-speaker-embeds
- https://www.sessionboard.com/blog/sessionboard-introduces-embeddable-speaker-gallery-schedule-itinerary-for-event-websites
- https://embeds.sessionboard.com/v0/sessionboard-session-embed.js (live widget script, inspected in browser)
