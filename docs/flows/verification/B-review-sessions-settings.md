# Verification Pass B — Admin Session screens: Create-a-Session, Accept/Decline, Session Settings

**Scope of this pass:** confirm our understanding of Sessionboard's admin session screens against the authoritative Guidde walkthrough frames. Every claim below is tied to a specific frame I read directly.

**Sources read (frame-by-frame):**
- `docs/reference/guidde/04-create-session/01.jpg … 08.jpg`
- `docs/reference/guidde/04-decline-sessions/01.jpg … 09.jpg`
- `docs/reference/guidde/08-session-settings/01.jpg … 21.jpg`
- `docs/reference/guidde/ALL-CAPTIONS.md` (sections 04-create-session, 04-decline-sessions, 08-session-settings, plus 06-agenda for default-duration cross-ref)
- `docs/flows/04-review-accept-decline.md` and `SCOPE.md` (our current docs, being verified)

**One structural note up front:** the frames span **two UI generations**. `04-create-session` (account initials "MC") is the older Sessions UI: tabbed status bar `All Submissions · Accepted · Accept Queue · Pending · Decline Queue · Declined · Withdrawn · Draft`, columns `Session ID / Status / Title / Description / Tags / Location…`. `04-decline-sessions` and `08-session-settings` (account "VD") are the newer "Sessions 2.0" UI: left rail adds `Content / Reports / Studio`, a `Submissions / Submissions / Forms` sub-tab strip, a left column with `Views (Sample) · Edit View · Show/Hide Fields · Filters · Sort By`, and status tabs `View All · Accepted · Accept Queue · Pending · Decline Queue · Declined · Drafts` (**no Withdrawn tab** in the newer strip). The 5-status machine is byte-identical across both.

---

## 1. Screen-by-screen confirmed inventory

### 1A. Add Session drawer (`04-create-session/03–06.jpg`)

**Entry:** Sessions → Submissions → blue **`+ Add Session`** button, top-right, sitting next to **`… Options`** (`04-create-session/02–03.jpg`).

**The drawer is a right-side slide-over with two tabs: `Details` and `Participants`** (`04-create-session/04.jpg`, both tabs visible in the highlighted header). Footer is persistent: **`Cancel`** and a blue **`Add Session`** submit button (`04-create-session/04.jpg`, `06.jpg`).

**Details tab — fields confirmed, in on-screen order:**

| Field | Control | Notes |
|---|---|---|
| **Title** * | text, `0/255` counter | required (red asterisk) — `04.jpg` |
| **Status** | dropdown, defaults to **Pending** (checkmarked) | options exactly: **Accepted / Accept Queue / Pending / Decline Queue / Declined** — `04.jpg` |
| *(Ends At / Starts At)* | datetime | "Ends At" label visible just below Status; the datetime block sits between Status and Level (partially off-frame) — `04.jpg` |
| **Level** | dropdown "Select level…" | fed by Session Settings → Levels — `05.jpg` |
| **Track** | dropdown "Select track…" | fed by Tracks — `05.jpg` |
| **Tags** | multi-select "Add tags…" | fed by Tags — `05.jpg` |
| **Location** | text/label | `05.jpg` |
| **Type** | dropdown "Select location type…" | location type — `05.jpg` |
| **Capacity** | number "Enter capacity…" | `06.jpg` |
| **Upload your on-demand recording** | file picker "Choose file…" | `06.jpg` |
| **Are you a member?** | dropdown | event-specific question — `06.jpg` |
| **Member ID** | text, `0/255` | event-specific — `06.jpg` |
| **Track Lead Status** | dropdown | event-specific — `06.jpg` |

**Below the fold** (i.e. requires scrolling the drawer): everything from **Level down through Track Lead Status** is below Title/Status. The "level / track / tags / location / etc." the caption promises (`04-create-session` caption step 5) are all present and confirmed. Format was not in-frame (the drawer scroll skipped the Status→Level gap), but is a standard session field.

