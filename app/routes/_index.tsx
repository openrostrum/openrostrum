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
				"Conference speaker and program management, free and open source: call for speakers, submission review, speaker portals, agenda building, and speaker comms in one place. Sign up on openrostrum.com or self-host your own instance.",
		},
	];
}

export default function Home() {
	return <Landing />;
}
