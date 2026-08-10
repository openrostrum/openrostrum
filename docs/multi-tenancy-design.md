# Multi-tenancy & organizer sign-up — design (owner decision 2026-08-10)

**What this commits:** the flagship deployment at openrostrum.com supports real
organizer sign-up. An event team lands on the marketing page, creates an account
and its own isolated **organization**, and runs its conference — while the seeded
sandbox event (shared judge credentials) keeps working and self-hosting remains a
first-class path. This supersedes the OUT-table's "multi-org out" line (SCOPE P1
#22 records the decision). The design passed a 3-round adversarial review
(architecture / governance / simplicity judges) before landing here.

## Verified Sessionboard shape (parity anchor)

Verified 2026-08-10 against `learn.sessionboard.com` ("Inviting organization team
members", "Invite & Manage Event Team Members"), the custom-roles product-update
post, the vendored OpenAPI spec, and the eval kit's CRM research
(`docs/reference/killmysaas-evals/docs/07-speaker-crm.md`):

- **The tenant is the organization.** Events belong to an organization; the event
  switcher offers "View all my organizations"; org-level endpoints exist
  (`/v1/organization/{orgId}/contacts`).
- **There is no owner role.** Org-level invites (Settings → "Invite User": Email,
  First Name, Last Name, "Active User" toggle) all receive the **"Admin User"**
  permission — equals. Event-level default roles are Admin / Session Manager /
  Evaluator Session Manager / Coordinator / Portal User, plus a custom-role
  permission-toggle matrix. Any Admin invites, edits, and removes members.
- **Membership scope per member** is "Organization Access" (all events) or
  "Selected Events" (event-scoped Admin User).
- **API tokens are organization-scoped** ("Organization Settings → API Tokens"),
  with per-token event restrictions (flows/09 rule p).

**Consequences for us (parity, per the recorded decision procedure):** org
members are **equal admins — no owner column, no role column**. Member management
is a member capability, guarded by one invariant: an organization can never lose
its last member. This confirms SCOPE P1 #21's "all admins are equal" at the org
layer too. "Selected Events"-style event-scoped membership is a **registered
follow-up** (SCOPE #22 register) — v1 ships "Organization Access" semantics:
membership grants all the org's events. (Reviewers already have an event-scoped
path via reviewer assignments; this loses nothing judges or real teams need now.)

## Product model

Sign-up creates an organization. New-visitor experience on openrostrum.com:

1. Homepage → "Get started free" → `/signup`: name, email, password
   (Turnstile-protected via the existing port; the judged deployment runs
   keyless → no-op, recorded in SCOPE's Turnstile note). While the global
   `users.role` enum lives, `/signup` writes `role = 'admin'` —
   `homePathForRole` (`app/lib/auth.ts`) and reviewer routing key off it until
   the registered enum-removal follow-up.
2. **Existing-email sign-up (decided, not discovered):** `users.email` is
   globally unique and the enum cannot express speaker-in-org-A +
   organizer-in-org-B. `/signup` with an email that already has an account
   shows a decided message — sign in to your existing surface; organization
   creation for existing accounts arrives with the identity-unification
   follow-up. Blocked with words, never a 500.
3. Onboarding, one form: organization name + first event (name, slug, dates,
   timezone — reusing the committed create-event form, P1 #5).
4. Land in `/admin` on their own empty event (empty states exist repo-wide).
5. Invite teammates from settings — P1 #21's invite becomes an **org-member
   invite** on the existing sentinel-hash mechanics (G7); the invite link
   itself proves email ownership (verify-email deferred until something gates
   on it — registered).
6. The sandbox event moves into a **"Demo" organization**; the shared judge
   seat is a member of only that org. New sign-ups cannot see it, nor it them.

Accepted trade-off, recorded: event slugs remain one global namespace —
self-serve sign-ups can claim generic slugs first-come-first-served. Revisit
only if it bites.

## Schema (integration-owned, one migration wave)

- `organizations`: `id`, `name`, `createdAt`. No slug (no route consumes one),
  no ownerId (verified: Sessionboard has no owner).
- `organization_members`: `organizationId`, `userId`, `createdAt`;
  `unique(organizationId, userId)`. No role column — members are equal admins.
- `events.organizationId` FK, **non-null**.
- `api_tokens.organizationId` FK, **non-null**, + per-token event restriction
  per flows/09 rule (p) — `/api/v1` (P1 #20) is tenant-scoped the day it ships.
- `fields`: the `scope` enum is **dropped**; scoping becomes an app-enforced
  XOR (the `formFields.fieldId`/`builtinRef` precedent): org-wide fields set
  `organizationId` (eventId null); event fields set `eventId` (organizationId
  null — the org is derived via the event, never stored where derivable, so
  the two can never disagree).
- Backfill + `drizzle/seed.sql` in the same change: mint the Demo organization,
  attach the seeded event, membership for the seeded admin, org-attach existing
  fields and api tokens. `pnpm db:reset` stays green in every worktree.

## Authorization

Tenancy enforcement lands in the existing chokepoints — no new middleware layer:

- `getActiveEvent(env, user)` gains the membership check (event → org →
  member). **The any-event fallback is the hole Wave B exists to close**: today
  a user with null `activeEventId` falls back to the first event in the
  database. It becomes: first event across MY orgs, else null — with a test on
  the null-`activeEventId` path.
- The admin guard adds the membership check alongside the global-role check —
  the enum gates the surface, membership gates which events.
- The `/api/v1` token guard resolves the token's organization + event
  restriction.
- The event switcher lists only your orgs' events (metadata leak otherwise).
- Row-level `eventId` verification continues per the data-exposure matrix
  (flows/09).
- Member management: any org member may invite/remove members (Sessionboard
  parity); removing the **last** member of an org is refused.

`users.role` remains through this design (membership gates *which events*; the
enum gates *which surface* — orthogonal checks, no duplicated truth). Its
removal — authority fully derived from memberships/assignments/contacts — is a
registered SCOPE follow-up with its own scenario re-walk.

No URL changes: `/admin/*` stays; public `$eventSlug` pages unchanged.

**Binding rules the 2026-08-10 re-walk surfaced** (each closes a walk GAP; the
walk files carry the concrete SQL):

- **Reviewers resolve events through assignments, never membership.** Reviewers
  hold no `organization_members` row (giving them one would make them org
  admins); `/reviews` derives its event scope from
  `reviewer_tracks → tracks.event_id`. Wave B ships a test on the
  membership-less user path — `getActiveEvent` returning null must never be
  what the reviewer surface depends on.
- **Admin-notify recipient pickers list the event's org members**
  (`organization_members WHERE organizationId = event.organizationId`), never
  `users WHERE role='admin'` — that query becomes a cross-org member-directory
  leak the day a second org exists.
- **Invite tokens carry mint-time intent.** `passwordResets.organizationId`
  (nullable) is the discriminator: set = org-member invite (accept creates the
  membership), NULL = speaker/reviewer/password-reset. The accept flow derives
  what a token grants from this column, never from which route redeems it.
- **Every event-creation path provisions the event's default email templates**
  (shared domain function, both P1 #5 create-event and Wave C onboarding) —
  today only the seed mints templates, so a non-seeded event's confirmation
  email silently never sends.
- **New events inherit the active event's organization** in create-event;
  onboarding creates the first org + event. An org picker for multi-org users
  arrives with the Selected-Events follow-up, not before.
- **Library-field creation defaults to event-scoped**; org-wide is an explicit
  choice in the create-field UI (the XOR always has exactly one side set).
- **Email suppression stays person-global across orgs** (deliberate
  cross-tenant exception, recorded: an unsubscribed address stays unsubscribed
  everywhere — the compliance-safe reading; per-org suppression would also
  need org context in the signed unsubscribe token).
- **/api/v1 v1 serializers hardcode Hide-PII on**; per-token Hide-PII/scopes
  columns are integration-owner work when the P1 #20 lane builds.

## Airtable (tenant boundary now, credentials later)

The env-configured base/token is **bound to the Demo organization**, enforced in
the background engine's row selection (`WHERE event.organizationId = demoOrg` in
the sync job) — the port stays a dumb transport. Self-serve orgs see an explicit
"Airtable isn't configured for this organization" state, never a silent no-op.
Per-org credentials (D1 row encrypted app-side via WebCrypto AES-GCM with a
deployment secret) are a registered follow-up, built with the settings UI that
makes them usable.

## Build order (integration-owned `integration/*` branches, serial on main)

Feature lanes keep building P0 (the judge path) in parallel and catch up with
`git merge main` after Wave A, inheriting tenancy through the shared auth
helpers.

| Wave | Ships |
|---|---|
| A | Migration + seed backfill above, in one change + the nine-scenario re-walk (process.md gate — determination per step DURING the walk) + `docs/JUDGING.md` note (Demo org, unchanged judge credentials) |
| B | Membership-aware auth core: `getActiveEvent` membership check + fallback fix (null-`activeEventId` test), admin guard, API-token org scoping, event-switcher org scoping |
| C | `/signup` (existing-email path per above) + one-form onboarding (org + first event) + "Get started free" homepage CTA + `docs/JUDGING.md` update (the "signup is intentionally OFF" framing dies here) |
| D | Org-member invites (P1 #21 semantics, last-member guard), Demo-org Airtable row-selection guard + not-configured state, `docs/JUDGING.md` invite-flow update |

## Verification per wave

- **Cross-tenant denial tests**: org A admin requests org B's event → 403; row
  lookups across tenants → 404/403; org A's API token against org B's data →
  403; org A's form builder sees only its own fields; switcher shows only own
  orgs' events.
- **Browser walk-through**: sign up → onboard → land in empty admin → invite a
  teammate → teammate accepts and sees the org.
- **Regression**: seeded sandbox seat works (how judges enter); speaker/reviewer
  landing unchanged; `pnpm db:reset` green in a fresh worktree.
