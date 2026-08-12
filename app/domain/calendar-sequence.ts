import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
	calendarInviteRevisions,
	calendarInviteSequenceFrontiers,
	emailOutbox,
} from "~/db/schema";
import { sha256Hex } from "~/lib/api-token";
import { normalizeEmail } from "~/lib/auth";

/**
 * One calendar UID per session, shared by the acceptance invite and every
 * schedule update that follows it. RFC 5545 §3.8.7.4 makes SEQUENCE the
 * revision counter for that UID, so the counter has to be owned in one place
 * or a later send can land BELOW what the speaker's client already applied and
 * be discarded as stale. Both producers live here.
 *
 * Its own module because `schedule-update.ts` imports from `accept.ts`; putting
 * the counter in either one would close the import cycle.
 */

/** How many revision rows one query may name — D1 binds parameters per statement. */
const SEQUENCE_QUERY_CHUNK = 80;

export type InviteState = {
	start: Date;
	end: Date;
	location?: string | null;
	title: string;
};

export type InviteFrontier = {
	sequence: number;
	stateHash: string;
};

/**
 * What a speaker's calendar entry actually SAYS, as one comparable value —
 * the dimensions a client renders, plus the identity the invite was addressed
 * to. Two sends with the same hash are the same revision, however many times
 * they were rendered or retried.
 */
export async function inviteStateHash(
	eventId: string,
	submissionId: string,
	to: string,
	invite: InviteState,
): Promise<string> {
	return sha256Hex(
		JSON.stringify({
			eventId,
			submissionId,
			recipient: normalizeEmail(to),
			start: invite.start.toISOString(),
			end: invite.end.toISOString(),
			location: invite.location ?? null,
			title: invite.title,
		}),
	);
}

/**
 * The highest SEQUENCE that actually left the building per submission, read
 * from the delivery ledger. `queued` and `failed` count: a queued attempt may
 * still be in the provider's hands, and a failed one may have been delivered
 * before the failure was recorded — assuming otherwise is how a UID gets two
 * different invites at one SEQUENCE.
 */
export async function deliveredInviteFrontiers(
	db: Db,
	submissionIds: readonly string[],
): Promise<Map<string, InviteFrontier>> {
	const frontiers = new Map<string, InviteFrontier>();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += SEQUENCE_QUERY_CHUNK
	) {
		const ranked = db
			.select({
				submissionId: calendarInviteRevisions.submissionId,
				sequence: calendarInviteRevisions.sequence,
				stateHash: calendarInviteRevisions.stateHash,
				frontierRank: sql<number>`row_number() over (
					partition by ${calendarInviteRevisions.submissionId}
					order by ${calendarInviteRevisions.sequence} desc,
						${calendarInviteRevisions.createdAt} desc,
						${calendarInviteRevisions.id} desc
				)`.as("frontier_rank"),
			})
			.from(calendarInviteRevisions)
			.innerJoin(
				emailOutbox,
				eq(emailOutbox.id, calendarInviteRevisions.outboxId),
			)
			.where(
				and(
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + SEQUENCE_QUERY_CHUNK),
					),
					inArray(emailOutbox.status, ["sent", "queued", "failed"]),
					eq(calendarInviteRevisions.invalid, false),
					isNotNull(calendarInviteRevisions.sequence),
				),
			)
			.as("ranked_calendar_attempt_frontiers");
		const rows = await db
			.select({
				submissionId: ranked.submissionId,
				sequence: ranked.sequence,
				stateHash: ranked.stateHash,
			})
			.from(ranked)
			.where(eq(ranked.frontierRank, 1));
		for (const row of rows) {
			if (row.sequence === null) continue;
			frontiers.set(row.submissionId, {
				sequence: row.sequence,
				stateHash: row.stateHash,
			});
		}
	}
	return frontiers;
}

/**
 * The sequence this state DESERVES, before anyone else is consulted: the same
 * number when the state is unchanged (a re-send is the same revision, and
 * bumping it would tell every client the entry moved when it did not), one
 * above the frontier when it is a genuine revision.
 */
export function proposedSequence(
	stateHash: string,
	frontier: InviteFrontier | undefined,
	atLeast = 0,
): number {
	return frontier?.stateHash === stateHash
		? Math.max(atLeast, frontier.sequence)
		: Math.max(atLeast, (frontier?.sequence ?? -1) + 1);
}

export type SequenceClaim = {
	submissionId: string;
	stateHash: string;
	proposedSequence: number;
};

/**
 * Take the sequence, don't just compute it. Two requests reading the same
 * frontier would otherwise propose the same number for different states and
 * hand one UID two conflicting revisions — the exact case a client resolves by
 * keeping whichever it saw first. The upsert decides in the database: same
 * state keeps the number, a different state is forced strictly above whatever
 * is stored, and the returned value is what the invite must carry.
 */
export async function claimInviteSequences(
	db: Db,
	claims: readonly SequenceClaim[],
): Promise<Map<string, number>> {
	const claimed = new Map<string, number>();
	for (let offset = 0; offset < claims.length; offset += SEQUENCE_QUERY_CHUNK) {
		const chunk = claims.slice(offset, offset + SEQUENCE_QUERY_CHUNK);
		const statements = chunk.map((claim) =>
			db
				.insert(calendarInviteSequenceFrontiers)
				.values({
					submissionId: claim.submissionId,
					sequence: claim.proposedSequence,
					stateHash: claim.stateHash,
				})
				.onConflictDoUpdate({
					target: calendarInviteSequenceFrontiers.submissionId,
					set: {
						sequence: sql<number>`case
							when ${calendarInviteSequenceFrontiers.stateHash} = excluded.state_hash
								then max(${calendarInviteSequenceFrontiers.sequence}, excluded.sequence)
							else max(${calendarInviteSequenceFrontiers.sequence} + 1, excluded.sequence)
						end`,
						stateHash: sql`excluded.state_hash`,
						updatedAt: new Date(),
					},
				})
				.returning({ sequence: calendarInviteSequenceFrontiers.sequence }),
		);
		const first = statements[0];
		if (!first) continue;
		const frontiers = await db.batch([first, ...statements.slice(1)]);
		for (const [index, claim] of chunk.entries()) {
			const frontier = frontiers[index]?.[0];
			if (!frontier) throw new Error("Calendar sequence claim returned no row");
			claimed.set(claim.submissionId, frontier.sequence);
		}
	}
	return claimed;
}
