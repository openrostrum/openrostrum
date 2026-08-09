# Abstract Management (Review Depth & Disposition) — feature reference

## What this is

This documents SessionBoard's Abstract Management behavior as the target for clones to
reproduce. SessionBoard runs the academic-style submission lifecycle end-to-end:
organizers build custom submission forms per category with conditional logic, file
uploads, and optional submission payments; authors submit abstracts with co-authors and
custom participant roles (Author, Co-author, Panelist, Discussant) and track status.
Review runs through Evaluation Plans containing multiple independent rounds (e.g. Initial
Review, Final Review, Committee Decision), each with its own scorecard (numeric, dropdown,
text, file-upload fields), open/close dates, anonymization settings (single/double blind),
and reviewer pool. External reviewers score through a branded magic-link portal; AI
Evaluators can optionally provide first-pass numeric scores with reasoning that humans can
override. Chairs monitor a real-time progress dashboard, send bulk reminders, view
aggregate scores, record dispositions (accept, reject, waitlist, request revision), and
accepted abstracts convert to sessions that flow into the agenda builder with metadata
intact.

**Ownership split within this eval kit:** the `call-for-papers` spec owns form building,
the submitter portal, submitter accounts, basic single-round review, and accept/reject
dispositions. This spec (`abstract-management`, prefix ABS) owns review-and-disposition
*depth*: multi-round evaluation plans with round-specific scorecards/dates/reviewer pools,
anonymized/blind review, weighted scoring criteria, reviewer assignment at scale (caps,
auto-distribution, progress dashboards, bulk reminders), aggregate score tables and
sorting, co-author handling, conflict-of-interest, scoring exports, and AI-assisted triage
where claimed.

## Personas & user journeys

Personas from the research: organizer/program chair (admin), submitter/author,
co-author/presenter (listed with a role), reviewer (external, magic-link portal), and
committee member (views aggregate scores to decide).

### 1. Author submits an abstract with co-authors (submitter/author)

Steps:
1. Open the event's public abstract submission page.
2. Choose submission type/track (e.g. Research Paper vs Poster) — form fields adjust via conditional logic.
3. Fill title (required), abstract body, custom fields (keywords, track dropdown), upload supporting file.
4. Add co-authors with name/email and assign roles (Co-author, Presenter).
5. Pay submission fee if configured (or apply promo code).
6. Submit and land on confirmation; submission appears in author's dashboard with status "Submitted".

Filled state: author dashboard listing 1-3 submissions with titles, types, statuses
(Submitted / Under Review / Accepted), each detail view showing abstract text, uploaded
file, and a participants list with roles.

### 2. Chair configures a multi-round evaluation plan (organizer/program chair)

Steps:
1. Open review/evaluation settings and create an Evaluation Plan.
2. Add Round 1 "Initial Review" with open/close dates, double-blind anonymization, and a scorecard (numeric 1-5 Originality, dropdown Recommendation, text Comments).
3. Add Round 2 "Final Review" with a different scorecard and reviewer pool.
4. Assign submissions to reviewers by track, set per-reviewer limits, preview assignments, confirm.
5. Optionally enable an AI Evaluator persona for first-pass scoring.

Filled state: evaluation plan screen showing 2+ named rounds with distinct dates,
scorecards, anonymization flags, and reviewer pools; assignment matrix showing reviewers
with counts of assigned submissions.

### 3. Reviewer scores assigned abstracts via portal (reviewer)

Steps:
1. Open reviewer portal via magic link (no password/account).
2. See queue of assigned abstracts with completion status.
3. Open an abstract — author names hidden if round is blinded.
4. Fill scorecard: numeric ratings, dropdown recommendation, text comments.
5. Submit evaluation; item marked complete in queue.

Filled state: reviewer dashboard with 4-6 assigned abstracts, 2 marked complete with
scores visible, remaining pending; open review showing filled scorecard.

### 4. Chair reviews scores, decides, and builds the program (organizer/program chair)

Steps:
1. Open progress dashboard: per-reviewer/per-round completion rates; send bulk reminders to laggards.
2. Open results view with aggregate scores per submission (human + AI, with AI reasoning).
3. Set dispositions: Accept, Reject, Waitlist, or Request Revision; personalized notifications fire.
4. Accepted abstracts convert to sessions with metadata intact and appear in the agenda builder.
5. Accepted speakers auto-invited to speaker portal.

