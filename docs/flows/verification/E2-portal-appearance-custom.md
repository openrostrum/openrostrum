# E2 — VERIFICATION: Portal model (Settings & Appearance · Custom Portals · Portal Files)

**Scope of this pass.** Confirm our understanding of Sessionboard's PORTAL admin model against three authoritative Guidde walkthroughs, frame-by-frame:
- `docs/reference/guidde/07-portal-appearance/01–21.jpg` (Portal Settings & Appearance, 21 steps)
- `docs/reference/guidde/07-custom-portals/01–18.jpg` (Custom Portals, 18 steps)
- `docs/reference/guidde/02-portal-files/01–10.jpg` (Portals - Files, 10 steps)
- Matched captions: `docs/reference/guidde/ALL-CAPTIONS.md` §`07-portal-appearance`, §`07-custom-portals`, §`02-portal-files`
- Cross-checked against `docs/flows/07-portals-tasks.md`, `docs/flows/02-public-submission-and-portal.md`, `SCOPE.md`.

**Verdict up front.** Our written model (`07-portals-tasks.md` §2a) is substantially correct — first-match-wins segmentation, the accepted-speaker-tasks recipe via `Always Show Tasks`, and the show/hide+lock field model all hold. The frames add exact UI copy, an exact wizard stepper, several new controls (Advanced Custom CSS, Final-Deadline dropdown range, 4 field-scope tabs), and reveal a UI-vintage split (old 4-step "People Portals" skin vs new 5-step "Contact Portals" skin) worth pinning down.

**Two UI vintages appear across the videos** (both authoritative, different dates):
- **Old skin** (`07-portal-appearance`, `07-custom-portals`): tabs labeled **People Portals / Group Portals**; portal editor is a **4-step** wizard `Select participants → Assign items → Configuration → Appearance`, where *Manage Fields* is a **tab inside Appearance**.
- **New skin** (`02-portal-files`): tabs labeled **Contact Portals / Group Portals**; portal editor is a **5-step** wizard `Select Participants → Assign Items → Configuration → Appearance → Manage Fields`, where *Manage Fields* is its **own step 5**. Nav also gains Applications/Documents/Embeds.

---

## 1. Screen-by-screen confirmed inventory

### A. Portals module home (`07-custom-portals/02`, `05`, `15`, `16`; `02-portal-files/05`)
- Header: "Portals — Create portals to assign tasks, files, forms and more to your different groups and people" (new skin subtitle: "Create and manage portals for speakers, exhibitors, and other participants").
- Controls: **Search portals by name…**, **+ Create Portal**, and a **pencil icon** (reorder mode) to the right of Create Portal (`07-custom-portals/15`, `02-portal-files/05`).
- Persistent info banner: **"Contacts that match multiple portal criteria are assigned to the top portal. Edit portal order to rearrange portal visibility."** — verbatim, first-match-wins is explicit in-product.
- Tabs: **People Portals (n) / Group Portals (n)** (old) or **Contact Portals (n) / Group Portals (n)** (new).
- **Three default portals**, shown pinned below the custom list:
  - **Default People Portal** — "People who do not match other criteria will see this portal configuration." (`07-custom-portals/02`)
  - **Default Exhibitor Portal** and **Default Sponsor Portal** under Group Portals — "Exhibitors/Sponsors who do not match other criteria will see this portal configuration." (`07-custom-portals/06`)
- Each portal card shows: name, filter summary (human-readable, e.g. "Moderator is checked **AND** [Session] Tracks is Innovation"), **Filters: N**, **Assigned to: N**, and "Created by … on …" (`07-custom-portals/16`, `02-portal-files/05`).
- Per-portal ellipsis (⋯) menu — confirmed full list: **Copy Link · Edit Criteria · Edit Tasks · Edit Settings · Edit Appearance · Duplicate · Delete** (`07-portal-appearance/03`, `02-portal-files/06`). "Edit Settings" jumps to the Configuration step; "Edit Appearance" jumps to the Appearance step; both live inside the same wizard.

