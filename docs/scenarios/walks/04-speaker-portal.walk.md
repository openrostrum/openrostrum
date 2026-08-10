# WALK — 04-speaker-portal.yaml (design-side, pre-swarm)

Walked 2026-08-09 against: `app/db/schema.ts`, `app/lib/auth.ts`, `app/ports/{email,clock}.ts`,
`app/routes/*` + `docs/ROUTE-MAP.md`, `docs/rules/tech-stack.md` (R2/upload rules), `SCOPE.md`,
`drizzle/seed.sql`, `wrangler.json` (R2 binding `BLOBS`), `docs/flows/02`, `docs/flows/07`,
`docs/flows/09` (exposure rules e/o/cc + §5 server-side mandates).

Portal route grant (ROUTE-MAP): `portals.$eventSlug.$portalId.tsx` (+ `home/submissions/profile/tasks`)
→ `/portals/:eventSlug/:portalId/*`. Note immediately: the grant lists **no `files` child** and no
forgot-password routes exist anywhere in the map — both are committed P1 features walked below.

## Verdict up front — ranked gaps in this file

| # | Step(s) | Gap | Severity |
|---|---|---|---|
| H1 | all portal URLs (SP-S1.1, S1.9, S3.8…) | `:portalId` **has no home** — no `portals` table, no column holding a portal uuid. Every portal deep link, the SP-S1.9 recorded detail URL, and walk-03's PORTAL_URL depend on an undocumented convention. (Same finding as walk 03 G1 — counted once across the suite.) | **MAJOR** (borders BLOCKER: portal builder + CFP builder + email builder must independently invent the same value) |
| H2 | SP-S3.3 | **Co-speaker with no user account has no path into the portal.** `contacts.userId` is nullable (Dana: NULL), but `password_resets.user_id` is `NOT NULL REFERENCES users` — you cannot invite/reset someone into existence. No design artifact mints Dana's `users` row, links `contacts.user_id`, or sends the "you were added" email (no seeded template key for it either). The scenario's "she sets the password and logs in" is mechanism-less. | **MAJOR** |
| H3 | SP-S2.4/7/10, SP-S7.4–5 | **R2 upload/download mechanics unresolved.** (a) tech-stack mandates browser→R2 presigned PUT, but presigned URLs need S3 credentials that exist nowhere in `Env` and don't target the per-worktree Miniflare store — the mandated flow is unservable locally; no storage wrapper module is named/assigned. (b) **No route anywhere serves R2 bytes**: headshot display, file download, and SP-S7.5's authenticated-download denial all need a resource route that is in no ROUTE-MAP row. (c) With a direct-to-R2 PUT the Worker never sees the body, so SP-S2.7's 12 MB/.bmp rejection has no stated server-side enforcement point. | **MAJOR** |
| H4 | SP-S7.1–3 | **"Organizer shared this with the portal" is not expressible in `files`.** Candidate convention (`submission_id IS NULL AND contact_id IS NULL AND task_assignment_id IS NULL`) is undocumented and unsafe (any unattached admin upload would leak to every speaker); `FILE_KIND` has no `shared` kind and there is no visibility flag. Also homeless: the portal **Files tab route** (not in the route grant) and the **admin upload/share surface** (portals-admin row lists portals/portal-forms/file-requests only). SCOPE P1 #3 claims "`files` table already models it" — it does not, distinguishably. | **MAJOR** |
| H5 | SP-S8 (all) | **Forgot-password routes are homeless.** `password_resets` table is complete (token unique, expires_at, used_at) but ROUTE-MAP assigns no `/forgot`/`/reset/:token` files, and P1 #12 is committed. Sub-gaps: token TTL unstated; password policy (S8.5 "rejected against the password rules") defined nowhere; whether existing `auth_sessions` are revoked on reset unstated. | **MAJOR** (routes) + MINOR (TTL/policy/revocation) |
| H6 | SP-S2.9 | **No admin surface for a contact record.** ROUTE-MAP has no admin contacts/speakers route; "open Priya's contact record" is servable only through the participants panel of `admin.submissions.$id.tsx` (workaround-only). | **MAJOR** |
| H7 | SP-S1.5–8 | Queue masking IS stated server-side (flow 09 rule e + §5 mandate) — but **no shared serializer module is assigned** (`app/domain/accept.ts` got a file; the portal projection didn't). Four portal routes can each re-implement (or forget) the map. | MINOR |
| H8 | SP-S1.4, S3.5, S5.3… | **No shared portal-identity helper.** Every portal loader/action must resolve `getUser → contacts (user_id, event_id)`; P2 #6 already presumes "the shared portal auth helper" — nothing defines or places it (e.g. `requirePortalContact(env, request, eventSlug)`). | MINOR |
| H9 | SP-S6.2 | **Auto-provisioned task due dates have no source.** `task_assignments.due_at` exists, but `tasks` carries no due-offset/default-due column and the accept spine's contract doesn't state one — SP-S6.2 expects visible due dates. | MINOR |
| H10 | SP-S6.4/6 | `portal_forms.schema` element type is `{name, type, required}` — **no `options` member**, so the hotel form's "Room Preference: King" dropdown cannot be declared per the stated shape (JSON is extensible; the declared contract is wrong). Seeded hotel form also lacks Check-out/Room Preference/Special Requests fields. | MINOR |
| H11 | SP-S1.9, SP-S6.1 | **Accept-spine idempotency unstated**: `task_assignments` has no unique(task_id, contact_id, submission_id); re-accept after a status bounce double-assigns the onboarding set. | MINOR |
| H12 | SP-S5.5 | Per-person "Withdrawn" maps to `participants.acceptance_status='declined'` (enum has no `withdrawn`), while a *separate* submission-level withdrawal exists (`submissions.withdrawn_at/by/reason`). Two withdrawal concepts, unreconciled labels. | MINOR |
| H13 | SP-S8.6–8 | `login.tsx` defaults are admin-shaped: loader bounces authenticated users to `/admin` and `safeRedirect` falls back to `/admin` → a speaker landing on `/login` without `redirectTo` ends at `/403`. Every portal-bound flow must thread `redirectTo`; nothing says so. | MINOR |
| H14 | fixtures | Scale fixture (300 submissions / Alex Rivera ×8), Marcus Chen, "Announce your participation" optional task, and the SP-S6 hotel-form field set are all absent from `drizzle/seed.sql`. | MINOR |

SCENARIO-ERRORS: **none found.** Tier check: queue masking = P0 #4 (explicit); profile/bio/headshot = P0 #3 + P1 #3; portal Files = P1 #3 (committed); per-person Confirm/Withdraw = P1 #11; forgot password = P1 #12; secondary-contact fixture = P1 #13; tasks/portal forms = P0 #7. SP-S4's scale bar is the NORTH STAR lens, not an invention.

---

## SP-S1 — login gate, zero leak, pills, queue masking

### Step 1 — logged-out PORTAL_URL renders a gate
Layout route `portals.$eventSlug.$portalId.tsx` loader:

```ts
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(env, request);   // no user → throw redirect(`/login?redirectTo=${pathname}`)
  // …only AFTER auth does any event/submission query run
}
```
`requireUser` (auth.ts ~186) throws the redirect **before** any data query → the gate is `/login`.
**OK** for the gate itself; **GAP (H1, MAJOR)** for what `:portalId` even is — no table backs it (schema has `portal_forms`, not `portals`); the recorded PORTAL_URL from CFP-S1 cannot be minted on paper.

### Step 2 — zero pre-auth data
`login.tsx` renders static markup only (no loader data beyond `{}`); the portal loader above queries nothing pre-auth. Response-body grep for "Evals in Production" / "priya@example.com" hits nothing because no query has run. SSR redirect (302) = no flash of authenticated content. **OK**

### Step 3 — password-manager-friendly login form
Required DOM:

```html
<input name="email" type="email" autocomplete="username" />
<input name="password" type="password" autocomplete="current-password" />
```
**GAP (walk-03 G9, MINOR — shared):** `login.tsx`, the designated reference, carries neither `autocomplete` attribute today.

### Step 4 — login → portal Home
`login.tsx` action verifies + `createSession` → `redirect(safeRedirect(redirectTo))` with `redirectTo=/portals/ai-engineer-sandbox/<portalId>/home` from step 1's gate. Works **only** because the gate supplied `redirectTo` (see H13). **OK**

### Step 5 — Home: submissions card, profile card, tasks panel
Identity resolution (the helper H8 says should be shared):

```ts
const [contact] = await db.select().from(contacts)
  .where(and(eq(contacts.userId, user.id), eq(contacts.eventId, event.id))).limit(1);
// indexes: contacts_user_idx, contacts_event_idx
```

My Submissions (scoped via participants, NOT submitter_id — a co-speaker isn't the submitter):

```ts
const rows = await db.select({
    id: submissions.id, title: submissions.title,
    status: submissions.status, format: formats.name,
  })
  .from(participants)
  .innerJoin(submissions, eq(submissions.id, participants.submissionId))
  .leftJoin(formats, eq(formats.id, submissions.formatId))
  .where(eq(participants.contactId, contact.id))          // participants_contact_idx
  .orderBy(desc(submissions.createdAt));
```

Wait — Priya's draft "Async Agents on the Edge" has **no participants row** (draft saved before the
Participant step, CFP-S4.2). The card must therefore be the UNION of participant-linked rows and own
drafts:

```sql
SELECT s.id, s.title, s.status FROM submissions s
JOIN participants p ON p.submission_id = s.id
JOIN contacts c ON c.id = p.contact_id
WHERE c.user_id = :priyaUserId AND c.event_id = 'e_demo'
UNION
SELECT s.id, s.title, s.status FROM submissions s
WHERE s.submitter_id = :priyaUserId AND s.status = 'draft';
```
This union rule is derivable but unstated — folded into H8 (the shared portal scoping helper is where
it must live once, not four times). Profile card: `contacts.first_name/last_name/email` → initials "PR".
Tasks panel empty state: `task_assignments` join below (SP-S6.2) returns 0 rows for Priya pre-accept. **OK (H8 noted)**

### Steps 6–8 — admin queues; pill stays "Pending"; grep-clean HTML
Admin action: `UPDATE submissions SET status='accept_queue', status_changed_at=unixepoch() WHERE id=:evalsId;`
(then `'decline_queue'`). Portal projection — the server-side map mandated by flow 09 §3(e)/§5:

```ts
// app/domain/portal.ts — MODULE NOT ASSIGNED ANYWHERE (GAP H7)
export const PORTAL_STATUS_LABEL = {
  draft: "Draft",
  pending: "Pending",
  accept_queue: "Pending",     // masked — raw enum must never serialize to the portal
  decline_queue: "Pending",    // masked
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
} as const satisfies Record<(typeof SUBMISSION_STATUS)[number], string>;

return { submissions: rows.map((r) => ({ ...r, status: PORTAL_STATUS_LABEL[r.status] })) };
```
Because the loader returns the LABEL, the rendered HTML cannot contain "accept_queue"/"Accept Queue"/"queue" — the grep signal holds by construction. **OK on the rule (stated in 09 §5); GAP (H7, MINOR)** — no shared module/file owns it, so each of home/submissions/tasks(+detail) routes can diverge.

### Step 9 — final Accepted → green pill; record detail URL; auto-provision
`UPDATE submissions SET status='accepted', status_changed_at=unixepoch() WHERE id=:evalsId;` — and the
route action calls the integration-owned spine, per CLAUDE.md wave 2:

```ts
await acceptSubmission(db, { submissionId: evalsId });   // app/domain/accept.ts (mandated file)
```
Detail URL recorded: `/portals/ai-engineer-sandbox/<portalId>/submissions/<evalsId>` (child of the
`submissions` grant). **OK** — modulo H1 (`<portalId>`) and H11 (accept idempotency on re-accept).

Scale signal: Home queries are `contact_id`-anchored (`participants_contact_idx`) — 8-row fan-out, not
a 300-row scan. **OK**

---

## SP-S2 — bio, headshot, links: persist, round-trip, admin-visible

### Steps 1–3, 5 — profile fields
Route `portals.$eventSlug.$portalId.profile.tsx` (in the grant). Action:

```ts
const user = await requireUser(env, request);            // actions self-authenticate
const [contact] = await db.select().from(contacts)
  .where(and(eq(contacts.userId, user.id), eq(contacts.eventId, event.id))).limit(1);

const ProfileUpdate = insertContactSchema
  .pick({ bio: true, jobTitle: true, companyName: true, linkedinUrl: true, twitterUrl: true, websiteUrl: true })
  .extend({
    bio: z.string().max(5000).optional(),                              // the 0/5,000 counter's server truth
    websiteUrl: z.union([z.string().url("Enter a valid URL"), z.literal("")]).optional(),
    linkedinUrl: z.union([z.string().url(), z.literal("")]).optional(),
    twitterUrl: z.union([z.string().url(), z.literal("")]).optional(),
  });
const parsed = ProfileUpdate.safeParse(Object.fromEntries(form));
if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };  // step 6: junk not saved
await db.update(contacts).set(parsed.data).where(eq(contacts.id, contact.id));          // ownership via the lookup
```

Columns all exist: `bio`, `job_title`, `company_name`, `linkedin_url`, `twitter_url`, `website_url`.
Bold + bullet list = HTML in `bio` (shared `<RichText/>`, tech-stack). **OK** (X URL lands on
`twitter_url` — naming only).

### Step 4 — headshot upload → preview
The tech-stack-mandated flow, written out:

```
1. POST profile action  { intent: "headshot-presign", fileName: "headshot-priya.png",
                          contentType: "image/png", sizeBytes: 245760 }
   → Worker mints presigned PUT for r2Key = `headshots/e_demo/${contact.id}.png`
2. Browser: PUT <presignedUrl> (body = file bytes)      → bucket openrostrum-files (binding BLOBS)
3. POST profile action  { intent: "headshot-commit" }
   → UPDATE contacts SET headshot_key = 'headshots/e_demo/c_priya.png' WHERE id = 'c_priya';
```

**GAP (H3, MAJOR):** step 1 cannot be built as designed — R2 presigned URLs are S3-API only and need
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/account id, none of which exist in `Env`
(`worker-env.d.ts`: RESEND/TURNSTILE/AIRTABLE only), and a presigned S3 URL bypasses the per-worktree
Miniflare store entirely, so the local instance (the verification substrate) can't run the mandated
flow. The alternative (small-file PUT through the Worker action → `env.BLOBS.put(r2Key, body)`) is
fine for ≤5 MB headshots but *contradicts the written platform rule* — the design must pick one and
say so. Display `<img src>` needs a byte-serving route — none is assigned (H3b, walked at step 8).

### Step 6 — bad URL rejected inline
Covered by `ProfileUpdate` above — parse failure returns field errors before any write. **OK**

### Step 7 — 12 MB .bmp rejected, previous preview survives
Server-side enforcement point:

```ts
if (!["image/png", "image/jpeg"].includes(contentType) || sizeBytes > 5 * 1024 * 1024)
  return { fieldErrors: { headshot: ["Use a PNG or JPEG up to 5 MB."] } };
```
…which only exists if the upload passes through the Worker (or a presign step that R2 cannot itself
enforce on PUT). With browser→R2 presigned PUT, nothing stops the browser from PUTting 12 MB of BMP at
the signed URL. **GAP (H3c, MAJOR — same H3 root):** the rejection has no enforceable server home under
the mandated flow. "Previous preview survives" = `headshot_key` only changes in the commit step — OK.

### Step 8 — save feedback + hard reload persistence
Reload runs the profile loader → same `contacts` row → values round-trip. Headshot render:

```ts
// portals.$eventSlug.$portalId.headshot.$contactId.tsx — IN NO ROUTE-MAP ROW (GAP H3b)
const obj = await env.BLOBS.get(contact.headshotKey);
return new Response(obj.body, { headers: { "Content-Type": "image/png" } });
```
**GAP (H3b, MAJOR — same H3 root):** no assigned route serves R2 objects; ROUTE-MAP's rule is "add the
row on the integration branch first", and no row exists for any file/headshot bytes URL.

### Step 9 — admin sees the same bio/headshot/links
```sql
SELECT bio, job_title, company_name, headshot_key, linkedin_url, twitter_url, website_url
FROM contacts WHERE event_id = 'e_demo' AND email = 'priya@example.com';
```
One row — same row the portal edited; nothing to sync. **GAP (H6, MAJOR):** no admin route displays a
contact record. ROUTE-MAP end-to-end: dashboard, submissions, forms, evaluation, agenda, tasks, emails,
settings, portals-admin — no contacts/speakers screen. Workaround: the participants panel on
`admin.submissions.$id.tsx` (assigned, wave 1) shows the participant's contact fields. Workaround-only → MAJOR.

### Step 10 — checksum round-trip
`wrangler r2 object get openrostrum-files/headshots/e_demo/c_priya.png --local` (or the H3b route) →
`shasum -a 256` equals the source file. R2 stores bytes verbatim — the assertion is sound **once H3 is
resolved**. **OK-conditional.**

---

## SP-S3 — one human, two submissions, one profile; authorization probes

### Step 1 — Marcus adds Dana (same email) to a new submission
Reuses walk-03 CFP-S5.9's contact-resolution artifact; the lookup finds Dana's existing row:

```sql
SELECT id FROM contacts WHERE event_id = 'e_demo' AND email = 'dana.okafor@example.com'; -- hit → reuse id
INSERT INTO participants (id, submission_id, contact_id, role, is_primary, position, created_at)
VALUES (:pid, :guardrailsSubId, :danaContactId, 'speaker', 0, 1, unixepoch());
```
`contacts_event_email_uq` makes duplicate-Dana structurally impossible *if* the insert path
upserts-by-email — the constraint exists; the upsert is walked in 03. **OK**

### Step 2 — DB probe
```sql
SELECT COUNT(*) FROM contacts WHERE event_id='e_demo' AND email='dana.okafor@example.com';  -- 1
SELECT p.submission_id, p.contact_id FROM participants p
JOIN contacts c ON c.id = p.contact_id WHERE c.email='dana.okafor@example.com';             -- 2 rows, same contact_id
```
**OK**

### Step 3 — Dana's first portal entry: set password, log in
What the schema offers: `contacts.user_id IS NULL` for Dana; `users` requires `password_hash NOT NULL`;
`password_resets.user_id NOT NULL REFERENCES users` — a reset token cannot exist before the user does.
The needed sequence, which NO design artifact owns:

```ts
// (a) somewhere: mint the account + link the contact + invite — WHO/WHEN/WHERE?
const [danaUser] = await db.insert(users).values({
  email: "dana.okafor@example.com",
  passwordHash: await hashPassword(crypto.randomUUID()),   // unusable placeholder
  name: "Dana Okafor", role: "speaker",
}).returning();
await db.update(contacts).set({ userId: danaUser.id })
  .where(and(eq(contacts.eventId, "e_demo"), eq(contacts.email, "dana.okafor@example.com")));
await db.insert(passwordResets).values({ userId: danaUser.id, token, expiresAt });
await getEmailSender(env).send({ to: "dana.okafor@example.com",
  subject: "You've been added to a submission",            // no such template key is seeded
  html: `… /reset/${token} …`,
  dedupeKey: `participant_added:${guardrailsSubId}:dana.okafor@example.com` });
```

**GAP (H2, MAJOR):** none of (a)'s three candidate owners is designated — the CFP submit action
(mint-on-add), the accept spine, or a portal-gate "first time? set a password" branch (which would
instead mint the user at login and back-link `contacts.user_id` by email match:
`UPDATE contacts SET user_id=:newId WHERE event_id=:e AND email=:email AND user_id IS NULL;`).
The scenario's own hedge ("via the notification …or the portal link") shows the ambiguity. Until an
owner is named, a `user_id IS NULL` contact — every co-speaker — can never log in, and acceptance
tasks assigned to them (P0 #7) are unreachable.

### Step 4 — both sessions listed
SP-S1.5's participant-scoped query with `contact.userId = danaUser.id` → "Agents in Production…" +
"Guardrails Roundtable". Flow-09 rule cc (all statuses show). **OK (post-H2)**

### Step 5 — exactly one profile; bio save
Same artifact as SP-S2.1–3: one `contacts` row ⇒ one Profile tab. `UPDATE contacts SET bio='Dana Okafor builds agent tooling at Ferrostar.' WHERE id=:danaContactId;` **OK**

### Step 6 — admin sees one bio everywhere
Participants panel of each submission joins `participants → contacts` → same row → same bio on both,
and on the contact record (H6's workaround surface). **OK (H6 noted)**

### Step 7 — listings scoped: no trace of Priya's items
Dana's list query is anchored on HER `contact_id` / `user_id` — Priya's "Evals…" (participant: Priya
only) and draft (submitter: Priya) can't join in. Tasks tab likewise anchors on
`task_assignments.contact_id = :danaContactId` (`task_assignments_contact_status_idx`). Scoping is in
the WHERE clause, not a client filter — per flow 09 §5. **OK**

### Step 8 — direct-URL probe on Priya's detail page
`portals.$eventSlug.$portalId.submissions.$submissionId.tsx` loader — ownership join, 404 on miss:

```ts
const rows = await db.select({ id: submissions.id, title: submissions.title, status: submissions.status })
  .from(submissions)
  .innerJoin(participants, eq(participants.submissionId, submissions.id))
  .innerJoin(contacts, eq(contacts.id, participants.contactId))
  .where(and(
    eq(submissions.id, params.submissionId),
    eq(contacts.userId, user.id),               // ← the enforcement line
    eq(contacts.eventId, event.id),
  )).limit(1);
if (rows.length === 0) throw data(null, { status: 404 });  // ErrorBoundary renders generic copy, no title
```
Response body contains no foreign data because the loader threw before selecting any. **OK on the
artifact; GAP (H8, MINOR)** — this join must be hand-repeated in every portal child (detail, tasks,
confirm action…); the design names no shared `requirePortalContact`/`requireOwnedSubmission` helper,
though P2 #6 already assumes one exists.

---

## SP-S4 — submissions search at 300+ scale

### Steps 1–3 — scoped list, 8 rows, <1s
Fixture: not in seed (H14). The list query = SP-S1.5's participant join for Alex:

```sql
SELECT s.id, s.title, s.status
FROM participants p
JOIN contacts c ON c.id = p.contact_id
JOIN submissions s ON s.id = p.submission_id
WHERE c.user_id = :alexUserId AND c.event_id = 'e_demo'
ORDER BY s.created_at DESC;
-- plan: contacts_user_idx → participants_contact_idx (8 rows) → submissions PK. Never touches the other ~292.
```
**OK**

### Steps 4–6 — as-you-type filter, clear, designed empty state
8 rows are already in the loader payload → client-side substring filter (`title.toLowerCase().includes("rag")`)
is instant, no reload, no refetch; empty-state copy is a component branch on `filtered.length === 0`.
At a speaker's realistic fan-out (≤ dozens) client filtering is the right call; no server search
endpoint needed. **OK**

### Step 7 — detail shows title, status, co-speakers
```sql
SELECT c.first_name, c.last_name, p.role
FROM participants p JOIN contacts c ON c.id = p.contact_id
WHERE p.submission_id = :ragAtTheEdgeId ORDER BY p.position;
```
Own-session co-speaker names = rule "P-own participants: R" (flow 09 §2.1). Status via
`PORTAL_STATUS_LABEL`. **OK**

---

## SP-S5 — per-person Confirm / Withdraw

### Step 1 — admin accepts the panel
`UPDATE submissions SET status='accepted', status_changed_at=unixepoch() WHERE id=:panelSubId;` +
`acceptSubmission(...)` spine call (assigns tasks to BOTH speaker contacts — Dana included, whose
portal reachability is H2). **OK (H2, H11 noted)**

### Steps 2–3 — Priya confirms HER participation
Controls render only when `submission.status === 'accepted'` (loader ships the flag). Action:

```ts
const user = await requireUser(env, request);
const [row] = await db.select({ pid: participants.id, subStatus: submissions.status })
  .from(participants)
  .innerJoin(contacts, eq(contacts.id, participants.contactId))
  .innerJoin(submissions, eq(submissions.id, participants.submissionId))
  .where(and(
    eq(participants.id, String(form.get("participantId"))),
    eq(contacts.userId, user.id),                       // she can only ever act on HER row
  )).limit(1);
if (!row) throw data(null, { status: 404 });
if (row.subStatus !== "accepted")
  return { formError: "Confirmation is only available on accepted sessions." };
await db.update(participants).set({ acceptanceStatus: "accepted" }).where(eq(participants.id, row.pid));
```
`PARTICIPANT_ACCEPTANCE = ['pending','accepted','declined']` — "Confirmed" = label for `'accepted'`. **OK**

### Step 4 — Dana sees her own controls; none on Pending "Guardrails Roundtable"
Same render condition (`status === 'accepted'`) hides controls on the pending session; the action's
`subStatus !== 'accepted'` check is the server half (a forged confirm on the pending session 4xxs).
Requires Dana's login = H2. **OK (H2)**

### Step 5 — Dana withdraws
Same action with `intent: "withdraw"` → `SET acceptance_status = 'declined'`.
**GAP (H12, MINOR):** the portal renders this as "Withdrawn" but the enum value is `declined`, while a
*submission-level* withdrawal (`submissions.withdrawn_at/withdrawn_by_id/withdrawn_reason`, status
`withdrawn`) also exists. Nothing states which concept the per-person Withdraw button drives, whether
it should also stamp `withdrawn_reason`, or how admin UI labels distinguish "participant declined
participation" from "submission withdrawn".

### Step 6 — isolation
Priya's row and Dana's row are distinct `participants` rows (`participants_submission_contact_uq`
guarantees one row per person per submission); updating one cannot touch the other:

```sql
SELECT c.email, p.acceptance_status FROM participants p JOIN contacts c ON c.id = p.contact_id
WHERE p.submission_id = :panelSubId;
-- priya@example.com | accepted        dana.okafor@example.com | declined
```
**OK**

### Step 7 — admin panel shows per-person acceptance
Same query on `admin.submissions.$id.tsx` participants panel. **OK**

---

## SP-S6 — onboarding tasks + the hotel-stay portal form

### Step 1 — acceptance auto-provisioned the task set
The spine's concrete write (`app/domain/accept.ts` — file mandated by CLAUDE.md wave 2):

```ts
const onboarding = await db.select().from(tasks)
  .where(and(eq(tasks.eventId, eventId), eq(tasks.isOnboardingDefault, true)));
const speakers = await db.select({ contactId: participants.contactId }).from(participants)
  .where(and(eq(participants.submissionId, submissionId), eq(participants.role, "speaker")));
await db.batch(onboarding.flatMap((t) =>
  speakers.map((s) => db.insert(taskAssignments).values({
    taskId: t.id,
    contactId: s.contactId,
    submissionId: t.type === "submission" ? submissionId : null,
    dueAt: ???,                                            // ← no source column (GAP H9)
  }))));
```
Seed provides `task_hotel`/`task_flight` (portal-form-backed, `is_onboarding_default=1`).
**GAP (H9, MINOR):** `dueAt` has no source (`tasks` has no default-due column). **GAP (H14, MINOR):**
the optional "Announce your participation" task the scenario names is not seeded. **GAP (H11, MINOR):**
no unique constraint prevents double-assignment on re-accept.

### Step 2 — Tasks tab lists name/required/due/status
```sql
SELECT t.name, t.required, t.description, ta.due_at, ta.status, ta.id
FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id
WHERE ta.contact_id = :priyaContactId
ORDER BY t.required DESC, ta.status, ta.due_at;      -- task_assignments_contact_status_idx
```
**OK**

### Step 3 — mark simple task complete
```ts
// action on portals.…tasks.tsx — ownership enforced in the WHERE via the contact lookup
await db.update(taskAssignments)
  .set({ status: "complete", completedAt: new Date() })
  .where(and(eq(taskAssignments.id, taId), eq(taskAssignments.contactId, contact.id)));
```
`TASK_STATUS` has `complete`. **OK**

### Step 4 — the attached form renders
```sql
SELECT pf.title, pf.schema FROM tasks t
JOIN portal_forms pf ON pf.id = t.portal_form_id
WHERE t.id = 'task_hotel';
```
Scenario fields as the schema JSON would need to be:

```json
[
  {"name": "Check-in Date",   "type": "date",     "required": true},
  {"name": "Check-out Date",  "type": "date",     "required": true},
  {"name": "Room Preference", "type": "dropdown", "required": false, "options": ["King","Queen","Double"]},
  {"name": "Special Requests","type": "textarea", "required": false}
]
```
**GAP (H10, MINOR):** the declared `$type` is `Array<{name; type; required}>` — no `options`, so the
Room Preference dropdown is outside the stated contract (and the seeded hotel form has only
Hotel name + Check-in date — fixture drift, H14).

### Step 5 — empty required field: inline error, nothing saved
```ts
for (const f of schema) if (f.required && !String(answers[f.name] ?? "").trim())
  return { fieldErrors: { [f.name]: ["This field is required."] } };   // returns before the update
```
**OK**

### Steps 6–7 — submit → complete; response stored
```ts
await db.update(taskAssignments).set({
  status: "complete", completedAt: new Date(),
  response: { "Check-in Date": "2026-10-11", "Check-out Date": "2026-10-15",
              "Room Preference": "King", "Special Requests": "Ground floor, near elevator" },
}).where(and(eq(taskAssignments.id, taId), eq(taskAssignments.contactId, contact.id)));
```
```sql
SELECT json_extract(response, '$."Check-in Date"'), json_extract(response, '$."Check-out Date"')
FROM task_assignments WHERE id = :taId;   -- 2026-10-11 | 2026-10-15
```
`task_assignments.response` is `text mode:'json'`. **OK**

### Step 8 — admin reads the response
`admin.tasks.tsx` (ROUTE-MAP wave 3 — assigned) detail:

```sql
SELECT t.name, c.first_name || ' ' || c.last_name AS speaker, ta.response, ta.completed_at
FROM task_assignments ta
JOIN tasks t    ON t.id = ta.task_id
JOIN contacts c ON c.id = ta.contact_id
WHERE ta.id = :taId;
```
SCOPE P0 #7 explicitly commits this read. **OK**

### Step 9 — Home outstanding count drops
```sql
SELECT COUNT(*) FROM task_assignments
WHERE contact_id = :priyaContactId AND status = 'incomplete';   -- covered by task_assignments_contact_status_idx
```
**OK**

---

## SP-S7 — organizer-shared files

### Step 1 — Files tab empty state
**GAP (H4, MAJOR — route half):** the portal route grant is "(+ home/submissions/profile/tasks)" — there
is **no files child** in ROUTE-MAP, and adding one requires an integration-branch row first. The
committed P1 #3 "portal Files list" is route-homeless.

### Step 2 — admin uploads + shares speaker-kit-2026.pdf
Intended write:

```sql
INSERT INTO files (id, event_id, submission_id, contact_id, task_assignment_id,
                   r2_key, file_name, kind, content_type, size_bytes, version, created_at)
VALUES (:fid, 'e_demo', NULL, NULL, NULL,
        'shared/e_demo/speaker-kit-2026.pdf', 'speaker-kit-2026.pdf', 'doc', 'application/pdf', 122880, 1, unixepoch());
```
**GAP (H4, MAJOR — model half):** *nothing marks this row as portal-shared.* The all-FKs-NULL
convention above is my invention — unstated anywhere, and it makes every unattached admin upload
(an import artifact, a wrong-button upload) instantly visible to all speakers. `FILE_KIND` has no
`shared` value; `files` has no `sharedToPortal`/visibility column. SCOPE P1 #3's "the `files` table
already models it" does not hold distinguishably. Admin surface: no route uploads event files
(portals-admin row = `admin.portals.tsx · admin.portal-forms.tsx · admin.file-requests.tsx`) — homeless
too. Upload transport = H3.

### Step 3 — Priya sees name + human metadata
```sql
SELECT id, file_name, size_bytes, created_at
FROM files
WHERE event_id = 'e_demo'
  AND submission_id IS NULL AND contact_id IS NULL AND task_assignment_id IS NULL   -- ← the unstated convention (H4)
ORDER BY created_at DESC;
```
`size_bytes`/`created_at` → "120 KB · shared Aug 9, 2026". **OK-conditional on H4.**

### Step 4 — download, checksum-exact
```ts
// portals.$eventSlug.$portalId.files.$fileId.tsx loader — route missing (H4/H3b)
const user = await requireUser(env, request);
// resolve contact in this event (H8 helper), then:
const [file] = await db.select().from(files)
  .where(and(eq(files.id, params.fileId), eq(files.eventId, event.id),
             isNull(files.submissionId), isNull(files.contactId), isNull(files.taskAssignmentId)))
  .limit(1);
if (!file) throw data(null, { status: 404 });
const obj = await env.BLOBS.get(file.r2Key);
if (!obj) throw data(null, { status: 404 });
return new Response(obj.body, { headers: {
  "Content-Type": file.contentType ?? "application/octet-stream",
  "Content-Disposition": `attachment; filename="${file.fileName}"`,
}});
```
R2 returns bytes verbatim → checksum equality holds. **OK-conditional on H3/H4.**

### Step 5 — logged-out GET denied; object not publicly reachable
The loader above starts with `requireUser` → logged-out GET = 302 to `/login`, zero file bytes. The
underlying object is only reachable through this route because the bucket has no public access and the
r2Key never leaves the server (list payload exposes `files.id`, not `r2_key`). This is exactly why the
download MUST be a Worker-gated route, not a presigned public GET — reinforcing H3's "pick the
transport and write it down". **OK-conditional.**

---

## SP-S8 — forgot password end-to-end

**GAP (H5, MAJOR, umbrella):** committed P1 #12, table complete, **zero routes assigned** — ROUTE-MAP
has login/logout/403 only. The walk below names the files the map must gain
(`forgot-password.tsx` → `/forgot-password`, `reset.$token.tsx` → `/reset/:token`) and files the gap.

### Steps 1–3 — request a reset; nonexistent email stays quiet
```ts
// forgot-password.tsx action — // @public
const email = String(form.get("email") ?? "").toLowerCase();
const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (user) {
  const token = crypto.randomUUID();
  await db.insert(passwordResets).values({
    userId: user.id, token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),      // 1h — TTL UNSTATED anywhere (H5-minor)
  });
  await getEmailSender(env).send({
    to: email, subject: "Reset your password",
    html: `<p><a href="${origin}/reset/${token}">Set a new password</a></p>`,
    dedupeKey: `password_reset:${token}`,                  // token-unique → re-requests always send
    eventId: "e_demo",
  });
}
return { ok: true };                                       // identical response either way — no enumeration
```
Outbox checks:

```sql
SELECT COUNT(*) FROM email_outbox WHERE "to" = 'priya@example.com'  AND dedupe_key LIKE 'password_reset:%'; -- 1
SELECT COUNT(*) FROM email_outbox WHERE "to" = 'nonexistent.person@example.com';                            -- 0
```
**OK-conditional on H5 (routes).**

### Steps 4–6 — tokened link → set new password
```ts
// reset.$token.tsx action — // @public
const [row] = await db.select().from(passwordResets)
  .where(eq(passwordResets.token, params.token)).limit(1);
if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now())
  return { invalid: true };                                // step 9's state

const pw = String(form.get("password"));
if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(pw))     // policy DEFINED NOWHERE (H5-minor)
  return { fieldErrors: { password: ["Use 8+ characters with a capital, a number, and a symbol."] } };

await db.batch([
  db.update(users).set({ passwordHash: await hashPassword("Priya!Reborn2026") })
    .where(eq(users.id, row.userId)),
  db.update(passwordResets).set({ usedAt: new Date() })   // single-use: consumed atomically with the change
    .where(eq(passwordResets.id, row.id)),
  db.delete(authSessions).where(eq(authSessions.userId, row.userId)),  // revoke sessions — UNSTATED (H5-minor)
]);
return redirect("/login?redirectTo=" + encodeURIComponent(`/portals/${slug}/${portalId}/home`));
```
`autocomplete="new-password"` on the input (same G9-family attribute discipline). "abc" fails the
regex → inline. **OK-conditional on H5**; the password policy and session-revocation lines are my
inventions — the design defines neither (**H5-minor**).

### Steps 7–8 — old password dead, new one works
`verifyPassword("Priya!Speaks2026", newHash)` → false → login.tsx returns "Incorrect email or
password."; `"Priya!Reborn2026"` verifies → session → portal.
**GAP (H13, MINOR):** the post-reset redirect MUST carry `redirectTo` (as written above) — a bare
`/login` sends the authenticated speaker to `/admin` (login.tsx loader + `safeRedirect` default) and
she dead-ends at `/403`. Nothing in the design flags this speaker-path landmine.

### Step 9 — token reuse rejected
The `row.usedAt !== null` branch above; DB proof:

```sql
SELECT used_at FROM password_resets WHERE token = :token;  -- non-NULL after step 6
```
Single-use is schema-supported (`used_at`) and consumed in the same `db.batch` as the hash change —
no window where the password changed but the token survives. **OK-conditional on H5.**

---

## touches (written into 04-speaker-portal.yaml)

```yaml
touches:
  tables: [events, users, authSessions, passwordResets, contacts, submissions, participants,
           formats, forms, tasks, taskAssignments, portalForms, files, emailTemplates, emailOutbox]
  ports: [email, clock]
  routes: ["portals.$eventSlug.$portalId.tsx (+ home/submissions/profile/tasks — files child MISSING)",
           login.tsx, logout.tsx, admin.submissions.tsx, admin.submissions.$id.tsx, admin.tasks.tsx,
           submit.$eventSlug.$formId.tsx,
           "MISSING: forgot-password.tsx, reset.$token.tsx, R2 byte-serving route(s)"]
```

---

## Re-walk 2026-08-10 — tenancy migration (Wave A gate)

Re-walked against: `app/db/schema.ts` post-migration (`organizations` :95, `organization_members`
:101 — no role column, `events.organizationId` NOT NULL :121-125, `api_tokens.organizationId` NOT
NULL + nullable `eventId` :1185-1202, `fields` scope-enum dropped → org/event XOR :390-411),
`drizzle/seed.sql` (org_demo :61-62, om_admin/u_admin :64-65, e_demo→org_demo :67-68,
apitok_demo→org_demo with eventId NULL :223-224), `app/lib/auth.ts` (UNCHANGED by Wave A — the
any-event fallback is still live at :249), `docs/multi-tenancy-design.md`.

**Headline determination.** The portal's serving chain is `$eventSlug → events` (slug globally
unique, schema.ts:127; kept a single global namespace as an accepted trade-off, design.md:66-68)
`→ requireUser → contacts(user_id, event_id) → participants`. Every WHERE clause in the
2026-08-09 walk anchors on event/contact/participant ids; of this suite's `touches.tables` only
`events` gained a column, and a NOT NULL FK constrains INSERTs — no walked artifact inserts an
event. Tenancy does not, and per design.md:111 must not, gate the speaker surface ("public
`$eventSlug` pages unchanged"). The two other migrated tables sit outside this suite: `api_tokens`
(no step exercises `/api/v1`; not in `touches`) and `fields` (SP-S3.1's submit rides walk-03's
artifact, which joins `form_fields.field_id → fields.id` — a direct FK join the scope-drop cannot
perturb). `touches` needs no update: no step reads `organizations`/`organization_members`.

New gaps from this re-walk:

| # | Step | Gap | Severity |
|---|---|---|---|
| T1 | SP-S3.3 | Speaker-account minting (H2's still-unowned fix) and Wave D's org-member invite ride the same sentinel-hash-user + `password_resets` mechanics with **no stated discriminator** — copying the invite path would mint a co-speaker as an equal org admin. | MINOR |

Pre-existing H1–H14 all stand exactly as filed — none widened, none fixed by Wave A (verified per
step below). Wave ordering protects the admin-side interim: B (membership auth) ships before C
(signup) mints any second org (design.md build order, :129-134).

### SP-S1 step 1 — UNCHANGED
Event resolution is a SELECT; `organizationId NOT NULL` constrains writers, and the seed supplies
the org side — the artifact still produces:

```sql
SELECT id, organization_id, name, slug FROM events WHERE slug = 'ai-engineer-sandbox' LIMIT 1;
-- e_demo | org_demo | AI.Engineer Sandbox Event | ai-engineer-sandbox   (seed.sql:61-68)
```
The portal loader adds NO membership check — by design (design.md:111; tenancy gates admin
surfaces, not speaker ones). H1 (`:portalId` homeless) stands: no `portals` table arrived in this
migration.

### SP-S1 step 2 — UNCHANGED
The gate throws before any query runs; there is no org data pre-auth to leak.

### SP-S1 step 3 — UNCHANGED
Static DOM attributes on `login.tsx`; tenancy-free (walk-03 G9 stands).

### SP-S1 step 4 — UNCHANGED
`login.tsx` action + `createSession` are global-user mechanics; `users` gained no org column, and
`homePathForRole` keys off `users.role`, which the design explicitly retains (design.md:106-109).

### SP-S1 step 5 — UNCHANGED
The Home union query anchors on `contacts.user_id + contacts.event_id` and
`participants.contact_id` — none gained an org column (H8 stands).

### SP-S1 step 6 — UNCHANGED
Admin chain: `requireAdmin` = role-enum check (auth.ts:226 — the enum survives this design,
design.md:106-109) + `getActiveEvent(u_admin)` → `activeEventId` or first-event fallback
(auth.ts:249); both resolve e_demo in the seeded DB (sole event, owned by org_demo; u_admin ∈
org_demo via om_admin, seed.sql:64-65). The `UPDATE submissions SET status='accept_queue'…`
artifact is byte-identical. The fallback's cross-org hole is **covered: Wave B membership check**
— "first event across MY orgs, else null" (design.md:92-96; build-order row B :132), landing
before Wave C can mint a second org.

### SP-S1 step 7 — UNCHANGED
`PORTAL_STATUS_LABEL` maps status strings only; no org input (H7 stands).

### SP-S1 step 8 — UNCHANGED
Same artifacts as steps 6–7.

### SP-S1 step 9 — UNCHANGED
Accept spine + recorded detail URL are submission/participant-scoped (H1, H11 stand).

### SP-S2 step 1 — UNCHANGED
Profile tab resolves `contacts(user_id, event_id)` — contacts gained no org column.

### SP-S2 step 2 — UNCHANGED
`contacts.bio` write; column untouched by the migration.

### SP-S2 step 3 — UNCHANGED
`job_title` / `company_name` — untouched columns.

### SP-S2 step 4 — UNCHANGED
The R2 transport question is orthogonal to tenancy; `r2Key = headshots/e_demo/…` stays
event-scoped (H3 stands).

### SP-S2 step 5 — UNCHANGED
Link columns untouched.

### SP-S2 step 6 — UNCHANGED
Zod parse over contacts fields; no org input.

### SP-S2 step 7 — UNCHANGED
The enforcement-point question is H3's transport gap, tenancy-free (H3c stands).

### SP-S2 step 8 — UNCHANGED
Loader round-trip on the same contacts row; the byte-serving route is still homeless (H3b stands
— the migration added no routes).

### SP-S2 step 9 — UNCHANGED
The SQL is event-anchored (`WHERE event_id = 'e_demo' AND email = …`); admin chain per SP-S1.6
(covered: Wave B). H6 stands — no admin contact route arrived with the migration.

### SP-S2 step 10 — UNCHANGED
Storage-level checksum; tenancy-free.

### SP-S3 step 1 — UNCHANGED
Contact upsert + participants insert are event-scoped; `contacts_event_email_uq` untouched.

### SP-S3 step 2 — UNCHANGED
The probe's wording is now also the tenancy-correct one: under multi-org,
`dana.okafor@example.com` may legitimately exist as a *separate* contact row in another org's
event — the probe's `WHERE event_id = 'e_demo'` already excludes such rows. Both assertions hold
as written.

### SP-S3 step 3 — GAP
H2 stands (MAJOR, pre-existing, unwidened): still no owner mints Dana's `users` row. Tenancy adds
one clause to whatever fix eventually lands — what it must NOT write:

```ts
const [danaUser] = await db.insert(users).values({
  email: "dana.okafor@example.com",
  passwordHash: await hashPassword(crypto.randomUUID()),   // unusable placeholder
  name: "Dana Okafor", role: "speaker",
}).returning();
// NO organizationMembers insert — a speaker is a contact in an event, NEVER an org member.
```

Why this bites now: org members are equal admins — any member may invite/remove members
(design.md:103-104) — and Wave B's admin guard becomes a membership check (design.md:97), so ONE
stray membership row upgrades a co-speaker to organizer of the Demo org. The mechanism overlap
invites exactly that error: Wave D's org-member invite rides the same sentinel-hash-user +
`password_resets` mechanics (schema.ts:73 "Also backs invites"; design.md:59-62) that H2's fix
would use for speaker onboarding, and `password_resets` carries no purpose/organization column to
tell a "set your password, you're a speaker" token from a "set your password, you're an org
admin" token.
**GAP (T1): speaker onboarding vs org-member invite share `password_resets` with no stated
discriminator; the design doc covers only the invite side — H2's future owner can escalate a
co-speaker to org admin by copying the Wave D path. [MINOR]** (Minor because the escalation needs
H2's builder to make the wrong copy; the decision just has to be written down before Wave D.)

### SP-S3 step 4 — UNCHANGED
Participant-scoped listing (post-H2), org-blind by construction.

### SP-S3 step 5 — UNCHANGED
One contacts row ⇒ one Profile tab; untouched columns.

### SP-S3 step 6 — UNCHANGED
Same joined row on both submissions; admin chain covered: Wave B (H6 stands).

### SP-S3 step 7 — UNCHANGED
WHERE-clause scoping on Dana's `contact_id` — no org column involved.

### SP-S3 step 8 — UNCHANGED
The ownership join (`contacts.user_id = :me AND contacts.event_id = event.id`) is ALSO the
portal's cross-tenant denial: a submission in another org's event can never satisfy it, because
participants→contacts pins the event and `events.organization_id` pins the org. Portal isolation
inherits from event-scoping; adding an organizationId check here would duplicate derivable truth
— exactly what the design refuses (design.md:82-83, "never stored where derivable"). H8 stands.

### SP-S4 step 1 — UNCHANGED
The scale fixture loads contacts/submissions/participants INTO e_demo — already org-attached
(seed.sql:67-68); none of the inserted tables gained an org column. One new rule for H14's future
fixture author: a fixture that mints an EVENT must now carry `organization_id` (the seed.sql:67
column list is the template). H14 stands.

### SP-S4 step 2 — UNCHANGED
Portal login + Submissions tab — global-user then event-scoped chain, per SP-S1.

### SP-S4 step 3 — UNCHANGED
Query plan (`contacts_user_idx → participants_contact_idx → submissions` PK) — the migration
changed no index on these tables.

### SP-S4 step 4 — UNCHANGED
Client-side substring filter over the loader's 8 rows; no query at all.

### SP-S4 step 5 — UNCHANGED
Same client-side filter, cleared.

### SP-S4 step 6 — UNCHANGED
Empty-state branch on `filtered.length === 0`; no data path.

### SP-S4 step 7 — UNCHANGED
Co-speaker detail query is participant-scoped (flow 09 §2.1 rule unchanged).

### SP-S5 step 1 — UNCHANGED
Admin accept per SP-S1.6 (covered: Wave B); spine per SP-S6.1 (H2, H11 stand).

### SP-S5 step 2 — UNCHANGED
Render condition on `submissions.status` only.

### SP-S5 step 3 — UNCHANGED
The confirm action's enforcement line is `contacts.userId = user.id` — org-free.

### SP-S5 step 4 — UNCHANGED
Same render/action pair; Dana's login remains H2 (stands).

### SP-S5 step 5 — UNCHANGED
`acceptance_status = 'declined'` write; H12's two-withdrawal-concepts question is tenancy-free
(stands).

### SP-S5 step 6 — UNCHANGED
Distinct participants rows; `participants_submission_contact_uq` untouched.

### SP-S5 step 7 — UNCHANGED
Admin participants panel; chain covered: Wave B.

### SP-S6 step 1 — UNCHANGED
The spine writes to `tasks` / `task_assignments` — both event/contact-scoped, no new columns
(H9, H11, H14 stand).

### SP-S6 step 2 — UNCHANGED
`task_assignments.contact_id` anchor; `task_assignments_contact_status_idx` untouched.

### SP-S6 step 3 — UNCHANGED
Ownership enforced in the WHERE via the contact lookup — org-free.

### SP-S6 step 4 — UNCHANGED
Near-miss worth recording at the step: the migration DID rework field scoping, but that is the
`fields` library (CFP forms via `form_fields`); the hotel form renders `portal_forms.schema` JSON
— a different mechanism the migration never touched (`portal_forms` gained nothing). H10 stands.

### SP-S6 step 5 — UNCHANGED
Schema-driven required check; returns before any write.

### SP-S6 step 6 — UNCHANGED
`task_assignments.response` JSON write — column untouched.

### SP-S6 step 7 — UNCHANGED
`json_extract` probe on the same untouched column.

### SP-S6 step 8 — UNCHANGED
`admin.tasks` read; admin chain covered: Wave B.

### SP-S6 step 9 — UNCHANGED
Count query on `contact_id + status`.

### SP-S7 step 1 — UNCHANGED
Files-tab route still homeless — the migration added no route rows (H4 route half stands).

### SP-S7 step 2 — UNCHANGED
`files` gained no org/visibility column — H4's model half stands EXACTLY as filed. Blast radius
did not widen: the all-FKs-NULL leak is bounded by `files.event_id` → one event → one org.

### SP-S7 step 3 — UNCHANGED
Listing query event-anchored; OK-conditional on H4 as before.

### SP-S7 step 4 — UNCHANGED
The download loader's scoping is `files.event_id = event.id` (event from slug) — cross-org file
reads are impossible for the same reason as SP-S3.8. H3b/H4 stand.

### SP-S7 step 5 — UNCHANGED
`requireUser` gate + private bucket; tenancy-free.

### SP-S8 step 1 — UNCHANGED
Forgot-password routes still homeless (H5 stands).

### SP-S8 step 2 — UNCHANGED
`users` / `password_resets` gained no columns; the artifact runs as written.

### SP-S8 step 3 — UNCHANGED
No-enumeration branch; org-free.

### SP-S8 step 4 — UNCHANGED
Outbox probes are address-anchored; `email_outbox` gained no org column. (The artifact's
`eventId: "e_demo"` stamp was already a walk invention — a reset is user-level, not event-level —
and org scoping does not change that.)

### SP-S8 step 5 — UNCHANGED
Token lookup + policy check; H5-minor items (TTL/policy) stand undefined, tenancy-free.

### SP-S8 step 6 — UNCHANGED
Consume-token batch identical (`password_resets` untouched). Cross-reference T1: this same
consume path is what Wave D's org-member invites will ride (schema.ts:73) — the discriminator
question is filed at SP-S3.3.

### SP-S8 step 7 — UNCHANGED
`verifyPassword` mechanics; global user.

### SP-S8 step 8 — UNCHANGED
Login → portal; H13's `redirectTo` landmine stands, tenancy-free.

### SP-S8 step 9 — UNCHANGED
`used_at` single-use branch; column untouched.

### Re-walk tally
64 steps — 0 CHANGED, 63 UNCHANGED, 1 GAP (**T1, MINOR** at SP-S3.3). Pre-existing H1–H14 stand
as filed, none widened by Wave A. Portal event resolution verified producing under
`events.organizationId NOT NULL` (SP-S1.1 artifact). No `touches` update required.
