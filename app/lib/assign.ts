import { eq, inArray } from "drizzle-orm";
import type { Db } from "~/db";
import {
	evaluationAnswers,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	roundQuestions,
} from "~/db/schema";
import { type AssignmentPair, roundWritable } from "./evaluation";

// D1 caps bound parameters per statement (100); an evaluations row binds ~9,
// so 10 rows per INSERT stays safely under it.
const INSERT_CHUNK = 10;

/**
 * Mint pending `evaluations` rows for (submission × evaluator) pairs in one
 * round. Idempotent: pairs that already exist (any status) are skipped, so a
 * double-submitted assignment can never duplicate a queue entry or wipe a
 * completed review. Callers that already loaded the round's pairs pass them
 * as `preloaded` to skip the re-read; `onConflictDoNothing` stays the hard
 * guarantee either way. Returns how many rows were actually created.
 */
export async function mintEvaluations(
	db: Db,
	roundId: string,
	pairs: readonly AssignmentPair[],
	preloaded?: readonly AssignmentPair[],
): Promise<number> {
	if (pairs.length === 0) return 0;
	const existing =
		preloaded ??
		(await db
			.select({
				submissionId: evaluations.submissionId,
				evaluatorId: evaluations.evaluatorId,
			})
			.from(evaluations)
			.where(eq(evaluations.roundId, roundId)));
	const existingKeys = new Set(
		existing.map((e) => `${e.submissionId} ${e.evaluatorId}`),
	);
	const seen = new Set<string>();
	const fresh = pairs.filter((p) => {
		const key = `${p.submissionId} ${p.evaluatorId}`;
		if (existingKeys.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	if (fresh.length === 0) return 0;
	const statements = [];
	for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
		statements.push(
			db
				.insert(evaluations)
				.values(
					fresh.slice(i, i + INSERT_CHUNK).map((p) => ({
						roundId,
						submissionId: p.submissionId,
						evaluatorId: p.evaluatorId,
					})),
				)
				.onConflictDoNothing(),
		);
	}
	const [first, ...rest] = statements;
	if (first) await db.batch([first, ...rest]);
	return fresh.length;
}

/**
 * Deleting a plan (or round) must delete its recorded answers FIRST:
 * `evaluation_answers.question_id` is RESTRICT (so a scorecard edit can never
 * silently destroy scores), which also aborts the parent cascade — without
 * this pre-delete, plan/round deletion fails permanently once anyone has
 * reviewed. Both statements run in one batch.
 */
export async function deletePlanDeep(db: Db, planId: string): Promise<void> {
	await db.batch([
		db
			.delete(evaluationAnswers)
			.where(
				inArray(
					evaluationAnswers.evaluationId,
					db
						.select({ id: evaluations.id })
						.from(evaluations)
						.innerJoin(
							evaluationRounds,
							eq(evaluationRounds.id, evaluations.roundId),
						)
						.where(eq(evaluationRounds.planId, planId)),
				),
			),
		db.delete(evaluationPlans).where(eq(evaluationPlans.id, planId)),
	]);
}

export async function deleteRoundDeep(db: Db, roundId: string): Promise<void> {
	await db.batch([
		db
			.delete(evaluationAnswers)
			.where(
				inArray(
					evaluationAnswers.evaluationId,
					db
						.select({ id: evaluations.id })
						.from(evaluations)
						.where(eq(evaluations.roundId, roundId)),
				),
			),
		db.delete(evaluationRounds).where(eq(evaluationRounds.id, roundId)),
	]);
}

/**
 * The zero-setup review path behind the reviewers page: an organizer can
 * provision a reviewer and hand them work in one sitting, before any plan
 * exists. Reuses the event's earliest round that is still WRITABLE (its plan
 * open and today inside its dates) — never a closed or expired round, which
 * would mint assignments the reviewer can never complete. When no writable
 * round exists it creates a "Review" plan with one always-open round and a
 * starter scorecard (required 1–5 rating + optional comment) in a single
 * atomic batch, ready for the organizer to refine in the plan editor.
 */
export async function ensureQuickRound(
	db: Db,
	eventId: string,
): Promise<string> {
	const candidates = await db
		.select({
			roundId: evaluationRounds.id,
			opensAt: evaluationRounds.opensAt,
			closesAt: evaluationRounds.closesAt,
			planStatus: evaluationPlans.status,
		})
		.from(evaluationRounds)
		.innerJoin(evaluationPlans, eq(evaluationPlans.id, evaluationRounds.planId))
		.where(eq(evaluationPlans.eventId, eventId))
		.orderBy(evaluationRounds.createdAt);
	const writable = candidates.find(
		(c) => roundWritable(c, c.planStatus).writable,
	);
	if (writable) return writable.roundId;

	const planId = crypto.randomUUID();
	const roundId = crypto.randomUUID();
	await db.batch([
		db.insert(evaluationPlans).values({
			id: planId,
			eventId,
			name: "Review",
			instructions:
				"Rate each submission and leave a comment for the committee.",
		}),
		db.insert(evaluationRounds).values({
			id: roundId,
			planId,
			name: "Round 1",
			position: 0,
		}),
		db.insert(roundQuestions).values([
			{
				roundId,
				label: "Rating",
				type: "rating",
				config: { min: 1, max: 5 },
				weight: 1,
				required: true,
				position: 0,
			},
			{
				roundId,
				label: "Comments",
				type: "text",
				weight: 1,
				required: false,
				position: 1,
			},
		]),
	]);
	return roundId;
}
