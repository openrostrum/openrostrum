# Walk — 02-form-builder (design-side, executed on paper against schema.ts / routes / ROUTE-MAP)

Same discipline as walk 01: concrete artifact per step or a filed GAP. All scenarios run
inside the AE-S2 event, so **everything below inherits the AE-S2.4 current-event BLOCKER**
(no mechanism selects "DevOps Days Lyon 2027" as the operating event); stated once here,
not repeated per step. Builder route: `admin.forms.$formId.tsx` → `/admin/forms/:formId`;
list: `admin.forms.tsx`; public: `submit.$eventSlug.$formId.tsx` (all assigned, todo).

## THE CENTRAL DESIGN FAULT (referenced by FB-S2/S3/S4)

The builder's field list is: **built-in fields** (Title, Description, Format, Tags, Track,
Level, Language; participant First/Last/Email, Mobile Phone, Biography…) + **library fields**
(`fields` → placed via `form_fields`). Built-ins are NOT rows in `fields` — they are columns
on `submissions` (`title`, `description`, `format_id`, `level_id`, `language`) and m2m tables
(`submission_tracks`, `submission_tags`), and contacts columns for participant fields. The
seed proves the intent: `form_fields` for the seed form contains ONLY the two custom fields.
Consequently, for built-ins there is **no `position`, no per-form `required`, no `locked` row,
and no id that `question_rule.fieldId` can hold**. `forms.config` ("overflow for validation
rules, admin-notify pickers, etc.") is the only conceivable home, and no shape is defined.
The artifact that WOULD be needed (one of):

```ts
// (a) formFields grows a builtin discriminator (fieldId becomes nullable):
formFields: { fieldId: text | null, builtinKey: text<"title"|"description"|"format"|"tags"|"track"|"level"|"language"|"first_name"|…> | null, … }
// (b) or built-ins are seeded as global `fields` rows + a documented fields.id ↔ submissions-column mapping.
```

---

## FB-S1 — Start a form: type, welcome screen, 15-char heading cap

### Steps 1–3 — create; Abstracts; participants on; names

```ts
// admin.forms.tsx action:
const [form] = await db.insert(forms).values({
  eventId,                       // ← current event (inherited BLOCKER)
  type: "abstract",              // "Abstracts" card → FORM_TYPE 'abstract'
  participantsStep: true,        // default true, left on
  internalName: "CFP 2027 – Main Call",
  externalTitle: "DevOps Days Lyon 2027 — Call for Proposals",
}).returning();
// publicId self-mints via $defaultFn(crypto.randomUUID) — the /submit URL segment.
```
Columns `type`, `participants_step`, `internal_name`, `external_title` all exist. **OK**

### Step 4 — 16-char heading must be unsavable

```ts
// client: <input name="pageHeading" maxLength={15} …/>
// server (the real gate — direct POSTs bypass maxLength):
const WelcomeStep = insertFormSchema.pick({ externalTitle: true, pageHeading: true, welcomeHtml: true, showWelcome: true })
  .extend({ pageHeading: z.string().min(1).max(15, "Page heading is limited to 15 characters") });
```
Servable — but the 15 lives NOWHERE in the design: `forms.page_heading` is unconstrained
`text`, drizzle-zod derives a bare `z.string()`, and the only statements of the cap are
SCOPE Appendix C + the scenario. Client `maxLength` and server `.max(15)` must each be
hand-remembered by whichever agent builds each surface.
`GAP: 15-char page-heading cap is encoded in no schema constraint or shared zod contract — enforcement is per-agent folklore (exactly the class of cap that silently drops on one of the two sides) [MINOR]`

### Steps 5–6 — heading + rich welcome message

```sql
UPDATE forms SET
  page_heading = 'CFP Lyon 2027',
  welcome_html = '<p>Join us in Lyon — <strong>we cover travel for accepted speakers</strong>. Details at <a href="https://devopsdays-lyon.example.com">devopsdays-lyon.example.com</a>.</p>',
  show_welcome = 1
WHERE id = :formId;
```
`welcome_html` stores the Tiptap HTML (bold + link survive as markup). **OK**

### Steps 7–8 — leave, re-open, everything persisted

Loader: `db.query.forms.findFirst({ where: eq(forms.id, params.formId), with: { formFields: { with: { field: true } } } })`
→ type/heading/title/welcome re-render from the row. **OK**
EXPERIENCE (instant step navigation, values survive Back/Next pre-save): client component
behavior inside the single builder route — no schema gap; binding-statement caveat as filed
in walk 01 (scenario-only requirement). 

---

## FB-S2 — Session step: locked rows, custom fields, library reuse, drag reorder

### Step 1 — Title/Description render as LOCKED rows

No serving artifact: Title/Description have no `form_fields` row (see CENTRAL FAULT), so
`form_fields.locked` — the column built exactly for this — has nothing to be true on. A
builder can hardcode two synthetic rows, but then "locked", "required", and their ORDER are
invented per-agent with no persistence.
`GAP: built-in fields have no form_fields representation — locked/required/order state has no home (form_fields.locked exists but is unreachable for the rows that need it) [BLOCKER]`

### Steps 2–3 — create two new fields on this form

```ts
await db.batch([
  db.insert(fields).values({ id: keyTakeawayId, eventId, name: "Key takeaway", type: "text", maxLength: 140, scope: "event" }),
  db.insert(formFields).values({ formId, fieldId: keyTakeawayId, section: "session", position: 2, required: true }),
  db.insert(fields).values({ id: audienceLevelId, eventId, name: "Audience level", type: "dropdown", options: ["Beginner","Intermediate","Advanced"], scope: "event" }),
  db.insert(formFields).values({ formId, fieldId: audienceLevelId, section: "session", position: 5, required: false }),
]);
```
All columns exist (`max_length`, `options` json, per-form `required` on the placement). **OK**

### Step 4 — reuse the AE-S4 library field

```ts
await db.insert(formFields).values({ formId, fieldId: earliestArrivalId /* AE-S4's row */, section: "session", position: 6, required: false });
-- unique(form_id, field_id) permits this once per form; SAME fields.id → reuse, not a copy. ✓
```
**OK** (side note: that same unique constraint forbids placing one library
`divider`/`section_header` row twice on a form — layout elements need a fresh `fields` row
per use. `GAP: unique(formId,fieldId) vs reusable layout elements [MINOR]`)

### Step 5 — Track required ON, Language required OFF

Both are built-ins → no `form_fields.required` to flip. Only conceivable home today:
```json
// forms.config (shape invented here — defined nowhere):
{ "builtins": { "track": { "required": true }, "language": { "required": false } } }
```
`GAP: per-form required overrides for built-in fields have no defined home; forms.config workaround has no contract the public-form renderer/validator agent would know to read [MAJOR — same root as FB-S2.1]`

### Step 6 — drag so order reads Title, Description, Key takeaway, Format, …

Custom placements order by `form_fields.position`, but Title/Description/Format have no
position at all — "Key takeaway **between** Description and Format" is inexpressible. There
is no interleaved sequence to persist or to replay on the public form.
`GAP: built-ins carry no position — the saved order across built-in + custom fields cannot be stored or rendered; drag-reorder across the full list is unservable [BLOCKER — same root as FB-S2.1]`

### Step 7 — public link, cold signup, advance

```
URL: https://<host>/submit/devops-days-lyon-2027/<forms.public_id>
Route: app/routes/submit.$eventSlug.$formId.tsx  (@public; loader matches
  forms.public_id = params.formId AND events.slug = params.eventSlug)
```
```ts
// signup inside the Account step (copies login.tsx's establish-session shape):
await db.insert(users).values({ email: "marie.dupont@example.com", passwordHash: await hashPassword("M4rie!2027"), role: "speaker" });
const cookie = await createSession(env, marieId, isSecureRequest(request));
```
**OK** — naming smell: the route param is `$formId` but must be matched against
`forms.public_id`, never `forms.id`; nothing but a schema comment says so.
`GAP: $formId ≠ forms.id ambiguity undocumented in ROUTE-MAP [MINOR]`

### Step 8 — public render: order, required marks, options, date input

Custom fields render from `form_fields JOIN fields` (`type='date'` → `<input type="date">`,
dropdown options from `fields.options`, required mark from `form_fields.required`) — **OK for
customs**; overall order + Language-not-required inherit FB-S2.5/6 gaps.

### Step 9 — required "Key takeaway" empty → inline error, values kept

```ts
// action: for each formFields row with required=1 and no submitted value →
return { fieldErrors: { [fieldId]: ["Key takeaway is required"] }, values: Object.fromEntries(formData) };
// re-render with submitted values → Title/Description not lost. (Golden-path pattern.)
```
**OK**

---

## FB-S3 — Conditional rules: built-in Format trigger AND custom trigger; hidden-required

### Step 1 — two target fields

```ts
await db.batch([
  db.insert(fields).values({ id: prereqId, eventId, name: "Workshop prerequisites", type: "textarea", maxLength: 1000, scope: "event" }),
  db.insert(formFields).values({ formId, fieldId: prereqId, section: "session", position: 7, required: true }),
  db.insert(fields).values({ id: assumedId, eventId, name: "Assumed knowledge", type: "text", scope: "event" }),
  db.insert(formFields).values({ formId, fieldId: assumedId, section: "session", position: 8, required: false }),
]);
```
**OK**

### Step 2 — rule: show when BUILT-IN Format = "Workshop (120 min)" ⟵ the known gap, confirmed precisely

`form_fields.question_rule` is typed `{ fieldId: string; operator: string; value: string }`
where `fieldId` is a `fields.id`. The Format dropdown is not a `fields` row (it is
`submissions.format_id` → `formats` table; seed confirms no builtin `fields` rows exist).
**There is no value that can legally be written into `fieldId` for this rule.** The JSON
that WOULD be needed:

```json
{ "fieldId": "builtin:format", "operator": "equals", "value": "<formats.id of 'Workshop (120 min)'>" }
```

— which requires (a) a documented `builtin:*` (or nullable-fieldId + builtinKey) convention
in the schema type, (b) the builder UI offering built-ins in the trigger picker, (c) the
public renderer AND the server validator both resolving it against the submitted
`format_id`, and (d) a decision whether `value` compares `formats.id` or `formats.name`.
None of the four exists.
`GAP: question_rule cannot reference the built-in Format dropdown — the P1 #2 committed scenario ("show Workshop prerequisites when Format = Workshop (120 min)") is unservable by the schema's rule shape [BLOCKER]`

### Step 3 — rule: show when CUSTOM "Audience level" = "Advanced"

```sql
UPDATE form_fields SET question_rule =
  '{"fieldId":"<audienceLevelId>","operator":"equals","value":"Advanced"}'
WHERE form_id = :formId AND field_id = :assumedId;
```
Expressible today (seed's `ff_notes` is the precedent; dropdown values are option strings,
so `"Advanced"` compares cleanly). **OK** — with: `operator` is a free string; the legal set
("equals"? "is"? "contains"?) is enumerated nowhere (flow 01 §6 confirms Sessionboard never
documents it either — WE must define it and haven't).
`GAP: question-rule operator vocabulary undefined [MINOR]`

### Steps 4–8 — toggling on the public form, client-side, instantly

Mechanism level, honestly: **client component behavior** — the public form must hold all
rule-bearing fields in client state and evaluate `question_rule` on every dropdown change;
no navigation, no server call. No schema gap possible. REQUIREMENT AUDIT (the second known
gap, confirmed): "client-side / no document navigation" is stated **only** in this
scenario's EXPERIENCE line. `docs/flows/01-form-builder.md` says merely "Field hidden until
trigger condition met"; SCOPE P1 #2 says "show field B when field A matches"; tech-stack
says nothing. A build agent could implement show/hide as a server round-trip and satisfy
every non-scenario document.
`GAP: client-side no-reload rule evaluation is a binding requirement ONLY via scenario EXPERIENCE lines — absent from every spec a build agent is told to read first [MINOR, systemic]`
Step 5–8 logic itself (both hidden with no Format; Talk↔Workshop toggles prereqs; Beginner→
Advanced toggles Assumed knowledge): expressible once FB-S3.2's BLOCKER is resolved; the
custom-trigger half works today. **Split verdict: custom OK / built-in inherits BLOCKER.**

### Step 9 — hidden-but-required must not block

The server validator must re-evaluate rules against the submitted values and skip `required`
for rule-hidden fields:
```ts
const visible = (ff) => !ff.questionRule || matches(ff.questionRule, submittedValues);
for (const ff of formFieldRows)
  if (ff.required && visible(ff) && isBlank(values[ff.fieldId])) errors[ff.fieldId] = "Required";
```
Two problems: (a) "required follows visibility" is specified ONLY by this scenario — no flow
or spec states it, and the naive implementation (validate all `required=1` rows) fails
exactly this defect hunt; (b) for THIS step the rule's trigger is the built-in Format, so
`matches()` needs the FB-S3.2 convention to read the submitted format at all.
`GAP: hidden-required semantics unstated outside the scenario [MINOR]` + inherits FB-S3.2 `[BLOCKER]`.

### Step 10 — visible-but-empty required blocks
Same validator, `visible=true` branch → inline error on "Workshop prerequisites". **OK**
(conditional on 3.2/3.9 resolutions).

---

## FB-S4 — Participant step: per-role min/max configured and enforced

### Step 1 — fresh-form default Speaker Min = 1

```ts
// schema.ts: roleSpeakerMin: integer("role_speaker_min").notNull().default(1)
```
The swyx foot-gun is dead at the schema layer. **OK** (special-attention item confirmed: the
per-role columns `role_speaker_min/max`, `allow_chairperson`, `role_chairperson_min/max`,
`allow_moderator`, `role_moderator_min/max` ALL exist on `forms`.)

### Step 2 — Min 5 / Max 4 rejected in the builder

```ts
const RoleConfig = insertFormSchema.pick({ roleSpeakerMin: true, roleSpeakerMax: true, allowChairperson: true, roleChairpersonMin: true, roleChairpersonMax: true, allowModerator: true, roleModeratorMin: true, roleModeratorMax: true })
  .refine(d => d.roleSpeakerMax == null || (d.roleSpeakerMin ?? 1) <= d.roleSpeakerMax, { message: "Minimum cannot exceed maximum", path: ["roleSpeakerMin"] });
// action returns fieldErrors → inline, nothing saved.
```
Route-level artifact, pattern-consistent (golden path refines drizzle-zod the same way). **OK**

### Step 3 — save the role config

```sql
UPDATE forms SET role_speaker_min = 1, role_speaker_max = 4,
  allow_chairperson = 1, role_chairperson_min = 0, role_chairperson_max = 1,
  allow_moderator = 0
WHERE id = :formId;
```
**OK**

### Step 4 — locked First/Last/Email; Biography required ON

First/Last/Email: hardcodable as always-required (they are `contacts.first_name/last_name/
email NOT NULL` — defensible without per-form state). Biography required-on-this-form is a
per-form override on a BUILT-IN participant field → same missing home as FB-S2.5
(`form_fields` has `section: "participant"` ready, but Biography has no `fields` row to place).
`GAP: participant built-in required toggles (Biography) have no home — forms.config workaround, contract undefined [MAJOR — same root as FB-S2.1]`

### Steps 5–6 — new submitter; limits communicated; no Moderator section

Signup: FB-S2.7 shape with theo.marchand@example.com / "Th3o!2027". Submission-step values
land as in FB-S5.4. Participant step reads the four `role_*` columns → renders
"1–4 Speakers allowed"; `allow_moderator = 0` → section not rendered. **OK**

### Steps 7–8 — 4 speakers OK, 5th blocked; 1 chairperson OK, 2nd blocked

```ts
// per added participant:
await db.batch([
  db.insert(contacts).values({ eventId, email: "speaker2@example.com", firstName: "…", lastName: "…" })
    .onConflictDoNothing({ target: [contacts.eventId, contacts.email] }), // unique(event_id, email)
  db.insert(participants).values({ submissionId, contactId, role: "speaker", position: 1 }),
]);
// server gate (client mirrors it by disabling the control):
const [{ n }] = await db.select({ n: count() }).from(participants)
  .where(and(eq(participants.submissionId, submissionId), eq(participants.role, "speaker")));
if (n >= form.roleSpeakerMax) return { formError: "Maximum 4 speakers." };
// chairperson: identical with role='chairperson' vs role_chairperson_max = 1.
```
**OK**

### Step 9 — back down to 1 speaker; Biography enforced

```sql
DELETE FROM participants WHERE submission_id = :sid AND contact_id IN (:s2,:s3,:s4);
-- advance allowed: count(speaker)=1 ≥ role_speaker_min(1).
```
Min check **OK**; Biography-required enforcement inherits the step-4 `[MAJOR]`.
EXPERIENCE (live "3 added" counter): client component state — no schema gap; binding caveat
as before.

---

## FB-S5 — Settings + notifications: close date, limit, success message, emails, closed state

### Step 1 — form settings

```sql
UPDATE forms SET
  close_at = 1809122340,          -- 2027-04-30T23:59 Europe/Paris (= 21:59:00Z)
  send_reminders = 1,
  submission_limit = 3,
  allow_multiple_drafts = 1,
  auto_redirect = 1,
  success_html = '<p>Merci! Your proposal is in — watch your inbox for the confirmation email and your speaker portal link.</p>'
WHERE id = :formId;
```
All columns exist. **OK** — note: converting the admin's wall-clock entry ("11:59 PM") to
epoch requires a tz utility keyed on `events.timezone`; none is specified (implementable,
no home named). MINOR-note only.

### Step 2 — notifications: confirmation ON, admin-notify pickers

```sql
UPDATE forms SET send_confirmation_email = 1,
  config = json('{"notify":{"newSubmission":["u_admin"],"updatedSubmission":["u_admin"]}}')
WHERE id = :formId;
```
`send_confirmation_email` **OK**. The admin-notify picker has a home only via the untyped
`forms.config` overflow — the shape above is invented here; the schema comment names the
feature ("admin-notify pickers") but defines no contract, so the builder-writing agent and
the submit-action agent (who must SEND to those recipients) have no shared key.
`GAP: admin-notify recipient storage shape undefined in forms.config [MINOR]`

### Step 3 — public banner: close date + "3 submissions per user"

Loader selects `close_at`, `submission_limit` from the `public_id` match → renders the banner
(copy per flow 02: "Form submissions will be accepted until …"). **OK**

### Step 4 — Marie's full submission

```ts
await db.batch([
  db.insert(submissions).values({ id: subId, eventId, formId, type: "abstract",
    title: "Postmortems people actually read", description: "<p>…two sentences…</p>",
    status: "pending", submitterId: marieUserId,
    formatId: talk30Id, levelId: intermediateLevelId, language: "English" }),
  db.insert(submissionTracks).values({ submissionId: subId, trackId: devExTrackId }),
  db.insert(submissionAnswers).values([
    { submissionId: subId, fieldId: keyTakeawayId, value: "Blameless or useless" },
    { submissionId: subId, fieldId: audienceLevelId, value: "Intermediate" },
  ]),
  db.insert(contacts).values({ id: marieContactId, eventId, userId: marieUserId, email: "marie.dupont@example.com", firstName: "Marie", lastName: "Dupont" }),
  db.insert(participants).values({ submissionId: subId, contactId: marieContactId, role: "speaker", isPrimary: true }),
]);
// submission-limit gate: SELECT COUNT(*) FROM submissions WHERE form_id=:formId AND submitter_id=:marie → must be < 3.
```
Every table/column exists; `status` is server-defaulted (never client-trusted). **OK**

### Step 5 — exact success message, then ~10s auto-redirect to Marie's portal

`success_html` renders verbatim; `auto_redirect=1` arms a client timer. The REDIRECT TARGET
is the hole: ROUTE-MAP's portal is `/portals/:eventSlug/:portalId` — and **no table mints or
resolves a `portalId`**. There is no `portals` table in schema.ts (`portal_forms` is a
different thing — forms inside the portal). Sessionboard's real bundle routes
(`/portals/:portalSlug/:portalId`, flow 02) were copied into ROUTE-MAP without the backing
entity. The artifact that would be needed: a `portals` row per event (or a documented
decision that `:portalId` IS the event id / a per-contact token).
`GAP: /portals/:eventSlug/:portalId has no portals table — the redirect URL (and every portal link) cannot be constructed from the schema [MAJOR]`

### Step 6 — the two outbox rows

```ts
const sender = getEmailSender(env); // no RESEND_API_KEY locally → D1 outbox adapter
await sender.send({
  to: "marie.dupont@example.com",
  subject: tpl.subject, html: renderTemplate(tpl.bodyHtml, { portalLink }),
  templateId: tpl.id, eventId, dedupeKey: `submission_confirmation:marie.dupont@example.com:${subId}`,
});
await sender.send({
  to: "admin@example.com",           // resolved from forms.config.notify.newSubmission
  subject: `New submission: Postmortems people actually read`, html: "…",
  eventId, dedupeKey: `admin_new_submission:admin@example.com:${subId}`,
});
```
```sql
-- verification oracle:
SELECT to_, subject, status FROM email_outbox WHERE to_ IN ('marie.dupont@example.com','admin@example.com') AND status='sent';
```
Port + outbox: **OK**. But `tpl` = `SELECT * FROM email_templates WHERE event_id = :newEventId
AND key = 'submission_confirmation'` → **zero rows**: templates are seeded only for `e_demo`,
and neither SCOPE, the (missing) create-event flow, nor any doc provisions the default
lifecycle templates for a newly created event.
`GAP: new events have no email templates and no mechanism copies/creates the defaults at event creation — the "must have" confirmation email for any non-seed event has no content source [MAJOR]`
The portal link inside the body inherits the step-5 `[MAJOR]`.

### Steps 7–8 — closed form, then restore

```sql
UPDATE forms SET close_at = 1767222000 WHERE id = :formId;  -- 2026-01-01T00:00+01:00 (past)
```
```ts
// public loader AND action both gate (POST must be rejected server-side, not just hidden):
const closed = form.closeAt !== null && form.closeAt.getTime() <= Date.now();
if (closed && request.method === "POST") throw data({ error: "closed" }, { status: 403 });
```
Closed-state page copy is ours to design (flow 01 §6: Sessionboard never documents it; flow
02 gives the banner string "Form submissions are no longer being accepted."). Restore:
`UPDATE forms SET close_at = 1809122340 …`. **OK**

---

## FB-S6 — Copy Link, Duplicate, Delete

### Step 1 — Copy Link

```
https://<host>/submit/devops-days-lyon-2027/<forms.public_id>
```
Built from `events.slug` + `forms.public_id` — both columns exist. **OK**

### Step 2 — cold logged-out render of the welcome screen

`submit.$eventSlug.$formId.tsx` is `// @public` (no auth in loader); heading + welcome_html
render. **OK mechanically — undermined by status semantics:** `forms.status` is
`draft|open|closed` defaulting to **'draft'**, FB-S1 never flipped it, and no doc says
whether the public route gates on it. Flow 01 says Sessionboard has "no separate open step",
yet the Forms-list tabs (All/Open/Closed) and the seed (`'open'`/`'closed'` rows) treat
status as meaningful. If any agent gates the public loader on `status = 'open'`, every FB
scenario's public link 404s on a form that was only ever saved; if nobody gates it,
`status` and `close_at` are two disagreeing sources of truth.
`GAP: forms.status lifecycle is undefined — who sets 'open', and whether the public route honors it, is stated nowhere [MAJOR]`

### Steps 3–4 — ⋯ menu; View Results; View Draft Submissions

Menu (Edit / View Results / View Draft Submissions / Duplicate / Delete) = client UI over
the list route; committed by SCOPE P0 #1. Queries:
```sql
SELECT * FROM submissions WHERE form_id = :formId AND status != 'draft' ORDER BY created_at DESC; -- View Results
SELECT * FROM submissions WHERE form_id = :formId AND status = 'draft';                            -- Drafts → empty state
```
**OK** — destination URL for both views is unassigned (no route/param named; workaround
`/admin/submissions?formId=…`). `GAP: View Results / View Draft Submissions URLs unassigned in ROUTE-MAP [MINOR]`

### Step 5 — Duplicate: fields AND rules carried, new public URL, 0 submissions

```ts
const src = await db.query.forms.findFirst({ where: eq(forms.id, formId), with: { formFields: true } });
const copyId = crypto.randomUUID();
await db.batch([
  db.insert(forms).values({
    ...src, id: copyId,
    publicId: undefined,                    // omit → $defaultFn mints a NEW uuid (unique satisfied)
    internalName: `Copy of ${src.internalName}`,
    status: "draft", createdAt: undefined, updatedAt: undefined,
  }),
  ...src.formFields.map(ff => db.insert(formFields).values({
    formId: copyId, fieldId: ff.fieldId, section: ff.section, position: ff.position,
    required: ff.required, locked: ff.locked,
    questionRule: ff.questionRule,          // fieldId points at SHARED library rows → still valid ✓
  })),
]);
-- submissions are NOT copied → 0 submissions; the FB-S3 custom rule survives verbatim
-- because fields are form-independent library rows. (The built-in Format rule only exists
-- if FB-S3.2's BLOCKER was fixed; whatever encoding fixes it must also survive this copy.)
```
**OK** — with the explicit conditions above (omit `id`/`publicId`; rules valid only because
triggers are shared `fields.id`s).

### Steps 6–7 — delete with confirm; cancel deletes nothing

Client dialog; only the confirmed POST runs:
```sql
DELETE FROM forms WHERE id = :copyId;
-- form_fields.form_id → ON DELETE CASCADE (placements go);
-- submissions.form_id → ON DELETE SET NULL (none exist on the copy; the ORIGINAL's rows
--   reference the original form id and are untouched — count unchanged ✓).
```
Delete semantics (special-attention item) check out: submissions are never destroyed by a
form delete; they orphan with `form_id = NULL` (deliberate — historical data outlives the
form). **OK** — one product note: an orphaned submission's "Source" column loses its form
name with no tombstone; acceptable, but nowhere decided. MINOR-note only.

### Steps 8–9 — dead link graceful; original still live

```ts
// public loader: no row for public_id → throw data(null, { status: 404 }) → route ErrorBoundary
// renders the designed dead-link page (pattern exists in admin.submissions.tsx / 403.tsx).
```
Original URL unchanged (`public_id` untouched by the copy/delete). **OK**
EXPERIENCE (list updates without manual refresh): RR7 action→revalidation gives it for free
on the same route — no gap.

---

## Gap summary (this file)

| Step | Gap | Severity |
|---|---|---|
| FB-S3.2 (+3.9, 3.5–8 built-in half) | `question_rule.fieldId` cannot reference the built-in Format dropdown — no convention, no trigger-picker source, no renderer/validator resolution | **BLOCKER** |
| FB-S2.1 / FB-S2.6 | Built-in fields have no `form_fields` rows: locked flags and cross-list ordering (Key takeaway between Description and Format) are unstorable | **BLOCKER** |
| (inherited) all scenarios | AE-S2.4 current-event mechanism missing (filed in walk 01) | **BLOCKER** |
| FB-S2.5 / FB-S4.4 | Per-form required overrides on built-ins (Track/Language/Biography) — only home is an uncontracted forms.config blob | MAJOR |
| FB-S5.5 (+5.6 link) | `/portals/:eventSlug/:portalId` has no portals table — portal URLs unconstructible | MAJOR |
| FB-S5.6 | New events get no email templates; no default-provisioning mechanism at event creation | MAJOR |
| FB-S6.2 | `forms.status` lifecycle (draft→open) undefined; public-route gating ambiguous | MAJOR |
| FB-S1.4 | 15-char heading cap encoded in no shared contract (schema/zod) — per-surface folklore | MINOR |
| FB-S3.4–8 | Client-side no-reload rule evaluation binding only via scenario EXPERIENCE lines | MINOR (systemic) |
| FB-S3.9 | Hidden-required-follows-visibility semantics stated only in the scenario | MINOR |
| FB-S3.3 | question-rule operator vocabulary undefined | MINOR |
| FB-S5.2 | Admin-notify recipient shape in forms.config undefined | MINOR |
| FB-S2.7 | `$formId` route param must resolve `forms.public_id`, documented nowhere | MINOR |
| FB-S2.4 | unique(formId,fieldId) blocks reusing one layout-element row twice on a form | MINOR |
| FB-S6.4 | View Results / Draft Submissions destination URLs unassigned | MINOR |

SCENARIO-ERRORs: none — FB-S1..S6 track SCOPE P0 #1 (7-step builder, ⋯ menu, Copy Link),
P1 #2 (question rules incl. dropdown triggers — Format IS a dropdown, so the built-in
trigger is in-scope, not invention), P1 #6 (admin-notify pickers), and the red-pen
annotations (success message + ~10s redirect "make sure this works", Close Date "kinda
impt", confirmation email "must have").

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Scope of this walk: verdicts are **tenancy-scoped** (the Wave A migration in
`docs/multi-tenancy-design.md` §Schema: `organizations` + `organization_members`,
`events.organizationId` NOT NULL, `api_tokens.organizationId` + nullable `eventId`,
`fields.scope` **dropped** for the organizationId/eventId XOR, seed mints `org_demo`).
Where a step's ORIGINAL verdict was a gap since resolved by the register fixes
(G2 current-event, G3 rule trigger union, G4 `formFields.builtinRef`, G6 `portals`,
G8 template provisioning), that resolution is noted so stale blockers aren't
re-asserted — but the verdict still answers only "did TENANCY change this step".

Stated once, inherited by every scenario below (the AE-S2.4 pattern):
- **Fixture dependency:** all FB scenarios run inside AE-S2's created event; `events.organizationId`
  is now NOT NULL, so AE-S2's create-event artifact must write the creator's org id. That
  artifact belongs to walk 01's re-walk; here it is an input, not re-filed.
- **Membership enforcement interim:** `getActiveEvent` (app/lib/auth.ts) still has NO
  membership check and falls back to `db.select().from(events).limit(1)` — covered: Wave B
  ("`getActiveEvent(env, user)` gains the membership check (event → org → member). **The
  any-event fallback is the hole Wave B exists to close** … first event across MY orgs, else
  null", design doc §Authorization + wave table row B). The admin guard's global-role check
  likewise: covered, Wave B. Interim exposure is nil in practice: signup ships in Wave C,
  after B, so the DB holds only `org_demo` while the holes are open (design doc §Build order).
- **Enabling detail every changed artifact uses:** `getActiveEvent` selects the full `events`
  row, so `activeEvent.organizationId` is already in hand at every admin loader/action — the
  org is never re-derived with a second query and never trusted from the client.

### FB-S1 step 1 — UNCHANGED
Forms list + create write only `forms.eventId`; forms carry no org column (org derived via
the event — design doc §Schema: "never stored where derivable"). Operating-as-member gate:
covered, Wave B (see preamble).

### FB-S1 step 2 — UNCHANGED
`forms.type` / `forms.participantsStep` — event-scoped columns, untouched by the migration.

### FB-S1 step 3 — UNCHANGED
`internal_name` / `external_title` — untouched columns.

### FB-S1 step 4 — UNCHANGED
Zod `.max(15)` on a `forms` column; no tenancy column in the contract. Prior
`[MINOR]` (cap is folklore) stands as filed.

### FB-S1 step 5 — UNCHANGED
`UPDATE forms SET page_heading …` — untouched column.

### FB-S1 step 6 — UNCHANGED
`welcome_html` / `show_welcome` — untouched columns.

### FB-S1 step 7 — UNCHANGED
Builder loader matches `forms.id` + row-level `eq(forms.eventId, activeEvent.id)` — the
row-level eventId rule predates tenancy and continues per design doc §Authorization
("Row-level eventId verification continues per the data-exposure matrix").

### FB-S1 step 8 — UNCHANGED
Re-render from the same row; no tenancy-bearing read.

### FB-S2 step 1 — UNCHANGED
Locked Title/Description now live as `form_fields` rows with `builtinRef` + `locked=1`
(original BLOCKER resolved by G4 — `formFields.builtinRef`, `unique(formId, builtinRef)`,
schema.ts). Builtin placement rows carry no org/event column → tenancy adds nothing.

### FB-S2 step 2 — CHANGED
The original artifact wrote `scope: "event"` — **that column no longer exists**. The Create
New Field dialog's scope choice now maps to the XOR (decided app-enforced, design doc
§Schema: "the `formFields.fieldId`/`builtinRef` precedent" — no CHECK constraint, by
recorded decision):

```ts
// admin.forms.$formId.tsx action — the scope radio never reaches the DB:
const cols = scope === "event"
  ? { eventId: activeEvent.id, organizationId: null }        // event field
  : { eventId: null, organizationId: activeEvent.organizationId }; // org-wide field
await db.batch([
  db.insert(fields).values({ id: keyTakeawayId, ...cols, name: "Key takeaway", type: "text", maxLength: 140 }),
  db.insert(formFields).values({ formId, fieldId: keyTakeawayId, section: "session", position: 2, required: true }),
]);
```
```sql
-- this step ("event scope") produces:
INSERT INTO fields (id, event_id, organization_id, name, type, max_length, created_at)
VALUES (:keyTakeawayId, :eventId, NULL, 'Key takeaway', 'text', 140, unixepoch());
-- the dialog's other option ("organization-wide", formerly "global") would produce:
--   (id, NULL, :activeEventOrgId, …)
```
Walk 01's dual-encoding `[MINOR]` (scope='global' vs eventId NULL disagreeing) is
**resolved by this migration** — one truth, the XOR. Seed precedent confirms
(`drizzle/seed.sql`: event fields insert `event_id` with no `organization_id`).

### FB-S2 step 3 — CHANGED
Same rewrite for "Audience level":
```sql
INSERT INTO fields (id, event_id, organization_id, name, type, options, created_at)
VALUES (:audienceLevelId, :eventId, NULL, 'Audience level', 'dropdown', '["Beginner","Intermediate","Advanced"]', unixepoch());
```
Placement row unchanged (`form_fields` has no tenancy column).

### FB-S2 step 4 — CHANGED
The picker's search is the query the scope-drop bites hardest. Old conceivable predicate
(`event_id = :eventId OR scope = 'global'`) is unwritable AND was a cross-tenant leak
(every org's "global" fields in every picker). New:

```sql
-- Add Question picker (search included):
SELECT id, name, type FROM fields
WHERE (event_id = :eventId
       OR (organization_id = :orgId AND event_id IS NULL))  -- :orgId = activeEvent.organizationId
  AND name LIKE '%' || :search || '%';
-- both branches indexed: fields_event_idx / fields_org_idx (schema.ts).
```
```ts
// and the action-side guard — the picked id must pass the SAME predicate (never trust the client;
// this is design doc §Verification's "org A's form builder sees only its own fields" denial test):
const [ok] = await db.select({ id: fields.id }).from(fields).where(and(
  eq(fields.id, pickedFieldId),
  or(eq(fields.eventId, activeEvent.id),
     and(eq(fields.organizationId, activeEvent.organizationId), isNull(fields.eventId))),
));
if (!ok) throw data({ error: "Unknown field" }, { status: 404 });
await db.insert(formFields).values({ formId, fieldId: pickedFieldId, section: "session", position: 6 });
```
"Earliest arrival date" (AE-S4, event-scoped → `event_id` set) matches the first branch. ✓
Prior `[MINOR]` (unique(formId,fieldId) vs layout reuse) unaffected.

### FB-S2 step 5 — UNCHANGED
Track/Language required toggles are `builtinRef` rows' `required` flag (G4 resolution of the
original MAJOR); builtin placements carry no tenancy column.

### FB-S2 step 6 — UNCHANGED
Cross-list order is `form_fields.position` over fieldId + builtinRef rows (G4); tenancy
touches neither.

### FB-S2 step 7 — UNCHANGED
Public URL and route untouched — design doc: "No URL changes: `/admin/*` stays; public
`$eventSlug` pages unchanged." Marie signs up `role: 'speaker'` — speakers are not org
members; the public submit path resolves no membership. Prior `$formId≠forms.id` `[MINOR]` stands.

### FB-S2 step 8 — UNCHANGED
Public render joins `form_fields → fields` **by id** — works identically for event- and
org-scoped fields; scoping was already resolved at placement time (step 4's guard).

### FB-S2 step 9 — UNCHANGED
Required-validation over `form_fields` rows; no tenancy read.

### FB-S3 step 1 — CHANGED
Same scope→XOR rewrite as FB-S2.2 for the two target fields:
```sql
INSERT INTO fields (id, event_id, organization_id, name, type, max_length, created_at) VALUES
 (:prereqId,  :eventId, NULL, 'Workshop prerequisites', 'textarea', 1000, unixepoch()),
 (:assumedId, :eventId, NULL, 'Assumed knowledge',      'text',     NULL, unixepoch());
```
Placements unchanged.

### FB-S3 step 2 — UNCHANGED
By tenancy. (Original BLOCKER resolved by G3: `QuestionRule.trigger =
{kind:'builtin',ref:'format'}` — the built-in Format trigger is now representable;
`trigger.ref` draws from `BUILTIN_FIELD`.) No org/event column participates in a rule.

### FB-S3 step 3 — GAP
The custom-trigger rule itself is untouched by tenancy; the current-schema artifact
(shape per G3's trigger union) is:
```sql
UPDATE form_fields SET question_rule =
  '{"trigger":{"kind":"field","fieldId":"<audienceLevelId>"},"operator":"equals","value":"Advanced"}'
WHERE form_id = :formId AND field_id = :assumedId;
```
Walking it against the live seed exposes a drift the Wave A seed edit did not fix:
`drizzle/seed.sql` still writes the PRE-G3 flat shape —
`'{"fieldId":"fld_experience","operator":"equals","value":"Experienced"}'` (row `ff_notes`)
— which does not parse as `QuestionRule` (`rule.trigger` is `undefined`): a renderer/validator
built against the type either crashes on `trigger.kind` or treats the seeded rule as dead,
on the **judged sandbox event's** Session CFP. One-line seed fix; seed.sql was touched by
Wave A (org backfill) without migrating this JSON, and no committed wave owns it.
`GAP: seed.sql ff_notes question_rule still uses the pre-G3 flat {"fieldId":…} shape — unparseable as QuestionRule.trigger; the demo form's conditional rule is dead data on the judged event [MAJOR]`
Prior `[MINOR]` (operator vocabulary undefined) stands.

### FB-S3 step 4 — UNCHANGED
Client-side rule evaluation on the public form; public path untenanted. Prior systemic
`[MINOR]` stands.

### FB-S3 step 5 — UNCHANGED
Both conditional fields hidden with no Format chosen — client state over rule JSON; no tenancy read.

### FB-S3 step 6 — UNCHANGED
Talk (30 min) keeps prereqs hidden — same mechanism.

### FB-S3 step 7 — UNCHANGED
Workshop↔Talk toggle — same mechanism (built-in trigger representable per G3).

### FB-S3 step 8 — UNCHANGED
Audience-level trigger toggle — same mechanism.

### FB-S3 step 9 — UNCHANGED
Server validator re-evaluates rules against submitted values; reads only form_fields +
submitted data. Prior `[MINOR]` (hidden-required semantics scenario-only) stands.

### FB-S3 step 10 — UNCHANGED
Visible-required branch of the same validator.

### FB-S4 step 1 — UNCHANGED
`roleSpeakerMin` default 1 — untouched `forms` column.

### FB-S4 step 2 — UNCHANGED
Zod refine over `forms` role columns — no tenancy input.

### FB-S4 step 3 — UNCHANGED
`UPDATE forms SET role_* …` — untouched columns.

### FB-S4 step 4 — UNCHANGED
Participant built-ins (Biography required) are `builtinRef` rows with
`section='participant'` (G4 resolution of the original MAJOR); no tenancy column.

### FB-S4 step 5 — UNCHANGED
Theo's signup + submission-step values — public speaker path, untenanted (as FB-S2.7).

### FB-S4 step 6 — UNCHANGED
Renders the four `role_*` columns — untouched.

### FB-S4 step 7 — UNCHANGED
`contacts` (event-scoped, `unique(event_id,email)`) + `participants` inserts and the count
gate — no table in this step gained a tenancy column.

### FB-S4 step 8 — UNCHANGED
Chairperson variant of step 7.

### FB-S4 step 9 — UNCHANGED
`DELETE FROM participants …` + min check — untouched tables.

### FB-S5 step 1 — UNCHANGED
`UPDATE forms SET close_at, send_reminders, submission_limit, allow_multiple_drafts,
auto_redirect, success_html …` — all untouched columns. Prior tz MINOR-note stands.

### FB-S5 step 2 — GAP
`send_confirmation_email` and the `forms.config.notify` storage shape: unchanged (prior
`[MINOR]` on the undefined config contract stands — recipients stored as user ids). What
tenancy CHANGES is the **picker's population**. The only pre-tenancy source — `SELECT …
FROM users WHERE role = 'admin'` — becomes, the day Wave C mints a second organization, a
cross-org member directory (names + emails of every other tenant's admins) inside the
Notifications step. The correct Wave-A-servable artifact:
```sql
-- Notifications-step loader — org members of the event's org, NOT users.role='admin':
SELECT u.id, u.name, u.email
FROM organization_members om
JOIN users u ON u.id = om.user_id
WHERE om.organization_id = :orgId   -- activeEvent.organizationId
ORDER BY u.name;
```
(Send-time resolution of stored ids should re-check membership the same way — a member
removed in Wave D must stop receiving notifications; same predicate, one JOIN.)
The schema serves this today, but the rule is stated nowhere binding: design doc
§Authorization names the switcher, admin guard, `getActiveEvent`, and API tokens — recipient
pickers appear in NO wave's scope, and flow 01 §9 just says "pick admin recipients". A build
agent satisfying every named spec ships the `users.role='admin'` leak.
`GAP: admin-recipient pickers (form Notifications; any pick-an-admin surface) have no post-tenancy population rule in any spec or wave — naive users.role='admin' source is a cross-org member-directory leak once Wave C ships; needs a one-line binding rule (recipients = organization_members of the event's org) [MAJOR]`

### FB-S5 step 3 — UNCHANGED
Public banner reads `close_at` / `submission_limit` via `public_id` — untenanted public path.

### FB-S5 step 4 — UNCHANGED
The submission batch writes `submissions` / `submission_tracks` / `submission_answers` /
`contacts` / `participants` — all event-scoped, none gained a tenancy column;
`submission_answers.field_id` references the same shared `fields` rows regardless of which
XOR side scopes them.

### FB-S5 step 5 — UNCHANGED
By tenancy. (Original MAJOR resolved by G6: `portals` table exists, event-scoped,
`publicId` seeded — redirect URL constructible as `/portals/:eventSlug/:portalPublicId`.)
Portals carry `eventId` only; org derived via event.

### FB-S5 step 6 — UNCHANGED
Outbox rows: `email_outbox.eventId` / `email_templates.eventId` — event-scoped, untouched.
(Original template-provisioning MAJOR resolved-by-spec per G8: `app/domain/createEvent.ts`
provisions defaults.) Recipient resolution inherits FB-S5.2's picker rule.

### FB-S5 step 7 — UNCHANGED
`close_at` gate in public loader+action — untenanted public path.

### FB-S5 step 8 — UNCHANGED
Restore `close_at` — untouched column.

### FB-S6 step 1 — UNCHANGED
URL = `events.slug` + `forms.public_id`; design doc keeps slugs one global namespace
(recorded trade-off), so the copied link's shape survives tenancy verbatim.

### FB-S6 step 2 — UNCHANGED
Public route stays auth-free and untenanted ("public `$eventSlug` pages unchanged").
(Original `forms.status` MAJOR resolved-by-spec per register: publish sets `open`, public
route reachable iff `open`, `closeAt` gates submission only.)

### FB-S6 step 3 — UNCHANGED
Client menu over the list route; list query scoped by `forms.eventId` as before.

### FB-S6 step 4 — UNCHANGED
Results/drafts queries filter `form_id` (+ pre-existing row-level event check). Prior
URL-unassigned `[MINOR]` stands.

### FB-S6 step 5 — UNCHANGED
Duplicate inserts a `forms` row with the SAME `eventId` → same event ⇒ same org, so every
copied `form_fields.fieldId` still satisfies the FB-S2.4 predicate (event fields: same
event; org-wide fields: same org). No tenancy re-validation needed on copy; `builtinRef`
placements and `trigger` rules copy verbatim (G3/G4 shapes are org-free).

### FB-S6 step 6 — UNCHANGED
`DELETE FROM forms` + cascades — no tenancy-bearing table in the cascade path changed
semantics (`fields` rows are NOT cascaded by a form delete on either XOR side; only
placements go).

### FB-S6 step 7 — UNCHANGED
Original's submissions reference the original form id — untouched logic.

### FB-S6 step 8 — UNCHANGED
404 ErrorBoundary on missing `public_id` — untenanted public path.

### FB-S6 step 9 — UNCHANGED
`public_id` untouched by copy/delete — as originally walked.

### Re-walk gap summary (tenancy gate only)

| Step | Gap | Severity |
|---|---|---|
| FB-S5.2 | Admin-recipient picker population rule absent post-tenancy — `users.role='admin'` source becomes a cross-org member-directory leak at Wave C; binding rule needed: recipients = `organization_members` of the event's org | MAJOR |
| FB-S3.3 | `seed.sql` `ff_notes.question_rule` still pre-G3 flat shape — unparseable as `QuestionRule.trigger`; demo form's conditional rule is dead data on the judged event; untouched by Wave A's seed edit | MAJOR |

53 steps walked: 4 CHANGED (FB-S2.2/2.3/2.4, FB-S3.1 — all the `fields.scope`→XOR rewrite
plus the picker/guard predicate), 47 UNCHANGED (determinations recorded per step), 2 GAP.
Wave-B/C/D reliances cited inline are all explicitly covered by the design doc — none
re-filed as gaps. Resolved-by-migration: walk 01's dual-encoding `[MINOR]` (scope vs
eventId NULL) dies with the enum. All pre-existing gaps in the 2026-08-09 summary table
either stand as filed (MINORs, `forms.config` contract) or were resolved by G2/G3/G4/G6/G8
before this gate — none newly invalidated by tenancy.

## 2026-08-11 re-walk — calendar revision ledger and provider send claims (design-time gate)

**Gate trigger.** This file's `touches:` names `emailOutbox` and `ports: [EmailSender]`, and the branch
changes `app/db/schema.ts` and `app/ports/email.ts`. All 53 steps are walked below — none pre-filtered.

Shared structural findings **S1** (purely additive schema delta), **S2** (unchanged port shape, optional
`onInFlight` defaulting to main's behavior) and **S3** (new adapter behavior needs a `dedupeKey` collision)
are stated in full in `01-auth-event-setup.walk.md` §"2026-08-11 re-walk" and cited by tag here.

### FB-S1 — start a form (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Form create writes `forms`; no touched table (S1). |
| 2 | UNCHANGED | Submission-type choice + Participants toggle live in `forms.config`. |
| 3 | UNCHANGED | Internal/external name fields. |
| 4 | UNCHANGED | 15-char page-heading cap is client + server validation on `forms`. |
| 5 | UNCHANGED | Heading set to a legal value. |
| 6 | UNCHANGED | Rich-text welcome message; the shared editor was consolidated on `main` before this branch and is not touched here. |
| 7 | UNCHANGED | Save → leave → re-open. |
| 8 | UNCHANGED | Persistence of type/heading/title/formatting. |

### FB-S2 — session information step (9 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Locked Title/Description rows read `formFields`. |
| 2 | UNCHANGED | Create-new-field "Key takeaway". |
| 3 | UNCHANGED | Create-new-field "Audience level" (Dropdown). |
| 4 | UNCHANGED | Library reuse via picker search. |
| 5 | UNCHANGED | Per-field required toggles. |
| 6 | UNCHANGED | Drag reorder + persistence. |
| 7 | UNCHANGED | Public link, logged-out signup as marie.dupont. Signup sends no email on this path. |
| 8 | UNCHANGED | Public render order/required/options/date input. |
| 9 | UNCHANGED | Inline required error preserves typed values. |

### FB-S3 — conditional rules (10 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Two target fields added to `fields`/`formFields`. |
| 2 | UNCHANGED | Built-in Format trigger rule. |
| 3 | UNCHANGED | Custom-dropdown trigger rule. |
| 4 | UNCHANGED | Save, logged-out open, login. |
| 5 | UNCHANGED | Both targets absent with no Format chosen — client-side rule evaluation. |
| 6 | UNCHANGED | Talk keeps the workshop field hidden. |
| 7 | UNCHANGED | Workshop shows it; toggling back hides it. |
| 8 | UNCHANGED | Audience-level trigger. |
| 9 | UNCHANGED | Hidden-but-required must not block — server-side rule-aware validation, untouched. |
| 10 | UNCHANGED | Visible-and-empty must block. |

### FB-S4 — participant step (9 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Default Speaker minimum is 1; `forms.config` only. |
| 2 | UNCHANGED | Inverted Min/Max rejected in the builder. |
| 3 | UNCHANGED | Save role limits. |
| 4 | UNCHANGED | Locked participant fields + Biography required. |
| 5 | UNCHANGED | New submitter theo.marchand fills the submission step. |
| 6 | UNCHANGED | Limits communicated; no Moderator section. |
| 7 | UNCHANGED | 4-speaker cap enforced. |
| 8 | UNCHANGED | 1-chairperson cap enforced. |
| 9 | UNCHANGED | Removing back to 1 speaker allowed; Biography enforced. |

### FB-S5 — settings + notifications (8 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Close date, reminder toggle, limit 3, drafts, redirect toggle, success message — all `forms`. |
| 2 | UNCHANGED | Notification recipient config writes `forms.config`; the port is not called at config time. |
| 3 | UNCHANGED | Public banner shows close date + limit. |
| 4 | UNCHANGED | Full submission writes `submissions`/`submissionAnswers`/`participants`. |
| 5 | UNCHANGED | Custom success message + ~10s auto-redirect. |
| 6 | **CHANGED — same oracle, wider durable record.** | Both sends (submitter confirmation, admin notification) route through `app/ports/email.ts:send`. The oracle is unchanged: two `email_outbox` rows, one addressed to marie.dupont with a working portal link, one to ADMIN_EMAIL naming the submission. Their rows now also carry `send_claim_id`/`send_claim_expires_at` (S1), NULL after a completed send. Neither call site passes `onInFlight`, so a double-submitted form still yields `{ deduped: true }` exactly as on `origin/main` (S2, S3). These sends carry no `ics`, so no `calendar_invite_revisions` row is written and no sequence frontier moves. |
| 7 | UNCHANGED | Closed-form state is a `forms.closeAt` comparison. |
| 8 | UNCHANGED | Restoring the close date reopens the form. |

### FB-S6 — publish and manage (9 steps)

| Step | Verdict | Evidence |
|---|---|---|
| 1 | UNCHANGED | Copy Link reads `forms.publicId`. |
| 2 | UNCHANGED | Logged-out welcome screen render. |
| 3 | UNCHANGED | ⋯ menu contents. |
| 4 | UNCHANGED | View Results / View Draft Submissions incl. designed empty state. |
| 5 | UNCHANGED | Duplicate carries fields + rules, new public URL. |
| 6 | UNCHANGED | Cancel-then-confirm delete dialog (in-app dialog, not native confirm). |
| 7 | UNCHANGED | Duplicate gone, original intact. |
| 8 | UNCHANGED | Deleted form's public URL → graceful not-found. |
| 9 | UNCHANGED | Original public URL still works. |

### Re-walk verdict

**53/53 steps re-walked. 1 CHANGED (FB-S5.6, durability only — same observable outcome), 52 UNCHANGED,
0 BLOCKER, 0 MAJOR.** No `touches:` update required.
