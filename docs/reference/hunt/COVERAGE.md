# Screenshot coverage — consolidated (2026-08-08, 4-agent hunt)

**Result: coverage is now essentially complete for the LATEST UI.** Every previously-missing or version-uncertain screen is backed by a real latest-version screenshot (or video frame). **One** item is genuinely unpublished anywhere public: the *enumerated* email merge-tag dropdown list per template type.

## The source that changed everything
Sessionboard rebuilt its help center as a static Astro site at **`learn.sessionboard.com`**. Its articles embed **static `/images/kb/*.png` screenshots dated Feb–Jul 2026 — the newest UI generation.** These are true in-product captures (not marketing composites), and they did not exist in the older Guidde-video KB we pulled in round 1. This single source resolved almost every gap.

Evidence tiers now, strongest first:
1. **`learn.sessionboard.com` static KB images (Feb–Jul 2026)** — `reference/hunt/guidde-round2/kb-screenshots/` (906 imgs / 122 pages). Newest UI, authoritative.
2. **Official YouTube demos (2025–2026)** — `reference/hunt/videos-round2/keepers/` (59 curated frames from the "Future of Abstract Management" webinar + AI demos + Portals training). Shows the app in motion (drag, wizard flow, conflicts).
3. **Live form-definition JSON** — `reference/public-form-definition.json` (field-level truth for the public submission form).
4. **Round-1 Guidde playbooks** — `reference/guidde/` (300 imgs). High fidelity but partly older-gen; use for field detail.
5. **Marketing/third-party** — `reference/hunt/thirdparty/` (48 imgs). Layout/color language only (stylized composites).

## Every previously-missing / version-uncertain screen → now

| # | Screen | Status | Best evidence (path under `reference/hunt/`) |
|---|--------|--------|----------------------------------------------|
| 1 | **Form builder — LATEST 7-step wizard** | ✅ FOUND | `guidde-round2/kb-screenshots/applications/building-your-submission-form/01–23.png` + `videos-round2/keepers/abstract_0430–0576s.png` |
| 2 | Builder **Payments** step | ✅ FOUND | `…/building-your-submission-form/15–20.png` (When to Collect / Base Fee / Pricing Rules / Promo Codes / General / Membership & Access) |
| 3 | Builder **Notifications** step | ✅ FOUND | `…/building-your-submission-form/21.png` (admin-notify pickers + Submitter/Admin notification templates w/ toggles) |
| 4 | **Question Rules / conditional-logic editor** | ✅ FOUND | `…/building-your-submission-form/06.png` (menu) + `22.png` (rules modal "Show when Format is Lightning Talk"); `targeted/02-question-rules/`; video `conditional-logic` keepers |
| 5 | **Participant role min/max** | ✅ FOUND | `…/building-your-submission-form/11–13.png` (per-role Min/Max, Total across all roles, **Conditional participant limits**); `targeted/03-participant-minmax/` |
| 6 | **Evaluations 2.0** (plans / rounds) | ✅ FOUND | `guidde-round2/kb-screenshots/evaluations/setting-up-round-based-evaluations/`; `guidde-round2/guidde-playbooks/guidde-eval-plans-2.0/`; video `eval-plans-2.0` |
| 7 | **Evaluator scoring widget** | ✅ FOUND (2 variants) | `…/evaluations/how-to-evaluate-sessions/05.png` (Abstain/COI + Score Submission + per-question inputs + Save Review + go-next). Rubric-numeric variant: video `keepers/abstract_0680s.png` (criteria → Total Score 61.11 + Recommendation dropdown + committee-comments) |
| 8 | **Portals** admin (create/assign/appearance) | ✅ FOUND | `…/kb-screenshots/portals/{creating-custom-portals,create-assign-forms,assign-tasks,share-files,assign-pages}/`; video `portals-training-1` |
| 9 | **File-request approve/deny loop + group-by** | ✅ FOUND | `…/portals/collect-documents/18.png` (approve green / deny red), `19.png` (Approved), `21.png` (Revert to Pending), `23–25.png` (Group files by, export); `targeted/04-file-request-review/` |
| 10 | **Withdrawn status** | ✅ RESOLVED (screenshot) | `targeted/05-withdrawn-status/view-draft-submissions.png` — tab strip: All · Accepted · Accept Queue · Pending · Decline Queue · Declined · **Withdrawn** · **Drafts** |
| 11 | **Merge-tag picker (opened list)** | ⚠️ PARTIAL — button+scoping+syntax found; enumerated list NOT public | `…/communications/email-campaigns/11.png` (merge-tag sidebar sample: `{{first_name}}`, `{{reg_link}}`, `{{payment_amount}}`…). Templates use `{{{triple-brace}}}` (video `email-templates-merge-tags`). Full per-type dropdown = TinyMCE-populated, unpublished. |
| 12 | **Agenda drag mechanics + conflicts** | ✅ FOUND | video `keepers/abstract_1055s.png` (drag from Sessions sidebar), `aicontent_1760s/1880s.png` (**Conflicts** tab + hard constraints: no-speaker / no-room / room-capacity) |
| 13 | **Embed attendee-filter list** | ✅ FOUND | KB `sessions/embeds`: filters = **Track, Status, Format, Language, Tag, Location**; formats = Styled HTML / HTML / JSON / XML / iCal |