**Participants tab:** header tab confirmed present (`04.jpg`); its internals (speakers/moderators/chairperson/sponsors/exhibitors) were **not shown in any frame** — caption only says "Session Details and Session Participants" and notes sponsors/exhibitors require those modules.

**Post-create:** session lands in the list; edit later via the **pencil icon** at the left of the row (`04-create-session/07.jpg`, caption step 7).

### 1B. Submissions table + status column (`04-create-session/02,07.jpg`, `04-decline-sessions/04,05,08.jpg`)

- **Status tabs with live counts** across the top (both UIs). Newer UI: `View All (11) · Accepted (8) · Accept Queue (0) · Pending (1) · Decline Queue (0) · Declined (2) · Drafts (0)` (`04-decline-sessions/04.jpg`).
- **Status column renders colored pills**: Pending (yellow), Accepted (green), Declined (red), Decline Queue (amber) all visible in-table (`04-create-session/02.jpg`, `04-decline-sessions/04.jpg`).
- **Single inline status change:** click the status pill in a row → a small **`Status`** popover opens with the current value shown with an **`✕` clear** control + chevron, and the dropdown list **Accepted / Accept Queue / Pending / Decline Queue / Declined** (`04-decline-sessions/05.jpg`). Matches caption step 5.
- **Toolbar:** search, `View: <name>` saved-views picker, **`Columns`**, **`Sort`**, **`Filter`** (older UI); newer UI moves Views/Show-Hide-Fields/Filters/Sort into a left column and keeps **`Options`** + **`+ Add`** top-right (`04-decline-sessions/04.jpg`). Pagination **`Show: 100`** bottom-right (`04-decline-sessions/04.jpg`).

### 1C. Bulk Edit-status flow (`04-decline-sessions/06,07.jpg`)

1. Check row checkboxes → an action bar appears reading **`3 Selected`** with buttons **`✎ Edit` · `Send Emails` · `Download Files` · `Delete` · `More ▾` · `Clear selected`** (`06.jpg`).
2. Click **`Edit`** → **`Bulk Edit`** modal (`07.jpg`) with:
   - Yellow warning: *"If you have existing data in this field, it will be removed and replaced with your current selection."*
   - **`Field to update`** dropdown (set to **Status**).
   - **`Status`** value dropdown (set to **Accepted**).
   - **`Update`** (orange) / **`Cancel`**.

So bulk status change = select → Edit → pick field (Status) → pick value → Update. Confirmed exactly as caption steps 6–7. Note **`Send Emails`** is a peer button in the same bulk bar — the notify step is one click away but a separate action.

### 1D. Portal status display / queue masking (`04-decline-sessions/03.jpg`)

Speaker/submitter portal session cards render status as icon + label:
- **Accepted** → green check + "Accepted".
- **Declined** → red hollow circle + "Declined".
- **Pending** → orange half-filled circle + "Pending".
- **Queue status (Accept Queue / Decline Queue)** → the **orange pending icon with NO label text** (top card "Enhancing Postdoc Preparedness…" shows only the icon, no word). This visually confirms the masking: queues render as the pending icon, name hidden. Caption step 3 states it explicitly.

### 1E. Session Settings — the six taxonomies + Files + Statuses

**Entry & layout:** Sessions → **Settings** (`08-session-settings/02.jpg`). Page title **"Session Settings — Customize your session and agenda settings."** Left sub-nav has two groups: top group **`Agenda · Criteria · Personas`**; bottom group **`Rooms · Tracks · Tags↗ · Levels · Formats · Languages · Files · Statuses`** (`02.jpg`). The caption enumerates only the **6** organize/schedule settings — **Rooms, Tracks, Tags, Levels, Formats, Languages** (`03.jpg` highlights exactly those six).

