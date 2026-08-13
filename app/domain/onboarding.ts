import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import type { users } from "~/db/schema";
import { events, organizationMembers, organizations } from "~/db/schema";
import { getActiveEvent } from "~/lib/auth";

export type FirstRunState =
	| { hasEvent: true; eventId: string; organizationId: string }
	| { hasEvent: false; organizationId: string | null };

/**
 * An organizer is done with step 1 once an event exists under one of their
 * organizations. A membership with no event is a half-finished setup — it
 * resumes against that same organization instead of minting a second one.
 */
export async function getFirstRunState(
	env: Env,
	userId: string,
): Promise<FirstRunState> {
	const db = getDb(env);
	const [event] = await db
		.select({
			eventId: events.id,
			organizationId: organizationMembers.organizationId,
		})
		.from(organizationMembers)
		.innerJoin(
			events,
			eq(events.organizationId, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, userId))
		.limit(1);
	if (event) return { hasEvent: true, ...event };

	const [organization] = await db
		.select({ id: organizations.id })
		.from(organizationMembers)
		.innerJoin(
			organizations,
			eq(organizations.id, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, userId))
		.limit(1);
	return { hasEvent: false, organizationId: organization?.id ?? null };
}

/**
 * Step 1 creates things, so only a user with nothing may run it. Anyone who
 * already has an event lands on the dashboard, where the getting-started card
 * is the resume path for whatever they skipped.
 */
export async function requireFirstRunStart(
	env: Env,
	user: typeof users.$inferSelect,
): Promise<{ organizationId: string | null }> {
	const state = await getFirstRunState(env, user.id);
	if (state.hasEvent) throw redirect("/admin");
	return { organizationId: state.organizationId };
}

/** Steps 2 and 3 only edit the event step 1 created — without one there is
 * nothing to fill in, so the wizard restarts at its first screen. */
export async function requireOnboardingEvent(
	env: Env,
	user: typeof users.$inferSelect,
): Promise<typeof events.$inferSelect> {
	const event = await getActiveEvent(env, user);
	if (!event) throw redirect("/onboarding");
	return event;
}
