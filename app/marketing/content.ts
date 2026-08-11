export const GITHUB_URL = "https://github.com/openrostrum/openrostrum";
export const DEPLOY_GUIDE_URL = `${GITHUB_URL}#deploy-your-own`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;

// The nine jobs that make up the program side of a conference, in the order an
// event team lives them. Copy stays concrete — what an organizer can do, never
// adjectives — and no claim ships without a verified feature behind it.
export type Job = { title: string; body: string };

export const JOBS: Job[] = [
	{
		title: "Speaker CRM",
		body: "Keep speakers and prospects across events in one searchable directory. Save segments, assign people to events, and move prospects through an eight-stage pipeline with scores, notes, and history.",
	},
	{
		title: "Call for speakers",
		body: "Build multi-step CFPs from reusable fields, rich text, and conditional questions. Set deadlines and draft rules, configure limits for speakers, chairs, and moderators, and collect secondary contacts.",
	},
	{
		title: "Submission review",
		body: "Route proposals by track, collect approve, maybe, or deny decisions, and run optional AI first-pass scoring with rationale. Sort or override any result; humans stay authoritative.",
	},
	{
		title: "Speaker portals",
		body: "A self-service home for every speaker: bios, headshots, slides, task forms, and a live view of where each submission stands.",
	},
	{
		title: "Speaker comms",
		body: "Edit confirmations, decisions, and reminders. Preview every decision recipient before sending, keep replies in your inbox, attach calendar updates, and retain the full send history.",
	},
	{
		title: "Outstanding tasks",
		body: "See which speakers still owe a bio, headshot, travel form, or slides. Track their submitted form responses from the same roster instead of chasing a spreadsheet.",
	},
	{
		title: "Agenda building",
		body: "Drag accepted sessions onto a day × room grid. Double-booked speakers and rooms surface the moment they happen, before you publish.",
	},
	{
		title: "Content & feeds",
		body: "Publish session, speaker, gallery, agenda, and itinerary views. Reuse approved content as styled embeds or filtered HTML, JSON, and XML feeds — plus iCal for the published agenda.",
	},
	{
		title: "Your event workspace",
		body: "Sign up to create an organization and first event in one flow. Choose System, Light, or Dark across admin, sign-in, and the speaker portal.",
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
