# Walk — 05-review-accept (design-side, pre-swarm)

Walked 2026-08-09 against: `app/db/schema.ts`, `app/db/constants.ts`, `app/lib/auth.ts`,
`app/ports/email.ts`, `app/routes/*` + `docs/ROUTE-MAP.md`, `drizzle/seed.sql`,
`SCOPE.md` (P0 #4/#5), `docs/flows/04`, `docs/flows/05`, `docs/flows/verification/B+C`,
`docs/flows/09-data-exposure.md`, `docs/reference/discord/CLARIFICATIONS.md`, `CLAUDE.md`
(Wave 2 accept spine → `app/domain/accept.ts`).

Conventions: SQL is D1/SQLite with the real column names from `schema.ts`. Timestamps are
unix epoch seconds. Event TZ = America/Los_Angeles (PDT = UTC-7 through Oct 2026).
`:eventId` is the seeded event id. Status enum values are the `SUBMISSION_STATUS` tuple:
`draft | pending | accept_queue | accepted | decline_queue | declined | withdrawn`.

## Gap summary (this file) — details inline at the step that hits them

| # | Step(s) | Gap | Severity |
|---|---|---|---|
| G1 | RV-S4.6, RV-S5.4 | Task-assignment idempotency has NO mechanism: `task_assignments` has no unique on (taskId, contactId[, submissionId]), and SQLite unique indexes treat NULL `submission_id` as distinct — so even adding one would not dedupe contact-scoped tasks. Nothing specifies `accept.ts` must use `WHERE NOT EXISTS` guards. Re-accept duplicates hotel/flight assignments. | BLOCKER |
| G2 | every step with a literal count/fixture | `drizzle/seed.sql` does not produce the scenario baseline: it seeds 8 submissions / 2 tracks / 2 rooms / 2 formats / 1 reviewer, no named fixtures (no Priya/Tom/Marco/Dana/Alex+Jun/Ines/Omar/Lena/Sam, no Ben Ito). All literal counts (300/173/58/24/19/15/11/40, 220/80) and every named-fixture step fail on `db:reset`. Seed is integration-owned; must be rewritten to the baseline in this file's header. | BLOCKER |
| G3 | RV-S6.2–3 | No set-password / reset-password route exists in `app/routes/` or `docs/ROUTE-MAP.md`. The reviewer-invite link (`passwordResets.token`) has no page to land on; step 3 cannot be walked to a route. | BLOCKER |
| G4 | RV-S6.4–8, RV-S7 | No reviewer-facing "My Reviews" route exists in `docs/ROUTE-MAP.md`. Reviewers are (correctly) 403-blocked from `admin.*` by `admin.tsx`'s `requireAdmin` layout loader, so `admin.evaluation.tsx` cannot serve them. The queue/decision UI has no route file, so two agents could both mint one (the exact collision ROUTE-MAP exists to prevent). | BLOCKER |
| G5 | RV-S2.5, S3.8, S4.4, S5.5, S7.6, S8.1 | Portal identity is unmodeled: route `portals.$eventSlug.$portalId.tsx` has a `$portalId` param but schema has **no portals table** — nothing for the param to resolve. Either add a table or re-map the route to `/portals/:eventSlug` (single implicit portal). Every portal step in this suite depends on the portal being reachable. | MAJOR |
| G6 | RV-S3.7, RV-S5.4 | `dedupeKey` recipe for a MANUAL bulk send is undefined. Schema/tech-stack define it as "template+recipient+occurrence" — "occurrence" is meaningful for cron reminders (the close-date instance) but has no defined value for a manual send. Per-click UUID → double-submit duplicates; per-submission constant → later legitimate re-sends are silently swallowed. The double-submit idempotency the scenario demands is unimplementable until this is pinned (proposal inline at RV-S3.7). | MAJOR |
| G7 | RV-S3.2/5, RV-S5.3 | Recipient-audience rule for template sends is undefined: submitter only? all `participants` with role speaker? Sessionboard offers an audience picker (flow 04 §2b). The scenario's exact outbox counts (2 rows, 1 row) hold only if the rule is "one email per submission to a defined audience"; nothing states it. | MAJOR |
| G8 | RV-S3.6, RV-S5.3 | `.ics` content for an UNSCHEDULED session is undefined. Accept-time sends happen before scheduling (`starts_at IS NULL` for queue fixtures), yet the scenario requires a VEVENT with DTSTART inside Oct 12–14. Needs a stated fallback: DTSTART/DTEND ← `events.starts_at/ends_at` when the submission has no times. | MAJOR |
| G9 | RV-S2.1, RV-S4.2, RV-S8.3 | `statusChangedAt` writer unspecified: the column has no `$onUpdate` and no doc assigns the write to the status-change action / `accept.ts`. Every artifact below writes it explicitly — that requirement must be stated somewhere binding (schema comment or CLAUDE.md), or builders will forget it. | MAJOR |
| G10 | RV-S3.3, RV-S5.2 | `notifiedAt` semantics unspecified: nothing states who sets it (the bulk template send? any send? per-submission when its audience is emailed?). The "Notified" column (SCOPE App. F) is unreadable until this is pinned. | MAJOR |
| G11 | RV-S4.3a/4, RV-S5.5 | "create/link Speaker" in the accept spine is undefined at the only point where it isn't a no-op: contacts+participants already exist from submission, so the one real question is **users provisioning + `contacts.userId` linking for co-speakers** (Jun Park has no signup path and accept must NOT email). Without a stated rule, RV-S4.4 (Jun logs in) has no design path other than "the seed pre-creates his user" — which must then be stated in the seed spec. | MAJOR |
| G12 | RV-S4.3c | Spine task-assignment cardinality per `tasks.type` is undefined: contact-tasks → one per (task, speaker-contact)? submission-tasks → one per (task, submission) or per (task, contact, submission)? Also current seed marks `task_slides` (`type='submission'`) `is_onboarding_default=1`, which would make RV-S4's asserted count of exactly 4 wrong (5 or 6) if it survives the seed rewrite. | MAJOR |
| G13 | RV-S6.4 | Reviewer-queue status scoping undefined: which statuses appear in My Reviews (drafts must be excluded at minimum; do accepted/declined items stay reviewable?). The scenario's "~200 items" implies near-all-non-draft; nothing states it. | MAJOR |
| G14 | RV-S3 (bulk send) | SCOPE cross-cutting + the `emailSuppressions` schema comment say the EmailSender port checks suppressions before BULK sends — but `EmailMessage` has no bulk/transactional discriminator and `createLocalEmailSender` never reads `email_suppressions`. The stated behavior is unimplementable through the port as designed. | MAJOR |
| G15 | RV-S1.2 | "All" tab semantics unstated: the scenario's All (300) excludes the 40 drafts, i.e. All = `status != 'draft'`. Flow 04 explains draft-is-not-a-status, but no binding line defines our All-tab count. | MINOR |
| G16 | RV-S1.4 | Search scope (title only? +description? +speaker?) unstated anywhere. | MINOR |
| G17 | RV-S2.5 | Masking rule IS stated bindingly (see RV-S2.5 verdict) but no shared helper is designated — each portal surface re-implements the queue→Pending projection. Designate one (e.g. `app/domain/portal.ts` `portalStatus()`). | MINOR |
| G18 | RV-S7.2 | Feedback email: subject line, recipient rule (submitter vs all speakers), and dedupe policy (should be none / per-review-save) unstated. | MINOR |
| G19 | RV-S8.1 | Withdrawal authorization rule unstated: submitter only, or any linked participant contact? (Schema supports both via `withdrawnById` → users.) | MINOR |
| G20 | RV-S8.7 | Withdrawal leaves `starts_at/ends_at/room_id` residue; agenda/embed queries must filter by status (implicit today; state it, or clear the fields on withdrawal). | MINOR |
| G21 | RV-S6.1 | Reviewer-management UI has no pinned route (assumed `admin.evaluation.tsx`); reviewer invite template unseeded (free-compose acceptable — state it); reviewer post-login landing page unspecified. | MINOR |
| G22 | RV-S2.1 | Admin-side withdrawal affordance unspecified: the inline dropdown correctly excludes Withdrawn (App. F), but schema comment says an admin can withdraw — no UI path is designed for it. | MINOR |

**SCENARIO-ERROR (RV-S5):** SCOPE.md P0 #4 (line: *"We replicate this model, plus an **optional** one-click 'accept + send + finalize' as our improvement."*) labels the one-click action **optional**, but RV-S5 commits an entire scenario (and RV-S5's EXPERIENCE signal sells it as the headline improvement). Tier mismatch: either strike "optional" in SCOPE (it sits inside P0 #4 text, so a one-word promotion) or mark RV-S5 conditional. As written, a build that skips an "optional" feature fails a definition-of-done scenario.

---

## RV-S1 — All Submissions table at 300 rows

**Route:** `app/routes/admin.submissions.tsx` (`/admin/submissions`) — exists as the golden
path. NOTE: the current file has no tabs, no search, no pagination (loader `limit: 100`,
newest-first only); ROUTE-MAP marks it Wave 0/1 — the Wave-1 extension owns everything below.
Abstracts/Sessions views: `admin.abstracts.tsx` / `admin.sessions.tsx` (ROUTE-MAP, todo).

**Step 1 — reset + login.** `pnpm db:reset` → `drizzle/seed.sql`; login via `login.tsx`
(`verifyPassword` PBKDF2 → `createSession` → `__session` cookie); `/admin/submissions`
gated by `admin.tsx` layout loader `requireAdmin`.
`GAP G2 [BLOCKER]`: the current seed produces 8 submissions, not the 300/40-draft baseline —
every subsequent literal count in this suite fails on today's `db:reset`.

**Step 2 — status tabs with live counts.** One grouped query serves all eight tabs:

```sql
SELECT status, COUNT(*) AS n
FROM submissions
WHERE event_id = :eventId
GROUP BY status;
-- All  = SUM(n) WHERE status != 'draft'   → 300
-- Drafts = n WHERE status = 'draft'       → 40
```

Index check: `submissions_event_status_idx` ON (event_id, status) — this is a covering
index for the GROUP BY (equality on the leading column, grouping on the second; COUNT(*)
needs no other column). ✅ Served by index scan; fine far beyond 300 rows. `OK` for the
query/index. `GAP G15 [MINOR]`: All-excludes-drafts is only defined by this scenario.

**Step 3 — pagination.**

```sql
SELECT id, title, status, created_at
FROM submissions
WHERE event_id = :eventId AND status != 'draft'
ORDER BY created_at DESC
LIMIT 25 OFFSET 0;      -- page 1 → "1–25 of 300" (total from the grouped query above)
-- page 2: OFFSET 25 · page 12 (last): OFFSET 275 → rows 276–300
```

25/page matches SCOPE App. F ("Show 25 ▾"). OFFSET pagination at 300 rows is fine (D1,
event-scoped). `OK` — with the note that the golden-path loader must gain this (it is
`limit: 100`, no offset today).

**Step 4 — search "vector".**

```sql
SELECT id, title, status FROM submissions
WHERE event_id = :eventId AND status != 'draft'
  AND title LIKE '%vector%' COLLATE NOCASE
ORDER BY created_at DESC LIMIT 25 OFFSET 0;
-- expect "Edge-Native Vector Search on D1" among rows; clear → the step-3 query again
```

LIKE-scan over ≤ a few hundred event rows after the indexed event filter: <1ms. No FTS
needed at NORTH-STAR scale (hundreds). `GAP G16 [MINOR]`: search-field scope (title only vs
+description/speaker) is stated nowhere; this artifact assumes title.

**Step 5 — sorts.**

```sql
-- Title A→Z:
... WHERE event_id = :eventId AND status != 'draft'
ORDER BY title COLLATE NOCASE ASC LIMIT 25 OFFSET 0;
-- Newest first:
... ORDER BY created_at DESC LIMIT 25 OFFSET 0;   -- submissions_created_idx exists
```
`OK` (sorting 300 filtered rows needs no dedicated title index).

**Step 6 — Pending tab.**

```sql
... WHERE event_id = :eventId AND status = 'pending'
ORDER BY created_at DESC LIMIT 25 OFFSET 0;   -- range indicator total = 173 from the grouped query
```
Exactly the `(event_id, status)` composite index. `OK`.

**Step 7 — Abstracts / Sessions split.** Routes `admin.abstracts.tsx` / `admin.sessions.tsx`:

```sql
-- Abstracts view (all its tabs additionally AND type):
... WHERE event_id = :eventId AND type = 'abstract' AND status != 'draft'  -- 220
-- Sessions view:
... WHERE event_id = :eventId AND type = 'session'  AND status != 'draft'  -- 80
-- fixture probe: "Closing Keynote: The Post-SaaS Stack" has type='session'
--   → matches Sessions + All predicates, fails the Abstracts predicate. ✅
```
No `(event_id, type)` index; the event_id prefix of `submissions_event_status_idx` +
residual filter is fine at this scale. `OK`.

**Step 8 — empty search state.** `zzzz-no-such-talk` → step-4 query returns 0 rows → the
component renders its explicit empty row (golden path already has the `rows.length === 0`
branch; the search-specific message is a Wave-1 copy change). Binding requirement: SCOPE
cross-cutting "Empty states for every list". `OK`.

**EXPERIENCE signal.** Tab switches / search are RR7 client-side navigations (loader
refetch, no document reload) or an in-memory filter at 300 rows. Binding statement: SCOPE
cross-cutting "Performance is a scored feature… instant table interactions, no
skeleton-screen theater". Stated, but generically — no per-interaction requirement exists
outside this scenario. Noted for build agents; no separate gap filed.

---

## RV-S2 — Accept Queue is silent staging

**Step 1 — inline flip to Accept Queue.** UI per SCOPE App. F (pill → dropdown of exactly
`Accepted / Accept Queue / Pending / Decline Queue / Declined` → Save). Action on
`admin.submissions.tsx` (self-authenticating, golden-path shape):

```ts
await requireAdmin(env, request);
const parsed = z.object({
  intent: z.literal("set-status"),
  submissionId: z.string().min(1),
  status: z.enum(["accepted", "accept_queue", "pending", "decline_queue", "declined"]), // NOT withdrawn/draft
}).safeParse(Object.fromEntries(await request.formData()));
await db.update(submissions)
  .set({ status: parsed.data.status, statusChangedAt: new Date() })
  .where(and(eq(submissions.id, parsed.data.submissionId), eq(submissions.eventId, event.id)));
```

```sql
UPDATE submissions
SET status = 'accept_queue', status_changed_at = unixepoch(), updated_at = unixepoch()
WHERE id = :prompt_injection_id AND event_id = :eventId;
```

The 5-option dropdown (no withdrawn/draft) is stated in SCOPE App. F ✅.
`GAP G9 [MAJOR]`: `status_changed_at` is written here only because this walk says so —
schema has no `$onUpdate` for it and no doc assigns the write. `GAP G22 [MINOR]` noted:
no admin path to `withdrawn` exists anywhere (schema comment says admins can withdraw).

**Step 2 — pill + tab counts update without reload.** The action returns → RR7 revalidates
the route loader (fetcher submission; no document reload) → grouped-count query from RV-S1.2
re-runs → Pending 172 / Accept Queue 25. `OK` (framework behavior; binding only via SCOPE
performance prose — see RV-S1 note).

**Step 3 — decline queue flip.** Same UPDATE with `status='decline_queue'` for
"Legacy Monolith Confessions" → Pending 171 / Decline Queue 20. `OK`.

**Step 4 — outbox is empty.**

```sql
SELECT COUNT(*) FROM email_outbox
WHERE lower("to") IN ('priya.nair@example.com', 'tom.novak@example.com')
  AND sent_at >= :T;
-- expect 0
```

Guarantee: the status action above contains no `EmailSender` call, and the rule "status
changes NEVER auto-send email" is binding in SCOPE P0 #4 (bold) + flow 04 §2a. `OK`.

**Step 5/6 — portal masks queues as Pending.** Route `portals.$eventSlug.$portalId.tsx`
(Wave 2). Server-side projection — the loader must never ship the raw enum:

```ts
// portal loader — the ONLY status representation sent to the client:
const PORTAL_STATUS: Record<SubmissionStatus, "Pending" | "Accepted" | "Declined" | "Withdrawn" | "Draft"> = {
  pending: "Pending", accept_queue: "Pending", decline_queue: "Pending",
  accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn", draft: "Draft",
};
return { submissions: rows.map(s => ({ id: s.id, title: s.title, statusLabel: PORTAL_STATUS[s.status] })) };
```

Grep oracle: "Accept Queue" / "Decline Queue" can never appear in portal HTML because the
raw value never crosses the loader boundary.
**Binding-ness judgment (asked explicitly):** the rule is stated in THREE places — SCOPE
P0 #4 ("render as 'Pending' in the portal … queues stay masked"), flow 04 §2a, and
normatively in `docs/flows/09-data-exposure.md` rule *e* + its "Server-side mandatory"
section ("map queue→'Pending' in the portal serializer — never ship the raw enum to the
portal client"). `docs/flows/` is on CLAUDE.md's read-before-you-code list, so this IS
binding for build agents — SCOPE prose is not the only carrier. What's missing is only a
designated shared helper so three portal surfaces don't each re-implement it:
`GAP G17 [MINOR]`. Reaching the portal at all: `GAP G5 [MAJOR]` — `$portalId` resolves to
no table.

**Step 7 — persistence.** Reload → RV-S1.2/1.6 queries re-read the flipped rows. `OK`
(plain committed UPDATEs).

---

## RV-S3 — Bulk accept: template email with .ics, flip, idempotent double-submit

**Step 1 — selection + bulk bar.** Client-side row selection (TanStack Table) on the
Accept Queue tab (`status='accept_queue'` query, 25 rows). Bulk bar per verification B §1C
(Edit · Send Emails · …). `OK` (UI only).

**Step 2 — send templated emails.** Template lookup + port calls:

```sql
SELECT id, subject, body_html, reply_to FROM email_templates
WHERE event_id = :eventId AND key = 'accept';   -- seeded: name 'Accept Sessions' ✅ (et_accept)
```

```ts
const sender = getEmailSender(env);           // no RESEND_API_KEY locally → email_outbox sink
for (const sub of selected) {                 // selected = the 2 submissions
  const to = recipientFor(sub);               // ← G7: audience rule undefined
  await sender.send({
    to,                                       // marco.silva@… / dana.kim@…
    replyTo: template.replyTo ?? undefined,
    subject: template.subject,                // "Your session was accepted"
    html: renderTemplate(template.bodyHtml, sub),
    ics: buildAcceptIcs(sub, event),          // ← G8: unscheduled fallback undefined
    dedupeKey: `accept:${template.id}:${sub.id}:${to}`,  // ← G6: recipe undefined, this is the PROPOSAL
    eventId: event.id,
    templateId: template.id,
  });
}
```

`GAP G7 [MAJOR]` (who is the recipient per submission), `GAP G14 [MAJOR]` (suppression
check for bulk sends is stated behavior with no port mechanism: `EmailMessage` has no
`bulk` flag; `createLocalEmailSender` never queries `email_suppressions`).

**Step 3 — flip to Accepted.** Bulk status edit (verification B §1C). Single atomic
statement — `db.batch()` not even needed for one UPDATE; where the flip and the accept
spine (RV-S4) run together, `db.batch([...])` is mandatory (D1 has no interactive
transactions — tech-stack rule):

```sql
UPDATE submissions
SET status = 'accepted', status_changed_at = unixepoch(), updated_at = unixepoch()
WHERE id IN (:edge_native_id, :shipping_ics_id) AND event_id = :eventId;
```

NOTE: flipping to `accepted` triggers the accept spine (`app/domain/accept.ts`) for each —
the bulk action must call the same domain function (CLAUDE.md Wave 2). All RV-S4 gaps
(G1, G11, G12) apply here too.

**Step 4 — table + tabs.** Grouped-count query → Accept Queue 23 / Accepted 60. `OK`.

**Step 5 — outbox assertion.**

```sql
SELECT "to", subject, ics_attachment IS NOT NULL AS has_ics
FROM email_outbox WHERE sent_at >= :T ORDER BY "to";
-- expect exactly 2 rows: dana.kim@…, marco.silva@…, subject 'Your session was accepted', has_ics=1
```
`OK` given G6/G7/G8 resolved. Also the artifact for `notifiedAt` — the send flow should stamp:

```sql
UPDATE submissions SET notified_at = unixepoch()
WHERE id IN (:edge_native_id, :shipping_ics_id);
```
`GAP G10 [MAJOR]`: nothing in the design says this stamp is the send flow's job.

**Step 6 — .ics parse.** `ics` npm package (pinned dependency ✅, "plain utility, not a
port" per tech-stack):

```ts
import { createEvent } from "ics";
const { value } = createEvent({
  title: sub.title,                                    // SUMMARY references the session ✅
  start: toIcsArray(sub.startsAt ?? event.startsAt),   // ← the fallback G8 demands be stated
  end:   toIcsArray(sub.endsAt   ?? event.endsAt),
  location: room?.name ?? event.location ?? undefined,
});
// stored verbatim in email_outbox.ics_attachment (text column ✅)
```

"Edge-Native Vector Search on D1" is Accept Queue ⇒ unscheduled ⇒ without the event-dates
fallback there is NO DTSTART inside Oct 12–14. `GAP G8 [MAJOR]`.

**Step 7 — double-submit probe.** With the proposed dedupeKey
(`accept:{templateId}:{submissionId}:{to}`), the re-triggered send hits
`onConflictDoNothing({ target: emailOutbox.dedupeKey })` in `createLocalEmailSender` and
returns `{ deduped: true, id: <original row id> }` — outbox stays at 2 rows. The port
mechanics are fully designed ✅; the KEY RECIPE is not: `GAP G6 [MAJOR]`. (Trade-off to pin
when resolving G6: this recipe makes any later manual re-send of the same template to the
same person a silent no-op; if re-sends must work, occurrence needs a user-visible "send
batch" identity that survives a double-click but not a deliberate re-send.)

**Step 8 — Dana's portal shows Accepted.** RV-S2.5 projection maps `accepted → "Accepted"`. `OK`
(subject to G5).

---

## RV-S4 — THE ACCEPT SPINE (`app/domain/accept.ts`, Wave 2, integration-owned)

**Design resolution stated up front (this is the load-bearing walk):** SCOPE P0 #6 +
`schema.ts` comment "Scheduling (agenda) — an accepted submission IS the session". There is
**no session table and none is missing**: "create the Session record" (SCOPE P0 #4) is
satisfied by the submission row itself acquiring scheduling capability at
`status='accepted'`. Likewise contacts + participants already exist from submission, so
"create/link Speaker" is a no-op **except** user-account provisioning (G11). The spine's
real writes are: status flip + task assignments (+ contact/user linking, once specified).

**Step 1 — pre-state queries.**

```sql
-- "no agenda-session record" = the submission itself is pending & unscheduled:
SELECT status, starts_at, ends_at, room_id FROM submissions WHERE id = :obs_id;
-- expect: pending, NULL, NULL, NULL

-- no onboarding assignments for either speaker:
SELECT COUNT(*) FROM task_assignments ta
JOIN tasks t    ON t.id = ta.task_id AND t.is_onboarding_default = 1
JOIN contacts c ON c.id = ta.contact_id
WHERE c.event_id = :eventId
  AND c.email IN ('alex.okafor@example.com', 'jun.park@example.com');
-- expect 0
```
`OK` (queries exist; fixture existence is G2).

**Step 2 — the transition.** Route action (inline pill flip) delegates to the domain fn;
all writes in ONE `db.batch()` (D1: no interactive transactions):

```ts
// app/domain/accept.ts — called by every accept path (inline flip, bulk, one-click, P2 Airtable/API)
export async function acceptSubmission(db: Db, env: Env, submissionId: string, eventId: string) {
  const now = new Date();
  const speakers = await db.select({ contactId: participants.contactId })
    .from(participants)
    .where(and(eq(participants.submissionId, submissionId), eq(participants.role, "speaker")));
  const onboarding = await db.select({ id: tasks.id, type: tasks.type })
    .from(tasks)
    .where(and(eq(tasks.eventId, eventId), eq(tasks.isOnboardingDefault, true)));

  const existing = await db.select({ taskId: taskAssignments.taskId, contactId: taskAssignments.contactId,
                                     submissionId: taskAssignments.submissionId })
    .from(taskAssignments)
    .where(inArray(taskAssignments.taskId, onboarding.map(t => t.id)));   // idempotency guard (G1)

  const missing = plannedAssignments(onboarding, speakers, submissionId)   // cardinality rule = G12
    .filter(a => !existing.some(e => sameAssignment(e, a)));

  await db.batch([
    db.update(submissions)
      .set({ status: "accepted", statusChangedAt: now })
      .where(and(eq(submissions.id, submissionId), eq(submissions.eventId, eventId))),
    ...(missing.length ? [db.insert(taskAssignments).values(missing)] : []),
  ]);
  // NO EmailSender call here — accept provisions silently (RV-S4.5 / SCOPE P0 #4).
}
```

The task-assignment write as raw SQL (the INSERT…SELECT the prompt asks for — note it MUST
carry the NOT-EXISTS guard because no unique constraint can do it, see G1):

```sql
INSERT INTO task_assignments (id, task_id, contact_id, submission_id, status, created_at)
SELECT lower(hex(randomblob(16))), t.id, p.contact_id,
       CASE t.type WHEN 'submission' THEN :submissionId ELSE NULL END,
       'incomplete', unixepoch()
FROM tasks t
JOIN participants p ON p.submission_id = :submissionId AND p.role = 'speaker'
WHERE t.event_id = :eventId AND t.is_onboarding_default = 1
  AND NOT EXISTS (
    SELECT 1 FROM task_assignments ta
    WHERE ta.task_id = t.id AND ta.contact_id = p.contact_id
      AND (ta.submission_id = :submissionId OR (ta.submission_id IS NULL AND t.type != 'submission'))
  );
```

`GAP G1 [BLOCKER]`: nothing in the schema OR any spec forces the guard above.
`task_assignments` has only indexes — no `unique(taskId, contactId)` — and adding
`unique(task_id, contact_id, submission_id)` would NOT close it for contact-tasks because
SQLite unique indexes treat each NULL `submission_id` as distinct. The dedupe must live in
`accept.ts` (guard SQL) or the column must get a NOT NULL sentinel — either way it must be
SPECIFIED on the integration branch before Wave 2.
`GAP G12 [MAJOR]`: `plannedAssignments` cardinality per `tasks.type` is my invention
(contact-task → per speaker contact, submission-task → one per submission); nothing states
it, and the seeded `task_slides` (submission-type, onboarding-default) breaks the
scenario's "exactly 4" if the rewritten seed keeps it flagged.

**Step 3 — verify provisioned artifacts.**

```sql
-- (a) speaker records linked for BOTH people (pre-existing from submission — the spine creates nothing here):
SELECT c.email, p.role FROM participants p JOIN contacts c ON c.id = p.contact_id
WHERE p.submission_id = :obs_id;   -- alex.okafor + jun.park, role 'speaker'

-- (b) "session record" = the same row, now accepted & unscheduled → Unscheduled panel (AG-S1 query):
SELECT id FROM submissions
WHERE id = :obs_id AND status = 'accepted' AND starts_at IS NULL;

-- (c) 4 assignments, 2 per speaker:
SELECT c.email, t.name, ta.status FROM task_assignments ta
JOIN tasks t ON t.id = ta.task_id JOIN contacts c ON c.id = ta.contact_id
WHERE c.email IN ('alex.okafor@example.com','jun.park@example.com') AND t.is_onboarding_default = 1;
-- expect 4 rows: {alex,jun} × {Hotel…, Flight…}, all 'incomplete'
```
`OK` modulo G12 (count) and G11 (what "create/link" adds). "Admin speakers list" surface =
contacts joined through participants (no extra table needed) ✅.

**Step 4 — Jun's portal.**

```sql
SELECT t.name, ta.status FROM task_assignments ta
JOIN tasks t ON t.id = ta.task_id
JOIN contacts c ON c.id = ta.contact_id
JOIN users u ON u.id = c.user_id            -- ← requires contacts.user_id to be linked
WHERE u.email = 'jun.park@example.com' AND ta.status = 'incomplete';
```
`GAP G11 [MAJOR]`: Jun is a co-speaker added on Alex's form — no design path creates his
`users` row or links `contacts.user_id`, and accept must not email (so no invite can go
out at accept time). Either the spine provisions users silently (with what password?),
or the seed spec must pre-create Jun's login, or portal identity resolves by contact
email — pick one and write it down. Home shows "Accepted" via the RV-S2.5 projection ✅.

**Step 5 — outbox empty.**

```sql
SELECT COUNT(*) FROM email_outbox
WHERE lower("to") IN ('alex.okafor@example.com','jun.park@example.com') AND sent_at >= :T;
-- expect 0 — acceptSubmission() contains no sender.send()
```
`OK` — "provisioning does NOT email" is enforced by the domain function containing no port
call; binding statement = SCOPE P0 #4 status-changes-never-email + this walk.

**Step 6 — re-accept idempotency.** Flip `accepted → pending` (inline UPDATE, RV-S2.1
shape) then `pending → accepted` (spine re-runs).

```sql
-- after the round-trip, all three counts unchanged:
SELECT
 (SELECT COUNT(*) FROM submissions WHERE id = :obs_id)                                        AS session_rows,   -- 1
 (SELECT COUNT(*) FROM participants WHERE submission_id = :obs_id)                            AS speaker_links,  -- 2
 (SELECT COUNT(*) FROM task_assignments ta JOIN tasks t ON t.id=ta.task_id
   WHERE t.is_onboarding_default = 1 AND ta.contact_id IN
     (SELECT contact_id FROM participants WHERE submission_id = :obs_id))                     AS assignments;    -- 4
```

Idempotency inventory: session row — same row, nothing to duplicate ✅. Participants —
`participants_submission_contact_uq` exists ✅. Contacts — `contacts_event_email_uq`
exists ✅. Task assignments — **no constraint, no stated guard → duplicates**:
`GAP G1 [BLOCKER]` (this step is the one that fails). Note also: nothing states whether
accepted→pending should UN-provision (it must not delete task responses; leaving
assignments in place keeps this step's counts stable — state that too when fixing G1).

---

## RV-S5 — One-click "accept + send + finalize"

**SCENARIO-ERROR — see header.** SCOPE P0 #4 marks this action "optional"; the scenario
commits it. Walked anyway (it is pure composition):

**Step 2 — the action.** One route action (on the submissions route or detail route),
one composed unit:

```ts
await requireAdmin(env, request);
await acceptSubmission(db, env, sub.id, event.id);          // RV-S4 spine — same fn, CLAUDE.md Wave 2 rule ✅
await sendAcceptTemplate(db, env, [sub.id]);                // RV-S3 send (template 'accept', .ics, dedupeKey)
// finalize = the spine already set status='accepted' (final, not queued) + notified_at stamped by the send (G10)
```

**Step 3 — one-pass verification.**

```sql
SELECT status FROM submissions WHERE id = :realtime_collab_id;              -- 'accepted'
SELECT COUNT(*) FROM email_outbox WHERE "to"='ines.moreau@example.com' AND sent_at >= :T;  -- 1
SELECT ics_attachment FROM email_outbox WHERE "to"='ines.moreau@example.com' AND sent_at >= :T; -- parseable VCALENDAR
SELECT id FROM submissions WHERE id = :realtime_collab_id AND status='accepted' AND starts_at IS NULL; -- in Unscheduled
SELECT COUNT(*) FROM task_assignments ta JOIN tasks t ON t.id=ta.task_id
JOIN contacts c ON c.id=ta.contact_id
WHERE c.email='ines.moreau@example.com' AND t.is_onboarding_default=1;      -- 2
```

**Step 4 — double-click probe.** Idempotency = spine guard (G1) + email dedupeKey (G6).
Both are the already-filed gaps; the one-click action adds no new mechanism and needs none
once those are pinned. `GAP G1 [BLOCKER]` / `GAP G6 [MAJOR]` apply verbatim.

**Step 5 — Ines's portal.** Same as RV-S4.4 → `GAP G11 [MAJOR]` (Ines is a submitter
fixture with a working login per the baseline, so this instance passes via seed — the
rule still needs stating), `GAP G5 [MAJOR]` (portal reachability).

---

## RV-S6 — Reviewer provisioning + track routing

**Step 1 — add reviewer.** No pinned route: assumed `admin.evaluation.tsx` (Wave 3) —
`GAP G21 [MINOR]`. The writes:

```sql
INSERT INTO users (id, email, password_hash, name, role, created_at)
VALUES (:uid, 'rosa.delgado@example.com', :placeholder_hash, 'Rosa Delgado', 'reviewer', unixepoch());

INSERT INTO reviewer_tracks (user_id, track_id) VALUES
 (:uid, :t_ai_infra), (:uid, :t_devex);

INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
VALUES (:rid, :uid, :token, unixepoch() + 86400*7, unixepoch());
```

**Step 2 — invite email.** Port call (SCOPE P0 #5: "reuses `passwordResets` tokens + the
EmailSender port" ✅ stated):

```ts
await getEmailSender(env).send({
  to: "rosa.delgado@example.com",
  subject: "You're invited to review for Northbound AI Summit 2026",
  html: `…<a href="${origin}/reset-password/${token}">Set your password</a>…`,
  dedupeKey: `reviewer_invite:${userId}:${token}`,
  eventId: event.id,                       // templateId: none — free-compose (G21: state it)
});
```

```sql
SELECT COUNT(*) FROM email_outbox WHERE "to"='rosa.delgado@example.com' AND sent_at >= :T;  -- 1
```

**Step 3 — follow link, set password, land logged in.**
`GAP G3 [BLOCKER]`: there is NO route for the link. Required (must be added to ROUTE-MAP on
the integration branch first): e.g. `reset-password.$token.tsx` → loader validates
`password_resets.token` unused+unexpired; action:

```ts
// @public mutation (token IS the credential)
const [reset] = await db.select().from(passwordResets)
  .where(and(eq(passwordResets.token, token), isNull(passwordResets.usedAt),
             gt(passwordResets.expiresAt, new Date())));
await db.batch([
  db.update(users).set({ passwordHash: await hashPassword("R0sa!review2026") }).where(eq(users.id, reset.userId)),
  db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id)),
]);
const cookie = await createSession(env, reset.userId, isSecureRequest(request));
return redirect("/reviews", { headers: { "Set-Cookie": cookie } });   // landing page: G21 (unspecified)
```

**Step 4 — My Reviews queue.** `GAP G4 [BLOCKER]`: no reviewer route exists in ROUTE-MAP
(reviewers 403 off `/admin/*` — correctly, see step 9). Assuming e.g. `reviews.tsx`
(`/reviews`, loader `requireRole(env, request, "reviewer")`), THE JOIN:

```sql
SELECT DISTINCT s.id, s.title, s.status,
       EXISTS(SELECT 1 FROM reviews r WHERE r.submission_id = s.id AND r.reviewer_id = :rosa) AS reviewed
FROM submissions s
JOIN submission_tracks st ON st.submission_id = s.id
JOIN reviewer_tracks  rt ON rt.track_id = st.track_id AND rt.user_id = :rosa
WHERE s.event_id = :eventId AND s.status NOT IN ('draft')      -- ← scope: G13, undefined
ORDER BY s.created_at DESC
LIMIT 25 OFFSET 0;                                              -- queue is ~200 rows: paginate

-- the paired DB count the scenario cross-checks:
SELECT COUNT(DISTINCT s.id) FROM submissions s
JOIN submission_tracks st ON st.submission_id = s.id
JOIN reviewer_tracks  rt ON rt.track_id = st.track_id AND rt.user_id = :rosa
WHERE s.event_id = :eventId AND s.status NOT IN ('draft');
```
Index check: `submission_tracks` PK (submission_id, track_id) + `submission_tracks_track_idx`
and `reviewer_tracks_track_idx` serve the join both directions ✅. `GAP G13 [MAJOR]` on the
status scope.

**Step 5 — negative routing.** "SOC 2 for Startups" carries only `Security`; Rosa's
`reviewer_tracks` rows are {AI Infrastructure, Developer Experience} → the INNER JOIN on
`rt.track_id = st.track_id` yields no row → absent. `OK` (the m2m schema makes the negative
case structural).

**Step 6 — many-to-many probe.** "RAG Evals Beyond Vibes" has `submission_tracks` rows for
Security AND AI Infrastructure → the AI-Infrastructure row matches → present once
(`SELECT DISTINCT` collapses the would-be duplicate if a submission shares 2 tracks with
the reviewer). `OK`.

**Step 7 — record Approve + comment.** Upsert against the verified unique:

```ts
await requireRole(env, request, "reviewer");
// authorization: reviewer may only write within their tracks (09-data-exposure "assignment-tuple
// check on every eval read/write" — stated ✅). Guard: re-run the step-4 membership predicate.
await db.insert(reviews)
  .values({ submissionId, reviewerId: user.id, decision: "approve",
            comment: "Strong speaker, fresh data — verify the offline demo claim." })
  .onConflictDoUpdate({
    target: [reviews.submissionId, reviews.reviewerId],   // reviews_submission_reviewer_uq ✅ VERIFIED in schema.ts
    set: { decision: "approve", comment: "…", updatedAt: new Date() },
  });
```
`OK` — `unique("reviews_submission_reviewer_uq").on(t.submissionId, t.reviewerId)` exists
(schema.ts, reviews table). Queue item flips to reviewed via the `EXISTS` column in step 4.

**Step 8 — decision change Approve → Maybe.** Same upsert with `decision: "maybe"` — the
conflict branch takes the UPDATE path:

```sql
UPDATE reviews SET decision='maybe', updated_at=unixepoch()
WHERE submission_id = :ragEvals AND reviewer_id = :rosa;
```
Persists on reload (committed row). `OK`.

**Step 9 — authorization probe.** `/admin/submissions` GET → `admin.tsx` layout loader
`requireAdmin` → role `reviewer` ∉ ["admin"] → `throw redirect("/403")` (`app/lib/auth.ts`
requireUser roles branch; `403.tsx` exists). No admin data rendered — the loader throws
before any query. `OK` — fully designed.

**Step 10 — admin tally.**

```sql
SELECT r.decision, COUNT(*) AS n FROM reviews r
WHERE r.submission_id = :ragEvals GROUP BY r.decision;      -- approve 1 · maybe 1 · deny 0
SELECT u.name, r.decision, r.comment FROM reviews r
JOIN users u ON u.id = r.reviewer_id
WHERE r.submission_id = :ragEvals;                          -- Ben Ito approve (seeded — G2) + Rosa maybe + comment
```
Surface: submission review detail (`admin.submissions.$id.tsx` or `admin.evaluation.tsx`).
`OK` modulo G2 (Ben Ito seed).

**EXPERIENCE.** In-place decision update = fetcher submission + loader revalidation;
queue pagination at ~200 from step 4's LIMIT/OFFSET. Binding: SCOPE performance prose only.

---

## RV-S7 — Committed decision-feedback email

Committed ✅ — SCOPE P0 #5: "COMMITTED (swyx named it twice…): compose + send an email to
the speaker … when recording the decision. Textarea on the decision UI + the existing
EmailSender port." In tier; no scenario-error.

**Step 2 — decision + feedback in one save.** Same reviewer route action (G4 applies), one
action handling both facts:

```ts
await requireRole(env, request, "reviewer");
const { decision, feedback } = parsed;   // feedback: z.string().optional()
await db.insert(reviews).values({ submissionId, reviewerId: user.id, decision, comment: feedback || null })
  .onConflictDoUpdate({ target: [reviews.submissionId, reviews.reviewerId],
                        set: { decision, comment: feedback || null, updatedAt: new Date() } });
if (feedback?.trim()) {                  // email fires ONLY on explicit compose (step 5's rule)
  await getEmailSender(env).send({
    to: submitterEmail,                  // sam.rivera@example.com — recipient rule: G18
    subject: `Feedback on your submission: ${submission.title}`,   // subject: G18 (unspecified)
    html: `<p>${escapeHtml(feedback)}</p>`,   // body contains the text verbatim ✅
    eventId: event.id,
    // templateId: none — free-compose per SCOPE ("textarea + the port"); outbox row has template_id NULL ✅
    // dedupeKey: OMIT — a later, different feedback send to the same person must not be swallowed (G18: state it)
  });
}
```
`GAP G18 [MINOR]` (subject / recipient / dedupe policy unstated — the design intent
"free-compose, no template" IS derivable from SCOPE's wording, so no template gap).

**Step 3 — outbox.**

```sql
SELECT "to", html FROM email_outbox WHERE sent_at >= :T;
-- exactly 1 row; to='sam.rivera@example.com'; html LIKE '%latency/cost numbers before Aug 30%'
```
`OK`.

**Step 4 — decision recorded, status untouched.**

```sql
SELECT decision FROM reviews WHERE submission_id = :edge_case_id AND reviewer_id = :rosa; -- 'maybe'
SELECT status FROM submissions WHERE id = :edge_case_id;                                  -- 'pending'
```
The action above never touches `submissions.status` — decision, feedback email, and status
are three writes to three places (reviews / email_outbox / submissions), coupled nowhere in
the schema. `OK` — the decoupling is structural.

**Step 5 — deny without feedback.** `feedback` empty → the `if` never calls the port →

```sql
SELECT COUNT(*) FROM email_outbox WHERE sent_at >= :T2;  -- 0 new rows
```
`OK` (conditional-send rule carried by this walk + the scenario; harmless to state in the
same doc that fixes G18).

**Step 6 — Sam's portal still Pending.** A reviewer decision lives in `reviews`, which the
portal projection (RV-S2.5) never reads; 09-data-exposure explicitly hides eval data from
the portal payload. `OK` modulo G5.

---

## RV-S8 — Withdrawal keeps the record

Tier check: speaker self-service withdrawal = SCOPE P1 #11 (portal Withdraw driving the
queue/withdrawn semantics) + flow 04 §2a Withdrawn (who/why metadata). In scope (suite
covers P0 + committed P1). Schema columns exist: `withdrawnAt`, `withdrawnById → users`,
`withdrawnReason` ✅.

**Steps 1–3 — the dialog + validation + the UPDATE.** Portal route action
(`portals.$eventSlug.$portalId.tsx` — G5):

```ts
const user = await requireUser(env, request);            // portal actions self-authenticate
const parsed = z.object({
  intent: z.literal("withdraw"),
  submissionId: z.string().min(1),
  reason: z.string().min(1, "Please tell us why you're withdrawing."),  // ← step-2 unhappy path
}).safeParse(Object.fromEntries(await request.formData()));
if (!parsed.success) return { fieldErrors: … };          // submission stays 'accepted' ✅
// ownership: the caller must be linked to the submission — rule unstated (G19). Artifact assumes
// submitter OR participant-contact:
const owns = await db.select({ id: submissions.id }).from(submissions)
  .leftJoin(participants, eq(participants.submissionId, submissions.id))
  .leftJoin(contacts, eq(contacts.id, participants.contactId))
  .where(and(eq(submissions.id, parsed.data.submissionId),
             or(eq(submissions.submitterId, user.id), eq(contacts.userId, user.id))));
```

```sql
UPDATE submissions
SET status = 'withdrawn',
    withdrawn_at = unixepoch(),
    withdrawn_by_id = :dana_user_id,
    withdrawn_reason = 'Visa denied — I can''t travel to the US in October.',
    status_changed_at = unixepoch(),
    updated_at = unixepoch()
WHERE id = :shipping_ics_id AND event_id = :eventId;
-- content columns (title, description) untouched — nothing wiped ✅
```
Who can set (the prompt's question): speaker via this portal action; admin via… nothing —
the inline dropdown deliberately excludes Withdrawn (SCOPE App. F) and no admin affordance
is designed (`GAP G22 [MINOR]`); ownership rule unstated (`GAP G19 [MINOR]`); mandatory
reason enforced by the `.min(1)` refinement (golden-path pattern ✅).

**Step 4 — portal shows Withdrawn.** RV-S2.5 projection maps `withdrawn → "Withdrawn"`. `OK`.

**Step 5 — admin Withdrawn tab = 12, record intact.** Grouped-count query (RV-S1.2) →
withdrawn 12; detail loader:

```sql
SELECT s.title, s.description, s.status, s.withdrawn_at, s.withdrawn_reason, u.name AS withdrawn_by
FROM submissions s LEFT JOIN users u ON u.id = s.withdrawn_by_id
WHERE s.id = :shipping_ics_id;
SELECT t.name FROM submission_tracks st JOIN tracks t ON t.id = st.track_id WHERE st.submission_id = :shipping_ics_id;
SELECT c.first_name, c.last_name FROM participants p JOIN contacts c ON c.id = p.contact_id WHERE p.submission_id = :shipping_ics_id;
```
`OK` — cascade design keeps everything (no deletes anywhere in the flow).

**Step 6 — who/when/why.** Columns above: Dana Kim (via `withdrawn_by_id → users.name`),
`withdrawn_at` today, reason verbatim. `OK`.

**Step 7 — session leaves the agenda pool.** AG-S1 unscheduled-panel query filters
`status IN (schedulable statuses — default ['accepted'])`; `withdrawn` ∉ set → gone. `OK`,
with `GAP G20 [MINOR]`: Dana's session was unscheduled here, but a *scheduled* withdrawal
leaves `starts_at/room_id` residue — grid/embed queries must filter by status (implicit
today) or withdrawal must clear the scheduling columns; state which.

**Step 8 — DB probe.** Step-5/6 queries are the probe. `OK`.

**EXPERIENCE.** One portal dialog (fetcher + validation errors in place); admin sees it in
the Withdrawn tab on next load via the count query. `OK` by design shape.

---

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Re-walked every step of every scenario against the landed Wave-A schema
(`app/db/schema.ts`: `organizations`, `organization_members`,
`events.organizationId` NOT NULL FK, `api_tokens.organizationId` NOT NULL +
nullable `eventId`, `fields.scope` dropped → org/event XOR), the rewritten
`drizzle/seed.sql` (`org_demo` · member `om_admin`(u_admin) · `e_demo` org-attached),
`app/lib/auth.ts` (unchanged in Wave A — role-based `requireAdmin`, any-event
fallback still present), `docs/multi-tenancy-design.md`, and `docs/ROUTE-MAP.md`.

**Reviewer model, stated up front (this suite is reviewer-heavy):** the membership
model does NOT apply to reviewers. Design doc: *"Reviewers already have an
event-scoped path via reviewer assignments"* (§Verified Sessionboard shape,
consequences para) and *"`users.role` remains through this design (membership
gates *which events*; the enum gates *which surface* — orthogonal checks)"*
(§Authorization). A reviewer gets `users.role='reviewer'` + `reviewer_tracks`
rows and **no `organization_members` row** — minting one would make them a full
equal-admin of the org (there is no role column to say otherwise). Every reviewer
artifact below is checked against `events.organizationId` NOT NULL: none of the
reviewer writes/reads touch `events` columns, so all survive.

**Prior-gap status observed during this re-walk (not tenancy-caused, recorded for
truth):** the `portals` table now exists in `schema.ts` (+ seeded `portal_demo`)
and ROUTE-MAP pins `portals.$eventSlug.$portalId.tsx` — **G5's missing-table half
is resolved**; the route file is still todo. ROUTE-MAP now also pins
`set-password.$token.tsx` (G3), `reviews.tsx`/`reviews.$id.tsx` (G4), and
`admin.reviewers.tsx` (G21's route half) — the route-collision risk is closed,
the files remain unbuilt so G3/G4 stand as blockers until they exist.

### New gaps from this re-walk

| # | Step(s) | Gap | Severity |
|---|---|---|---|
| G23 | RV-S3.2 | `email_suppressions` stayed GLOBAL (no `organizationId` — the migration didn't touch it): one unsubscribe list across tenants, so an address that unsubscribes from Demo-org announcements is suppressed for every org's bulk sends. Defensible as person-level opt-out, but it's now a cross-tenant data flow the design doc doesn't record. Decide + state (global person-level opt-out vs per-org suppression) in the same doc that resolves G14 — the suppression check is being specified there anyway. | MINOR |
| G24 | RV-S6.4 (also hits RV-S7.1) | Reviewer surfaces have NO stated event-resolution rule under membership-gated auth. Post-Wave-B `getActiveEvent(env, reviewer)` returns **null** by design ("first event across MY orgs, else null" — reviewers have no orgs, and must not). CLAUDE.md's house rule ("NEVER hardcode `findMany({limit:1})` — call getActiveEvent") actively steers the G4 route builder into the null path → empty/broken My Reviews queue after Wave B, judge-visible (P0 #5). The design doc's Wave-B regression line ("speaker/reviewer landing unchanged") commits a CHECK but no mechanism, and `/reviews` doesn't exist yet to be regression-checked. Fix is one binding sentence where G4's route is built: reviewer surfaces derive event scope from `reviewer_tracks → tracks.event_id` (artifact at RV-S6.4), never `getActiveEvent`, + a no-membership-user test on Wave B's `getActiveEvent` change. | MAJOR |

No other verdict below depends on uncommitted work: steps that lean on Wave B/C/D
behavior cite the design-doc line that commits it.

### RV-S1 step 1 — CHANGED

The seed baseline now REQUIRES tenancy rows — `events.organizationId` is NOT NULL,
so the baseline event cannot exist without its org. The landed `drizzle/seed.sql`
already carries the shape (real SQL, verified in this worktree):

```sql
INSERT INTO organizations (id, name, created_at) VALUES
 ('org_demo', 'Demo', unixepoch());

INSERT INTO organization_members (id, organization_id, user_id, created_at) VALUES
 ('om_admin', 'org_demo', 'u_admin', unixepoch());

INSERT INTO events (id, organization_id, name, slug, type, timezone, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'org_demo', 'Northbound AI Summit 2026', 'northbound-ai-summit-2026', 'Conference',
  'America/Los_Angeles', unixepoch('2026-10-12'), unixepoch('2026-10-14'), unixepoch());
```

**Consequence for G2 (still BLOCKER, scope grows one row):** the 300-submission
baseline rewrite this suite's header specifies must mint these three rows first —
an events INSERT without `organization_id` now fails at `db:reset`, which is the
right failure. Login itself is unchanged (`users.role='admin'` survives — design
doc §Product model: the enum lives, `homePathForRole` keys off it). `getActiveEvent`
is unchanged in Wave A and the seed sets `u_admin.active_event_id='e_demo'`, so the
any-event fallback is unreached; the Wave-B membership check passes for this seat:

```sql
SELECT 1 FROM organization_members om
JOIN events e ON e.organization_id = om.organization_id
WHERE om.user_id = 'u_admin' AND e.id = 'e_demo';   -- 1 row → access (covered: Wave B, design §Authorization bullet 1)
```

### RV-S1 step 2 — UNCHANGED
The grouped-count query is keyed on `submissions.event_id`; `submissions` gained no
org column (org is derived via the event, never stored where derivable — design
§Schema). `:eventId` still arrives via `getActiveEvent` (Wave A code unchanged;
Wave B membership check covered, see step 1).

### RV-S1 step 3 — UNCHANGED
Pagination query filters `event_id + status` only — no tenancy column in the
predicate, index `submissions_event_status_idx` untouched by the migration.

### RV-S1 step 4 — UNCHANGED
Search is the step-3 predicate + `title LIKE` — no tenancy surface.

### RV-S1 step 5 — UNCHANGED
Sorts reorder the same event-scoped rows; no tenancy column.

### RV-S1 step 6 — UNCHANGED
`status='pending'` variant of the same event-scoped query.

### RV-S1 step 7 — UNCHANGED
Abstracts/Sessions split adds `AND type=…` to the same event-scoped predicate;
`type` and the routes are untouched by the migration.

### RV-S1 step 8 — UNCHANGED
Empty state is a render branch on 0 rows from the step-4 query; no tenancy surface.

### RV-S2 step 1 — UNCHANGED
The inline-flip action writes `submissions.status/status_changed_at/updated_at`
scoped by `id + event_id` — no tenancy column in the statement. `requireAdmin` is
Wave-A-unchanged (role check); its swap to a membership check is covered: Wave B
(design §Authorization: "The admin guard swaps the global-role check for a
membership check") — the seeded admin passes via `om_admin` (RV-S1.1 artifact).
G9/G22 stand as filed.

### RV-S2 step 2 — UNCHANGED
Loader revalidation re-runs the RV-S1.2 event-scoped count query; nothing tenant-
shaped in the round trip.

### RV-S2 step 3 — UNCHANGED
Same UPDATE, different status value and fixture.

### RV-S2 step 4 — UNCHANGED
`email_outbox` gained no org column (its nullable `event_id` ref is untouched);
the zero-rows assertion queries recipients + `sent_at` only.

### RV-S2 step 5 — UNCHANGED
The portal projection reads `submissions.status` only — no tenancy input. Speaker
portal access is deliberately NOT membership-gated (speakers aren't org members;
membership gates admin surfaces — design §Authorization; row-level `eventId`
verification continues per flows/09). Note: G5's schema half is resolved — the
`portals` table + seeded `portal_demo` now exist and `$portalId` resolves to
`portals.public_id`; route file still todo, so portal reachability still pends
the Wave-2 build.

### RV-S2 step 6 — UNCHANGED
Same projection, Tom's session; same reasoning as step 5.

### RV-S2 step 7 — UNCHANGED
Committed UPDATEs re-read by the event-scoped queries; no tenancy surface.

### RV-S3 step 1 — UNCHANGED
Client-side selection over the event-scoped Accept-Queue query; UI only.

### RV-S3 step 2 — GAP (G23 [MINOR] — send artifact itself unchanged)
Template lookup (`email_templates` is event-scoped, untouched) and the port loop
are byte-identical to the 2026-08-09 artifact; G6/G7/G14 stand as filed. The
tenancy determination that IS new: `email_suppressions` remains a single global
table — under multi-tenancy the stated bulk-suppression behavior (G14) now reads
across the org boundary (org A's unsubscribe silently suppresses org B's sends).
`GAP G23 [MINOR]` — record the decision (global person-level opt-out vs per-org)
wherever G14's suppression mechanics get pinned.

### RV-S3 step 3 — UNCHANGED
Bulk flip UPDATE is `id IN (…) AND event_id = :eventId` — no tenancy column; the
spine it triggers writes only event-scoped tables (see RV-S4.2). G1 applies as filed.

### RV-S3 step 4 — UNCHANGED
Grouped-count re-read; event-scoped.

### RV-S3 step 5 — UNCHANGED
Outbox assertion + `notified_at` stamp touch `email_outbox`/`submissions` only —
neither gained a tenancy column. G10 stands.

### RV-S3 step 6 — UNCHANGED
`.ics` builds from `submissions.starts_at/ends_at` with the `events.starts_at/ends_at`
fallback — `events` gained `organization_id` but the dates the artifact reads are
untouched. G8 stands.

### RV-S3 step 7 — UNCHANGED
Dedupe mechanics are org-safe without modification: `email_outbox.dedupe_key` is a
GLOBAL unique, but the proposed recipe `accept:{templateId}:{submissionId}:{to}`
is built from UUIDs that are unique across orgs, so no cross-tenant collision is
possible. G6 (the recipe is still only a proposal) stands as filed.

### RV-S3 step 8 — UNCHANGED
Portal projection of `accepted` — same reasoning as RV-S2.5 (G5 schema half resolved).

### RV-S4 step 1 — UNCHANGED
Pre-state queries read `submissions`/`task_assignments`/`tasks`/`contacts` — all
event-scoped, none gained a tenancy column.

### RV-S4 step 2 — UNCHANGED
`acceptSubmission()` writes `submissions` + `task_assignments` and reads
`participants`/`tasks` — zero tenancy columns in any statement; the org is derivable
from `event_id` and correctly never stored on these rows (design §Schema XOR
rationale). G1 [BLOCKER] and G12 stand exactly as filed — the migration added no
constraint to `task_assignments`.

### RV-S4 step 3 — UNCHANGED
All three artifact queries (participants join, accepted+unscheduled row, assignment
count) are event-scoped reads; no tenancy surface.

### RV-S4 step 4 — UNCHANGED
Jun's portal task query joins `users → contacts → task_assignments` — no org hop.
Tenancy check made explicitly: co-speaker user provisioning (G11, still open) must
NOT mint an `organization_members` row — speakers are not org members (design
§Verified shape: membership = equal org ADMINS). Whatever resolves G11 stays inside
`users`/`contacts`.

### RV-S4 step 5 — UNCHANGED
Outbox-empty assertion; the spine still contains no port call. No tenancy surface.

### RV-S4 step 6 — UNCHANGED
Idempotency inventory is identical: `participants`/`contacts` uniques survive the
migration untouched; `task_assignments` still has NO unique — G1 [BLOCKER] is
unchanged by tenancy and still the step that fails.

### RV-S5 step 1 — UNCHANGED
Locating the fixture is the RV-S1.6-shaped event-scoped queue query.

### RV-S5 step 2 — UNCHANGED
The one-click action composes `requireAdmin` (Wave-A role check; membership swap
covered: Wave B, design §Authorization) + the RV-S4 spine + the RV-S3 send — all
walked above, no tenancy column anywhere in the composition. SCENARIO-ERROR
("optional" tier mismatch) stands as filed.

### RV-S5 step 3 — UNCHANGED
One-pass verification queries are the RV-S3/S4 event-scoped artifacts verbatim.

### RV-S5 step 4 — UNCHANGED
Double-click = G1 + G6 exactly as filed; the migration added no mechanism and
removed none.

### RV-S5 step 5 — UNCHANGED
Ines's portal — RV-S2.5 reasoning (G5 schema half resolved); G11 note as at RV-S4.4.

### RV-S6 step 1 — UNCHANGED
The reviewer-provisioning writes survive the migration untouched — verified column
by column against the new schema: `users` (role `'reviewer'` — the enum SURVIVES
Wave A and its removal is a registered follow-up, design §Authorization closing
para), `reviewer_tracks` (user↔track, event scope derived via `tracks.event_id`),
`password_resets` (user-scoped). None references `events` directly, so
`events.organizationId` NOT NULL cannot break them:

```sql
INSERT INTO users (id, email, password_hash, name, role, created_at)
VALUES (:uid, 'rosa.delgado@example.com', :placeholder_hash, 'Rosa Delgado', 'reviewer', unixepoch());
INSERT INTO reviewer_tracks (user_id, track_id) VALUES (:uid, :t_ai_infra), (:uid, :t_devex);
INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
VALUES (:rid, :uid, :token, unixepoch() + 86400*7, unixepoch());
-- Deliberately NO organization_members row: membership = equal org admin
-- (no role column to say otherwise); a reviewer must never get one.
```

Route note: ROUTE-MAP now pins `admin.reviewers.tsx` — G21's unpinned-route half
resolved; template/landing halves stand.

### RV-S6 step 2 — UNCHANGED
Invite send: port + `email_outbox` untouched by the migration; dedupeKey
`reviewer_invite:{userId}:{token}` is UUID-composed → globally unique, no
cross-tenant collision.

### RV-S6 step 3 — UNCHANGED
Set-password artifact writes `users.password_hash` + `password_resets.used_at` and
mints an `auth_sessions` row — none touched by the migration. Redirect target
`/reviews` per `homePathForRole('reviewer')`, which keys off the SURVIVING role
enum (design §Product model item 1). ROUTE-MAP now pins `set-password.$token.tsx`,
closing G3's collision risk; the file is still todo so G3 stands until built.

### RV-S6 step 4 — GAP (G24 [MAJOR] — queue join itself unchanged)
The track-overlap join reads `submissions`/`submission_tracks`/`reviewer_tracks` —
no tenancy columns, survives as written. What the tenancy design breaks is the
`:eventId` INPUT: the 2026-08-09 artifact scoped by `s.event_id = :eventId` without
saying where a REVIEWER's event comes from. Post-Wave-B, `getActiveEvent(env, rosa)`
returns **null** by design (reviewers hold no memberships), and CLAUDE.md's rule
steers the G4 builder straight into it. `GAP G24 [MAJOR]` (details in this
re-walk's gap table). The producible artifact under the new schema — event scope
derived from the reviewer's own assignments, no `getActiveEvent` call:

```sql
SELECT DISTINCT s.id, s.title, s.status,
       EXISTS(SELECT 1 FROM reviews r WHERE r.submission_id = s.id AND r.reviewer_id = :rosa) AS reviewed
FROM submissions s
JOIN submission_tracks st ON st.submission_id = s.id
JOIN reviewer_tracks  rt ON rt.track_id = st.track_id AND rt.user_id = :rosa
JOIN tracks tr          ON tr.id = rt.track_id
WHERE s.event_id = tr.event_id            -- ← reviewer's event scope = their assigned tracks' events
  AND s.status NOT IN ('draft')           -- scope: G13, still undefined
ORDER BY s.created_at DESC LIMIT 25 OFFSET 0;
```

(A reviewer assigned in two orgs' events sees each event's queue through its own
tracks — the event-scoped reviewer path the design doc names.) G4 (route unbuilt)
and G13 stand; ROUTE-MAP now pins `reviews.tsx`/`reviews.$id.tsx`, closing the
collision half of G4.

### RV-S6 step 5 — UNCHANGED
Negative routing is structural in the m2m join — no tenancy input.

### RV-S6 step 6 — UNCHANGED
Many-to-many probe — same join, `SELECT DISTINCT` unchanged.

### RV-S6 step 7 — UNCHANGED
Review upsert targets `reviews_submission_reviewer_uq` (survives untouched);
`requireRole(env, request, "reviewer")` keys off the surviving role enum — the
membership model does not apply (design §Authorization closing para).

### RV-S6 step 8 — UNCHANGED
Same upsert, UPDATE branch; committed row persists.

### RV-S6 step 9 — UNCHANGED
Wave A: `requireAdmin` role check throws `redirect("/403")` for role `'reviewer'` —
byte-identical to the 2026-08-09 artifact (`app/lib/auth.ts` unchanged). Post-Wave-B
the guard becomes a membership check and Rosa STILL bounces — she has no
`organization_members` row:

```sql
SELECT 1 FROM organization_members WHERE user_id = :rosa;   -- 0 rows → 403
```

Covered: Wave B (design §Authorization admin-guard bullet + "the enum gates which
surface"). The probe's outcome is invariant across the waves.

### RV-S6 step 10 — UNCHANGED
Tally queries read `reviews` + `users` — no tenancy columns; the admin surface
guard is the step-9 story (covered: Wave B). G2 (Ben Ito seed) stands.

### RV-S7 step 1 — GAP (G24 applies — filed at RV-S6.4, not re-filed)
Opening an item in My Reviews rides the same reviewer event-resolution rule the
tenancy design leaves unstated; the detail loader's own read
(`reviews`/`submissions` by id + the track-membership guard) has no tenancy column
and survives as written. G4 stands for the route file.

### RV-S7 step 2 — UNCHANGED
Decision-upsert + conditional port call write `reviews`/`email_outbox` — neither
gained a tenancy column; `requireRole("reviewer")` survives per the role-enum line.
G18 stands.

### RV-S7 step 3 — UNCHANGED
Outbox verbatim-body assertion — no tenancy surface.

### RV-S7 step 4 — UNCHANGED
Three decoupled writes to three tables, none org-scoped; the decoupling is still
structural.

### RV-S7 step 5 — UNCHANGED
The `if (feedback)` guard is app logic; no tenancy input.

### RV-S7 step 6 — UNCHANGED
Portal projection never reads `reviews`; flows/09 hides eval data from the portal
payload — untouched by the migration (G5 schema half resolved, route still todo).

### RV-S8 step 1 — UNCHANGED
Portal withdraw dialog: `requireUser` (no role/membership check — speakers are not
org members by design) + ownership join over `submissions`/`participants`/`contacts` —
no tenancy columns. G19 stands.

### RV-S8 step 2 — UNCHANGED
`.min(1)` validation branch is app logic; no tenancy surface.

### RV-S8 step 3 — UNCHANGED
The withdraw UPDATE writes status/withdrawn_* columns scoped by `id + event_id` —
none tenancy-touched.

### RV-S8 step 4 — UNCHANGED
Projection maps `withdrawn → "Withdrawn"` — RV-S2.5 reasoning.

### RV-S8 step 5 — UNCHANGED
Count + detail queries are event-scoped reads of untouched columns.

### RV-S8 step 6 — UNCHANGED
`withdrawn_by_id → users.name` join — `users` kept its shape (role enum survives).

### RV-S8 step 7 — UNCHANGED
Unscheduled-panel filter reads `events.schedulable_statuses` — `events` gained
`organization_id` but this column and the status filter are untouched. G20 stands.

### RV-S8 step 8 — UNCHANGED
The step-5/6 queries are the probe; committed rows, no tenancy surface.

### Re-walk tally

58 steps walked · 1 CHANGED (RV-S1.1 — seed baseline gains org/membership rows) ·
54 UNCHANGED (determination recorded per step) · 3 steps carrying GAP verdicts for
2 new gaps: **G23 [MINOR]** (global suppression list crosses the org boundary),
**G24 [MAJOR]** (reviewer event-resolution unstated under membership-gated
`getActiveEvent`; hits RV-S6.4 + RV-S7.1). All pre-existing gaps (G1–G22) were
re-checked against the new schema: none is fixed or worsened by the migration
except as noted inline (G2 grows the three org rows; G3/G4/G21 route-collision
halves closed by ROUTE-MAP pins; G5's missing-table half resolved by the `portals`
table).

## 2026-08-11 re-walk — calendar revision ledger and provider send claims (design-time gate)

**Gate trigger.** This file's `touches:` names `emailOutbox`, `ports: [email]` and
`domain: [app/domain/accept.ts]` — the densest match on this branch, which changes `app/db/schema.ts`,
`app/ports/email.ts`, `app/domain/accept.ts` and `app/lib/ics.ts`. All 59 steps are walked below — none
pre-filtered. Shared structural findings **S1**, **S2** and **S3** are stated in full in
`01-auth-event-setup.walk.md` §"2026-08-11 re-walk".

Two scope facts govern this file:

- **The `accept.ts` delta is confined to `sendDecisionEmails`.** The diff's three hunks land at or after
  line 838; `transitionSubmissions`, `withdrawSubmission`, `previewDecisionEmails`, `inviteRecipients`,
  `inviteForSubmission` and `icsForInvites` are unchanged. Status flips and provisioning therefore carry no
  new behavior.
- **The `ics.ts` delta is on the READER, not the WRITER.** `parseIcsAttachment` was replaced by a stricter
  `scanIcsEventBlocks` + envelope validator used to read *historic* attachments during normalization. The
  serializer that produces outgoing invites is untouched, so every `.ics` a speaker receives is byte-shaped
  exactly as on `origin/main`.

### RV-S1 — All Submissions at 300 rows (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Seed baseline + admin login. |
| 2 | UNCHANGED | Status tab counts read `submissions.status`. |
| 3 | UNCHANGED | 25/page pagination and range indicator. |
| 4 | UNCHANGED | Search filter and clear. |
| 5 | UNCHANGED | Title and date sorts. |
| 6 | UNCHANGED | Pending tab scoping. |
| 7 | UNCHANGED | Abstracts/Sessions split. |
| 8 | UNCHANGED | No-match empty state. |

### RV-S2 — Accept Queue is silent staging (7 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Pill dropdown → Accept Queue via `transitionSubmissions`. |
| 2 | UNCHANGED | Optimistic tab recount. |
| 3 | UNCHANGED | Decline Queue flip. |
| 4 | UNCHANGED | **Zero-email oracle holds.** Queue transitions never call the port, so no `email_outbox` row and no `send_claim_id` is written; the new claim columns cannot make a silent stage observable. |
| 5 | UNCHANGED | Portal masks Accept Queue as Pending. |
| 6 | UNCHANGED | Portal masks Decline Queue as Pending. |
| 7 | UNCHANGED | Queue statuses persist on reload. |

### RV-S3 — bulk accept end-to-end (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Bulk selection bar. |
| 2 | UNCHANGED | Template pick + recipient preview — `previewDecisionEmails` is untouched. |
| 3 | UNCHANGED | Flip both to Accepted. |
| 4 | UNCHANGED | Table + tab counts. |
| 5 | **CHANGED — same oracle, wider durable record.** | The two sends now run through `sendDecisionEmails`' claim path. Oracle unchanged: exactly 2 outbox rows ≥ T, one per recipient, each with the template subject and one `.ics` attachment. New durable side effects per row: a `calendar_invite_revisions` attempt row (immutable, keyed `(outbox_id, submission_id)`), a `calendar_invite_processed_outbox` marker, and an advanced `calendar_invite_sequence_frontiers` row for each submission. None of these are organizer-visible in the outbox view. |
| 6 | UNCHANGED | The parsed `.ics` is produced by the untouched serializer: one balanced `VCALENDAR`, a `VEVENT` whose `SUMMARY` names the session and whose `DTSTART` falls in Oct 12–14 2026, plus the same stable `UID` (`icsUidForSubmission`) as on `origin/main`. |
| 7 | **CHANGED — strictly stronger.** | The double-submit probe's oracle ("still exactly 2 rows, no duplicates") now holds under genuine concurrency, not just serial replay: the Resend adapter claims each row with a D1 compare-and-swap (`UPDATE … WHERE id = ? AND send_claim_id = ?`) and sends the dedupe identity as Resend's `Idempotency-Key`. Because `sendDecisionEmails` stamps `submissions.notified_at`, this is one of exactly two call sites that pass `onInFlight: "reject"` (`app/domain/accept.ts:891`) — a losing concurrent request reports the recipient as *in flight* rather than claiming a delivery it did not make. The UI surfaces that as "already being sent this decision — no action needed", never as a failure. |
| 8 | UNCHANGED | Portal shows Accepted. |

### RV-S4 — accepting auto-provisions the spine (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Pre-state DB probe. |
| 2 | UNCHANGED | Inline flip to Accepted. |
| 3 | UNCHANGED | Speaker/session/task provisioning — all in untouched code. |
| 4 | UNCHANGED | Speaker portal shows open tasks + Accepted. |
| 5 | UNCHANGED | **Zero-email oracle holds** — provisioning never calls the port, so no row, no claim, no calendar-ledger write. |
| 6 | UNCHANGED | Re-flip idempotence of provisioning. |

### RV-S5 — preview-confirm accept + send + finalize (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Locate the submission in Accept Queue. |
| 2 | UNCHANGED | In-app preview dialog contents and Cancel-writes-nothing — `previewDecisionEmails` is untouched. |
| 3 | UNCHANGED | Confirm and send. |
| 4 | **CHANGED — same oracle, wider durable record.** | Same delta as RV-S3.5: exactly 1 outbox row ≥ T with the previewed subject/body and a parseable `.ics`, plus one new revision row, one processed marker, and a frontier at sequence 0 for this submission. Speaker record and Agenda placement are unchanged. |
| 5 | **CHANGED — strictly stronger.** | The replay probe previously relied on the preview fingerprint + idempotency key alone. It now additionally survives a *concurrent* replay: the claim CAS admits one sender, the loser sees `EmailSendInFlightError` (opted in at `accept.ts:891`) and is reported as in-flight, and a lease takeover after an abandoned attempt cannot overwrite a confirmed provider success. Outbox still 1 row, one session record, no duplicate tasks. |
| 6 | UNCHANGED | Portal shows Accepted + 2 tasks. |

### RV-S6 — reviewer provisioning + track routing (10 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Reviewer create writes `users`/`reviewerTracks`. |
| 2 | **CHANGED — same oracle, different duplicate surface.** | The invite send routes through the port. Oracle unchanged: exactly 1 outbox row ≥ T to rosa.delgado@example.com with a working set-password link. The duplicate path is the regression this gate found: `mintInviteToken` is deterministic in `sendKey` (`app/lib/reviewers.ts:143`) and `admin.reviewers.tsx` never consumes the key, so a double-clicked Invite collides. Mid-branch that threw an uncaught `EmailSendInFlightError` → a 500 page. Fixed by defaulting `onInFlight` to `"dedupe"` (S2); this site passes no `onInFlight`, so it returns `{ deduped: true }` as on `origin/main`. Full write-up at AE-S5.3 in `01-auth-event-setup.walk.md`. |
| 3 | UNCHANGED | Set password from the link, land as reviewer. |
| 4 | UNCHANGED | My Reviews queue = track-overlap join. |
| 5 | UNCHANGED | Negative routing probe. |
| 6 | UNCHANGED | Many-to-many overlap probe. |
| 7 | UNCHANGED | Approve with comment. |
| 8 | UNCHANGED | Decision change persists. |
| 9 | UNCHANGED | Reviewer blocked from admin URLs. |
| 10 | UNCHANGED | Per-submission tally with Rosa's comment. |

### RV-S7 — committed decision-feedback email (6 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Open the queue item. |
| 2 | UNCHANGED | Compose feedback + record decision. |
| 3 | **CHANGED — same oracle, wider durable record.** | The feedback send (`reviews.$id.tsx:604`) routes through the port. Oracle unchanged: exactly 1 row ≥ T to sam.rivera@example.com containing the feedback verbatim. Row carries the two NULLABLE claim columns (S1); no `ics`, so no calendar-ledger write; no `onInFlight`, so duplicate semantics match `origin/main` (S2, S3). |
| 4 | UNCHANGED | Tally recorded; admin status stays Pending. |
| 5 | UNCHANGED | Deny without compose sends nothing — the port is never called. |
| 6 | UNCHANGED | Portal still shows Pending. |

### RV-S8 — withdrawal keeps the record (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Portal withdraw entry point. |
| 2 | UNCHANGED | Empty-reason validation. |
| 3 | UNCHANGED | Reason accepted. |
| 4 | UNCHANGED | Portal shows Withdrawn. |
| 5 | UNCHANGED | Withdrawn tab = 12; record intact. |
| 6 | UNCHANGED | who/when/why metadata — `withdrawSubmission` is untouched. |
| 7 | UNCHANGED | Session leaves the Unscheduled panel. Note: the submission's `calendar_invite_revisions` rows survive (they cascade only on submission *delete*), which is correct — organizer-visible invite history must stay immutable, and a withdrawn session is simply no longer schedulable. |
| 8 | UNCHANGED | DB probe: content columns populated, withdrawal queryable. |

### Re-walk verdict

**59/59 steps re-walked. 6 CHANGED (RV-S3.5, RV-S3.7, RV-S5.4, RV-S5.5, RV-S6.2, RV-S7.3), 53 UNCHANGED,
0 BLOCKER, 0 MAJOR.** Four of the six are durability-only (same observable outcome, more durable record);
two (RV-S3.7, RV-S5.5) make an existing oracle strictly stronger under concurrency; one (RV-S6.2) records a
regression found and fixed inside this gate. No `touches:` update required — `emailOutbox`, `ports: [email]`
and `domain: [app/domain/accept.ts]` already select this file.
