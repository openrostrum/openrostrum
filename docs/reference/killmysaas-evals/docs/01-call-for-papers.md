# Call for Papers — feature reference

## What this is

This documents SessionBoard's Call for Papers behavior as the target for third-party clones to reproduce; the sbek harness grades clones against it. SessionBoard's CFP module runs the full proposal lifecycle: organizers build custom submission forms (multiple field types, required/optional flags, conditional logic that branches by track or session format) with configurable open/close dates, published on a branded public portal. Speakers submit proposals, get automated confirmation emails, and track status from a submitter dashboard where they can edit submissions until the close date. Organizers assign committee reviewers, who see an isolated dashboard of only their assigned submissions and score them on scorecards; program chairs then run accept/reject decisions with personalized notification emails, and accepted submissions flow directly into the agenda builder with no re-entry.

**Ownership split:** this spec owns the submission side plus the basic single-round review loop — form builder, conditional logic, public portal with open/close dates, submitter accounts/dashboard/edit-before-deadline, submission confirmation, reviewer assignment and scoring, accept/reject decisions and notifications, and the accepted-talks handoff. Review DEPTH — multi-round review, blind/anonymized review, weighted scorecards, aggregate score tables, bulk reviewer operations, and co-authors — is owned by the **abstract-management** spec and is intentionally not scored here.

## Personas & user journeys

### Organizer creates and publishes a CFP (Organizer/Admin)

1. Log in to admin, create/open event, go to Call for Papers setup
2. Build submission form: add fields (text, long text, dropdown, file upload), mark required/optional
3. Define tracks and session formats; add conditional logic so fields show only for a given track/format
4. Set submission open and close dates
5. Publish and copy the public portal link; verify the live form renders

**Filled state:** Form builder shows ~8–12 fields (title required, abstract, track dropdown with 3 tracks, format dropdown, speaker bio, headshot upload); portal page branded with the event name and a visible deadline.

### Speaker submits a proposal, with draft save (Speaker/Submitter)

1. Open the event's public CFP portal link
2. Create submitter account / sign in
3. Enter at least a Title; click "Save as draft" (bottom right); a banner at the top confirms draft mode
4. Leave; return later and log in; accept the resume-draft prompt ("Reset saved data" discards it)
5. Complete all required fields per page (required to advance pages): title, abstract, track, format, bio
6. Submit; see the confirmation screen and receive a confirmation email containing the portal link
7. Open the submitter dashboard, see the submission listed with status (e.g. Submitted/Under Review), edit it before the deadline

**Filled state:** Form pre-filled with draft data (title, abstract, track, format) and a yellow/info banner reading that you are editing a draft, with a "Reset saved data" control on the right. After submitting, the submitter dashboard lists 1–2 proposals with title, track, and status chips; a confirmation banner/email reference is visible.

### Speaker views and edits a submission before the deadline (Speaker/Submitter)

1. Log into the portal (link arrives in the submission confirmation email; new users create a password, click "Continue to portal")
2. In the "My Sessions" / "My Submissions" widget, click the session
3. In the session sidebar, click "View Submission" at the bottom
4. Edit form fields and save
5. Reload and confirm changes persisted

**Filled state:** Editable multi-page form pre-populated with the original submission answers; after the submission close date the same form is read-only with a message that editing is no longer available.

### Reviewer scores assigned submissions (Reviewer/Committee member)

1. Receive invite (magic link) or sign in as reviewer
2. Land on a review dashboard showing only assigned submissions
3. Open a submission, fill the scorecard: numeric ratings plus comment
4. Submit review; dashboard shows it as completed and advances to the next assignment

**Filled state:** Review dashboard shows e.g. "6 assigned, 2 completed"; scorecard has rating criteria on a 1–5 scale with a comment box; completed items show their scores. (Blind-review anonymization and weighted multi-criterion aggregation are graded by the abstract-management spec.)

### Chair decides and notifies (Program chair / Organizer)

