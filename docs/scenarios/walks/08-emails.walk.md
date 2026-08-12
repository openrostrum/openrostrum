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

---

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Walked against: `docs/multi-tenancy-design.md`, the migrated `app/db/schema.ts`
(`organizations` :95–99 · `organization_members` :101–117 ·
`events.organizationId` NOT NULL :123–125 · `fields` XOR :390–411 ·
`api_tokens.organizationId` NOT NULL + nullable `eventId` :1185–1202 ·
`emailTemplates` :1234–1261 · `emailSuppressions` :1268–1273 ·
`emailOutbox` :1281–1307), `app/lib/auth.ts` (`getActiveEvent` :236–251),
`app/ports/email.ts`, `drizzle/seed.sql` (org_demo :61–65, e_demo→org_demo :68,
templates :226–231, apitok_demo→org_demo :223–224), `app/routes/admin.submissions.tsx`,
`docs/ROUTE-MAP.md`, SCOPE.md.

**State drift since the 2026-08-09 walk, verified in code (affects gap
citations below):** original **BLOCKER #1 is CLOSED** — `EmailMessage.kind`
(email.ts:27), `EmailResult.suppressed` (:36), and the `withSuppression`
wrapper both adapters inherit via `getEmailSender` (:95–111, :185–190) now
exist; SCOPE K13 (SCOPE.md:190) records reminders/decisions as transactional.
**BLOCKER #2 is PARTIALLY closed** — ROUTE-MAP:36 now assigns
`unsubscribe.$token.tsx` → `/unsubscribe/:token` (signed token); token
signing/secret + footer-injection point remain unspecified. **MAJOR #6 closed
at the map level** (ROUTE-MAP:37 `admin.emails.history.tsx`). **Walk-07 #7
(:portalId) is stale** — a `portals` table now exists (schema.ts:~275,
seeded `portal_demo`). None of that is tenancy; recorded so the dup-citations
below read correctly.

Tenancy facts used throughout: `email_templates`, `email_outbox`, `forms`,
`submissions` gained **no** org column — their tenant link is
`eventId → events.organizationId`; `email_suppressions` has **no tenant column
at all** (global `unique(email)`); `u_admin` is a member of `org_demo`
(om_admin) with `active_event_id='e_demo'` (seed:98), so every demo-event
artifact below resolves identically. Cross-tenant admin enforcement
(membership in `getActiveEvent` + admin guard, any-event-fallback fix) is
**covered: Wave B** — design doc §Authorization ("The any-event fallback is
the hole Wave B exists to close", multi-tenancy-design.md:92–96; Wave B row
:132) — cited per step below, not re-filed.

### EM-S1 step 1 — GAP

Demo-event artifact is byte-identical (loader SQL `WHERE event_id='e_demo'`
unchanged — `email_templates` has no org column, event-scoped via
`email_templates_event_idx`; event resolution via `getActiveEvent` → covered:
Wave B membership check, design doc :92–96). But the migration's committed
product model creates a tenant for whom this step has NO artifact:

```sql
-- Wave C tenant (design doc :56–58 — onboarding = org + first event, then
-- "Land in /admin on their own empty event"):
--   organizations('org_acme') · organization_members(org_acme, u_acme) ·
--   events('e_acme', 'org_acme', …)
SELECT * FROM email_templates WHERE event_id = 'e_acme';   -- 0 rows
```

