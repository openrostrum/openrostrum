# SessionBoard Eval Kit — feature documentation

Reference docs for every graded area. Each doc describes **SessionBoard's** documented behavior (the target being cloned): personas, user journeys, filled-state expectations, the feature inventory, and the rationale behind each rubric item. Rubric IDs in eval reports trace back to these files. Grading is implementation-agnostic — clones are judged on functionality and what populated screens communicate, never pixel fidelity.

| File | Covers |
|---|---|
| [`00-how-sessionboard-works.md`](00-how-sessionboard-works.md) | The end-to-end narrative: product map (CFP → review → acceptance → portal → content → agenda → widgets), organizer and speaker journeys, the full video-walkthrough feature-surface map, and cross-cutting expectations for clones. Start here. |
| [`01-call-for-papers.md`](01-call-for-papers.md) | CFP: the 4-section submission form builder, custom fields and conditional logic, form settings (close date, reminders, limits), and the public submission flow with draft save. |
| [`02-abstract-management.md`](02-abstract-management.md) | Review & disposition: the 5-stage status pipeline, evaluation plans (anonymized review, rating scales, weighted rubrics, evaluator assignment), and the separate accept/decline notification step. |
| [`03-speaker-management.md`](03-speaker-management.md) | Contacts → speakers → sessions assignment, the branded speaker portal (tasks, resources, appearance, visibility), and invitation acceptance. |
| [`04-content-management.md`](04-content-management.md) | Content collection: file requests, per-session uploads typed Presentation/Poster/Handout, versioning with history, and speaker↔admin comments. |
| [`05-ai-agenda.md`](05-ai-agenda.md) | Agenda builder: List/Day/Week/Month/Rooms views, drag-and-drop scheduling, track colors, conflict detection, and the AI agenda builder (basics only). |
| [`06-public-widgets.md`](06-public-widgets.md) | Public embeds: sessions list, speakers list/gallery, agenda, itinerary — accepted-and-visible content only. |
| [`07-speaker-crm.md`](07-speaker-crm.md) | Org-level speaker CRM: cross-event contacts, segments, import, history. **Optional area** (extra credit). |
| [`research/`](research/) | Raw research JSON distilled from sessionboard.com and learn.sessionboard.com — per-area sources, journeys, feature inventories, draft rubrics, sample data, and known gaps. The docs above are synthesized from these. |
