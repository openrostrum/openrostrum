# Airtable sync — design note

Status: **COMMITTED — SCOPE P1 #15 (owner decision 2026-08-09: Airtable is a
requirement, not bonus; do not relitigate).** Tier 1 (push) ships first, Tier 2
(source-of-truth pull) after. The real base + token are provisioned in the
capabilities phase (serial integration lane). Ground truth for what swyx asked:
`docs/reference/discord/CLARIFICATIONS.md` → "Airtable Q&A".

**The mirror shape is NOT guesswork.** There is no native Sessionboard↔Airtable
integration (data reaches Airtable via Zapier/REST/webhook/CSV). The base is a
mirror of Sessionboard's own objects, whose exact fields/enums are pinned in
[`data-model.md`](data-model.md) (from Sessionboard's public OpenAPI spec). The
synced tables map onto that model: `submissions` (Sessions), `contacts`
(Contacts/Speakers), `task_assignments`. Use `friendly_id`-style stable keys.
Do NOT model against the eval kit's `speakers.csv` — that is fictional test data,
not Sessionboard's schema.

## The requirement (swyx, verbatim anchors)

- Floor: "for now read only is fine" — one-way push; rows land in the base,
  their automations fire on new rows.
- Full bonus: "the bonus points would be **airtable as source of truth**" —
  the team edits data in Airtable and the app honors it ("you have to read the
  airtable source of truth periodically/on load anyway so u pick up any
  airtable side changes").
- Product context: "the team does love being able to augment data in airtable";
  a developer-only DB frustrated them. Judges = that team.

## Decision 1 — inbound sync routes through DOMAIN OPERATIONS, never raw rows

The defining case: the team flips a submission to `accepted` in Airtable.
Acceptance is the P0 spine (auto-provision speaker + session + onboarding tasks
+ accept email). A sync that writes D1 columns directly bypasses all of it and
corrupts the app's own invariants. Therefore:

- Inbound changes are applied via the same shared domain functions the UI
  actions call (see `docs/process.md` → Build sequencing: the accept spine is built as
  `app/domain/accept.ts`, not inlined in a route action).
- The sync engine never contains business rules; it maps field changes onto
  domain calls (or validated writes for side-effect-free fields).

## Decision 2 — field classes (per synced table, declared in one mapping)

| Class | Examples | Sync semantics |
|---|---|---|
| App-owned | ids, auth, timestamps, computed | Push-only; inbound edits corrected back on next tick |
| Descriptive | title, bio, tags, track, notes | Three-way merge vs last-synced base; true conflict → Airtable wins (+ in-app audit entry) |
| Workflow | status | Inbound edit = a TRANSITION REQUEST through the domain function; side effects fire; illegal transitions rejected + written back |
| Team-private | any column the team adds | Never read, never written. Forces PATCH-only-known-fields; never full-record replace |

Team-private is load-bearing: augmenting the base with their own columns is
exactly the behavior swyx praised.

## Decision 3 — mechanism: snapshot three-way reconciliation

- Per synced record, store the last-synced field values (the "base") in a
  mapping table (`airtable_links`: d1 table+id ⇄ airtable record id + base
  snapshot). D1 changed vs base → push; Airtable changed vs base → pull; both →
  field-class rule above.
- **Trigger: webhook-first, poll-guaranteed** (facts verified against the
  Airtable Web API docs, 2026-08-09). Airtable's Webhooks API sends an
  HMAC-SHA256-signed lightweight ping (base+webhook id, no data, at-least-once,
  13 retries/~1 day then auto-disable) to a `notificationUrl`; the actual
  changes are pulled via the `listWebhookPayloads` cursor (50/page). Our
  `POST /hooks/airtable` Worker route verifies `X-Airtable-Content-MAC`,
  coalesces pings (~10s delayed queue message), and runs the reconcile tick
  scoped to the changed records → **team edits land in seconds**. Admin shows
  "Last synced …· Sync now" (the button just runs the tick).
- **The hourly full-base reconciliation poll stays as the safety net**: it
  self-heals missed pings, RE-REGISTERS/refreshes the webhook (webhooks expire
  after 7 days unless refreshed; 13 failed pings disable them), and is the
  only mode in local dev (fake-base adapter, no public URL). A full read of a
  ~1–2k-row conference ≈ tens of requests at the shared 5 req/s cap —
  idempotent, no cursor drift, crash-safe (base snapshot advances only after
  both sides confirm; re-runs are no-ops). Duplicate/at-least-once pings cost
  nothing for the same reason.
- One background engine, pull → merge → push, on the job registry
  (`app/jobs/airtable.scheduled.ts` + the webhook route as a second trigger).
  NEVER in the request path; D1 stays the serving layer.
- Engine (reconcile + merge + classes) is pure and identical everywhere; the
  port is thin record I/O only (`list` / `batchUpsert` / `batchDelete` /
  `markDeleted`). Local adapter = in-memory fake base → both directions are
  functionally verifiable with no Airtable account.

## Formerly-open decisions — RESOLVED 2026-08-09 (promotion to P1 forced them)

1. **Delete semantics — DECIDED (rev. 2, 2026-08-09): honor the delete, soften
   the blast radius.** (Rev. 1 "mark, never destroy" resurrected deleted rows
   and forced the team into the app to finish a delete — zombie-row UX that
   broke the leave-Airtable-never promise. Two premises were wrong: our
   full-base tick makes absence an unambiguous delete signal, and Airtable's
   own trash already covers fat-fingers.)
   - **Airtable row deleted → app ARCHIVES/WITHDRAWS** via the domain function
     (side effects fire: unschedule, mask from lists; data retained, hidden).
     The row stays deleted in Airtable — no recreation. **Row restored from
     Airtable's trash → app un-archives.** Symmetric; the team never leaves
     Airtable.
   - **App-side withdraw → status field update** on the Airtable row; the
     team's own columns live on. No tombstone rows, ever.
   - **App-side HARD delete (guarded, in-app only: junk / "delete my data") →
     the Airtable row is actually deleted too.** Required, not optional: a
     data-deletion request that leaves the person's data in the mirror is a
     compliance failure.
   - **Mass-delete circuit breaker:** if one tick sees >20% of linked rows
     absent, the engine pauses sync and raises an in-app alert instead of
     mass-archiving (the select-all accident is the one case trash + archive
     don't adequately cover).
2. **2026 Airtable API facts — PARTIALLY VERIFIED (2026-08-09, Web API docs):**
   ✅ Webhooks: available via API-token auth (not enterprise-gated), signed
   pings (`X-Airtable-Content-MAC`, HMAC-SHA256), at-least-once + 13 retries
   then auto-disable, 7-day expiry extended by refresh/payload-listing,
   `listWebhookPayloads` cursor for actual changes → **webhook-first trigger is
   committed** (mechanism section above). ✅ Rate limit: 5 req/s per base,
   shared with REST. ✅ Metadata API (verified live 2026-08-09 on the scratch
   base): schema read + table/field creation work with `schema.bases:*` scopes;
   **table DELETION does not exist in the API** (UI-only) — setup must be
   idempotent (read schema, create only what's missing), mistakes need a human.
   Still to verify at build time: batch sizes, `performUpsert` semantics,
   attachment ingestion (headshots).
3. **Base ownership — DECIDED: we create the demo base programmatically**
   (metadata API if verified, else a documented manual template) and hand over
   an invite + `docs/JUDGING.md` note. If the team supplies their own base, the
   field-class map is the only thing to remap — the engine is base-agnostic.
4. **Which tables sync — DECIDED:** `submissions` (sessions ARE accepted
   submissions — one table, one Airtable "Sessions" view filtered on status),
   `contacts`, and `task_assignments` (task status visibility is what a team
   tracks in a base). NOT synced: auth, emails, files bytes (headshot as
   attachment URL only). Per-field class map is written as the mapping module
   (`app/lib/airtable-map.ts`) at build time, one declaration per table.
5. **`airtable_links` schema — LANDED in `app/db/schema.ts`** (2026-08-09):
   `(tableName, recordId) ⇄ airtableId` + `baseSnapshot` JSON (synced fields
   only — team-private columns never enter it) + `syncedAt`.

## Process at build (P1 #15)

Verify API facts (checklist above) → write `airtable-map.ts` field classes →
build engine + local fake adapter + functional oracle (both directions) → wire
the real base on the serial integration lane (capabilities phase) → smoke
end-to-end. Tier 1 = push only (pull loop disabled); Tier 2 flips the pull on.

## Observability (acceptance criterion)

Every webhook ping (accepted / bad-MAC / replayed) and every reconciliation
outcome (ops applied per table, conflicts, circuit-breaker trip, auto-disable)
emits a `track()` event ([`observability.md`](observability.md)). "What did the
sync do?" must be answerable by query, never by re-deriving from base state.
