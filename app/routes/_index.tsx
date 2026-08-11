import { Landing } from "~/marketing";
import type { Route } from "./+types/_index";

// The root Layout reads this to pin color-scheme on <html>: the homepage is a
// brochure that always presents the product in the light "Gallery" skin — the
// pin outranks the visitor's OS and the tri-state theme cookie, which govern
// the product surfaces (admin, auth, portal, public program) instead.
export const handle = { colorScheme: "light" as const };

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "OpenRostrum — the open-source Sessionboard alternative" },
		{
			name: "description",
			content:
				"Speaker CRM, configurable calls for speakers, human and AI-assisted submission review, presenter portals, comms, agenda building, embeds, and feeds. Free and open source: create your organization here or self-host.",
		},
	];
}

export default function Home() {
	return <Landing />;
}
