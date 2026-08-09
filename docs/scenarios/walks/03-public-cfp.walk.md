# WALK — 03-public-cfp.yaml (design-side, pre-swarm)

Walked 2026-08-09 against: `app/db/schema.ts`, `app/lib/auth.ts`, `app/ports/{email,turnstile,clock}.ts`,
`app/routes/*` + `docs/ROUTE-MAP.md`, `docs/tech-stack.md`, `SCOPE.md`, `drizzle/seed.sql`,
`docs/flows/02` + `docs/flows/09`. Every step below carries the concrete artifact that serves it, or a GAP.

Conventions: SQL uses the real snake_case columns from schema.ts; TS uses the real exported symbols.
`FORM` = the seeded session form (`forms.id='form_sessions'`, `public_id='form-sessions-uuid'`,
event `e_demo`, slug `ai-engineer-sandbox`). FORM_URL = `/submit/ai-engineer-sandbox/form-sessions-uuid`.

## Verdict up front — ranked gaps in this file

| # | Step(s) | Gap | Severity |
|---|---|---|---|
| G1 | CFP-S1.9, CFP-S1.10 | Portal URL segment `:portalId` has **no home in the schema** — no `portals` table, no column anywhere holds a portal uuid. The success-page redirect target and the confirmation-email portal link cannot be minted; the CFP builder and the portal builder cannot converge on the same URL without an integration decision. | **MAJOR** (borders BLOCKER — two independent agents must invent the same convention) |
| G2 | CFP-S1.3–7, S3.8, S5.2–9, S6.3 | **Wizard step-state carrier unspecified.** ROUTE-MAP splits the wizard into `submit.$eventSlug.$formId.tsx (+ .step.*)` — separate routes — but no doc states what carries the Submission step's values into Participant/Review (server-persisted draft row on every Next? client state across routes? hidden-field replay?). The choices have *observably different* behavior: phantom drafts consuming the submission limit (S6), Marcus's abandoned wizard in S3.8 leaving a row, and "submit another restarts clean" (S6.3). | **MAJOR** |
| G3 | CFP-S1.5, S3.4–6 | **Built-in field config is homeless.** Title/Description/Format/Tags/Track/Level/Language are per SCOPE removable, reorderable, per-field-required — but `forms` has no per-built-in columns, `form_fields` only places library `fields`, and nothing states `forms.config` holds it. There is no queryable source for "which built-ins, in what order, required or not" on the public form. | **MAJOR** |
| G4 | CFP-S1.5, S3.6 | **Language dropdown options are homeless.** No `languages` table; Library (SCOPE P1 #5) manages Tags/Tracks/Formats/Levels/Fields only; `submissions.language` is a bare text column defaulting `'English'`. S3.6 demands "no phantom or hardcoded options" — for Language the design can only hardcode. | **MAJOR** |
| G5 | CFP-S1.10 | **No mechanism puts the portal link into the confirmation email.** Seeded template body is `<p>Thanks for submitting!</p>`; no merge-tag renderer exists or is assigned anywhere (P1 #6 names a template *editor*, not a renderer util). The swyx-"must have" email cannot carry `{{portal_link}}` → rendered URL. Compounds G1. | **MAJOR** |
| G6 | CFP-S8.1–4 | **Turnstile is a stub + unbound.** (a) `createCloudflareTurnstile` throws — with `TURNSTILE_SECRET` set (which the test sitekeys require) every verify crashes; (b) no `TURNSTILE_SITE_KEY` exists in `Env` (`app/worker-env.d.ts` has only the secret) so the client widget cannot render; (c) nothing binds build agents to *call* `getTurnstile().verify` on any action — no lint rule (contrast `require-auth-in-actions`), and SCOPE names "the public CFP form" without naming endpoints; (d) the local adapter always passes, so S8.4's "no token → rejected" is unverifiable in worktrees. | **MAJOR** |
| G7 | CFP-S6.6–7 | Submission-limit **counting rule underspecified**: which statuses count (drafts yes per scenario — but withdrawn? declined?), and when the event-level `events.submission_limit` fallback applies, is the count per-form or per-event? Schema comment defines value fallback only. | MINOR |
| G8 | CFP-S7.1, S7.6 | **Closed-ness has two sources of truth**: `forms.status='closed'` AND `forms.close_at`. Nothing states whether status auto-flips at close or closed-ness is derived at read time. A builder checking only `status='open'` never closes at the date; one flipping status on save breaks S7.6's reopen. | MINOR |
| G9 | CFP-S2.5-signal | `login.tsx` — the explicitly-copy-me auth reference — has **no `autocomplete` attributes** on its inputs; the scenario asserts `autocomplete="username"/"current-password"` on the CFP account step. The pattern agents copy fails the signal. | MINOR |
| G10 | CFP-S5.4–5, SP-S3 | **Unique Contact Settings storage unstated** ("allow new info for existing contacts" OFF / "notify existing contacts" ON — SCOPE P0 #1.4). No `forms` column; `forms.config` unstated. Determines whether a second submission's typed data may overwrite Dana's contact. | MINOR |
| G11 | CFP-S1.4, S8.2-signal | **When is the `contacts` row minted?** S8's DB signal expects a contact after *signup alone*; `users.name` is one column while signup collects First+Last (which only `contacts.first_name/last_name` can hold). Creating the contact at account creation solves both — but nothing states it. | MINOR |
| G12 | fixtures | **Seed drift vs. scenario fixtures**: seeded FORM has no `submission_limit=3`, no `welcome_html`/`success_html`, `role_speaker_max` NULL (fixture: 4); taxonomies are `Agents/RAG`,`Innovation/Practice` not `Tag A`,`Topic A`; no Marcus Chen account; no Language anywhere. | MINOR |

SCENARIO-ERRORS: **none found.** Checked each scenario against SCOPE tiers: drafts/resume = P1 #4, Secondary Contact = P1 #13, Turnstile = SCOPE cross-cutting ("listed here so it can't silently slip"), close date/limits/stepper/success/auto-redirect/confirmation email = P0 #1–2. No step invents beyond committed tiers.

---

## CFP-S1 — first-time speaker end-to-end

### Step 1 — admin edits the success-page message
Route exists in ROUTE-MAP: `admin.forms.$formId.tsx` → `/admin/forms/:formId` (wave 1). Action self-authenticates (`requireAdmin`) and writes:

```sql
UPDATE forms
SET success_html = '<p>Merci! Our program team reads every proposal - expect a decision by October 1.</p>',
    updated_at   = unixepoch()
WHERE id = 'form_sessions' AND event_id = 'e_demo';
```

`forms.success_html` exists (schema line ~250). **OK**

### Step 2 — logged-out load: event name, close banner, limit line, stepper
Public loader (no auth — `getUser` optional only), route `submit.$eventSlug.$formId.tsx`:

```ts
// loader({ params, context })
const db = getDb(context.cloudflare.env);
const [row] = await db
  .select({ form: forms, event: events })
  .from(forms)
  .innerJoin(events, eq(events.id, forms.eventId))
  .where(and(eq(forms.publicId, params.formId), eq(events.slug, params.eventSlug)))
  .limit(1);
// banner: format(row.form.closeAt, row.event.timezone) →
//   "Form submissions will be accepted until September 15, 2026 at 11:59 PM PDT"
// limit line: row.form.submissionLimit ?? row.event.submissionLimit → "Submission Limit: 3 submissions per user"
```

Columns exist: `forms.close_at`, `forms.submission_limit`, `events.submission_limit`, `events.timezone`, `events.name`.
Stepper rail Welcome → Account → Submission → Participant → Review = SCOPE Appendix D. **OK**
(Fixture note: seed sets no `submission_limit` and `close_at = unixepoch('2026-09-15')` which is 00:00 UTC, not 11:59 PM PDT — see G12.)

### Step 3 — Welcome rich text → Get Started
`forms.welcome_html` + `forms.show_welcome` exist. Navigation to `/submit/ai-engineer-sandbox/form-sessions-uuid/step/account` (`submit.$eventSlug.$formId.step.account.tsx` under the ROUTE-MAP's `(+ .step.*)` grant). Client-side `<Link>` nav = no full reload. **OK**

### Step 4 — new email → signup branch → account created, logged in
Email-first lookup (public, by design — flow 09 rule z):

```sql
SELECT id FROM users WHERE email = 'priya@example.com' LIMIT 1;  -- 0 rows → signup branch
```

Signup action (marked `// @public`, per the require-auth-in-actions opt-out):

```ts
const passwordHash = await hashPassword("Priya!Speaks2026");     // app/lib/auth.ts PBKDF2
const [user] = await db.insert(users).values({
  email: "priya@example.com", passwordHash,
  name: "Priya Raman", role: "speaker",                          // USER_ROLE default is "speaker" anyway
}).returning();
await db.insert(contacts).values({                               // ← see GAP G11: unstated but required
  eventId: "e_demo", userId: user.id, email: "priya@example.com",
  firstName: "Priya", lastName: "Raman",
});
const cookie = await createSession(env, user.id, isSecureRequest(request));
return redirect(`/submit/${params.eventSlug}/${params.formId}/step/session`, { headers: { "Set-Cookie": cookie } });
```

"You are logged in as Priya Raman (priya@example.com)" renders from `getUser(env, request)`.
**GAP (G11, MINOR):** the design nowhere states the contact is created at signup, yet CFP-S8's success signal ("a contact exists for human.check@example.com" after signup only) and this step's First/Last prefill (step 6) both require it — `users.name` is a single column and cannot round-trip First/Last.

### Step 5 — Submission step: title counter, rich description, 5 dropdowns
Dropdown option queries (config-driven):

```sql
SELECT id, name FROM formats WHERE event_id = 'e_demo' ORDER BY position;         -- "Featured Keynote" = fmt_keynote
SELECT id, name FROM tags    WHERE event_id = 'e_demo' ORDER BY name;             -- (no position column on tags)
SELECT id, name FROM tracks  WHERE event_id = 'e_demo' ORDER BY name;             -- (no position column on tracks)
SELECT id, name FROM levels  WHERE event_id = 'e_demo' ORDER BY position;         -- "Introductory" = lvl_intro
-- Language: ??? no languages table, no library seed, submissions.language is bare text
```

Custom/library fields for the form, in order:

```sql
SELECT ff.id, ff.position, ff.required, ff.question_rule, f.name, f.type, f.max_length, f.options
FROM form_fields ff JOIN fields f ON f.id = ff.field_id
WHERE ff.form_id = 'form_sessions' AND ff.section = 'session'
ORDER BY ff.position;
```

**GAP (G3, MAJOR):** there is no query that returns the BUILT-IN fields' presence/order/required for this form. `form_fields` rows reference library `fields` only (built-in answers live on `submissions.title/description/format_id/...`, per the `submission_answers` comment "answers to custom/library fields"); `forms` has zero per-built-in columns; interleaving "Title, Description, then custom field at position 0" is undefined. The admin builder's "removable / drag to reorder / required toggle" for built-ins (SCOPE P0 #1.3) has nowhere to write.
**GAP (G4, MAJOR):** Language options have no storage at all (see table above). Title 48/255 counter: client-side vs `max 255` — the 255 itself is only a SCOPE constant, acceptable for a locked built-in.

### Step 6 — Participant step: prefill + "1-4 Speakers allowed - 1 added"
Prefill source (requires the step-4 contact):

```sql
SELECT first_name, last_name, email FROM contacts WHERE user_id = :priyaUserId AND event_id = 'e_demo';
```

Role banner values: `forms.role_speaker_min` (seed default 1) / `forms.role_speaker_max` (fixture 4). Columns exist. Mobile/Bio land on `contacts.mobile_phone` / `contacts.bio` at submit. **OK** (fixture max=4 not seeded — G12).
**GAP (G2, MAJOR — filed once, applies to every Next/Back in steps 3–7):** what persists Priya's typed Submission-step values while she is on the Participant step? No draft was saved; no mechanism (server row per Next? client store spanning `.step.*` routes?) is stated anywhere in the design. Each choice changes DB-observable behavior (S3.3 asserts a failed Next persists *nothing*; S6 counts drafts).

### Step 7 — Review shows everything → Submit
The submit action (self-contained POST, `requireUser` — drafts and submits require login):

```ts
const user = await requireUser(env, request);
const [form] = await db.select().from(forms).where(eq(forms.publicId, params.formId)).limit(1);
// closed check + limit check (see CFP-S7.5 / CFP-S6.7 artifacts) …
const subId = crypto.randomUUID();
await db.batch([
  db.insert(submissions).values({
    id: subId, eventId: form.eventId, formId: form.id, type: form.type,
    title: "Evals in Production: Lessons from 40 Deployments",
    description: '<p>… <strong>offline evals lie</strong> …</p>',
    status: "pending",                       // server-derived, never from the client
    submitterId: user.id, formatId: "fmt_keynote", levelId: "lvl_intro", language: "English",
  }),
  db.insert(submissionTracks).values({ submissionId: subId, trackId: /* "Topic A" */ trackId }),
  db.insert(submissionTags).values({ submissionId: subId, tagId: /* "Tag A" */ tagId }),
  db.insert(participants).values({ submissionId: subId, contactId: priyaContact.id, role: "speaker", isPrimary: true, position: 0 }),
  db.update(contacts).set({ mobilePhone: "+1 415 555 0142", bio: "Infra engineer, 10 years shipping ML systems." })
    .where(eq(contacts.id, priyaContact.id)),
]);
```

All tables/columns exist; `db.batch` per the D1 rule. Wizard-step URL recorded for S7:
`/submit/ai-engineer-sandbox/form-sessions-uuid/step/participant`. **OK** (review-page data source = G2 again).

### Step 8 — success page: sentinel message + portal button + submit-another
Loader returns `forms.success_html` (step 1's sentinel) + `forms.auto_redirect` (default true). Both columns exist. **OK**

### Step 9 — hands-free auto-redirect ~10s to the portal
Client artifact is trivial (`setTimeout(() => navigate(portalUrl), 10_000)` gated on `autoRedirect`). The blocked part is `portalUrl` itself. ROUTE-MAP: `/portals/:eventSlug/:portalId/*`.

```
portalUrl = `/portals/ai-engineer-sandbox/${???}/home`
```

**GAP (G1, MAJOR):** nothing in `schema.ts` can fill `???`. There is no `portals` table (only `portal_forms`, a different thing), no `events.portal_id`, no per-contact portal uuid. SCOPE Appendix E says "portal-uuid". The CFP feature (this redirect + the email link) and the portal feature resolve this param independently — with no shared source of truth, PORTAL_URL is unmintable on paper.

### Step 10 — confirmation email in outbox, link gated by login
Port call as the design intends it:

```ts
const sender = getEmailSender(env);                       // no RESEND_API_KEY locally → D1 outbox adapter
const [tpl] = await db.select().from(emailTemplates)
  .where(and(eq(emailTemplates.eventId, "e_demo"), eq(emailTemplates.key, "submission_confirmation"))).limit(1);
await sender.send({
  to: "priya@example.com",
  subject: tpl.subject,                                   // "We received your submission"
  html: renderTemplate(tpl.bodyHtml, { portal_link: portalUrl }),   // ← renderTemplate DOES NOT EXIST
  dedupeKey: `submission_confirmation:${subId}:priya@example.com`,  // template+recipient+occurrence
  eventId: "e_demo", templateId: tpl.id, replyTo: tpl.replyTo ?? undefined,
});
```

Verification query:

```sql
SELECT "to", status, html FROM email_outbox
WHERE "to" = 'priya@example.com' AND dedupe_key LIKE 'submission_confirmation:%';
-- local adapter writes status='sent', sent_at set
```

**GAP (G5, MAJOR):** the seeded template body carries no portal-link tag and no merge-tag renderer exists or is assigned in the design (no `app/lib/…` util, no doc section) — the "must have" email body cannot contain the portal URL. Plus G1: the URL value itself is unmintable.
Link-not-self-authenticating: opening `/portals/...` logged-out hits `requireUser` → `redirect('/login?redirectTo=/portals/...')` (`app/lib/auth.ts` line ~194). That IS a password gate. **OK** for the gate; MINOR caution: `login.tsx`'s `safeRedirect` default and its loader both send *already-authenticated* users to `/admin`, which 403s a speaker — harmless here (incognito) but a portal-flow trip hazard (see walk 04, SP-S8).

---

## CFP-S2 — returning speaker login, wrong password handled

### Step 1–2 — email-first branch to login
```sql
SELECT id FROM users WHERE email = 'marcus.chen@example.com' LIMIT 1;  -- 1 row → "Log in with your existing account"
```
(Marcus is NOT in seed.sql — G12.) "Forgot your password?" link target: **no route exists** — logged as the MAJOR forgot-password gap in walk 04 (SP-S8); for this scenario only the link's presence is asserted. **OK**

### Steps 3–5 — wrong password rejected inline, email preserved, no session
Copy of the login.tsx action shape (the designated reference):

```ts
const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
const ok = await verifyPassword("definitely-wrong-1A!", user?.passwordHash ?? DUMMY_HASH); // timing-equalized
if (!user || !ok) return { error: "Incorrect email or password." };   // NO createSession call
```

No session row is written on failure (`createSession` only runs on success) → "no session issued". Repeat ×3: stateless, no lockout counter exists anywhere = consistent behavior. `<Form>` action return re-renders with the typed email still in the input (RR7 keeps controlled/default values; no redirect). DB probe:

```sql
SELECT COUNT(*) FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email='marcus.chen@example.com'); -- 0 new
SELECT COUNT(*) FROM contacts WHERE email = 'marcus.chen@example.com'; -- unchanged
```
**OK.**
**GAP (G9, MINOR):** the signal requires `autocomplete="username"` / `autocomplete="current-password"`; `login.tsx` (lines 84–96), the pattern to copy, has neither attribute — the reference teaches the failing shape.

### Step 6 — correct password → session → Submission step
```ts
const cookie = await createSession(env, user.id, isSecureRequest(request));
return redirect(`/submit/${eventSlug}/${formId}/step/session`, { headers: { "Set-Cookie": cookie } });
```
"Logged in as … Click here to log out" from `getUser`. **OK**

### Step 7 — logout kills the session
`logout.tsx` action: `destroySession` = `DELETE FROM auth_sessions WHERE id = :cookieSessionId` + clearing Set-Cookie (Max-Age=0). Server-side session rows mean no resurrection. **OK** (note: logout redirects to `/login`, not back to FORM_URL — cosmetic).

---

## CFP-S3 — validation persists nothing; counter; config-driven dropdowns

### Steps 1–2 — empty Title blocks, Description preserved, inline error
Server action mirror of the golden path's refinement:

```ts
const SubmissionStep = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().min(1).max(5000),
  formatId: z.string().min(1), trackId: z.string().min(1), tagId: z.string().min(1),
  levelId: z.string().optional(), language: z.string().optional(),
});
const parsed = SubmissionStep.safeParse(Object.fromEntries(form));
if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };  // ← returns BEFORE any db.insert
```
Description preservation = action-data re-render, no redirect. **OK** (client inline validation is the EXPERIENCE half; server shape above is the oracle).

### Step 3 — no row minted by the failed attempt
```sql
SELECT COUNT(*) FROM submissions WHERE submitter_id = :marcusUserId AND form_id = 'form_sessions';
-- must equal the pre-step count
```
True for the artifact above (validation precedes insert). **But** this is exactly where G2 bites: if the chosen stepper mechanism persists a draft row on entering/leaving steps, this signal fails. The design does not adjudicate. **GAP (G2, MAJOR — cross-ref).**

### Steps 4–5 — 255 cap + live counter
`maxLength={255}` + counter on keystroke (client); server `.max(255)` above catches the forged path. The 255 for built-in Title is a SCOPE constant (Appendix C step 3) — acceptable for a *locked* field, but the per-form home for built-in max/required is G3. **OK with G3 noted.**

### Step 6 — dropdown options equal admin config one-for-one
Same four taxonomy queries as CFP-S1.5. Format/Tags/Track/Level: config-driven, **OK**. Language: **GAP (G4, MAJOR — cross-ref)** — there is no admin-configured list to equal; any options are by definition phantom/hardcoded, which this step explicitly forbids.

### Steps 7–8 — Library edit shows up on the public form
Admin route `admin.settings.library.tsx` (ROUTE-MAP wave 0/1):

```sql
INSERT INTO formats (id, event_id, name, default_duration_mins, position, created_at)
VALUES ('fmt_lightning', 'e_demo', 'Lightning Talk', 15, 2, unixepoch());
```
Marcus reloads → the CFP-S1.5 formats query returns it. Abandon-without-saving: with no draft written, nothing persists — again contingent on G2's resolution (an auto-persisting wizard would leave a phantom row that later collides with Marcus's SP-S3 submission count). **OK with G2 noted.**

---

## CFP-S4 — save draft, leave, resume with everything pre-filled

### Steps 1–2 — draft save before the Participant step
```ts
await db.insert(submissions).values({
  id: draftId, eventId: "e_demo", formId: "form_sessions", type: "session",
  title: "Async Agents on the Edge",
  description: '<p>… <strong>durable</strong> …</p>',
  status: "draft",                                   // SUBMISSION_STATUS includes 'draft'
  submitterId: priyaUserId, formatId: "fmt_keynote",
});
```
`status='draft'` exists; Title present satisfies `title NOT NULL` (matches the "at least a Title" rule, flow 02 §2b). **OK**

### Step 3 — draft banner + last-saved timestamp
`submissions.updated_at` (auto `$onUpdate`) → "Last saved on {date}". **OK**

### Step 5 — resume discovery on next login
```sql
SELECT id, title, status, updated_at
FROM submissions
WHERE form_id = 'form_sessions' AND submitter_id = :priyaUserId AND status = 'draft';
-- index: submissions_submitter_idx / submissions_form_idx
```
Resume URL: `/submit/ai-engineer-sandbox/form-sessions-uuid/submissions/<draftId>` — a reopen route in the flow-02 shape, but ROUTE-MAP's grant is `(+ .step.*)` only; a `submissions.$submissionId` child is a reasonable reading of the same row. **OK** (thin).

### Step 6 — pre-filled resume, no duplicate row
Loader selects the draft row (`title`, `description` HTML with `<strong>durable</strong>` intact, `format_id`) + its `submission_answers`; the subsequent save/submit is an **UPDATE**, not INSERT:

```ts
await db.update(submissions)
  .set({ title, description, formatId /* … */ })
  .where(and(eq(submissions.id, draftId), eq(submissions.submitterId, user.id)));  // ownership in the WHERE
```
```sql
SELECT COUNT(*) FROM submissions WHERE submitter_id = :priyaUserId AND status = 'draft'; -- exactly 1, before and after
```
**OK** — with the caveat that "the wizard knows it is editing draftId across steps" is G2's unstated carrier.

### Step 7 — the portal shows the draft with a resume path
Portal Home/Submissions query (see walk 04 SP-S1.5) returns the draft row; label map sends `draft → "Draft"`. Resume path = the step-5 URL. Draft-in-portal is P1 #4 committed ("portal shows 'resume draft'"). **OK** (pending G1 for the portal URL itself).

### Step 8 — leave unsubmitted
No artifact — state carried to suites 04/CFP-S7. **OK**

---

## CFP-S5 — role min/max, live email validation, secondary contact

### Step 1 — duplicate the form, Min 2 / Max 4
`admin.forms.tsx` action (Duplicate per SCOPE P0 #1 "Per-form ⋯: Duplicate"):

```ts
const panelId = crypto.randomUUID();
await db.batch([
  db.insert(forms).values({ ...src, id: panelId, publicId: crypto.randomUUID(),   // fresh public URL
    internalName: "Panel Submission Form", roleSpeakerMin: 2, roleSpeakerMax: 4,
    createdAt: undefined, updatedAt: undefined }),
  ...srcFields.map((ff) => db.insert(formFields).values({ ...ff, id: crypto.randomUUID(), formId: panelId })),
]);
```
`role_speaker_min/max` exist. PANEL_FORM_URL = `/submit/ai-engineer-sandbox/<newPublicId>`. **OK**

### Steps 2–3 — banner "2-4 Speakers allowed - 1 added", progression blocked
Server-side gate in the review/continue action:

```ts
const speakers = participants.filter((p) => p.role === "speaker");
if (speakers.length < form.roleSpeakerMin)
  return { formError: `At least ${form.roleSpeakerMin} speakers are required.` };      // min 2 blocks
if (form.roleSpeakerMax !== null && speakers.length > form.roleSpeakerMax)
  return { formError: `No more than ${form.roleSpeakerMax} speakers are allowed.` };
```
**OK** — where the in-progress participant list LIVES before submit is G2 (cross-ref).

### Steps 4–5 — live email validation, banner updates
Client blur validation (zod `z.string().email()` shared with the server schema). Counter re-render on add/remove — client state. **OK** (EXPERIENCE-side; server re-checks on submit via the same schema).

### Steps 6–7 — max cap at 4, remove back to 2
Same `roleSpeakerMax` artifact as step 3, applied both client (disable Add) and server (reject the 5th on the forged path). **OK**

### Step 8 — Add Secondary Contact
`PARTICIPANT_ROLE` includes `'secondary'` (schema line ~493, comment: "assists with tasks and communication"). Secondary is *not counted* by the speaker min/max artifact above (filters `role === "speaker"`), and no `role_secondary_min/max` columns exist → by design uncapped/uncounted. Consistent with the scenario (2 speakers + 1 secondary passes Min 2). **OK**

### Step 9 — submit: 3 participant rows, contacts created/linked by email
Phase 1 — resolve contacts (upsert-by-email against the `contacts_event_email_uq` unique):

```ts
for (const p of [dana, leo]) {
  const [existing] = await db.select().from(contacts)
    .where(and(eq(contacts.eventId, "e_demo"), eq(contacts.email, p.email))).limit(1);
  p.contactId = existing?.id ?? crypto.randomUUID();
  if (!existing) await db.insert(contacts).values({ id: p.contactId, eventId: "e_demo",
    email: p.email, firstName: p.firstName, lastName: p.lastName, mobilePhone: p.phone, bio: p.bio });
  // existing contact: do NOT overwrite fields — "allow new info for existing contacts" is OFF…
  // …but that toggle has no storage (GAP G10, MINOR)
}
```

Phase 2 — atomic write:

```ts
await db.batch([
  db.insert(submissions).values({ id: subId, eventId: "e_demo", formId: panelId, type: "session",
    title: "Agents in Production: A Practitioners Panel", description, status: "pending",
    submitterId: priyaUserId, formatId: "fmt_keynote" }),
  db.insert(submissionTracks).values({ submissionId: subId, trackId: topicATrackId }),
  db.insert(submissionTags).values({ submissionId: subId, tagId: tagAId }),
  db.insert(participants).values([
    { submissionId: subId, contactId: priyaContactId,  role: "speaker",   isPrimary: true,  position: 0 },
    { submissionId: subId, contactId: danaContactId,   role: "speaker",   position: 1 },
    { submissionId: subId, contactId: leoContactId,    role: "secondary", position: 2 },
  ]),
]);
```

DB signal query:

```sql
SELECT p.role, c.email FROM participants p JOIN contacts c ON c.id = p.contact_id
WHERE p.submission_id = :subId ORDER BY p.position;
-- speaker/priya, speaker/dana.okafor, secondary/leo.martins → exactly 3 rows
```
**OK** (G10 noted on the overwrite question).

---

## CFP-S6 — submission limit: drafts count, server-side enforcement

### Steps 1–5 — account + 2 submits + 1 draft
Same artifacts as CFP-S1.4 (signup) / CFP-S1.7 (submit ×2 with titles "Retrieval Beyond RAG", "Fine-tuning on a Budget") / CFP-S4.2 (draft "Guardrails that Scale"). "Submit another restarts clean" (step 3): the wizard must not rehydrate submission #1's values — behavior owned by G2's unresolved carrier. **OK with G2 noted.**

### Step 6 — 4th attempt blocked with product copy
The actual counting query the design supports (drafts INCLUDED — the scenario's own proof):

```sql
SELECT COUNT(*) AS used
FROM submissions
WHERE form_id = 'form_sessions'
  AND submitter_id = :raviUserId
  AND status IN ('draft','pending','accept_queue','accepted','decline_queue','declined');
-- used = 3 (2 submitted + 1 draft)
```

```ts
const limit = form.submissionLimit ?? event.submissionLimit;   // schema comment: event value is the fallback
if (limit !== null && used >= limit)
  return { blocked: true, message: `You've reached this form's limit of ${limit} submissions. You can manage your existing submissions in your speaker portal.` };
```

**GAP (G7, MINOR):** the status set is my inference — the design states only that drafts count (P1 #4 "drafts count toward limits"). Withdrawn/declined counting is unadjudicated (a speaker who withdraws: does a slot free up?). And when the *event-level* fallback applies, whether the COUNT is scoped `form_id = ?` or `event_id = ?` (across forms) is unstated — the schema comment defines the *value* fallback, not the *counting scope*.

### Step 7 — forged POST rejected, nothing persisted
The forged `POST /submit/ai-engineer-sandbox/form-sessions-uuid/step/review` (or the submit action route) hits the same action, which runs `requireUser` → the count above → returns 4xx before any insert:

```ts
if (limit !== null && used >= limit) throw data({ error: "Submission limit reached." }, { status: 422 });
```
```sql
SELECT COUNT(*) FROM submissions WHERE submitter_id = :raviUserId; -- still 3; no 'Sneaky Fourth Talk'
```
Enforcement lives in the action = server-side. **OK** (given the check is written — it is walked here so a reviewer can hold the build to it).

---

## CFP-S7 — closed form: nobody submits, resumes, or forges in

### Step 1 — set close date in the past; Forms list shows Closed
```sql
UPDATE forms SET close_at = unixepoch('2026-08-02 06:59:59')  -- 2026-08-01 11:59 PM PDT expressed in UTC
WHERE id = 'form_sessions';
```
Forms-list badge must derive from the SAME predicate as the public check (below).
**GAP (G8, MINOR):** `forms.status` ('open'/'closed') and `forms.close_at` are two sources of truth. The seed shows both conventions (form_workshops has status='closed' AND a past close_at). Nothing states whether the admin save flips `status`, or whether closed-ness is derived at read time — and S7.6's reopen requires the mapping to be bidirectional. The design needs one stated rule, e.g.:

```ts
// the derived predicate every consumer must share (Clock port, not new Date()):
const isClosed = (form: Form, clock: Clock) =>
  form.status !== "open" ||
  (form.closeAt !== null && form.closeAt.getTime() <= clock.now().getTime());
```

### Step 2 — logged-out FORM_URL renders the closed state
Public loader runs `isClosed` → renders event name + "Form submissions are no longer being accepted." with no Get Started. Branded page = normal route render, not ErrorBoundary. **OK** (with G8's predicate as the artifact).

### Step 3 — deep-link probe on the recorded step URL
`/submit/ai-engineer-sandbox/form-sessions-uuid/step/participant` — EVERY `.step.*` loader must run the same check. No shared layout/util is designated for the `.step.*` family; if the check lives only in the index route, the deep link walks past it. Serviceable (a `submit.$eventSlug.$formId.tsx` layout route wrapping the steps runs its loader on child navigation), but unstated. **OK, thin — fold into G8's "one stated rule" remedy.**

### Step 4 — Ravi's draft can't be resumed into a submission
Resume loader + save/submit actions run `isClosed` first → the draft renders read-only/blocked ("the edit window ends at the close date" = flow-09 rule a). **OK**

### Step 5 — forged POST rejected
```ts
if (isClosed(form, clock)) throw data({ error: "This form is closed." }, { status: 403 });
```
placed at the top of the submit/draft actions, before parsing. **OK**

### Step 6 — restore the date; the form reopens
```sql
UPDATE forms SET close_at = unixepoch('2026-09-16 06:59:59'), status = 'open' WHERE id = 'form_sessions';
```
Works iff G8's rule is derived (or the admin save maintains both fields symmetrically). **OK with G8.**

---

## CFP-S8 — Turnstile

### Step 1 — widget present, always-pass sitekey
Server seam exists and is correctly shaped:

```ts
// app/ports/turnstile.ts
getTurnstile(env)            // env.TURNSTILE_SECRET set → createCloudflareTurnstile(env)
```

Client render needs the SITE key in the loader payload:

```ts
return { turnstileSiteKey: env.TURNSTILE_SITE_KEY };   // ← does not exist in Env
```

**GAP (G6, MAJOR):**
- `Env` declares only `TURNSTILE_SECRET` (`app/worker-env.d.ts`); there is **no `TURNSTILE_SITE_KEY`** var/binding anywhere (`wrangler.json` `vars`, `.dev.vars.example`) — the widget cannot be rendered from config, and `wrangler.json` is integration-owned so a feature agent can't add it.
- `createCloudflareTurnstile` **throws** ("not configured yet — capabilities phase"): the moment the test secret for `1x00000000000000000000AA` is set, every verify call crashes instead of passing. Steps 1–3 are unservable until the adapter is written:

```ts
// the missing prod adapter body (siteverify):
const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
  method: "POST",
  body: new URLSearchParams({ secret: env.TURNSTILE_SECRET!, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
});
return ((await res.json()) as { success: boolean }).success;
```

### Step 2 — signup with zero interactive challenge
Signup action (the CFP-S1.4 artifact) gains, before any insert:

```ts
const token = String(form.get("cf-turnstile-response") ?? "");
const human = await getTurnstile(env).verify(token, request.headers.get("CF-Connecting-IP") ?? undefined);
if (!human) return { formError: "We couldn't verify your browser. Please retry the security check." };
```

**GAP (G6 cont., the binding hole):** *nothing obligates this call.* Auth-in-actions has an ESLint rule; Turnstile has only a SCOPE cross-cutting sentence naming "the public CFP form" — not which actions (signup? submission POST? both?), and no lint/test gate. The predicted failure mode is a build where the widget renders and no action verifies.

### Step 3 — always-block sitekey → clean rejection, nothing created
Same artifact; `verify` returns false → the action returns product copy, no `users`/`contacts` insert:

```sql
SELECT COUNT(*) FROM users    WHERE email = 'bot.check@example.com';  -- 0
SELECT COUNT(*) FROM contacts WHERE email = 'bot.check@example.com';  -- 0
```
**Blocked by the same adapter stub (G6).**

### Step 4 — forged POST with no token
`verify("")` → Cloudflare siteverify fails (`missing-input-response`) → 4xx, nothing persisted. **OK once G6's adapter exists** — and note the local no-op adapter returns `true` for the empty token, so this negative path is untestable in worktrees; the scenario correctly pins it to real test keys.

---

## touches (written into 03-public-cfp.yaml)

```yaml
touches:
  tables: [events, forms, formFields, fields, formats, tags, tracks, levels, users,
           authSessions, contacts, submissions, submissionAnswers, submissionTracks,
           submissionTags, participants, emailTemplates, emailOutbox]
  ports: [email, turnstile, clock]
  routes: [submit.$eventSlug.$formId.tsx, "submit.$eventSlug.$formId.step.* (route-map grant)",
           login.tsx, logout.tsx, admin.forms.tsx, admin.forms.$formId.tsx,
           admin.settings.library.tsx, "portals.$eventSlug.$portalId.* (redirect/email target)"]
```
