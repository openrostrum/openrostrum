export const GITHUB_URL = "https://github.com/openrostrum/openrostrum";
export const DEPLOY_GUIDE_URL = `${GITHUB_URL}#deploy-your-own`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;

// The six jobs that make up the program side of a conference, in the order an
// event team lives them. Copy stays concrete — what an organizer can do, never
// adjectives — and no claim ships without a verified feature behind it.
export type Job = { title: string; body: string };

export const JOBS: Job[] = [
	{
		title: "Call for speakers",
		body: "A multi-step form builder with conditional logic, participant roles, and close dates. Copy the public link and submissions start arriving.",
	},
	{
		title: "Submission review",
		body: "Approve, maybe, or deny — routed to reviewers by track. Accepting a submission links each speaker's account and mints their onboarding tasks; decision emails go out only when you send them.",
	},
	{
		title: "Speaker portals",
		body: "A self-service home for every speaker: bios, headshots, slides, task forms, and a live view of where each submission stands.",
	},
	{
		title: "Speaker comms",
		body: "Templated confirmations, decisions, and reminders — editable subjects and bodies, reply-to that reaches your inbox, a full send history.",
	},
	{
		title: "Agenda building",
		body: "Drag accepted sessions onto a day × room grid. Double-booked speakers and rooms surface the moment they happen, not after publishing.",
	},
	{
		title: "Outstanding tasks",
		body: "Which speakers still owe a bio, a headshot, or a hotel form — the whole roster on one screen, no spreadsheet on the side.",
	},
];

// The live public surfaces of this deployment's current event. These are the
// product's most inspectable output — a prospect can judge the attendee-facing
// result without an account — and linking them from the homepage is also a hard
// requirement (every public surface reachable from the base URL).
export type PublicPage = { label: string; description: string; to: string };

export const PUBLIC_PAGES: PublicPage[] = [
	{
		label: "Schedule",
		description: "The day × room grid attendees plan around.",
		to: "/schedule",
	},
	{
		label: "Speakers",
		description: "Directory with photos, bios, and each speaker's sessions.",
		to: "/speakers",
	},
	{
		label: "Sessions",
		description: "Searchable catalog with track and format filters.",
		to: "/sessions",
	},
	{
		label: "Itinerary",
		description: "Chronological day-by-day view with a personal itinerary.",
		to: "/itinerary",
	},
	{
		label: "Gallery",
		description: "The speaker photo wall — the whole lineup on one page.",
		to: "/gallery",
	},
	{
		label: "Call for speakers",
		description: "The live CFP form — submit a talk to this event.",
		to: "/cfp",
	},
];

export type CompareCell = { yes: boolean } | { text: string };
export type CompareRow = {
	label: string;
	ours: CompareCell;
	theirs: CompareCell;
};

// Every claim here is verifiable: Sessionboard is closed and paid, ships no
// per-speaker .ics (docs/data-model research), and reaches Airtable only via
// Zapier. Kept factual, not triumphant.
export const COMPARE: CompareRow[] = [
	{ label: "Open source", ours: { yes: true }, theirs: { yes: false } },
	{
		label: "Runs on your own infrastructure",
		ours: { yes: true },
		theirs: { yes: false },
	},
	{
		label: "Per-speaker calendar invites (.ics)",
		ours: { yes: true },
		theirs: { yes: false },
	},
	{
		label: "Public schedule & speaker pages",
		ours: { yes: true },
		theirs: { yes: true },
	},
	{
		label: "Airtable sync",
		ours: { text: "Native" },
		theirs: { text: "Zapier only" },
	},
	{ label: "Pricing", ours: { text: "Free · MIT" }, theirs: { text: "Paid" } },
];
