import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { organizationMembers, organizations, type users } from "~/db/schema";
import { getActiveEvent } from "~/lib/auth";

type AppUser = typeof users.$inferSelect;
export type Org = typeof organizations.$inferSelect;

/**
 * The org an admin manages: the active event's org (getActiveEvent is the
 * membership chokepoint — it only returns the caller's orgs' events), else
 * their first membership (an org can predate its first event). Null = none.
 * Every org-level settings surface (team, API tokens) resolves through this.
 */
export async function resolveOrg(env: Env, user: AppUser): Promise<Org | null> {
	const db = getDb(env);
	const event = await getActiveEvent(env, user);
	if (event) {
		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.id, event.organizationId))
			.limit(1);
		if (org) return org;
	}
	const [first] = await db
		.select({ org: organizations })
		.from(organizationMembers)
		.innerJoin(
			organizations,
			eq(organizations.id, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, user.id))
		.orderBy(organizationMembers.createdAt)
		.limit(1);
	return first?.org ?? null;
}
