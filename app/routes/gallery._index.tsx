import { redirect } from "react-router";
import { getDb } from "~/db";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/gallery._index";

// @public — bare /gallery lands on the default event's public speaker gallery.
export async function loader({ context }: Route.LoaderArgs) {
	const event = await getDefaultEvent(getDb(context.cloudflare.env));
	return redirect(event ? `/gallery/${event.slug}` : "/");
}
