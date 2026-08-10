# Design walk — 08 emails (2026-08-09)

Walked against: `app/db/schema.ts` (emailTemplates / emailOutbox /
emailSuppressions / forms / submissions), `app/ports/email.ts` (EmailSender
contract + local adapter), `app/ports/clock.ts`, `app/jobs/registry.ts` +
`workers/app.ts` + `wrangler.json` (`"crons": ["0 9 * * *"]`),
`docs/ROUTE-MAP.md`, `docs/rules/tech-stack.md`, `drizzle/seed.sql`, `SCOPE.md`
P0 #8, P1 #4/#6, cross-cutting unsubscribe/suppression lines, and
`docs/flows/03-emails-communications.md`. Artifacts per step or a filed gap.

**Verdict summary: 2 BLOCKER · 5 MAJOR · 8 MINOR · no SCENARIO-ERROR.**
Ranked list at the bottom. Timezone facts used throughout: event tz
`America/Los_Angeles`; Oct 2026 is PDT (UTC-7) → 2026-10-12 10:00 local =
17:00Z (matches the seed's own `unixepoch('2026-10-12 17:00')` for
`s_accepted`); Sept 2026: 2026-09-15 23:59 PDT = 2026-09-16 06:59Z.

---

## EM-S1 — Template editor: subject/body/reply-to ride the next accept send

### EM-S1.1 — Open templates page, edit Accept
Routes ✓ assigned in ROUTE-MAP: `admin.emails.tsx` (`/admin/emails`, list) +
`admin.emails.$key.tsx` (editor). List loader:
```sql
SELECT id, key, name, subject, category, trigger, reply_to, updated_at
FROM email_templates WHERE event_id = 'e_demo' ORDER BY name;
-- email_templates_event_idx; Accept row = seeded ('et_accept', key 'accept')
```
**OK**

### EM-S1.2 — Unhappy: clear subject and save
`emailTemplates.subject` is `notNull().default("")` — drizzle-zod maps it to a
`z.string()` that ACCEPTS "" — so the editor action must refine, exactly per
the golden-path rule:
```ts
const EditTemplate = createInsertSchema(emailTemplates)
  .pick({ subject: true, bodyHtml: true, replyTo: true })
  .extend({ subject: z.string().min(1, "Subject is required"),
            replyTo: z.string().email().optional().or(z.literal("")) });
// parse fail → return { fieldErrors } BEFORE any UPDATE → stored row untouched ✓
```
Reopen shows the previous subject (no write happened). **OK** (pattern-derived;
the refine is mandatory or this step fails silently).

### EM-S1.3 — Save subject "You're in! 🎉" + body line + reply-to
```sql
UPDATE email_templates
SET subject   = 'You''re in! 🎉',
    body_html = '<p>Congratulations, you are in!</p><p>See you in October — check your portal for onboarding tasks.</p>',
    reply_to  = 'organizer@example.com',
    updated_at = unixepoch()
WHERE event_id = 'e_demo' AND key = 'accept';
```
Emoji: D1/SQLite text is UTF-8 end-to-end — survives storage ✓. Rich body
editing: the shared Tiptap `<RichText/>` is a committed cross-cutting item ✓.
No-reload save feedback: RR7 `useFetcher` ✓. **OK**