**Net: 12 of 13 fully closed; 1 (merge-tag enumerated dropdown) is a design-it-ourselves item confirmed unavailable in any public source.**

## Corrections these findings force (override earlier docs)

1. **"Contact Portals" is WRONG.** The latest UI labels this module **"Portals"**, split into **People Portals** and **Group Portals**. "Contacts" is a *separate* CRM nav item. Three independent sources confirm (KB text, YouTube footage, targeted crawl); the string "Contact Portals" appears nowhere in the product. → fix SCOPE / VERSION-NOTE / coverage-map.
2. **The 7-step builder is the latest and is fully documented with images** (Feb–Jul 2026). The earlier "4-page builder" note described the *older* generation. Step rail: **Submission Setup (incl. participant roles + sub-session toggle) → Welcome → Session Information → Participant Information → Payments → Form Settings (General / Membership & Access) → Admin Notifications → Preview/Publish.**
3. **Withdrawn & Drafts are filter tabs, not assignable statuses.** There are **5 assignable statuses** (Accepted, Accept Queue, Pending, Decline Queue, Declined). Withdrawn is participant-driven (portal "Withdraw" button, gated by an "Allow Submission Withdrawal" setting); Drafts = pre-submission. Both appear as their own filter tabs.
4. **Evaluator scoring is configuration-driven** — it renders the plan's custom evaluation questions, each with its configured input (rating icon scale, dropdown, or text), plus an Abstain/COI control and Internal/External (or committee) comments. Both the icon-rating and numeric-rubric layouts are real; the plan's grading config selects which.
5. **Merge-tag syntax differs by surface:** Email **Templates** use `{{{triple-brace}}}` (e.g. `{{{recipient.first_name}}}`); Email **Campaigns** show `{{double-brace}}` (`{{first_name}}`). Treat as two systems.

## New modules the latest UI has that we did NOT previously scope (context)
Mostly out-of-scope for our clone, recorded so we don't mistake them for gaps: **Abstracts** (distinct from Sessions), **AI Submissions**, **AI Evaluators / Personas**, **AI Agenda Builder**, **AI Content Remix**, **Event Team** (roles & permissions), **History** (audit log), **Reports**, **Fields Module**, **Record Settings**, **Portal Resources**, **Documents / document-generation**, **SMS messaging**, **Email Campaigns**, an **Awards** submission module, and ~13 third-party integrations (Swapcard, Swoogo, Bizzabo, Stova, ON24, Grip…). The heavy **AI-agent** framing (Coordinator / Editor / Reviewer / Team Lead / Scout + MCP) is the headline of the 2025–26 redesign — explicitly out of scope per swyx and the struck-through brief clause.
