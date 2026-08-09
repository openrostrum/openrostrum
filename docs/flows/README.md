# Flow documentation index

Researched 2026-08-08 from Sessionboard's official knowledge base (learn.sessionboard.com, all 226 articles), the public API reference (apidocs.sessionboard.com / sessionboard.mintlify.app), the live sandbox CFP form, production embed assets, and swyx's walkthrough video. Every claim in these docs cites its source URL; screenshots in `img/` are downloaded from the official docs, and `00` references frames extracted from the walkthrough video.

| Doc | Covers | Scope tier | Screenshots |
|-----|--------|-----------|-------------|
| [00-demo-walkthrough.md](00-demo-walkthrough.md) | The exact judge-replay script from the video, parts A–F with acceptance criteria | **P0 master script** | video frames (`../reference/video-frames/`) |
| [01-form-builder.md](01-form-builder.md) | Submission form wizard, field types, question rules (conditional logic), participant roles, form settings | P0 (builder core) / P1 (question rules, cross-field limits) | 43 |
| [02-public-submission-and-portal.md](02-public-submission-and-portal.md) | Public CFP flow, auth model, drafts/edit semantics, speaker portal, file uploads | P0 | 26 |
| [03-emails-communications.md](03-emails-communications.md) | Every automated email + trigger, manual sends, templates/themes, deliverability | P0 (confirmation, reminders) / P1 (template editor) | 23 |
| [04-review-accept-decline.md](04-review-accept-decline.md) | Status machine, queue staging + portal masking, manual accept/decline emails, participant acceptance | P0 | 10 |
| [05-evaluations.md](05-evaluations.md) | Evaluation plans, rounds, scorecards, evaluator UI, assignment rules (the real "category routing") | P0 (thin) / P1 (rounds, rules) | 37 |
| [06-agenda-embeds.md](06-agenda-embeds.md) | Drag-drop scheduling, conflict detection (2 classes), views, embeds architecture, wf2025 reference | P0 (agenda) / P2 #2 (embeds) | 12 |
| [07-portals-tasks.md](07-portals-tasks.md) | Portal model (audience segments), access provisioning, tasks/forms/file-requests, completion tracking | P0 (tasks thin) / P1 (depth) | 29 |
| [08-settings-data-api.md](08-settings-data-api.md) | Event settings, import/export, dashboards, full API inventory (177 ops), webhooks (20 events) | P1 (settings) / P2 (API #4, import/export #3) | 18 |
| [09-data-exposure.md](09-data-exposure.md) | Who sees what, where: actor/surface model, 7 entity exposure matrices (R/W/Masked/Hidden), 27 masking rules, write-permission map, leak checklist | Cross-cutting (authz spec for every tier) | — |

## Research verdicts on the former open questions

1. **Conditional logic** = "question rules": show-a-question-when-another-matches only; trigger fields limited to Checkbox/Dropdown/Number; no AND/OR, no chaining, no hide/skip. Small feature, P1. ([FAQ](https://learn.sessionboard.com/faq/does-sessionboard-offer-conditional-logic))
2. **Category-based routing** = no submit-time routing exists. Track/format/tags are plain taxonomy dropdowns; "routing" happens in evaluation assignment rules (filter submissions by track/format/tags → assign to evaluator pools; their docs recommend one plan per track). Fold into evaluation scope.
3. **Calendar invites**: Sessionboard has NO per-speaker calendar invites (0 hits for .ics across all 226 KB pages) — only a whole-agenda iCal embed feed. The brief's requirement 3 is therefore a **differentiator we build beyond parity**, not a parity item.
4. **Submitter auth** = email + password (email-first lookup → login or inline signup; password rules 8+/special/number/capital; deep links land on a password gate; no magic links on submitter surfaces). Mirror it.

## Behavioral corrections vs our first assumptions (bake into build)

- **Status changes never send emails.** Accept/Decline Queue = staging that masks as "Pending" in the portal; emails are a manual bulk send (≤100/send) and admins flip to final status afterwards. Our clone keeps this model and may add an optional "send + finalize" one-click as an improvement.
- **Portal access ≠ acceptance.** Access comes from the confirmation-email link / auto-provisioning; acceptance gates *task visibility* ("Always Show Tasks" off → only accepted-session speakers see tasks). This is exactly how requirement 6's "outstanding onboarding tasks" works.
- **Conflict detection** = two classes only: overlapping sessions, and double-booked participants (speaker/chairperson/moderator). No track-collision checks. Conflicts recompute on refresh (we can beat this with live checks).
- **Editing window**: submitters can edit submissions in the portal until the form close date, never after; drafts need only a title.
- **Confirmation email** is immediate, body-editable, and cannot be disabled — matches the brief's "must have".

## Differentiator opportunities the research surfaced (cheap wins over the original)

1. Speed everywhere (their skeleton-loading is the villain of the walkthrough video).
2. Per-speaker .ics calendar invites (they don't have it; the brief demands it).
3. One-click accept→email→finalize (they require a 3-step manual dance).
4. Contact dedupe on multiple submissions (their docs admit duplicates and recommend manual audits).
5. Live conflict detection while dragging (theirs needs a page refresh).