| Setting | List columns (confirmed) | Add-modal fields (confirmed) | Frame |
|---|---|---|---|
| **Rooms** | Name · Order · Capacity · Sessions · Actions(Edit\|Delete) | **Name*** (`0/255`), **Order** (ⓘ), **Capacity** (ⓘ) | `02.jpg`, `05.jpg` |
| **Tracks** | Name · **Color** · Order · Sessions · Actions | **Name*** (`0/255`), **Color** (full picker: hex/R/G/B/A + preset swatches), **Order** (0) | `06.jpg`, `07.jpg` |
| **Tags** | Name · **Sessions** · **Users** · Color · Order · Actions | **Name*** (`0/255`), **Color** (dropdown), **Order** (0) | `09.jpg`, `10.jpg` |
| **Levels** | Name · Order · Sessions · Actions | **Name*** (`0/255`), **Order** (0) | `11.jpg`, `12.jpg` |
| **Formats** | Name · Order · Sessions · Actions | **Name*** (`0/255`), **Order** (0) | `13.jpg`, `14.jpg` |
| **Languages** | Name · Order · Sessions · Actions | **Name*** (`0/255`), **Order** (0) | `15.jpg`, `16.jpg` |

Seed data observed (useful for our demo seed): Rooms `Room A(cap 45), Room A(cap 30), Room C, Room 307, Room 305, Room 306`; Tracks `Academia(purple), Innovations in Satellite Technology(orange), Leadership(green), DEI(blue)`; Tags `Review Committee(green), Volunteer(orange), Workshop(blue)`; Levels `Introductory, Intermediate, Advanced, Expert`; Formats `Breakout Session, Keynote, Lightning Talk, Session, Roundtable`; Languages `English, Spanish, French, German`.

**Files toggle (`08-session-settings/17.jpg`):** the `Files` sub-tab is a settings panel, not a list. **`Enable File Upload`** toggle ("This will let the user add files to the session"). When ON it reveals: **Due Date** (`02/28/2026 @ 11:59 pm`, format `MM/DD/YYYY @ hh:mm a`), **Accepted File Formats** (chips: PDF, PPT, Word + dropdown), **File Limit** (numeric stepper, e.g. 3, per session), **Limit File Size** toggle → info banner "maximum permitted file size is **1.95 GB**", **Minimum File Size** (0) / **Maximum File Size** (1) / **Type** (GB dropdown), **Enable Comments** toggle. Matches our `docs/flows` file-collection understanding.

**Custom Statuses (`08-session-settings/18,19.jpg` + `04-decline-sessions/02.jpg`):**
- **Session Statuses** list, "Specify custom statuses to track session workflows", **`Add Status`** button.
- Columns: **Name · Category · Color · Order · Sessions · Created By · Created At**.
- The **five built-ins are System-created rows** with **Category = `-`** (they *are* the categories), colors and orders: `Accepted` green **10** (8 sessions), `Accept Queue` light-green **20** (0), `Pending` yellow **30** (1), `Decline Queue` amber **40** (0), `Declined` red **50** (2).
- **Add Status modal fields:** **`Status Name*`** (default "New Status", `10/30` → **max 30 chars**), **`Status Category*`** (ⓘ; dropdown defaulting to **Pending**, with ✕ clear + chevron — maps the custom status onto one of the built-in categories), **`Color*`** (swatch + dropdown), **`Order*`** (required, empty by default). Submit = **`Add Status`** (`19.jpg`).

---

## 2. Corrections & new facts vs our current docs

