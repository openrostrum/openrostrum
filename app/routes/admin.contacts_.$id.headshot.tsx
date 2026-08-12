import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts, events } from "~/db/schema";
import { serveBlob } from "~/domain/files";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import type { Route } from "./+types/admin.contacts_.$id.headshot";

/**
 * Serves a contact's headshot bytes; the r2 key never leaves the server. Scoped
 * to the caller's ORGANIZATION, not the active event, because the CRM directory
 * is cross-event and a face must load while the organizer is switched
 * elsewhere. Another org's contact stays a 404.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const org = await resolveActiveOrg(env, user);
	if (!org) throw data(null, { status: 404 });
	const db = getDb(env);
	const [contact] = await db
		.select({ headshotKey: contacts.headshotKey })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(and(eq(contacts.id, params.id), eq(events.organizationId, org.id)))
		.limit(1);
	if (!contact?.headshotKey) throw data(null, { status: 404 });
	return serveBlob(env, contact.headshotKey);
}
