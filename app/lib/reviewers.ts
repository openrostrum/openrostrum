import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "~/db";
import { passwordResets, reviewerTracks, tracks, users } from "~/db/schema";
import { normalizeEmail } from "~/lib/auth";
import { fetchChunked } from "~/lib/evaluation";

/**
 * Invited-but-not-yet-onboarded users carry an UNVERIFIABLE password hash:
 * `verifyPassword` only accepts the `pbkdf2$…` scheme, so this sentinel can
 * never log in until the set-password link replaces it (the schema-blessed
 * invite pattern on `passwordResets`).
 */
export const SENTINEL_PASSWORD_HASH = "invited";

export function hasUsablePassword(passwordHash: string): boolean {
	return passwordHash.startsWith("pbkdf2$");
}

export type EventReviewer = {
	id: string;
	email: string;
	name: string | null;
	invited: boolean;
	trackIds: string[];
};

/**
 * The event's reviewer registry: every user holding a track assignment on this
 * event. Track assignment is what anchors a reviewer to an event (reviewers
 * hold no org membership), so this is also the tenancy boundary — another
 * org's reviewers can never appear here.
 */
export async function listEventReviewers(
	db: Db,
	eventId: string,
): Promise<EventReviewer[]> {
	const rows = await db
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			passwordHash: users.passwordHash,
			trackId: reviewerTracks.trackId,
		})
		.from(reviewerTracks)
		.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
		.innerJoin(users, eq(users.id, reviewerTracks.userId))
		.where(eq(tracks.eventId, eventId));
	const byUser = new Map<string, EventReviewer>();
	for (const row of rows) {
		const existing = byUser.get(row.id);
		if (existing) {
			existing.trackIds.push(row.trackId);
		} else {
			byUser.set(row.id, {
				id: row.id,
				email: row.email,
				name: row.name,
				invited: !hasUsablePassword(row.passwordHash),
				trackIds: [row.trackId],
			});
		}
	}
	return [...byUser.values()].sort((a, b) =>
		(a.name ?? a.email).localeCompare(b.name ?? b.email),
	);
}

/**
 * Find-or-create the user behind a reviewer invite. Existing speakers are
 * promoted to `reviewer` (they gain the reviewer surface; portal access is
 * not role-gated). Existing admins/reviewers keep their role — demoting an
 * admin here would lock them out of their own org.
 */
export async function ensureReviewerUser(
	db: Db,
	input: { email: string; name: string },
): Promise<{ user: typeof users.$inferSelect; created: boolean }> {
	const email = normalizeEmail(input.email);
	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	if (existing) {
		if (existing.role === "speaker") {
			const [updated] = await db
				.update(users)
				.set({ role: "reviewer" })
				.where(eq(users.id, existing.id))
				.returning();
			return {
				user: updated ?? { ...existing, role: "reviewer" },
				created: false,
			};
		}
		return { user: existing, created: false };
	}
	const [created] = await db
		.insert(users)
		.values({
			email,
			name: input.name,
			role: "reviewer",
			passwordHash: SENTINEL_PASSWORD_HASH,
		})
		.returning();
	if (!created) throw new Error("Failed to create the reviewer account.");
	return { user: created, created: true };
}

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * Mint a set-password token for an invited reviewer. `organizationId` stays
 * NULL deliberately: the accept flow derives what a token grants from that
 * column, and a reviewer token must never create an org membership.
 */
export async function mintInviteToken(db: Db, userId: string): Promise<string> {
	const token = crypto.randomUUID();
	await db.insert(passwordResets).values({
		userId,
		organizationId: null,
		token,
		expiresAt: new Date(Date.now() + INVITE_TTL_MS),
	});
	return token;
}

/** Latest still-valid invite token per user (for re-displaying copyable links). */
export async function activeInviteTokens(
	db: Db,
	userIds: readonly string[],
): Promise<Map<string, string>> {
	if (userIds.length === 0) return new Map();
	const rows = await fetchChunked([...userIds], (chunk) =>
		db
			.select({
				userId: passwordResets.userId,
				token: passwordResets.token,
				createdAt: passwordResets.createdAt,
			})
			.from(passwordResets)
			.where(
				and(
					inArray(passwordResets.userId, chunk),
					isNull(passwordResets.usedAt),
					isNull(passwordResets.organizationId),
					gt(passwordResets.expiresAt, new Date()),
				),
			),
	);
	const latest = new Map<string, { token: string; createdAt: Date }>();
	for (const row of rows) {
		const prev = latest.get(row.userId);
		if (!prev || row.createdAt.getTime() > prev.createdAt.getTime()) {
			latest.set(row.userId, { token: row.token, createdAt: row.createdAt });
		}
	}
	return new Map([...latest].map(([userId, v]) => [userId, v.token]));
}