The ONLY thing that mints per-event template rows is `drizzle/seed.sql:226–231`
(grep: no `INSERT` into / drizzle insert of `emailTemplates` anywhere in
`app/**`). For any non-seeded event there is no Accept template to edit here,
and EM-S3's `key='submission_confirmation'` auto-send finds no row (its
`trigger='auto'` sends silently never happen — the swyx "must have"). The
design doc covers empty LIST states (:58) but never template provisioning; no
wave (B/C/D, :129–134) mentions it; SCOPE P1 #5's create-event flow
(SCOPE.md:129) doesn't either. Not BLOCKER only because the seeded event still
walks; judge-visible the moment P1 #5's create-event (already committed,
pre-tenancy) or Wave C onboarding produces a second event. Fix shape: mint the
5 lifecycle templates (the seed's own rows) inside the create-event
transaction — one decision line in P1 #5 / Wave C scope.
**GAP — default email-template provisioning for new events/orgs specified
nowhere; lifecycle emails silently vanish for every non-seeded event.
[MAJOR — not covered by any committed wave]**

### EM-S1 step 2 — UNCHANGED
Pure zod refine + event-scoped UPDATE-guard; no tenant column in play, no org
in the validation path.

### EM-S1 step 3 — UNCHANGED
Same `UPDATE email_templates … WHERE event_id='e_demo' AND key='accept'` —
the table gained no org column; UTF-8/Tiptap/useFetcher facts are
schema-independent.

### EM-S1 step 4 — UNCHANGED
Send-site artifact identical; `admin.submissions.tsx` already scopes via
`requireAdmin` + `getActiveEvent` (verified :50–51, :57) → cross-tenant
enforcement covered: Wave B (design doc :92–97). Status note: the send now
also carries `kind: "transactional"` (accept decisions per SCOPE K13,
SCOPE.md:190) — that field exists (email.ts:27) but came from the
prod-adapters-safety merge, not this migration. Renderer MAJOR #3 persists,
untouched by tenancy.

### EM-S1 step 5 — UNCHANGED
Verification SQL identical — `email_outbox` gained no org column; the row's
tenant link stays `event_id='e_demo'`. Renderer gap persists [dup MAJOR #3].

### EM-S2 step 1 — UNCHANGED
`submissions`/`rooms` are event-scoped exactly as before (no org columns);
the UPDATE is byte-identical.

### EM-S2 step 2 — UNCHANGED
The inputs join touches `events` — which gained `organization_id` — but the
select list (`title, starts_at, ends_at, room, timezone`) doesn't read it;
same rows return.

### EM-S2 step 3 — UNCHANGED
`emailOutbox.icsAttachment` untouched by the migration; port mapping
unchanged (email.ts:61).

### EM-S2 step 4 — UNCHANGED
Library-guaranteed `ics` output; no schema surface at all.

### EM-S2 step 5 — UNCHANGED
NULL `starts_at`/`ends_at` branch is org-free; pre-existing MAJOR #4
(unscheduled-accept decision unrecorded) persists, unaffected by tenancy.

### EM-S2 step 6 — UNCHANGED
Same as step 5 — the missing recorded decision is still missing; nothing in
the tenancy design speaks to it.

### EM-S3 step 1 — UNCHANGED
`forms.config` JSON overflow untouched (forms carry `eventId` NOT NULL as
before, no org column); MINOR #9 (config shape) persists.

### EM-S3 step 2 — UNCHANGED
Public CFP resolves the event by globally-unique slug — the design doc
KEEPS one global slug namespace as a recorded trade-off (:66–68), so
`/submit/ai-engineer-sandbox/…` resolution is identical. Determination made
explicit: Dana's new `users` row gets NO `organization_members` row —
membership is an organizer concept; speaker access continues via
`submitter_id`/`contacts`, which the design leaves untouched (§Authorization,
:100–104 row-level rules). Write set unchanged.

### EM-S3 step 3 — GAP
Demo-event artifact unchanged (seeded `et_confirm` on `e_demo`; dedupeKey +
local-adapter mechanics org-free). But the auto confirmation send loads
`WHERE event_id = :eventId AND key='submission_confirmation'` — for any
Wave-C org's event that row does not exist, so the "must have" confirmation
silently never sends. **GAP [dup EM-S1 step 1 — MAJOR: template provisioning
for non-seeded events].** Suppression-exemption cross-ref from the 08-09 walk
is RESOLVED (kind defaults transactional, email.ts:18–27, :99–108).

### EM-S3 step 4 — UNCHANGED
Tenancy leaves speaker auth alone: `requireUser` redirect + `redirectTo`
deep-link (auth.ts:202–214) have no membership dimension, and Dana's portal
query keys on `submitter_id`, not org. Renderer MAJOR #3 persists. Stale-dup
note: the `:portalId` half of the 08-09 citation is fixed — `portals` exists
(schema.ts:~275–289, seeded `portal-demo-uuid`), so the email CAN mint
`/portals/ai-engineer-sandbox/portal-demo-uuid`.

### EM-S3 step 5 — UNCHANGED
Admin-notify recipients are plain addresses in `forms.config` — no tenant
surface; zero-rows-when-unconfigured guard unchanged. MINOR #10 (no
admin-notify template) persists.

### EM-S3 step 6 — UNCHANGED
Double-submit surfaces carry no org columns; the confirmation dedupeKey
embeds the submission id (globally-unique uuid) so keys cannot collide
across tenants. MINOR #11 persists (primary owner: 03 walk).

### EM-S4 step 1 — UNCHANGED
Same event-scoped `UPDATE forms … WHERE id='form_sessions' AND
event_id='e_demo'`; timezone facts identical (close 2026-09-15 23:59 PDT =
09-16 06:59Z).

### EM-S4 step 2 — UNCHANGED
Draft INSERT is event/form-scoped; no org column on `submissions`.

### EM-S4 step 3 — CHANGED
The cron job is the one emails artifact that is inherently CROSS-TENANT: it
runs with no user context and must now serve every organization's forms. The
due query gains a mandatory `events` join — the event timezone (and the
outbox `eventId`) can no longer be treated as "the" event's:

```sql
SELECT f.id AS form_id, f.internal_name, f.close_at,
       e.id AS event_id, e.timezone,            -- NEW: per-event tz + outbox eventId
       u.id AS user_id, u.email
FROM forms f
JOIN events e      ON e.id = f.event_id          -- NEW: one tz per row, not global
JOIN submissions s ON s.form_id = f.id AND s.status = 'draft'
JOIN users u       ON u.id = s.submitter_id
WHERE f.send_reminders = 1
  AND f.status = 'open'
  AND f.close_at IS NOT NULL
  AND :daysUntilClose(f.close_at, e.timezone) = 5   -- computed app-side PER EVENT TZ
GROUP BY f.id, u.id;
-- Deliberately NO organizationId filter: every tenant's reminders fire. The
-- Demo-org guard in the design doc is scoped to the AIRTABLE SYNC job's row
-- selection only ("WHERE event.organizationId = demoOrg in the sync job",
-- multi-tenancy-design.md:115–118) — it does NOT apply to reminders.
```

Pre-existing MAJOR #5 (occurrence arithmetic) persists and is now structural:
day-difference math MUST be computed in each row's `e.timezone` — a single
global-tz shortcut that happened to work with one seeded event is no longer
even expressible. Suppression cross-ref from 08-09 is resolved the other way:
SCOPE K13 (SCOPE.md:190) classes draft-close reminders as TRANSACTIONAL —
no suppression check applies (port default, email.ts:18–27).

### EM-S4 step 4 — UNCHANGED
`dedupeKey = 'reminder_5day:form_sessions:dana.wu@example.com'` embeds the
form id, which is globally unique — two orgs' forms can never mint the same
key, so the dedupe invariant holds tenant-free. Count SQL identical.

### EM-S4 step 5 — UNCHANGED
Structural proof intact: `email_outbox.dedupe_key` UNIQUE + adapter
`onConflictDoNothing` (email.ts:67) — neither touched by the migration.

### EM-S4 step 6 — UNCHANGED
Distinct occurrence key → second row; same org-free proof.

### EM-S4 step 7 — UNCHANGED
Body content still blocked by renderer MAJOR #3; resume-draft deep-link MINOR
#12 persists — neither has a tenancy dimension (the draft link is
slug+publicId based, both globally unique).

