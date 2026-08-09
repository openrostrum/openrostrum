# Content Management & Speaker Deliverables — feature reference

## What this is

This documents SessionBoard's content-management behavior as the target that third-party clones are graded against. SessionBoard's content management covers the post-acceptance content lifecycle. Organizers edit all session and speaker content (titles, abstracts, tags, bios, photos) in one centralized dashboard with bulk editing, full version history with timestamped attribution and restore, role-based permissions, and internal approval gating publication. For file collection, organizers enable Files per event (Sessions > Settings > Files) and create file-request tasks (e.g. "Upload Session Presentation") with deadlines auto-assigned from session data; speakers get a personalized portal listing tasks and deadlines where they upload files up to 1.95 GB with built-in per-file versioning and comments (author + timestamp logged; notably no email notification fires on new comments). Organizers track deliverables on a filterable Speaker Tasks Dashboard, send bulk automated reminders to speakers with outstanding tasks, and review files via a central Library > Files module or a per-session Files tab. Distribution is via bulk-selecting sessions and "Download Files" as a ZIP with folder-grouping options (latest versions only; email when the export is ready), shareable links for AV/marketing teams, and auto-sync of approved content to embeddable public agenda widgets. An AI "Studio Remix" suggests clarity/tone/length edits across sessions.

## Personas & user journeys

Research personas: Organizer/admin (content manager), Speaker (portal user uploading deliverables), Internal reviewer/approver, AV/production team (consumer of final files), Web/marketing team (published agenda consumer). The eval exercises the first two directly; reviewer/AV/web roles are covered through organizer-side evidence.

### 1. Set up content collection (Organizer/admin)

Steps:
1. Enable file uploads in event/session settings (Sessions > Settings > Files toggle)
2. Create file-request task "Upload Session Presentation" with instructions and due date
3. Create second task "Upload Final Headshot (print quality)"
4. Assign tasks to speakers (auto-assign by session)
5. Confirm tasks appear on the tracking dashboard as incomplete

Filled state: Task dashboard shows speakers × 2 tasks with due dates, status chips Incomplete, filter controls, and a Files column on the session list showing 0 files.

### 2. Speaker uploads deliverables (Speaker)

Steps:
1. Log in to personal speaker portal
2. See task list with deadlines and completion status
3. Upload slides (v1) against the presentation task/session
4. Add a comment on the file ("draft, final coming Friday")
5. Later upload a replacement, creating version 2
6. Mark task complete; portal shows what's next

Filled state: Portal shows tasks "Upload Session Presentation" (Complete, file listed as latest of 2 versions) and "Upload Final Headshot (print quality)" (due date shown, Incomplete); comment thread shows author + timestamp.

### 3. Review, edit, and approve content (Organizer/admin + reviewer)

Steps:
1. Open central content dashboard listing all sessions and speakers
2. Inline-edit a session title and abstract; edit a speaker bio
3. Open version history, see timestamped entries per editor, restore a prior version
4. Optionally apply an AI Studio Remix suggestion to an abstract
5. Set session content status to Approved
6. Verify approved content syncs to the public agenda embed

Filled state: Session detail shows edited title, history panel with dated entries and Restore buttons, status chip Approved, and the public agenda page displaying the updated title/abstract.

### 4. Distribute final assets to AV/web teams (Organizer/admin → AV team)

Steps:
1. Filter session list by sessions with uploaded files / completed tasks
2. Send bulk reminder to speakers still missing files
3. Select sessions, click Download Files, choose grouping (folder per session), deselect unwanted files, click Generate Download
4. Receive notification when the ZIP export is ready; download contains latest file versions
5. Generate a shareable link for one file and hand it to the AV team

Filled state: Files library lists all uploads with session/speaker association and version count; export dialog shows grouping options; a shareable URL resolves to the latest slide file.

## Feature inventory

| Feature | Must-have? | Description | UI expectations |
|---|---|---|---|
| Centralized session & speaker content editing | Yes | Edit session titles, abstracts, tags, speaker bios and photos in one dashboard; bulk edits across dozens/hundreds of sessions; multi-user editing with timestamped attribution and field-level locking. | Sessions/content list with inline or modal edit forms for title/abstract/tags; speaker cards with photo + bio edit; changes persist on reload |
| File-request tasks with deadlines | Yes | Organizer creates deliverable tasks (e.g. "Upload Session Presentation", headshots, bios) with due dates, instructions (rich text/links), auto-assigned to speakers based on session data. | Task builder with name, description, due date, assignment; tasks listed per speaker/session with status |
| Speaker portal for uploads & tasks | Yes | Personalized speaker workspace showing assigned tasks, deadlines, and status; speakers upload files (up to 1.95 GB per file), complete forms/tasks, and see what's next. Speaker sees only own sessions/tasks. | Speaker-facing portal page with task checklist, due dates, upload buttons per task/session, completion indicators |
| File versioning | Yes | Re-uploading a deliverable creates a new version; latest version is the default for exports; previous versions remain accessible from the session content/files tab. | Version list/history on a file entry showing v1/v2 with dates; latest clearly marked; older versions individually downloadable |
| Per-file comments | No | Speakers and admins exchange comments attached to uploaded files; commenter name and timestamp auto-logged. In SessionBoard, no email notification fires on new file comments. | Comment thread on the file detail with author + timestamp; visible to both organizer and speaker roles |
| Content version history & audit log | No | Full change history per session/speaker record with timestamped user attribution; restore prior versions; supports compliance logging. | History/activity panel per record listing edits with who/when; Restore action reverts content |
| Internal review & approval workflow | Yes | Role-based permissions (organizer, reviewer, speaker) and internal approval states gating publication; only approved content syncs to public agenda. Exact state names undocumented; draft/in-review/approved is the category norm (inferred). | Status field/chip on sessions; permission-scoped edit rights; unapproved sessions absent from public output |
| Automated & bulk reminders | No | System auto-sends reminder emails to speakers with incomplete required tasks; organizers can trigger bulk reminders from the dashboard using built-in email templates. | Bulk "send reminder" action on filtered incomplete tasks; template picker; confirmation of send |
| Deliverables tracking dashboard | Yes | One filterable view tracking speaker progress across tasks, sessions, and events; Files column addable to session views to spot sessions with/without uploads. | Dashboard/table with per-speaker per-task status, filters (incomplete/overdue), counts update after uploads |
| Central files library | No | Library > Files module aggregating all uploaded files across sessions, plus per-session Files tab; shows file metadata and session/speaker association. | Library page listing files with name, session, uploader, date, version count; per-session Files tab mirrors subset |
| Bulk export/download of final assets | Yes | Select sessions or files and "Download Files" as ZIP; choose folder grouping, deselect files, "Generate Download"; latest versions only included; email notification when export is ready. | Multi-select on session/file lists, Download Files button, grouping dialog, async generation with ready notification |
| Shareable file links for AV/web teams | No | Generate shareable links for direct file access to distribute final assets to onsite A/V or marketing teams without platform accounts. | "Copy/share link" action on a file; resulting URL serves the file |
| Auto-sync to public agenda embeds | No | Approved session/speaker content auto-publishes to embeddable agenda widgets on the event website; edits propagate on approval. | Public agenda page/embed listing approved sessions with titles, abstracts, speaker names/photos; reflects edits |
| AI content optimization (Studio Remix) | No | AI-suggested edits for clarity, tone, formatting, and length on session/speaker content, applicable in bulk; AI review against agenda rules and conflicts. | AI suggest/improve control on abstract/title fields producing an editable suggestion card with apply/dismiss |

