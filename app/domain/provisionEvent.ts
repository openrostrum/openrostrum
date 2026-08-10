import type { Db } from "~/db";
import { emailTemplates, languages, portals } from "~/db/schema";

/**
 * The template set every event carries from birth. Senders resolve templates
 * by (eventId, key) — an event missing a key silently never sends that email,
 * so the set here must stay in lockstep with the keys senders look up.
 */
const DEFAULT_EMAIL_TEMPLATES = [
	{
		key: "submission_confirmation",
		name: "Submission Confirmation",
		subject: "We received your submission",
		bodyHtml: "<p>Thanks for submitting!</p>",
		category: "lifecycle",
		trigger: "auto",
	},
	{
		key: "accept",
		name: "Accept Sessions",
		subject: "Your session was accepted",
		bodyHtml: "<p>Congratulations, you are in!</p>",
		category: "lifecycle",
		trigger: "manual",
	},
	{
		key: "decline",
		name: "Decline Sessions",
		subject: "Update on your submission",
		bodyHtml: "<p>Thank you for submitting.</p>",
		category: "lifecycle",
		trigger: "manual",
	},
	{
		key: "reminder_5day",
		name: "Session Form - Five Days Reminder",
		subject: "Five days left to submit",
		bodyHtml: "<p>The form closes in five days.</p>",
		category: "lifecycle",
		trigger: "auto",
	},
	{
		key: "reminder_1day",
		name: "Session Form - One Day Reminder",
		subject: "One day left to submit",
		bodyHtml: "<p>The form closes tomorrow.</p>",
		category: "lifecycle",
		trigger: "auto",
	},
] as const;

/**
 * The template keys every event carries. Senders and template editors must
 * import these instead of hardcoding strings — a key that drifts from this
 * set means an email that silently never sends.
 */
export const EVENT_EMAIL_TEMPLATE_KEYS = DEFAULT_EMAIL_TEMPLATES.map(
	(t) => t.key,
) as [
	(typeof DEFAULT_EMAIL_TEMPLATES)[number]["key"],
	...(typeof DEFAULT_EMAIL_TEMPLATES)[number]["key"][],
];

export type EventEmailTemplateKey = (typeof EVENT_EMAIL_TEMPLATE_KEYS)[number];

/**
 * Every event-creation path must SPREAD this into its batch: an event without
 * its default templates silently never sends its confirmation email, and one
 * without its default speaker portal has no portal URL for the CFP success
 * redirect or any emailed link to resolve to. Returns unexecuted inserts so
 * callers batch them atomically with the event insert.
 */
export function provisionEventDefaults(db: Db, eventId: string) {
	return [
		db
			.insert(emailTemplates)
			.values(DEFAULT_EMAIL_TEMPLATES.map((t) => ({ ...t, eventId }))),
		db.insert(portals).values({ eventId }),
		// Submissions store language "English" by default, so every event starts
		// with that one row — a language dropdown with zero options would render
		// unanswerable on the public CFP. Other taxonomies (tracks/formats/
		// levels/tags) are event-specific editorial choices and stay empty.
		db.insert(languages).values({ eventId, name: "English", position: 0 }),
	] as const;
}