Filled state: results table of 8-10 submissions with average scores, reviewer counts,
disposition badges in mixed states; agenda builder showing accepted sessions with
titles/speakers carried over.

## Feature inventory

Features marked "CFP spec" are documented here for completeness but are graded by the
`call-for-papers` spec per the ownership split.

| Feature | Must-have? | Graded in | Description | UI expectations |
|---|---|---|---|---|
| Custom submission forms | Yes | CFP spec | Custom forms with flexible fields, conditional logic, file uploads; different form types per submission category. Title is the only required field. | Admin form builder (add/reorder fields, field types, branching rules); public form with text inputs, dropdowns, file upload, conditional fields |
| Co-author and participant roles | Yes | This spec (ABS-11) | Collect authors, co-authors, presenters directly in the form with custom participant roles: Author, Co-author, Panelist, Discussant, or any custom label; multiple participants per submission. | Add-participant control in the form; participants list on submission detail with name, email, role badge |
| Submitter status tracking, edit and withdraw | Yes | CFP spec | Authors track status and receive updates at every stage; can edit and withdraw before/until review begins (inferred from category norms). | Author dashboard with status labels; edit and withdraw actions on own submissions |
| Multi-round evaluation plans | Yes | This spec (ABS-01, ABS-02) | Each plan contains multiple independent rounds (Initial Review, Final Review, Committee Decision); each round has its own scorecard, open/close dates, anonymization settings, and reviewer pool. | Admin plan screen with named rounds, per-round date pickers, scorecard selector, anonymization toggle, reviewer-pool picker |
| Configurable scorecards | Yes | This spec (ABS-03, ABS-04) | Scorecard fields support numeric ratings, dropdown scoring, qualitative text, and file uploads; rubrics can vary by session/submission type. Weighted criteria and aggregation method are (inferred) — marketing mentions weighted criteria only for AI personas. | Scorecard editor with field types; reviewer-side rendering of numeric scales, dropdowns, text areas |
| Reviewer assignment | Yes | This spec (ABS-05, ABS-06) | Assign specific submissions to specific reviewers, filter/assign by track, set per-reviewer review limits, preview assignments before confirming. Per-reviewer limit UI specifics are (inferred). | Assignment screen: multi-select submissions, pick reviewer(s), limit setting, assignment preview, confirm |
| Reviewer portal (magic link) | Yes | CFP spec (basic portal); depth here | Reviewers access a branded dashboard via magic link — no account/password — to read abstracts, score, comment. Link expiry/security details (inferred). | Passwordless entry; queue with pending/complete indicators; abstract pane plus scorecard side-by-side |
| Anonymization / blind review | No | This spec (ABS-07) | Single- or double-blind, configurable per round; blinded reviewers cannot see author identity or other reviewers' evaluations. | Per-round anonymization setting; reviewer view with author names/affiliations stripped |
| Review progress dashboard | No | This spec (ABS-08, ABS-09) | Real-time dashboard: which reviewers are on track, which rounds are open, completion rates; bulk reminders to reviewers with outstanding assignments. | Progress metrics per reviewer and per round; select-and-remind bulk action |
| AI Evaluators | No | This spec (ABS-14, polish) | AI first-pass scoring with numeric score, reasoning, contextual notes; configurable personas with weighted criteria; humans override; activity logged. Whether it runs automatically or on demand is (inferred). | AI score with rationale on submission; persona configuration; override control |
| Conflict-of-interest / recusal | No | This spec (ABS-12, polish) | (inferred) Not mentioned anywhere in SessionBoard marketing — included as a category norm from peer-review tools (OpenReview/EasyChair) per the kit's ownership assignment. | Declare-conflict/recuse control in the reviewer scoring view; flagged or reassigned submission |
| Disposition and decisions | Yes | CFP spec (accept/reject); aggregates here (ABS-10) | Committee views aggregate scoring data and comments; submissions accepted, rejected, waitlisted, or sent for revision; decisions logged. Exact disposition vocabulary and aggregation method (average vs weighted) are (inferred). | Results table with aggregate scores; disposition controls; persistent status badges |
| Automated stage notifications | Yes | CFP spec | Automated communications at each stage: confirmations, decision notifications, personalized acceptance/rejection, reviewer reminders. | Notification templates tied to decision events; visible confirmation after submission |
| Abstract-to-session conversion | Yes | CFP / agenda specs | Accepted abstracts become sessions with metadata intact, flowing into agenda builder, speaker portal, content management; multiple abstracts can merge into one session (merge mechanics (inferred)). | Convert/promote action or automatic flow; agenda listing sessions with carried-over metadata |
| Submission payments | No | CFP spec | Payments within the form; 100+ gateways, promo codes, VAT; PCI-compliant. | Payment step with price, promo-code field adjusting total, gateway checkout |
| Reporting and analytics | No | This spec (ABS-13, exports only) | NL report queries, custom dashboards, shareable password-protected reports, exportable reports on real-time submission and reviewer data. | Reports area with submissions/scores table; share/export controls; optional NL query box |
| Audit trail | No | Not graded here | Full submission-to-agenda audit trail; every stage, decision, and evaluation activity logged. | History/activity log with timestamped stage changes |