### EM-S1.4 — Send the Accept email for Priya's submission using the template
Send site: bulk-select on `/admin/submissions` → action (self-authenticating,
per tech-stack auth rule) — SCOPE P0 #4's staged accept-send model. The port
call with values:
```ts
const [tpl] = await db.select().from(emailTemplates)
  .where(and(eq(emailTemplates.eventId, "e_demo"), eq(emailTemplates.key, "accept")));
const sender = getEmailSender(env);      // no RESEND_API_KEY → local D1 sink
await sender.send({
  to: "priya.sharma@example.com",
  replyTo: tpl.replyTo ?? undefined,     // 'organizer@example.com'
  subject: renderSubject(tpl.subject, ctx),   // ← see GAP (renderer)
  html: renderBody(tpl.bodyHtml, ctx),        // ← see GAP (renderer)
  eventId: "e_demo",
  templateId: tpl.id,
  dedupeKey: `accept:s_priya:priya.sharma@example.com`,  // ← convention, see MINOR
});
```
- **GAP — merge-tag rendering is specified NOWHERE.** The scenario (and P0 #8's
  "templated speaker communications") requires "merge fields resolved to
  Priya's actual name/title, no literal tokens leaking" — but the design has
  no tag syntax, no tag vocabulary, and no renderer location: zero hits for
  "merge" in SCOPE.md / tech-stack.md / schema.ts / app/**; `EmailMessage`
  takes FINAL `subject`/`html` and the port never renders;
  `docs/flows/03` documents Sessionboard's tags (`[PORTAL_LINK]`,
  first/last/title…) as parity research only. Needed: a spec'd pure util
  (e.g. `app/lib/email-render.ts`) with a core tag set
  ({{first_name}}, {{last_name}}, {{session_title}}, {{portal_link}},
  {{event_name}}, {{form_close_date}}) + escaping rules + unresolved-tag
  policy. Every scenario in this file that reads a body hits this. **[MAJOR]**
- **GAP — dedupeKey convention for manual sends undecided.** Schema/tech-stack
  fix the SHAPE (template+recipient+occurrence) but not what "occurrence"
  means for a manual accept blast (submission id? blast id? none — allowing
  deliberate re-sends since the unique index ignores NULLs?). Record it.
  **[MINOR]**

### EM-S1.5 — Outbox row carries subject + reply-to, body resolved
Port mapping is column-for-column (app/ports/email.ts:44–60):
`msg.replyTo → email_outbox.reply_to`, `msg.subject → subject`,
`msg.html → html`, `status='sent'`, `sentAt=now`. Verification:
```sql
SELECT "to", reply_to, subject, html, status
FROM email_outbox
WHERE template_id = (SELECT id FROM email_templates WHERE event_id='e_demo' AND key='accept')
ORDER BY created_at DESC LIMIT 1;
-- → priya.sharma@example.com | organizer@example.com | You're in! 🎉 | <p>…</p> | sent
```
Subject + replyTo ✓ **OK**; "merge fields resolved / zero tokens" ✗ blocked by
the renderer gap above. **GAP [dup EM-S1.4, MAJOR]**

---

## EM-S2 — .ics on the scheduled-session accept; unscheduled behavior deliberate

### EM-S2.1 — Schedule the session
Route `admin.agenda.tsx` ✓ (ROUTE-MAP). 10:00–10:45 local (PDT) →
```sql
UPDATE submissions
SET starts_at = unixepoch('2026-10-12 17:00'),   -- 10:00 PDT
    ends_at   = unixepoch('2026-10-12 17:45'),   -- 10:45 PDT
    room_id   = 'room_a'
WHERE id = 's_priya' AND event_id = 'e_demo';
```
**OK**

### EM-S2.2–3 — Send accept; outbox row carries the .ics
Inputs join:
```sql
SELECT s.title, s.starts_at, s.ends_at, r.name AS room, e.timezone
FROM submissions s
LEFT JOIN rooms r  ON r.id = s.room_id
JOIN events e      ON e.id = s.event_id
WHERE s.id = 's_priya';
```
The util (tech-stack: `ics` npm pkg — pinned `ics@^3.12.0` in package.json —
"plain utility, not a port"):
```ts
import { createEvent } from "ics";
const { error, value } = createEvent({
  uid: "submission-s_priya@openrostrum",          // ← stable UID: convention, see MINOR
  title: "Scaling Vector Search at the Edge",
  start: [2026, 10, 12, 17, 0], startInputType: "utc",   // 10:00 PDT
  end:   [2026, 10, 12, 17, 45], endInputType: "utc",    // 10:45 PDT
  location: "Room A",
  method: "REQUEST",                              // invite semantics, see MINOR
});
await sender.send({ ...acceptMsg, ics: value });  // → email_outbox.ics_attachment
```
`emailOutbox.icsAttachment` column exists ✓; port maps `msg.ics → ics_attachment`
(email.ts:53) ✓.
- **GAP — UID convention unstated.** The `ics` lib mints a RANDOM uid when none
  is passed; the scenario demands a STABLE UID (re-sends must update, not
  duplicate, the calendar entry). `submission-<id>@<host>` must be written
  down. **[MINOR]**
- **GAP — invite-vs-attachment semantics unstated.** METHOD:REQUEST +
  ORGANIZER/ATTENDEE lines are what make Gmail/Outlook render an actual
  invite; nothing in the design chooses. **[MINOR]**

### EM-S2.4 — Parse validity
`ics` emits VERSION:2.0, PRODID, DTSTART/DTEND as UTC `20261012T170000Z` /
`20261012T174500Z` (correct UTC equivalents of 10:00/10:45 event tz ✓),
LOCATION:Room A, and performs RFC 5545 line folding — library-guaranteed, no
design artifact needed beyond passing the fields above. **OK**

### EM-S2.5–6 — Unscheduled accept (Mallory, no agenda slot)
`starts_at`/`ends_at` are NULL. `createEvent` cannot be called without dates —
so the code MUST branch. What does the design say happens? **Nothing.** SCOPE
P0 #8 says ".ics attached to acceptance/scheduling emails" with no unscheduled
case; no doc, no UI copy, no design note records a decision (grep: no hit for
"unscheduled" in SCOPE/tech-stack/ROUTE-MAP).
- **GAP — decision-needed, must be recorded per the scenario's own bar.**
  Cheapest compliant decision: "no .ics when `startsAt IS NULL`; a follow-up
  scheduling email (or re-send) carries it once scheduled" — one sentence in
  SCOPE/flows + a guard `if (s.startsAt && s.endsAt)` at the send site. The
  failure mode the scenario forbids (epoch/placeholder dates) is otherwise the
  natural bug. **[MAJOR]**

---

## EM-S3 — Submission confirmation: immediate, working portal link, admin-notify

### EM-S3.1 — Configure admin-notify on the form
Committed P1 #6 ("admin-notify pickers on forms"). Storage: `forms.config`
JSON overflow (schema.ts:257 — "Overflow for validation rules, admin-notify
pickers, etc."). Artifact:
```sql
UPDATE forms
SET config = json_set(coalesce(config,'{}'),
      '$.adminNotify.newSubmission', json_array('admin@example.com'))
WHERE id = 'form_sessions';
```
- **GAP — `forms.config` shape unspecified.** The column is
  `Record<string, unknown>`; no doc fixes the `adminNotify` key shape, so the
  form-builder step-7 UI and the CFP action would each invent one. Needs one
  line of contract (zod schema for `config`). **[MINOR]**

### EM-S3.2 — Cold incognito submit as dana.wu@example.com
Route `submit.$eventSlug.$formId.tsx` ✓ (ROUTE-MAP), Turnstile port ✓
(`app/ports/turnstile.ts`, local no-op). Writes: `users(u_dana)` +
`contacts(c_dana)` + `submissions(s_dana, status='pending', title='Evals for
Agentic Pipelines', form_id='form_sessions')` + `participants`. **OK**

### EM-S3.3 — Confirmation outbox row, immediate
Send inline in the submit action (the local adapter is a synchronous D1
INSERT that stamps `status='sent', sent_at=now` — email.ts:56–57 — so
"within seconds" holds by construction):
```ts
await sender.send({
  to: "dana.wu@example.com",
  subject: renderSubject(tplConfirm.subject, ctx),  // seeded et_confirm, trigger 'auto'
  html: renderBody(tplConfirm.bodyHtml, ctx),       // ← renderer gap (EM-S1.4)
  dedupeKey: `submission_confirmation:s_dana:dana.wu@example.com`, // occurrence = submission id
  eventId: "e_demo", templateId: "et_confirm",
});
```
Verification:
```sql
SELECT "to", status, sent_at, created_at FROM email_outbox
WHERE dedupe_key = 'submission_confirmation:s_dana:dana.wu@example.com';
```
Gate: `forms.sendConfirmationEmail` (default true ✓). Transactional → must
BYPASS suppression — blocked on the missing bulk/transactional discriminator
(see EM-S5.4 BLOCKER). **OK mechanically; renderer + suppression-exemption
gaps cross-ref.**

### EM-S3.4 — Portal link in the body works from cold incognito
Two dependencies, both already-filed gaps:
(1) the link is produced by a merge tag ({{portal_link}}) → renderer gap
(EM-S1.4, MAJOR); (2) the portal URL itself is
`/portals/:eventSlug/:portalId/*` and **`:portalId` references no schema
entity** (no portals table — filed as MAJOR in walk 07, TK-S1.4; the email
cannot mint a URL nobody can resolve). The auth mechanics that ARE walkable:
cold GET → `requireUser` throws `redirect("/login?redirectTo=/portals/…")`
(auth.ts:193–195) → login → lands back on the deep link ✓ (`redirectTo` is
preserved by the login route contract). Dana's portal then lists
"Evals for Agentic Pipelines" + Pending pill via
`submissions WHERE submitter_id = :dana` ✓.
**GAP [dup: renderer MAJOR (EM-S1.4) + :portalId MAJOR (walk 07 #7)]**

### EM-S3.5 — Admin-notify outbox row
```ts
if (form.config?.adminNotify?.newSubmission?.length) {
  for (const addr of form.config.adminNotify.newSubmission) {
    await sender.send({
      to: addr, // 'admin@example.com'
      subject: `New submission: Evals for Agentic Pipelines`,
      html: …,
      dedupeKey: `admin_notify_new:s_dana:${addr}`,
      eventId: "e_demo",
    });
  }
}
```
- **GAP — no admin-notify template exists.** Seed has 5 templates
  (confirmation/accept/decline/reminders); no `admin_notify_new` /
  `admin_notify_updated` key, and SCOPE Appendix B's template table doesn't
  carry them either. Either seed the two templates (Sessionboard has "New
  Submission Alert"/"Submission Revision Alert", flows/03 §2a #10–11) or
  record that admin-notify uses hardcoded copy. **[MINOR]**
When not configured: the `config` guard above produces zero rows ✓. **OK with
MINOR gap.**

### EM-S3.6 — Double-submit probe
Design mechanism for "exactly one submission record per actual submission":
**unspecified** — the CFP action has no idempotency token; PRG + disabled
button is UX-only; a re-POST inserts a second `submissions` row.
(`clientSessionId` on submissions is a Sessionboard data column, not a dedupe
key.) The CONFIRMATION count, however, is protected once the dedupeKey
convention above is adopted: a re-send for the same submission id dedupes to
one row (port `onConflictDoNothing`, email.ts:59). So: email-per-submission
invariant ✓ walkable; submission-uniqueness itself belongs to scenario 03 but
this step re-exposes it. **GAP — public-CFP double-submit guard unspecified
(idempotency token or draft-promotion pattern). [MINOR here; primary owner:
03-public-cfp walk]**

---

## EM-S4 — Draft reminders at 5-day/1-day with hard dedupe

### EM-S4.1 — Close date + reminders ON
Editor route `admin.forms.$formId.tsx` ✓:
```sql
UPDATE forms
SET close_at = unixepoch('2026-09-16 06:59'),   -- 2026-09-15 23:59 America/Los_Angeles (PDT)
    send_reminders = 1
WHERE id = 'form_sessions' AND event_id = 'e_demo';
```
**OK**

### EM-S4.2 — Audience: Dana holds a draft, Priya doesn't
Draft save is committed P1 #4:
```sql
INSERT INTO submissions (id, event_id, form_id, type, title, status, submitter_id, created_at, updated_at)
VALUES ('s_dana_draft', 'e_demo', 'form_sessions', 'session',
        'Latency Budgets in RAG', 'draft', 'u_dana', unixepoch(), unixepoch());
```
**OK**

### EM-S4.3 — The 5-day occurrence (2026-09-10)
Mechanism per design: cron `0 9 * * *` (wrangler.json) → `workers/app.ts
scheduled()` → `runScheduledJobs` → `app/jobs/reminders.scheduled.ts` (file
does not exist yet — the registry pattern explicitly expects features to add
it; the job body is a build artifact, its QUERY is the design artifact). Time
is injected via the Clock port (`app/ports/clock.ts`) so the scenario's
"time-travel" trigger is `fixedClock(new Date("2026-09-10T09:00:00Z"))`.
The due query:
```sql
SELECT f.id AS form_id, f.internal_name, f.close_at,
       u.id AS user_id, u.email
FROM forms f
JOIN submissions s ON s.form_id = f.id AND s.status = 'draft'
JOIN users u       ON u.id = s.submitter_id
WHERE f.send_reminders = 1
  AND f.status = 'open'
  AND f.close_at IS NOT NULL
  AND :daysUntilClose(f.close_at) = 5      -- ← computed app-side, see GAP
GROUP BY f.id, u.id;                        -- one email per (form,user) even with 2 drafts
```
- **GAP — occurrence arithmetic is timezone-load-bearing and unspecified.**
  Concrete failure: close = 2026-09-16 06:59Z (= 09-15 23:59 PDT). At the
  09-10 09:00Z tick, calendar-day difference **in event tz** (09-15 minus
  09-10) = 5 → fires correctly; naive UTC date difference (09-16 minus 09-10)
  = 6 → the 5-day reminder fires a day early (on 09-11 UTC it'd be "5") and
  the 1-day fires on the wrong day. The design nowhere states "compute
  occurrence dates in `events.timezone`", nor the window rule (`== 5` exact
  match silently skips when the close date is set after the tick, or when a
  cron tick is missed; a `<= 5 AND > 1` window + per-occurrence dedupeKey is
  the safe shape). Needs 2 sentences in the job spec. **[MAJOR]**
- Suppression: SCOPE classes reminders as bulk → suppression check applies →
  blocked by the EM-S5.4 BLOCKER (cross-ref).

### EM-S4.4 — Exactly one row for Dana, zero for Priya
Send per row:
```ts
await sender.send({
  to: "dana.wu@example.com",
  subject: renderSubject(tplRem5.subject, ctx),    // seeded et_rem5
  html: renderBody(tplRem5.bodyHtml, ctx),
  dedupeKey: `reminder_5day:form_sessions:dana.wu@example.com`,  // template+recipient+occurrence ✓
  eventId: "e_demo", templateId: "et_rem5",
});
```
Priya: no draft → not in the result set → zero rows ✓.
```sql
SELECT COUNT(*) FROM email_outbox
WHERE dedupe_key = 'reminder_5day:form_sessions:dana.wu@example.com';  -- = 1
SELECT COUNT(*) FROM email_outbox
WHERE "to" = 'priya.sharma@example.com' AND dedupe_key LIKE 'reminder_%'; -- = 0
```
**OK**

### EM-S4.5 — Idempotency replay proof
The invariant is structural, two artifacts deep:
1. `email_outbox.dedupe_key` is UNIQUE (schema.ts:786).
2. The local adapter inserts with
   `.onConflictDoNothing({ target: emailOutbox.dedupeKey })` and on conflict
   returns the ORIGINAL row's id with `deduped: true` (email.ts:59–72).
Replaying the whole occurrence re-runs the same send → same dedupeKey → 0 new
rows; count stays 1. Not a race-prone check-then-insert: the uniqueness is
enforced by the index inside the single INSERT (and D1 is single-writer).
**OK — proven by schema + port code.**

### EM-S4.6 — 1-day occurrence + replay
`dedupeKey = 'reminder_1day:form_sessions:dana.wu@example.com'` → distinct key
→ second row; replay → still 2. Same proof. **OK**

### EM-S4.7 — Reminder body names the form, links to resume the draft
Seeded `et_rem5.body_html` is static `<p>The form closes in five days.</p>` —
no form name, no close date, no link. Producing the required body needs:
(a) the merge renderer (EM-S1.4 MAJOR — tags like {{form_title}},
{{form_close_date}}, {{resume_draft_link}}); (b) a defined resume-draft URL —
P1 #4 commits "save as draft + resume … portal shows 'resume draft'" but no
route/param shape exists for deep-linking a draft
(`/submit/ai-engineer-sandbox/form-sessions-uuid?draft=s_dana_draft`? via the
portal drafts hub?). **GAP — resume-draft deep-link shape unspecified
[MINOR]; body content blocked by renderer gap [dup MAJOR].**

---

## EM-S5 — Unsubscribe suppresses bulk, never transactional

### EM-S5.1 — Leo with a prior bulk email
Fixture expressible: a bulk send inserts an outbox row for
`leo@example.com`. **OK**

### EM-S5.2 — Cold unsubscribe click → confirm
What the design provides: the `emailSuppressions` table + the SCOPE
cross-cutting sentence ("bulk sends carry an unsubscribe footer"). What is
missing — everything executable:
- **No unsubscribe ROUTE exists in ROUTE-MAP** (needs a public row, e.g.
  `unsubscribe.tsx` → `/unsubscribe`) and none of the built routes serve it.
- **No token design.** The footer link must work logged-out but must not let
  anyone unsubscribe an arbitrary address → link needs a signed payload, e.g.
  `/unsubscribe?email=leo@example.com&sig=HMAC-SHA256(email, env.UNSUBSCRIBE_SECRET)`
  (WebCrypto, no new deps). Nothing specifies it — and no secret is declared
  in `.dev.vars.example`/wrangler vars.
- **No footer-injection point.** Who appends the footer to bulk html —
  the renderer? the port? Unspecified (couples to the renderer gap and to the
  bulk/transactional flag below).
The write itself, once reached, is clean and idempotent (second click no-ops,
no error):
```sql
INSERT INTO email_suppressions (id, email, reason, created_at)
VALUES (<uuid>, 'leo@example.com', 'unsubscribe_link', unixepoch())
ON CONFLICT (email) DO NOTHING;   -- emailSuppressions.email is UNIQUE ✓
```
**GAP — unsubscribe surface (route + signed link + footer injection)
unspecified end-to-end. [BLOCKER]** — a committed cross-cutting behavior with
no walkable path from footer click to suppression row.

### EM-S5.3 — Suppression record exists
```sql
SELECT email, reason, created_at FROM email_suppressions WHERE email = 'leo@example.com';
```
**OK** (table + unique constraint exist)

### EM-S5.4–5 — Next bulk send skips Leo BEFORE enqueue
Schema.ts:758–761 promises: "the EmailSender port checks this before any bulk
send … transactional confirmations are exempt". Walked against the actual
port:
- `EmailMessage` (email.ts:10–22) has **no field that says bulk vs
  transactional** — the contract cannot even express which sends to check.
- `createLocalEmailSender` **performs no suppression query** (verified: its
  `send()` is a bare insert-with-dedupe, email.ts:44–73).
- `createResendEmailSender` is a stub that throws (email.ts:77–86).
- `EmailResult` has no way to report "skipped/suppressed" (only
  `{id, deduped}`), so even a caller-side check can't be reported truthfully
  to the outbox-verifying oracle.
**GAP — the committed suppression check exists NOWHERE and the port contract
can't carry it. [BLOCKER]** Required design artifact (contract-level, one
file):
```ts
export interface EmailMessage {
  …
  kind: "bulk" | "transactional";   // NEW — required, no default: misclassification is the failure mode
}
export interface EmailResult { id: string; deduped: boolean; suppressed?: boolean; }
// in every adapter's send():
if (msg.kind === "bulk") {
  const hit = await db.select({id: emailSuppressions.id}).from(emailSuppressions)
    .where(eq(emailSuppressions.email, msg.to)).limit(1);
  if (hit.length) return { id: "", deduped: false, suppressed: true }; // NO outbox row
}
```
Then this step's oracle passes:
```sql
SELECT "to" FROM email_outbox WHERE created_at > :blastStart ORDER BY created_at;
-- → priya…, mallory… ; NO leo row (skipped-before-enqueue, not failed)
```

### EM-S5.6 — Leo's transactional confirmation still delivers
With `kind: "transactional"` on the confirmation send (EM-S3.3 artifact), the
check is bypassed → outbox row for Leo exists ✓. Blocked on the same BLOCKER
(classification field). **GAP [dup EM-S5.4]**

### EM-S5.7 — Bulk rows carry the unsubscribe footer
Inspect `html` of a step-5 row for the footer + signed link — blocked on
footer-injection point (EM-S5.2) + renderer (EM-S1.4). **GAP [dup]**

---

## EM-S6 — History log complete + frozen; zero-recipient send fails clean

### EM-S6.1–2 — History log lists every send with to/subject/status/sent-at
The data is committed and already exists (`email_outbox` IS the log — SCOPE
P1 #6: "email history log (admin list of email_outbox sends: to/subject/
status/sent-at — the data already exists)"). The query:
```sql
SELECT id, "to", subject, status, sent_at, created_at
FROM email_outbox
WHERE event_id = 'e_demo'
ORDER BY created_at DESC
LIMIT 25 OFFSET 0;
```
Row-for-row equality with the suite's sends holds by construction — the local
adapter's outbox row IS the send.
- **GAP — no ROUTE-MAP assignment for the history log.** `admin.emails.tsx` is
  claimed as "Email templates"; no file/URL owns the committed P1 #6 history
  list (e.g. `admin.emails.history.tsx` → `/admin/emails/history`). Per the
  map's own rule the row must be added on the integration branch. **[MAJOR]**
- **GAP — rows are only in the event-scoped log if every call site passes
  `eventId`.** `EmailMessage.eventId` is OPTIONAL and the port defaults it to
  NULL (email.ts:54) — a caller that forgets it produces a send that exists
  but never appears under `WHERE event_id='e_demo'`. Convention ("eventId is
  required on every app send") is unstated. **[MINOR]**

### EM-S6.3 — Retroactivity probe
Verified by columns: `email_outbox.subject` and `.html` are `notNull` snapshots
copied from the message at send time (email.ts:51–52); the template edit
```sql
UPDATE email_templates SET subject='Updated for next wave', updated_at=unixepoch()
WHERE event_id='e_demo' AND key='accept';
```
touches `email_templates` only. The outbox row's link to the template is a
nullable FK (`templateId`, `onDelete: set null`) used for grouping, never for
display. Re-query of EM-S1's row still returns `You're in! 🎉`. **OK — the
non-retroactivity invariant is structural.** ✓

### EM-S6.4–5 — Zero-recipient bulk send blocked server-side
Where: in the bulk-send `action` (admin.submissions.tsx bulk path), before any
template load or port call — golden-path typed-error shape:
```ts
await requireAdmin(env, request);                    // actions self-authenticate
const ids = form.getAll("submissionId").map(String).filter(Boolean);
if (ids.length === 0) {
  return { formError: "Select at least one submission to email." };  // ← no send, no insert
}
```
Count-unchanged proof: the early return precedes every `sender.send` →
```sql
SELECT COUNT(*) FROM email_outbox;   -- identical before/after the failed attempt
```
**OK** (no spec sentence names this guard, but it is a direct instance of the
committed validation pattern — filed as a note, not a gap; the walk artifact
above is the guard).

### EM-S6.6 — Search/filter at ~300 rows
```sql
SELECT id, "to", subject, status, sent_at
FROM email_outbox
WHERE event_id = 'e_demo'
  AND ("to" LIKE '%dana.wu%' OR subject LIKE '%You''re in%')
ORDER BY created_at DESC
LIMIT 25 OFFSET 0;
```
At ~300 rows a LIKE scan under `email_outbox_event_idx` is instant.
- **GAP — no `(event_id, created_at)` composite index** for the ORDER BY at
  real scale (thousands of sends across events); `email_outbox_event_idx` is
  eventId-only, `email_outbox_status_idx` doesn't help ordering. Fine for the
  scenario, worth one index line for the NORTH STAR bar. **[MINOR]**

---

## Ranked gaps (this file)

| # | Where | Gap | Severity |
|---|---|---|---|
| 1 | EM-S5.4–6 (+EM-S3.3, EM-S4.3) | Suppression enforcement exists nowhere: `EmailMessage` has no bulk/transactional `kind`, no adapter queries `emailSuppressions` (local adapter verified check-free; prod adapter is a throwing stub), `EmailResult` can't report a skip — the committed cross-cutting behavior is unexpressible in the current port contract | BLOCKER |
| 2 | EM-S5.2/5.7 | Unsubscribe surface unspecified end-to-end: no route in ROUTE-MAP, no signed-link/token design (+ no secret declared), no footer-injection point for bulk html | BLOCKER |
| 3 | EM-S1.4/1.5, EM-S3.4, EM-S4.7, EM-S5.7 | Merge-tag rendering specified nowhere: no syntax, no tag vocabulary, no renderer location; `EmailMessage` takes final html and the port never renders — every "resolved body" assertion in this suite is unwalkable | MAJOR |
| 4 | EM-S2.5–6 | Unscheduled-session accept: no recorded decision on .ics presence/absence (nothing in SCOPE/docs/UI copy); `createEvent` needs dates so the branch WILL be improvised without it | MAJOR |
| 5 | EM-S4.3 | Reminder occurrence arithmetic unspecified: event-tz vs UTC day math (concrete off-by-one shown for close 2026-09-15 23:59 PDT vs the 09:00Z cron) + exact-match vs window semantics on the single daily tick; `app/jobs/reminders.scheduled.ts` yet to be added per registry pattern | MAJOR |
| 6 | EM-S6.1 | Committed email history log (P1 #6) has no route assignment in docs/ROUTE-MAP.md | MAJOR |
| 7 | EM-S3.4 | Portal link target `/portals/:eventSlug/:portalId` — `:portalId` has no backing entity (filed in walk 07 as gap #7; re-exposed here because the confirmation email must mint that URL) | MAJOR (dup of 07#7) |
| 8 | EM-S1.4 | dedupeKey convention for manual sends (what is "occurrence" for an accept blast; when to omit for deliberate re-sends) undecided | MINOR |
| 9 | EM-S3.1 | `forms.config` adminNotify shape uncontracted (each consumer will invent one) | MINOR |
| 10 | EM-S3.5 | No admin-notify email template exists (seed/SCOPE carry no `admin_notify_*` keys); hardcoded copy vs template undecided | MINOR |
| 11 | EM-S3.6 | Public-CFP double-submit guard unspecified (idempotency token / draft promotion) — submission-count invariant; confirmation-count is safe via dedupeKey | MINOR (primary owner: 03 walk) |
| 12 | EM-S4.7 | Resume-draft deep-link shape unspecified (P1 #4 commits resume; no URL/param defined) | MINOR |
| 13 | EM-S2.2 | .ics stable-UID convention + METHOD/ORGANIZER invite semantics unstated | MINOR |
| 14 | EM-S6.2 | `EmailMessage.eventId` optional + port defaults NULL → forgotten eventId silently drops sends from the event-scoped history log; "always pass eventId" convention unstated | MINOR |
| 15 | EM-S6.6 | No `(event_id, created_at)` index on email_outbox for log ordering at real scale | MINOR |

**SCENARIO-ERRORS: none.** Every scenario maps to committed tier items:
EM-S1/EM-S2 → P0 #8 (+P1 #6 reply-to), EM-S3 → P0 #2/#8 + P1 #6 admin-notify,
EM-S4 → P0 #8 reminders + P1 #4 drafts, EM-S5 → cross-cutting
unsubscribe/suppression (SCOPE.md:176), EM-S6 → P1 #6 history log.
