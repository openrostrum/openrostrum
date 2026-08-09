# Which Sessionboard version are we cloning? — LATEST, always.

**Decision (user, 2026-08-08): target the LATEST available Sessionboard UI, not older generations.**

**Status (2026-08-08, after the 4-agent screenshot hunt): the latest UI is now captured directly.** We found Sessionboard's rebuilt help center at **`learn.sessionboard.com`**, whose articles embed static screenshots dated **Feb–Jul 2026** — the newest generation, as true in-product captures. Combined with 2025–26 YouTube demo footage, every module below is now backed by latest-version imagery. Full evidence map: [`../../reference/hunt/COVERAGE.md`](../../reference/hunt/COVERAGE.md).

Ground truth for "latest," in order: (1) `learn.sessionboard.com` static KB images (Feb–Jul 2026); (2) official YouTube demos (2025–26, esp. the "Future of Abstract Management" webinar showing the current app); (3) swyx's own walkthrough video + brief PDF. The round-1 Guidde playbooks (`../../reference/guidde/`) remain valid for **field-level detail** but their *page/step structure* is partly older-gen — superseded by the sources above.

## Per-module: what "latest" looks like, and how sure we are

| Module | LATEST (target) | Confirmed-latest evidence | Status |
|--------|-----------------|---------------------------|--------|
| **Form builder** | **7-step** wizard: Submission Setup (incl. participant roles + sub-session toggle) · Welcome · Session Information · Participant Information · Payments · Form Settings (General / Membership & Access) · Admin Notifications · (Preview/Publish) | KB `applications/building-your-submission-form/01–23.png` (Feb–Jul 2026) + webinar frames | ✅ confirmed w/ images |
| **Conditional logic** | "Question Rules" modal ("Show when *field* is *value*", + Add New Rule) | KB builder `06.png`+`22.png`; `faq/does-sessionboard-offer-conditional-logic`; video `conditional-logic` | ✅ confirmed |
| **Participant roles** | Per-role Min/Max + Total-across-all-roles + Conditional participant limits | KB builder `11–13.png` | ✅ confirmed |
| **Evaluations** | **2.0** round-based plans; scoring pane = Abstain/COI + plan questions (rating/dropdown/text) + Save Review; rubric-numeric variant also exists | KB `evaluations/how-to-evaluate-sessions/05.png` + `setting-up-round-based-evaluations/`; video `eval-plans-2.0` | ✅ confirmed |
| **Portals** | **"Portals" → People Portals + Group Portals.** NOT "Contact Portals" (that string does not exist in the UI). "Contacts" is a separate CRM nav item. Tabs: Portals \| Forms \| File Requests \| Tasks \| Resources \| Files | KB `portals/*`; video `portals-training-1` | ✅ confirmed + **naming corrected** |
| **File requests** | Approve (green) / Deny (red), Revision History, Revert-to-Pending, Group-files-by export | KB `portals/collect-documents/18–25.png` | ✅ confirmed |
| **Submissions / review** | 5 assignable statuses (Accepted / Accept Queue / Pending / Decline Queue / Declined) **+ Withdrawn & Drafts as filter tabs** | KB `sessions/*`; `targeted/05-withdrawn-status/view-draft-submissions.png` | ✅ confirmed |
| **Dashboard** | onboarding pipeline + stat cards + left-rail nav | swyx frames + KB/marketing | ✅ confirmed |
| **Agenda / conflicts** | drag from Sessions sidebar; dedicated **Conflicts** tab w/ hard constraints (no-speaker / no-room / room-capacity); 5 views | webinar frames + Guidde | ✅ confirmed |
| **Embeds** | filters = Track / Status / Format / Language / Tag / Location; formats = Styled HTML / HTML / JSON / XML / iCal | KB `sessions/embeds` | ✅ confirmed |
| **Email templates** | Type=Groups/Contacts/Sessions; `{{{triple-brace}}}` merge tags; Merge Tags button | KB `communications/*`, `settings/email-templates` | ✅ confirmed (see caveat) |
| **Event settings** | Event Details + taxonomies | swyx + KB | ✅ confirmed |

**No ⚠️ rows remain.** The one residual: the *enumerated* email merge-tag dropdown list (per template type) is TinyMCE-populated and not published anywhere public — a design-it-ourselves item, not a fidelity gap. The trial-login path is **no longer needed** for coverage.

## Naming correction (important)
Earlier notes here said the latest portal module is "Contact Portals." **That was wrong** — the latest UI calls it **"Portals"** (People Portals / Group Portals). Corrected across SCOPE, coverage-map, and memory on 2026-08-08.

## Build policy
Clone the latest as captured. Where the round-1 Guidde field inventories (`A`–`F`) and the newer KB disagree on *structure*, the newer KB / webinar wins; where they agree on *fields*, both are fine. Prefer the `learn.sessionboard.com` static images for pixel-level fidelity.
