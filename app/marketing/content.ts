export const GITHUB_URL = "https://github.com/openrostrum/openrostrum";
export const DEPLOY_GUIDE_URL = `${GITHUB_URL}#deploy-your-own`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;

// The live public surfaces of this deployment's current event. Linking them
// from the homepage is also a hard requirement (every public surface
// reachable from the base URL).
export type PublicPage = { label: string; to: string };

export const PUBLIC_PAGES: PublicPage[] = [
	{ label: "Schedule", to: "/schedule" },
	{ label: "Speakers", to: "/speakers" },
	{ label: "Sessions", to: "/sessions" },
	{ label: "Itinerary", to: "/itinerary" },
	{ label: "Gallery", to: "/gallery" },
	{ label: "Call for speakers", to: "/cfp" },
];

// One-glance facts only — every cell is verifiable (Sessionboard is closed
// and paid, ships no per-speaker .ics, reaches Airtable only via Zapier).
export const OURS =
	"MIT · your Cloudflare · per-speaker .ics · native Airtable · free";
export const THEIRS =
	"Closed · their SaaS · no per-speaker .ics · Zapier · paid";