## Rubric rationale

- **ABS-01 (w3, auto):** Multiple independent rounds are the defining feature of this area versus basic CFP review; fully verifiable by configuring two rounds and reloading.
- **ABS-02 (w2, auto):** Per-round reviewer pools are explicitly documented but the area survives without them; verifiable from pool configuration screenshots.
- **ABS-03 (w3, auto):** All three documented scorecard field types are core to any review workflow; verifiable end-to-end (editor → reviewer render → stored values) in one browser.
- **ABS-04 (w1, auto):** Weighted criteria are (inferred) — the research evidences weights only for AI evaluator personas and lists the aggregation method as an explicit gap — so despite sitting in this area's ownership they carry polish weight, like the other inferred item ABS-12; the 4-vs-2 score split makes weighted math (≈3.33) distinguishable from a plain average (3.0) automatically.
- **ABS-05 (w3, auto):** Targeted assignment is pointless if the reviewer queue doesn't reflect it exactly; the deliberately unassigned third submission gives a crisp negative check.
- **ABS-06 (w2, auto):** At-scale tooling (caps/auto-distribute/track filters) is documented but any one mechanism suffices; presence-and-exercise is browser-verifiable.
- **ABS-07 (w2, auto-partial):** Blind review is a documented non-must-have; the agent can contrast blinded reviewer vs organizer views, but cross-reviewer score isolation needs a second simultaneous account — hence the manual half.
- **ABS-08 (w2, auto):** Progress dashboard is documented as non-must-have; before/after completion counts across S2/S3 make accuracy objectively checkable.
- **ABS-09 (w2, auto-partial):** The reminder UI and its confirmation are verifiable; actual email delivery is not (agent cannot read inboxes), so that half is manual.
- **ABS-10 (w3, auto):** Aggregate score tables with sorting are the committee's decision surface — the area's payoff; two submissions with known distinct aggregates make both math and sort order judgeable.
- **ABS-11 (w2, auto):** Co-author roles are a documented must-have feature, but assigned to this spec only for the review-side handling; verified in both speaker and organizer views.
- **ABS-12 (w1, auto):** Conflict-of-interest is (inferred) — absent from all SessionBoard sources and included as a category norm per the kit's ownership split — so polish weight with a presence-based pass.
- **ABS-13 (w2, auto-partial):** Scoring exports are documented; the agent can trigger the download but cannot open files, so file-content verification is manual per the kit's export policy.
- **ABS-14 (w1, auto-partial):** AI Evaluators are an optional documented capability — graded only if the clone claims it (polish weight); reasoning quality needs human judgment, hence the manual half.

## Sources

- https://www.sessionboard.com/products/abstract-management
- https://www.sessionboard.com/products/call-for-papers
- https://www.sessionboard.com/blog/abstract-management-software
- https://www.sessionboard.com/capabilities/ai-evaluators

Research fetch note: primary URL fetched OK with rich content; three internal links
followed OK; one web search confirmed co-author roles and disposition/withdraw/waitlist
behavior. No screenshots were accessible (text-only extraction), so UI layout expectations
are inferred from copy and category conventions.
