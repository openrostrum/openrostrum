# Verification C — Evaluations module (Add-Plan wizard + reviewer screen)

**Source:** authoritative guidde walkthrough `docs/reference/guidde/05-evaluations/01.jpg … 18.jpg` (18 frames) + `ALL-CAPTIONS.md` §05-evaluations (18 steps). Cross-checked against `docs/flows/05-evaluations.md` and `SCOPE.md`.
**Verified:** 2026-08-08. Every claim below is tied to a specific frame; where a frame does not show something, it is called out as unknown rather than inferred.

## TL;DR — the one framing correction that matters

**The walkthrough demonstrates the 1.0 SIX-step wizard, not the 2.0 four-step (Overview/Rounds/Evaluators/Assignments) wizard our current doc treats as the clone target.** The steps on camera are: **Type → Configuration → Evaluators → Session Filters → Display Fields → Grading Options** (top stepper visible in `04–15.jpg`). There are **no Rounds, no Assignments stage, no Scoring Method toggle, no Funnel/Parallel** anywhere in these 18 frames. Our `05-evaluations.md` is not wrong about 2.0 existing — but the video (the thing judges replay) is pure 1.0. For a fidelity clone the 1.0 wizard is the authoritative shape.

---

## 1. Screen-by-screen confirmed inventory

### Frame 01 — Title card
"EVALUATION PLANS" splash (Sessionboard branding). No UI. Caption 1 defines purpose: "gathering feedback for your submitted sessions by outside evaluators, such as committees, using a rating scale."

### Frame 02 — Navigation entry point
Evaluation is a **sub-item of the Sessions module** in the left rail (Sessions expands to: Submissions, **Evaluation**, Agenda, Embeds, Settings). It is NOT a top-level "Program → Evaluations". `Evaluation` is highlighted. (Correction detail vs SCOPE Appendix A, which nests it under "Program".)

### Frame 03 — Evaluation Plans list (populated instance)
- **Breadcrumb + top tabs:** `Evaluation /` then **Summary · Evaluation Plans · My Evaluations · Personas**. Note: **"Personas"** tab present; **no "Evaluators" and no "Evaluator Tags" tabs** here. This contradicts SCOPE Appendix G ("Summary · Evaluation Plans · My Evaluations · Evaluators · Evaluator Tags"). Two different Sessionboard generations/instances — SCOPE's tab set came from swyx's newer 2.0 instance; this guidde is the 1.0 instance.
- **Add Plan** button top-right (orange). Caption: "You can create as many plans as needed."
- **List columns:** Name · Status · Evaluators · Sessions · Total Evals · Progress · Due Date · Actions.
- **Status values seen:** `CLOSED`, `REVIEWED` (implies also OPEN). "REVIEWED" is a distinct list status, not just Open/Closed.
- **Track-routing confirmed in the data:** plan names include **"Session Track A Evaluations"** and **"Session Track B Evaluations"**, plus "2025 Conference Sessions" and four "Copy of 2025 Conference Sessions" duplicates (one tagged "(Round 2)"). Several rows carry a wand icon = AI/Virtual plans ("My Evaluation Plan" ×2).

### Frame 04 — Step 1: Type
- Stepper confirmed: **1 Type · 2 Configuration · 3 Evaluators · 4 Session Filters · 5 Display Fields · 6 Grading Options**.
- Two cards: **Assign Evaluators** ("Assign and invite evaluators to review sessions") [selected] vs **Virtual Evaluators** `New` ("Auto-evaluate sessions using AI personas").
- Info banner: "Interested in using virtual evaluators? Contact us or learn more."
- Back / Next.

### Frame 05 — Step 2: Configuration (top)
- Heading "Configure your evaluation plan settings."
- **Name\*** — text input, `18/255 Characters` counter.
- **Instructions\*** — rich-text editor. Toolbar buttons: Bold, Italic, superscript, subscript, link, bullet list, numbered list, outdent, indent, code `<>`, and a **merge-tag `{;}`** button. Body pre-filled with a long scoring-guidance paragraph.

### Frame 06 — Step 2: Configuration (scrolled) — the "4 settings"
Confirmed the four Additional-Configuration toggles, in order:
1. **Set Plan as Open** (off) — "Open your evaluation plan to begin letting your evaluators review submissions." (Due-date field is NOT shown while this is off; caption confirms the date appears only when enabled.)
2. **Enable Anonymized Review** (off).
3. **Enable Weekly Reminders** (ON/green) — "Send an email to evaluators when there are sessions to review in their plan. Send frequency is weekly and 1 day prior to the due date."
4. **Include Uploaded Files** (off).

