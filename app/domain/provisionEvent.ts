import type { Db } from "~/db";
import { emailTemplates } from "~/db/schema";

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
 * Provision a new event's default email templates.
 *
 * EVERY event-creation path must call this — onboarding does, and the
 * create-event flow (`/admin/events/new`) must too: only the seed mints
 * templates otherwise, so a non-seeded event's confirmation email would
 * silently never send.
 *
 * Returns the unexecuted insert so callers can include it in the same
 * `db.batch([...])` as the event insert (an event must never exist without
 * its templates — D1 batches are atomic). Awaiting it directly also works.
 */
export function provisionEventDefaults(db: Db, eventId: string) {
	return db
		.insert(emailTemplates)
		.values(DEFAULT_EMAIL_TEMPLATES.map((t) => ({ ...t, eventId })));
}
