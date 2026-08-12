import { useState } from "react";
import { and, count, desc, eq, inArray, notInArray } from "drizzle-orm";
import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	aiReviews,
	contacts,
	evaluationAnswers,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	participants,
	roundEvaluators,
	roundQuestions,
	submissions,
	submissionTracks,
	tracks,
	users,
} from "~/db/schema";
import { effectiveAiScore } from "~/domain/ai-review";
import { deletePlanDeep, deleteRoundDeep, mintEvaluations } from "~/lib/assign";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
	dateInputValue,
	distributeAssignments,
	EVAL_STATUS_TONE,
	fetchChunked,
	formatDay,
	formatScore,
	meanScore,
	parseDateInput,
	REVIEW_PAGE_SIZE as PAGE_SIZE,
	REVIEWABLE_EXCLUDED,
	utcDayKey,
} from "~/lib/evaluation";
import { Pager } from "~/lib/pager";
import { loadPlanScores } from "~/lib/plan-scores";
import { listEventReviewers } from "~/lib/reviewers";
import { escapeHtmlText } from "~/lib/html";
import { likeContains } from "~/lib/like";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { getEmailSender } from "~/ports/email";
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
import type { Route } from "./+types/admin.evaluation.$planId";

const TABS = ["rounds", "assign", "progress", "results", "settings"] as const;
type TabName = (typeof TABS)[number];

const RoundInput = z.object({
	name: z.string().min(1, "Round name is required"),
	opensAt: z.string().optional(),
	closesAt: z.string().optional(),
	anonymized: z.enum(["yes", "no"]),
	showOtherScores: z.enum(["yes", "no"]),
});

const QuestionInput = z
	.object({
		label: z.string().min(1, "Question label is required"),
		type: z.enum(["rating", "dropdown", "text"]),
		min: z.coerce.number().int().optional(),
		max: z.coerce.number().int().optional(),
		options: z.string().optional(),
		weight: z.coerce.number().min(0, "Weight can't be negative"),
		required: z.enum(["yes", "no"]),
	})
	.superRefine((q, ctx) => {
		if (q.type === "rating") {
			const min = q.min ?? 1;
			const max = q.max ?? 5;
			if (min >= max) {
				ctx.addIssue({
					code: "custom",
					path: ["max"],
					message: "Scale max must be greater than min",
				});
			}
		}
		if (q.type === "dropdown") {
			const options = parseOptions(q.options);
			if (options.length < 2) {
				ctx.addIssue({
					code: "custom",
					path: ["options"],
					message: "Give at least two comma-separated choices",
				});
			}
		}
	});

