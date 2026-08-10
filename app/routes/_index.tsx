import { Landing } from "~/marketing";
import type { Route } from "./+types/_index";

// The root Layout reads this to pin color-scheme on <html>: the marketing page
// always presents the product in the light "Gallery" skin, regardless of the
// visitor's OS theme (the app itself keeps following the OS).
export const handle = { colorScheme: "light" as const };

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "OpenRostrum — the open-source Sessionboard alternative" },
		{
			name: "description",
			content:
				"Run your whole conference speaker program — call for speakers, review, speaker portals, agenda, and comms — in one open-source app you host on Cloudflare. A free, self-hostable Sessionboard alternative.",
		},
	];
}

export default function Home() {
	return <Landing />;
}
