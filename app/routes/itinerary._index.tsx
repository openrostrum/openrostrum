import { redirect } from "react-router";
import { getDb } from "~/db";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/itinerary._index";

// @public — bare /itinerary lands on the default event's public itinerary.
export async function loader({ context }: Route.LoaderArgs) {
	const event = await getDefaultEvent(getDb(context.cloudflare.env));
	return redirect(event ? `/itinerary/${event.slug}` : "/");
}
