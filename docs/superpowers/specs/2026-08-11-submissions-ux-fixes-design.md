# Submissions UX Reliability Fixes Design

## Goal

Close four judged production defects without changing submission state semantics or weakening decision-email outbox and idempotency guarantees: reliable organizer navigation, reliable public draft resume, predictable rich-text formatting, and an explicit decision-email preview/confirmation boundary.

## Root causes

- All Submissions renders titles as plain text and rows without navigation. Abstracts/Sessions link only the title glyph, while row hover implies a larger hit target.
- The public draft hub hydrates with locale-dependent timestamps and invalid `p > form` markup. Browser traces show React hydration failures before the Resume transition.
- Shared RichText instances are independent. The formatting defect comes from wrapping toolbar-bearing editors in `<label>`: clicking the contenteditable triggers the label’s first labelable descendant, the Bold toolbar button, setting ProseMirror `storedMarks` to bold.
- Bulk accept/decline buttons post final send intents directly. The existing sender correctly renders templates, writes through the transactional outbox, deduplicates by selection key, and finalizes only successful recipients, but no preview boundary exists.

## Design

### Organizer navigation

Render the submission title as a conventional React Router link to the existing detail route. Make non-interactive row space navigate to the same route, while clicks originating from links, buttons, inputs, selects, textareas, or labels retain their existing behavior. The title remains the keyboard-accessible navigation target; the row handler only expands the pointer hit area.

### Draft resume hydration

Render draft and last-saved timestamps with the event timezone and a fixed locale through the shared formatter. Change the footer note container to valid flow content so its logout form is not nested in a paragraph. Resume remains a normal SPA link; no reload-only fallback is needed once hydration is deterministic.

### Rich-text formatting

Keep the canonical Tiptap RichText implementation unchanged. Extend `Field` with an explicit composite mode that renders a non-label container while preserving the visual label and error treatment. Apply composite mode to RichText and multi-control fields, and provide `ariaLabel` directly to each contenteditable. Normal single input/select fields retain native label wrapping.

### Decision-email preview and confirmation

Factor recipient lookup, merge-context construction, template rendering, decision details, and acceptance calendar generation into one read-only decision plan builder. Both preview and confirmed delivery consume that plan, eliminating preview/send drift.

Preview returns:

- decision and template metadata;
- exact eligible recipients, submission titles, rendered subjects/bodies, and attachment state;
- explicit skipped rows/reasons;
- a fingerprint over the rendered plan.

The first bulk action is a non-submitting button that opens a route-local in-app dialog. The dialog shows selected/deliverable counts, template metadata, the exact recipient list, and one per-recipient rendered email at a time. Cancel writes nothing. Confirm posts the existing selection-scoped idempotency key plus the preview fingerprint.

The server rebuilds the plan before delivery. A fingerprint mismatch blocks sending and asks the organizer to refresh the preview. A matching plan continues through the existing sender and transition spine: successful/deduplicated recipients finalize, failures remain staged, outbox history stays authoritative, and retries reuse the same selection key.

## Error handling

- Zero selection, zero deliverable recipients, missing templates, cross-event IDs, ineligible statuses, and batches over 100 fail before any email/status/task/outbox mutation.
- Missing-email and ineligible rows appear as preview skips.
- Provider partial failure and post-send transition failure retain existing replay-safe behavior and user-facing remediation.
- Interactive controls inside navigable rows never trigger navigation.

## Testing and verification

Implement regression tests first for title link contracts, composite field markup, event-time draft rendering/valid footer markup, read-only preview output, zero-write preview, stale-preview blocking, and confirmed-send replay/partial-failure behavior. Keep existing direct sender and route tests green.

After targeted red/green cycles, run `pnpm verify`. Start the app with `pnpm dev:worktree`, then exercise each fix through Chrome against local D1 and inspect console errors, URLs, rendered editor HTML/mark state, submission statuses, and `email_outbox`. Run one judge-loop round with suffix `-F2`, resolve all findings or record evidence-backed dispositions, create the requested PR with a decision-record body, resolve inline AI-review threads, and do not merge.
