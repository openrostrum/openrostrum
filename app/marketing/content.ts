export const GITHUB_URL = "https://github.com/openrostrum/openrostrum";
export const DEMO_EMAIL = "admin@example.com";
export const DEMO_PASSWORD = "password";

// The six firm requirements from the brief, in the organizer's language. They
// are a real numbered list (requirement 1–6), which is why the section numbers
// them — the claim is "all six, shipped", not decoration. Copy stays concrete:
// what an organizer can do, never adjectives.
export type Requirement = { title: string; body: string };

export const REQUIREMENTS: Requirement[] = [
	{
		title: "Call for speakers",
		body: "A multi-step form builder with conditional logic, participant roles, and close dates. Copy the public link and submissions start arriving.",
	},
	{
		title: "Submission review",
		body: "Approve, maybe, or deny — routed to reviewers by track. Accepting a submission auto-creates the speaker, the session, and their onboarding tasks.",
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
		label: "Airtable",
		ours: { text: "Native sync" },
		theirs: { text: "Zapier only" },
	},
	{ label: "Pricing", ours: { text: "Free · MIT" }, theirs: { text: "Paid" } },
];

export const DEPLOY_STEPS: { comment: string; command: string }[] = [
	{
		comment: "create your D1 database",
		command: "wrangler d1 create openrostrum",
	},
	{
		comment: "point deploy at it",
		command: "cp .deploy.env.example .deploy.env",
	},
	{ comment: "migrate the schema", command: "pnpm db:migrate:remote" },
	{ comment: "ship it to your account", command: "pnpm run deploy" },
];

export const STACK = [
	"React Router 7",
	"Cloudflare Workers",
	"D1",
	"R2",
	"Drizzle",
];
