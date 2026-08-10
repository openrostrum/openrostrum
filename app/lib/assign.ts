import { eq } from "drizzle-orm";
import type { Db } from "~/db";
import {
	evaluationPlans,
	evaluationRounds,
	evaluations,
	roundQuestions,
} from "~/db/schema";
import type { AssignmentPair } from "./evaluation";

// D1 caps bound parameters per statement (100); an evaluations row binds ~9,
// so 10 rows per INSERT stays safely under it.
const INSERT_CHUNK = 10;

/**
 * Mint pending `evaluations` rows for (submission × evaluator) pairs in one
 * round. Idempotent: pairs that already exist (any status) are skipped, so a
 * double-submitted assignment can never duplicate a queue entry or wipe a
 * completed review. Returns how many rows were actually created.
 */
export async function mintEvaluations(
	db: Db,
	roundId: string,
	pairs: readonly AssignmentPair[],
): Promise<number> {
	if (pairs.length === 0) return 0;
	const existing = await db
		.select({
			submissionId: evaluations.submissionId,
			evaluatorId: evaluations.evaluatorId,
		})
		.from(evaluations)
		.where(eq(evaluations.roundId, roundId));
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
 * The zero-setup review path: when an event has no evaluation rounds yet, the
 * reviewers page can still assign work. Finds (or creates) the "Review" plan
 * with one always-open round carrying a starter scorecard — a required 1–5
 * rating plus an optional comment — so a reviewer can score immediately and
 * the organizer can refine the scorecard later in the plan editor.
 */
export async function ensureQuickRound(
	db: Db,
	eventId: string,
): Promise<string> {
	const [existing] = await db
		.select({ roundId: evaluationRounds.id })
		.from(evaluationRounds)
		.innerJoin(evaluationPlans, eq(evaluationPlans.id, evaluationRounds.planId))
		.where(eq(evaluationPlans.eventId, eventId))
		.orderBy(evaluationRounds.createdAt)
		.limit(1);
	if (existing) return existing.roundId;

	const [plan] = await db
		.insert(evaluationPlans)
		.values({
			eventId,
			name: "Review",
			instructions:
				"Rate each submission and leave a comment for the committee.",
		})
		.returning({ id: evaluationPlans.id });
	if (!plan) throw new Error("Failed to create the review plan.");
	const [round] = await db
		.insert(evaluationRounds)
		.values({ planId: plan.id, name: "Round 1", position: 0 })
		.returning({ id: evaluationRounds.id });
	if (!round) throw new Error("Failed to create the review round.");
	await db.insert(roundQuestions).values([
		{
			roundId: round.id,
			label: "Rating",
			type: "rating",
			config: { min: 1, max: 5 },
			weight: 1,
			required: true,
			position: 0,
		},
		{
			roundId: round.id,
			label: "Comments",
			type: "text",
			weight: 1,
			required: false,
			position: 1,
		},
	]);
	return round.id;
}
