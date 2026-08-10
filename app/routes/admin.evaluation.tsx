import { useState } from "react";
import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	inArray,
	like,
} from "drizzle-orm";
import { Form, Outlet, data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	evaluationPlans,
	evaluationRounds,
	evaluations,
	reviews,
	roundEvaluators,
	submissions,
	users,
} from "~/db/schema";
import { deletePlanDeep } from "~/lib/assign";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
	fetchChunked,
	formatDay,
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
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const tab =
		url.searchParams.get("tab") === "decisions" ? "decisions" : "plans";

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
				const reviewRows = await db
					.select({
						reviewer: users.name,
						reviewerEmail: users.email,
						decision: reviews.decision,
						comment: reviews.comment,
						updatedAt: reviews.updatedAt,
					})
					.from(reviews)
					.innerJoin(users, eq(users.id, reviews.reviewerId))
					.where(eq(reviews.submissionId, sub.id))
					.orderBy(desc(reviews.updatedAt));
				detail = {
					id: sub.id,
					title: sub.title,
					reviews: reviewRows.map((r) => ({
						reviewer: r.reviewer ?? r.reviewerEmail,
						decision: r.decision,
						comment: r.comment,
						updatedAt: formatDay(r.updatedAt),
					})),
				};
			}
		}
		decisions = { rows: pageRows, total, page, q, detail };
	}

	return data(
		{
			child: false as const,
			eventName: event.name,
			tab,
			plans,
			decisions,
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
	const { tab, plans, decisions } = loaderData;
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
			</Tabs>
			{actionData?.ok && (
				<StatusBadge tone="success">{actionData.ok}</StatusBadge>
			)}
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}
			{tab === "plans" ? (
				<PlansTab plans={plans} actionData={actionData} />
			) : (
				<DecisionsTab decisions={decisions} />
			)}
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
