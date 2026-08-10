# Engineering conventions — how code is written here

House conventions only. The **mandatory platform rules** (D1 batch, react-router-only imports, WebCrypto hashing, R2, email, Tailwind, routing) live in [`tech-stack.md`](tech-stack.md) — read that first; nothing there is restated here. For RR7 framework-mode idioms (loaders/actions/typegen), consult the vendored [`react-router` skill](../../.agents/skills/react-router/SKILL.md) before guessing from memory.

## The pattern to copy [lint-assisted]

`app/routes/admin.submissions.tsx` is the **golden path** — a FULL feature slice, copy its whole shape:
`loader` (SELF-authenticate → scope reads to the ACTIVE event) → `action` (SELF-authenticate → parse `FormData` through the drizzle-zod schema, **`.min(1)`-refined so required strings can't be blank** → server-derive tenant fields, never trust client `eventId`/`status` → `db` write → typed field errors OR `redirect`; never leak raw errors) → `<Form>` + typed component (`./+types/*`) → route `ErrorBoundary`. Both halves instrument: DB work wrapped in `createTimings().time()` surfaced as a `Server-Timing` header, mutation outcomes emitted as `track()` events ([`observability.md`](../observability.md)). The view composes `~/ui` primitives exclusively (see Design system below). Its functional oracle is `test/admin.submissions.route.test.ts`.

## Design system — routes compose, `app/ui` constructs [lint-enforced: `ui-primitives-only`]

**Every visual decision — color, border, radius, shadow, typography — lives in `app/ui/` primitives and the `@theme` tokens in `app/app.css`. Routes speak layout only** (flex/grid/gap/padding/margin/width) and compose primitives: raw `<button>/<input>/<select>/<table>…`, skin utilities, and inline `style` are lint-banned in `app/routes/`. Primitives expose typed variants (`variant="ghost"`, `kind="numeric"`), **never a `className` prop** — the type-checker enforces it. Spacing between siblings is the parent's `gap`, never a primitive's margin.

- The skin is **locked**: "Gallery" — full contract (tokens, type, grid, states, the petrol law) in [`design-system.md`](design-system.md). Chrome colors are semantic tokens resolved via `light-dark()` — components never write `dark:` variants for chrome (`StatusBadge`'s conventional status hues are the one sanctioned exception). Re-skinning edits tokens + `app/ui` **with zero route diffs** — that property is the point, keep it true.
- **Motion is skin too**: `transition-`/`duration-`/`ease-`/`animate-` are banned in routes like any other skin utility — animation lives in primitives. When primitives gain motion (skin-design time), the law is the vendored [`emil-design-eng` skill](../../.agents/skills/emil-design-eng/SKILL.md): ease-out for enter/exit (never ease-in), UI under 300ms, `scale(0.97)` press feedback, never animate keyboard-initiated actions, `prefers-reduced-motion` respected.
- `app/app.css` itself is lint-guarded [`global-css-only`]: only the Tailwind import, `@theme` tokens, `@keyframes`, and `html`/`body`/`:root` rules — it can never become a second component-styling system.
- **A new primitive is an integration-owner request** — exactly like a schema column (same pre-commit guard on `app/ui/` + `app.css`; owner overrides with `ALLOW_SCHEMA_CHANGE=1`). Never build a one-off in a route; never fork a primitive.
- **`app/components/` is the sanctioned shared layer for feature-composable components** (integration-owner ruling, 2026-08-10): components that COMPOSE `app/ui` primitives and layout — never new visual decisions (colors/borders/type stay in primitives + tokens). Same no-`className`-prop contract as primitives. Anything two features share graduates here; anything making a genuinely new visual decision remains an `app/ui` request. Consolidation of `app/components/` candidates into `app/ui` happens in integration sweeps.
- **Reviewer obligation:** *"could the whole look change by editing `app/ui` + tokens only, with zero route diffs?"* Any "no" names the violation.
- **Exactly two composition surfaces live outside the tool: `app/marketing/` and `app/widgets/`.** Marketing (composed by the `_index.tsx` landing route) builds the public homepage; widgets builds the anonymous program surfaces (the five public pages + `/embed/:publicId`) — attendee-facing UI the admin primitives don't cover. Neither is the 8-hour admin tool the petrol-law and `ui-primitives-only` govern. Both stay honest by construction: they live outside `app/routes/` (so `ui-primitives-only` never fires) yet are bound by `no-raw-tailwind-colors`, so every color is a `@theme` token and light/dark come free — petrol stays the only accent (wayfinding/selection), and a re-skin is still tokens + `app/ui` + these two surfaces, with zero route diffs. **Admin screens never take skin from either** — anything admin imports from these surfaces must be pure composition of `~/ui` primitives (e.g. `CopyFieldButton`), never a new visual. Nothing else may follow them out; a third styling surface is an integration-owner decision, and `app/widgets/` sits in the same pre-commit guard as `app/ui/` so its primitives change only via the owner. (Widgets ratification decision: the integration owner's, made by merging the public-widgets PR that carries this paragraph.)
- **Shared route views follow the contract, not the folder.** When two routes render one page (e.g. type-scoped tabs), the shared JSX module lives in `app/lib/*.tsx` and carries the same `ui-primitives-only` rule as routes [lint-enforced] — moving JSX out of `app/routes/` never moves it out of the design system.

## Auth [lint-enforced: `require-auth-in-actions`]

**Every `loader` AND `action` self-authenticates** with `requireUser`/`requireAdmin`/`requireRole` from `app/lib/auth.ts`. Do NOT rely on the `admin.tsx` layout loader to protect children: single-fetch lets a client run a child loader alone via `?_routes=`, skipping the layout. A genuinely public route opts out with a `// @public` comment (see `login`/`logout`/`403`).

## Current event

**Never `events.findMany({ limit: 1 })`.** Call `getActiveEvent(env, user)` and scope every query to that event; the app is multi-event (there is an event switcher).

## Bounded loaders

**Every relational query selects only the columns its projection renders** — never `with: { contact: true }` when the view needs a name (full rows make request cost scale with content size, and on public surfaces they carry PII into the Worker only to drop it at projection; this class of loader produced real production 1102s). **Every list a loader returns is capped or paginated with an honest truncation signal** — a count, a "showing first N of M" row, or a show-all link; never a silently clipped table. The deploy runs on a ~10ms CPU budget per request: payload size IS a correctness constraint here.

## Routes, nav, seams

Add your route as a **new file** in `app/routes/` per [`ROUTE-MAP.md`](../ROUTE-MAP.md) — never edit `app/routes.ts`. Sidebar entries are one `app/nav/<feature>.nav.ts` each [lint-enforced: `pure-nav-modules`] — never a shared nav file. External seams go behind a port (`app/ports/*`). Login/logout/403 references live in `app/routes/{login,logout,403}.tsx`.

**Announcement email goes ONLY through `sendAnnouncement` (`app/lib/announcements.ts`)** — it couples the unsubscribe footer, the suppression-checked `kind: "bulk"`, and a required `dedupeKey` in one call; never pass `kind: "bulk"` to the EmailSender port directly. Transactional mail (about the recipient's own submissions/account) uses the port directly and never carries the footer. Merge fields render via `app/lib/email-render.ts` — one renderer for previews and sends.

## No shortcuts — build it right, or raise it [lint-assisted: `no-deferral-comments`]

**The rule:** never decide "later" in code. If the correct implementation exceeds your task, that is a **scope decision**, and you have no authority to make one — escalate it to the integration owner exactly like you'd request a schema column, and it becomes a SCOPE/register row or it gets built now. Everything you merge is the production version of itself.

- **The disease isn't cutting scope — it's inventing a tier.** "For now", "just for the demo", "v0, we'll clean it up later", "quick follow-up" are scope decisions made by someone with no authority, recorded nowhere an owner will see, defaulting to permanent.
- **A legal deferral leaves no trace in code.** The record lives in SCOPE; the unbuilt path **throws** (see the Resend/Airtable prod adapters: `not configured yet`), it never silently degrades — no swallowed errors, no silent no-ops, no hardcoded stand-ins.
- **Reviewer obligation (forced disclosure):** ask the author's work one question — *"what here would be built differently with more time?"* Any answer = build it now, or it goes to the owner as a scope row **before** merge. This is what catches the unlabeled shortcut the lint can't see (swallowed error, unbounded list, hardcoded id, missing empty state — see THE LENS).

## No legacy — always move forward clean [lint-assisted: `no-compat-shims`]

**The rule:** there is no "backward" inside this repo. This is an application, not a library — every caller is in this codebase, so change the thing, **update every caller in the same change** (the strict type-checker finds the stragglers), **migrate data forward in a migration** (never a tolerant dual-format reader, never a dual-write), and **delete the old path**. No shims, no re-export aliases, no `@deprecated` (delete, don't deprecate), no parallel `V2` implementations, no code kept "in case we revert" — git is the archive.

**The only places compatibility exists** are boundaries we don't control, where it's an owner-decided feature with a spec, never a reflex:
- `/api/v1` — the Sessionboard-compatible envelope IS the feature
- links in already-sent emails — unsubscribe/set-password/portal tokens must keep resolving after the send
- published embed snippets — `/embed/:publicId` lives on third-party sites
- `.ics` UIDs — stable so calendar clients update in place instead of duplicating
- the Airtable field mapping — the team's base is theirs

**Reviewer obligation:** *"does this change leave two ways to do the same thing?"* If yes, one of them dies before merge. A shim is a deferral wearing a different coat ("I'll delete the old path later") — the No-shortcuts escalation valve applies: if the forward migration genuinely can't happen in this change, that's an integration-owner decision, not a shim.

## Tests — every test must be able to catch a regression [lint-assisted: `meaningful-tests`]

**The rule:** a test earns its place only by pinning a contract the code could plausibly violate later, with its expected value stated independently of the implementation — from the spec, the scenario, the bug, or the boundary, **never read off the code under test**. If deleting the test would lose nothing a future change could contradict, don't write it.

The litmus (reviewer agents MUST answer all three for every new test):
1. **Could it fail while the code is correct?** If routine intentional edits (rewording copy, renaming, refactoring internals) break it, it's a tax, not a test.
2. **Could it pass while the behavior is broken?** If every collaborator is mocked and the assertions restate the wiring, it proves nothing.
3. **Where did the expected value come from?** "From reading the code under test" = tautology. From the scenario's `success_signals`, the flow doc, the bug report, the boundary condition = a real oracle.

When to write: a bug fix ships with the regression test that fails without the fix (non-negotiable); real branching/boundaries get unit tests; persistence-as-contract (idempotency, uniqueness, scoping, ordering) gets integration tests against real local D1 (our default — the whole suite runs in workerd). **No test** for pass-through wiring, UI copy, trivial mappers, or anything the type system / Zod already guarantees.

Assertions: every test asserts at least one **observable outcome** (return value, thrown error, response, DB state). Mock-call assertions may corroborate, never stand alone — except the load-bearing negative ("403 AND the write never happened"), which still pairs with an outcome. Mock only at **process boundaries** (email/Airtable/Turnstile providers, the clock — that's what the ports' local adapters are for); never mock a sibling app module — use the real one or test against real D1.

Anti-patterns (delete on sight): pass-through tautology (`toHaveBeenCalledWith(input)` on unchanged input) · mock theater (everything mocked, assertions confirm the wiring) · re-derived oracle (expected value computed by the logic under test) · copy/prompt literal (`expect(IMPORTED).toContain("<its own source string>")`) · snapshot-as-coverage. The lint rule catches the mechanical subset; the litmus catches the rest. The true mechanical backstop is mutation testing (Stryker) — post-deadline.

## Comments — write fewer, smaller, on the first try [lint-assisted: `no-citation-comments`]

The default is **no comment**. Write one only when it carries a non-obvious WHY: a hidden constraint, a subtle invariant, a workaround for a specific bug, a security-load-bearing claim, behavior that would surprise a reader. The test — if you delete it, would the next reader **misunderstand** the code? If no, don't write it.

Never write: WHAT the code does (names already say it); change narration ("was P2", "rev. 2", "un-cut"); **references to SCOPE tiers, eval-kit rubric IDs, GAP-REGISTER rows, plans, or tickets** — state the load-bearing constraint directly, without the citation (the crosswalk and register hold those mappings; code never does); restatements of the obvious; multi-paragraph essays (3–4 lines is the ceiling — a longer WHY moves to a doc); self-references. Schema and port files are NOT exempt: the contract is the types and names; a comment there still has to pass the delete test.
