import { desc, eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import { contacts, events, portals, submissions } from "~/db/schema";
import { normalizeEmail, requireUser } from "~/lib/auth";
import { EmptyState } from "~/ui";
import type { Route } from "./+types/portal";

/**
 * Speaker landing after a bare login (homePathForRole → /portal): resolve the
 * user to their portal — most recent contact link first (email-matched
 * contacts count, mirroring the portal-entry backlink), then events they
 * submitted to. First match wins.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const db = getDb(env);

	const linked = await db
		.select({ eventId: contacts.eventId, createdAt: contacts.createdAt })
		.from(contacts)
		.where(eq(contacts.userId, user.id))
		.orderBy(desc(contacts.createdAt))
		.limit(1);
	const byEmail = linked.length
		? []
		: await db
				.select({ eventId: contacts.eventId, createdAt: contacts.createdAt })
				.from(contacts)
				.where(eq(contacts.email, normalizeEmail(user.email)))
				.orderBy(desc(contacts.createdAt))
				.limit(1);
	const submitted =
		linked.length || byEmail.length
			? []
			: await db
					.select({ eventId: submissions.eventId })
					.from(submissions)
					.where(eq(submissions.submitterId, user.id))
					.orderBy(desc(submissions.createdAt))
					.limit(1);

	const eventId =
		linked[0]?.eventId ?? byEmail[0]?.eventId ?? submitted[0]?.eventId;
	if (!eventId) return {};

	const [row] = await db
		.select({ slug: events.slug, publicId: portals.publicId })
		.from(portals)
		.innerJoin(events, eq(events.id, portals.eventId))
		.where(eq(portals.eventId, eventId))
		.limit(1);
	if (!row) return {};
	throw redirect(`/portals/${row.slug}/${row.publicId}/home`);
}

export default function PortalResolver() {
	return (
		<main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
			<EmptyState
				icon="mic"
				title="No portal access yet"
				body="Your speaker portal appears once you submit to an event's call for papers, or once an organizer adds you to a session. Use the portal link from your confirmation email if you have one."
			/>
		</main>
	);
}
