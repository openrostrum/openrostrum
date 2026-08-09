# Eval-kit crosswalk — rubric ID → owner

Maps every rubric item in swyx's v1 judging harness
(`docs/reference/killmysaas-evals/specs/*.yaml`, vendored 2026-08-09) to the
SCOPE commitment and route that owns it. **Reviewers verify against this**: a
feature is not done until its rubric items' `pass_criteria` hold on the running
instance. Weights: 3 = core, 2 = important, 1 = polish; pass=1, partial=0.5.
Area score = weighted %; overall = aggregate over the six REQUIRED areas
(speaker-crm is optional/extra-credit and excluded). **<60% coverage voids the
headline score** — the "Judging-harness readiness" list in SCOPE.md protects
coverage, not points.

Scoring mechanics worth exploiting: the kit accepts an **in-app email
log/outbox** as evidence for email items (our email history page = auto-pass
path for CFP-08 etc.), and `not_found` counts against us while `cannot_judge`
doesn't — never hide a feature, and never gate one behind an emailed link.

## 01 Call for Papers (37 pts)

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| CFP-01 | 3 | Form builder: 3 field types, required flags, public validation | P0 #1/#2 — `admin.forms.$formId` + `submit.$eventSlug.$formId` |
| CFP-02 | 2 | Conditional field on Format selection, both directions, no reload | P1 #2 — `questionRule.trigger {kind:'builtin'}` (G3 fix) |
| CFP-03 | 3 | Public portal logged-out: event name, deadline, tracks/formats | P0 #2 — banner + dropdowns |
| CFP-04 | 3 | Past close date ⇒ portal blocks new submissions | `forms.closeAt` gate (register: forms lifecycle) + K3 (accepts past dates) |
| CFP-05 | 3 | Speaker signup → submit → confirmation → dashboard w/ status | P0 #2/#3 |
| CFP-06 | 3 | Data round-trips intact to organizer list + detail | P0 #4 — `admin.submissions` |
| CFP-07 | 1 | Draft with title only + resume | P1 #4 + K1 (title-only draft save) |
| CFP-08 | 2 | Confirmation email arrives (or in-app email log) | P0 #8 + email history page (`admin.emails.history`) |
| CFP-09 | 2 | Speaker edits submitted proposal; organizer sees edit | **P1 #19 (new)** |
| CFP-10 | 2 | Reviewer provisioned w/ usable credentials; role-scoped dashboard | P0 #5 + K5 (copyable invite link) + `reviews.tsx` |
| CFP-11 | 2 | Rating + comment persists, visible to organizer, completion state | P0 #5 floor + P1 #10 (numeric rating) |
| CFP-12 | 3 | Accept/reject decisions, distinct statuses in list | P0 #4 |
| CFP-13 | 2 | Decisions propagate to speaker dashboard | P0 #3 (queues masked as Pending; finals visible) |
| CFP-14 | 2 | Decision notification emails w/ templates, dispatch confirmed | P0 #4/#8 — bulk send + `notifiedAt` |
| CFP-15 | 2 | Accepted submission becomes session w/ metadata, no re-entry | P0 #4 accept spine (`app/domain/accept.ts`) |
| CFP-16 | 2 | Editing locks after close | **P1 #19 (new)** |

