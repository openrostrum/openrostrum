import { eq } from "drizzle-orm";
import type { Db } from "~/db";
import {
	evaluationAnswers,
	evaluationRounds,
	evaluations,
	roundQuestions,
	submissions,
	users,
} from "~/db/schema";
import { evaluationScore } from "./evaluation";

/**
 * One loader for everything that turns a plan's recorded reviews into
 * numbers. The on-screen results table and the CSV export both read THIS, so
 * the displayed aggregate and the exported one can never disagree.
 */
export async function loadPlanScores(db: Db, planId: string) {
	const [rounds, questions, evalRows, answerRows] = await Promise.all([
		db
			.select()
			.from(evaluationRounds)
			.where(eq(evaluationRounds.planId, planId))
			.orderBy(evaluationRounds.position, evaluationRounds.createdAt),
		db
			.select({
				id: roundQuestions.id,
				roundId: roundQuestions.roundId,
				label: roundQuestions.label,
				type: roundQuestions.type,
				config: roundQuestions.config,
				weight: roundQuestions.weight,
				required: roundQuestions.required,
				position: roundQuestions.position,
			})
			.from(roundQuestions)
			.innerJoin(
				evaluationRounds,
				eq(evaluationRounds.id, roundQuestions.roundId),
			)
			.where(eq(evaluationRounds.planId, planId))
			.orderBy(roundQuestions.position),
		db
			.select({
				id: evaluations.id,
				roundId: evaluations.roundId,
				submissionId: evaluations.submissionId,
				status: evaluations.status,
				submittedAt: evaluations.submittedAt,
				abstainReason: evaluations.abstainReason,
				evaluatorName: users.name,
				evaluatorEmail: users.email,
				submissionTitle: submissions.title,
				submissionStatus: submissions.status,
			})
			.from(evaluations)
			.innerJoin(users, eq(users.id, evaluations.evaluatorId))
			.innerJoin(submissions, eq(submissions.id, evaluations.submissionId))
			.innerJoin(evaluationRounds, eq(evaluationRounds.id, evaluations.roundId))
			.where(eq(evaluationRounds.planId, planId)),
		db
			.select({
				evaluationId: evaluationAnswers.evaluationId,
				questionId: evaluationAnswers.questionId,
				valueNumber: evaluationAnswers.valueNumber,
				valueText: evaluationAnswers.valueText,
			})
			.from(evaluationAnswers)
			.innerJoin(
				evaluations,
				eq(evaluations.id, evaluationAnswers.evaluationId),
			)
			.innerJoin(evaluationRounds, eq(evaluationRounds.id, evaluations.roundId))
			.where(eq(evaluationRounds.planId, planId)),
	]);

	const questionsByRound = new Map<string, typeof questions>();
	for (const q of questions) {
		const list = questionsByRound.get(q.roundId) ?? [];
		list.push(q);
		questionsByRound.set(q.roundId, list);
	}
	const answersByEval = new Map<string, typeof answerRows>();
	for (const a of answerRows) {
		const list = answersByEval.get(a.evaluationId) ?? [];
		list.push(a);
		answersByEval.set(a.evaluationId, list);
	}
	const scoreOf = (e: { id: string; roundId: string; status: string }) =>
		e.status === "completed"
			? evaluationScore(
					questionsByRound.get(e.roundId) ?? [],
					answersByEval.get(e.id) ?? [],
				)
			: null;

	return {
		rounds,
		questions,
		questionsByRound,
		evalRows,
		answersByEval,
		scoreOf,
	};
}

export type PlanScores = Awaited<ReturnType<typeof loadPlanScores>>;