### B. Create / segment a custom portal (`07-custom-portals/07–16`)
- **Add Portal modal** (`08`): "What is the name of your portal?" (internal name, e.g. "Moderators") + "Who do you want to create a portal for?" two cards:
  - **People** — "Create a portal that you can assign to speakers or exhibitor / sponsor contacts"
  - **Groups** — "Create a portal that you can assign to exhibitors or sponsors"
  - Buttons: **Save / Cancel**.
- **Step 1 · Select participants** (`09`): left panel **Portal Filters → Add Filter +**; "Portal Selection Criteria" help text (verbatim): *"Use filters to assign people to this portal. **Contacts that already match a custom portal will not be included in these filter results.** To add all contacts that match this filter, create this portal, then go to the Portals homepage and move this portal to the top…"* Right panel live-previews matching records (empty state "You haven't applied any filters yet"). Header button **Save & Customize**.
- **Add filter dropdown — People portal** (`10`): fields include standard contact fields **First Name, Last Name, Email, Company Name, Job Title**, custom contact fields (**Airline, Are You Flying or Driving, Arrival Time, Committee Member…**), roles (**Moderator, Speaker, Chairperson, Submitter**), and limited session fields (**[Session] Tags, [Session] Tracks, [Session] Formats**, plus Level/Language per caption 10).
- **Add filter dropdown — Group portal** (`11`, "Gold Sponsor"): **Name, Collaborator Link, Link, Reg Link, Sponsor, Exhibitor** (group types), **[Session] Tags, [Session] Tracks, [Session] Formats**, + custom group fields.
- **Role/checkbox operator** (`12`): a role field (e.g. "Moderator") offers radios **"is checked" / "is not checked"** — set automatically by role assignment on the back end. Buttons **Add filter / Cancel**.
- **Multiple filters = AND** (`13`, `16`): filters chip-listed with individual X removers; "Add Filter (2)" + green **ON** badge; operators observed across cards: `is checked`, `is not checked`, `is`, `does not contain`. Empty preview reads **"No available records matched your filters — Try selecting a different filter to match people that have not yet been assigned to other portals."** (reinforces the not-yet-claimed preview behavior).
- **Save & Customize** (`14`) → returns to Portals list showing the new portal with its filter summary and Assigned-to count (`16`).
- **Reorder** (caption 16): click the pencil icon → drag-and-drop portals into evaluation order (top = highest priority).

### C. Portal Settings / "Configuration" step (`07-portal-appearance/03–13`, `20`; standalone panel `10`)
The nine toggles, with **exact in-UI descriptions**:
| Toggle | Exact UI copy | Notes from voiceover |
|---|---|---|
| **Control Session Visibility** (`04`,`10`) | "Display sessions to portal users. If this is off, sessions will not be shown to speakers or submitters." | Hides the Sessions widget entirely. |
| **View Session Submission Form from Portal** (`05`,`10`) | "Let users access their submission via the submission form" | Users **cannot edit** session/speakers via the form once the submission deadline has passed (caption 5). |
| **Always Show Tasks** (`06`,`10`,`13`) | "Display portal tasks to all users. If unchecked, tasks will only be visible to speakers with **approved** sessions." | Caption 6: unchecked → only **accepted** speakers see **tasks, file requests, AND forms**. Non-accepted users assigned to the portal **still see wiki pages and files**. |
| **Extend Task Deadlines** (`07`,`08`,`10`) | "Let portal users complete past due tasks for a specified period of time." | Reveals a **Final Deadline** dropdown, **"N days after deadline"** selectable **up to 31** (dropdown shows …26,27,28,29,30,**31**; default value **7 days**). Original due date still displays; task stays **OPEN** during the extension (caption 7). |
| **Manage Profile** (`08`,`10`) | "Allow portal users to view and edit their profile information" | When disabled, profile widget stays visible but not editable/openable (caption 8). |
| **Manage Related Sessions and Participants** (`09`,`10`) | "Allow portal users to edit related sessions and participant information." | Governs co-presenter/related-session editing. |
| **Use Session Client ID** (`10`) | "When showing sessions in the portal, show the Client ID instead of the Session ID" | Under the same Settings group. |
| **Send Weekly Digest Email** (`10`,`11`) | "Send a weekly email summary of **portal actions and upcoming tasks by due date**." | Under a **"Reminders"** sub-section. |
| **Email Notifications** (`10`,`12`) | "Send an email to **primary contacts** when tasks are assigned **to this portal**." | Caption 12: only fires for users who have **logged into Sessionboard at least once**. |