### EM-S5 step 1 — UNCHANGED
Fixture is an outbox INSERT; org-free.

### EM-S5 step 2 — GAP
The click→suppression write is mechanically unchanged (same idempotent
INSERT … ON CONFLICT(email) DO NOTHING; remaining unspecified pieces —
token signing/secret, footer injection — are the pre-existing BLOCKER #2
residue, not tenancy). What the migration ADDS is an unrecorded scope
decision:

```sql
-- schema.ts:1268–1273 — the suppression key is the ADDRESS, tenant-free:
--   email: text('email').notNull().unique()     (no organizationId, no eventId)
INSERT INTO email_suppressions (id, email, reason, created_at)
VALUES ('sup_leo', 'leo@example.com', 'unsubscribe_link', unixepoch())
ON CONFLICT (email) DO NOTHING;
-- withSuppression (email.ts:99–108) matches on address alone, so org A's
-- footer click silences EVERY organization's kind:'bulk' sends to Leo —
-- org B's announcements are suppressed by a click it never sent.
```

Global-by-address is a defensible (conservative, over-suppress) reading and
CAN-SPAM-safe, but it is a product decision the design doc never makes —
§Airtable is its only per-org-boundary discussion; `email_suppressions`
appears nowhere in it. If the decision flips to per-org, the schema needs an
`organizationId` column + `unique(organizationId, email)` AND the signed
`/unsubscribe/:token` payload must carry the org. One recorded sentence
either way. Judges operate a single org → interim-invisible.
**GAP — suppression scope under multi-tenancy (global-per-address vs per-org)
undecided and unrecorded; current schema silently commits to global. [MINOR]**

