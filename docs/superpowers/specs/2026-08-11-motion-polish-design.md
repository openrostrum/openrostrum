# Motion Polish Design

## Goal

Make OpenRostrum feel physically coherent without making anyone wait. Motion is justified by outcome timing: feedback that runs in parallel with an already-available result can be used freely when subtle; motion that delays reading or acting is rejected. The Gallery skin stays quiet and functional.

## Architecture

Motion decisions live in `app/app.css` tokens and `app/ui` primitives. Shared components compose those primitives. Route, agenda, CFP, and widget callers may change composition to consume a primitive, but do not gain motion classes.

Add two duration tokens and two curves:

- feedback: a quick response for hover, press, selected-state color, and transient acknowledgement;
- enter: a restrained arrival for occasional floating or expanding surfaces;
- responsive: the standard physical curve for state feedback;
- settle: a stronger ease-out for newly mounted surfaces.

Existing shared hover and press treatments adopt the tokens so motion no longer depends on scattered numeric utilities. Every new transition carries a reduced-motion override.

## Surface decisions

### Motion added

- **Modals and alert dialogs:** the backdrop appears through opacity while the centered panel settles from a near-final scale and opacity. Content is interactive immediately; dismissal is not delayed for an exit animation. The shared modal owns focus return, Escape dismissal, focus containment, semantics, sizing, and motion.
- **Popover menus:** event switcher, theme menu, and submission-form actions use one anchored floating-surface primitive. The panel enters from the trigger edge with a small opacity/translate/scale settle. Selecting or dismissing remains immediate.
- **Occasional inline reveals:** the add-submission panel, rich-text link controls, and shared inline confirmation reveal receive a short opacity/translate settle. Layout reserves no artificial animation time; the outcome exists immediately.
- **Transient acknowledgements:** copy/download acknowledgements appear with a short opacity/translate settle. The action itself completes independently.
- **Existing hover/press/selection feedback:** buttons, links, table rows, tabs, sidebar controls, and menu rows retain their parallel state feedback but use shared duration/easing tokens and complete reduced-motion coverage.

### Deliberately static

- **Tabs and route content swaps:** content changes immediately; only the existing active-color feedback transitions.
- **Search, filters, table selection, pagination, and status changes:** data and controls update immediately. Added entrance motion would compound in all-day workflows.
- **Form steps, conditional questions, validation errors, and field-type-dependent controls:** the new state appears immediately. Conditional questions specifically have a sub-100ms experience contract, and errors must not be visually delayed.
- **Rich-text toolbar marks, portal task tabs, file names, and character counters:** direct manipulation remains direct; color/text state changes are sufficient.
- **Drag-and-drop, agenda slot movement, and conflict recomputation:** pointer/keyboard geometry stays coupled to input. Decorative settling would make placement feel less precise.
- **Show-more text, editors, inline delete/removal guards, and dense configuration panels:** these reflow surrounding content. Opacity cannot hide the layout jump, and animating layout would add waiting and jank, so they remain immediate unless already covered by the shared confirmation reveal.
- **Skeleton pulse:** retained as the sole loading motion with its existing reduced-motion fallback.
- **Theme color change:** the palette switches immediately; only the menu itself moves. A whole-page color interpolation would be conspicuous and can reduce legibility during the change.
- **Marketing hero first paint:** remove the current long entrance rather than tokenizing it; delaying the first readable headline conflicts with the goal.

## Primitive changes

- Expand `Modal` into the one dialog shell for ordinary dialogs and alert dialogs, with size and semantic options plus focus behavior.
- Add an anchored `PopoverSurface` primitive for top/bottom and start/end/stretch placement.
- Add a small `MotionReveal` primitive for newly mounted inline content and transient feedback.
- Keep animation state in CSS. React continues to own only whether a surface exists; dismissal is not delayed to manufacture exit motion.

## Error handling and accessibility

Motion never changes mutation timing, validation, focus order, or error visibility. Modal focus returns to the invoking control, Escape closes when permitted, and Tab stays inside the open modal. Reduced-motion users receive the final state immediately with no transform or opacity transition. Browsers without starting-style support receive the final state without animation.

## Verification

Run the full verifier, then exercise locally:

- open and dismiss each modal family;
- open anchored menus from each placement;
- trigger add-submission, link controls, confirmations, copy, and download feedback;
- repeat modal/menu/feedback checks in light and dark themes;
- emulate `prefers-reduced-motion: reduce` and verify every added surface appears immediately;
- confirm keyboard focus, Escape, and Tab behavior;
- confirm tabs, search, conditional fields, table selection, and drag interactions remain immediate.

Run one judge-loop round with suffix `-H8`, merge `origin/main` if it moved, run verification again, and create the requested unmerged PR with the full audit table as its decision record.
