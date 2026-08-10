import type { Route } from "./+types/_index";
import { Landing } from "~/marketing";

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