### EM-S5 step 3 — UNCHANGED
Same SELECT; the row is global by design of the current schema (see step 2's
filed decision gap).

### EM-S5 step 4 — UNCHANGED
By tenancy. Status note (verified, closes 08-09 BLOCKER #1): the suppression
gate now EXISTS — `withSuppression` wraps both adapters via `getEmailSender`
(email.ts:95–111, :185–190), returns `{id:"", suppressed:true}` with NO
outbox row, and queries `email_suppressions` by normalized address only —
consistent with the (unrecorded) global scope, cross-ref step 2.

### EM-S5 step 5 — UNCHANGED
Oracle SQL identical: rows for Priya/Mallory, none for Leo — skip happens
before the adapter INSERT, org-free.

### EM-S5 step 6 — UNCHANGED
`kind` defaults to transactional (email.ts:18–27) and the gate only checks
`kind === "bulk"` (:99) → Leo's confirmation delivers. The 08-09 dup-BLOCKER
here is resolved; no tenancy surface.

### EM-S5 step 7 — UNCHANGED
Footer-injection point still unspecified (BLOCKER #2 residue + renderer #3 —
both pre-existing). Tenancy cross-ref only: if step 2's scope decision goes
per-org, the footer token must embed the sending org.

### EM-S6 step 1 — UNCHANGED
History-log loader stays `WHERE event_id = :activeEventId` — outbox is
event-scoped, org derived via the event. Event resolution covered: Wave B
(design doc :92–97). Status note: ROUTE-MAP:37 now assigns
`admin.emails.history.tsx` → `/admin/emails/history` (08-09 MAJOR #6 closed
at the map level).

### EM-S6 step 2 — GAP
Row-for-row equality on `e_demo` holds unchanged. But the migration makes
`email_outbox`'s tenant boundary load-bearing, and it is only the NULLABLE
`eventId` (set-null FK, schema.ts:1285–1287 — no `organizationId` column):

```sql
SELECT COUNT(*) FROM email_outbox WHERE event_id IS NULL;
-- Every such row is tenant-ORPHANED: it appears in no org's history log
-- (invisible to its own organizer), and any future admin/global listing that
-- doesn't filter by the caller's orgs' events would leak it cross-tenant.
-- ON DELETE SET NULL means deleting an event converts its entire send
-- history into orphans instead of keeping them attributable.
```

This aggravates 08-09 MINOR #14 ("always pass eventId" convention unstated):
pre-tenancy a NULL-eventId row was merely mis-filed; post-migration it has no
tenant. Cheapest fix stays one sentence — make `EmailMessage.eventId`
required in the port contract — plus a decision on whether outbox rows should
survive event deletion (cascade vs an org column).
**GAP — outbox tenant boundary is the nullable `eventId` only; orphaned rows
are unattributable to any org [MINOR — aggravates 08-09 #14]**

### EM-S6 step 3 — UNCHANGED
Snapshot columns (`subject`/`html` copied at send) and the nullable
`templateId` grouping FK are untouched; the non-retroactivity invariant is
structural and org-free.

### EM-S6 step 4 — UNCHANGED
Zero-recipient guard precedes any template load or send; auth prelude
(`requireAdmin` + `getActiveEvent`) covered: Wave B (design doc :92–97).

### EM-S6 step 5 — UNCHANGED
Count-unchanged proof is positional (early return before every
`sender.send`); no schema surface.

### EM-S6 step 6 — UNCHANGED
Search SQL identical. MINOR #15 (`(event_id, created_at)` composite index)
persists and gains weight: post-migration ONE outbox table carries every
tenant's sends, so the per-event ordered scan is the norm, not the edge —
still MINOR for the scenario's ~300 rows.

### Re-walk verdict — 08-emails × tenancy Wave A

**37 steps walked · 1 CHANGED · 32 UNCHANGED · 4 GAP entries (3 distinct
gaps + 1 dup).** No step loses its demo-event artifact under the migrated
schema; Wave B's committed membership enforcement covers every admin-surface
auth prelude touched here.

| # | Where | New gap (tenancy walk) | Severity |
|---|---|---|---|
| T1 | EM-S1 step 1 (+EM-S3 step 3 dup) | Default email-template provisioning for new events/orgs specified nowhere — only `drizzle/seed.sql:226–231` mints template rows, so every non-seeded event (P1 #5 create-event today, Wave C onboarding tomorrow) has no Accept template to edit and its auto `submission_confirmation` silently never sends; not covered by any committed wave | MAJOR |
| T2 | EM-S5 step 2 | Suppression scope under multi-tenancy unrecorded — `email_suppressions` is global `unique(email)` with no tenant column, so one org's unsubscribe silences every org's bulk sends to that address; conservative but undecided (design doc silent); flipping to per-org would also require org context in the signed unsubscribe token | MINOR |
| T3 | EM-S6 step 2 | `email_outbox`'s only tenant link is nullable `eventId` (set-null FK) — NULL rows are tenant-orphaned, invisible in every org's history log; aggravates 08-09 MINOR #14 ("eventId required" convention) and adds an event-deletion attribution question | MINOR |

Pre-existing 08-09 gaps #3 (renderer), #4 (unscheduled .ics), #5 (occurrence
arithmetic — now structurally per-event-tz, see EM-S4 step 3), #8–#13, #15
persist unchanged by tenancy. Closed since 08-09 (verified in code, not
tenancy work): BLOCKER #1 (suppression gate + `kind` live in
`app/ports/email.ts`), MAJOR #6 (history route mapped), BLOCKER #2 partially
(unsubscribe route mapped; token/footer still open), walk-07 #7 (portals
table exists).

