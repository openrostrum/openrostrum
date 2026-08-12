# Slop audit — recurring low-quality patterns — 2026-08-11

Read-only audit of the whole tree for patterns (not incidents) that recur because
parallel agents in isolated worktrees never saw each other's `app/lib/`. No code was
changed. Every count below was produced mechanically over the 427 tracked
`.ts`/`.tsx` files under `app/`, `workers/`, and `test/`; the counting method is
stated per finding so the owner can re-run it.

Counting rule used throughout: **one occurrence is an incident, not a pattern.**
Where I found an incident worth fixing but no pattern, it is filed under
[Incidents](#incidents--fix-these-do-not-write-a-rule) and explicitly not proposed as a rule.

---

## Summary — the four that matter

Every high-cost finding is one shape: **a shared helper exists, is exported, and a
later agent redeclared it locally instead of importing it — then the copies drifted.**
Ranked by what it costs the person using the product:

1. **Search silently returns wrong results.** Four implementations of LIKE-wildcard
   escaping exist; the canonical one (`app/lib/like.ts`) is imported by 2 files, and
   **9 user-facing search queries across 6 files** interpolate raw input into a LIKE
   pattern with no escaping at all. An organizer searching `100%` or `check_in`
   gets the wrong rows and no indication anything went wrong.
2. **Two settings pages show the wrong time.** Nine separate implementations of
   "format a date for display" exist; three are exported `app/lib/` helpers whose
   doc comments each independently assert the *same* invariant ("never the server's
   or the viewer's zone"). Two route-local re-rolls dropped the `timeZone` argument,
   so `/admin/settings/airtable` and `/admin/settings/team` render UTC on the server
   and flip to the viewer's zone on hydration.
3. **Two HTML sanitizers with different policies write the same DB columns, and the
   one guarding organizer sessions has zero tests.** What is allowed in a speaker bio
   depends on which door the bio came through.
4. **Enum→label maps are typed `Record<string, …>`, and every call site then adds a
   `?? fallback` that hides the gap.** 9 of 13 such maps project a schema enum with
   the type link cut; 27 call sites carry the defensive fallback. Adding a status
   value to the schema compiles clean and renders the raw DB string in the UI.

Findings 1, 2, 3 and half of 4 are the same root cause. I have kept them separate
because their costs and their enforcement classes differ, not because they are
independent problems.

---

## 1. Unescaped LIKE wildcards in user-facing search

**Enforcement class: mechanically enforceable.**

### Evidence

Four implementations of the same escape:

| Where | Signature | Notes |
|---|---|---|
| `app/lib/like.ts:6` | `likeContains(term: string): string` | canonical; returns the pattern |
| `app/domain/crm.ts:38` | `likeContains(column, q): SQL` | same name, different arity, returns full `SQL` |
| `app/domain/contacts.ts:67` | `likeContains(column, q): SQL` | byte-identical to `crm.ts`'s |
| `app/lib/submission-list.server.ts:62` | `titleLike(q): SQL` | same logic via `replaceAll` |

`app/lib/like.ts` is imported by exactly **2** files (`app/domain/files.ts:23`,
`app/routes/admin.tasks.tsx:35`).

Nine query sites interpolate user input into a LIKE pattern with **no escape at all**
(`grep -rnE 'like\([^,]+, *\`%\$\{' app/`):

```
app/api/v1/sessions.ts:238            app/routes/admin.forms.$formId.tsx:391
app/routes/admin.evaluation.tsx:263   app/routes/admin.forms.tsx:80
app/routes/admin.evaluation.tsx:315   app/routes/admin.forms.tsx:81
app/routes/admin.evaluation.$planId.tsx:249  app/routes/reviews.tsx:187
                                      app/routes/reviews.tsx:243
```

All nine take the value from a query string or form field (`q`, `search`, `pickerQ`).

### Cost

Wrong search results, silently. `_` matches any character and `%` matches anything,
so an organizer filtering the review queue for a session called `A_B Testing` also
matches `AxB Testing`, and searching the literal `100%` matches every row. At the
scale this product targets — hundreds of submissions — search is the primary
navigation tool, and a search that quietly lies is worse than one that errors.

**This is not SQL injection.** Drizzle parameterizes the pattern; the value never
reaches the SQL text. It is a correctness and UX bug only, and the report should not
be read as a security finding.

### Counter-example in this repo

`app/domain/files.ts:650-655` and `app/routes/admin.tasks.tsx:298-301` both import
`likeContains` from `~/lib/like` and pass the result to `like(...)`. That is the
whole fix, already written, already exported.

### Detection sketch

ESLint rule `escaped-like-patterns`:

- Match `CallExpression` where the callee resolves to `like` / `notLike` / `ilike`
  imported from `drizzle-orm`.
- Report when `arguments[1]` is a `TemplateLiteral` with at least one `expression`.
- Clean fix is `like(col, likeContains(q))`, which is a `CallExpression` argument and
  never fires.

### False positives

A template-literal pattern built entirely from server-controlled constants would be
flagged wrongly. **Against current code the false-positive set is empty**: the two
LIKE calls over server-controlled prefixes use plain string literals, not template
literals (`app/domain/schedule-update.ts:107-108`,
`like(emailOutbox.dedupeKey, "decision:accept:%")`), and the sentinel-prefix match at
`app/routes/admin.settings.team.tsx:421` uses a raw `sql` template, which this rule
does not inspect. All 9 current hits are real. If a legitimate constant-interpolation
case appears later it needs a suppression comment, and there are zero today.

---

## 2. Nine ways to render a date; two of them lost the timezone

**Enforcement class: mechanically enforceable (narrow), plus prose for the consolidation.**

### Evidence

Three exported helpers with near-identical names and overlapping behavior:

| Where | Name | Refs / files |
|---|---|---|
| `app/lib/dates.ts:3` | `formatInTimeZone(date, timeZone)` | 20 / 6 |
| `app/lib/format-date.ts:5` | `formatInTimezone(d, timeZone, style)` | 13 / 3 |
| `app/lib/format.ts:20` | `formatInTz(date, timeZone, style)` | 31 / 12 |

`formatInTimeZone` and `formatInTimezone` differ only in the case of one letter.

All three carry a doc comment asserting the same invariant:

- `app/lib/dates.ts:1` — "Render a timestamp in the EVENT's timezone (never the server's or the viewer's)"
- `app/lib/format-date.ts:2` — "every admin/public surface renders them in the EVENT's IANA timezone (never the server's or viewer's locale zone)"
- `app/lib/format.ts:19` — "Render a real instant … in the EVENT's timezone"

Three authors each wrote the rule down. None of them searched for it first. That is
the clearest single piece of evidence in this audit that the problem is discovery,
not knowledge.

Six more display formatters are built inline in route or feature files:
`app/cfp/server.ts:83`, `:89`, `app/routes/admin.forms.$formId.tsx:422`,
`app/routes/admin.forms.tsx:151`, `app/routes/admin.settings.airtable.tsx:140`,
`app/routes/admin.settings.team.tsx:512`.

**Two of the six dropped the `timeZone` option** — verified by hand after a scripted
scan (the script over-reports; see false positives):

- `app/routes/admin.settings.airtable.tsx:140-146` — sets `timeZoneName: "short"` but
  no `timeZone`. Used by `formatTime` (`:148`), rendered at `:261`, `:293`, `:298`,
  `:332`.
- `app/routes/admin.settings.team.tsx:512-516` — no `timeZone`. Rendered at `:663`.

Counting method: scan every `Intl.DateTimeFormat` construction and `toLocale*` call
in `app/` and `workers/`, then hand-verify each apparent miss against its enclosing
function signature. Every hit in `app/lib/` and `app/agenda/` passes `timeZone`
through from a parameter; the two above genuinely do not.

### Cost

An organizer on `/admin/settings/airtable` sees the last-sync time rendered in UTC
during SSR with the abbreviation `UTC` beside it, then watches it change after
hydration. That timestamp is the one signal for "is my Airtable sync stale?", and it
is both wrong and visibly unstable. `/admin/settings/team` shows join dates that can
be off by a day for anyone west of UTC. Neither surface has a test.

Separately, the three-helper split costs every future author the same 10 minutes of
deciding which one to use, and guarantees the drift continues.

### Counter-example in this repo

`app/lib/program.ts:70-110` — four private formatters (`zonedParts`, `timeLabel`,
`shortDayLabel`, `longDayLabel`) that all take `timeZone: string` as a required
parameter, so omitting it is a compile error. `app/lib/event-time.ts:28,42` and
`app/lib/forms.ts:294,341` follow the same shape. The invariant is enforced by the
signature, not by a comment.

### Detection sketch

ESLint rule `explicit-display-timezone`:

- Match `new Intl.DateTimeFormat(...)` whose options `ObjectExpression` contains any
  date/time-component key (`dateStyle`, `timeStyle`, `year`, `month`, `day`, `hour`,
  `minute`, `weekday`, `timeZoneName`).
- Report when that object has no `timeZone` property (accepting shorthand `timeZone`).
- Same check for `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` whose
  second argument is an `ObjectExpression`.

### False positives

A naive version of this scan produced **21 hits, of which 19 were wrong** — the
option object spans multiple lines and passes `timeZone` shorthand further down. Two
guards remove all of them:

1. Require at least one date/time-component key. This drops
   `Intl.DateTimeFormat().resolvedOptions().timeZone` (timezone *detection*, 2 sites:
   `app/settings/event-form.tsx:129`, `app/routes/onboarding.tsx:340`) and the two
   `Number.prototype.toLocaleString` calls (`app/components/rich-text.tsx:42`,
   `app/routes/admin.forms.$formId.tsx:1378`), which format numbers, not dates.
2. Read the whole `ObjectExpression`, not a line window, and accept shorthand.

With both guards the rule fires on exactly the 2 real bugs and nothing else. Without
guard 1 it is unusable. **Legitimate exceptions today: zero.**

The consolidation half — "there is one display formatter, in one file" — is not
mechanical and belongs in `docs/rules/engineering.md` prose.

---

## 3. Two HTML sanitizers with different policies, one untested

**Enforcement class: judgment (prose), with one mechanical half.**

### Evidence

Two independent sanitizers:

| | `app/lib/html.ts:86-132` | `app/cfp/server.ts:314-384` |
|---|---|---|
| Keeps `h1` | yes | no |
| Drops `form` / `link` / `meta` | yes | no |
| Drops `noscript` | no | yes |
| Strips comment nodes | yes | no |
| Link `rel` | `noopener noreferrer` + `target="_blank"` | `noopener noreferrer nofollow`, no target |
| Tag-name matching | `.toLowerCase()` | raw `el.tagName` |
| Trims result | yes | no |

Both write the **same columns**:

- `contacts.bio` ← `app/routes/portals.$eventSlug.$portalId.profile.tsx:214` and
  `app/routes/admin.contacts_.$id.tsx:396` (lib/html) vs `app/cfp/server.ts:654` (cfp).
- submission description ← `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx:579`
  vs `app/cfp/server.ts:810`.

`grep -rn "lib/html" test/` returns **nothing**. The only sanitizer test in the repo
is `test/cfp-definition.test.ts:221-232`, and it exercises the *cfp* one. The
untested sanitizer's own comment claims it blocks "a stored-XSS path to an organizer
session."

The same file pair also carries two divergent `stripHtml` implementations
(`app/lib/html.ts:28-40`, `app/lib/program.ts:160-172`) whose entity-decoding order
differs. Running both on `<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>`:

- `app/lib/html.ts` → `<script>alert(1)</script>`
- `app/lib/program.ts` → `&lt;script&gt;alert(1)&lt;/script&gt;`

`app/lib/program.ts:169` decodes `&amp;` last and says why. `app/lib/html.ts:33`
decodes it second and double-decodes as a result. I traced every sink: outputs land
in React-escaped JSX (`app/routes/reviews.$id.tsx:341`→`:651`) or in the AI provider
payload (`app/domain/ai-review.ts:79`). The repo has exactly two
`dangerouslySetInnerHTML` call sites (`app/components/rich-html.tsx:17`,
`app/cfp/ui.tsx:132`) and neither consumes `stripHtml`. **This is a correctness bug
and a false claim in a comment, not a live XSS.**

`escapeHtml` is byte-identical at `app/lib/html.ts:2-9` and
`app/lib/email-render.ts:67-74`.

### Cost

A speaker who pastes an `<h1>` into their bio through the public CFP loses it; the
same paste through the speaker portal keeps it. Nobody can answer "what markup is
allowed in a bio?" without knowing which form the speaker used. And the sanitizer
that stands between anonymous public input and an organizer's admin session has no
test asserting it does anything at all — the reassurance is in a comment.

### Counter-example in this repo

`normalizeEmail` (`app/lib/auth.ts:37-39`) is the model: one definition, imported at
every write path (`app/lib/reviewers.ts:96`, `app/domain/crm-fields.ts:201,277`,
`app/domain/accept.ts:287,322`, `app/domain/participant-notifications.ts:74-140`),
with the invariant pinned in schema comments at `app/db/schema.ts:53` and `:1436` so
the next author finds it from the column definition. No second implementation exists.

### Rule text (for `docs/rules/engineering.md`)

Judgment-class, so it needs prose the AI rule-reviewer can apply — `tooling/pr-review/agents.mjs`
spawns one reviewer per `docs/rules/*.md` doc, so text added there is enforced on
every PR:

> **One implementation of a content-safety primitive.** HTML sanitizing, HTML
> stripping, HTML escaping, and email normalization each have exactly one definition
> in the repo, and it lives in `app/lib/`. A second definition is not allowed even if
> it is "just for this surface" — divergent policies over the same DB column are a
> product bug, and the divergence is invisible in review because the two copies are
> never in the same diff. Every one of these primitives has a direct unit test; a
> comment asserting that a function blocks an attack is not evidence that it does.

The narrow half **is** mechanical and worth pairing with the prose: a rule that fails
any declaration named `sanitizeHtml`, `stripHtml`, or `escapeHtml` outside
`app/lib/html.ts`. False positives: none today — it would flag exactly the 3 existing
duplicates, all of which are the finding.

---

## 4. Enum→label maps typed `Record<string, …>`, guarded by `??` at every call site

**Enforcement class: mechanically enforceable.**

This is also where the brief's "defensive checks on already-validated data"
hypothesis actually landed: the defensive check exists *because* the type was
loosened, and it is what makes the failure silent.

### Evidence

Label/tone lookup maps, counted by scanning every `const *_LABEL(S)?|_TONE(S)?` with a
`Record<…>` type annotation across `app/` and `workers/`: **13 typed `Record<string, …>`
vs 9 typed by a union.** Of the 13 loose ones, **9 project a schema enum tuple** that
already exists in `app/db/schema.ts`:

| Loose map | Schema enum it shadows |
|---|---|
| `app/domain/files.ts:235` `FILE_REVIEW_LABEL` | `FILE_REVIEW_STATUS` (`schema.ts:1261`) |
| `app/domain/files.ts:242` `FILE_REVIEW_TONE` | same |
| `app/routes/admin.tasks_.$assignmentId.tsx:45` `FILE_STATUS_TONE` | same — and a byte-identical copy of the exported `FILE_REVIEW_TONE`, in a file that already imports from `~/lib/task-status` |
| `app/lib/task-status.ts:3` `TASK_STATUS_TONE` | `TASK_STATUS` (`schema.ts:1131`) |
| `app/lib/task-status.ts:9` `TASK_STATUS_LABEL` | same |
| `app/lib/evaluation.ts:19` `EVAL_STATUS_TONE` | `EVALUATION_STATUS` (`schema.ts:958`) |
| `app/lib/evaluation.ts:25` `REVIEW_DECISION_TONE` | `REVIEW_DECISION` (`schema.ts:910`) |
| `app/routes/admin.emails_.history.tsx:34` `STATUS_TONE` | `EMAIL_STATUS` (`schema.ts:1531`) |
| `app/routes/admin.forms.$formId.tsx:97` `FIELD_TYPE_LABEL` | `FIELD_TYPE` (`schema.ts:389`) |

Every call site then supplies a fallback: **27 occurrences of `MAP[expr] ?? …` across
13 route files** (`grep -rnE "(LABEL|LABELS|TONE|TONES)\[[^]]+\]\s*\?\?" app/`), e.g.
`app/routes/admin.tasks.tsx:1241-1242`:

```tsx
<StatusBadge tone={TASK_STATUS_TONE[a.status] ?? "neutral"}>
  {TASK_STATUS_LABEL[a.status] ?? a.status}
```

`a.status` is a D1 column constrained to the `TASK_STATUS` enum. The `??` can only
fire when the map is incomplete — and when it fires, it renders the raw DB string.

The supply side confirms the mechanism: **10 of the 24 `as const` enum tuples exported
from `app/db/schema.ts` are never imported anywhere** — `USER_ROLE`, `FORM_TYPE`,
`FIELD_RECORD_TYPE`, `FORM_FIELD_SECTION`, `PLAN_STATUS`, `QUESTION_TYPE`,
`EVALUATION_STATUS`, `EMBED_TYPE`, `EMAIL_CATEGORY`, `EMAIL_TRIGGER`. The single
source of truth is published and nobody subscribes.

### Cost

`app/db/schema.ts` is integration-owner-only, so enum values are added by someone who
is not the author of the route that renders them. When that happens today, `pnpm
typecheck` passes, no test fails, and the organizer sees `pending_feedback` in a gray
badge where a label belongs. The `??` fallback is what converts a compile error into
a cosmetic production defect — which is why this ranks above the copy-paste findings
despite being cheaper to fix.

### Counter-example in this repo

`app/settings/event-form.tsx:60-75`:

```ts
const FIELD_TYPE_LABELS: Record<(typeof fields.$inferSelect)["type"], string> = { … }
```

with the comment: *"Keyed off the SCHEMA union, not the local array — a new
FIELD_TYPE value fails compilation here until it gets a label and a dropdown entry."*
That is exactly right, and it makes the sibling case sharper: `admin.forms.$formId.tsx:97`
lists **the same 11 field types** with the key type widened to `string`. Adding a
field type breaks the build in `admin.settings.library.tsx` (good) and silently
renders blank on `/admin/forms/:formId`. Also correct:
`app/routes/admin.crm.fields.tsx:69`, `app/routes/admin.portal-forms.tsx:46`,
`app/db/constants.ts:64`, `app/lib/pipeline.ts:13,24`, `app/lib/forms.ts:27`.

### Detection sketch

ESLint rule `union-keyed-lookup-maps`:

- Match a `VariableDeclarator` whose type annotation is `TSTypeReference` `Record`
  with `typeArguments[0]` = `TSStringKeyword`, and whose initializer is an
  `ObjectExpression` with **≥3 properties, all non-computed string/identifier keys**.
- Report: "a closed key set typed as an open one — key this `Record` by the union it
  projects."

### False positives

**4 of the 13 current hits are legitimate** and would need suppression or a narrower
predicate: `app/routes/403.tsx:10` `HOME_LABELS` (keyed by route path),
`app/routes/admin.emails.tsx:42` `AUTO_TRIGGER_LABELS` (keyed by template slug, an
open set), `app/routes/admin.emails_.history.tsx:47` `SYSTEM_SEND_LABELS` (keyed by
dedupe-key prefix), `app/routes/admin.forms.$formId.tsx:1334` `OPERATOR_LABEL` (keyed
by a rule-operator union that lives in `app/cfp/definition.ts`, not the schema — real
but not a schema enum).

That is a 31% false-positive rate on today's code, which is too high for a silent
rule and honest to state. Two ways to narrow it, in order of preference:

1. Only fire when the object's key set is a **subset of an `as const` tuple exported
   from `app/db/schema.ts`**. Zero false positives against current code, catches all 9.
   Requires the rule to read `schema.ts` — heavier, but this is a single-package repo
   and the file is already a fixed, integration-owned path.
2. Fire on the loose form generally and accept 4 suppression comments. Cheaper to
   write, noisier to live with.

I recommend (1). Under (2) the rule is still net-positive but should be paired with
a one-time cleanup of the 4 so it starts from zero suppressions.

---

## 5. `/onboarding` is a copy-paste fork of the settings event form

**Enforcement class: not enforceable — fixable. Do not write a rule for this.**

### Evidence

Five symbols exist twice, once in the settings form and once privately inside
`app/routes/onboarding.tsx`:

| Symbol | Canonical | Fork |
|---|---|---|
| `slugify` | `app/settings/event-form.tsx:102` (**exported**) | `app/routes/onboarding.tsx:314` |
| `FALLBACK_TIMEZONE` | `app/settings/event-form.tsx:109` | `app/routes/onboarding.tsx:321` |
| `SLUG_RE` | `app/settings/event-details.server.ts:12` | `app/routes/onboarding.tsx:30` |
| `isValidTimeZone` | `app/settings/event-details.server.ts:15` | `app/routes/onboarding.tsx:34` |
| timezone-guess `useEffect` | `app/settings/event-form.tsx:129-137` | `app/routes/onboarding.tsx:340-347` |

The bodies are currently identical; `app/settings/event-form.tsx:127` even carries the
comment "mirrors /onboarding". A third variant of the timezone validation lives at
`app/lib/event-time.ts:16-23` (`resolveTimezone`).

### Cost

Low today and rising. Nothing is broken — the copies agree. The cost is that the
first change to slug rules or the timezone fallback lands in one place, and a
signed-up organizer's event gets a different slug than the same name typed on
`/admin/settings`. There is no failing test in that scenario because the two forms
are tested independently, if at all.

I am ranking this fifth deliberately. It is the most *visible* slop in the repo and
the least *expensive*, and treating visibility as cost is how audits produce noise.

### Counter-example in this repo

`app/db/constants.ts` — one file, shared derived constants
(`PARTICIPANT_ROLE_LABELS:64`), imported by both admin and portal surfaces.

### Why no rule

A lint rule cannot tell a forked helper from a coincidentally similar one, and a prose
rule saying "don't copy-paste" is the generic lint essay this audit is supposed to
avoid — the repo's engineering doc already says shared code is shared. The honest
recommendation is a **cleanup task**: delete the five private copies from
`app/routes/onboarding.tsx`, import from `~/settings/event-form` and
`~/settings/event-details.server`, and collapse `resolveTimezone` into
`isValidTimeZone`. One PR, no rule.

---

## Incidents — fix these, do not write a rule

- **`app/routes/admin.files.tsx:94-100` loads every submission title for the event**
  with no limit, to populate a filter `<select>`, immediately after correctly
  paginating the main list (`listFileGroups(..., {page, pageSize: PAGE_SIZE})` at
  `:85-92`). At a real conference this is a several-hundred-option dropdown in the
  SSR payload of every page of the files list. `docs/rules/engineering.md` already
  says every growing list is capped or paginated — the prose exists, only the gate is
  missing, and I checked whether the gate is worth building (below).
  **One occurrence. Fix the query; do not write the rule for it.**

---

## Verified negatives

The brief asked for a list of hypotheses; several are not true here, and a stated
negative is worth more than a padded finding.

- **The ESLint exclusion of `tooling/**`, `scripts/**`, and `drizzle/**` is not hiding
  slop.** I ran the duplicate-block detector, the error-handling scan, and the
  deferral-comment scan against the excluded trees directly. Zero cross-file duplicate
  blocks. `instanceof Error` appears only inside `prefer-error-normalizer.mjs`'s own
  message string. Three `String(error?.message ?? error)` sites, all in scripts where
  the normalizer is not importable. Four empty catches, all legitimate. Every
  TODO/FIXME hit is inside `no-deferral-comments.mjs`'s own regex or the pr-review
  test fixtures. **The exclusion is currently costing nothing.**
- **Error handling is disciplined.** 105 catch blocks across `app/` and `workers/`:
  76 emit `track()`, 12 rethrow or wrap, 6 return an empty result deliberately, 11
  other, **0 empty**. Domain catches branch on `isUniqueViolation` and report per-row
  failures with a stated reason (`app/domain/accept.ts:861-865`,
  `app/domain/schedule-update.ts:454-458`, `app/domain/crm.ts:522-525`,
  `app/domain/contact-merge.ts:933-937`). No inconsistent-swallowing pattern.
- **Tests do not assert what the code does.** 127 test files, 38,614 lines, **5**
  `toHaveBeenCalled` assertions total and **zero** `vi.mock()` calls. The suite runs
  in workerd against real D1 and asserts outcomes. The `meaningful-tests` rule is
  working.
- **Dead code is not a pattern.** Exactly **one** fully unreferenced export in 427
  files: `app/lib/errors.ts:38` `errorName`. 41 more exports are used only inside
  their own file — a naming nit, not a cost. One occurrence is an incident.
- **Forwarding wrappers are not a pattern.** 41 one-statement functions that only call
  another function. I read all 41: they are named domain predicates
  (`normalizeEmail`, `requireAdmin`, `hasSetPassword`, `isSlugTakenError`,
  `hasRealEmailProvider`). Naming a condition is not a useless abstraction. No finding.
- **Bounded loaders are well-followed.** A scanner flagged 53 unlimited queries; I
  hand-checked the list and they are dominated by parent-scoped reads and `count()`
  aggregates. `admin.contacts.tsx`, `admin.portals.tsx`, and `reviews.tsx` all
  paginate or aggregate correctly. Only `admin.files.tsx` above is real. **A lint
  rule here would be almost entirely false positives** — the prose rule plus review is
  the right instrument, and it is already in `docs/rules/engineering.md`.
- **Comment density is healthy.** 99,585 code lines to 4,252 comment lines (4.1%).
  Deferral comments are clean; the 5 app-tree hits for `todo` are the task-status
  string literal.
- **Route loader/action preamble duplication is not slop.** Every CRM route, every
  public program route, and the auth pages repeat the same
  self-auth → `getActiveEvent` → scope → `createTimings` → typed-error-or-redirect
  shape. That is the golden path in `docs/rules/engineering.md`, deliberately
  repeated so a route is readable without following an abstraction. Reporting it
  would be the listicle this audit was asked not to produce.

### One cross-cutting observation, not a separate finding

24 of the 78 modules under `app/{lib,domain,ports,sync,api}` are never imported by any
file in `test/`. Every module in the duplication cluster is in that set:
`app/lib/like.ts`, `app/lib/dates.ts`, `app/lib/format-date.ts`,
`app/lib/submission-list.server.ts`, `app/lib/html.ts`. The repo's convention is
route-level integration testing, so "no direct import" does **not** mean untested —
which is why this is not filed as a finding. It does explain why findings 1–3 could
drift undetected: the duplicated helpers are precisely the ones no test names.

---

## Coverage

**Examined in depth:** `app/lib/`, `app/domain/`, `app/routes/`, `app/settings/`,
`app/cfp/`, `app/db/schema.ts`, `app/api/`, `test/` (aggregate scans plus targeted
reads), `tooling/`, `scripts/`, `eslint.config.mjs`, all five `docs/rules/*.md`.

**Light coverage — a real gap:** `app/sync/`, `app/widgets/`, `app/components/`,
`app/ui/`, `workers/`, and `drizzle/` were covered only by the mechanical scans
(duplicate blocks, catch handling, comment density, label maps, timezone) and not by
directed reading. `app/components/` in particular is where a component-variant drift
pattern would live, and I did not look for one specifically. `docs/rules/process.md`
and `docs/rules/design-system.md` were read for rule-conflict checking only.

**Out of scope by instruction:** the twelve existing rules in `tooling/eslint-rules/`,
and the three rules being added in a parallel lane (runtime `typeof` ban,
`no-loose-variant-objects`, `no-long-comments`).

## Recommended order

1. Fix the 9 unescaped LIKE sites and the 2 timezone-less formatters — both are live
   defects an organizer can hit today.
2. Add `escaped-like-patterns` and `explicit-display-timezone` (zero false positives
   against current code).
3. Add the one-implementation prose to `docs/rules/engineering.md` and a direct unit
   test for `app/lib/html.ts`; collapse the two sanitizers.
4. Add `union-keyed-lookup-maps` in its schema-aware form, and delete the 10
   unreferenced schema enum exports or start importing them.
5. Cleanup PR: de-fork `/onboarding`; collapse the three date formatters into one;
   collapse the four LIKE-escape implementations into `app/lib/like.ts`.
