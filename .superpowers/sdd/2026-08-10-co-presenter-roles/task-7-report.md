# Task 7 report — Live verification, judging, and handoff

## Status

Complete for Task 7's branch gate. The actual application E2E, one final cold three-judge round, and final full verification passed their defined gates. The decision-record PR is ready for owner handoff; this lane will not merge it.

## Running-app setup

The normal `pnpm dev:worktree` entrypoint could not start because `wrangler.json` declares the Workers AI binding remote and this unattended machine has no Wrangler login. The observed error was `Failed to fetch auth token: 400 Bad Request` followed by `You must be logged in to use wrangler dev in remote mode`.

A temporary, untracked Vite/Wrangler override omitted only the Workers AI binding and `.dev.vars`, preserving local D1 and R2. This prevented remote-resource and real-email access. The actual React Router application then ran at `http://localhost:5435/`; the temporary configuration and browser profiles were removed after the exercise.

## Live CFP submission

Browser: headless Google Chrome 151, 1440×1000 viewport.

1. Opened `http://localhost:5435/submit/ai-engineer-sandbox/form-sessions-uuid` and signed in as the seeded speaker.
2. Submitted `Lane P Live Multi-role Session` with:
   - Sam Speaker — Speaker, primary
   - Casey CoSpeaker — Speaker
   - Morgan Moderator — Moderator
3. The review screen rendered human role labels and exact names/emails before submission.
4. Submit reached `/step/success?sid=7f8ef3d0-e9f6-4f76-ac76-400d1b4697e4` and rendered the confirmation plus portal handoff.

Direct local D1 evidence after submit:

```text
submission 7f8ef3d0-e9f6-4f76-ac76-400d1b4697e4
status pending
Sam Speaker     speaker    is_primary=1
Casey CoSpeaker speaker    is_primary=0
Morgan Moderator moderator is_primary=0
```

`email_outbox` contained three sent rows:

```text
speaker@example.com                  submission confirmation
lanep.co.speaker@example.test        participant-added invite as Speaker
lanep.moderator@example.test         participant-added invite as Moderator
```

Both participant invites used unique `participant-added:<participantId>:<token>` dedupe keys and `http://localhost:5435/set-password/<random-token>` access URLs.

## Live participant access and portal mutation

1. Opened Casey's set-password URL in a fresh isolated browser profile.
2. Set a password; the app authenticated Casey and redirected to `/portals/ai-engineer-sandbox/portal-demo-uuid/home`.
3. Casey's home showed the new submission and their own profile/email.
4. Opened the submission detail. The page showed Sam and Casey as Speakers and Morgan as Moderator, role selectors for mutable links, canonical add-role options, and the form close date.
5. Added Jamie Portal as Moderator. The UI returned `✓ Participant added.` and one invitation outbox row was created.
6. Changed Morgan from Moderator to Chairperson. The UI returned `✓ Participant role updated.` and re-rendered the new label.

Exact-key replay used the same add payload for Jamie. The final HTTP response was `200`; D1 remained:

```text
participant_count = 4 before replay, 4 after replay
Jamie invite_count = 1 before replay, 1 after replay
```

## Live organizer view

Signed in as the seeded organizer in a fresh isolated browser and opened `/admin/submissions/7f8ef3d0-e9f6-4f76-ac76-400d1b4697e4`.

The participant table rendered:

```text
Sam Speaker · primary  Speaker
Casey CoSpeaker        Speaker
Morgan Moderator       Chairperson
Jamie Portal           Moderator
```

Each row rendered the canonical role selector and Save action. The add-existing-contact and new-contact controls also rendered the canonical role vocabulary.

## Live close-date gate

Backdated the local source form's `close_at` to `1` and reloaded Casey's portal detail.

Observed UI:

```text
The submission form has closed, so editing is no longer available.
Contact the event team if you need a change.
```

The page rendered zero add-participant buttons and zero set-role buttons. A direct authenticated add POST for `lanep.closed@example.test` returned final status `200` with the closed read-only response. D1 proved no mutation:

```text
closed contact_count = 0
participant_count = 4
closed outbox_count = 0
```

A cold reload of both portal and organizer pages produced zero browser console errors.

## Visual evidence inspected

- `/tmp/openrostrum-laneP-cfp-review.png` — review page with two Speakers and one Moderator.
- `/tmp/openrostrum-laneP-admin-roles.png` — organizer participant table with primary, Speaker, Chairperson, and Moderator labels.
- `/tmp/openrostrum-laneP-portal-closed.png` — read-only closed portal state with all participants and no mutation controls.

Each screenshot was opened and visually inspected; none was blank or showed a render/error shell.

## Resource safety

- No remote D1, R2, Workers AI, Resend, or Airtable resource was accessed.
- Local email delivery was observed only through local `email_outbox`.
- Temporary repository configuration and browser profiles were removed; the worktree was clean again before judging.
- The seeded form's close date and role flags were restored after the close-gate exercise; no shared local database reset was used.

## Final judge round

Three fresh cold judges reviewed the intent plus complete `git diff origin/main...HEAD` artifact under architecture, governance, and simplicity charters.

- Architecture raised two findings: duplicated route-level participant transition logic and broad post-commit notification rejection handling.
- Governance raised the normal integration-owner-only schema/migration rule.
- Simplicity raised three findings: duplicated route transitions, a broad notification service input, and repeated busy ConfirmButton markup.

No implementation change was adopted. Every finding was technically discarded with verified context: the route trust/policy boundaries differ; post-commit errors cannot truthfully turn a persisted mutation into a failed submission and are tracked plus surfaced; notification provenance includes pre-insert state; shared UI is outside the lane; and the user explicitly authorized migration slot 0009 plus guarded schema paths. The complete line-by-line log is `judge-dispositions-laneP.md`. The user-imposed one-round maximum was honored.

## Final verification

```text
pnpm verify
Test Files  107 passed (107)
Tests       1021 passed (1021)
```

Map validation, generated Worker/route types, TypeScript, ESLint, CSS lint, and the complete workerd real-D1 suite passed. Output contained only the repository's existing Drizzle sourcemap and binary-body `.text()` warnings.

## PR handoff

The PR decision record must preserve the 0008/0009 reconciliation, sanctioned shared paths, expected red `guard-shared-files` check, owner `--admin` merge, complete automated/live evidence, judge dispositions, and branch-deletable-after-squash disclosure. The lane is explicitly prohibited from merging.