---

## 2026-08-11 re-walk — calendar revision ledger and provider send claims

**Gate trigger:** migration `0013_schedule_calendar_ledger`, the `email` port,
`app/lib/ics.ts`, and `admin.agenda.tsx` changed. Every EM-S1–EM-S6 step was
re-walked. This section records only this change's effects; unresolved findings
from earlier walks remain in force.

### EM-S1 — template editor and next acceptance send

1. **Unchanged:** `admin.emails_.$key.tsx` still loads the active event's
   `(event_id, key)` template; the new calendar tables are not on this read path.
2. **Unchanged:** `EditTemplate` still rejects an empty `subject`, and the action
   returns before its `UPDATE email_templates`, preserving the stored value.
3. **Unchanged:** that same update still stores `subject`, `body_html`, and
   `reply_to`; no ledger or send-claim field enters template storage.
4. **Changed internally, same outcome:** the accept path still renders the saved
   template and sends through `getEmailSender`. In production, `email.ts` now
   owns the dedupe row with a compare-and-swap lease before calling Resend; the
   recipient, rendered content, and reply-to contract are unchanged.
   ```ts
   // app/domain/accept.ts — identity is unchanged; the decision is part of it
   await sender.send({ to, replyTo, subject, html, ics,
     dedupeKey: `decision:${decision}:${idempotencyKey}:${row.id}`,
     eventId: event.id, templateId: template.id, kind: "transactional" });
   ```
