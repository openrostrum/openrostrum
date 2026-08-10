import { redirect } from "react-router";
import { getDb } from "~/db";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/sessions._index";

// @public — bare /sessions lands on the default event's public session list.
export async function loader({ context }: Route.LoaderArgs) {
	const event = await getDefaultEvent(getDb(context.cloudflare.env));
	return redirect(event ? `/sessions/${event.slug}` : "/");
}
