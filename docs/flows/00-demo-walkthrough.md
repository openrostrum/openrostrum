# Flow 00 — The demo walkthrough path (P0 acceptance script)

Source: swyx's walkthrough video (https://youtu.be/vUuK4Knl7oc), fully transcribed in `../reference/transcript.txt`; screenshots below are frames extracted from it (`../reference/video-frames/`, ~1 frame / 6s; `f_NNN` ≈ second `(NNN−1)×6`). This is the sequence judges will replay against our deployed site. Every step lists actor → action → expected behavior → screenshot.

Video timeline anchors: 0:00 intro/context · 0:46 sessionboard.com tour · 2:33 admin app tour · 4:27 form builder · 5:54 public submission (incognito) · 6:54 speaker portal · 7:42 evaluations · 8:17 agenda + embeds · 8:48 closing guidance.

---

## Part A — Admin: event & form setup

**A1. Admin opens the app on an existing event.**
Left rail shows Program tree (View All / Abstracts / Sessions / Files · Forms / Evaluation / Agenda / Invoices / Site · Portals / Tasks / Forms / File Requests / Resources / Files · Settings). Event switcher shows "AI.Engineer Sandbox… Oct 12–14, 2026".
→ `f_027.jpg` (All Submissions list), `f_033.jpg` (Dashboard).
*Note: at 3:47–4:20 swyx gets lost hunting for the form builder while pages skeleton-load — he complains "part of this I also don't love is that it's kind of slow… this slowness is part of why I think you guys can probably do a better job." Our nav must make Forms findable in one hop and load instantly.*

**A2. Event Settings sanity (brief detour at 2:40).**
Event Details: name, slug, type, website URL, location, timezone, start/end, theme; Exhibitors & Sponsors toggles; logo (300×300) & background (1500×500) uploads. "Some basic stuff here… it doesn't really matter as long as you fulfill the main core functionality."
→ `f_029.jpg` (Event Details), `f_031.jpg` (Email Templates list: Accept Sessions, Decline Sessions, Session Form One-Day/Five-Days Reminders).

**A3. Admin creates/edits a Session Submission Form (4:27, "you have like a form builder is what you're being asked to build here — this is just a very fancy form builder").**
Wizard steps, in order, with what swyx does in each:
1. *Submission Setup* — picks **Abstracts** vs Sessions ("abstracts… are applications to speak; sessions are people pretty much guaranteed to speak, say because they're a sponsor"); Participants toggle ON.
2. *Welcome Screen* — internal name / external title / page heading / welcome message. → `f_045.jpg`
3. *Abstract Information* — selects all fields: Title (locked) + Description + Format + Tags + Track + Level + Language, required toggles. → `f_048.jpg`
4. *Participant Information* — locked name/email fields, phone, bio; sets Speaker role Min=2 Max=(blank) — **his own mistake, see D2**. → `f_049.jpg`, `f_050.jpg`
5. *Payments & Fees* — skips: "we don't really care about payment, you can skip this one if you're cloning it." → `f_053.jpg`
6. *Form Settings* — sets Close Date "September 15th… doesn't matter", reminder email toggle, submission limit, drafts, thank-you email. → `f_055.jpg`
7. *Notifications* — adds multiple admins to new-submission and updated-submission notify lists; submitter confirmation template visible. → `f_057.jpg`, `f_059.jpg`
Saves → form "Session Submission Form #3" appears in Forms list (Open, closes Sep 15). → `f_060.jpg`

**Acceptance A:** an admin can assemble this exact form in ≤5 minutes, and Copy Link produces a working public URL.

## Part B — Public: submit a talk (5:54, incognito)

**B1. Visitor opens the public link** (`/submit/<event>/<form-id>`): stepper Welcome → Account → Submission → Participant → Review; banner shows "accepted until September 15 at 11:59 PM PDT" + "3 submissions per user". → `f_061.jpg` (blank load — theirs takes seconds; ours must not).

**B2. Account step:** email + password (swyx logs into an existing account; signup exists for new emails; "Forgot your password?" present). → `f_062.jpg`, `f_063.jpg`

**B3. Submission step:** fills Title, Description (rich text), Format="Featured Keynote", Tags="Tag A", Track, Level="Introductory", Language="English"; required-field validation; Save-as-draft available. → `f_064.jpg`, `f_065.jpg`