5. **Changed durability, same oracle:** Resend attempts still snapshot `to`,
   `subject`, `html`, `reply_to`, `event_id`, and `template_id` in
   `email_outbox`. A confirmed provider success is monotonic, so a stale
   claimant's later failure cannot replace the sent row.
   ```sql
   -- app/ports/email.ts, failure reconciliation: only MY claim may mark failed
   UPDATE email_outbox SET status='failed', error=?, send_claim_id=NULL,
          send_claim_expires_at=NULL
    WHERE id = ? AND send_claim_id = ?;   -- 0 rows → a newer claimant owns it
   ```
6. **New, product-visible:** `sendDecisionEmails` now classifies what came back
   from the port instead of calling every throw a recipient failure. Only a
   provider rejection is per-recipient; a live claim is reported as in flight
   (the row is NOT transitioned — the winning request finalizes it); anything
   else is infrastructure and propagates to the route's batch-level copy after
   the already-delivered speakers keep their `notified_at` stamp.
   ```ts
   } catch (error) {
     if (error instanceof EmailSendInFlightError) { /* ok:false, no-action copy */ }
     if (!(error instanceof EmailDeliveryError)) { await finalizeNotified(); throw error }
     /* EmailDeliveryError → per-row "…failed — see Email history…, then retry." */
   }
   ```
   Why the stamp must survive the throw: `notified_at IS NULL` permanently
   excludes a submission from `staleScheduleCandidates`, so a lost stamp silently
   removes that speaker from every future schedule update.

### EM-S2 — scheduled and unscheduled acceptance calendars

1. **Unchanged:** Agenda scheduling still writes `submissions.starts_at`,
   `ends_at`, and `room_id`; the new tables are delivery projections, not
   schedule truth.
2. **Changed durability, same acceptance:** `inviteForSubmission` and
   `icsForInvites` still build the acceptance VEVENT with stable
   `submission-<id>@openrostrum` UID and `SEQUENCE:0`. The acceptance outbox row
   is now normalized into `calendar_invite_revisions` on a later Agenda check.
   ```sql
   -- normalization page 1 of 2: metadata only, so one oversized attachment can
   -- never be pulled into Worker memory just to discover its size.
   SELECT o.id, o.dedupe_key, o."to", o.created_at,
          CASE WHEN o.ics_attachment IS NULL THEN 0 ELSE 1 END AS has_ics,
          COALESCE(LENGTH(CAST(o.ics_attachment AS blob)), 0)   AS ics_bytes
     FROM email_outbox o
     LEFT JOIN calendar_invite_processed_outbox p ON p.outbox_id = o.id
    WHERE o.event_id = ?
      AND (o.dedupe_key LIKE 'decision:accept:%' OR o.dedupe_key LIKE 'schedule-update:%')
      AND p.outbox_id IS NULL                 -- a finished row is never re-read
    ORDER BY o.created_at, o.id LIMIT 200;    -- OUTBOX_NORMALIZE_PAGE
   -- page 2 fetches bodies only for the metadata prefix that fits both the
   -- 600-statement budget and the 1 MiB aggregate body cap.
   ```
3. **Unchanged artifact:** the complete calendar text remains frozen in
   `email_outbox.ics_attachment` and is still available from Email history.
4. **Changed implementation:** `app/lib/ics.ts` now returns parsed events plus
   the structural VEVENT count from one line-aware scan. `buildIcs` still emits
   RFC 5545 folding, UTC stamps, stable UID, and `METHOD:PUBLISH`; the Resend
   MIME part is `text/calendar; method=PUBLISH`.
5. **Unchanged deliberate fallback:** an unscheduled accepted submission still
   gets the event-wide save-the-date hold from `inviteForSubmission` when event
   dates exist, rather than placeholder or epoch dates.
6. **Changed recovery only:** the unscheduled hold is normalized like any other
   acceptance. Deleted historical submission IDs remain terminal orphans, while
   an ID known to belong to another event marks the row invalid and fails closed.

### EM-S3 — immediate confirmation and portal link

1. **Unchanged:** form-level admin-notification configuration does not read or
   write the calendar ledger or send-claim columns.
