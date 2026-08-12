import { eq, like, or } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import type { users } from "~/db/schema";
import { events, organizationMembers, organizations } from "~/db/schema";
import { getActiveEvent } from "~/lib/auth";
import { slugify } from "~/settings/event-form";

/**
 * First-run state and the URL derivation behind it. The wizard never asks an
 * organizer for a slug: a public URL is a consequence of the conference name,
 * and a collision with a stranger's event is not something a brand-new user
 * can be expected to resolve on their first screen.
 */

/** Leaves room for the "-2"/"-abc123" suffixes below inside events.slug's 80. */
const SLUG_BASE_MAX = 72;
/** Bounded scan: enough to disambiguate real name collisions, and the UNIQUE
 * index is still the authority — a miss falls through to a random suffix. */
const SLUG_SCAN_LIMIT = 200;

export function eventSlugBase(name: string): string {
	const base = slugify(name).slice(0, SLUG_BASE_MAX).replace(/-+$/, "");
	return base || "event";
}

/** Last resort when the tidy suffixes are exhausted or lost a race. */
export function randomizedSlug(base: string): string {
	return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/** "Devcon 2027" → `devcon-2027`, or `devcon-2027-2` if that is taken. */
export async function deriveEventSlug(
	db: ReturnType<typeof getDb>,
	name: string,
): Promise<string> {
	const base = eventSlugBase(name);
	const rows = await db
		.select({ slug: events.slug })
		.from(events)
		.where(or(eq(events.slug, base), like(events.slug, `${base}-%`)))
		.limit(SLUG_SCAN_LIMIT);
	const taken = new Set(rows.map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let n = 2; n <= SLUG_SCAN_LIMIT; n++) {
		if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
	}
	return randomizedSlug(base);
}

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