**The 4th setting = "Include Uploaded Files".** Our doc's 1.0 reference listed exactly these four — confirmed correct.

### Frame 07 — Step 3: Evaluators
- Heading "Add Evaluators."
- Left: **Select Evaluators** — a `Name` dropdown filter + `Search by name` box, "4 Evaluators found", checkbox rows (names blurred), `Select All` / `Remove All`.
- Right: **Invited Evaluators (0)** [Remove All] and **Added Evaluators (2)** [Remove All] → chips "Catrina McDermott", "Jasmine Williams" each with × .
- Confirms two-bucket model (Invited vs Added) and that evaluators are picked from existing event users (caption 7: "Evaluators must be added to your event team before they can be assigned").

### Frame 08 — Step 4: Session Filters
- Info banner spells out the boolean logic: **"Multiple criteria in one filter act as ORs … Multiple filters act as ANDs."**
- Two filter rows: **Status IS Pending** — **AND** — **Tracks IS Innovation** (each row: field dropdown ▾, IS, value-chip multiselect ▾, row ×).
- **+ Add filter row** / **Clear all**.
- Live match count: green **"0 sessions match this filter"**.
- Field dropdown fields (from caption 8): **track, tags, format, level, language, status**. Frame confirms `Status` and `Tracks`; the rest are per caption. This is the category-routing mechanism.

### Frame 09 — Step 5: Display Fields → Session Fields tab
- Heading "Set display fields — Fields will be visible to evaluators when grading submissions." Search box.
- Three tabs: **Session Fields** [active] · Speaker Fields · Evaluation Fields.
- Left picker: `SESSION FIELDS` · `Select Defaults`; scope filter **All Fields / Global / Event**; `Select All / None`. Rows with a globe (=Global) icon and type label: **Title** (Text) · **Description** (Wysiwyg) · **Track** (Dropdown) · **Language** (Dropdown) · **Level** (Dropdown) · **Tags** (Dropdown), all checked.
- Right live panel: **Visible fields (13)** grouped:
  - `SESSION DETAILS` [Remove all]: Title, Description, Track ×, Language ×, Level ×, Tags × — each with drag handle. **Title and Description have no × (locked-in); the rest are removable.**
  - `SPEAKER DETAILS` [Remove all]: First Name, Last Name, Job Title ×, Company Name ×, Biography ×. **First/Last Name locked.**
  - `EVALUATION FIELDS` [Remove all]: (empty here).
- So step 5 is a single page with a live drag-orderable "what evaluators see" preview.

### Frame 10 — Step 5: Speaker Fields tab
- Info banner: **"Anonymized View will not show speaker names to evaluators."**
- **Use Anonymized Review** toggle (off) — anonymization appears a SECOND time here (also on Configuration step 2). Confirms anonymization = hides speaker **names** specifically.
- Picker rows: First Name (Text), Last Name (Text), Job Title (Text, checked); Select Defaults / All Fields·Global·Event / Select All·None.

### Frame 11 — Step 5: Evaluation Fields tab
- `EVALUATION FIELDS` · Select Defaults · Select All / None.
- Pre-built reusable questions: **Internal Comments** (Textarea, checked) · **External Comments** (Textarea, checked) · **"Should we accept this session?"** (Dropdown, unchecked) · **"Do you think this session should be accepted?"** (Dropdown, unchecked) · **"Interest in helping to develop this session?"** (Dropdown, unchecked).
- **+ Create New Field** button (arrow highlights it).
- KEY: there IS a soft "should we accept this session?" recommendation dropdown, but it is a reusable custom field, NOT a first-class approve/maybe/deny verdict primitive. Confirms doc Gap #9.

### Frame 12 — Step 5: Customize field panel
- Clicking a field's ⋯ opens **Customize field**: `FIELD NAME` (Internal Comments), `FIELD TYPE` (Textarea), **SET AS REQUIRED** toggle (off), **LABEL** input, **HELP TEXT** textarea, Cancel / Save. Confirms per-question required + label + help-text customization.

### Frame 13 — Step 6: Grading Options → Rating Icon
- "Choose how evaluators will grade sessions and provide feedback."
- **Rating Icon\*** (required, red asterisk) — four radio rows: **★★★★★ stars** · **♥♥♥♥♥ hearts** · **😞😐🙂😊😀 faces** [selected] · **1 2 3 4 5 numbers**.
- The **selected** row reveals an inline count stepper (`−  5  +`) and a **black color-swatch rectangle** (the custom-color picker). Caption 13: stars/hearts settable **up to 20**, faces/numbers **max 5**; click the black rectangle to recolor.
- Below: **Enable Rubric** toggle (off) · **Set Evaluation Limits** toggle (off). Footer: Back / **Add Plan**.

