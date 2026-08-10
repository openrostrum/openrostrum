# Verification record — how sure are we about each Faithful/Partial screen?

Answering the question "do we *really* understand every screen we plan to clone or partially clone?" — with evidence, not assertion. Completed 2026-08-08.

## What we verified against (evidence tiers, strongest first)

1. **Live form-definition JSON** (`../../reference/public-form-definition.json`) — Sessionboard's own API response describing the sandbox submission form: exact sections, fields, roles, limits, and every toggle. Authoritative for the public submission flow.
2. **Official step-by-step walkthroughs** — Sessionboard's KB `/videos/*` pages embed Guidde playbooks (screen recordings). We extracted **18 module walkthroughs → 300 annotated screenshots + full narration** (`../../reference/guidde/`, narration in `ALL-CAPTIONS.md`). This is the actual admin UI, screen by screen — the evidence we previously lacked for the agenda-in-use, the evaluation scoring setup, and the portal admin flows.
3. **Walkthrough video frames** (`../../reference/video-frames/`) — swyx's own demo, fully scene-sampled.
4. **KB article screenshots + text** (`../img/*`) and the **OpenAPI spec**.

Seven agents each read the actual screenshots for their modules and produced a field-level confirmed inventory with per-screen confidence and residual unknowns:

| Doc | Modules verified | Screens graded High |
|-----|------------------|--------------------|
| [A-form-builder-contact.md](A-form-builder-contact.md) | Submission form builder (37 shots), Create contact (12) + live JSON | builder 4-page wizard, field dialogs, contact modal |
| [B-review-sessions-settings.md](B-review-sessions-settings.md) | Add-session drawer, accept/decline + status machine, session settings taxonomies (38) | status machine, 6 taxonomies, bulk flow |
| [C-evaluations.md](C-evaluations.md) | Evaluation plan wizard (18) | 6-step plan wizard, grading, rubric |
| [D-agenda-embeds.md](D-agenda-embeds.md) | Agenda (populated!) + conflicts + settings, embeds (28) | all 5 views, conflicts, embed wizard |
| [E1-portal-tasks-forms-files.md](E1-portal-tasks-forms-files.md) | Portal tasks, portal forms, file requests (51) | create + assign-to-portal model |
| [E2-portal-appearance-custom.md](E2-portal-appearance-custom.md) | Portal settings/appearance, custom portals, portal files (49) | segmentation, Always-Show-Tasks, field lock |
| [F-emails-settings-files.md](F-emails-settings-files.md) | Email templates, sending emails, event settings, session files (67) | send wizard, template fields, file constraints |

