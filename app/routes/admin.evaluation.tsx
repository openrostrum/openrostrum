import { useState } from "react";
import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	inArray,
	isNull,
	like,
	sql,
} from "drizzle-orm";
import { Form, Outlet, data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { type Db, getDb } from "~/db";
import {
	aiReviews,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	reviews,
	roundEvaluators,
	submissions,
	users,
} from "~/db/schema";
import {
	AI_BULK_BATCH,
	AI_FAILURE_MESSAGES,
	AI_REVIEW_MODEL,
	AI_UNAVAILABLE_MESSAGE,
	aiReviewableFilter,
	clearAiOverride,
	effectiveAiScore,
	generateAiReview,
	getAiRunner,
	loadAiReviewContexts,
	overrideAiReview,
	roundToTenth,
	saveAiReview,
} from "~/domain/ai-review";
import { deletePlanDeep } from "~/lib/assign";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
	fetchChunked,
	formatDay,
	formatScore,
	REVIEW_DECISION_TONE as DECISION_TONE,
	REVIEW_PAGE_SIZE as PAGE_SIZE,
} from "~/lib/evaluation";
import { Pager } from "~/lib/pager";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	Tab,
	Table,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.evaluation";

const NewPlan = z.object({
	name: z.string().min(1, "Plan name is required"),
	instructions: z.string().optional(),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** One submission's approve/maybe/deny rows — the Decisions and AI details render the same list. */
async function loadDecisionRows(db: Db, submissionId: string) {
	const rows = await db
		.select({
			reviewer: users.name,
			reviewerEmail: users.email,
			decision: reviews.decision,
			comment: reviews.comment,
			updatedAt: reviews.updatedAt,
		})
		.from(reviews)
		.innerJoin(users, eq(users.id, reviews.reviewerId))
		.where(eq(reviews.submissionId, submissionId))
		.orderBy(desc(reviews.updatedAt));
	return rows.map((r) => ({
		reviewer: r.reviewer ?? r.reviewerEmail,
		decision: r.decision,
		comment: r.comment,
		updatedAt: formatDay(r.updatedAt),
	}));
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const url = new URL(request.url);
	// This module doubles as the layout for the plan editor; the list below is
	// only computed when the list page itself is being viewed.
	if (url.pathname !== "/admin/evaluation") {
		return data({ child: true as const });
	}
	const event = await getActiveEvent(env, user);
	if (!event) {
		return data({
			child: false as const,
			eventName: null,
			tab: "plans",
			plans: [],
			decisions: null,
			ai: null,
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const tabParam = url.searchParams.get("tab");
	const tab =
		tabParam === "decisions" || tabParam === "ai" ? tabParam : "plans";

	// Aggregates come back pre-grouped: at real scale a plan holds thousands of
	// evaluation rows, and six numbers per plan never need them materialized.
	const [planRows, roundRows, poolCounts, evalCounts, subCounts] =
		await timings.time("db-plans", () =>
			Promise.all([
				db
					.select()
					.from(evaluationPlans)
					.where(eq(evaluationPlans.eventId, event.id))
					.orderBy(evaluationPlans.createdAt),
				db
					.select({
						id: evaluationRounds.id,
						planId: evaluationRounds.planId,
						closesAt: evaluationRounds.closesAt,
					})
					.from(evaluationRounds)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(eq(evaluationPlans.eventId, event.id)),
				db
					.select({
						planId: evaluationRounds.planId,
						n: countDistinct(roundEvaluators.userId),
					})
					.from(roundEvaluators)
					.innerJoin(
						evaluationRounds,
						eq(evaluationRounds.id, roundEvaluators.roundId),
					)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(eq(evaluationPlans.eventId, event.id))
					.groupBy(evaluationRounds.planId),
				db
					.select({
						planId: evaluationRounds.planId,
						status: evaluations.status,
						n: count(),
					})
					.from(evaluations)
					.innerJoin(
						evaluationRounds,
						eq(evaluationRounds.id, evaluations.roundId),
					)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(eq(evaluationPlans.eventId, event.id))
					.groupBy(evaluationRounds.planId, evaluations.status),
				db
					.select({
						planId: evaluationRounds.planId,
						n: countDistinct(evaluations.submissionId),
					})
					.from(evaluations)
					.innerJoin(
						evaluationRounds,
						eq(evaluationRounds.id, evaluations.roundId),
					)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(eq(evaluationPlans.eventId, event.id))
					.groupBy(evaluationRounds.planId),
			]),
		);

	const plans = planRows.map((plan) => {
		const rounds = roundRows.filter((r) => r.planId === plan.id);
		const evals = evalCounts.filter((e) => e.planId === plan.id);
		const nextDue = rounds
			.map((r) => r.closesAt)
			.filter((d): d is Date => d != null && d.getTime() >= Date.now())
			.sort((a, b) => a.getTime() - b.getTime())[0];
		return {
			id: plan.id,
			name: plan.name,
			status: plan.status,
			rounds: rounds.length,
			evaluators: poolCounts.find((p) => p.planId === plan.id)?.n ?? 0,
			submissions: subCounts.find((s) => s.planId === plan.id)?.n ?? 0,
			totalEvals: evals.reduce((sum, e) => sum + e.n, 0),
			completedEvals: evals.find((e) => e.status === "completed")?.n ?? 0,
			nextDue: nextDue ? formatDay(nextDue) : null,
		};
	});

	let decisions = null;
	if (tab === "decisions") {
		const q = url.searchParams.get("q")?.trim() ?? "";
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const subParam = url.searchParams.get("sub");
		const tallies = await timings.time("db-decisions", () =>
			db
				.select({
					submissionId: reviews.submissionId,
					decision: reviews.decision,
					n: count(),
				})
				.from(reviews)
				.innerJoin(submissions, eq(submissions.id, reviews.submissionId))
				.where(eq(submissions.eventId, event.id))
				.groupBy(reviews.submissionId, reviews.decision),
		);
		const reviewedIds = [...new Set(tallies.map((t) => t.submissionId))];
		// Chunked: an event can have hundreds of reviewed submissions, and one
		// inArray over all of them would blow D1's bound-parameter cap.
		const rows = (
			await fetchChunked(reviewedIds, (chunk) =>
				db
					.select({
						id: submissions.id,
						title: submissions.title,
						status: submissions.status,
						createdAt: submissions.createdAt,
					})
					.from(submissions)
					.where(
						and(
							inArray(submissions.id, chunk),
							q ? like(submissions.title, `%${q}%`) : undefined,
						),
					),
			)
		).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		const total = rows.length;
		const pageRows = rows
			.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
			.map((row) => {
				const mine = tallies.filter((t) => t.submissionId === row.id);
				const countFor = (d: string) =>
					mine.find((t) => t.decision === d)?.n ?? 0;
				return {
					id: row.id,
					title: row.title,
					status: row.status,
					approve: countFor("approve"),
					maybe: countFor("maybe"),
					deny: countFor("deny"),
				};
			});
		let detail = null;
		if (subParam) {
			const [sub] = await db
				.select({ id: submissions.id, title: submissions.title })
				.from(submissions)
				.where(
					and(eq(submissions.id, subParam), eq(submissions.eventId, event.id)),
				)
				.limit(1);
			if (sub) {
				detail = {
					id: sub.id,
					title: sub.title,
					reviews: await loadDecisionRows(db, sub.id),
				};
			}
		}
		decisions = { rows: pageRows, total, page, q, detail };
	}

	let ai = null;
	if (tab === "ai") {
		const q = url.searchParams.get("q")?.trim() ?? "";
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const sortParam = url.searchParams.get("sort");
		const sort =
			sortParam === "ai_desc" || sortParam === "ai_asc" ? sortParam : "newest";
		const subParam = url.searchParams.get("sub");
		const reviewable = aiReviewableFilter(event.id);
		const filter = and(
			reviewable,
			q ? like(submissions.title, `%${q}%`) : undefined,
		);
		const effective = sql`coalesce(${aiReviews.overrideScore}, ${aiReviews.score})`;
		// SQLite sorts NULL smallest: DESC pushes unscored rows last for free;
		// ASC needs the explicit IS NULL key so unscored rows sink there too.
		const orderBy =
			sort === "ai_desc"
				? [sql`${effective} desc`, desc(submissions.createdAt)]
				: sort === "ai_asc"
					? [
							sql`${effective} is null`,
							sql`${effective} asc`,
							desc(submissions.createdAt),
						]
					: [desc(submissions.createdAt)];
		const [totals, missingRows, rows] = await timings.time("db-ai", () =>
			Promise.all([
				db.select({ n: count() }).from(submissions).where(filter),
				db
					.select({ n: count() })
					.from(submissions)
					.leftJoin(aiReviews, eq(aiReviews.submissionId, submissions.id))
					.where(and(reviewable, isNull(aiReviews.id))),
				db
					.select({
						id: submissions.id,
						title: submissions.title,
						status: submissions.status,
						aiScore: aiReviews.score,
						aiOverride: aiReviews.overrideScore,
						aiUpdatedAt: aiReviews.updatedAt,
					})
					.from(submissions)
					.leftJoin(aiReviews, eq(aiReviews.submissionId, submissions.id))
					.where(filter)
					.orderBy(...orderBy)
					.limit(PAGE_SIZE)
					.offset((page - 1) * PAGE_SIZE),
			]),
		);
		const pageIds = rows.map((r) => r.id);
		const tallies =
			pageIds.length === 0
				? []
				: await timings.time("db-ai-tallies", () =>
						db
							.select({
								submissionId: reviews.submissionId,
								decision: reviews.decision,
								n: count(),
							})
							.from(reviews)
							.where(inArray(reviews.submissionId, pageIds))
							.groupBy(reviews.submissionId, reviews.decision),
					);
		const tallyFor = (id: string, decision: string) =>
			tallies.find((t) => t.submissionId === id && t.decision === decision)
				?.n ?? 0;

		let detail = null;
		if (subParam) {
			const [sub] = await db
				.select({
					id: submissions.id,
					title: submissions.title,
					status: submissions.status,
				})
				.from(submissions)
				.where(
					and(eq(submissions.id, subParam), eq(submissions.eventId, event.id)),
				)
				.limit(1);
			if (sub) {
				const [aiRowArr, decisionRows] = await timings.time(
					"db-ai-detail",
					() =>
						Promise.all([
							db
								.select({
									score: aiReviews.score,
									rationale: aiReviews.rationale,
									model: aiReviews.model,
									overrideScore: aiReviews.overrideScore,
									overrideAt: aiReviews.overrideAt,
									updatedAt: aiReviews.updatedAt,
									overrideByName: users.name,
									overrideByEmail: users.email,
								})
								.from(aiReviews)
								.leftJoin(users, eq(users.id, aiReviews.overrideById))
								.where(eq(aiReviews.submissionId, sub.id))
								.limit(1),
							loadDecisionRows(db, sub.id),
						]),
				);
				const aiRow = aiRowArr[0] ?? null;
				detail = {
					id: sub.id,
					title: sub.title,
					status: sub.status,
					ai: aiRow
						? {
								score: aiRow.score,
								effective: effectiveAiScore(aiRow),
								rationale: aiRow.rationale,
								model: aiRow.model,
								ranAt: formatDay(aiRow.updatedAt),
								runStamp: aiRow.updatedAt.getTime(),
								override:
									aiRow.overrideScore == null
										? null
										: {
												score: aiRow.overrideScore,
												by:
													aiRow.overrideByName ??
													aiRow.overrideByEmail ??
													"an organizer",
												at: formatDay(aiRow.overrideAt),
											},
							}
						: null,
					decisions: decisionRows,
				};
			}
		}

		ai = {
			available: getAiRunner(env) != null,
			q,
			page,
			sort,
			total: totals[0]?.n ?? 0,
			missing: missingRows[0]?.n ?? 0,
			rows: rows.map((r) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				aiScore: r.aiScore,
				aiOverride: r.aiOverride,
				aiEffective:
					r.aiScore == null
						? null
						: effectiveAiScore({
								score: r.aiScore,
								overrideScore: r.aiOverride,
							}),
				aiUpdatedAt: r.aiUpdatedAt ? formatDay(r.aiUpdatedAt) : null,
				aiRunStamp: r.aiUpdatedAt?.getTime() ?? 0,
				approve: tallyFor(r.id, "approve"),
				maybe: tallyFor(r.id, "maybe"),
				deny: tallyFor(r.id, "deny"),
			})),
			detail,
		};
	}

	return data(
		{
			child: false as const,
			eventName: event.name,
			tab,
			plans,
			decisions,
			ai,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { intent: "none", formError: "No event is configured yet." };
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	try {
		if (intent === "create-plan") {
			const parsed = NewPlan.safeParse({
				name: form.get("name"),
				instructions: form.get("instructions") || undefined,
			});
			if (!parsed.success) {
				return {
					intent,
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
				};
			}
			const [plan] = await db
				.insert(evaluationPlans)
				.values({
					eventId: event.id,
					name: parsed.data.name,
					instructions: parsed.data.instructions ?? "",
				})
				.returning({ id: evaluationPlans.id });
			if (!plan) throw new Error("Insert returned no row");
			track("evaluation.plan_created", { eventId: event.id, planId: plan.id });
			return redirect(`/admin/evaluation/${plan.id}`);
		}
		if (intent === "toggle-plan") {
			const planId = String(form.get("planId") ?? "");
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
			if (!plan) return { intent, formError: "Plan not found." };
			const status = plan.status === "open" ? "closed" : "open";
			await db
				.update(evaluationPlans)
				.set({ status })
				.where(eq(evaluationPlans.id, planId));
			track("evaluation.plan_status_changed", {
				eventId: event.id,
				planId,
				status,
			});
			return {
				intent,
				ok: `Plan ${status === "open" ? "reopened" : "closed"}.`,
			};
		}
		if (intent === "delete-plan") {
			const planId = String(form.get("planId") ?? "");
			const [plan] = await db
				.select({ id: evaluationPlans.id })
				.from(evaluationPlans)
				.where(
					and(
						eq(evaluationPlans.id, planId),
						eq(evaluationPlans.eventId, event.id),
					),
				)
				.limit(1);
			if (!plan) return { intent, formError: "Plan not found." };
			await deletePlanDeep(db, planId);
			track("evaluation.plan_deleted", { eventId: event.id, planId });
			return { intent, ok: "Plan deleted." };
		}
		if (intent === "ai-run") {
			const runner = getAiRunner(env);
			if (!runner) return { intent, formError: AI_UNAVAILABLE_MESSAGE };
			const submissionId = String(form.get("submissionId") ?? "");
			const contexts = await loadAiReviewContexts(db, event, [submissionId]);
			const ctx = contexts.get(submissionId);
			if (!ctx) return { intent, formError: "Submission not found." };
			// Compare-and-set on the run the form was rendered against: a stale
			// resubmit (double-post, old tab) must not buy a second model call or
			// silently replace a result nobody has looked at.
			const knownRunStamp = String(form.get("knownRunStamp") ?? "");
			const [current] = await db
				.select({ updatedAt: aiReviews.updatedAt })
				.from(aiReviews)
				.where(eq(aiReviews.submissionId, submissionId))
				.limit(1);
			const currentStamp = String(current?.updatedAt.getTime() ?? 0);
			if (knownRunStamp !== currentStamp) {
				return {
					intent,
					formError:
						"This submission was scored again since you loaded the page — review the fresh result before re-running.",
				};
			}
			const result = await generateAiReview(runner, ctx);
			if (!result.ok) {
				track("ai_review.failed", {
					eventId: event.id,
					submissionId,
					reason: result.reason,
					detail: result.detail,
				});
				return { intent, formError: AI_FAILURE_MESSAGES[result.reason] };
			}
			const saved = await saveAiReview(
				db,
				submissionId,
				result,
				current?.updatedAt ?? null,
			);
			if (!saved) {
				track("ai_review.save_skipped", { eventId: event.id, submissionId });
				return {
					intent,
					formError:
						"This submission's AI review changed while the model was running — nothing was overwritten. Refresh to see the current result.",
				};
			}
			track("ai_review.scored", {
				eventId: event.id,
				submissionId,
				score: result.score,
				model: AI_REVIEW_MODEL,
			});
			return {
				intent,
				ok: `AI scored “${ctx.title}” ${formatScore(result.score)}/10.`,
			};
		}
		if (intent === "ai-run-bulk") {
			const runner = getAiRunner(env);
			if (!runner) return { intent, formError: AI_UNAVAILABLE_MESSAGE };
			const reviewable = aiReviewableFilter(event.id);
			const candidates = await db
				.select({ id: submissions.id })
				.from(submissions)
				.leftJoin(aiReviews, eq(aiReviews.submissionId, submissions.id))
				.where(and(reviewable, isNull(aiReviews.id)))
				.orderBy(asc(submissions.createdAt))
				.limit(AI_BULK_BATCH);
			if (candidates.length === 0) {
				return {
					intent,
					ok: "Every reviewable submission already has an AI review.",
				};
			}
			const contexts = await loadAiReviewContexts(
				db,
				event,
				candidates.map((c) => c.id),
			);
			let scored = 0;
			const failures: string[] = [];
			// The model calls run concurrently (I/O-bound); D1 serializes writes.
			await Promise.all(
				candidates.map(async ({ id }) => {
					const ctx = contexts.get(id);
					if (!ctx) return;
					const result = await generateAiReview(runner, ctx);
					if (!result.ok) {
						failures.push(result.reason);
						track("ai_review.failed", {
							eventId: event.id,
							submissionId: id,
							reason: result.reason,
							detail: result.detail,
						});
						return;
					}
					// Candidates had no row when selected; a concurrent scorer's row wins.
					if (await saveAiReview(db, id, result, null)) {
						scored += 1;
					} else {
						failures.push("raced");
						track("ai_review.save_skipped", {
							eventId: event.id,
							submissionId: id,
						});
					}
				}),
			);
			const [remaining] = await db
				.select({ n: count() })
				.from(submissions)
				.leftJoin(aiReviews, eq(aiReviews.submissionId, submissions.id))
				.where(and(reviewable, isNull(aiReviews.id)));
			track("ai_review.bulk_run", {
				eventId: event.id,
				scored,
				failed: failures.length,
				remaining: remaining?.n ?? 0,
			});
			const failedNote =
				failures.length > 0
					? ` ${failures.length} failed (${[...new Set(failures)].join(", ")}) — they stay unscored.`
					: "";
			const remainingNote =
				(remaining?.n ?? 0) > 0
					? ` ${remaining?.n} still unscored — run again to continue.`
					: " All reviewable submissions now have an AI score.";
			return {
				intent,
				ok: `AI reviewed ${scored} of ${candidates.length} submissions.${failedNote}${remainingNote}`,
			};
		}
		if (intent === "ai-override" || intent === "ai-clear-override") {
			const submissionId = String(form.get("submissionId") ?? "");
			const [sub] = await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(
					and(
						eq(submissions.id, submissionId),
						eq(submissions.eventId, event.id),
					),
				)
				.limit(1);
			if (!sub) return { intent, formError: "Submission not found." };
			if (intent === "ai-clear-override") {
				const cleared = await clearAiOverride(db, submissionId);
				if (!cleared) {
					return { intent, formError: "There is no AI review to restore." };
				}
				track("ai_review.override_cleared", {
					eventId: event.id,
					submissionId,
				});
				return { intent, ok: "Override removed — the AI score stands again." };
			}
			const raw = String(form.get("score") ?? "").trim();
			const parsed = z.coerce.number().min(0).max(10).safeParse(raw);
			if (!raw || !parsed.success) {
				return {
					intent,
					formError: "Override score must be a number between 0 and 10.",
				};
			}
			const score = roundToTenth(parsed.data);
			const overridden = await overrideAiReview(
				db,
				submissionId,
				score,
				user.id,
			);
			if (!overridden) {
				return {
					intent,
					formError:
						"Run the AI review first — there is no AI score to override.",
				};
			}
			track("ai_review.overridden", {
				eventId: event.id,
				submissionId,
				score,
			});
			return {
				intent,
				ok: `AI score overridden to ${formatScore(score)} — your number is now the effective score.`,
			};
		}
	} catch (error) {
		track("evaluation.action_failed", {
			eventId: event.id,
			intent,
			error: errorMessage(error),
		});
		return { intent, formError: "Something went wrong — please try again." };
	}
	return { intent, formError: "Unknown action." };
}

export default function Evaluation({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	if (loaderData.child) return <Outlet />;
	const { tab, plans, decisions, ai } = loaderData;
	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Evaluation"
				count={`${plans.length} plan${plans.length === 1 ? "" : "s"}`}
				subtitle="Structured review: plans with rounds, scorecards, and assigned reviewer pools — plus the per-submission decision tally from your reviewers' track queues."
			/>
			<Tabs>
				<Tab to="?tab=plans" count={plans.length} active={tab === "plans"}>
					Plans
				</Tab>
				<Tab to="?tab=decisions" active={tab === "decisions"}>
					Decisions
				</Tab>
				<Tab to="?tab=ai" active={tab === "ai"}>
					AI review
				</Tab>
			</Tabs>
			{actionData?.ok && (
				<StatusBadge tone="success">{actionData.ok}</StatusBadge>
			)}
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}
			{tab === "plans" && <PlansTab plans={plans} actionData={actionData} />}
			{tab === "decisions" && <DecisionsTab decisions={decisions} />}
			{tab === "ai" && <AiTab ai={ai} />}
		</div>
	);
}

function PlansTab({
	plans,
	actionData,
}: {
	plans: Array<{
		id: string;
		name: string;
		status: "open" | "closed";
		rounds: number;
		evaluators: number;
		submissions: number;
		totalEvals: number;
		completedEvals: number;
		nextDue: string | null;
	}>;
	actionData?: {
		intent?: string;
		fieldErrors?: Record<string, string[] | undefined>;
	};
}) {
	const [deleting, setDeleting] = useState<string | null>(null);
	const deletingPlan = plans.find((p) => p.id === deleting);
	return (
		<>
			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Input type="hidden" name="intent" value="create-plan" />
					<Field
						label="Plan name"
						error={
							actionData?.intent === "create-plan"
								? actionData.fieldErrors?.name?.[0]
								: undefined
						}
					>
						<Input name="name" placeholder="Program review" />
					</Field>
					<Field label="Reviewer instructions (optional)">
						<Input
							name="instructions"
							placeholder="Score each submission on originality and relevance."
							size={48}
						/>
					</Field>
					<Button type="submit" icon="plus">
						Add plan
					</Button>
				</Form>
			</Panel>
			{plans.length === 0 ? (
				<Panel>
					<EmptyState
						icon="star"
						title="No evaluation plans yet"
						body="Create a plan, add review rounds with their own scorecards and dates, then pool reviewers and assign submissions."
					/>
				</Panel>
			) : (
				<Table>
					<THead>
						<Th>Plan</Th>
						<Th>Status</Th>
						<Th>Rounds</Th>
						<Th>Evaluators</Th>
						<Th>Submissions</Th>
						<Th>Progress</Th>
						<Th>Next due</Th>
						<Th>Actions</Th>
					</THead>
					<TBody>
						{plans.map((plan) => (
							<Tr key={plan.id} selected={deleting === plan.id}>
								<Td kind="strong">{plan.name}</Td>
								<Td>
									<StatusBadge
										tone={plan.status === "open" ? "success" : "neutral"}
									>
										{plan.status === "open" ? "Open" : "Closed"}
									</StatusBadge>
								</Td>
								<Td kind="mono">{plan.rounds}</Td>
								<Td kind="mono">{plan.evaluators}</Td>
								<Td kind="mono">{plan.submissions}</Td>
								<Td kind="mono">
									{plan.completedEvals}/{plan.totalEvals}
								</Td>
								<Td kind="mono">{plan.nextDue ?? "—"}</Td>
								<Td>
									<div className="flex items-center gap-2">
										<TextLink to={`/admin/evaluation/${plan.id}`}>
											Open
										</TextLink>
										<Form method="post">
											<Input type="hidden" name="intent" value="toggle-plan" />
											<Input type="hidden" name="planId" value={plan.id} />
											<Button type="submit" variant="ghost">
												{plan.status === "open" ? "Close" : "Reopen"}
											</Button>
										</Form>
										<Button
											type="button"
											variant="ghost"
											onClick={() => setDeleting(plan.id)}
										>
											Delete
										</Button>
									</div>
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			)}
			{deletingPlan && (
				<Panel>
					<Form method="post" className="flex flex-wrap items-center gap-3">
						<Input type="hidden" name="intent" value="delete-plan" />
						<Input type="hidden" name="planId" value={deletingPlan.id} />
						<ErrorText>
							Delete “{deletingPlan.name}” and all {deletingPlan.totalEvals}{" "}
							evaluations recorded in it? This cannot be undone.
						</ErrorText>
						<Button type="submit" onClick={() => setDeleting(null)}>
							Delete plan
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setDeleting(null)}
						>
							Cancel
						</Button>
					</Form>
				</Panel>
			)}
		</>
	);
}

function DecisionsTab({
	decisions,
}: {
	decisions: {
		rows: Array<{
			id: string;
			title: string;
			status: string;
			approve: number;
			maybe: number;
			deny: number;
		}>;
		total: number;
		page: number;
		q: string;
		detail: {
			id: string;
			title: string;
			reviews: Array<{
				reviewer: string;
				decision: string;
				comment: string | null;
				updatedAt: string;
			}>;
		} | null;
	} | null;
}) {
	if (!decisions) return null;
	const { rows, total, page, q, detail } = decisions;
	const pageLink = (p: number) =>
		`?tab=decisions&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
	return (
		<>
			<Form method="get" className="flex items-center gap-3">
				<Input type="hidden" name="tab" value="decisions" />
				<SearchInput
					name="q"
					defaultValue={q}
					placeholder="Search reviewed submissions…"
				/>
				<Button type="submit" variant="ghost">
					Search
				</Button>
			</Form>
			{detail && (
				<Panel>
					<div className="flex flex-col gap-3">
						<PageHeader
							title={detail.title}
							count={`${detail.reviews.length} decision${detail.reviews.length === 1 ? "" : "s"}`}
							actions={
								<ButtonLink to={pageLink(page)} variant="ghost">
									Close
								</ButtonLink>
							}
						/>
						<Table>
							<THead>
								<Th>Reviewer</Th>
								<Th>Decision</Th>
								<Th>Comment</Th>
								<Th>Updated</Th>
							</THead>
							<TBody>
								{detail.reviews.map((r) => (
									<Tr key={`${r.reviewer}-${r.updatedAt}`}>
										<Td kind="strong">{r.reviewer}</Td>
										<Td>
											<StatusBadge
												tone={DECISION_TONE[r.decision] ?? "neutral"}
											>
												{r.decision}
											</StatusBadge>
										</Td>
										<Td>{r.comment ?? "—"}</Td>
										<Td kind="mono">{r.updatedAt}</Td>
									</Tr>
								))}
							</TBody>
						</Table>
					</div>
				</Panel>
			)}
			<Table>
				<THead>
					<Th>Submission</Th>
					<Th>Status</Th>
					<Th>Approve</Th>
					<Th>Maybe</Th>
					<Th>Deny</Th>
					<Th></Th>
				</THead>
				<TBody>
					{rows.map((row) => (
						<Tr key={row.id} selected={detail?.id === row.id}>
							<Td kind="strong">{row.title}</Td>
							<Td>
								<StatusBadge tone="neutral">
									{row.status.replace("_", " ")}
								</StatusBadge>
							</Td>
							<Td kind="mono">{row.approve}</Td>
							<Td kind="mono">{row.maybe}</Td>
							<Td kind="mono">{row.deny}</Td>
							<Td>
								<TextLink to={`${pageLink(page)}&sub=${row.id}`}>
									Detail
								</TextLink>
							</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={6}>
							{q
								? `No reviewed submissions match “${q}”. Clear the search to see all.`
								: "No reviewer decisions yet — decisions appear here as reviewers work through their track queues."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<Pager page={page} total={total} link={(p) => pageLink(p)} />
		</>
	);
}

type AiTabData = Extract<
	Awaited<ReturnType<typeof loader>>["data"],
	{ child: false }
>["ai"];

function AiTab({ ai }: { ai: AiTabData }) {
	// Model runs are paid: while any submission is in flight, every AI action
	// is disabled so a double-click can't buy a second inference.
	const busy = useNavigation().state !== "idle";
	if (!ai) return null;
	const { available, q, page, sort, total, missing, rows, detail } = ai;
	const pageLink = (over: Record<string, string | number>) => {
		const sp = new URLSearchParams({ tab: "ai", sort, page: String(page) });
		if (q) sp.set("q", q);
		for (const [k, v] of Object.entries(over)) {
			if (v === "") sp.delete(k);
			else sp.set(k, String(v));
		}
		return `?${sp.toString()}`;
	};
	return (
		<>
			{!available && (
				<Panel>
					<EmptyState
						icon="presentation"
						title="AI review is not available on this deployment"
						body="The Workers AI binding is not configured. Self-hosters: add the ai binding in wrangler.json and redeploy. Scores recorded while it was available stay visible below."
					/>
				</Panel>
			)}
			<div className="flex flex-wrap items-center gap-3">
				{available && missing > 0 && (
					<Form method="post">
						<Input type="hidden" name="intent" value="ai-run-bulk" />
						<Button type="submit" icon="star" disabled={busy}>
							{busy
								? "Running AI review…"
								: `Run AI review on unscored — ${Math.min(missing, AI_BULK_BATCH)} of ${missing} per click`}
						</Button>
					</Form>
				)}
				{available && missing === 0 && total > 0 && (
					<StatusBadge tone="success">
						Every reviewable submission has an AI first-pass score.
					</StatusBadge>
				)}
				<Form method="get" className="flex flex-wrap items-end gap-3">
					<Input type="hidden" name="tab" value="ai" />
					<SearchInput
						name="q"
						defaultValue={q}
						placeholder="Search submissions…"
					/>
					<Field label="Sort">
						<Select name="sort" defaultValue={sort}>
							<option value="newest">Newest first</option>
							<option value="ai_desc">AI score — high to low</option>
							<option value="ai_asc">AI score — low to high</option>
						</Select>
					</Field>
					<Button type="submit" variant="ghost">
						Apply
					</Button>
				</Form>
			</div>

			{detail && (
				<Panel>
					<div className="flex flex-col gap-4">
						<PageHeader
							title={detail.title}
							count={detail.status.replace("_", " ")}
							subtitle="Human reviews are authoritative — the AI score is a first-pass triage signal and never enters the decision tally or scorecard aggregates."
							actions={
								<ButtonLink to={pageLink({ sub: "" })} variant="ghost">
									Close
								</ButtonLink>
							}
						/>
						{detail.ai ? (
							<div className="flex flex-col gap-3">
								<div className="flex flex-wrap items-center gap-2">
									<StatusBadge tone="info">
										AI first-pass {formatScore(detail.ai.score)}/10
									</StatusBadge>
									{detail.ai.override && (
										<StatusBadge tone="caution">
											Overridden to {formatScore(detail.ai.override.score)} by{" "}
											{detail.ai.override.by} · {detail.ai.override.at}
										</StatusBadge>
									)}
									<StatusBadge tone="faint">
										{detail.ai.model} · ran {detail.ai.ranAt}
									</StatusBadge>
								</div>
								<Field label="AI rationale">
									<p className="max-w-[72ch] whitespace-pre-wrap">
										{detail.ai.rationale}
									</p>
								</Field>
								<div className="flex flex-wrap items-end gap-3">
									<Form method="post" className="flex items-end gap-2">
										<Input type="hidden" name="intent" value="ai-override" />
										<Input
											type="hidden"
											name="submissionId"
											value={detail.id}
										/>
										<Field label="Override score (0–10)">
											<Input
												type="number"
												name="score"
												min="0"
												max="10"
												step="0.1"
												defaultValue={
													detail.ai.override
														? String(detail.ai.override.score)
														: ""
												}
												size={6}
											/>
										</Field>
										<Button type="submit" disabled={busy}>
											Override AI score
										</Button>
									</Form>
									{detail.ai.override && (
										<Form method="post">
											<Input
												type="hidden"
												name="intent"
												value="ai-clear-override"
											/>
											<Input
												type="hidden"
												name="submissionId"
												value={detail.id}
											/>
											<Button type="submit" variant="ghost" disabled={busy}>
												Remove override
											</Button>
										</Form>
									)}
									{available && (
										<Form method="post">
											<Input type="hidden" name="intent" value="ai-run" />
											<Input
												type="hidden"
												name="submissionId"
												value={detail.id}
											/>
											<Input
												type="hidden"
												name="knownRunStamp"
												value={String(detail.ai.runStamp)}
											/>
											<Button
												type="submit"
												variant="ghost"
												icon="sync"
												disabled={busy}
											>
												Re-run — replaces the score and clears any override
											</Button>
										</Form>
									)}
								</div>
							</div>
						) : (
							<div className="flex flex-wrap items-center gap-3">
								<StatusBadge tone="faint">No AI review yet</StatusBadge>
								{available && (
									<Form method="post">
										<Input type="hidden" name="intent" value="ai-run" />
										<Input
											type="hidden"
											name="submissionId"
											value={detail.id}
										/>
										<Input type="hidden" name="knownRunStamp" value="0" />
										<Button type="submit" disabled={busy}>
											{busy ? "Running…" : "Run AI review"}
										</Button>
									</Form>
								)}
							</div>
						)}
						<Field label="Reviewer decisions (approve / maybe / deny)">
							<Table>
								<THead>
									<Th>Reviewer</Th>
									<Th>Decision</Th>
									<Th>Comment</Th>
									<Th>Updated</Th>
								</THead>
								<TBody>
									{detail.decisions.map((r) => (
										<Tr key={`${r.reviewer}-${r.updatedAt}`}>
											<Td kind="strong">{r.reviewer}</Td>
											<Td>
												<StatusBadge
													tone={DECISION_TONE[r.decision] ?? "neutral"}
												>
													{r.decision}
												</StatusBadge>
											</Td>
											<Td>{r.comment ?? "—"}</Td>
											<Td kind="mono">{r.updatedAt}</Td>
										</Tr>
									))}
									{detail.decisions.length === 0 && (
										<EmptyRow colSpan={4}>
											No reviewer decisions yet — they appear as reviewers work
											through their track queues.
										</EmptyRow>
									)}
								</TBody>
							</Table>
						</Field>
					</div>
				</Panel>
			)}

			<Table>
				<THead>
					<Th>Submission</Th>
					<Th>Status</Th>
					<Th>AI first-pass</Th>
					<Th>Ran</Th>
					<Th>Human decisions</Th>
					<Th>Actions</Th>
				</THead>
				<TBody>
					{rows.map((row) => (
						<Tr key={row.id} selected={detail?.id === row.id}>
							<Td kind="strong">{row.title}</Td>
							<Td>
								<StatusBadge tone="neutral">
									{row.status.replace("_", " ")}
								</StatusBadge>
							</Td>
							<Td>
								{row.aiScore == null ? (
									<StatusBadge tone="faint">Not scored</StatusBadge>
								) : row.aiOverride != null ? (
									<div className="flex flex-wrap items-center gap-2">
										<StatusBadge tone="caution">
											Overridden {formatScore(row.aiEffective)}
										</StatusBadge>
										<StatusBadge tone="info">
											AI {formatScore(row.aiScore)}
										</StatusBadge>
									</div>
								) : (
									<StatusBadge tone="info">
										AI {formatScore(row.aiScore)}
									</StatusBadge>
								)}
							</Td>
							<Td kind="mono">{row.aiUpdatedAt ?? "—"}</Td>
							<Td>
								{row.approve + row.maybe + row.deny === 0 ? (
									<StatusBadge tone="faint">None yet</StatusBadge>
								) : (
									`${row.approve} approve · ${row.maybe} maybe · ${row.deny} deny`
								)}
							</Td>
							<Td>
								<div className="flex items-center gap-2">
									{available && (
										<Form method="post">
											<Input type="hidden" name="intent" value="ai-run" />
											<Input type="hidden" name="submissionId" value={row.id} />
											<Input
												type="hidden"
												name="knownRunStamp"
												value={String(row.aiRunStamp)}
											/>
											<Button type="submit" variant="ghost" disabled={busy}>
												{row.aiScore == null ? "Run AI review" : "Re-run"}
											</Button>
										</Form>
									)}
									<TextLink to={pageLink({ sub: row.id })}>Detail</TextLink>
								</div>
							</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={6}>
							{q
								? `No submissions match “${q}”. Clear the search to see all.`
								: "No reviewable submissions yet — they appear here once the call for papers has entries."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<Pager page={page} total={total} link={(p) => pageLink({ page: p })} />
		</>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load evaluation"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
