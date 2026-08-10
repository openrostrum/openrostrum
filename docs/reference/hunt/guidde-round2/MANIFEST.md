# Sessionboard KB Hunt — Round 2 Manifest

Date: 2026-08-08. Source: Sessionboard's own help center, now a rebuilt **Astro/Starlight static site at `learn.sessionboard.com`** (old `support.sessionboard.com` 301s into it). The KB carries TWO screenshot sources:

1. **Static `/images/kb/*.png` screenshots embedded in text articles** — dated **Feb–Jul 2026**, the NEWEST UI available. This is where the LATEST 7-step builder, eval-2.0 scoring, payments, question-rules, participant min/max all live. 906 images / 122 pages downloaded to `kb-screenshots/`.
2. **Guidde playbooks embedded in `/videos/*` pages** — last updated Dec 2025–Jan 2026 (older than the static shots). 26 found; the 8 brand-new ones + eval-plans extracted to `guidde-playbooks/`.

## Generation verdict
- **Form builder: LATEST 7-step wizard CONFIRMED** in the static article `applications/building-your-submission-form` (Submission Setup → Welcome → Session Info → Participant Info → **Payments** → Form Settings → **Admin notifications**), incl. **"Use question rules"** + **"Conditional logic"** + participant **min/max**. Image 01 dated Jul-08-2026.
- **Evaluations: 2.0 round-based CONFIRMED** (`evaluations/setting-up-round-based-evaluations`, `evaluations/how-to-evaluate-sessions`, Guidde "Evaluation Plans" with Type/Grading Options/Rubric/Limits).
- **Portals: KB still uses "People Portals"/"Group Portals" terminology**, NOT "Contact Portals". The portal video Guidde says "People Portals". So the in-app "Contact Portals" rename (if it exists) is NEWER than anything published in the KB. Portal articles themselves are current (Feb 2026).

---

## A. Guidde playbooks found (26 total, all from `/videos/*`)

Round 1 saved no IDs/JSON. By step-count, 17 of round-1's 18 modules map 1:1 to a `/videos` playbook; round-1 `05-evaluations` maps to `video-evaluation-plans`. Raw JSONs were purged 2026-08-10 (captions fully extracted). Fully extracted (images+captions) = the 8 NEW + eval-plans (marked ✅).