**Verdict:** every Faithful and Partial screen now rests on direct visual evidence. Confidence is **High** on essentially all of them, with a short list of genuinely-unobservable residual unknowns below (things that sit below the fold in the recordings or require a Sessionboard admin login we don't have).

---

## Corrections the verification forced (these override earlier docs/SCOPE)

Each is now reflected in `SCOPE.md`, the relevant flow doc, and the coverage map.

**Form builder**
- ⚠️ **Superseded structural claim — build the 7-step builder per `SCOPE.md` P0 #1 / [`VERSION-NOTE.md`](VERSION-NOTE.md).** For the record, the *newest* Sessionboard UI generation showed a 4-page wizard (Welcome Screen → Session Information → Speaker Information → Form Settings; no Payments step; `cfp_payment_step_in_wizard: false`); the field detail below is what remains authoritative here.
- There is **no separate Notifications step**; admin-notify dropdowns + confirmation-email editor + reminder toggle all live inside **Form Settings**.
- Page-3 H1 is **"Contact Information"** (stepper label "Speaker Information"); speaker limit is a **−/+ stepper (default 6)** — narration claims a 15 cap, but the UI shows no cap, so treat 15 as unverified.
- Two "Unique Contact Settings" toggles: *Allow users to submit new information for existing contacts* (off) and *Notify existing contacts…* (on).

**Review / statuses**
- Exactly **5 statuses**: Accepted / **Accept Queue** / Pending / Decline Queue / Declined (fix the "Accepted Queue" typo). These double as the 5 **categories** every custom status maps to.
- Status changes **never email** (confirmed verbatim); queues render in the portal as an **orange pending icon with the name hidden**.
- Add-Session drawer **does surface custom fields at creation** (contradicts an earlier "can't set custom fields at creation" note).

**Taxonomies**
- Tags are **cross-entity** (shared across sessions + users, under the Content module). Tracks carry a **color** that paints agenda cards. Rooms have optional order + capacity (capacity hidden from speakers).
- **Per-format Default Duration** lives in Session Settings → Agenda (auto-fills a session's end time) — it is *not* a field on the Format record.

**Agenda / conflicts**
- Conflict detection is **speaker + room (location) only — no track collisions.** The brief's req 5 wording "across rooms and tracks" therefore includes a piece we'd *build beyond* Sessionboard. Conflict marker is a **red clock icon**. Month view drops track colors.

**Embeds**
- The five "types" (Agenda / Session List / Schedule Itinerary / Speaker List / Speaker Gallery) are **layouts under one Styled-HTML format** (formats: Styled HTML / HTML / JSON / XML / iCal), each emitted as one `<sessionboard-embed widget-type>` snippet.

**Evaluations**
- The KB walkthrough is the **1.0 six-step plan wizard** (Type → Configuration → Select Evaluators → Session Filters → Display Fields → Grading Options), **not** the 2.0 rounds/assignments model our `05-evaluations.md` was built around. Full fidelity = rating icon (stars/hearts to 20, faces/numbers to 5) + optional **weighted rubric summing to 100%** + custom evaluation questions + per-session eval limit. 4th config toggle = **Include Uploaded Files**. Section tabs = Summary / Evaluation Plans / My Evaluations / Personas (no separate Evaluators/Evaluator-Tags tabs — fixes SCOPE Appendix G).
- Routing is **one-plan-per-track** (plans literally named "Session Track A/B Evaluations", filter "Tracks IS Innovation"). Our "many-to-many track overlap" is a reasonable simplification, not a 1:1 match.

**Emails**
- Template Type labels are **Contacts / Exhibitors-Sponsors / Sessions**. Merge tags are **`{{{triple-brace}}}` tokens** (e.g. `{{{recipient.first_name}}}`, `{{{event.name}}}`, `{{{starts_at}}}`), not `[BRACKET]`. Sender resolves to `no-reply@sessionboard.com`. Send is a 3-step **Setup → Review → Send** wizard with a rich recipient-type taxonomy and ≤100/batch.

**Portals**
- **`Always Show Tasks` off ⇒ only accepted-session speakers see tasks/forms/file-requests** (non-accepted still see wiki/files) — our accepted-speaker recipe is exactly right.
- Field visibility is a **3-state model: hidden / editable / locked**, across four scope tabs (Contact Fields, Session Fields, Contact Participants, Group Participants).
- Extend Task Deadline is a **Final Deadline dropdown (default 7, max 31 days)**, not a fixed 31.
- Assign-to-portal is uniform for tasks/forms/file-requests: create under Portals ▸ [type] → portal `⋯` → Edit Tasks → **Assign items** step → matching widget (Assign Tasks / Collect Form Submissions / Collect Files) → Select & Save → Required toggle + ✎ (alias/due date/view-only) + Assign-By-Filter (session items). Portal forms email a **link + PDF of responses**.

---

## Residual unknowns — NOW CLOSED (2026-08-08 screenshot hunt)

The list below was the set of screens we couldn't observe. A 4-agent hunt found Sessionboard's rebuilt help center at **`learn.sessionboard.com`** (static screenshots dated Feb–Jul 2026 = newest UI) plus 2025–26 YouTube demos, and **closed 12 of 13**. Full evidence map with paths: [`../../reference/hunt/COVERAGE.md`](../../reference/hunt/COVERAGE.md).

- **Evaluator scoring widget** — ✅ FOUND. `hunt/guidde-round2/kb-screenshots/evaluations/how-to-evaluate-sessions/05.png`: Abstain/COI + Score Submission + per-question inputs + Save Review + go-to-next. Rubric-numeric variant in the webinar footage.
- **Question-rules (conditional logic) editor** — ✅ FOUND. Builder `06.png` (menu) + `22.png` (rules modal). **Participant role min/max** — ✅ FOUND. Builder `11–13.png` (per-role Min/Max + Total across all roles + Conditional participant limits).
- **File-request approve/deny loop + "group files by"** — ✅ FOUND. `portals/collect-documents/18–25.png`.
- **Withdrawn status** — ✅ RESOLVED. It IS a filter tab in the latest UI (`hunt/targeted/05-withdrawn-status/view-draft-submissions.png`); it's participant-driven, not one of the 5 assignable statuses. Drafts is likewise a filter tab.
- **Agenda drag mechanics** — ✅ FOUND (webinar frames: drag from Sessions sidebar + Conflicts tab). **Embed attendee-filter list** — ✅ FOUND (Track / Status / Format / Language / Tag / Location).
- **Merge-tag picker (enumerated list)** — ⚠️ STILL OPEN, and confirmed unavailable publicly: the button + per-Type scoping + `{{{triple-brace}}}` syntax are captured, but the opened dropdown is TinyMCE-populated and never published. Design-it-ourselves; not a fidelity gap.

## ⚠️ IMPORTANT: target the LATEST version — see [VERSION-NOTE.md](VERSION-NOTE.md)

We target the **LATEST** UI (per user, 2026-08-08). As of the 2026-08-08 hunt, the latest is captured directly from `learn.sessionboard.com` (Feb–Jul 2026 static images) + 2025–26 YouTube demos — no more inference. Two corrections that override this record's earlier text:
- The latest **form builder is 7 steps** (Submission Setup → Welcome → Session Information → Participant Information → Payments → Form Settings → Admin Notifications → Preview), now confirmed with images. An earlier "4-page builder" note described the *older* generation.
- The latest portal module is **"Portals" (People Portals / Group Portals)** — **NOT "Contact Portals"** (a naming error corrected on 2026-08-08). Evaluations latest = **2.0 round-based**.

Read the round-1 field inventories in A–F as "what controls exist"; take *page/step structure* from the newer sources (VERSION-NOTE.md + `hunt/COVERAGE.md`).
