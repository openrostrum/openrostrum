import { and, eq } from "drizzle-orm";
import { getDb } from "~/db";
import {
	evaluationAnswers,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	roundQuestions,
	submissions,
	users,
} from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import {
	evaluationScore,
	formatScore,
	meanScore,
	toCsv,
} from "~/lib/evaluation";
import { track } from "~/lib/track";
import type { Route } from "./+types/admin.evaluation.export[.csv]";

/**
 * Resource route: review-results CSV for one plan.
 *   ?plan=<id>&report=individual  → one row per evaluation, per-question columns
 *   ?plan=<id>&report=cumulative  → one row per submission, aggregate + per-round columns
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
	const url = new URL(request.url);
	const planId = url.searchParams.get("plan") ?? "";
	const report =
		url.searchParams.get("report") === "cumulative"
			? "cumulative"
			: "individual";
	const db = getDb(env);
	const [plan] = await db
		.select()
		.from(evaluationPlans)
		.where(
			and(
				eq(evaluationPlans.id, planId),
				eq(evaluationPlans.eventId, event.id),
			),
		)
		.limit(1);
	if (!plan) throw new Response("Not found", { status: 404 });

	const [rounds, questions, evalRows, answerRows] = await Promise.all([
		db
			.select()
			.from(evaluationRounds)
			.where(eq(evaluationRounds.planId, plan.id))
			.orderBy(evaluationRounds.position, evaluationRounds.createdAt),
		db
			.select({
				id: roundQuestions.id,
				roundId: roundQuestions.roundId,
				label: roundQuestions.label,
				type: roundQuestions.type,
				weight: roundQuestions.weight,
				position: roundQuestions.position,
			})
			.from(roundQuestions)
			.innerJoin(
				evaluationRounds,
				eq(evaluationRounds.id, roundQuestions.roundId),
			)
			.where(eq(evaluationRounds.planId, plan.id))
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
			.where(eq(evaluationRounds.planId, plan.id)),
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
			.where(eq(evaluationRounds.planId, plan.id)),
	]);

	const roundName = new Map(rounds.map((r) => [r.id, r.name]));
	const answersByEval = new Map<string, typeof answerRows>();
	for (const a of answerRows) {
		const list = answersByEval.get(a.evaluationId) ?? [];
		list.push(a);
		answersByEval.set(a.evaluationId, list);
	}
	const questionsByRound = new Map<string, typeof questions>();
	for (const q of questions) {
		const list = questionsByRound.get(q.roundId) ?? [];
		list.push(q);
		questionsByRound.set(q.roundId, list);
	}
	const scoreOf = (e: (typeof evalRows)[number]) =>
		e.status === "completed"
			? evaluationScore(
					questionsByRound.get(e.roundId) ?? [],
					answersByEval.get(e.id) ?? [],
				)
			: null;

	let rows: unknown[][];
	if (report === "individual") {
		// Question columns: the union across rounds, prefixed by round name so
		// two rounds' "Comments" stay distinguishable.
		const columns = rounds.flatMap((r) =>
			(questionsByRound.get(r.id) ?? []).map((q) => ({
				id: q.id,
				header: `${r.name} — ${q.label}`,
				type: q.type,
			})),
		);
		rows = [
			[
				"Submission",
				"Submission status",
				"Round",
				"Evaluator",
				"Evaluator email",
				"Review status",
				"Submitted at",
				"Weighted score",
				"Abstain reason",
				...columns.map((c) => c.header),
			],
			...evalRows.map((e) => {
				const answers = new Map(
					(answersByEval.get(e.id) ?? []).map((a) => [a.questionId, a]),
				);
				return [
					e.submissionTitle,
					e.submissionStatus,
					roundName.get(e.roundId) ?? "",
					e.evaluatorName ?? e.evaluatorEmail,
					e.evaluatorEmail,
					e.status,
					e.submittedAt?.toISOString() ?? "",
					formatScore(scoreOf(e)),
					e.abstainReason ?? "",
					...columns.map((c) => {
						const a = answers.get(c.id);
						if (!a) return "";
						return c.type === "rating"
							? (a.valueNumber ?? "")
							: (a.valueText ?? "");
					}),
				];
			}),
		];
	} else {
		const bySubmission = new Map<string, typeof evalRows>();
		for (const e of evalRows) {
			const list = bySubmission.get(e.submissionId) ?? [];
			list.push(e);
			bySubmission.set(e.submissionId, list);
		}
		rows = [
			[
				"Submission",
				"Submission status",
				"Assigned",
				"Completed",
				"Abstained",
				"Aggregate score",
				...rounds.map((r) => `Avg — ${r.name}`),
			],
			...[...bySubmission.values()].map((list) => {
				const first = list[0];
				const completed = list.filter((e) => e.status === "completed");
				const scores = completed
					.map(scoreOf)
					.filter((s): s is number => s != null);
				return [
					first?.submissionTitle ?? "",
					first?.submissionStatus ?? "",
					list.length,
					completed.length,
					list.filter((e) => e.status === "abstained").length,
					formatScore(meanScore(scores)),
					...rounds.map((r) =>
						formatScore(
							meanScore(
								completed
									.filter((e) => e.roundId === r.id)
									.map(scoreOf)
									.filter((s): s is number => s != null),
							),
						),
					),
				];
			}),
		];
	}

	track("evaluation.exported", {
		eventId: event.id,
		planId: plan.id,
		report,
		rows: rows.length - 1,
	});
	const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	return new Response(toCsv(rows), {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="evaluation-${slug}-${report}.csv"`,
		},
	});
}
