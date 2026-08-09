# Scenario suite — the verb-shaped ground truth

End-to-end user scenarios in the same shape as the judges' eval kit
(persona → steps → observable success signals). These are the product's
**definition of done**: reviewer agents verify features by EXECUTING scenario
steps against the running instance — never by feature checklists. Design
changes (schema/ports/specs) must be re-walked against the scenarios whose
`touches:` header names the changed artifact.

**Scope**: P0 + committed P1 reaches only (see SCOPE.md tiers). No P2.

## Why this exists (the defect class it kills)

Inventory validation ("does every noun exist?") passed a design in which a
conditional rule could never trigger on the built-in Format dropdown, and in
which nothing required the toggle to happen without a page reload. Scenarios
are verb-shaped: they force cross-seam interactions and experience qualities
that checklists cannot see. See git history / docs/flows/ for the full story.

## File format (`NN-module.yaml`)

```yaml
module: form-builder
# `touches` is filled by the WALKER (design-side), not the author:
touches:
  tables: [forms, fields, formFields]
  ports: []
  routes: [admin.forms.tsx]
scenarios:
  - id: FB-S1
    name: Organizer builds a form with a conditional question
    persona: admin            # admin | speaker | reviewer | anonymous
    steps: |
      1. <concrete action with concrete values — never "configure X">
      2. ...
    success_signals:
      - <observable outcome a reviewer can screenshot/query/assert>
      - "EXPERIENCE: <what the user watches happen — no reload, instant, …>"
```

## Authoring rules

1. **Concrete values, always.** "Set close date 2027-04-30", not "set a close
   date". Concreteness is what forces the walker to produce real artifacts.
2. **Every scenario carries ≥1 EXPERIENCE signal** (interaction quality: no
   full-page reload, instant filtering, works logged-out, mobile-usable —
   whatever the step actually demands).
3. **Assume real scale** (NORTH STAR): hundreds of contacts/submissions. If a
   step involves a list, a signal must say how it behaves at that scale.
4. **Unhappy paths are steps, not footnotes**: empty required fields, illegal
   transitions, double-submits, logged-out access to protected pages.
5. Scenarios may reference each other's outputs (like the eval kit does:
   "the URL recorded in CFP-S1") — state the dependency explicitly.

## Walker rules (design-side validation, pre-swarm)

For EVERY step, produce the **concrete artifact** that serves it — the actual
rule JSON, the actual SQL against schema.ts tables, the actual route path, the
actual port call with values. Naming the mechanism ("questionRule handles it")
is NOT a walk — write the artifact or file the gap. Output per file: the filled
`touches:` header + a gap list (step → what's missing → severity).