2. **Unchanged:** CFP validation and submission creation remain in
   `app/cfp/server.ts`; no calendar normalization runs on the public POST.
3. **Changed durability, same immediacy:** `sendConfirmationEmail` still calls
   the sender inline with `dedupeKey: submission_confirmation:<submissionId>`.
   The provider lease is acquired in the same request, and the outbox row exists
   before the provider call.
4. **Unchanged:** portal URL construction and the cold-login redirect are
   independent of the email claim and calendar tables.
5. **Unchanged:** admin notification, when enabled, retains its own recipient and
   dedupe identity; the generic port applies the same claim semantics without
   merging it with the speaker confirmation.
6. **Strengthened:** a replay of the same confirmation key cannot claim an
   actively leased row. A completed key returns the original delivery, so the
   submission/outbox one-per-key oracle remains intact under concurrent POSTs.

### EM-S4 — draft reminders and occurrence dedupe

1. **Unchanged:** form close date and reminder configuration remain form/event
   state; migration `0013` adds no form column.
2. **Unchanged:** draft audience selection in
   `app/jobs/draft-reminders.scheduled.ts` is unaffected by calendar history.
3. **Changed generic delivery only:** the 5-day occurrence still computes from
   the event timezone and sends through the email port; its occurrence key now
   also owns one active provider lease.
4. **Unchanged oracle:** only selected draft holders produce outbox rows; the
   claim code does not create rows for filtered recipients.
5. **Strengthened:** replay of the exact 5-day dedupe key sees sent as terminal
   or active queued as in flight; it cannot report a queued provider call as a
   completed delivery.
6. **Unchanged identity:** the 1-day occurrence has a distinct dedupe key and
   therefore a second row; replay of that key remains idempotent.
7. **Unchanged:** reminder rendering and resume-draft links do not consume any
   new schema field.

### EM-S5 — suppression boundary

1. **Unchanged:** prior bulk-message fixture rows keep their existing outbox
   shape; migration `0013` is additive.
2. **Unchanged:** unsubscribe token handling and the idempotent suppression write
   do not use calendar or claim state.
3. **Unchanged:** the suppression oracle remains a direct
   `email_suppressions` lookup.
4. **Unchanged ordering:** `withSuppression` checks a normalized bulk recipient
   before either local or Resend adapter runs.
5. **Unchanged artifact:** suppressed Leo produces no outbox or provider claim;
   unsuppressed recipients each receive independent rows and claims.
6. **Unchanged boundary:** submission confirmations remain transactional and
   bypass bulk suppression, then use the strengthened provider claim path.
7. **Unchanged:** unsubscribe-footer rendering is upstream of the adapter; the
   claim stores the already-rendered HTML snapshot.

### EM-S6 — immutable searchable history and empty bulk send

1. **Unchanged query boundary:** `admin.emails_.history.tsx` still filters every
   list/detail query by active `event_id`.
2. **Strengthened history state, one row per key — not per attempt:** the outbox
   row is claimed before the HTTP call and resolved to sent/failed on that same
   row. A retry of a `failed` or lease-expired `queued` key re-claims **the
   existing row in place** (`onConflictDoNothing` on `dedupe_key`, then a
   compare-and-swap `UPDATE`), so history shows one attempt per key and the
   displayed payload is always the one actually sent. A retry of a `sent` or
   `bounced` key never reaches the provider at all — it returns `deduped: true`.
   Two consequences an admin can see: a failed send that later succeeds leaves
   **one** history row, not two; and the row's `subject`/`html` are overwritten
   by the corrected retry, because a superseded payload here would record an
   invite no speaker ever received. Calendar normalization adds immutable
   revision rows but never removes or hides an `email_outbox` row.
3. **Unchanged non-retroactivity:** history reads frozen outbox `subject` and
   `html`; editing an `email_templates` row cannot rewrite prior sends.
4. **Unchanged:** the zero-recipient guard still returns before
   `EmailSender.send`, so no lease or outbox row is created.
5. **Unchanged oracle:** because the guard precedes the adapter, direct outbox
   count remains unchanged.
