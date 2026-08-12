import { and, countDistinct, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "~/db";
import {
	contacts,
	events,
	organizationMembers,
	passwordResets,
	reviewerTracks,
	submissions,
	tracks,
	users,
} from "~/db/schema";
import { sha256Hex } from "~/lib/api-token";
import { normalizeEmail } from "~/lib/auth";
import { fetchChunked } from "~/lib/evaluation";

/**
 * Invited-but-not-yet-onboarded users carry an UNVERIFIABLE password hash:
 * `verifyPassword` only accepts `pbkdf2$…`, so this sentinel can never log in
 * until the set-password link replaces it. The prefix is the shared cross-lane
 * convention (see `admin.settings.team.tsx`) — team invites recognize it too.
 */
export const SENTINEL_HASH_PREFIX = "invite-pending$";

export function mintSentinelPasswordHash(): string {
	return `${SENTINEL_HASH_PREFIX}${crypto.randomUUID()}`;
}

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

/** Batchable distinct-reviewer count over the same track-assignment anchor
 * as `listEventReviewers` — the tenancy boundary stays in this one file. */
export function countEventReviewers(db: Db, eventId: string) {
	return db
		.select({ n: countDistinct(reviewerTracks.userId) })
		.from(reviewerTracks)
		.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
		.where(eq(tracks.eventId, eventId));
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
			passwordHash: mintSentinelPasswordHash(),
		})
		.returning();
	if (!created) throw new Error("Failed to create the reviewer account.");
	return { user: created, created: true };
}

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export const SEND_KEY_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint a set-password token for an invited reviewer. Derived, not random: a
 * replayed POST re-mints the SAME token, and the token-scoped email dedupeKey
 * then suppresses the resend. Unpredictability rests on the sendKey being a
 * server-minted UUID — anything else throws.
 */
export async function mintInviteToken(
	db: Db,
	userId: string,
	sendKey: string,
): Promise<string> {
	return mintOrgLessToken(db, "reviewer-invite", userId, sendKey);
}

/**
 * Mint a fresh set-password link for a reviewer who already has a password.
 * Callers MUST gate this on `hasStandingOutsideOrg`: redeeming the link
 * replaces the account's password, so minting one for an account with reach
 * beyond the organizer's own org would be a cross-tenant takeover.
 */
export async function mintSignInToken(
	db: Db,
	userId: string,
	sendKey: string,
): Promise<string> {
	return mintOrgLessToken(db, "reviewer-signin", userId, sendKey);
}

async function mintOrgLessToken(
	db: Db,
	purpose: "reviewer-invite" | "reviewer-signin",
	userId: string,
	sendKey: string,
): Promise<string> {
	if (!SEND_KEY_RE.test(sendKey)) {
		throw new Error("Invite sendKey must be a UUID.");
	}
	const token = await sha256Hex(`${purpose}:${userId}:${sendKey}`);
	await db
		.insert(passwordResets)
		.values({
			userId,
			// NULL deliberately: the accept flow derives what a token grants from
			// this column, and a reviewer token must never create a membership.
			organizationId: null,
			token,
			expiresAt: new Date(Date.now() + INVITE_TTL_MS),
		})
		.onConflictDoNothing({ target: passwordResets.token });
	return token;
}

/**
 * A set-password link overwrites the account's password, so an organizer may
 * only be handed one for an account living entirely inside their own org —
 * otherwise adding another org's admin as a reviewer and copying their link is
 * an account takeover across the tenancy boundary.
 */
export async function hasStandingOutsideOrg(
	db: Db,
	userId: string,
	organizationId: string,
): Promise<boolean> {
	// Evaluator rows can't exist without a track assignment, so `reviewing`
	// already covers them.
	const [memberships, reviewing, contactRows, authored] = await Promise.all([
		db
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, userId),
					ne(organizationMembers.organizationId, organizationId),
				),
			)
			.limit(1),
		db
			.select({ id: tracks.id })
			.from(reviewerTracks)
			.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
			.innerJoin(events, eq(events.id, tracks.eventId))
			.where(
				and(
					eq(reviewerTracks.userId, userId),
					ne(events.organizationId, organizationId),
				),
			)
			.limit(1),
		db
			.select({ id: contacts.id })
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(
				and(
					eq(contacts.userId, userId),
					ne(events.organizationId, organizationId),
				),
			)
			.limit(1),
		db
			.select({ id: submissions.id })
			.from(submissions)
			.innerJoin(events, eq(events.id, submissions.eventId))
			.where(
				and(
					eq(submissions.submitterId, userId),
					ne(events.organizationId, organizationId),
				),
			)
			.limit(1),
	]);
	return (
		memberships.length > 0 ||
		reviewing.length > 0 ||
		contactRows.length > 0 ||
		authored.length > 0
	);
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
