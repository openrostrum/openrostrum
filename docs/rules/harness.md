# Judging-harness & cross-cutting rules

The code-reviewable rules that keep the build survivable by the eval harness (a
Playwright agent with no inbox and ~70 turns/scenario) and hold the cross-cutting
product bar. Extracted from `SCOPE.md`; the rest of SCOPE is what-to-build, not a
review criterion.

## Harness survival

- **Never native `confirm()` / `alert()` / `prompt()`** for a destructive or gating action — the harness auto-accepts native dialogs, so a native confirm is no guard during a judged run. Use an in-app modal.
- **Copyable invite links in the admin UI** for reviewers and speakers — not email-only. The agent has no inbox; an on-screen link is the only way it can become that persona.
- **Route aliases + conventional labels:** `/dashboard` and `/organizer` → `/admin`; bare `/sessions`, `/speakers`, `/schedule`, `/agenda` redirect to the default event's public pages; nav reads "Speakers", "Call for Papers", "Agenda". The homepage links every public surface.
- **Close-date fields accept past dates** — the harness backdates to close a form, then reopens it.
- **User↔contact linking by normalized email:** a speaker who signs up with an email already on the roster lands in that contact's portal (its sessions + tasks).

## Cross-cutting product bar

- **Every list has an empty state** (`EmptyState`) that says why it's empty and the next action — judges start from a fresh event.
- **One shared rich-text editor** (`<RichText/>`) everywhere WYSIWYG is needed — never a second editor.
- **Public pages are mobile-friendly** (CFP form, speaker portal, schedule/embed); admin may be desktop-only.
- **Lists show skeletons, never spinners; pages target sub-second loads** — no loading-spinner theater.
- **Turnstile lives on the public CFP form and `/signup`** (the two anonymous write surfaces — SCOPE #22), behind its port; the judged deploy ships WITHOUT Turnstile keys (capability → no-op pass) so the agent isn't blocked by a challenge it can't solve — that keyless window covers `/signup` too.
- **Suppression/unsubscribe applies to announcements only** (`kind:"announcement"` / bulk). Everything that is a consequence of the recipient's own submission or account — confirmation, accept/decline, invites, password resets, task/draft reminders, schedule updates — is `kind:"transactional"` and ALWAYS delivers; unsubscribing must never hide an acceptance.
