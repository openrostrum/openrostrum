# Build-screen reference index — every page/flow we will create → its screenshot

Answers "do we have a screenshot for every single page/flow to create?" — mapped against the actual build list (SCOPE.md P0/P1/P2), not Sessionboard at large. Compiled 2026-08-08 after the 4-agent hunt.

**Verdict: yes — every screen we build has at least one reference shot.** Sources are either **swyx's own sandbox** (`reference/video-frames/`, the exact instance judges replay) or the **Feb–Jul 2026 `learn.sessionboard.com` KB** (`reference/hunt/guidde-round2/kb-screenshots/`, the newest UI), backed by round-1 Guidde (`reference/guidde/`) for field detail. **Two exceptions, both non-issues** (see bottom): the enumerated email merge-tag dropdown list, and the calendar-invite (.ics) — neither is a screen we can copy from Sessionboard.

Legend: 🟢 have a clear latest-version shot · 🟡 have a shot but older-gen or partial (field detail still valid) · ⚪ nothing to copy (we design/build beyond).

## Admin — app shell & dashboard
| Screen (we build) | Tier | Shot? | Best path |
|---|---|---|---|
| Login / auth | P0 | 🟢 | swyx frames; standard |
| Left-rail nav + top bar | P0 | 🟢 | `video-frames/f_027,f_033`; KB `get-started/` |
| Dashboard — Today (stat cards, status row, alerts) | P1 | 🟢 | `video-frames/f_033`; brief.pdf; SCOPE Appendix J |
| Dashboard — Speaker Tracking (outstanding tasks) *(firm part of req 6)* | P0 | 🟢 | brief.pdf + `f_033`; KB `reporting/` |

## Admin — form builder (7-step wizard, P0 #1)
| Step / control | Shot? | Best path |
|---|---|---|
| Submission Setup (Abstracts vs Sessions, participants toggle, roles) | 🟢 | KB `applications/building-your-submission-form/01–02.png`; `f_045` |
| Welcome Screen | 🟢 | KB `…/03.png`; `f_045` |
| Session/Abstract Information (fields, required, reorder) | 🟢 | KB `…/04–05.png`; `f_048` |
| Add Question / Create New Field dialog | 🟢 | KB `…/05,07.png`; guidde `01-form-builder/` |
| **Question Rules (conditional logic) modal** | 🟢 | KB `…/06.png`+`22.png`; `targeted/02-question-rules/` |
| Participant Information (+ role Min/Max, Total-across-roles, Unique Contact Settings) | 🟢 | KB `…/10–14.png`; `f_049,f_050` |
| Payments & Fees *(we omit building, but documented)* | 🟢 | KB `…/15–20.png`; `f_053` |
| Form Settings (Close Date, reminders, limit, drafts, success msg, auto-redirect) | 🟢 | KB `…/19–20.png`; `f_055` |
| Admin Notifications (notify pickers + submitter/admin templates) | 🟢 | KB `…/21.png`; `f_057,f_059` |
| Preview / publish + Copy Link | 🟢 | KB `…/23.png`; `f_060` |
| Forms list (cards, tabs, ⋯ menu) | 🟢 | KB `applications/create-applications/`; SCOPE App. C |

## Public CFP flow — submitter-facing (P0 #2)
| Screen | Shot? | Best path |
|---|---|---|
| Welcome | 🟢 | `video-frames/f_061` |
| Account (login / signup / forgot) | 🟢 | `f_062,f_063` |
| Submission step (title/desc/dropdowns, validation) | 🟢 | `f_064,f_065` |
| Participant step (role-count enforce, per-speaker fields) | 🟢 | `f_067` |
| Review → Submit | 🟢 | `f_067`→`f_069` |
| **Success page** (thank-you msg + Continue to portal) *("make sure this works")* | 🟢 | `f_069` (verified) |
| Save-as-draft + resume | P1 | 🟢 | KB `participants/save-a-submission-as-a-draft/` (4) |

## Speaker portal — speaker-facing (P0 #3, req 2)
| Screen | Shot? | Best path |
|---|---|---|
| Home (My Submissions + status pills, Profile card, Tasks) | 🟢 | `f_071`; KB `participants/updated-portal/` |
| Submissions tab | 🟢 | `f_073` |
| **Profile (bio editor, name, links, headshot)** *("update your own bio")* | 🟢 | `f_075` (verified); KB `participants/` |
| Tasks tab | 🟢 | `f_071`; KB `faq/how-to-track-task-completion-in-the-event-portal/` |
| Portal form fill (task-attached form, e.g. hotel/flight) | 🟡 | guidde `07-portal-forms/`; KB `portals/create-assign-forms/` |
| Portal file upload / download | 🟢 | KB `participants/pp-how-to-view-and-download-files-from-my-portal/` |

