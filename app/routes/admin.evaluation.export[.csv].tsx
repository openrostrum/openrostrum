import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "~/db";
import { aiReviews, evaluationPlans } from "~/db/schema";
import { effectiveAiScore } from "~/domain/ai-review";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { fetchChunked, formatScore, meanScore, toCsv } from "~/lib/evaluation";
import { loadPlanScores } from "~/lib/plan-scores";
import { createTimings, track } from "~/lib/track";
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

	const timings = createTimings();
	const scores = await timings.time("db", () => loadPlanScores(db, plan.id));
	const { rounds, questionsByRound, evalRows, answersByEval, scoreOf } = scores;
	const roundName = new Map(rounds.map((r) => [r.id, r.name]));

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
		// The AI first-pass exports alongside — but never inside — the human
		// aggregate, mirroring the on-screen results table.
		const aiRows = await fetchChunked([...bySubmission.keys()], (chunk) =>
			db
				.select({
					submissionId: aiReviews.submissionId,
					score: aiReviews.score,
					overrideScore: aiReviews.overrideScore,
				})
				.from(aiReviews)
				.where(inArray(aiReviews.submissionId, chunk)),
		);
		rows = [
			[
				"Submission",
				"Submission status",
				"Assigned",
				"Completed",
				"Abstained",
				"Aggregate score",
				...rounds.map((r) => `Avg — ${r.name}`),
				"AI first-pass score",
				"AI score overridden",
			],
			...[...bySubmission.entries()].map(([submissionId, list]) => {
				const first = list[0];
				const completed = list.filter((e) => e.status === "completed");
				const scores = completed
					.map(scoreOf)
					.filter((s): s is number => s != null);
				const ai = aiRows.find((a) => a.submissionId === submissionId);
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
					ai ? formatScore(effectiveAiScore(ai)) : "",
					ai?.overrideScore != null ? "yes" : "",
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
			"Server-Timing": timings.header(),
		},
	});
}