Known gaps in the sources: exact approval-state names/stages (draft/in-review/approved inferred from category norms), accepted file types and per-type validation, whether deadlines hard-lock late uploads (soft deadline with reminders — inferred from category norms), reviewer-assignment mechanics for content approval, and any dedicated AV-team portal (distribution appears to be ZIP export + shareable links only). Documented quirk for judges: SessionBoard explicitly does NOT email-notify on new file comments, so clones should not be penalized either way on comment notifications. Field-level locking / simultaneous-edit conflict mechanics and Studio Remix internals are undocumented and excluded from the rubric.

## Rubric rationale

- **CNT-01** (w3, auto): File-request tasks with deadlines are the entry point of content collection — the area is pointless without them; fully verifiable by creating the two fixture tasks and seeing them listed.
- **CNT-02** (w3, auto): The speaker portal upload is the core speaker-side capability; the agent uploads the slides.pdf fixture and screenshots the recorded state in one browser session.
- **CNT-03** (w2, auto): Speaker scoping is an important security property but not the area's core function; verified by inspecting portal scope and probing admin routes as the speaker.
- **CNT-04** (w3, auto): Versioning is a headline SessionBoard content feature (latest-marked, priors retained); a second upload of the same fixture proves it end-to-end in the browser, checked from both roles.
- **CNT-05** (w2, auto): File comments are documented but marked non-must-have in research; cross-role visibility with author/timestamp is fully browser-verifiable. Judges must not require comment email notifications (SessionBoard sends none).
- **CNT-06** (w1, auto): Constraint communication (types/size, e.g. the 1.95 GB limit) is polish — sources don't document accepted types, so only the presence of a stated constraint is judged, not its enforcement.
- **CNT-07** (w3, auto): The who-has/hasn't-submitted dashboard is the organizer's core tracking tool; accuracy is judged against the known fixture state created in S1/S2, and filtering is directly observable.
- **CNT-08** (w2, auto-partial): The bulk-reminder UI and send confirmation are browser-verifiable; actual email delivery is not (agent cannot read inboxes), so delivery goes to the manual checklist.
- **CNT-09** (w3, auto): Central editing of session title/abstract is a must-have pillar of the area; persistence after navigate-away-and-reload is objective browser evidence.
- **CNT-10** (w2, auto): Speaker bio/photo editing is the secondary half of central editing (research weighted it below session editing); verified with the headshot.png fixture and a reload.
- **CNT-11** (w2, auto): Version history with attribution and restore is documented but non-must-have; the two-edit-then-restore script makes attribution, timestamps, and revert all screenshot-verifiable.
- **CNT-12** (w3, auto): Approval gating publication is a must-have; state names are inferred (any equivalent accepted), and the approved-in/unapproved-out contrast on the public agenda is objectively judgeable.
- **CNT-13** (w2, auto): The files library is the organizer's review surface for collected assets; metadata (session/speaker/date/version count) is checked against known uploads; the per-session tab is bonus, not required, since only the aggregate view is core to the source docs.
- **CNT-14** (w3, auto-partial): Bulk ZIP export is the must-have distribution path; selection/grouping/generation are browser-verifiable, but the agent cannot open downloaded files, so ZIP contents (latest-versions-only, grouping, deselection) are a manual check.

Excluded from the rubric (14-item cap): shareable file links (non-must-have; anonymous-access verification needs a logged-out context the agent can't reliably create — S3 still captures bonus evidence if the control exists) and AI Studio Remix (non-must-have polish with undocumented internals). Auto-sync to public agenda embeds is folded into CNT-12's public-output check rather than scored separately.

## Sources

- https://www.sessionboard.com/capabilities/content-management
- https://www.sessionboard.com/capabilities/speaker-management
- https://learn.sessionboard.com/en/knowledge-base/6952482-enable-upload-download-content
- https://www.sessionboard.com/blog/mastering-sessionboard-with-the-cs-team-the-power-of-portals
