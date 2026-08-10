# Design system — "Gallery"

The locked OpenRostrum skin (owner-approved 2026-08-09; visual spec + live demo published as artifacts). Quiet chrome for a tool used 8 hours a day; identity carried by craft, type, and petrol micro-doses. **Implementation = the `@theme` tokens in `app/app.css` + the `app/ui` primitives. Routes never make a visual decision** — see [`engineering.md`](engineering.md) → Design system for the enforcement.

## The one law: petrol means "you are here / this is chosen"

Petrol appears in exactly five jobs — wayfinding (active nav icon, active tab underline + count), selection (checked controls, selected-row leading rule + wash), focus (the outline), inline prose links (`TextLink` — table titles stay ink), and the brand (the mark's platform bar + the wordmark's "Open"). It never fills a large surface and never touches data: **the status pills are the only color in a table**. A sixth use of petrol is a design regression.

## Tokens (`app/app.css`)

| Token | Light | Dark | Job |
|---|---|---|---|
| `canvas` | `#FAFBFA` | `#111413` | page + sidebar ground |
| `surface` | `#FFFFFF` | `#171B1A` | cards, fields, popovers |
| `fg` / `fg-muted` / `fg-faint` | `#171A19` / `#5E6764` / `#8A928F` | `#EDF1F0` / `#93A09D` / `#6B7573` | text tiers (faint = placeholder/disabled) |
| `hair` / `hair-strong` | `rgba(23,38,36,.08/.16)` | `#252B2A` / `#364240` | hairlines / control borders — alpha in light (recedes), solid in dark (alpha glows) |
| `thead` / `chip` | `#F5F7F6` / `#EFF2F1` | `#1A201F` / `#212827` | table headers / count chips, skeletons, active nav |
| `petrol` / `petrol-hover` / `petrol-wash` | `#0E6C66` / `#0A5750` / `#E4F0EE` | `#2FBFAD` / `#46D6C4` / `rgba(47,191,173,.13)` | the one accent (see the law) |
| `row-hover` / `row-selected` | fg-alpha / petrol-alpha | white-alpha / petrol-alpha | table states |
| `ink` / `on-ink` | `#171A19` / `#FFFFFF` | `#EDF1F0` / `#171B1A` | primary button (inverts across themes) |
| `danger` | `#D5163F` | `#F47C95` | errors, destructive |
| `radius-control/card/shell` | 7 / 10 / 12px | same | shape scale |
| `shadow-card/btn/control` | stacked alpha shadows | deeper | depth: hairline ring + two soft layers, never a single hard border |

All chrome colors resolve via `light-dark()`, and the document's scheme is the **tri-state theme** (System / Light / Dark, default System): an explicit choice persists as a cookie the root loader reads to pin `color-scheme` on `<html>` server-side — SSR carries the right scheme, so no first-paint flash — while System clears the cookie and the OS decides. Components **never write `dark:` variants, no exceptions**: the media query desyncs the moment a visitor overrides the OS, so even `StatusBadge`'s conventional status hues (deliberately not skin tokens — they survive a re-skin) resolve via `light-dark()` palette pairs. Two route pins outrank the cookie (`handle.colorScheme`): the marketing homepage stays canonical light (brochure, owner decision), and `/embed/:publicId` always follows the viewer's OS — a third-party iframe never sends the SameSite cookie, so the same-origin preview must not follow it either. The control is `ThemeToggle` (`app/components/theme-toggle.tsx`), placed in the admin sidebar user area and the auth-page footer.

## Type & grid

- **Bricolage Grotesque 600** (`font-display`): page titles 23px/-0.01em, wordmark, empty-state headings. Tool scale, never poster.
- **IBM Plex Sans** (`font-sans`): 13px body · 12.5px secondary · 11px/600 caps labels (+0.06em) · weights 400/500/600 only. **No weight changes between states** (layout shift).
- **IBM Plex Mono 500** (`font-mono`): data literals only — IDs, counts, dates, pagination — always `tabular-nums`. Never headings (terminal cosplay).
- **Grid**: 34px controls · 46px table rows · 8px spacing steps.
- **Form-stack rhythm** (sanctioned exception to the 8px steps): vertical field stacks inside a form use `gap-[13px]`; page-level stacks on the focused auth/onboarding screens (login, signup, set-password, unsubscribe) use `gap-7` (28px). 13px sits between "fields are one unit" (8px reads cramped with 34px controls + 5px label gaps) and "fields are separate cards" (16px) — shipped house-wide, so treat it as the rule, not a drift.
- Fonts self-hosted in `public/fonts/` (woff2 + OFL license texts); preloaded in `root.tsx`. No font CDN, ever.

## Brand mark

An ink letter **O standing on a petrol platform** — the name drawn literally: *Open*, raised on the *rostrum*. Two flat fills, no gradients; the O is `currentColor` (theme-follows-text), the platform is petrol.

- **Source of truth**: `Mark` in `app/ui/shell.tsx` (24×24 viewBox). `Wordmark` composes it; routes never draw the mark themselves.
- **Static copies**: `public/favicon.svg` (theme-aware via internal media query) · `favicon.ico` (16/32/48) · `apple-touch-icon.png`. If the geometry ever changes, regenerate all three — they are the same shape or they are wrong.
- **Do not restyle casually**: this geometry survived a 12-reader blind-read gauntlet (adversarial review, 2026-08-09); the tangent ring-on-bar contact and the bar's inset width are deliberate, tested decisions — overlap and flush-width variants tested measurably worse.

## States

- **Focus**: `outline: 2px petrol, offset 2px` on every interactive primitive — the offset keeps the ring against the page ground where it passes 3:1 in both themes.
- **Hover**: background/color shifts only, 120–150ms ease-out. **Press**: `scale(0.97)`, 160ms, `motion-reduce` exempt.
- **Disabled**: `chip` background + `fg-faint` text — a token, never an opacity.
- **Selected row**: wash + ONE 2px petrol rule on the leading cell only (a per-cell shadow leaks ticks at every column boundary).
- **Empty states** say why and what to do next (`EmptyState`); **loading** holds the page shape (`SkeletonRows`), never a spinner for lists.
- **Track/user colors** render as a dot beside muted text (`Chip`), never as a filled pill — arbitrary backgrounds can't guarantee label contrast.

## Primitive inventory (`app/ui`)

`Button`/`ButtonLink` (primary=ink, ghost) · `Field`/`Input`/`Select` · `SearchInput` · `TextLink` · `PageHeader` (title + mono count chip + actions slot) · `Panel` · `Table`/`THead`/`Th`/`TBody`/`Tr`/`Td`/`EmptyRow`/`TableFooter` · `Tabs`/`Tab` · `StatusBadge` (+`SUBMISSION_STATUS_TONE`) · `Chip` · `Avatar`/`AvatarStack` · `EmptyState` · `Skeleton`/`SkeletonRows` · `Icon` (one set, 1.7 stroke, round caps) · `Sidebar`/`SidebarSection`/`SideNavLink`/`Mark`/`Wordmark`. New primitive = integration-owner request, like a schema column.

## Motion law

Vendored skill [`emil-design-eng`](../../.agents/skills/emil-design-eng/SKILL.md): ease-out for enter/exit (never ease-in), UI under 300ms, never animate keyboard-initiated actions, `prefers-reduced-motion` respected. Currently in use: hover transitions + press feedback only.
