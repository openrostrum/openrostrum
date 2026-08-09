# Flow 05 — Evaluations & scoring

Sources (Sessionboard public KB, fetched 2026-08-08):
- EP-1: https://learn.sessionboard.com/evaluations/evaluation-plans (Create & manage evaluation plans — "1.0" model)
- RB: https://learn.sessionboard.com/evaluations/setting-up-round-based-evaluations (Sessions 2.0 round-based — the current model)
- EV-1: https://learn.sessionboard.com/evaluations/evaluators-how-to-evaluate-sessions (evaluator guide, 1.0 UI)
- EV-2: https://learn.sessionboard.com/evaluations/how-to-evaluate-sessions ("Evaluate sessions" — evaluator guide, 2.0 UI)
- SUM: https://learn.sessionboard.com/evaluations/evaluation-summary
- AI: https://learn.sessionboard.com/evaluations/ai-evaluations (out of scope for clone; documented for completeness)
- NAV: https://learn.sessionboard.com/get-started/navigate-evaluation-plans (Arcade demo embed only, no text)
- FAQ-A: https://learn.sessionboard.com/faq/will-evaluators-have-the-same-access-to-my-event-that-i-do-as-an-admin
- FAQ-E: https://learn.sessionboard.com/faq/evaluators (page now serves "Email your event team and evaluators" — see Gaps)
- VID: https://learn.sessionboard.com/videos/video-evaluation-plans (full narrated transcript of the 1.0 plan wizard)
- A/D: https://learn.sessionboard.com/sessions/accept-decline (how evaluation output feeds accept/decline)

**Two generations coexist in the KB.** "Evaluation Plans 1.0" (EP-1, EV-1, VID): one plan = one review pass, one rating scale + optional weighted rubric. "Sessions 2.0 round-based evaluations" (RB, EV-2): plans contain multiple rounds, each with its own scorecard, deadline, anonymization and evaluator pool; RB explicitly says round-based "replace[s] the single-stage evaluation model from the previous version" and that Parallel mode "mirrors the behavior of Evaluation Plans 1.0" (RB). Clone target should be the 2.0 model; 1.0 is documented here because the demo video only ever showed 1.0.

---

## 1. Purpose & actors

**Purpose.** "Evaluation Plans gather feedback on submitted sessions from evaluators using rating scales" (EP-1) — i.e., structured peer review of CFP submissions so admins can decide accept/decline. 2.0 generalizes this to multi-stage review: "Initial Screen → Peer Review → Committee Decision" (RB).

**Actors.**
- **Admin / plan owner** — full event access: creates forms, portal tasks, emails, evaluation plans, agenda, reports (FAQ-A). Builds plans, invites evaluators, assigns submissions, monitors progress, exports results, and flips session statuses in the Sessions module (A/D). An admin who is also listed as an evaluator can review from the plan's deep-dive "Review" tab (RB).
- **Evaluator** — deliberately limited access. FAQ answer to "will evaluators have the same access as an admin?": **"No. Evaluators have deliberately limited access to an event… Evaluators only have access to complete evaluation plans assigned to them"** (FAQ-A). They cannot see other evaluators' scores or comments (EV-2 FAQ; configurable in 2.0 via "Show Scores From Other Evaluators", RB), cannot communicate with speakers ("view-only access through their assigned plans", EP-1 FAQ), and their ratings/comments never reach submitters unless an admin chooses to share them (EP-1 FAQ, EV-2 FAQ).
- Plan types on creation: **Assign Evaluators** (human) or **Virtual Evaluators** (AI personas — out of scope) (EP-1, AI, VID 00:29).
- 1.0 also lets you assign "Evaluators, Evaluator Session Managers, and Admin Users" to a plan (EP-1) — three assignable user roles.

---

## 2. Flows

### 2a. Admin creates an evaluation plan

**Entry point (2.0):** Program → Evaluations → Evaluation Plans → **+ Add Plan** opens a 4-step wizard with sidebar nav (Overview / Rounds / Evaluators / Assignments); progress auto-saves; Continue→/←Back navigation (RB).

