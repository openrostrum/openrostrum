import type { IconName } from "~/ui";

export const GITHUB_URL = "https://github.com/openrostrum/openrostrum";
export const DEMO_EMAIL = "admin@example.com";
export const DEMO_PASSWORD = "password";

export type Feature = { icon: IconName; title: string; body: string };

// The nine capabilities the product actually ships (SCOPE's six firm
// requirements + the three that set it apart). Copy stays concrete: what an
// organizer can do, not adjectives.
export const FEATURES: Feature[] = [
	{
		icon: "inbox",
		title: "Custom call for speakers",
		body: "A multi-step form builder with conditional logic, participant roles, and per-track routing. Copy the public link and start collecting submissions.",
	},
	{
		icon: "filter",
		title: "Submission review",
		body: "Approve, maybe, or deny — routed to reviewers by track. Accepting a submission auto-creates the speaker, the session, and the onboarding tasks.",
	},
	{
		icon: "mic",
		title: "Speaker portals",
		body: "A self-service home for every speaker: bios, headshots, slides, and a live view of where each of their submissions stands.",
	},
	{
		icon: "calendar",
		title: "Comms & calendar invites",
		body: "Templated, reply-to-aware email for confirmations, decisions, and reminders — every acceptance carries a real .ics invite Sessionboard can't send.",
	},
	{
		icon: "grid",
		title: "Drag-and-drop agenda",
		body: "Build the schedule on a day × room grid. Conflict detection catches double-booked speakers and rooms before your attendees do.",
	},
	{
		icon: "star",
		title: "Outstanding-tasks dashboard",
		body: "See exactly which speakers still owe a bio, a headshot, or a hotel form — the whole roster at a glance, no spreadsheet required.",
	},
	{
		icon: "search",
		title: "Public schedule & speakers",
		body: "Logged-out session lists, a speaker directory, an agenda grid, and personal schedules — rendered live from your data, no republishing.",
	},
	{
		icon: "export",
		title: "Airtable sync",
		body: "Push submissions, speakers, and sessions into your base, or run Airtable as the source of truth. Background sync, never in the request path.",
	},
	{
		icon: "sliders",
		title: "Cloudflare-native speed",
		body: "Sub-second pages and instant tables on Workers and D1. No loading spinners, no waiting — performance is treated as a feature.",
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