**Status machine — confirmations & one naming fix:**
- ✅ **Exactly 5 built-in statuses**, and they double as the 5 **categories** every custom status must map to (Category column is `-` for the built-ins because they are the base categories). `08-session-settings/18.jpg`, `04-decline-sessions/02.jpg`.
- ⚠️ **Naming correction:** the labels are **"Accept Queue"** and **"Decline Queue"** — NOT "Accepted Queue"/"Declined Queue". Our `04-review-accept-decline.md` §2a table header says *"Accepted Queue"*; fix to **"Accept Queue"**. Confirmed identically in the status settings table, both single- and bulk-edit dropdowns, and the Add Session drawer.
- ✅ **Queue masking in the portal confirmed visually** (`04-decline-sessions/03.jpg`): Accept Queue and Decline Queue both render as the **orange pending icon with the label hidden**; Pending shows the same icon *with* the "Pending" label; Accepted/Declined show their real labels. Our doc's phrasing "shows Pending" is slightly imprecise — it shows the **pending icon, name omitted** (there is no literal "Pending" text on a queued card).
- ✅ **Status change never emails** — caption step 8 verbatim: "updating a session's status will not automatically send an email to the submitters or speakers." Confirmed. Our replicate-plus-improve plan (SCOPE P0 #4) stands.

**Taxonomy shape — corrections/new facts:**
- 🆕 **Tags are cross-entity, not session-only.** The Tags list carries **both a `Sessions` and a `Users` count column** (`09.jpg`) and the Tags item in the settings rail has an **external-link icon** (`03.jpg`, `08.jpg`) that navigates *out of* Session Settings into the **Content** module ("Back to settings" breadcrumb, left rail highlights Content — `09.jpg`). So Tags are an org/Content-level taxonomy shared by contacts *and* sessions; Rooms/Tracks/Levels/Formats/Languages/Statuses are session-scoped. Our doc treated Tags as a plain session multi-select — still true for sessions, but the shared-with-contacts scope is new.
- ✅ **Tag record = Name* + Color + Order** (`10.jpg`) — the caption's "Color and Order are optional" is consistent (both present, neither required-marked).
- ✅ **Track = Name* + Color(full picker) + Order** (`07.jpg`); **Room = Name* + Order + Capacity** (`05.jpg`); **Level / Format / Language = Name* + Order only** (`12/14/16.jpg`). No color on Level/Format/Language.
- ⚠️ **Default-duration-per-format is NOT on the Format record.** The Formats settings table is only `Name · Order · Sessions` (`13.jpg`) and the Add Format modal is only `Name + Order` (`14.jpg`) — **no duration field here.** Per-format default duration lives in **Session Settings → Agenda** (agenda-building caption step 15: "Session Format and Default Duration… assign a default time length to each session format"). Correction for anyone who assumed duration is a Format attribute: it's an Agenda-settings mapping keyed by format.

**Room capacity/order semantics (confirmed):**
- **Capacity is optional** (rooms show `-` when unset; `02.jpg`) and, per caption step 5, **not visible to speakers**. **Order** controls room ordering in the **Agenda Embed** type (caption step 5). Both match our doc. Duplicate room names are allowed (two `Room A` rows).

**How taxonomies feed the forms/agenda (confirmed by the drawer, cross-ref for forms):**
- The **Add Session drawer proves the wiring**: Level/Track/Tags dropdowns in the manual-create drawer are populated straight from these settings (`04-create-session/05.jpg`). Same pick-lists back the public submission form dropdowns (Format/Tags/Track/Level/Language — SCOPE §D). Track **Color** paints agenda cards/embeds (session-settings caption step 7). These frames don't show the form-builder's "add existing field" step, so that specific linkage remains from KB, not re-verified here.

**Add Session drawer — possible correction to our "custom fields can't be set at creation" claim:**
- 🆕 The drawer clearly contains **event-specific fields** — `Are you a member?`, `Member ID`, `Track Lead Status`, `Upload your on-demand recording` (`06.jpg`). If those are custom fields (they read as custom), this **contradicts** flow 04 §2c's KB-sourced claim that "custom fields cannot be filled in the creation pop-up." At minimum the newer drawer surfaces a much richer field set than our inventory (SCOPE §F) lists. Flag for a doc update; medium confidence on the "custom" classification since the frames don't label field provenance.

**"Show custom status name" toggle — likely doc overreach:**
- ⚠️ The Add Status modal (`19.jpg`) shows only **Status Name / Status Category / Color / Order**, then the submit button — **no "Show custom status name" toggle is visible.** Our `04-review-accept-decline.md` §2a lists such a toggle (and reasons about what "off" displays). Not confirmed by the frame; treat as unverified/likely absent unless a longer modal scroll exists.

---

## 3. Confidence grade per screen + residual unknowns

| Screen | Confidence | Basis / caveat |
|---|---|---|
| Add Session drawer — tabs, Title, Status, and below-fold taxonomy fields | **High** | Directly read `04-create-session/04–06.jpg`; field order confirmed |
| Add Session — Participants tab internals | **Low** | Tab exists but no frame shows its contents |
| Add Session — Description/Format/CEU/Client-ID presence | **Medium** | Off-frame in the Status→Level scroll gap; expected present but not seen here |
| Submissions table + status tabs + counts | **High** | `04-create-session/02,07`, `04-decline-sessions/04,08` |
| Single inline status change dropdown | **High** | `04-decline-sessions/05.jpg` (✕ clear + 5 options; no explicit Save/Cancel seen in crop) |
| Bulk Edit-status flow | **High** | `04-decline-sessions/06,07.jpg` — full modal captured |
| Portal queue masking | **High** | `04-decline-sessions/03.jpg` shows a queued card with icon-only, no label |
| 6 taxonomies (Rooms/Tracks/Tags/Levels/Formats/Languages) — lists + add modals | **High** | Every list and every add-modal captured (`08-session-settings/04–16`) |
| Files enable toggle + sub-settings | **High** | `08-session-settings/17.jpg` |
| Custom Statuses — list + Add Status modal | **High** | `08-session-settings/18,19.jpg`, `04-decline-sessions/02.jpg` |
| Default-duration-per-format location (Agenda, not Format) | **Medium-High** | Absence in Formats frames + presence in agenda-building caption; the Agenda settings frame itself is not in this set |

**Residual unknowns:**
1. **Participants tab** of the Add Session drawer — exact fields/roles never shown.
2. **Whether `Are you a member?` / `Member ID` / `Track Lead Status` are custom fields** — if so, our "no custom fields at creation" claim is wrong; provenance unverified.
3. **`Status Category` dropdown option list** — only "Pending" default is visible; presumably the 5 built-ins, but the expanded list isn't captured.
4. **`Show custom status name` toggle** — not seen; may not exist.
5. **Single-inline-status popover Save/Cancel affordance** — only clear(✕)+chevron seen; whether a Save click is required isn't captured.
6. **Agenda settings screen** (day start/end, program statuses shown in agenda, per-format default duration, room visibility) — referenced by captions but no frame in this pass.
7. **Withdrawn status** — present as a tab only in the older UI; absent from the newer strip. Whether "Withdrawn" is a 6th status, a filtered view, or removed in 2.0 is unresolved by these frames.
8. **`Criteria` and `Personas`** settings sub-tabs appear in the rail (`02.jpg`) but were not opened — out of this pass's scope.

---

### 5-line summary

1. **Status machine confirmed = exactly 5 built-ins** — Accepted / **Accept Queue** / Pending / Decline Queue / Declined (fix our "Accepted Queue" typo) — which also serve as the 5 mandatory **categories** every custom status maps to (Add Status = Name≤30 / Category / Color / Order); status changes **never email** (caption verbatim), and both queues render in the portal as the **orange pending icon with the name hidden** (visually confirmed).
2. **Taxonomies → forms/agenda:** Rooms(Name/Order/Capacity), Tracks(Name/**Color**/Order), Tags(Name/Color/Order, **shared across Sessions + Users**, lives under Content), Levels/Formats/Languages(Name/Order only) — these same pick-lists populate the Add Session drawer dropdowns and the public form; **track color paints agenda cards**; **room capacity is optional and hidden from speakers, order drives agenda-embed ordering**.
3. **Top corrections:** "Accept/Decline Queue" naming; **default-duration-per-format lives in Agenda settings, not on the Format record**; **Tags are cross-entity**; the **"Show custom status name" toggle is unconfirmed** (absent from the Add Status modal); the drawer surfaces **event-specific/likely-custom fields at creation**, challenging our "no custom fields at creation" note.
4. **Bulk flow confirmed:** select → action bar (Edit / Send Emails / Download Files / Delete / More / Clear) → Bulk Edit modal (Field to update = Status → value → Update, with an overwrite warning); single change is an inline pill dropdown.
5. **Residual unknowns:** Participants-tab fields, provenance of the drawer's extra fields, the Agenda settings screen, and the fate of "Withdrawn" in the newer 2.0 UI (tab present in old, absent in new).