**B4. Participant step:** "2–4 Speakers allowed" — he must add a second speaker because of his Min=2 mistake; live email validation ("Enter a valid email address."); phone with country code; bio editor; Add Secondary Contact. → `f_067.jpg`

**B5. Review → Submit → Success page:** green check, configured thank-you copy ("You will receive a confirmation email shortly with a link to your speaker portal…"), *submit another* link, **Continue to portal**. → `f_069.jpg`
*The success page message + portal redirect is red-flagged "make sure this works" in the brief; the confirmation email is "must have".*

**Acceptance B:** a stranger in incognito completes a submission in <3 minutes; confirmation email lands in their inbox with a portal link.

## Part C — Speaker portal (6:54)

**C1. Portal Home** after submit: My Submissions (2) with status pills — "this is an important part of it: whether or not you have been accepted, and once you've been accepted, what tasks do you have to complete"; My Profile card; Tasks panel (Submission Tasks / My Tasks). → `f_071.jpg`
**C2. Submissions tab:** the submitted session listed with the two speakers. → `f_073.jpg`
**C3. Profile tab:** "you being able to update your own biography — this is a very important part of the overall submissions." Bio editor, name fields, pronouns/gender, links. → `f_075.jpg`

**Acceptance C:** portal reflects submission status in real time; profile edits persist and are visible to admins.

## Part D — Admin: review & judgment calls

**D1. New submission appears** in All Submissions/Abstracts with source = form name, status Pending. → `f_041.jpg`, `f_037.jpg`
**D2. Validation-sanity lesson (6:46):** "That was stupid — obviously I should not have a minimum of two speakers. That's not something that we do." → our defaults: Min speakers = 1; make min/max mistakes hard to make and easy to fix after publish.
**D3. Status change** Pending → Accepted (inline pill editor or row edit); Accept email template (manual trigger) exists in Email Templates; acceptance shows in portal immediately.

## Part E — Evaluations (7:42)

**E1.** "We can create evaluation plans on the admin side, on the conference-committee side, and we can assign sessions to be evaluated by conference committees… this team is evaluating whatever number of submissions." Plan card: evaluators count, submissions, total evals, progress per round, due date per round. → `f_077.jpg`, `f_080.jpg`
**E2.** Evaluator side: "as an evaluator I can look through all these things." (Scoring UI not shown — we design it; see flow 05.) Evaluators page with Conflicts tab. → `f_081.jpg`

**Acceptance E:** create plan → add 2 evaluators → assign submissions → evaluator scores → plan progress updates → admin uses scores to accept.

## Part F — Agenda & public output (8:17)

**F1.** "Once things have been evaluated, accepted… then we can add the accepted sessions in here for the agenda." Agenda views List/Day/Week/Month/Rooms/Conflicts; Add Session; drafts. → `f_083.jpg`
**F2.** Embeds (8:25): "showing them or embedding them in some external environment where you can get the code… it's a very standard event display with everything all linked." Embed editor + live preview: day grid by room, session cards with track pill, session modal with speakers **and an "Add to Calendar" button** (attendee-side pull — distinct from the brief's per-speaker invite push, which Sessionboard lacks). → `f_087.jpg`, `f_089.jpg`, `f_091.jpg`
*Coverage note (verified 2026-08-08 via scene-change re-extraction of 7:35–9:05): the video never shows a populated admin agenda, drag-drop scheduling, or the evaluator scoring UI — those come from the official KB docs (flows 05/06), and the Sat/Sun walkthrough videos may show them live.*
*(Embeds were "optional" in the brief but are CORE under the eval kit — P1 #16 in SCOPE.md, ~19% of the rubric; this is also the demo's closing image.)*

## Closing guidance from the video (8:48–9:52)

- "There's a lot in here that I'm skimming over… as long as you roughly get the idea."
- "You can also use the Sessionboard website where you can look at the individual screens."
- **"It's not about the fidelity to Sessionboard. It's about filling the job to be done."**
- "I don't care about the AI workflow thing."
- "I think it is very doable if you're focused."
- He'll answer questions in Discord and record a more professional demo (Sat + Sun; requirements freeze after).