### Frame 14 — Step 6: Rubric enabled
- **Enable Rubric** ON. Table **CRITERIA | WEIGHT (%)** with seeded rows: Topic 25%, Trendiness 25%, Creativeness 25%, Event Fit 25% — each = text input + slider + % readout + red × .
- **Add Criteria** button. Validation banner (green): **"Looks good! All values added together equal 100%."** Confirms weighted criteria must sum to 100%.

### Frame 15 — Step 6: Evaluation Limits enabled
- **Set Evaluation Limits** ON. "Select how you want to distribute sessions for evaluation:" with radio **Session limit** [selected] (framing implies a distribution-mode selector; only "Session limit" is shown).
- **Number of evaluations per session** = 2. Info: **"This plan currently has 2 evaluators."** Confirms evals-per-session is tied to / capped by evaluator count.
- Footer: Back / **Add Plan** (final submit).

### Frame 16 — Plan Actions menu
- Minimal instance list (tabs here only **Evaluation Plans · My Evaluations**). Row "My Evaluation Plan" — CLOSED, Evaluators 2, Sessions 0, Total Evals 0, Progress 0%, Due Fri June 20 2025.
- **⋯ Actions menu:** **Review · Edit · Open · Export · Duplicate · Delete.**
- Correction vs doc: the on-camera menu has a single **Export** (not split Individual/Cumulative in the menu) and **no separate "Notify"** item; **Open** is the open/close toggle (plan is CLOSED so it reads "Open"). "Review" is present (admin-as-reviewer entry).

### Frame 17 — Reviewer / Review screen (PARTIAL scoring UI)
This is the closest the walkthrough gets to the evaluator experience.
- Header: plan "2025 Conference Sessions" `OPEN`, "Closes: June 7, 2025, 07:33 AM PDT", **Open Instructions** link.
- **"0 of 27 Evaluations Submitted"** + progress bar.
- Left pane: search by session title; tabs **All / Reviewed / Not Reviewed**; scrollable list of session titles each with a clock (pending) icon.
- Right pane: session title, "Submitted on May 1, 2024", **Print**; **Description** accordion (expanded, abstract text); **Session Details** accordion (Track: Academia). **Save & Next** (blue) + "Back to Top".
- CRITICAL LIMITATION: **the actual score-INPUT widgets are NOT visible.** This frame shows the read side (submission details) + the navigation + Save & Next, but the rating-icon selector, rubric sliders, and comment textareas would sit below the Session Details accordion (below the fold). They are never captured.

### Frame 18 — Outro
Blank blue gradient end card. No UI.

---

## 2. Corrections & new facts vs our docs

| # | Our current doc / SCOPE says | Walkthrough (authoritative) shows | Impact |
|---|---|---|---|
| C1 | `05-evaluations.md` frames 2.0 (4-step Overview/Rounds/Evaluators/Assignments) as the clone target; 1.0 is "for reference". | Video is **entirely 1.0**: 6-step Type/Configuration/Evaluators/Session Filters/Display Fields/Grading Options. No rounds, no assignment wizard, no scoring-method toggle, no funnel/parallel (`04–15.jpg`). | The judge-replayable truth is 1.0. Anything we build to "full fidelity" should match the 1.0 wizard, not the 2.0 doc. |
| C2 | SCOPE Appendix G tabs: Summary · Evaluation Plans · My Evaluations · **Evaluators · Evaluator Tags**. | Tabs: Summary · Evaluation Plans · My Evaluations · **Personas** (`03.jpg`). No Evaluators/Evaluator-Tags tabs. | Two Sessionboard generations. Neither is "wrong"; note the split so we don't mismatch nav. |
| C3 | Evaluation under "Program" module. | Evaluation is a sub-item of **Sessions** (`02.jpg`). | Cosmetic nav placement. |
| C4 | 4th Additional-Config setting uncertain. | **Include Uploaded Files** is the 4th toggle (`06.jpg`), after Set Plan as Open, Anonymized Review, Weekly Reminders. | Confirmed; doc's 1.0 list was correct. |
| C5 | Plan actions "Review · Edit · Open/Close · Export Results (Individual\|Cumulative) · Duplicate · Notify · Delete". | On-camera menu: **Review · Edit · Open · Export · Duplicate · Delete** (`16.jpg`) — single Export, no Notify, Open = the open/close toggle. | Minor. Individual/Cumulative split (if any) happens after clicking Export, not in the menu. |
| C6 | Weekly-reminder cadence unclear. | "**weekly and 1 day prior to the due date**" (`06.jpg`). | Confirmed exact cadence. |
| C7 | No first-class recommend/verdict field. | Confirmed: recommendation is a reusable **dropdown** ("Should we accept this session?", "Do you think this session should be accepted?") among Evaluation Fields (`11.jpg`), not a built-in verdict. | Confirms doc Gap #9. |
| C8 | Anonymization = "hides submitter/participant identity" (2.0) vs "removes speaker first/last names" (1.0). | 1.0 is specific: banner "**will not show speaker names**"; First/Last locked in visible panel (`09–10.jpg`). Anonymization appears in TWO places (Config step 2 + Speaker-Fields tab). | Scope of masking = names, confirmed. |
| C9 | Eval limit "capped by evaluator count". | Confirmed: "Number of evaluations per session" with "This plan currently has N evaluators" (`15.jpg`); presented under "Select how you want to distribute sessions" with a "Session limit" radio. | Confirmed + hint of a distribution-mode selector. |

