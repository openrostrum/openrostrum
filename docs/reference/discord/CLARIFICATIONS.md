# Discord clarifications — organizer answers (captured 2026-08-08)

Server "Kill My SaaS", read in full: 3 channels (#announcements, #general, #sf-coworking). Screenshot of the key exchange: `general-swyx-qa-full.png`.

**#announcements** — 4 swyx posts only: brief + walkthrough + sessionboard.com links (already have), SF/NYC coworking, and "@everyone good questions with replies after" pointing to the #general Q&A below. No new requirements, no attachments beyond link thumbnails. **No follow-up video posted yet** (swyx said he'd try to record one today — watch this channel).

**#sf-coworking** — logistics only (office at 425 Brannan, SF; Sat 4:30–6pm, Sun 9am–6pm). Nothing to build from.

**#general** — community chatter + one critical Q&A. No Sessionboard UI screenshots were posted by anyone (only a competitor's tweet image, swyx's ai-devblog skill link, and another entrant "Tyler"'s CONTEXT.md file — a competitor's work, deliberately not used).

---

## THE Q&A — Ali Zaid asked, swyx.io answered (Sat Aug 8, 14:09→14:18), verbatim

> **swyx.io** replying to Ali Zaid:

1. **"for forms, is basic conditional logic enough or do you expect more complex rules?"**
   → **"conditional fine for now"**
2. **"for category routing, should submissions automatically go to specific reviewers?"**
   → **"yes talks are submitted to one or more tracks, and reviewes [reviewers] review one or more tracks"**
3. **"for reviews, what's the minimum workflow you expect?"**
   → **"minimum workflow is just go from 'unreviewed' -> 'approve/maybe/deny'. bonus is being able to email speaker from inside the app to ask for changes/attach feedback when sending the approve/deny decision"**
4. **"after accepting an abstract, should speaker/session/tasks be created automatically?"**
   → **"yes"**
5. **"for speaker onboarding, what are the must-have tasks?"**
   → **"example shown in video is — 1) hotel stay requirement form, 2) flight reimbursement form. other optional task examples, 3) finalize talk description 4) finalize bio/photos, 5) announce participation, 6) invite colleagues with speaker discount"**
6. **"do emails/calendar invites need to actually work, or can they be stubbed?"**
   → **"yes they should work on an MVP basis (it's easy to setup with cloudflare email or resend). obviously they can be done in depth. i will try to record a followup video today showing this further."**
7. **"for accelevents, should we mock the integration if we don't have api access?"**
   → **"skip accelevents its fine, like i said its not required"**
8. **"for the schedule, is day/room + drag-and-drop + conflict detection enough?"**
   → **"yes that is enough"**
9. **"for the agentic part, is a small useful agent enough since admin ui is the priority?"**
   → **"yes correct admin ui is the priority"**

> closing: "GREAT clarifications, thank you it shows you are serious about this"

Other swyx remark in #general (context on the judges): end users **"are not technical at all; they are event production professionals that just want to use software to make their lives easier"** — the eval is partly putting our build in front of them. Reinforces: usability by non-engineers is the bar.

---

## What this CHANGES in our scope (impact analysis)

| # | Answer | Scope impact |
|---|--------|--------------|
| 1 | Basic conditional logic is enough | Confirms P1 "question rules" is right-sized. No change. |
| 2 | Talks→one-or-more **tracks**; reviewers→one-or-more **tracks**; auto-route to reviewers | **"Category routing" is now a confirmed requirement, and precisely defined.** Submissions carry ≥1 track (many-to-many, not the single-select dropdown we assumed); reviewers are assigned ≥1 track; the system routes each submission to reviewers whose tracks overlap. Data model: submission⇄track M:N, reviewer⇄track M:N. Promotes track-based reviewer routing from P1-inference to a P0/P1 requirement. |
| 3 | Min review = **unreviewed → approve / maybe / deny**; bonus = email speaker with feedback on decision | **Major de-scope of evaluations.** The floor is a **3-state decision per reviewer**, NOT the full Sessionboard scorecard (scales/criteria/rounds from doc 05). Scorecards/rounds drop to bonus. Adds a new bonus: compose+send an email to the speaker (request changes / attach feedback) at decision time — dovetails with our "email from inside app" and the accept/decline flow. |
| 4 | Accept an abstract → **auto-create speaker + session + tasks** | **New P0 workflow requirement.** Acceptance is not just a status flip: it provisions the Session record, the Speaker/participant records, and assigns the onboarding task set. This is the spine connecting review → portal → agenda. Must be explicit in the build. |
| 5 | Must-have tasks = **hotel stay form + flight reimbursement form**; optional: finalize talk desc, finalize bio/photos, announce participation, invite colleagues w/ discount | Concrete seed content for the tasks module. Two must-haves are **portal forms** (hotel, flight reimbursement) → validates the "portal form attached to a task" flow (doc 07) as in-scope, not optional. Seed these exact tasks in the demo. |
| 6 | Emails **and calendar invites must actually work** (MVP), Cloudflare Email or Resend | **Confirms calendar invites are required, not stubbed** — and that Sessionboard lacking them makes it a clean differentiator. Locks the email provider choice (Resend or Cloudflare Email). Elevate P1 #1 (.ics) toward P0. Follow-up video incoming will show depth. |
| 7 | Skip Accelevents | Confirms OUT. No change. |
| 8 | day/room + drag-drop + conflict detection is enough | Confirms agenda scope exactly; don't gold-plate (no week/month needed for the floor). Week/Month demote to bonus. |
| 9 | Small useful agent is enough; **admin UI is the priority** | Agent stays bottom-of-P2. Build the admin UI well first. A tiny agent (e.g. "draft accept/decline email", "suggest schedule slot") is a sufficient nod. |

## Net effect
- Evaluations get **simpler** (3-state decision floor) — reclaim time.
- Two things get **promoted to required**: track-based routing (many-to-many), and accept→auto-provision(speaker+session+tasks).
- Calendar invites confirmed **required** (MVP) — and remain our headline differentiator.
- Onboarding tasks have a **concrete must-have list**, two of which are portal forms.
- Watch #announcements for swyx's follow-up video (emails/calendar depth).