1. Open the progress dashboard: submission counts, per-submission scores and review state
2. Sort/inspect scores; mark top submissions Accepted and others Rejected
3. Send personalized acceptance/rejection notification emails
4. Verify accepted submissions became sessions in the agenda/session list and speaker portal invites triggered

**Filled state:** Submission table with rows showing score, review state, and a status column mixing Accepted/Rejected/Under Review; the agenda list contains the accepted session titles. (Aggregate score tables, reviewer completion rates, and bulk reviewer reminders are graded by the abstract-management spec.)

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| Custom submission form builder | Yes | Organizer builds the CFP form: custom fields of multiple types (text, long text, dropdown, file upload), required/optional flags (title is the only mandatory field), custom question sets per submission type, topic/category configuration. | Admin form-builder screen with add-field controls, field-type picker, required toggle, drag/reorder (inferred), and a live or previewable public form reflecting saved changes. |
| Conditional logic and track routing | Yes | Form fields branch on prior answers: track-specific routing, session-format differentiation, different question sets per submission type. | Builder lets a field declare a show-when condition; on the public form, changing the track/format dropdown shows/hides dependent fields without page reload (inferred). |
| Public submission portal with open/close dates | Yes | Branded public portal where the CFP is published; organizer configures open and close dates and the portal enforces them (closed state blocks submission). | Public page reachable without admin login, showing event branding, deadline, and the form; after the close date it shows a "submissions closed" state instead of the form. |
| Submitter accounts and dashboard | Yes | Speakers create accounts, submit proposals, and see their own submissions with current status; can edit/withdraw before the deadline (inferred from Sessionize/EasyChair norms; edit-before-close-date confirmed by SessionBoard participant docs). | Sign-up/sign-in on the portal; a "my submissions" dashboard listing the user's proposals with status labels and an edit action while the CFP is open. |
| Save submission as draft | No | On the public form, entering at least a Title enables "Save as draft" (bottom right). A banner marks draft mode; returning users get a resume prompt; "Reset saved data" discards. Advancing pages still requires all required fields. | "Save as draft" button bottom right, draft banner at form top, resume-draft prompt on return, "Reset saved data" control. |
| View and edit submission (portal) | Yes | From the My Sessions widget, clicking a session opens a sidebar; "View Submission" opens the original form pre-populated and editable any time before the submission close date; after it passes, editing is disabled. | Session sidebar with "View Submission" button; editable multi-page form; read-only/locked state after deadline. |
| Automated submission confirmation | No | Automated confirmation email sent on submission (carrying the portal link), plus on-screen confirmation; status update notifications at each process stage. | Confirmation screen/banner after submit; email containing the submission title (verified via inbox or the app's email log if the clone exposes one). |
| Reviewer assignment | Yes | Organizer assigns reviewers to submissions with magic-link email invites (no admin accounts needed), configurable caps per submission/reviewer, field-based filtering, and preview before confirming. (Magic-link detail comes from the abstract-management page and may differ for the CFP product.) | Admin assignment screen mapping reviewers to submissions (manual pick and/or auto-distribute), showing per-reviewer load counts; invited reviewers reach their dashboard via emailed link or login. |
| Reviewer dashboard and scorecards | Yes | Reviewers get an isolated dashboard showing only assigned submissions; scorecards support numeric ratings, text responses, dropdowns, and file uploads; submitting a review marks it complete. | Reviewer view lists assigned items with completed/pending state; detail view shows proposal content plus a scorecard form; no access to unassigned submissions or admin areas. |
| Acceptance/rejection workflow | Yes | Committee selection dashboard where chairs view scores and comments, then mark submissions Accepted/Rejected/Waitlisted; every stage and decision logged in an audit trail. | Submission table with a status/decision control (per-row and bulk, inferred); status changes reflected in the submitter's dashboard. |
| Personalized decision notifications | Yes | Personalized acceptance and rejection emails sent from the platform; speaker portal invitations trigger automatically for accepted speakers; email automation at each stage. | Notification compose/template step with merge fields (inferred), a send action scoped to accepted or rejected sets, and a sent/queued indicator. |
| Accepted-to-agenda handoff | No | Accepted submissions become sessions in the agenda builder with all metadata intact — no re-entry; speaker portal activation and material collection follow automatically. | After acceptance, the session (same title, speakers, track) appears in the sessions/agenda area ready for scheduling. |

**Out of scope here (owned by other specs or excluded):** weighted scoring rubrics, blind/anonymized review, multi-round review, aggregate score tables, progress dashboards with bulk reviewer reminders, and co-author flows → **abstract-management** spec. Scoring exports, submission fee collection, COI tracking (mechanics inferred from OpenReview/EasyChair norms), and AI Evaluators are documented SessionBoard features but excluded from this rubric (exports/fees/COI as periphery; AI Evaluators because clones may legitimately stub AI).

## Rubric rationale

- **CFP-01** (w3, auto): the form builder is the module's foundation; a browser agent can add fields, reload the public form, and provoke a validation error entirely in one browser.
- **CFP-02** (w2, auto): conditional logic is a headline SessionBoard differentiator but the CFP survives without it; show/hide is directly observable by toggling the format dropdown.
- **CFP-03** (w3, auto): a public, no-login portal with visible deadline is the entry point for every speaker; a logged-out page load proves it.
- **CFP-04** (w3, auto): open/close enforcement is the portal's defining rule; the agent manipulates the close date itself and observes the closed state, so it is fully automatable.
- **CFP-05** (w3, auto): signup → submit → confirm → dashboard is the core speaker journey; every step yields on-screen evidence.
- **CFP-06** (w3, auto): data integrity organizer-side is what makes submissions reviewable; verified by comparing fixture values across the two accounts.
- **CFP-07** (w1, auto): draft save is documented participant behavior but marked non-must-have in research, hence polish weight; save/resume is directly observable.
- **CFP-08** (w2, manual): the confirmation email is important but the agent cannot read inboxes, so a human checks a real inbox or the clone's email log.
- **CFP-09** (w2, auto): edit-before-deadline is an inferred norm (Sessionize/EasyChair) confirmed by SessionBoard participant docs; cross-account persistence is fully observable.
- **CFP-10** (w2, auto): reviewer provisioning plus role separation (a signed-in reviewer sees no admin surface) is the piece this spec owns; exact assigned-queue scoping ("the queue contains exactly the assigned set") is graded once, by ABS-05 in abstract management, to avoid double-counting.
- **CFP-11** (w2, auto): recording a rating + comment that the organizer can see is the minimum viable review loop this spec owns; scorecard field-type depth (numeric/dropdown/text editors) is graded once, by ABS-03 in abstract management.
- **CFP-12** (w3, auto): accept/reject decisions are the module's whole purpose; two contrasting statuses in one list are unambiguous evidence.
- **CFP-13** (w2, auto): status propagation to the submitter closes the loop; verified by one persona switch after decisions exist.
- **CFP-14** (w2, auto-partial): the agent can confirm the send flow and sent/queued indicator but not delivery or body personalization — that half goes to the human checklist.
- **CFP-15** (w2, auto): the no-re-entry agenda handoff is a SessionBoard selling point though not strictly required for a working CFP; matching metadata in the sessions area is direct evidence.
- **CFP-16** (w2, auto): the post-deadline edit lock is the enforcement counterpart of CFP-09 and becomes testable in-run once the agent moves the close date into the past.

## Sources

- https://www.sessionboard.com/products/call-for-papers
- https://www.sessionboard.com/products/abstract-management
- https://www.sessionboard.com/capabilities/ai-evaluators
- https://www.sessionboard.com/compare/sessionboard-vs-oxford-abstracts
- https://learn.sessionboard.com/participants/overview
- https://learn.sessionboard.com/participants/access-portal
- https://learn.sessionboard.com/participants/edit-submission
- https://learn.sessionboard.com/participants/save-a-submission-as-a-draft
- https://learn.sessionboard.com/participants/updated-portal
- https://learn.sessionboard.com/en/knowledge-base/portal-users
- https://learn.sessionboard.com/en/knowledge-base/6284020-configure-customize-portals
