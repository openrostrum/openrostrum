import type { Db } from "~/db";
import {
	emailTemplates,
	languages,
	portalForms,
	portals,
	tasks,
} from "~/db/schema";

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
	// Reminder copy leans on {{form_close_date}}, never a literal day count:
	// each occurrence sends on the first tick inside its window (a late
	// toggle-on can be days after the window opened), so a hardcoded "five
	// days" could reach the recipient when it is no longer true. Bodies stay
	// lean — the sender appends a block naming the draft, the form, the close
	// date, and the resume link below whatever the organizer writes.
	{
		key: "reminder_5day",
		name: "Session Form - Five Days Reminder",
		subject: "{{form_title}} closes {{form_close_date}}",
		bodyHtml:
			"<p>Hi {{first_name}}, you saved a draft that hasn't been submitted yet — there's still time to finish it.</p>",
		category: "lifecycle",
		trigger: "auto",
	},
	{
		key: "reminder_1day",
		name: "Session Form - One Day Reminder",
		subject: "Last chance: {{form_title}} closes {{form_close_date}}",
		bodyHtml:
			"<p>Hi {{first_name}}, this is the final day — submit your draft before the form closes.</p>",
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
 * its default templates silently never sends its confirmation email, one
 * without its default speaker portal has no portal URL for the CFP success
 * redirect or any emailed link to resolve to, and one without onboarding task
 * definitions makes the accept spine mint nothing — accepted speakers would
 * see the promised hotel/flight/slides tasks only on the seeded demo event.
 * Returns unexecuted inserts so callers batch them atomically with the event
 * insert.
 */
export function provisionEventDefaults(db: Db, eventId: string) {
	const hotelFormId = crypto.randomUUID();
	const flightFormId = crypto.randomUUID();
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
		db.insert(portalForms).values([
			{
				id: hotelFormId,
				eventId,
				name: "Hotel Stay",
				title: "Book your hotel",
				targetType: "contact",
				schema: [
					{ name: "Hotel name", type: "text", required: true },
					{ name: "Check-in date", type: "date", required: true },
				],
			},
			{
				id: flightFormId,
				eventId,
				name: "Flight Reimbursement",
				title: "Submit your flight",
				targetType: "contact",
				schema: [
					{ name: "Airline", type: "text", required: true },
					{ name: "Amount (USD)", type: "number", required: true },
				],
			},
		]),
		db.insert(tasks).values([
			{
				eventId,
				name: "Hotel & Travel Reservations",
				type: "contact",
				description: "Book your hotel stay.",
				portalFormId: hotelFormId,
				isOnboardingDefault: true,
				required: true,
			},
			{
				eventId,
				name: "Flight Reimbursement",
				type: "contact",
				description: "Submit your flight for reimbursement.",
				portalFormId: flightFormId,
				isOnboardingDefault: true,
				required: true,
			},
			{
				eventId,
				name: "Presentation Upload",
				type: "submission",
				description: "Upload your slides.",
				isFileRequest: true,
				isOnboardingDefault: true,
				required: false,
			},
		]),
	] as const;
}