1. **Step 1 – Overview ("Name and basics")** (RB):
   1. **Name** (e.g. "My Evaluation Plan") + **Instructions** — rich-text editor, applies to the default Round 1.
   2. **Set Plan as Open** toggle — keep off while configuring; once on, evaluators with assignments can start immediately. In 1.0, opening the plan is what lets you set a **due date** (EP-1, VID 00:55: "Set plan is open. If enabled you can set a due date… Until then plans are view only to evaluators").
   3. **Review period**: **Opens** date (evaluators can begin) and **Closes** date ("deadline after which evaluators can no longer submit or modify their reviews") — per default round.
   4. **Additional settings** (all Round-1-scoped unless noted): **Enable Anonymized Review** (hides submitter/participant identity; 1.0 wording: "first and last names of session speakers are removed from submission details", VID 01:10) · **Enable Weekly Reminders** (automated Monday emails when sessions are pending, EP-1/VID 01:18) · **Include Uploaded Files** (evaluators can download session files) · **Include Sub-Sessions** (adds sub-sessions to plan scope) · **Show Scores From Other Evaluators** (evaluators see other reviewers' scores while reviewing).
   5. **Scoring Method**: **Percentage-based** (normalizes to /100% regardless of scorecard point totals — recommended for comparing across rounds with different scorecards) vs **Points-based** (total accumulated points).

2. **Step 2 – Rounds** (RB): default Round 1 exists; **+ Add round** for more. Per round: **Round Name**; **Round Type** (e.g. "Review Only" — **immutable after creation**); **Voting** = Reviewer Type (e.g. "Reviewers") + Voting Type (e.g. "Score Voting"); **Round Mode**: **Funnel** (default — submissions must be explicitly promoted to appear in the next round) vs **Parallel** (all submissions reviewed in every round simultaneously, no promotion; = 1.0 behavior). Docs warn to pick mode before creating rounds — switching later is disruptive. **Abstaining** per round: "Allow reviewers to abstain" (on by default) and "Require a reason when abstaining", with reason as free text or a fixed option list (fixed list recommended for conflict-of-interest reporting).

3. **Scorecard per round** (RB) — "+ Add Question", three groups (full type list in §3). Each round can have a completely different scorecard ("triage round might use a single 1-3 rating question, while your full peer review round might include three rating scales, a free-text justification field, and a recommendation dropdown").

4. **Reviewer View Configuration** (RB), four sub-sections: **Visible Fields to Reviewers** (all submission fields on by default; uncheck to hide; fields show their type — Text/Wysiwyg/Dropdown; common: ID, Type, Title, Description, Format, Tags) · **Filterable Fields for Reviewers** (only checkbox/dropdown/multi-select fields eligible; **"The category is always included and cannot be removed"**; optional: Format, Tags, Level, Language, Status, Submitter, Track, Location) · **Submission Card Fields** (Title always the heading; up to 3 extra fields, ordered) · **Visible Participant Fields to Reviewers** (which speaker/bio fields reviewers see).

5. **Step 3 – Evaluators** (RB): search-and-pick from **existing event users only** ("Evaluators must already be users on this event"; 1.0: "must be added to your event team", VID 01:41, and "the plan must be closed to assign them", EP-1). A **Rounds** checklist at top controls which rounds newly added evaluators are enrolled in. **"Send invite email to new evaluators"** toggle — applies only to evaluators added from that point on; existing evaluators are never re-emailed by it (resend via deep-dive → Evaluators tab → ⋯ → Resend invite email).

6. **Step 4 – Assignments** ("Who evaluates what") (RB): a per-round assignment-rule wizard (round selector top-right; left panel = current state snapshot, right panel = live **Impact Preview**). Three stages:
   - **Stage 1 — Which submissions?**: **All submissions in plan scope** / **By submission filters** ("narrow by standard and custom submission fields (status, format, tags, etc.). Use this to route specific types of submissions to the most relevant evaluators") / **Individual submissions** (pick by title/ID).
   - **Stage 2 — How distributed?**: **All to All** (every reviewer gets all filtered submissions) or **Individual Reviewer** (assign to specific reviewers). Optional **Workload constraints**: **Reviewers per submission** (max reviewers each submission gets) and **Max submissions per evaluator**. "When both workload constraints are off, each evaluator is assigned to every submission in scope." (The page's intro also names "Per Submission" and "Per Reviewer" as distribution modes — see Gaps.)
   - **Stage 3 — Review and apply**: Impact Preview shows Filtered submissions / Evaluators in this round / New Assignments. "When applying" conflict policy: **Add to existing** (add pairs only) / **Replace not-yet-reviewed** (drop non-matching in-scope assignments with no review activity) / **Replace all (including reviewed)** (drops even started reviews — flagged Caution). Button: "Assign [X] submissions to [Y] evaluators"; saves immediately.

   **Category/track-based routing — answered:** there is no automatic router or round-robin-by-expertise feature. Routing is admin-configured filtering, two ways: (1) 1.0 pattern — plan-level **Session filters** ("track, tags, format, level, language or status. For example, create one plan for each track and assign evaluators to a plan based on their area of expertise", VID 01:55–02:12; EP-1 "Filter by standard and custom session fields to assign specific submissions"); (2) 2.0 pattern — assignment rules "By submission filters" per round, best practice: "route specific types of submissions (by language, format, level, etc.) to the most relevant evaluators" (RB). Fair distribution comes only from the two workload caps, which the system spreads automatically.

**1.0 wizard, for reference** (VID transcript; EP-1): 6 pages — (1) Type: Assign Evaluators; (2) Config: title, instructions, the 4 toggles (open/due date, anonymized, weekly reminders, uploaded files); (3) Evaluators via checkboxes; (4) Session filters; (5) Display fields: session fields + speaker fields checkboxes, plus **custom evaluation questions** ("e.g., a 'Would you recommend this session?' dropdown, external/internal comment boxes" EP-1; per-question ⋯ menu: required, help text; reusable fields under Content → Fields); (6) **Grading options** (**cannot be edited once the plan is created**, EP-1): rating icon — face/number icons max 1–5, star/heart icons max 1–20, icon color customizable (VID 03:04–03:19); optional **rubric** = weighted criteria that must total 100% via sliders, max 255 chars per criterion, "each criterion is weighted and contributes to an overall average score" (VID 03:23–03:41); **evaluation limit** = max evaluations per submission, capped by evaluator count ("if four evaluators are assigned… each submission can be reviewed a maximum of four times", VID 03:44–04:04).

**Plan list actions** (RB; EP-1): Review (if admin is also a reviewer) · Edit · **Open/Close** (1.0 offers "Open and notify evaluators" or "Open and do not send notifications", EP-1) · **Export Results** — *Individual Grades Report* (every evaluator's responses per submission) or *Cumulative Grades Report* (aggregated per submission) · Duplicate ("useful for running similar evaluations across multiple tracks") · Notify (evaluators; 1.0: "Notify New Evaluators") · Delete (permanent, removes all associated data).

### 2b. Evaluator experience end-to-end

1. **Invitation.** 1.0: email from `no-reply@sessionboard.com` (or event-specific sender), subject "[Event Name] Evaluator Invitation", with a **View Event** button (EV-1). 2.0: admin adds them in the backend (optionally triggering the invite email, RB); evaluator visits the event's **Program Site** URL and uses passwordless login — enter email → **Send login link** → click emailed link; "No password or account setup is required" (EV-2).
2. **Access.** Only their assigned plans; view-only over the event; no contact with speakers; results invisible to them beyond their own review (FAQ-A, EP-1 FAQ, EV-2 FAQ).
3. **My Reviews** (2.0): left-nav page listing all assigned plans across programs. Plan card: name, **Active/closed** badge, number of rounds, overall progress + submission count, and each round with its own assignment count and **deadline** (EV-2).
4. **Round view**: round name, reviewed/pending counts, deadline (date+time), expandable **Reviewer Instructions** banner; assigned submissions as cards (title, short description, **Pending Review** / **Reviewed** badge). Sidebar: **Quick Jump** (Pending / Reviewed counts, clickable) and **Filters** — keyword search plus admin-enabled dropdown filters, e.g. Track, Language (EV-2).
5. **Scoring UI** (EV-2; screenshot `v2-evaluator-score-submission.png`): two-pane page. Left = **Submission Details** (only admin-whitelisted fields; e.g. Title, Description, Tags, Level, Language, Track) + **Participant Details** (hidden if anonymized). Right = **Score Submission** scorecard: dropdowns, free-text fields (with char counter), rating scales ("e.g., 1 to 5, 1 to 10"), file uploads; required questions marked `*`. Bottom: **Save Review** button + "**Go to next submission after saving**" checkbox; unsaved-changes yellow banner. 1.0 differs: scale selections **auto-save**, optional comment box, finish with blue **Save & Next**; a progress meter climbs to 100% as they work through the plan (EV-1). Neither generation has an evaluator-facing accept/decline verdict — a recommendation is just another scorecard/evaluation question if the admin adds one (EP-1 "Would you recommend this session?" dropdown; RB "recommendation dropdown").
6. **Conflicts of interest — Abstain.** Toggle at top of the scorecard labeled "Conflict of interest or cannot review" (EV-2). Abstaining removes the submission from the evaluator's pending count and "notifies your administrator that you did not score it" (EV-2 FAQ). Admin controls per round: allow/disallow abstaining, require a reason, free-text vs fixed reason list (RB). 1.0 had the same abstain concept "if a submission is a conflict of interest" (EV-1).
7. **Editing.** Reviews are editable any time **while the round is open**; "Once the round closes, evaluations are locked and cannot be modified" (EV-2 FAQ).

### 2c. Rounds: advancement and close

- **Funnel plans:** submissions advance only by explicit promotion. Two places: Sessions → Submissions **Promote / Demote** actions (funnel plans only), or plan deep-dive → **Rounds tab** → select submissions → **Bulk action** dropdown → *Promote to next round* / *Demote to previous round* (RB). No auto-advance rule (score threshold, top-N) is documented — promotion is a manual admin decision informed by scores (see Gaps).
- **Parallel plans:** no promotion; every submission sits in every round; admins move submissions between "round buckets" on the Rounds tab if needed (RB).
- **Round close:** each round has its own Opens/Closes window; at close, evaluators can no longer submit or modify (EV-2, RB). Nothing else is documented as happening automatically at close (no auto-promotion, no auto-notification) — see Gaps.

### 2d. Score roll-up and accept/decline

- **Per-submission aggregate:** the deep-dive **Submissions tab** lists ID, Title, Evaluators, Progress, **Avg score**, Status, in Grouped or Flat views (RB). Plan-level scoring method decides units: percentage of 100% or total points (RB). In 1.0 rubrics, weighted criteria "contribute to an overall average score" (VID 03:27).
- **Event-level Summary** (SUM; RB): # of Evaluations · # of Evaluated Sessions · # of Evaluation Plans (incl. AI plans) · # of Evaluators; Highest & Lowest scoring session; **Completion Status chart** (% complete vs incomplete plans); **Average Session Score by Plan** bar graph; **Top 10 Sessions** ranked by average score; **"Thought-Provoking" Sessions** = widest spread between an evaluator's highest and lowest score ("submissions that may be more subjective"). 2.0 adds Started / In progress / Complete metrics, tracked separately for **Assignments** and for **Evaluators** (RB).
- **Exports:** Individual Grades Report and Cumulative Grades Report (RB, EP-1) — the raw material for committee meetings.
- **Decision:** accept/decline is NOT part of the evaluation module. "Admins review the submission — along with any evaluator feedback from Evaluation Plans — to approve or deny it" in the **Sessions module** by clicking the status chip (bulk supported); statuses: Accepted / Accepted queue / Pending / Decline queue / Declined; status changes never auto-email — admins send accept/decline emails separately (A/D). Ratings never flow to speakers automatically (EP-1 FAQ).

---

## 3. Inventory

**Plan-level settings (2.0):** Name · Instructions (rich text) · Set Plan as Open · Review period Opens/Closes · Enable Anonymized Review · Enable Weekly Reminders · Include Uploaded Files · Include Sub-Sessions · Show Scores From Other Evaluators · Scoring Method (Percentage-based | Points-based) (RB).
**Plan-level settings (1.0 only):** plan type (Assign Evaluators | Virtual Evaluators) · due date (when open) · rating icon (faces/numbers 1–5, stars/hearts 1–20, custom color) · rubric (weighted criteria, sliders summing to 100%, ≤255 chars each) · evaluation limit (max evaluations per submission ≤ evaluator count) · session filters (track/tags/format/level/language/status + custom fields) · display fields (session + speaker) · custom evaluation questions with required/help-text options (EP-1, VID).

**Round settings (2.0):** Round Name · Round Type (immutable; e.g. "Review Only") · Reviewer Type (e.g. "Reviewers") · Voting Type (e.g. "Score Voting") · Round Mode (Funnel | Parallel — plan-wide behavior) · Abstaining (allow on/off; require reason on/off; reason = free text | fixed option list) · per-round Scorecard · per-round Reviewer View Configuration (RB).

**Scorecard question types (2.0)** (RB): Scoring — **1-3 Scale**, **1-5 Scale**, **1-10 Scale**, **Numeric Score** (custom min/max), **Custom Dropdown** ("custom options with point values, e.g. Accept = 3, Revise = 2, Reject = 1"); Input — **Free Text**, **File Upload**; Layout — **Separator**.

**Assignment rule (2.0)** (RB): submission target (All in plan scope | By submission filters | Individual submissions) × distribution (All to All | Individual Reviewer) × workload caps (Reviewers per submission | Max submissions per evaluator) × apply policy (Add to existing | Replace not-yet-reviewed | Replace all including reviewed). Intro copy also names "Per Submission" and "Per Reviewer" modes (see Gaps).

**Statuses:** Plan: Open/Active | Closed (RB, EV-2). Evaluator-side submission: Pending Review | Reviewed | Abstained (EV-2). Progress metrics (assignments and evaluators separately): Started | In progress | Complete (RB). Session decision statuses: Accepted | Accepted queue | Pending | Decline queue | Declined (+ custom statuses via Program settings) (A/D).

**Summary metrics:** # Evaluations, # Evaluated Sessions, # Evaluation Plans, # Evaluators, Highest/Lowest scoring session, Completion Status chart, Average Session Score by Plan, Top 10 Sessions, Thought-Provoking Sessions, Started/In progress/Complete (SUM, RB).

**Plan actions:** Review · Edit · Open/Close (± notify) · Export Results (Individual | Cumulative Grades Report) · Duplicate · Notify evaluators · Delete (RB, EP-1). Deep-dive tabs: Submissions · Rounds · Evaluators (⋯: Resend invite email, Edit assignments, Remove from plan) · Review (RB).

**AI Evaluations (out of scope, exists in product)** (AI): plan type "Virtual Evaluators"; AI personas ("technical expert, first-time attendee, executive decision-maker") created in Program settings; same grading options as 1.0 (rating icon + weighted rubric); results improve with Event Details (type, website, location, theme); generate now or later via ⋯ → Regenerate Evaluations; AI plans get a blue icon; same Individual/Cumulative exports; unlimited plans/personas/regenerations; closed AI processing model, no training on customer data.

---

## 4. Screenshots

All downloaded to `img/05-evaluations/` (37 files, verified with `file` — 36 PNG + 1 GIF). Source URL pattern: `https://learn.sessionboard.com/images/kb/<original-name>`; original names kept in the mapping below.

**Admin — 2.0 plan wizard (from RB):**
| File | Caption | Original |
|---|---|---|
| `v2-plan-wizard-overview.png` | 4-step wizard sidebar (Overview/Rounds/Evaluators/Assignments) | `ad8a1524-image-png-Apr-14-2026-07-06-56-2478-PM.png` |
| `v2-overview-name-instructions.png` | Overview step: name, Set Plan as Open, instructions editor | `ef0a5243-image-png-Apr-14-2026-07-07-19-9277-PM.png` |
| `v2-overview-additional-settings.png` | Additional settings toggles + review period | `a1decf30-image-png-Jun-24-2026-09-40-02-7445-PM.png` |
| `v2-rounds-step.png` | + Add round control (small crop) | `5eff8935-image-png-Apr-14-2026-07-10-44-9443-PM.png` |
| `v2-round-voting-settings.png` | Round basic info + voting settings | `10b37613-image-png-Apr-14-2026-07-10-19-0414-PM.png` |
| `v2-round-mode-funnel-vs-parallel.png` | Funnel vs Parallel round mode picker | `78246bba-image-png-Jun-24-2026-09-44-40-4357-PM.png` |
| `v2-scorecard-question-types.png` | Add Question menu: scales, numeric, dropdown, text, file, separator | `c04cac69-image-png-Apr-14-2026-07-12-48-4449-PM.png` |
| `v2-visible-fields-to-reviewers.png` | Visible Fields to Reviewers checklist w/ field types | `e9e395a0-image-png-Apr-14-2026-07-13-14-5688-PM.png` |
| `v2-filterable-fields-for-reviewers.png` | Filterable fields (category locked on) | `0b7015ae-image-png-Apr-14-2026-07-13-29-6263-PM.png` |
| `v2-submission-card-fields.png` | Submission card: title + up to 3 fields | `0ae5a0bf-image-png-Apr-14-2026-07-13-41-9624-PM.png` |
| `v2-visible-participant-fields.png` | Visible participant/speaker fields | `c7050c35-image-png-Jun-24-2026-09-48-53-8626-PM.png` |
| `v2-evaluators-step.png` | Evaluator picker + rounds enrollment + invite-email toggle | `7c477a97-image-png-Apr-14-2026-07-17-29-1746-PM.png` |
| `v2-resend-invite-email.png` | Evaluators tab ⋯ menu: Resend invite email | `22e48ae3-image-png-Jun-24-2026-09-51-01-2589-PM.png` |
| `v2-assignment-stage1-which-submissions.png` | Assignment rule stage 1: scope/filters/individual | `542bf3aa-image-png-Jun-24-2026-09-56-25-6009-PM.png` |
| `v2-assignment-stage2-distribution.png` | Stage 2: All to All / Individual Reviewer + workload caps | `6a0c0b68-image-png-Jun-24-2026-09-56-57-9819-PM.png` |
| `v2-assignment-stage3-impact-preview.png` | Stage 3: Impact Preview + apply policy | `f336605d-image-png-Jun-24-2026-09-57-43-3841-PM.png` |
| `v2-plan-deep-dive-view.png` | Deep-dive tabs: Submissions/Rounds/Evaluators/Review, Avg score column | `f8a6ee48-image-png-Jun-24-2026-09-59-24-7446-PM.png` |
| `v2-summary-page-metrics.png` | Summary: Started/In progress/Complete for assignments & evaluators | `2a037621-image-png-Jun-24-2026-10-01-48-8781-PM.png` |

**Evaluator — 2.0 (from EV-2):** `v2-evaluator-login.png` (Send login link) · `v2-evaluator-my-reviews.png` (plan cards w/ rounds+deadlines) · `v2-evaluator-round-view.png` (instructions banner, submission cards, badges) · `v2-evaluator-filters-sidebar.png` (Quick Jump + Track/Language filters) · **`v2-evaluator-score-submission.png`** (the scoring UI: left submission details, right scorecard with required dropdown/free-text w/ char counter, Abstain toggle, Save Review, "Go to next submission after saving" — the screen our demo never showed) · `v2-evaluator-abstain.png` (originals: `d2e5d006…`, `af4861c9…`, `fcbbb21d…`, `1b4e4d60…`, `bf344433…`, `d5d20d55…`, all `-Apr-14-2026-08-2x/3x…PM.png`).

**Evaluator — 1.0 (from EV-1):** `v1-evaluator-invite-email.png` (`c196266b-Screenshot-2024-12-04-at-4.23.13-PM.png`) · `v1-evaluator-plan-list.png` (`4c1f0682-Picture1.png`) · `v1-evaluator-session-details.png` (`856c361f-Picture2.png`) · `v1-evaluator-rating-ui.gif` (`2827fc60-Hubspot-Knowledge-Base-Article-Image.gif`, animated rating interaction) · `v1-evaluator-instructions.png` (`12cd2a24-Picture3.png`) · `v1-evaluator-rating-scale.png` (`4cc6a083-Picture4.png`) · `v1-evaluator-abstain.png` (`b63bb674-Picture5.png`) · `v1-evaluator-save-next.png` (`b3b5fdef-Picture6.png`).

**Summary & FAQ:** `summary-dashboard-overview.png`, `summary-nav.png`, `summary-metrics-charts.png` (SUM; originals `109eef64…`, `e2c6daf9…`, `9fbdb498…`) · `faq-admin-access.png`, `faq-evaluator-access.png` (FAQ-A; `7ff56299…`, `f9338e4e…`).

---

## 5. Gaps (docs leave unclear)

1. **Distribution modes contradiction (RB):** the intro lists "four distribution modes: All to All, Per Submission, Per Reviewer, or Individual Reviewer", but the Stage-2 UI (text + screenshot) shows only **All to All** and **Individual Reviewer** plus the two workload caps. Most likely "Per Submission"/"Per Reviewer" were folded into the caps ("Reviewers per submission" / "Max submissions per evaluator"). Clone decision: implement 2 modes + 2 caps.
2. **Enum values undocumented:** Round Type options besides "Review Only"; Voting Type options besides "Score Voting"; Reviewer Type options besides "Reviewers" (RB gives each only as "e.g."). Also unknown: whether the caps auto-balance randomly, by load, or round-robin — no algorithm is documented.
3. **Round close behavior:** only "evaluations are locked" is documented (EV-2). No auto-promotion, threshold rules, notifications at close, or what Avg score means when some evaluators never finished. Promotion criteria are entirely manual/human.
4. **Aggregation math:** how percentage normalization treats unanswered optional questions, how abstentions affect Avg score/progress, whether Custom Dropdown point values are averaged with scales, and how multi-round scores combine into one plan-level number — none specified. "Thought-Provoking" is described only as "wide range… from the highest and the lowest score" (SUM) — exact spread formula unknown.
5. **Anonymization scope:** 1.0 removes speaker first/last names (VID); 2.0 says "hides submitter and participant identity" (RB) — the exact field set masked (photos? bios? company?) is not enumerated, and it coexists confusingly with "Visible Participant Fields to Reviewers".
6. **`faq/evaluators` URL rot:** that URL now serves an article titled "Email your event team and evaluators" (add evaluators to Contacts to email them; adding them as contacts does not change permissions). The original evaluator-FAQ content is gone; evaluator FAQs now live inline in EV-2.
7. **NAV page is an Arcade interactive demo** (`https://demo.arcade.software/MpUhwqdnf37G0TEYcsP0`) with zero text — not scrapeable via GET.
8. **1.0 vs 2.0 conflicts to resolve in the clone:** EP-1 FAQ says evaluators can never see others' comments, but 2.0 adds an opt-in "Show Scores From Other Evaluators" (scores only? comments too? — unstated). 1.0 auto-saves ratings; 2.0 requires explicit Save Review. 1.0 grading options are immutable post-creation; no equivalent immutability statement exists for 2.0 scorecards (only Round Type is immutable).
9. **No evaluator-facing recommend-accept/decline primitive:** any "recommendation" is just a scorecard dropdown the admin builds. The demo-video open question about a built-in verdict field: it does not exist in the docs.
10. **Due-date enforcement details:** deadlines shown with date+time (EV-2) but timezone handling is unspecified.
