import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts } from "~/db/schema";
import { serveBlob } from "~/domain/portal";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import type { Route } from "./+types/admin.contacts_.$id.headshot";

/** Serves a contact's headshot bytes to organizers — the r2 key never leaves the server. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw data(null, { status: 404 });
	const db = getDb(env);
	const [contact] = await db
		.select({ headshotKey: contacts.headshotKey })
		.from(contacts)
		.where(and(eq(contacts.id, params.id), eq(contacts.eventId, event.id)))
		.limit(1);
	if (!contact?.headshotKey) throw data(null, { status: 404 });
	return serveBlob(env, contact.headshotKey);
}