### FULL fidelity of grading vs SCOPE's de-scoped floor (the exact gap)
SCOPE (P0 #5) floors evaluation to a **3-state approve / maybe / deny** decision + optional comment, with scorecards/rubric/rounds pushed to P1/P2. The FULL 1.0 mechanics the walkthrough proves we are deliberately NOT building:
- **Rating icon scale** — star/heart (1–20), face/number (1–5), custom color (`13.jpg`).
- **Weighted rubric** — named criteria + sliders that must total 100% (`14.jpg`).
- **Custom evaluation-field questions** — Internal/External Comments + recommendation dropdowns + Create New Field, each with required/label/help-text (`11–12.jpg`).
- **Per-session evaluation limit** tied to evaluator count (`15.jpg`).
- **Anonymized review**, **display-field visibility control** (session/speaker fields, drag-ordered), **weekly reminders**, **Include Uploaded Files** (`06`, `09–10.jpg`).
- **Rounds / assignment distribution** — not even in 1.0; a 2.0-only concept.

So the delta = everything above. Our floor keeps only: reviewer picks approve/maybe/deny (+comment), track routing, admin tally → accept/decline. That is a large, intentional fidelity gap and this doc pins its exact boundary.

### "One plan per track" = category routing — CONFIRMED, with a nuance
- **Confirmed** by data (`03.jpg` plan names "Session Track A Evaluations" / "Session Track B Evaluations") and by the Session Filters step (`08.jpg`, "Tracks IS Innovation"). The Sessionboard model is: **create one plan per track, filter sessions into it by track, assign the relevant evaluators to that plan.** Routing is plan-scoped filtering, not per-reviewer tagging.
- **Nuance vs SCOPE's Discord clarification:** SCOPE now defines routing as **many-to-many track overlap** (submissions carry ≥1 track, reviewers cover ≥1 track, match on overlap). That is our *reinterpretation/simplification* — Sessionboard 1.0 does not tag reviewers with tracks; it filters sessions into a per-track plan and the admin hand-picks that plan's evaluators. Both achieve "reviewers see their track's sessions"; the mechanism differs. Worth stating explicitly so we don't claim 1:1 parity on the mechanism.

### Does the evaluator SCORING screen appear?
**Partially.** `17.jpg` shows the reviewer's two-pane review screen — submission-navigation list (All/Reviewed/Not Reviewed, progress "0 of 27 Evaluations Submitted"), the submission read pane (Description, Session Details/Track, Print), and **Save & Next**. But the **score-input widgets themselves** (clicking the rating stars/faces, moving rubric sliders, filling comment boxes) are **below the fold and never shown**. So: the *review/reading* screen is confirmed; the *grading interaction* is still unseen. Our doc's claim that "the scoring UI our demo never showed" is right about the input widgets, but we now have the surrounding review chrome from `17.jpg`.

---

## 3. Confidence grade per screen + residual unknowns

| Screen | Frame | Confidence | Notes |
|---|---|---|---|
| Nav entry (Sessions → Evaluation) | 02 | **High** | Clear. |
| Plans list (cols, statuses, tabs, Add Plan) | 03, 16 | **High** | Two instances corroborate columns/actions. |
| Step 1 Type | 04 | **High** | Both cards + banner legible. |
| Step 2 Configuration (Name, Instructions) | 05 | **High** | Counter, toolbar all legible. |
| Step 2 the 4 toggles | 06 | **High** | All four + copy legible. |
| Step 3 Evaluators | 07 | **High** | Invited/Added buckets clear; individual names blurred (intentional). |
| Step 4 Session Filters | 08 | **High** for Status/Tracks + AND/OR logic; **Medium** for full field list | Only Status + Tracks shown in-frame; format/level/language/tags are from caption 8, not pixels. |
| Step 5 Session Fields | 09 | **High** | Picker + live panel + locked fields clear. |
| Step 5 Speaker Fields + Anonymize | 10 | **High** | Banner + toggle legible. |
| Step 5 Evaluation Fields + Create New | 11 | **High** | All five preset questions legible. |
| Step 5 Customize field | 12 | **High** | All controls legible. |
| Step 6 Rating Icon | 13 | **High** | Four options + stepper + color swatch; max values from caption. |
| Step 6 Rubric | 14 | **High** | Criteria/sliders/100% validation clear. |
| Step 6 Eval Limits | 15 | **High** | Numeric + evaluator-count tie clear. |
| Plan Actions menu | 16 | **High** | All six items legible. |
| Reviewer review screen | 17 | **Medium** | Read pane + nav + Save & Next confirmed; scoring widgets NOT in frame. |

**Residual unknowns (not answerable from these 18 frames):**
1. **The actual grading widget.** How the reviewer clicks a rating icon, moves rubric sliders, and where the comment boxes render — all below the fold in `17.jpg`. Never shown.
2. **Due-date field UI.** Not shown because "Set Plan as Open" was off in `06.jpg`; its exact date+time+TZ control is inferred from caption only.
3. **Export dialog.** Whether `Export` (`16.jpg`) splits into Individual vs Cumulative Grades Report happens after the click — not captured.
4. **Session Filters full field enum.** Only Status + Tracks shown; tags/format/level/language per caption, not pixels. Operators other than "IS" unknown.
5. **Distribution modes.** `15.jpg` shows a "Select how you want to distribute" prompt with a single "Session limit" radio selected — whether other distribution options exist is not visible.
6. **Summary and My Evaluations pages, and the Personas tab** — named in `03.jpg` tabs but none are opened in the walkthrough. Contents unknown from these frames (Summary metrics come from KB, not video).
7. **Rating-icon count maxima (20 / 5)** and **rubric per-criterion char limit** — from captions/KB, not directly demonstrated on screen.
8. **Where "Invited" vs "Added" evaluators diverge** (invite email trigger) — buckets shown (`07.jpg`) but the send-invite behavior is not demonstrated.

---

## 5-line summary
1. **Grading/rubric mechanics (FULL fidelity):** rating icon required — stars/hearts up to 20, faces/numbers up to 5, custom color (`13`); optional weighted **Rubric** = named criteria on sliders that must total 100% (`14`); evaluation-field questions (Internal/External Comments + "Should we accept this session?" dropdowns + Create New Field, each with required/label/help-text, `11–12`); optional **Set Evaluation Limits** = N evaluations per session, tied to evaluator count (`15`).
2. **Evaluator scoring UI:** only PARTIALLY visible — `17.jpg` shows the two-pane review screen (submission list with All/Reviewed/Not-Reviewed, "0 of 27 Evaluations Submitted", Description/Session-Details read pane, Save & Next), but the actual rating/rubric/comment INPUT widgets are below the fold and never shown.
3. **Routing model:** confirmed "one plan per track" category routing — plans named "Session Track A/B Evaluations" (`03`) + Session Filters "Tracks IS Innovation" (`08`); mechanism is plan-scoped session filtering + hand-picked evaluators, which our SCOPE reinterprets as many-to-many track overlap (a simplification, not 1:1).
4. **Top corrections:** the walkthrough is the **1.0 six-step wizard** (Type/Configuration/Evaluators/Session Filters/Display Fields/Grading Options), not the 2.0 four-step model our doc treats as the target — no rounds/assignments/scoring-method exist on camera; the 4th config toggle is **Include Uploaded Files**; plan actions are **Review/Edit/Open/Export/Duplicate/Delete** (no Notify); section tabs are **Summary/Evaluation Plans/My Evaluations/Personas** (no Evaluators/Evaluator-Tags tabs).
5. **Residual unknowns:** the actual score-input widget, the open-plan due-date control, the Export dialog's report split, the full Session-Filters field enum/operators, distribution modes beyond "Session limit", and the Summary/My-Evaluations/Personas page contents — none appear in these 18 frames.