## Admin — submissions review (P0 #4)
| Screen | Shot? | Best path |
|---|---|---|
| Submissions table + status tabs (incl. Withdrawn/Drafts) | 🟢 | `f_027,f_037,f_041`; `targeted/05-withdrawn-status/`; guidde `04-*` |
| Inline status change (pill → dropdown → Save) | 🟢 | guidde `04-*`; KB `sessions/accept-decline/` |
| Add Submission drawer (Details/Participants) | 🟢 | guidde `04-create-session/`; SCOPE App. F |
| Accept → auto-provision speaker+session+tasks | ⚪ | *our workflow (Sessionboard does it implicitly); no single screen to copy* |

## Admin — evaluations (P0 #5, P1 #10)
| Screen | Shot? | Best path |
|---|---|---|
| Evaluation Plans list | 🟢 | `f_077,f_080`; KB `evaluations/` |
| Plan create wizard (rounds/grading/filters) | 🟢 | KB `evaluations/setting-up-round-based-evaluations/`; guidde-playbooks `guidde-eval-plans-2.0/` |
| **Evaluator scoring pane** (Abstain/COI, questions, Save Review) | 🟢 | KB `evaluations/how-to-evaluate-sessions/05.png`; webinar `videos-round2/keepers/abstract_0680s.png` |
| Our 3-state approve/maybe/deny UI | ⚪ | *simplified floor per organizer — we design it* |

## Admin — agenda (P0 #6, P1 #9)
| Screen | Shot? | Best path |
|---|---|---|
| List view | 🟢 | `f_083`; guidde `06-agenda/` |
| Day / Rooms grid + drag from Unscheduled | 🟢 | webinar `keepers/abstract_1055s.png`; guidde `06-agenda/` |
| Conflict detection (red clock, Conflicts tab) | 🟢 | webinar `keepers/aicontent_1760s,1880s.png` |
| Agenda Settings (day start/end, per-format duration, room visibility) | 🟢 | guidde `06-agenda/`; KB `sessions/` |
| Week/Month/Track views | P1 | 🟢 | guidde `06-agenda/` |

## Admin — tasks & portals (P0 #7, P1 #8)
| Screen | Shot? | Best path |
|---|---|---|
| Portal appearance/config | 🟢 | guidde `07-portal-appearance/`; KB `settings/portal-settings/` |
| Tasks admin (create/assign) | 🟢 | guidde `07-tasks/`; KB `portals/assign-tasks/` |
| Portal Forms admin (create; hotel/flight) | 🟢 | guidde `07-portal-forms/`; KB `portals/create-assign-forms/` |
| File Requests admin (create) | 🟢 | guidde `07-file-requests/`; KB `portals/collect-documents/` |
| **File-request approve/deny + group-by** | 🟢 | KB `portals/collect-documents/18–25.png`; `targeted/04-file-request-review/` |

## Admin — emails & calendar (P0 #8, req 3)
| Screen | Shot? | Best path |
|---|---|---|
| Email Templates list | 🟢 | `f_031`; KB `communications/`, `settings/email-templates/` |
| Template editor (subject/body, type, merge-tags button) | 🟢 | KB `communications/email-campaigns/`; guidde `03-email-templates/` |
| Send-email wizard (bulk accept/decline, ≤100) | 🟢 | guidde `03-sending-emails/01–10` |
| Rendered transactional emails (confirmation/accept/decline/reminder) | 🟡 | content we author; template shots cover the editor |
| **Enumerated merge-tag dropdown (opened list)** | ⚪ | *unpublished anywhere — design from `{{{tag}}}` syntax we captured* |
| **Calendar invite (.ics) attachment** | ⚪ | *Sessionboard has none — differentiator, standard .ics, nothing to copy* |

## Admin — settings & taxonomies (P1 #5)
| Screen | Shot? | Best path |
|---|---|---|
| Event Settings — Event Details | 🟢 | `f_029`; KB `settings/`; SCOPE App. B |
| Library — Tags / Tracks / Formats / Levels | 🟢 | guidde `08-session-settings/`, `08-event-settings/`; KB `settings/` |

## P2 — embeds (bonus)
| Screen | Shot? | Best path |
|---|---|---|
| Embeds list | 🟢 | guidde `06-embeds/`; KB `sessions/embeds` |
| Embed editor (style/filters/fields) | 🟢 | `f_087`; guidde `06-embeds/` |
| Live preview + Get Code + session modal | 🟢 | `f_089,f_091` |

---

## The only things without a copy-able screenshot (and why it's fine)
1. **Enumerated email merge-tag dropdown list** — the opened per-type list is TinyMCE-populated and published nowhere. We have the button, the per-Type scoping, and the real `{{{recipient.first_name}}}`-style syntax; we author the list ourselves from the field model. Not a judge-visible screen.
2. **Per-speaker calendar invite (.ics)** — Sessionboard *has no such feature* (confirmed: zero .ics-per-speaker in its entire KB). Requirement 3 is a build-beyond differentiator; a standard .ics attachment has no original to mirror.
3. A few **our-own** screens (3-state review UI, accept→auto-provision, .ics) are intentional design, not clones — flagged ⚪ above.

Everything else — the entire judge-replay path and all firm-requirement depth — has a real reference image, most of them from the latest (Feb–Jul 2026) UI or swyx's own sandbox.