| Playbook ID | KB page (/videos/) | Title | Gen | Steps | Extracted here | Maps to round-1 |
|---|---|---|---|---|---|---|
| mSrgwf2XuNfULw3SX8Aiqa | video-session-submission-form | Session Submission Form | prev-gen video | 37 | json only | 01-form-builder |
| rEt6nA7cjdb4SVgHvWSqnH | video-create-a-contact | Create A Contact | same | 12 | json only | 02-create-contact |
| 7WDRZdUJEXdK4z8pStnp7r | video-files | Portals - Files | same | 10 | json only | 02-portal-files |
| 7RmPk1DdcBMV5LsDsiTHeV | video-email-templates | Settings - Email Templates | same | 17 | json only | 03-email-templates |
| uT6CT5eKCbbFq6WL1UqCwa | video-creating-sending-emails | Creating & Sending Emails | same | 13 | json only | 03-sending-emails |
| r1B8UMZwVxqW9i2DgSJxJy | video-create-a-session | Create A Session | same | 8 | json only | 04-create-session |
| vkKfsrRbD6Zsvb41hxSdwS | decline-sessions | Accept/Decline Sessions | same | 9 | json only | 04-decline-sessions |
| nJpx5HfiUxvWwohNB7L13u | video-session-files | Session Files | same | 21 | json only | 04-session-files |
| m2MHSFoQJiQzXa1YgqDZM1 | video-evaluation-plans | Evaluation Plans (2.0) | NEW/eval-2.0 | 18 | ✅ guidde-eval-plans-2.0 | 05-evaluations (likely) |
| vh4SAkH4xhNe3U3jxXwqhz | video-agenda-building | Agenda Building | same | 18 | json only | 06-agenda |
| sJuU3xz5JGraG1huVJzEai | video-embeds | Embeds | same | 10 | json only | 06-embeds |
| s3J8i3k7FuDsXPjhZuJJ5M | video-custom-portals | Custom Portals (People/Group) | same | 18 | json only | 07-custom-portals |
| m8YXu5aEuekm8q8tEMRfAC | video-file-requests | Portals - File Request | same | 15 | json only | 07-file-requests |
| de9Z3PPy8JodJytXJRRbRP | video-portal-settings-appearance | Portal Settings & Appearance | same | 21 | json only | 07-portal-appearance |
| koHzQEph8dsYjhKefyhsKp | video-forms | Portals - Forms | same | 20 | json only | 07-portal-forms |
| tYE2hDtegCtrcuQKAQ6ofW | video-tasks | Portals - Tasks | same | 16 | json only | 07-tasks |
| h4KVhq3tQwNUgA6dGSQsh3 | video-event-settings | Settings - Event Details | same | 16 | json only | 08-event-settings |
| iwPQKGxWcKPziroAu1PLhn | video-session-settings | Session Settings | same | 21 | json only | 08-session-settings |
| **anWtweARikhkw3vuiKqoq2** | video (Fields) | **Fields Module** | **NEW** | 14 | ✅ guidde-NEW-fields-module | — |
| **79poToCifqmWGK3XiiDpuE** | video-ai-agenda-builder | **AI Agenda Builder** | **NEW** | 16 | ✅ guidde-NEW-ai-agenda-builder | — |
| **aitmgDpnTpz9CrM6iYcjwv** | video-ai-content-remix | **AI Content Remix** | **NEW** | 10 | ✅ guidde-NEW-ai-content-remix | — |
| **1qkZU4gaum2RibQaEBzAg7** | video-event-team | **Event Team (roles/permissions)** | **NEW** | 15 | ✅ guidde-NEW-event-team | — |
| **4RQ5YagaEsTtTNnKSN5BAi** | video-history | **History Module** | **NEW** | 14 | ✅ guidde-NEW-history-module | — |
| **p1PdWUyNGgG16534JtJUak** | video-reports | **Reports Module** | **NEW** | 16 | ✅ guidde-NEW-reports-module | — |
| **a7iHrDvAktH11WUopbEPmc** | video-settings-record-settings | **Settings - Record Settings** | **NEW** | 14 | ✅ guidde-NEW-record-settings | — |
| **qxHwqL1iMKR61sonsa1ikh** | wiki-pages | **Portals - Resources** | **NEW** | 11 | ✅ guidde-NEW-portal-resources | — |

Non-Guidde video embeds: `video-ai-evaluations` → YouTube `BXSO-KO35qs`; `portals-pro` → YouTube `6QhdvNAGPco`; `video-importing-data` → Loom `66d0dd40f87d446ab486e1656c25c39b`.

---

## B. 8 TARGET SCREENS — all FOUND (all in `kb-screenshots/`, latest UI)