6. **Unchanged bounded UI:** history search still escapes LIKE wildcards, filters
   recipient/subject, orders newest-first, and applies `limit`/`offset`.
   Calendar sequence lookup is separately bounded: each candidate chunk uses
   `row_number() over (partition by submission_id ...)` and returns only rank 1.

### New persistence and recovery artifacts

- `calendar_invite_revisions` is the immutable attempt projection. Duplicate
  `(outbox_id, submission_id)` writes converge, and the outbox remains the
  complete organizer-visible history.
- `calendar_invite_processed_outbox` durably records completion per outbox row.
  `event_id` preserves direct operational ownership and cleanup scope;
  `processed_at` makes stalled normalization diagnosable. They are retained even
  though current completion reads join by `outbox_id`.
- `calendar_invite_sequence_frontiers` is the mutable per-submission allocator.
  One SQLite upsert advances equal-sequence corrections monotonically; a
  post-claim reread requires exact state-hash and sequence ownership before send.
  ```sql
  INSERT INTO calendar_invite_sequence_frontiers (submission_id, sequence, state_hash, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (submission_id) DO UPDATE SET
    sequence = CASE
      WHEN state_hash = excluded.state_hash THEN MAX(sequence, excluded.sequence)
      ELSE MAX(sequence + 1, excluded.sequence)   -- a real change always advances
    END,
    state_hash = excluded.state_hash, updated_at = ?
  RETURNING sequence;   -- batched, so two concurrent claimants cannot tie
  ```
- **Two attempts at one SEQUENCE describing different states are treated as
  stale, never as a baseline.** RFC 5545 §3.8.7.4 makes SEQUENCE the revision
  counter, so an equal-SEQUENCE redelivery is exactly the payload a client is
  entitled to discard: one speaker kept the first, another kept the second, and
  no row order can tell them apart. Acceptance re-sends make this reachable —
  every one mints SEQUENCE 0. Picking either side lets today's slot "match" a
  state half the speakers never saw, and that silence is unrecoverable: no
  speaker can ask the product for a corrected invite. So the ambiguity itself is
  the stale signal, and the update resolving it goes out at a HIGHER sequence,
  which every client applies. The deliberate trade is a redundant invite for
  some speakers instead of no invite for others.
- **The provider idempotency key is scoped to the message content, and an ICS
  enters it as normalized text rather than as the base64 attachment.** DTSTAMP
  is re-minted on every render, so the raw attachment differs between two
  renders of one unchanged invite; hashing it raw would give a resumed send a
  brand-new key, Resend's 24h replay would not recognise it, and the speaker
  would receive the invite twice. The digest covers the full dedupeKey, so
  truncating the readable prefix cannot make two different keys collide.
- Schedule-update candidates are ordered **deliverable first**, then by id:
  `ORDER BY CASE WHEN <primary-speaker-or-submitter email> IS NULL THEN 1 ELSE 0 END,
  submissions.id`. Without this, a run of sessions whose speaker contact is gone
  (a dropped-email import, a bulk contact cleanup) never leaves the change set
  and, on identifier order alone, permanently occupies the 200-row window — the
  admin sees only failures and no speaker anywhere in the event ever receives a
  schedule change again. They still surface in the failed count, from the tail.
- Normalization processes a statement-budgeted prefix, writes attempt and marker
  batches idempotently, and resumes on a later request. The Agenda continuation
  form POSTs `intent=schedule-updates` while history remains.
- The external provider boundary is **at-least-once with duplicate suppression,
  not transactional exactly-once**. D1 compare-and-swap permits one active local
  claimant; a five-minute lease restores liveness after abandonment; Resend's
  `Idempotency-Key` suppresses repeated provider requests within its contract;
  confirmed success is persisted monotonically. A stuck call can outlive the
  lease, so the implementation deliberately does not claim exactly one HTTP
  request without provider reconciliation.

### Re-walk verdict

**37/37 steps re-walked.** Product-visible behavior for EM-S1–EM-S6 is
preserved. The changed artifacts strengthen durable recovery, monotonic calendar
revision allocation, and truthful queued/sent/failed history. No earlier email
scenario gap is closed merely by this hardening, and none is made worse.