Footer: **Continue** advances to Appearance (`13`).

### D. Appearance step — General tab (`07-portal-appearance/14`, `15`)
- **Title** (default value "Home").
- **Welcome Message** — shared rich-text editor: Bold/Italic/Underline, superscript/subscript, link, bullet + numbered lists, indent/outdent, **image insert**, clear-formatting, **code view `<>`**, and a **merge-tag `{;}`** button.
- **Logo Image** — drop zone + "Upload New", **Recommended 100 w × 100 h**.
- **Background Image** — drop zone + "Upload New", **Recommended 1920 w × 200 h**.
- Caption 15: if no logo/background set here, the portal **falls back to the event Details page images**; portal background is narrower than the event background, so a portal-specific image is recommended.
- **Accent Color** — hex picker (default **#E03131**, red).
- **Advanced Custom CSS Code** — free-text CSS box with warning **"NOTE: This can break existing styles. Recommended for expert users only."** *(NEW — not in our docs.)*
- **Save** button (bottom-left). Live portal preview renders on the right.

### E. Appearance step — Manage Fields tab (`07-portal-appearance/16–20`)
- Subtitle: **"Set field visibility on contact and session records."**
- **Four scope sub-tabs:** **Contact Fields · Session Fields · Contact Participants · Group Participants** (Group Participants covers sponsors/exhibitors when those modules are on).
- **Search by name…** + a **Show/Hide Fields** button (eye icon) that opens the picker to *expose* fields (caption 17: check the box left of a field to add it).
- Table columns: **Name · Category · Type · Level · Created At · Updated At · Actions**. Example rows: Headshot (Profile / File / Global), First/Last Name (Profile / Text), Biography (Profile / **Wysiwyg**), Salutation, Honorific, Pronouns (Dropdown), Gender (Attribute / Dropdown).
- Per-row **Actions ⋯** menu: **Lock** (a lock icon then appears next to the field name — prevents portal users from editing it, i.e. view-only) and **Remove** (takes the field out of the portal entirely) (`18`, `20`; caption 18).
- Header **Done** button (old skin) / it is step 5 in the new skin — exits the wizard back to the Portals list (`19`, caption 19).

### F. Portal Files (`02-portal-files/02–09`)
- **Portals → Files** page (`02`): "Manage files that can be shared to your portals." Search + **+ Add File**. Existing files render with **MIME type + size** (e.g. "Agenda — File — application/pdf · 696.9 KB"; "Hotel Map — application/pdf · 5.8 MB", `new` badge).
- **Add File drawer** (`03`,`04`): **Type** radios **Upload File / External URL**; **File** drop zone ("Upload file"); **Title** (placeholder "e.g. Speaker Handbook"); **Description** (optional). Buttons **Cancel / Add File**.
- **Assign to a portal** (`06`,`07`,`08`): portal ⋯ → **Edit Tasks** → **Assign Items** step → collapsible widgets — **Tasks / Forms / File Requests (n) / Resources (n) / Files** — each with **+ Add · Manage · Learn more**. Files widget → **+ Add** → **Add Files** modal (search + checkboxes over available files) → **Add Selected**.
- **Portal-user view** (`09`): a blue **Files** widget lists the assigned file with a type icon (e.g. "Speaker PPT Template", PPT icon), alongside Session Tasks / My Tasks sections.

### G. Portal-user surface confirmed incidentally (`07-portal-appearance/04–09,14`; `07-custom-portals/03`)
Portal home nav tabs: **Home · Sessions · Profile · Tasks · Files · Resources**. Home cards: **My Sessions** (status pills Accepted/Accepted Poster Presentation/pending), **My Profile** (name, role, bio, View more), **Tasks** (All / My Tasks; item statuses **Completed** ✓ green, **Incomplete** ⧗ orange, **Denied** ✕ red for file-request-style items), **Resources** (Wiki Pages), **Files**.

---

## 2. CORRECTIONS & NEW FACTS vs our docs

**Confirmed as written (no change needed):**
- **First-match-wins segmentation** — verbatim banner "assigned to the top portal", reorder via pencil/drag. `07-portals-tasks.md` §2a.3 is correct.
- **Accepted-speaker-tasks recipe** — `07-portals-tasks.md` §2a.7 Option 1 (filter role "Speaker is checked" + disable **Always Show Tasks**) is exactly the documented mechanism; the toggle's own copy confirms "only … speakers with approved sessions." Our carve-out note (non-accepted users still see wiki pages + files) is confirmed by caption 6.
- **Field show/hide + lock model** — `07-portals-tasks.md` §2a.4/§3 ("lock = view-only, hide = gone") is correct. Three effective states: not-exposed (hidden), exposed+editable, exposed+**Lock** (view-only).
- **Three default portals** (Default People / Exhibitor / Sponsor) — confirmed (`§2a.1`).
- **Portal Files** — upload-or-external-URL, title + description, assigned via the Files widget — confirmed (`§2e.1`).

**Corrections:**
1. **Extend Task Deadlines is a range, not a fixed 31.** The verification prompt's "Extend Task Deadline 31 days" is the **maximum** selectable in the **Final Deadline** dropdown. Default is **7 days** (matches our `§2a.9` "default 7"); the admin can pick any value up to **31 days after deadline**. Model it as a per-portal integer 1–31, default 7 — not a constant.
2. **Field-scope tabs are FOUR, not three.** Our docs describe "contact profile / session details / participants." The UI splits participants into **Contact Participants** and **Group Participants**, giving **Contact Fields · Session Fields · Contact Participants · Group Participants** (`07-portal-appearance/16`).
3. **Email Notifications copy is narrower than we wrote.** Our `§2` said "email to portal users when tasks, file requests, or forms are assigned." The toggle actually reads **"Send an email to *primary contacts* when *tasks* are assigned to this portal"** — audience "primary contacts", trigger scoped to tasks + portal, and (caption 12) only for users who logged in ≥ once.
4. **Weekly Digest wording.** Our `§2` "weekly email summary of assigned tasks" → exact copy is "summary of **portal actions and upcoming tasks by due date**" (broader than just tasks).
5. **Wizard stepper is explicit and versioned.** Our docs referred loosely to "Configuration page 3 / appearance page 4." Pin it: old skin = **4 steps** (Manage Fields is an Appearance tab); new skin = **5 steps** (Manage Fields is step 5). Tab label migrated **People Portals → Contact Portals**. Assign-Items widget names in the new skin are plain (**Tasks/Forms/File Requests/Resources/Files**), not the old video names ("Assign Tasks / Collect Form Submissions / Collect Files / Assign Pages").

**New facts (not in our docs):**
6. **Advanced Custom CSS Code** — a per-portal appearance field ("Recommended for expert users only") — in addition to logo/background/accent color (`07-portal-appearance/15`).
7. **Portal appearance defaults to event Details images** when logo/background are left blank (caption 15) — the inheritance is explicit.
8. **Filter preview excludes already-claimed records.** During Select-participants, the live preview only shows contacts/groups **not already matching a higher-priority portal**; a freshly created lower portal can read "0 rows / No available records" until reordered to the top (`07-custom-portals/09`,`13`). This is the operational face of first-match-wins and affects any clone that live-previews matches.
9. **Group-type filters** surface as **Sponsor / Exhibitor** fields (checkbox semantics) in Group-portal filters; group fields also include Name, Collaborator Link, Link, Reg Link (`07-custom-portals/11`).
10. **Add Portal "People" explicitly spans sponsor/exhibitor individual contacts** ("assign to speakers or exhibitor / sponsor contacts"), not only speakers — confirms People/Contact portals are the individual-contact tier across all modules.
11. **Portal cards expose "Assigned to: N" and "Filters: N"** counts — useful for a dashboard/parity feature.

**Scope note (SCOPE.md).** Most of this surface is explicitly **OUT** for the clone: portal Resources/wiki pages are struck; the sponsor/exhibitor (CRM/Groups) side is out; per-portal appearance/custom-CSS and custom-portal segmentation are not in P0/P1. The parts that **do** touch our build: **Always Show Tasks** gating (relevant to req 2 speaker portal + req 6/7 onboarding tasks — our accept-auto-provisions-tasks spine can mirror "accepted speakers see tasks"), **profile field visibility/lock** (relevant to "speaker edits own bio" and admin-controlled fields), and **portal Files** (relevant to P1 #3 speaker file uploads / shared files). Custom People-portal segmentation is a nice-to-have only if group/sponsor scope is ever added.

---

## 3. Confidence grade per screen + residual unknowns

| Screen / claim | Confidence | Evidence |
|---|---|---|
| Portals home layout, banner, tabs, 3 defaults | **High** | `07-custom-portals/02,05,06,15,16`; `02-portal-files/05` |
| Portal ⋯ menu (7 items) | **High** | `07-portal-appearance/03`; `02-portal-files/06` |
| Add Portal modal (name + People/Groups) | **High** | `07-custom-portals/08` |
| Select-participants + filter fields (People & Group) | **High** | `07-custom-portals/09,10,11,12,13` |
| First-match-wins + preview-excludes-claimed | **High** | banner + `07-custom-portals/09,13`; caption 15/16 |
| Reorder via pencil/drag | **High (mechanic)** / Med (exact drag UX unseen) | `07-custom-portals/15`, caption 16 |
| 9 Settings toggles + exact copy | **High** | `07-portal-appearance/04–12`, consolidated `10` |
| Extend Task Deadlines range (≤31, default 7) | **High** | `07-portal-appearance/07,08` (open dropdown) |
| Appearance General (title, welcome RTE, logo/bg dims, accent, custom CSS) | **High** | `07-portal-appearance/14,15` |
| Manage Fields (4 tabs, columns, Lock/Remove, Show/Hide) | **High** | `07-portal-appearance/16,17,18,19,20` |
| Portal Files (Add File drawer, assign flow, user view) | **High** | `02-portal-files/02,03,04,06,07,08,09` |
| 4-step vs 5-step wizard split | **High** | `07-portal-appearance/04,13,14` vs `02-portal-files/07` |

**Residual unknowns:**
- **Weekly Digest / Email-Notification cadence & templates** — schedule, send time, exact body still undocumented (only the toggle copy is confirmed). Carries over from `07-portals-tasks.md` §5.
- **Task-order controls (Smart/Due-Date/Custom)** — described in our docs from FAQ but **not visible** in any frame here; their location in the wizard remains inferred.
- **Participation-sections controls** (Invited/My Submissions/Confirmed) — not shown in these three videos.
- **Show/Hide Fields picker contents** — the button is confirmed but the picker panel itself isn't opened on camera; assumed to mirror module Show/Hide.
- **External-URL file behavior** — the radio exists (`02-portal-files/03`) but no frame shows the URL input state or how it renders to the user.
- **Exact "Lock" persistence semantics** — Lock adds a lock glyph and is described as view-only; whether it also affects API writes vs. only the portal UI is unverified.
- **Group Participants field tab** — visible as a tab label but its contents were not scrolled into view.
