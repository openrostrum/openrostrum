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
  subject: "You're invited to review for AI.Engineer Sandbox Event",
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