function parseOptions(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function questionConfig(q: z.infer<typeof QuestionInput>) {
	if (q.type === "rating") return { min: q.min ?? 1, max: q.max ?? 5 };
	if (q.type === "dropdown") return { options: parseOptions(q.options) };
	return null;
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

async function requirePlan(
	env: Env,
	user: Awaited<ReturnType<typeof requireAdmin>>,
	planId: string,
): Promise<{
	event: NonNullable<Awaited<ReturnType<typeof getActiveEvent>>>;
	plan: typeof evaluationPlans.$inferSelect;
}> {
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
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
	return { event, plan };
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const { event, plan } = await requirePlan(env, user, params.planId);
	const db = getDb(env);
	const timings = createTimings();
	const url = new URL(request.url);
	const tab = (TABS as readonly string[]).includes(
		url.searchParams.get("tab") ?? "",
	)
		? (url.searchParams.get("tab") as TabName)
		: "rounds";

	const [rounds, questions, pool, registry] = await timings.time("db", () =>
		Promise.all([
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
				.where(eq(evaluationRounds.planId, plan.id))
				.orderBy(roundQuestions.position),
			db
				.select({
					roundId: roundEvaluators.roundId,
					userId: roundEvaluators.userId,
					name: users.name,
					email: users.email,
				})
				.from(roundEvaluators)
				.innerJoin(users, eq(users.id, roundEvaluators.userId))
				.innerJoin(
					evaluationRounds,
					eq(evaluationRounds.id, roundEvaluators.roundId),
				)
				.where(eq(evaluationRounds.planId, plan.id)),
			listEventReviewers(db, event.id),
		]),
	);

	const roundViews = rounds.map((round, index) => ({
		id: round.id,
		name: round.name,
		index: index + 1,
		opensAt: dateInputValue(round.opensAt),
		closesAt: dateInputValue(round.closesAt),
		opensLabel: formatDay(round.opensAt),
		closesLabel: formatDay(round.closesAt),
		anonymized: round.anonymized,
		showOtherScores: round.showOtherScores,
		questions: questions
			.filter((q) => q.roundId === round.id)
			.map((q) => ({
				id: q.id,
				label: q.label,
				type: q.type,
				min: q.config?.min ?? 1,
				max: q.config?.max ?? 5,
				options: q.config?.options ?? [],
				weight: q.weight,
				required: q.required,
			})),
		pool: pool
			.filter((p) => p.roundId === round.id)
			.map((p) => ({ id: p.userId, name: p.name ?? p.email })),
	}));

	let assign = null;
	if (tab === "assign") {
		const roundId = url.searchParams.get("round") ?? roundViews[0]?.id ?? null;
		const q = url.searchParams.get("q")?.trim() ?? "";
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const apage = Math.max(1, Number(url.searchParams.get("apage")) || 1);
		const filter = and(
			eq(submissions.eventId, event.id),
			notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
			q ? likeContains(submissions.title, q) : undefined,
		);
		const [totals, subRows, eventTracks] = await timings.time("db-assign", () =>
			Promise.all([
				db.select({ n: count() }).from(submissions).where(filter),
				db
					.select({
						id: submissions.id,
						title: submissions.title,
						status: submissions.status,
					})
					.from(submissions)
					.where(filter)
					.orderBy(desc(submissions.createdAt))
					.limit(PAGE_SIZE)
					.offset((page - 1) * PAGE_SIZE),
				db
					.select({ id: tracks.id, name: tracks.name, color: tracks.color })
					.from(tracks)
					.where(eq(tracks.eventId, event.id))
					.orderBy(tracks.name),
			]),
		);
		let current: {
			rows: Array<{
				id: string;
				title: string;
				evaluator: string;
				status: string;
			}>;
			total: number;
		} = { rows: [], total: 0 };
		if (roundId) {
			const [asgTotal, asgRows] = await Promise.all([
				db
					.select({ n: count() })
					.from(evaluations)
					.where(eq(evaluations.roundId, roundId)),
				db
					.select({
						id: evaluations.id,
						title: submissions.title,
						status: evaluations.status,
						name: users.name,
						email: users.email,
					})
					.from(evaluations)
					.innerJoin(submissions, eq(submissions.id, evaluations.submissionId))
					.innerJoin(users, eq(users.id, evaluations.evaluatorId))
					.where(eq(evaluations.roundId, roundId))
					.orderBy(desc(evaluations.createdAt))
					.limit(PAGE_SIZE)
					.offset((apage - 1) * PAGE_SIZE),
			]);
			current = {
				total: asgTotal[0]?.n ?? 0,
				rows: asgRows.map((r) => ({
					id: r.id,
					title: r.title,
					evaluator: r.name ?? r.email,
					status: r.status,
				})),
			};
		}
		assign = {
			roundId,
			q,
			page,
			apage,
			total: totals[0]?.n ?? 0,
			submissions: subRows,
			tracks: eventTracks,
			current,
		};
	}

	let progress = null;
	if (tab === "progress") {
		const rows = await timings.time("db-progress", () =>
			db
				.select({
					roundId: evaluations.roundId,
					evaluatorId: evaluations.evaluatorId,
					status: evaluations.status,
					name: users.name,
					email: users.email,
					n: count(),
				})
				.from(evaluations)
				.innerJoin(users, eq(users.id, evaluations.evaluatorId))
				.innerJoin(
					evaluationRounds,
					eq(evaluationRounds.id, evaluations.roundId),
				)
				.where(eq(evaluationRounds.planId, plan.id))
				.groupBy(
					evaluations.roundId,
					evaluations.evaluatorId,
					evaluations.status,
					users.name,
					users.email,
				),
		);
		const byKey = new Map<
			string,
			{
				roundId: string;
				roundName: string;
				evaluatorId: string;
				evaluator: string;
				assigned: number;
				completed: number;
				abstained: number;
			}
		>();
		for (const row of rows) {
			const key = `${row.roundId} ${row.evaluatorId}`;
			const entry = byKey.get(key) ?? {
				roundId: row.roundId,
				roundName:
					roundViews.find((r) => r.id === row.roundId)?.name ?? "Round",
				evaluatorId: row.evaluatorId,
				evaluator: row.name ?? row.email,
				assigned: 0,
				completed: 0,
				abstained: 0,
			};
			entry.assigned += row.n;
			if (row.status === "completed") entry.completed += row.n;
			if (row.status === "abstained") entry.abstained += row.n;
			byKey.set(key, entry);
		}
		progress = [...byKey.values()].sort(
			(a, b) =>
				a.roundName.localeCompare(b.roundName) ||
				a.evaluator.localeCompare(b.evaluator),
		);
	}

	let results = null;
	if (tab === "results") {
		const sort = url.searchParams.get("sort") ?? "score_desc";
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const subParam = url.searchParams.get("sub");
		const scores = await timings.time("db-results", () =>
			loadPlanScores(db, plan.id),
		);
		const subMap = new Map<string, { title: string; status: string }>();
		for (const e of scores.evalRows) {
			subMap.set(e.submissionId, {
				title: e.submissionTitle,
				status: e.submissionStatus,
			});
		}
		const subRows = [...subMap].map(([id, v]) => ({ id, ...v }));
		const [speakerRows, aiRows] = await Promise.all([
			timings.time("db-speakers", () =>
				fetchChunked(
					subRows.map((s) => s.id),
					(chunk) =>
						db
							.select({
								submissionId: participants.submissionId,
								firstName: contacts.firstName,
								lastName: contacts.lastName,
								role: participants.role,
							})
							.from(participants)
							.innerJoin(contacts, eq(contacts.id, participants.contactId))
							.where(inArray(participants.submissionId, chunk)),
				),
			),
			// Scores only — the rationale text ships solely for the one ?sub= row.
			timings.time("db-ai", () =>
				fetchChunked(
					subRows.map((s) => s.id),
					(chunk) =>
						db
							.select({
								submissionId: aiReviews.submissionId,
								score: aiReviews.score,
								overrideScore: aiReviews.overrideScore,
							})
							.from(aiReviews)
							.where(inArray(aiReviews.submissionId, chunk)),
				),
			),
		]);
		const aiFor = (submissionId: string) => {
			const row = aiRows.find((a) => a.submissionId === submissionId);
			return row
				? {
						score: row.score,
						overridden: row.overrideScore != null,
						effective: effectiveAiScore(row),
					}
				: null;
		};
		const scored = scores.evalRows.map((e) => ({
			...e,
			score: scores.scoreOf(e),
		}));
		const speakersFor = (submissionId: string) =>
			speakerRows
				.filter((s) => s.submissionId === submissionId)
				.map((s) => `${s.firstName} ${s.lastName} (${s.role})`)
				.join(", ");
		let rows = subRows.map((sub) => {
			const mine = scored.filter((e) => e.submissionId === sub.id);
			const completed = mine.filter((e) => e.status === "completed");
			const perRound = roundViews.map((round) => ({
				roundId: round.id,
				score: meanScore(
					completed
						.filter((e) => e.roundId === round.id && e.score != null)
						.map((e) => e.score as number),
				),
			}));
			return {
				id: sub.id,
				title: sub.title,
				status: sub.status,
				speakers: speakersFor(sub.id),
				assigned: mine.length,
				completed: completed.length,
				abstained: mine.filter((e) => e.status === "abstained").length,
				aggregate: meanScore(
					completed
						.filter((e) => e.score != null)
						.map((e) => e.score as number),
				),
				perRound,
				ai: aiFor(sub.id),
			};
		});
		const dir = sort.endsWith("_asc") ? 1 : -1;
		if (sort.startsWith("title")) {
			rows.sort((a, b) => dir * a.title.localeCompare(b.title));
		} else {
			rows.sort((a, b) => {
				if (a.aggregate == null && b.aggregate == null)
					return a.title.localeCompare(b.title);
				if (a.aggregate == null) return 1; // unscored rows always sink
				if (b.aggregate == null) return -1;
				return dir * (a.aggregate - b.aggregate);
			});
		}
		const total = rows.length;
		rows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
		let detail = null;
		if (subParam) {
			const sub = subRows.find((s) => s.id === subParam);
			if (sub) {
				const mine = scored.filter((e) => e.submissionId === sub.id);
				const [aiRow] = await timings.time("db-ai-detail", () =>
					db
						.select({
							score: aiReviews.score,
							overrideScore: aiReviews.overrideScore,
							rationale: aiReviews.rationale,
							model: aiReviews.model,
							updatedAt: aiReviews.updatedAt,
						})
						.from(aiReviews)
						.where(eq(aiReviews.submissionId, sub.id))
						.limit(1),
				);
				detail = {
					id: sub.id,
					title: sub.title,
					speakers: speakersFor(sub.id),
					ai: aiRow
						? {
								score: aiRow.score,
								effective: effectiveAiScore(aiRow),
								overridden: aiRow.overrideScore != null,
								rationale: aiRow.rationale,
								model: aiRow.model,
								ranAt: formatDay(aiRow.updatedAt),
							}
						: null,
					evaluations: mine.map((e) => ({
						id: e.id,
						evaluator: e.evaluatorName ?? e.evaluatorEmail,
						round: roundViews.find((r) => r.id === e.roundId)?.name ?? "Round",
						status: e.status,
						abstainReason: e.abstainReason,
						score: formatScore(e.score),
						submittedAt: e.submittedAt ? formatDay(e.submittedAt) : "—",
						answers: (scores.answersByEval.get(e.id) ?? []).map((a) => {
							const q = scores.questions.find((qq) => qq.id === a.questionId);
							return {
								question: q?.label ?? "Question",
								value:
									q?.type === "rating"
										? String(a.valueNumber ?? "—")
										: (a.valueText ?? "—"),
							};
						}),
					})),
				};
			}
		}
		results = { sort, page, total, rows, detail };
	}

	return data(
		{
			plan: {
				id: plan.id,
				name: plan.name,
				instructions: plan.instructions,
				status: plan.status,
			},
			eventName: event.name,
			tab,
			rounds: roundViews,
			registry: registry.map((r) => ({
				id: r.id,
				label: r.name ?? r.email,
			})),
			assign,
			progress,
			results,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const { event, plan } = await requirePlan(env, user, params.planId);
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	const planRounds = await db
		.select()
		.from(evaluationRounds)
		.where(eq(evaluationRounds.planId, plan.id));
	const roundOf = (id: string) => planRounds.find((r) => r.id === id) ?? null;

	try {
		if (intent === "update-plan") {
			const name = String(form.get("name") ?? "").trim();
			if (!name) {
				return { intent, fieldErrors: { name: ["Plan name is required"] } };
			}
			await db
				.update(evaluationPlans)
				.set({ name, instructions: String(form.get("instructions") ?? "") })
				.where(eq(evaluationPlans.id, plan.id));
			track("evaluation.plan_updated", { eventId: event.id, planId: plan.id });
			return { intent, ok: "Plan updated." };
		}
		if (intent === "toggle-plan") {
			const status = plan.status === "open" ? "closed" : "open";
			await db
				.update(evaluationPlans)
				.set({ status })
				.where(eq(evaluationPlans.id, plan.id));
			track("evaluation.plan_status_changed", {
				eventId: event.id,
				planId: plan.id,
				status,
			});
			return {
				intent,
				ok:
					status === "closed"
						? "Plan closed — reviews are now locked."
						: "Plan reopened.",
			};
		}
		if (intent === "delete-plan") {
			await deletePlanDeep(db, plan.id);
			track("evaluation.plan_deleted", { eventId: event.id, planId: plan.id });
			return redirect("/admin/evaluation");
		}
		if (intent === "add-round" || intent === "update-round") {
			const parsed = RoundInput.safeParse({
				name: form.get("name"),
				opensAt: form.get("opensAt") || undefined,
				closesAt: form.get("closesAt") || undefined,
				anonymized: form.get("anonymized") ?? "no",
				showOtherScores: form.get("showOtherScores") ?? "no",
			});
			if (!parsed.success) {
				return {
					intent,
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
				};
			}
			const opensAt = parseDateInput(parsed.data.opensAt);
			const closesAt = parseDateInput(parsed.data.closesAt);
			if (opensAt && closesAt && closesAt.getTime() < opensAt.getTime()) {
				return {
					intent,
					fieldErrors: { closesAt: ["Close date is before the open date"] },
				};
			}
			const values = {
				name: parsed.data.name,
				opensAt,
				closesAt,
				anonymized: parsed.data.anonymized === "yes",
				showOtherScores: parsed.data.showOtherScores === "yes",
			};
			if (intent === "add-round") {
				await db.insert(evaluationRounds).values({
					...values,
					planId: plan.id,
					position: planRounds.length,
				});
				track("evaluation.round_created", {
					eventId: event.id,
					planId: plan.id,
				});
				return { intent, ok: `Round “${values.name}” added.` };
			}
			const roundId = String(form.get("roundId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			await db
				.update(evaluationRounds)
				.set(values)
				.where(eq(evaluationRounds.id, roundId));
			track("evaluation.round_updated", { eventId: event.id, roundId });
			return { intent, ok: `Round “${values.name}” updated.` };
		}
		if (intent === "delete-round") {
			const roundId = String(form.get("roundId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			await deleteRoundDeep(db, roundId);
			track("evaluation.round_deleted", { eventId: event.id, roundId });
			return { intent, ok: "Round deleted." };
		}
		if (intent === "add-question" || intent === "update-question") {
			const roundId = String(form.get("roundId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			const parsed = QuestionInput.safeParse({
				label: form.get("label"),
				type: form.get("type"),
				min: form.get("min") || undefined,
				max: form.get("max") || undefined,
				options: form.get("options") || undefined,
				weight: form.get("weight") || 1,
				required: form.get("required") ?? "yes",
			});
			if (!parsed.success) {
				return {
					intent,
					roundId,
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
				};
			}
			const values = {
				label: parsed.data.label,
				type: parsed.data.type,
				config: questionConfig(parsed.data),
				weight: parsed.data.weight,
				required: parsed.data.required === "yes",
			};
			if (intent === "add-question") {
				const [{ n }] = (await db
					.select({ n: count() })
					.from(roundQuestions)
					.where(eq(roundQuestions.roundId, roundId))) as [{ n: number }];
				await db
					.insert(roundQuestions)
					.values({ ...values, roundId, position: n });
				track("evaluation.question_created", { eventId: event.id, roundId });
				return { intent, roundId, ok: `Question “${values.label}” added.` };
			}
			const questionId = String(form.get("questionId") ?? "");
			// Changing a question's TYPE after answers exist would silently drop
			// recorded values from every aggregate — label/weight/scale edits stay
			// allowed, the type is frozen once anyone answered.
			const [current] = await db
				.select({ type: roundQuestions.type })
				.from(roundQuestions)
				.where(
					and(
						eq(roundQuestions.id, questionId),
						eq(roundQuestions.roundId, roundId),
					),
				)
				.limit(1);
			if (!current) return { intent, formError: "Question not found." };
			if (current.type !== values.type) {
				const [{ n: answered }] = (await db
					.select({ n: count() })
					.from(evaluationAnswers)
					.where(eq(evaluationAnswers.questionId, questionId))) as [
					{ n: number },
				];
				if (answered > 0) {
					return {
						intent,
						roundId,
						formError:
							"This question already has recorded answers — its type can't change. Add a new question instead.",
					};
				}
			}
			await db
				.update(roundQuestions)
				.set(values)
				.where(
					and(
						eq(roundQuestions.id, questionId),
						eq(roundQuestions.roundId, roundId),
					),
				);
			track("evaluation.question_updated", { eventId: event.id, roundId });
			return { intent, roundId, ok: `Question “${values.label}” updated.` };
		}
		if (intent === "delete-question") {
			const roundId = String(form.get("roundId") ?? "");
			const questionId = String(form.get("questionId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			// Check for recorded answers explicitly instead of catching the FK
			// error — a transient DB failure must not masquerade as this message.
			const [{ n: answered }] = (await db
				.select({ n: count() })
				.from(evaluationAnswers)
				.where(eq(evaluationAnswers.questionId, questionId))) as [
				{ n: number },
			];
			if (answered > 0) {
				return {
					intent,
					formError:
						"This question already has recorded answers — it can't be deleted. Close the round instead.",
				};
			}
			await db
				.delete(roundQuestions)
				.where(
					and(
						eq(roundQuestions.id, questionId),
						eq(roundQuestions.roundId, roundId),
					),
				);
			track("evaluation.question_deleted", { eventId: event.id, roundId });
			return { intent, ok: "Question deleted." };
		}
		if (intent === "add-evaluator") {
			const roundId = String(form.get("roundId") ?? "");
			const userId = String(form.get("userId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			if (!userId) return { intent, formError: "Pick a reviewer to add." };
			// Pool membership grants queue access — the principal must come from
			// this event's reviewer registry, never the raw form value.
			const registry = await listEventReviewers(db, event.id);
			if (!registry.some((r) => r.id === userId)) {
				return { intent, formError: "Reviewer not found on this event." };
			}
			await db
				.insert(roundEvaluators)
				.values({ roundId, userId })
				.onConflictDoNothing();
			track("evaluation.pool_added", { eventId: event.id, roundId, userId });
			return { intent, ok: "Reviewer added to the round pool." };
		}
		if (intent === "remove-evaluator") {
			const roundId = String(form.get("roundId") ?? "");
			const userId = String(form.get("userId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			await db.batch([
				db
					.delete(roundEvaluators)
					.where(
						and(
							eq(roundEvaluators.roundId, roundId),
							eq(roundEvaluators.userId, userId),
						),
					),
				db
					.delete(evaluations)
					.where(
						and(
							eq(evaluations.roundId, roundId),
							eq(evaluations.evaluatorId, userId),
							eq(evaluations.status, "pending"),
						),
					),
			]);
			track("evaluation.pool_removed", { eventId: event.id, roundId, userId });
			return {
				intent,
				ok: "Reviewer removed from the pool — completed reviews were kept.",
			};
		}
		if (intent === "assign-bulk") {
			const roundId = String(form.get("roundId") ?? "");
			const round = roundOf(roundId);
			if (!round) return { intent, formError: "Round not found." };
			const scope = String(form.get("scope") ?? "all");
			const trackIds = form.getAll("trackIds").map(String).filter(Boolean);
			const pickedEvaluators = form
				.getAll("evaluatorIds")
				.map(String)
				.filter(Boolean);
			const rpsRaw = String(form.get("reviewersPerSubmission") ?? "").trim();
			const capRaw = String(form.get("maxPerEvaluator") ?? "").trim();
			const reviewersPerSubmission = rpsRaw ? Number(rpsRaw) : null;
			const maxPerEvaluator = capRaw ? Number(capRaw) : null;
			if (
				(reviewersPerSubmission != null &&
					(!Number.isInteger(reviewersPerSubmission) ||
						reviewersPerSubmission < 1)) ||
				(maxPerEvaluator != null &&
					(!Number.isInteger(maxPerEvaluator) || maxPerEvaluator < 1))
			) {
				return {
					intent,
					formError: "Workload caps must be whole numbers of 1 or more.",
				};
			}
			if (scope === "tracks" && trackIds.length === 0) {
				return {
					intent,
					formError: "Pick at least one track to filter by.",
				};
			}
			const poolRows = await db
				.select({ userId: roundEvaluators.userId })
				.from(roundEvaluators)
				.where(eq(roundEvaluators.roundId, roundId));
			const poolIds = poolRows.map((p) => p.userId);
			const evaluatorIds =
				pickedEvaluators.length > 0
					? pickedEvaluators.filter((id) => poolIds.includes(id))
					: poolIds;
			if (evaluatorIds.length === 0) {
				return {
					intent,
					formError:
						"This round has no reviewer pool yet — add evaluators on the Rounds tab first.",
				};
			}
			const baseFilter = and(
				eq(submissions.eventId, event.id),
				notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
			);
			const subRows =
				scope === "tracks"
					? await db
							.selectDistinct({ id: submissions.id })
							.from(submissions)
							.innerJoin(
								submissionTracks,
								eq(submissionTracks.submissionId, submissions.id),
							)
							.where(
								and(baseFilter, inArray(submissionTracks.trackId, trackIds)),
							)
					: await db
							.select({ id: submissions.id })
							.from(submissions)
							.where(baseFilter);
			const existing = await db
				.select({
					submissionId: evaluations.submissionId,
					evaluatorId: evaluations.evaluatorId,
				})
				.from(evaluations)
				.where(eq(evaluations.roundId, roundId));
			const pairs = distributeAssignments({
				submissionIds: subRows.map((s) => s.id),
				evaluatorIds,
				existing,
				reviewersPerSubmission,
				maxPerEvaluator,
			});
			const minted = await mintEvaluations(db, roundId, pairs, existing);
			track("evaluation.assigned_bulk", {
				eventId: event.id,
				roundId,
				minted,
				scope,
			});
			return {
				intent,
				ok: `Assigned ${minted} evaluation${minted === 1 ? "" : "s"} across ${evaluatorIds.length} reviewer${evaluatorIds.length === 1 ? "" : "s"} (${subRows.length} submissions in scope).`,
			};
		}
		if (intent === "assign-one") {
			const roundId = String(form.get("roundId") ?? "");
			const submissionId = String(form.get("submissionId") ?? "");
			const evaluatorId = String(form.get("evaluatorId") ?? "");
			if (!roundOf(roundId)) return { intent, formError: "Round not found." };
			if (!evaluatorId) {
				return { intent, formError: "Pick a reviewer to assign." };
			}
			// The minted row grants /reviews access — validate the principal
			// against the event's reviewer registry, never the raw form value.
			const registry = await listEventReviewers(db, event.id);
			if (!registry.some((r) => r.id === evaluatorId)) {
				return { intent, formError: "Reviewer not found on this event." };
			}
			const [sub] = await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(
					and(
						eq(submissions.id, submissionId),
						eq(submissions.eventId, event.id),
						notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
					),
				)
				.limit(1);
			if (!sub) return { intent, formError: "Submission not found." };
			await db
				.insert(roundEvaluators)
				.values({ roundId, userId: evaluatorId })
				.onConflictDoNothing();
			const minted = await mintEvaluations(db, roundId, [
				{ submissionId, evaluatorId },
			]);
			track("evaluation.assigned_one", { eventId: event.id, roundId, minted });
			return {
				intent,
				ok: minted === 1 ? "Assigned." : "Already assigned.",
			};
		}
		if (intent === "unassign") {
			const evaluationId = String(form.get("evaluationId") ?? "");
			const [row] = await db
				.select({ id: evaluations.id, status: evaluations.status })
				.from(evaluations)
				.innerJoin(
					evaluationRounds,
					eq(evaluationRounds.id, evaluations.roundId),
				)
				.where(
					and(
						eq(evaluations.id, evaluationId),
						eq(evaluationRounds.planId, plan.id),
					),
				)
				.limit(1);
			if (!row) return { intent, formError: "Assignment not found." };
			if (row.status !== "pending") {
				return {
					intent,
					formError:
						"Only pending assignments can be removed — this one already has a recorded review.",
				};
			}
			await db.delete(evaluations).where(eq(evaluations.id, evaluationId));
			track("evaluation.unassigned", { eventId: event.id, evaluationId });
			return { intent, ok: "Assignment removed." };
		}
		if (intent === "remind") {
			const roundId = String(form.get("roundId") ?? "");
			const userIds = form.getAll("userIds").map(String).filter(Boolean);
			const targets = planRounds.filter((r) =>
				roundId === "all" ? true : r.id === roundId,
			);
			if (targets.length === 0) {
				return { intent, formError: "Round not found." };
			}
			const pendingRows = await db
				.select({
					roundId: evaluations.roundId,
					evaluatorId: evaluations.evaluatorId,
					email: users.email,
					name: users.name,
					n: count(),
				})
				.from(evaluations)
				.innerJoin(users, eq(users.id, evaluations.evaluatorId))
				.innerJoin(
					evaluationRounds,
					eq(evaluationRounds.id, evaluations.roundId),
				)
				.where(
					and(
						eq(evaluationRounds.planId, plan.id),
						eq(evaluations.status, "pending"),
					),
				)
				.groupBy(
					evaluations.roundId,
					evaluations.evaluatorId,
					users.email,
					users.name,
				);
			const targetIds = new Set(targets.map((t) => t.id));
			const lagging = pendingRows.filter(
				(row) =>
					targetIds.has(row.roundId) &&
					(userIds.length === 0 || userIds.includes(row.evaluatorId)),
			);
			if (lagging.length === 0) {
				return {
					intent,
					ok: "Nothing to remind — everyone selected is fully caught up.",
				};
			}
			const sender = getEmailSender(env);
			const origin = new URL(request.url).origin;
			const day = utcDayKey();
			let sent = 0;
			let already = 0;
			for (const row of lagging) {
				const round = planRounds.find((r) => r.id === row.roundId);
				const result = await sender.send({
					to: row.email,
					subject: `Reminder: ${row.n} review${row.n === 1 ? "" : "s"} waiting in ${round?.name ?? "your queue"} — ${event.name}`,
					html: `<p>Hi ${escapeHtmlText(row.name ?? row.email)},</p><p>You have ${row.n} pending review${row.n === 1 ? "" : "s"} in <strong>${escapeHtmlText(round?.name ?? "your round")}</strong> for ${escapeHtmlText(event.name)}${round?.closesAt ? ` (closes ${formatDay(round.closesAt)})` : ""}.</p><p><a href="${origin}/reviews">Open your review queue</a></p>`,
					// One reminder per reviewer per round per day — a double-clicked
					// button can't spam, a deliberate nudge tomorrow still sends.
					dedupeKey: `eval_reminder:${row.roundId}:${row.evaluatorId}:${day}`,
					eventId: event.id,
				});
				if (result.deduped) already += 1;
				else sent += 1;
			}
			track("evaluation.reminders_sent", {
				eventId: event.id,
				planId: plan.id,
				sent,
				already,
			});
			return {
				intent,
				ok: `Sent ${sent} reminder${sent === 1 ? "" : "s"}${already > 0 ? ` (${already} already reminded today)` : ""}.`,
			};
		}
	} catch (error) {
		track("evaluation.action_failed", {
			eventId: event.id,
			planId: plan.id,
			intent,
			error: errorMessage(error),
		});
		return { intent, formError: "Something went wrong — please try again." };
	}
	return { intent, formError: "Unknown action." };
}

type LoaderData = Awaited<ReturnType<typeof loader>>["data"];

export default function PlanEditor({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { plan, tab, rounds, registry, assign, progress, results } = loaderData;
	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={plan.name}
				count={plan.status === "open" ? "Open" : "Closed"}
				subtitle={plan.instructions || "No reviewer instructions yet."}
				actions={
					<ButtonLink to="/admin/evaluation" variant="ghost">
						All plans
					</ButtonLink>
				}
			/>
			<Tabs>
				<Tab to="?tab=rounds" active={tab === "rounds"} count={rounds.length}>
					Rounds
				</Tab>
				<Tab to="?tab=assign" active={tab === "assign"}>
					Assignments
				</Tab>
				<Tab to="?tab=progress" active={tab === "progress"}>
					Progress
				</Tab>
				<Tab to="?tab=results" active={tab === "results"}>
					Results
				</Tab>
				<Tab to="?tab=settings" active={tab === "settings"}>
					Settings
				</Tab>
			</Tabs>
			{actionData?.ok && (
				<StatusBadge tone="success">{actionData.ok}</StatusBadge>
			)}
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}
			{tab === "rounds" && (
				<RoundsTab
					rounds={rounds}
					registry={registry}
					actionData={actionData}
				/>
			)}
			{tab === "assign" && assign && (
				<AssignTab rounds={rounds} assign={assign} />
			)}
			{tab === "progress" && <ProgressTab progress={progress ?? []} />}
			{tab === "results" && results && (
				<ResultsTab planId={plan.id} rounds={rounds} results={results} />
			)}
			{tab === "settings" && <SettingsTab plan={plan} />}
		</div>
	);
}

type RoundView = LoaderData["rounds"][number];

function RoundsTab({
	rounds,
	registry,
	actionData,
}: {
	rounds: RoundView[];
	registry: Array<{ id: string; label: string }>;
	actionData?: {
		intent?: string;
		roundId?: string;
		fieldErrors?: Record<string, string[] | undefined>;
	};
}) {
	const busy = useBusy();
	const [editing, setEditing] = useState<string | null>(null);
	const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	return (
		<>
			{rounds.length === 0 && (
				<Panel>
					<EmptyState
						icon="star"
						title="No rounds yet"
						body="A plan needs at least one round. Each round has its own dates, scorecard, anonymization setting, and reviewer pool."
					/>
				</Panel>
			)}
			{rounds.map((round) => (
				<Panel key={round.id}>
					<div className="flex flex-col gap-4">
						<PageHeader
							title={round.name}
							count={`Round ${round.index}`}
							subtitle={
								<>
									{round.opensLabel} – {round.closesLabel}
									{round.anonymized ? " · Anonymized review" : ""}
									{round.showOtherScores
										? " · Reviewers see each other's scores"
										: ""}
								</>
							}
							actions={
								<>
									<Button
										type="button"
										variant="ghost"
										onClick={() =>
											setEditing(editing === round.id ? null : round.id)
										}
									>
										{editing === round.id ? "Close editor" : "Edit round"}
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={() => setConfirming(round.id)}
									>
										Delete
									</Button>
								</>
							}
						/>
						{confirming === round.id && (
							<Form method="post" className="flex flex-wrap items-center gap-3">
								<Input type="hidden" name="intent" value="delete-round" />
								<Input type="hidden" name="roundId" value={round.id} />
								<ErrorText>
									Delete “{round.name}” with its scorecard and every evaluation
									recorded in it? This cannot be undone.
								</ErrorText>
								<Button
									type="submit"
									disabled={busy}
									onClick={() => setConfirming(null)}
								>
									Delete round
								</Button>
								<Button
									type="button"
									variant="ghost"
									onClick={() => setConfirming(null)}
								>
									Cancel
								</Button>
							</Form>
						)}
						{editing === round.id && (
							<RoundForm
								intent="update-round"
								round={round}
								actionData={actionData}
							/>
						)}
						<Table>
							<THead>
								<Th>Question</Th>
								<Th>Type</Th>
								<Th>Scale / choices</Th>
								<Th>Weight</Th>
								<Th>Required</Th>
								<Th>Actions</Th>
							</THead>
							<TBody>
								{round.questions.map((q) => (
									<Tr key={q.id} selected={editingQuestion === q.id}>
										<Td kind="strong">{q.label}</Td>
										<Td>{q.type}</Td>
										<Td>
											{q.type === "rating"
												? `${q.min}–${q.max}`
												: q.type === "dropdown"
													? q.options.join(" / ")
													: "free text"}
										</Td>
										<Td kind="mono">{q.weight}</Td>
										<Td>{q.required ? "Yes" : "No"}</Td>
										<Td>
											<div className="flex gap-2">
												<Button
													type="button"
													variant="ghost"
													onClick={() =>
														setEditingQuestion(
															editingQuestion === q.id ? null : q.id,
														)
													}
												>
													Edit
												</Button>
												<Form method="post">
													<Input
														type="hidden"
														name="intent"
														value="delete-question"
													/>
													<Input
														type="hidden"
														name="roundId"
														value={round.id}
													/>
													<Input type="hidden" name="questionId" value={q.id} />
													<Button type="submit" variant="ghost" disabled={busy}>
														Delete
													</Button>
												</Form>
											</div>
										</Td>
									</Tr>
								))}
								{round.questions.length === 0 && (
									<EmptyRow colSpan={6}>
										No questions yet — add a rating scale, dropdown, or text
										question below. Weights feed the aggregate score.
									</EmptyRow>
								)}
							</TBody>
						</Table>
						{editingQuestion &&
							round.questions.some((q) => q.id === editingQuestion) && (
								<QuestionForm
									intent="update-question"
									roundId={round.id}
									question={round.questions.find(
										(q) => q.id === editingQuestion,
									)}
									actionData={actionData}
									onDone={() => setEditingQuestion(null)}
								/>
							)}
						<QuestionForm
							intent="add-question"
							roundId={round.id}
							actionData={actionData}
						/>
						<div className="flex flex-wrap items-end gap-3">
							<Field label="Reviewer pool for this round">
								<div className="flex min-h-[34px] flex-wrap items-center gap-2">
									{round.pool.map((member) => (
										<Form method="post" key={member.id}>
											<Input
												type="hidden"
												name="intent"
												value="remove-evaluator"
											/>
											<Input type="hidden" name="roundId" value={round.id} />
											<Input type="hidden" name="userId" value={member.id} />
											<div className="flex items-center gap-1">
												<StatusBadge tone="info">{member.name}</StatusBadge>
												<Button type="submit" variant="ghost" disabled={busy}>
													Remove
												</Button>
											</div>
										</Form>
									))}
									{round.pool.length === 0 && (
										<StatusBadge tone="faint">
											No evaluators pooled yet
										</StatusBadge>
									)}
								</div>
							</Field>
							<Form method="post" className="flex items-end gap-2">
								<Input type="hidden" name="intent" value="add-evaluator" />
								<Input type="hidden" name="roundId" value={round.id} />
								<Field label="Add evaluator">
									<Select name="userId" defaultValue="">
										<option value="">Pick a reviewer…</option>
										{registry
											.filter((r) => !round.pool.some((m) => m.id === r.id))
											.map((r) => (
												<option key={r.id} value={r.id}>
													{r.label}
												</option>
											))}
									</Select>
								</Field>
								<Button
									type="submit"
									variant="ghost"
									icon="plus"
									disabled={busy}
								>
									Add to pool
								</Button>
							</Form>
							<TextLink to="/admin/reviewers">Manage reviewers</TextLink>
						</div>
					</div>
				</Panel>
			))}
			<Panel>
				<RoundForm intent="add-round" actionData={actionData} />
			</Panel>
		</>
	);
}

function RoundForm({
	intent,
	round,
	actionData,
}: {
	intent: "add-round" | "update-round";
	round?: RoundView;
	actionData?: {
		intent?: string;
		fieldErrors?: Record<string, string[] | undefined>;
	};
}) {
	const busy = useBusy();
	const errors =
		actionData?.intent === intent ? actionData.fieldErrors : undefined;
	return (
		<Form method="post" className="flex flex-wrap items-end gap-3">
			<Input type="hidden" name="intent" value={intent} />
			{round && <Input type="hidden" name="roundId" value={round.id} />}
			<Field label="Round name" error={errors?.name?.[0]}>
				<Input
					name="name"
					defaultValue={round?.name}
					placeholder={round ? undefined : "Initial Review"}
				/>
			</Field>
			<Field label="Opens">
				<Input type="date" name="opensAt" defaultValue={round?.opensAt} />
			</Field>
			<Field label="Closes (inclusive)" error={errors?.closesAt?.[0]}>
				<Input type="date" name="closesAt" defaultValue={round?.closesAt} />
			</Field>
			<Field label="Anonymized review">
				<Select
					name="anonymized"
					defaultValue={round?.anonymized ? "yes" : "no"}
				>
					<option value="no">No — reviewers see identity</option>
					<option value="yes">Yes — hide participant identity</option>
				</Select>
			</Field>
			<Field label="Show other evaluators' scores">
				<Select
					name="showOtherScores"
					defaultValue={round?.showOtherScores ? "yes" : "no"}
				>
					<option value="no">No (default)</option>
					<option value="yes">Yes — scores only, never comments</option>
				</Select>
			</Field>
			<Button type="submit" icon={round ? undefined : "plus"} disabled={busy}>
				{round ? "Save round" : "Add round"}
			</Button>
		</Form>
	);
}

function QuestionForm({
	intent,
	roundId,
	question,
	actionData,
	onDone,
}: {
	intent: "add-question" | "update-question";
	roundId: string;
	question?: RoundView["questions"][number];
	actionData?: {
		intent?: string;
		roundId?: string;
		fieldErrors?: Record<string, string[] | undefined>;
	};
	onDone?: () => void;
}) {
	const busy = useBusy();
	const errors =
		actionData?.intent === intent && actionData.roundId === roundId
			? actionData.fieldErrors
			: undefined;
	return (
		<Form method="post" className="flex flex-wrap items-end gap-3">
			<Input type="hidden" name="intent" value={intent} />
			<Input type="hidden" name="roundId" value={roundId} />
			{question && (
				<Input type="hidden" name="questionId" value={question.id} />
			)}
			<Field
				label={question ? `Edit “${question.label}”` : "Question label"}
				error={errors?.label?.[0]}
			>
				<Input
					name="label"
					defaultValue={question?.label}
					placeholder="Originality"
				/>
			</Field>
			<Field label="Type">
				<Select name="type" defaultValue={question?.type ?? "rating"}>
					<option value="rating">Rating scale</option>
					<option value="dropdown">Dropdown</option>
					<option value="text">Free text</option>
				</Select>
			</Field>
			<Field label="Scale min (rating)">
				<Input
					type="number"
					name="min"
					defaultValue={question?.min ?? 1}
					size={4}
				/>
			</Field>
			<Field label="Scale max (rating)" error={errors?.max?.[0]}>
				<Input
					type="number"
					name="max"
					defaultValue={question?.max ?? 5}
					size={4}
				/>
			</Field>
			<Field
				label="Choices, comma-separated (dropdown)"
				error={errors?.options?.[0]}
			>
				<Input
					name="options"
					defaultValue={question?.options.join(", ")}
					placeholder="Accept, Maybe, Reject"
				/>
			</Field>
			<Field label="Weight" error={errors?.weight?.[0]}>
				<Input
					type="number"
					name="weight"
					step="0.5"
					min="0"
					defaultValue={question?.weight ?? 1}
					size={4}
				/>
			</Field>
			<Field label="Required">
				<Select
					name="required"
					defaultValue={question?.required === false ? "no" : "yes"}
				>
					<option value="yes">Yes</option>
					<option value="no">No</option>
				</Select>
			</Field>
			<Button
				type="submit"
				variant={question ? "primary" : "ghost"}
				icon={question ? undefined : "plus"}
				disabled={busy}
				onClick={onDone}
			>
				{question ? "Save question" : "Add question"}
			</Button>
		</Form>
	);
}

function AssignTab({
	rounds,
	assign,
}: {
	rounds: RoundView[];
	assign: NonNullable<LoaderData["assign"]>;
}) {
	const busy = useBusy();
	const round = rounds.find((r) => r.id === assign.roundId) ?? rounds[0];
	const baseParams = (over: Record<string, string | number>) => {
		const sp = new URLSearchParams({ tab: "assign" });
		if (round) sp.set("round", round.id);
		if (assign.q) sp.set("q", assign.q);
		sp.set("page", String(assign.page));
		sp.set("apage", String(assign.apage));
		for (const [k, v] of Object.entries(over)) sp.set(k, String(v));
		return `?${sp.toString()}`;
	};
	if (!round) {
		return (
			<Panel>
				<EmptyState
					icon="star"
					title="No rounds to assign into"
					body="Create a round on the Rounds tab first — assignments mint each reviewer's queue for a specific round."
				/>
			</Panel>
		);
	}
	return (
		<>
			<Form method="get" className="flex flex-wrap items-end gap-3">
				<Input type="hidden" name="tab" value="assign" />
				<Field label="Round">
					<Select name="round" defaultValue={round.id}>
						{rounds.map((r) => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</Select>
				</Field>
				<Button type="submit" variant="ghost">
					Switch round
				</Button>
			</Form>

			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Input type="hidden" name="intent" value="assign-bulk" />
					<Input type="hidden" name="roundId" value={round.id} />
					<Field label="Submissions in scope">
						<Select name="scope" defaultValue="all">
							<option value="all">All reviewable submissions</option>
							<option value="tracks">Filtered by track</option>
						</Select>
					</Field>
					<Field label="Tracks (for track filter; Ctrl/Cmd for several)">
						<Select
							name="trackIds"
							multiple
							size={Math.min(Math.max(assign.tracks.length, 2), 4)}
						>
							{assign.tracks.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Evaluators (empty = whole pool)">
						<Select
							name="evaluatorIds"
							multiple
							size={Math.min(Math.max(round.pool.length, 2), 4)}
						>
							{round.pool.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Reviewers per submission (empty = all)">
						<Input
							type="number"
							name="reviewersPerSubmission"
							min="1"
							size={4}
						/>
					</Field>
					<Field label="Max per evaluator (empty = no cap)">
						<Input type="number" name="maxPerEvaluator" min="1" size={4} />
					</Field>
					<Button type="submit" disabled={busy}>
						Auto-distribute
					</Button>
				</Form>
			</Panel>

			<Form method="get" className="flex items-center gap-3">
				<Input type="hidden" name="tab" value="assign" />
				<Input type="hidden" name="round" value={round.id} />
				<SearchInput
					name="q"
					defaultValue={assign.q}
					placeholder="Search submissions to assign…"
				/>
				<Button type="submit" variant="ghost">
					Search
				</Button>
			</Form>
			<Table>
				<THead>
					<Th>Submission</Th>
					<Th>Status</Th>
					<Th>Assign to</Th>
				</THead>
				<TBody>
					{assign.submissions.map((s) => (
						<Tr key={s.id}>
							<Td kind="strong">{s.title}</Td>
							<Td>
								<StatusBadge tone="neutral">
									{s.status.replace("_", " ")}
								</StatusBadge>
							</Td>
							<Td>
								<Form method="post" className="flex items-center gap-2">
									<Input type="hidden" name="intent" value="assign-one" />
									<Input type="hidden" name="roundId" value={round.id} />
									<Input type="hidden" name="submissionId" value={s.id} />
									<Select name="evaluatorId" defaultValue="">
										<option value="">Pick reviewer…</option>
										{round.pool.map((m) => (
											<option key={m.id} value={m.id}>
												{m.name}
											</option>
										))}
									</Select>
									<Button type="submit" variant="ghost" disabled={busy}>
										Assign
									</Button>
								</Form>
							</Td>
						</Tr>
					))}
					{assign.submissions.length === 0 && (
						<EmptyRow colSpan={3}>
							{assign.q
								? `No submissions match “${assign.q}”.`
								: "No reviewable submissions yet — they appear here once the call for papers has entries."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<Pager
				page={assign.page}
				total={assign.total}
				link={(p) => baseParams({ page: p })}
			/>

			<PageHeader
				title="Current assignments"
				count={`${assign.current.total} in ${round.name}`}
			/>
			<Table>
				<THead>
					<Th>Submission</Th>
					<Th>Evaluator</Th>
					<Th>Status</Th>
					<Th></Th>
				</THead>
				<TBody>
					{assign.current.rows.map((row) => (
						<Tr key={row.id}>
							<Td kind="strong">{row.title}</Td>
							<Td>{row.evaluator}</Td>
							<Td>
								<StatusBadge tone={EVAL_STATUS_TONE[row.status] ?? "neutral"}>
									{row.status}
								</StatusBadge>
							</Td>
							<Td>
								{row.status === "pending" && (
									<Form method="post">
										<Input type="hidden" name="intent" value="unassign" />
										<Input type="hidden" name="evaluationId" value={row.id} />
										<Button type="submit" variant="ghost" disabled={busy}>
											Remove
										</Button>
									</Form>
								)}
							</Td>
						</Tr>
					))}
					{assign.current.rows.length === 0 && (
						<EmptyRow colSpan={4}>
							Nothing assigned in this round yet — use auto-distribute above or
							assign submissions one by one.
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<Pager
				page={assign.apage}
				total={assign.current.total}
				link={(p) => baseParams({ apage: p })}
			/>
		</>
	);
}

function ProgressTab({
	progress,
}: {
	progress: NonNullable<LoaderData["progress"]>;
}) {
	const busy = useBusy();
	return (
		<>
			<div className="flex items-center gap-3">
				<Form method="post">
					<Input type="hidden" name="intent" value="remind" />
					<Input type="hidden" name="roundId" value="all" />
					<Button type="submit" icon="mail" disabled={busy}>
						Remind all lagging reviewers
					</Button>
				</Form>
			</div>
			<Table>
				<THead>
					<Th>Round</Th>
					<Th>Reviewer</Th>
					<Th>Assigned</Th>
					<Th>Completed</Th>
					<Th>Abstained</Th>
					<Th>Pending</Th>
					<Th></Th>
				</THead>
				<TBody>
					{progress.map((row) => {
						const pending = row.assigned - row.completed - row.abstained;
						return (
							<Tr key={`${row.roundId}-${row.evaluatorId}`}>
								<Td>{row.roundName}</Td>
								<Td kind="strong">{row.evaluator}</Td>
								<Td kind="mono">{row.assigned}</Td>
								<Td kind="mono">{row.completed}</Td>
								<Td kind="mono">{row.abstained}</Td>
								<Td kind="mono">{pending}</Td>
								<Td>
									{pending > 0 && (
										<Form method="post">
											<Input type="hidden" name="intent" value="remind" />
											<Input type="hidden" name="roundId" value={row.roundId} />
											<Input
												type="hidden"
												name="userIds"
												value={row.evaluatorId}
											/>
											<Button
												type="submit"
												variant="ghost"
												icon="mail"
												disabled={busy}
											>
												Send reminder
											</Button>
										</Form>
									)}
								</Td>
							</Tr>
						);
					})}
					{progress.length === 0 && (
						<EmptyRow colSpan={7}>
							No assignments yet — reviewer progress appears here once
							submissions are assigned.
						</EmptyRow>
					)}
				</TBody>
			</Table>
		</>
	);
}

function ResultsTab({
	planId,
	rounds,
	results,
}: {
	planId: string;
	rounds: RoundView[];
	results: NonNullable<LoaderData["results"]>;
}) {
	const { sort, page, total, rows, detail } = results;
	const link = (over: Record<string, string | number>) => {
		const sp = new URLSearchParams({
			tab: "results",
			sort,
			page: String(page),
		});
		for (const [k, v] of Object.entries(over)) sp.set(k, String(v));
		return `?${sp.toString()}`;
	};
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<Form method="get" action="/admin/evaluation/export.csv" reloadDocument>
					<Input type="hidden" name="plan" value={planId} />
					<Input type="hidden" name="report" value="individual" />
					<Button type="submit" variant="ghost" icon="export">
						Export CSV (per review)
					</Button>
				</Form>
				<Form method="get" action="/admin/evaluation/export.csv" reloadDocument>
					<Input type="hidden" name="plan" value={planId} />
					<Input type="hidden" name="report" value="cumulative" />
					<Button type="submit" variant="ghost" icon="export">
						Export CSV (per submission)
					</Button>
				</Form>
			</div>
			{detail && (
				<Panel>
					<div className="flex flex-col gap-3">
						<PageHeader
							title={detail.title}
							subtitle={
								detail.speakers
									? `Speakers: ${detail.speakers}`
									: "No participants recorded."
							}
							actions={
								<ButtonLink to={link({})} variant="ghost">
									Close
								</ButtonLink>
							}
						/>
						{detail.ai && (
							<Field label="AI first-pass review — a triage signal that never enters the human aggregate">
								<div className="flex flex-col gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<StatusBadge tone="info">
											AI {formatScore(detail.ai.score)}/10
										</StatusBadge>
										{detail.ai.overridden && (
											<StatusBadge tone="caution">
												Overridden to {formatScore(detail.ai.effective)} by an
												organizer
											</StatusBadge>
										)}
										<StatusBadge tone="faint">
											{detail.ai.model} · ran {detail.ai.ranAt}
										</StatusBadge>
										<TextLink to={`/admin/evaluation?tab=ai&sub=${detail.id}`}>
											Manage AI review
										</TextLink>
									</div>
									<p className="max-w-[72ch] whitespace-pre-wrap">
										{detail.ai.rationale}
									</p>
								</div>
							</Field>
						)}
						<Table>
							<THead>
								<Th>Evaluator</Th>
								<Th>Round</Th>
								<Th>Status</Th>
								<Th>Weighted score</Th>
								<Th>Submitted</Th>
							</THead>
							<TBody>
								{detail.evaluations.map((e) => (
									<Tr key={e.id}>
										<Td kind="strong">{e.evaluator}</Td>
										<Td>{e.round}</Td>
										<Td>
											<StatusBadge
												tone={EVAL_STATUS_TONE[e.status] ?? "neutral"}
											>
												{e.status === "abstained" && e.abstainReason
													? `abstained — ${e.abstainReason}`
													: e.status}
											</StatusBadge>
										</Td>
										<Td kind="mono">{e.score}</Td>
										<Td kind="mono">{e.submittedAt}</Td>
									</Tr>
								))}
							</TBody>
						</Table>
						<Table>
							<THead>
								<Th>Evaluator</Th>
								<Th>Question</Th>
								<Th>Answer</Th>
							</THead>
							<TBody>
								{detail.evaluations.flatMap((e) =>
									e.answers.map((a, i) => (
										<Tr key={`${e.id}-${i}`}>
											<Td>{e.evaluator}</Td>
											<Td kind="strong">{a.question}</Td>
											<Td>{a.value}</Td>
										</Tr>
									)),
								)}
								{detail.evaluations.every((e) => e.answers.length === 0) && (
									<EmptyRow colSpan={3}>No answers recorded yet.</EmptyRow>
								)}
							</TBody>
						</Table>
					</div>
				</Panel>
			)}
			<Table>
				<THead>
					<Th>
						<TextLink
							to={link({
								sort: sort === "title_asc" ? "title_desc" : "title_asc",
								page: 1,
							})}
						>
							Submission{" "}
							{sort === "title_asc" ? "↑" : sort === "title_desc" ? "↓" : ""}
						</TextLink>
					</Th>
					<Th>Speakers</Th>
					<Th>Status</Th>
					<Th>Reviews</Th>
					{rounds.map((r) => (
						<Th key={r.id}>{r.name}</Th>
					))}
					<Th>
						<TextLink
							to={link({
								sort: sort === "score_desc" ? "score_asc" : "score_desc",
								page: 1,
							})}
						>
							Score{" "}
							{sort === "score_asc" ? "↑" : sort === "score_desc" ? "↓" : ""}
						</TextLink>
					</Th>
					<Th>AI first-pass</Th>
					<Th></Th>
				</THead>
				<TBody>
					{rows.map((row) => (
						<Tr key={row.id} selected={detail?.id === row.id}>
							<Td kind="strong">{row.title}</Td>
							<Td>{row.speakers || "—"}</Td>
							<Td>
								<StatusBadge tone="neutral">
									{row.status.replace("_", " ")}
								</StatusBadge>
							</Td>
							<Td kind="mono">
								{row.completed}/{row.assigned}
								{row.abstained > 0 ? ` (${row.abstained} abstained)` : ""}
							</Td>
							{row.perRound.map((r) => (
								<Td kind="mono" key={r.roundId}>
									{formatScore(r.score)}
								</Td>
							))}
							<Td kind="mono">{formatScore(row.aggregate)}</Td>
							<Td>
								{row.ai == null ? (
									<StatusBadge tone="faint">—</StatusBadge>
								) : (
									<div className="flex flex-wrap items-center gap-2">
										<StatusBadge tone="info">
											AI {formatScore(row.ai.effective)}
										</StatusBadge>
										{row.ai.overridden && (
											<StatusBadge tone="caution">overridden</StatusBadge>
										)}
									</div>
								)}
							</Td>
							<Td>
								<TextLink to={link({ sub: row.id })}>Detail</TextLink>
							</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={7 + rounds.length}>
							No results yet — scores appear here as reviewers complete their
							assigned evaluations.
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<Pager page={page} total={total} link={(p) => link({ page: p })} />
		</>
	);
}

function SettingsTab({
	plan,
}: {
	plan: { id: string; name: string; instructions: string; status: string };
}) {
	const busy = useBusy();
	const [confirming, setConfirming] = useState(false);
	return (
		<>
			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Input type="hidden" name="intent" value="update-plan" />
					<Field label="Plan name">
						<Input name="name" defaultValue={plan.name} />
					</Field>
					<Field label="Reviewer instructions">
						<Input
							name="instructions"
							defaultValue={plan.instructions}
							size={60}
						/>
					</Field>
					<Button type="submit" disabled={busy}>
						Save
					</Button>
				</Form>
			</Panel>
			<Panel>
				<div className="flex flex-wrap items-center gap-3">
					<Form method="post">
						<Input type="hidden" name="intent" value="toggle-plan" />
						<Button type="submit" variant="ghost" disabled={busy}>
							{plan.status === "open"
								? "Close plan (locks all reviews)"
								: "Reopen plan"}
						</Button>
					</Form>
					{!confirming ? (
						<Button
							type="button"
							variant="ghost"
							onClick={() => setConfirming(true)}
						>
							Delete plan…
						</Button>
					) : (
						<Form method="post" className="flex items-center gap-3">
							<Input type="hidden" name="intent" value="delete-plan" />
							<ErrorText>
								Delete this plan with every round, scorecard, and recorded
								evaluation? This cannot be undone.
							</ErrorText>
							<Button type="submit" disabled={busy}>
								Delete plan
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setConfirming(false)}
							>
								Cancel
							</Button>
						</Form>
					)}
				</div>
			</Panel>
		</>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load this evaluation plan"
				tone="danger"
				subtitle="The plan may not exist on this event. Go back to Evaluation and pick a plan."
			/>
		</div>
	);
}
