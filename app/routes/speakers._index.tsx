import { redirect } from "react-router";
import { getDb } from "~/db";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/speakers._index";

// @public — bare /speakers lands on the default event's public directory.
export async function loader({ context }: Route.LoaderArgs) {
	const event = await getDefaultEvent(getDb(context.cloudflare.env));
	return redirect(event ? `/speakers/${event.slug}` : "/");
}