## 02 Abstract Management (28 pts judged; ABS-14 N/A unless we claim AI)

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| ABS-01 | 3 | ≥2 rounds, own names/dates/scorecards, persists | P1 #10 — `evaluation_plans`/`evaluation_rounds` |
| ABS-02 | 2 | Per-round reviewer pools | P1 #10 — `round_evaluators` |
| ABS-03 | 3 | Scorecard: rating + dropdown + text; renders; stores | P1 #10 — `round_questions`/`evaluation_answers` |
| ABS-04 | 1 | Weighted criteria reflected in aggregate | P1 #10 — `round_questions.weight`; K8 formula |
| ABS-05 | 3 | Queue = exactly the assigned set | P1 #10 — pending `evaluations` rows ARE the queue |
| ABS-06 | 2 | At-scale assignment (caps / auto-distribute / track-filtered) | P1 #10 — assignment strategies mint `evaluations` |
| ABS-07 | 2 | Blind round: reviewer view hides identity; organizer sees it | P1 #10 — `evaluation_rounds.anonymized` |
| ABS-08 | 2 | Progress: per-reviewer assigned/completed counts, live | P1 #10 — progress view |
| ABS-09 | 2 | Bulk reminder to lagging reviewers | P1 #10 — remind action via EmailSender |
| ABS-10 | 3 | Aggregate per submission; sortable both directions | P1 #10 + admin table Rating column |
| ABS-11 | 2 | Co-authors w/ role labels persist to organizer views | P0 #2 participants + P1 #19 (add by edit) |
| ABS-12 | 1 | Conflict-of-interest recusal | P1 #10 — `evaluations.status='abstained'` |
| ABS-13 | 2 | Review scores export (CSV) | P2 #3 committed set — `admin.evaluation.export.csv` |
| ABS-14 | 1 | AI triage (only if claimed) | N/A — we don't claim AI review (P2 #7 skipped) |

## 03 Speaker Management (36 pts)

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| SPK-01 | 3 | Roster list w/ identity + search/filter | **P1 #17 (new)** — `admin.contacts` |
| SPK-02 | 3 | Manual add speaker; organizer edits persist | **P1 #17** |
| SPK-03 | 2 | CSV bulk import | **P1 #17** — `admin.contacts.import` |
| SPK-04 | 2 | Workflow status: change, persist, filter | **P1 #17** — `contacts.status` |
| SPK-05 | 2 | General tasks w/ due dates, multi-assignee | P0 #7 / P1 #8 |
| SPK-06 | 2 | Portal invitation control + logged send | **P1 #17** — invite button (K5 pattern) |
| SPK-07 | 3 | Portal scoped to own content | P0 #3 + K6 (email linking) |
| SPK-08 | 3 | Portal bio/social/headshot edits → organizer record | P0 #3 (swyx-emphasized) |
| SPK-09 | 2 | Portal tasks: due dates, mark complete, persist | P0 #7 |
| SPK-10 | 2 | Organizer sees/downloads speaker upload w/ metadata | P1 #3 — `files.$id` |
| SPK-11 | 2 | Session assignment visible both sides | P0 #4 spine + portal My Submissions |
| SPK-12 | 2 | List-level task progress, mixed statuses | P0 #7 dashboard (firm req 6) |
| SPK-13 | 3 | General bulk email to selected speakers + history log | **P1 #17** — `admin.contacts.compose` + email history |
| SPK-14 | 2 | Merge fields + per-recipient resolved preview | **P1 #17** + merge-tag renderer (`app/lib/email-render.ts`) |
| SPK-15 | 1 | Travel/logistics field persists | **P1 #17** — `contacts.logisticsNotes` |
| SPK-16 | 2 | Automated task-due reminder emails (manual check) | **P1 #17** — task-due cron + `reminderSentAt` |

## 04 Content Management (34 pts)

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| CNT-01 | 3 | File-request task w/ instructions + due date | P1 #8 — `tasks.isFileRequest` |
| CNT-02 | 3 | Portal upload recorded against the task | P1 #3 — `files.upload` |
| CNT-03 | 2 | Speaker scoping; admin routes blocked | G1 fix — self-auth everywhere |
| CNT-04 | 3 | Re-upload = new version; latest marked; old accessible | **P1 #3 un-cut** — `files.version` UI |
| CNT-05 | 2 | Cross-role comments on a file | **P1 #3 un-cut** — `file_comments` |
| CNT-06 | 1 | Upload UI states type/size constraints | P1 #3 spec line |
| CNT-07 | 3 | Deliverables dashboard: per-speaker per-task, filters, uploads | P0 #7 dashboard |
| CNT-08 | 2 | Bulk reminder to outstanding + confirmation | **P1 #18** — dashboard remind action |
| CNT-09 | 3 | Central session title/abstract edit persists | P0 #4 — `admin.submissions.$id` |
| CNT-10 | 2 | Admin edits speaker bio/headshot | P1 #17 — `admin.contacts.$id` |
| CNT-11 | 2 | Change history w/ attribution + restore | **P1 #18** — `submission_revisions` |
| CNT-12 | 3 | Approval status gates public output | **P1 #18** — `submissions.contentStatus` (K10) |
| CNT-13 | 2 | Central files library w/ metadata + version count | **P1 #18** — files pages |
| CNT-14 | 3 | Multi-select bulk ZIP of latest versions | **P1 #18** — `admin.files.export.zip` |

