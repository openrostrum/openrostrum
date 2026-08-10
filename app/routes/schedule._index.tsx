import { redirect } from "react-router";
import { getDb } from "~/db";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/schedule._index";

// @public — bare /schedule lands on the default event's public agenda grid.
export async function loader({ context }: Route.LoaderArgs) {
	const event = await getDefaultEvent(getDb(context.cloudflare.env));
	return redirect(event ? `/schedule/${event.slug}` : "/");
}