1. **7-step form builder** — FOUND. `applications/building-your-submission-form/` (23 imgs). Payments step = `15.png` (When to Collect Payment), `16.png` Base Fee, `17.png` Pricing Rules, `18.png` Promo Codes. Notifications step = `21.png` (Admin notifications).
2. **Conditional-logic / Question Rules editor** — FOUND. `applications/building-your-submission-form/06.png` ("Use question rules" in field ⋯ menu) + `22.png` (the **Question Rules** modal: "Show when 3. Format is Lightning Talk", "Add rule from previous question"). Also `faq/does-sessionboard-offer-conditional-logic/` (2 imgs).
3. **Participant role min/max** — FOUND. `applications/building-your-submission-form/12.png` ("Participant roles": Speaker Min/Max, Chairperson, Moderator + "Total across all roles" Total min/max) and `13.png` (Conditional participant limits).
4. **Evaluations 2.0 + evaluator SCORING WIDGET** — FOUND. Plan/round setup: `evaluations/setting-up-round-based-evaluations/` (18), `evaluations/evaluation-plans` text + Guidde `guidde-eval-plans-2.0/`. **Scoring widget**: `evaluations/how-to-evaluate-sessions/05.png` ("Score Submission" panel: Abstain/COI, rubric fields, comment box 0/5, Save Review, Go to next submission) + `evaluators-how-to-evaluate-sessions/` (7 imgs, "My Reviews", round view). Note: rubric fields render as dropdown/select + text/comment; the star icon heads the panel.
5. **Contact/Custom Portals** — FOUND (labeled "People/Group Portals" in KB). Appearance/settings: `portals/creating-custom-portals/` (11), `portals/create-assign-forms/` (27), `portals/assign-tasks/` (13), `portals/task-assignment/` (13), `portals/assign-pages/` (7), `portals/share-files/` (6), Guidde `Portal Settings & Appearance`.
6. **File-request approve/deny + "group files by" folders** — FOUND. `portals/collect-documents/` (29): `14.png` Reviewing & Approving, `17.png` pencil-to-review, `18.png` "approve or deny…green and red icons", `19.png` Green check = Approved, `21.png` Revert to Pending. "Group files by" folder options appear in the export flow (`23–25.png`, "Files can be exported in one of two ways"). Also `sessions/enable-upload-download-content/` (19).
7. **Withdrawn status** — RESOLVED: **NOT a built-in status.** The Status dropdown (`sessions/session-settings/13.png`) lists only **Accepted, Accept Queue, Pending, Decline Queue, Declined**. "withdraw" appears nowhere in the KB. Admins CAN create a custom status (`session-settings/11–12.png`), so "Withdrawn" would only exist if manually added.
8. **Merge-tag picker + embed attendee-filter list** — FOUND. Merge tags: `communications/email-campaigns/11.png` ("Personalize with merge tags" sidebar — `{{first_name}}`, `{{reg_link}}`, `{{payment_amount}}`, `{{payment_confirmation}}`, `{{registration_promo_code}}`, `{{internal_speaker}}`, `{{w9}}`, `{{day_1_receipts}}`…) + `settings/email-themes/08–09.png`. Embed filter option list = **Track, Status, Format, Language, Tag, Location**; embed formats = Styled HTML / HTML / JSON-XML / iCal (`sessions/embeds`, Guidde only — no static imgs).

---

## C. Other high-value LATEST screenshots pulled (not in the 8, but new UI)
- `communications/automated-emails` (19), `email-campaigns` (14) — 5-step campaign wizard.
- `studio/ai-agenda-builder` (14) + Guidde AI Agenda Builder — the AI draft/generate flow.
- `studio/remix-session-speaker-content` (6) + Guidde AI Content Remix.
- `reporting/dashboard-views` (14) — filter operators; `event-team/invite-manage-event-team-members` (18) + Guidde Event Team — roles/permissions.
- `speaker-crm/*` (org-level CRM, pipeline, segments, advanced search).
- `awards/*` — full Awards product (separate submission form, reviewers/rounds, payments).
- `settings/importing-data` (16), `settings/language-translation-variant` (9), `settings/portal-settings`, `documents/document-generation` (10), `marketing/print-agendas` (11).

## D. Files in this folder
- `kb-screenshots/<section>/<page>/NN.png` + `CAPTIONS.md` (alt-text captions + source URLs) — 906 imgs / 122 pages.
- `guidde-playbooks/<name>/NN.png` + `CAPTIONS.md` (with narration) + `playbook.json` — 9 playbooks / 128 imgs.
- raw `json/` captures: purged 2026-08-10 after extraction.
- `kb_image_index.json` — page→(image URL, alt) index for the whole KB.
- `urls.txt`, `sitemap-0.xml` — full KB URL list (226 pages). `guidde-map.txt` — page→playbook-ID map.

## E. KB URLs crawled
All 226 URLs in `sitemap-0.xml`/`urls.txt` were fetched. 122 had static screenshots; 26 `/videos/*` pages had Guidde embeds. Key target pages: `applications/building-your-submission-form`, `faq/does-sessionboard-offer-conditional-logic`, `concepts/participant-roles`, `concepts/field-types`, `evaluations/{setting-up-round-based-evaluations,how-to-evaluate-sessions,evaluators-how-to-evaluate-sessions,evaluation-plans,ai-evaluations,evaluation-summary}`, `portals/{creating-custom-portals,collect-documents,create-assign-forms,assign-tasks,task-assignment,share-files,assign-pages}`, `sessions/{session-settings,accept-decline,embeds,enable-upload-download-content,submission-forms,draft-submissions}`, `settings/{submission-form-settings,email-templates,email-themes}`, `communications/{create-send-emails,email-campaigns,automated-emails}`.