## 05 AI Agenda (18 pts — "basics only")

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| AIA-01 | 3 | Multi-day builder: time × rooms, day nav | P0 #6 |
| AIA-02 | 2 | Rooms/tracks creatable, immediately usable | P0 #0 Library + P1 #5 |
| AIA-03 | 3 | Placement persists across reload | P0 #6 |
| AIA-04 | 3 | Speaker double-booking warning | P0 #6 conflict detection |
| AIA-05 | 2 | Room overlap blocked/flagged | P0 #6 |
| AIA-06 | 2 | Moves clear conflicts | P0 #6 |
| AIA-07 | 2 | Publish action + public handoff | **P1 #16c** — `events.agendaPublishedAt` (K11) |
| AIA-08 | 1 | Any one-action assisted placement | **P1 #9** — greedy "Auto-place remaining" |

## 06 Public Widgets (36 pts — CORE despite the brief's strikethrough)

| ID | W | Criterion (short) | Owner |
|----|---|-------------------|-------|
| EMB-01 | 3 | Sessions list card anatomy + Show more | **P1 #16a** — `sessions.$eventSlug` |
| EMB-02 | 2 | Search matches titles AND speaker names | **P1 #16a** |
| EMB-03 | 2 | Faceted filters (Track; +Format/Location for full credit) | **P1 #16a** |
| EMB-04 | 3 | Speakers directory: photo/name/title/company, by surname | **P1 #16b** — `speakers.$eventSlug` (K8 ordering) |
| EMB-05 | 2 | Speaker detail: bio + their sessions; name search | **P1 #16b** |
| EMB-06 | 3 | Agenda grid: day/time/room structure, correct placement | **P1 #16c** — `schedule.$eventSlug` |
| EMB-07 | 2 | Day navigation re-renders sessions | **P1 #16c** |
| EMB-08 | 2 | Session detail: full time range, room, Back restores | **P1 #16c** |
| EMB-09 | 3 | Itinerary: day tabs, chronological, full card | **P1 #16d** — `itinerary.$eventSlug` |
| EMB-10 | 1 | Personal schedule add/star → exact set | **P1 #16d** (K9: localStorage) |
| EMB-11 | 1 | Personal schedule survives reload; .ics export | **P1 #16d** + `feeds…agenda.ics` |
| EMB-12 | 3 | Gallery photo grid, search, missing-photo fallback | **P1 #16e** — `gallery.$eventSlug` |
| EMB-13 | 2 | Gallery card detail w/ sessions; close restores grid | **P1 #16e** |
| EMB-14 | 3 | All five surfaces fully public, no login | **P1 #16** + `// @public` + homepage links |
| EMB-15 | 2 | Embed area: snippet/URL per type, formats + config | **P1 #16** — `admin.embeds` + `embed.$publicId` + feeds |
| EMB-16 | 2 | Cross-surface + organizer-side consistency, no republish | Free — SSR reads D1 live |

## 07 Speaker CRM — OPTIONAL (extra credit only; excluded from overall)

Stays OUT per swyx + kit both marking it optional. Revisit only if everything
above is green before Aug 11 EOD (CRM-01/05/10 reuse roster + import + contact
record work from P1 #17).

## Not scored by the kit (kept on their own merits)

Airtable (P1 #15 — owner-committed requirement), performance (brief-level
tiebreaker), .ics calendar invites on acceptance (P0 #8 differentiator),
Cloudflare infra + Forge mirror (brief bonuses), compat API (P1 #20).
