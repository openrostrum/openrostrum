import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	inArray,
	like,
	notInArray,
} from "drizzle-orm";
import { Form, Outlet, data } from "react-router";
import { getDb } from "~/db";
import {
	evaluationPlans,
	evaluationRounds,
	evaluations,
	events,
	reviewerTracks,
	reviews,
	submissions,
	submissionTracks,
	tracks,
} from "~/db/schema";
import { requireRole } from "~/lib/auth";
import {
	EVAL_STATUS_TONE,
	formatDay,
	REVIEW_DECISION_TONE,
	REVIEW_PAGE_SIZE as PAGE_SIZE,
	REVIEWABLE_EXCLUDED,
	roundWritable,
} from "~/lib/evaluation";
import { Pager } from "~/lib/pager";
import { createTimings } from "~/lib/track";
import {
	Button,
	ButtonLink,
	Chip,
	EmptyRow,
	Input,
	PageHeader,
	SearchInput,
	Sidebar,
	SidebarSection,
	SideNavLink,
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
import type { Route } from "./+types/reviews";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Admins may review too (an organizer pooled as an evaluator); speakers and
	// anonymous visitors are bounced. Reviewers never enter admin.* — this is
	// their entire surface.
	const user = await requireRole(env, request, "reviewer", "admin");
	const shellUser = { name: user.name, email: user.email };
	const url = new URL(request.url);
	if (url.pathname !== "/reviews") {
		return data({ child: true as const, user: shellUser });
	}
	const db = getDb(env);
	const timings = createTimings();
	const tab = url.searchParams.get("tab") === "tracks" ? "tracks" : "assigned";
	const q = url.searchParams.get("q")?.trim() ?? "";
	const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
	const roundFilter = url.searchParams.get("round");

	// Event scope on this surface derives from the reviewer's OWN assignments
	// (their tracks' events + their pooled rounds' events) — reviewers hold no
	// org membership, so the admin-side getActiveEvent must never be used here.
	const [summaryRows, trackCountRows] = await timings.time("db-counts", () =>
		Promise.all([
			db
				.select({
					roundId: evaluationRounds.id,
					roundName: evaluationRounds.name,
					planName: evaluationPlans.name,
					planStatus: evaluationPlans.status,
					opensAt: evaluationRounds.opensAt,
					closesAt: evaluationRounds.closesAt,
					eventName: events.name,
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
				.innerJoin(events, eq(events.id, evaluationPlans.eventId))
				.where(eq(evaluations.evaluatorId, user.id))
				.groupBy(
					evaluationRounds.id,
					evaluationRounds.name,
					evaluationPlans.name,
					evaluationPlans.status,
					evaluationRounds.opensAt,
					evaluationRounds.closesAt,
					events.name,
					evaluations.status,
				),
			db
				.select({ n: countDistinct(submissions.id) })
				.from(submissions)
				.innerJoin(
					submissionTracks,
					eq(submissionTracks.submissionId, submissions.id),
				)
				.innerJoin(
					reviewerTracks,
					eq(reviewerTracks.trackId, submissionTracks.trackId),
				)
				.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
				.where(
					and(
						eq(reviewerTracks.userId, user.id),
						eq(tracks.eventId, submissions.eventId),
						notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
					),
				),
		]),
	);

	const roundsMap = new Map<
		string,
		{
			roundId: string;
			roundName: string;
			planName: string;
			eventName: string;
			window: string;
			locked: boolean;
			lockedReason: string;
			assigned: number;
			completed: number;
			abstained: number;
		}
	>();
	for (const row of summaryRows) {
		const entry = roundsMap.get(row.roundId) ?? {
			roundId: row.roundId,
			roundName: row.roundName,
			planName: row.planName,
			eventName: row.eventName,
			window: `${formatDay(row.opensAt)} – ${formatDay(row.closesAt)}`,
			...lockInfo(row),
			assigned: 0,
			completed: 0,
			abstained: 0,
		};
		entry.assigned += row.n;
		if (row.status === "completed") entry.completed += row.n;
		if (row.status === "abstained") entry.abstained += row.n;
		roundsMap.set(row.roundId, entry);
	}
	const roundSummaries = [...roundsMap.values()];
	const assignedTotal = roundSummaries.reduce((s, r) => s + r.assigned, 0);
	const assignedPending = roundSummaries.reduce(
		(s, r) => s + r.assigned - r.completed - r.abstained,
		0,
	);
	const tracksTotal = trackCountRows[0]?.n ?? 0;

	let assignedItems = null;
	if (tab === "assigned") {
		const where = and(
			eq(evaluations.evaluatorId, user.id),
			roundFilter ? eq(evaluations.roundId, roundFilter) : undefined,
			q ? like(submissions.title, `%${q}%`) : undefined,
		);
		const [totalRows, rows] = await timings.time("db-assigned", () =>
			Promise.all([
				db
					.select({ n: count() })
					.from(evaluations)
					.innerJoin(submissions, eq(submissions.id, evaluations.submissionId))
					.where(where),
				db
					.select({
						id: evaluations.id,
						status: evaluations.status,
						submissionId: submissions.id,
						title: submissions.title,
						roundId: evaluationRounds.id,
						roundName: evaluationRounds.name,
						planName: evaluationPlans.name,
						closesAt: evaluationRounds.closesAt,
					})
					.from(evaluations)
					.innerJoin(submissions, eq(submissions.id, evaluations.submissionId))
					.innerJoin(
						evaluationRounds,
						eq(evaluationRounds.id, evaluations.roundId),
					)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(where)
					.orderBy(desc(evaluations.createdAt))
					.limit(PAGE_SIZE)
					.offset((page - 1) * PAGE_SIZE),
			]),
		);
		assignedItems = {
			total: totalRows[0]?.n ?? 0,
			rows: rows.map((r) => ({
				id: r.id,
				status: r.status,
				submissionId: r.submissionId,
				title: r.title,
				round: r.roundName,
				plan: r.planName,
				due: formatDay(r.closesAt),
			})),
		};
	}

	let trackItems = null;
	if (tab === "tracks") {
		const where = and(
			eq(reviewerTracks.userId, user.id),
			eq(tracks.eventId, submissions.eventId),
			notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
			q ? like(submissions.title, `%${q}%`) : undefined,
		);
		const [totalRows, rows] = await timings.time("db-tracks", () =>
			Promise.all([
				db
					.select({ n: countDistinct(submissions.id) })
					.from(submissions)
					.innerJoin(
						submissionTracks,
						eq(submissionTracks.submissionId, submissions.id),
					)
					.innerJoin(
						reviewerTracks,
						eq(reviewerTracks.trackId, submissionTracks.trackId),
					)
					.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
					.where(where),
				db
					.selectDistinct({
						id: submissions.id,
						title: submissions.title,
						createdAt: submissions.createdAt,
					})
					.from(submissions)
					.innerJoin(
						submissionTracks,
						eq(submissionTracks.submissionId, submissions.id),
					)
					.innerJoin(
						reviewerTracks,
						eq(reviewerTracks.trackId, submissionTracks.trackId),
					)
					.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
					.where(where)
					.orderBy(desc(submissions.createdAt))
					.limit(PAGE_SIZE)
					.offset((page - 1) * PAGE_SIZE),
			]),
		);
		const ids = rows.map((r) => r.id);
		const [rowTracks, myReviews] =
			ids.length === 0
				? [[], []]
				: await Promise.all([
						db
							.select({
								submissionId: submissionTracks.submissionId,
								name: tracks.name,
								color: tracks.color,
							})
							.from(submissionTracks)
							.innerJoin(tracks, eq(tracks.id, submissionTracks.trackId))
							.where(inArray(submissionTracks.submissionId, ids)),
						db
							.select({
								submissionId: reviews.submissionId,
								decision: reviews.decision,
							})
							.from(reviews)
							.where(
								and(
									eq(reviews.reviewerId, user.id),
									inArray(reviews.submissionId, ids),
								),
							),
					]);
		trackItems = {
			total: totalRows[0]?.n ?? 0,
			rows: rows.map((r) => ({
				id: r.id,
				title: r.title,
				tracks: rowTracks.filter((t) => t.submissionId === r.id),
				decision:
					myReviews.find((m) => m.submissionId === r.id)?.decision ?? null,
			})),
		};
	}

	return data(
		{
			child: false as const,
			user: shellUser,
			tab,
			q,
			page,
			roundFilter,
			roundSummaries,
			assignedTotal,
			assignedPending,
			tracksTotal,
			assignedItems,
			trackItems,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

function lockInfo(row: {
	opensAt: Date | null;
	closesAt: Date | null;
	planStatus: "open" | "closed";
}): { locked: boolean; lockedReason: string } {
	const state = roundWritable(row, row.planStatus);
	if (state.writable) return { locked: false, lockedReason: "" };
	const reasons = {
		"plan-closed": "Plan closed",
		"not-open": "Not open yet",
		closed: "Round closed",
		open: "",
	} as const;
	return { locked: true, lockedReason: reasons[state.reason] };
}

export default function Reviews({ loaderData }: Route.ComponentProps) {
	return (
		<div className="flex min-h-screen">
			<Sidebar user={loaderData.user}>
				<SidebarSection label="Review">
					<SideNavLink to="/reviews" icon="star">
						My Reviews
					</SideNavLink>
				</SidebarSection>
			</Sidebar>
			<main className="min-w-0 flex-1">
				{loaderData.child ? <Outlet /> : <Queue data={loaderData} />}
			</main>
		</div>
	);
}

type QueueData = Extract<
	Awaited<ReturnType<typeof loader>>["data"],
	{ child: false }
>;

function Queue({ data: d }: { data: QueueData }) {
	const {
		tab,
		q,
		page,
		roundFilter,
		roundSummaries,
		assignedTotal,
		assignedPending,
		tracksTotal,
		assignedItems,
		trackItems,
	} = d;
	const link = (over: Record<string, string | number>) => {
		const sp = new URLSearchParams({ tab });
		if (q) sp.set("q", q);
		if (roundFilter) sp.set("round", roundFilter);
		sp.set("page", String(page));
		for (const [k, v] of Object.entries(over)) {
			if (v === "") sp.delete(k);
			else sp.set(k, String(v));
		}
		return `?${sp.toString()}`;
	};
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="My Reviews"
				count={`${assignedPending} pending`}
				subtitle="Your assigned evaluations, plus every submission routed to you by track. Reviews stay editable until their round closes."
			/>
			<Tabs>
				<Tab
					to="?tab=assigned"
					count={assignedTotal}
					active={tab === "assigned"}
				>
					Assigned
				</Tab>
				<Tab to="?tab=tracks" count={tracksTotal} active={tab === "tracks"}>
					My tracks
				</Tab>
			</Tabs>

			{tab === "assigned" && (
				<>
					{roundSummaries.length > 0 && (
						<Table>
							<THead>
								<Th>Round</Th>
								<Th>Plan</Th>
								<Th>Event</Th>
								<Th>Window</Th>
								<Th>Progress</Th>
								<Th>State</Th>
								<Th></Th>
							</THead>
							<TBody>
								{roundSummaries.map((r) => (
									<Tr key={r.roundId} selected={roundFilter === r.roundId}>
										<Td kind="strong">{r.roundName}</Td>
										<Td>{r.planName}</Td>
										<Td>{r.eventName}</Td>
										<Td kind="mono">{r.window}</Td>
										<Td kind="mono">
											{r.completed + r.abstained}/{r.assigned}
										</Td>
										<Td>
											{r.locked ? (
												<StatusBadge tone="neutral">
													{r.lockedReason}
												</StatusBadge>
											) : (
												<StatusBadge tone="success">Open</StatusBadge>
											)}
										</Td>
										<Td>
											<TextLink to={link({ round: r.roundId, page: 1 })}>
												Filter
											</TextLink>
										</Td>
									</Tr>
								))}
							</TBody>
						</Table>
					)}
					<div className="flex items-center gap-3">
						<Form method="get" className="flex items-center gap-3">
							<Input type="hidden" name="tab" value="assigned" />
							{roundFilter && (
								<Input type="hidden" name="round" value={roundFilter} />
							)}
							<SearchInput
								name="q"
								defaultValue={q}
								placeholder="Search assigned submissions…"
							/>
							<Button type="submit" variant="ghost">
								Search
							</Button>
						</Form>
						{roundFilter && (
							<ButtonLink to={link({ round: "", page: 1 })} variant="ghost">
								Clear round filter
							</ButtonLink>
						)}
					</div>
					<Table>
						<THead>
							<Th>Submission</Th>
							<Th>Plan · Round</Th>
							<Th>Due</Th>
							<Th>Status</Th>
							<Th></Th>
						</THead>
						<TBody>
							{(assignedItems?.rows ?? []).map((item) => (
								<Tr key={item.id}>
									<Td kind="strong">{item.title}</Td>
									<Td>
										{item.plan} · {item.round}
									</Td>
									<Td kind="mono">{item.due}</Td>
									<Td>
										<StatusBadge
											tone={EVAL_STATUS_TONE[item.status] ?? "neutral"}
										>
											{item.status === "pending"
												? "Pending review"
												: item.status}
										</StatusBadge>
									</Td>
									<Td>
										<TextLink to={`/reviews/${item.submissionId}`}>
											{item.status === "pending" ? "Review" : "Open"}
										</TextLink>
									</Td>
								</Tr>
							))}
							{(assignedItems?.rows ?? []).length === 0 && (
								<EmptyRow colSpan={5}>
									{q
										? `Nothing assigned matches “${q}”.`
										: "Nothing is assigned to you yet — assignments appear here when an organizer adds you to an evaluation round."}
								</EmptyRow>
							)}
						</TBody>
					</Table>
					{assignedItems && (
						<Pager
							page={page}
							total={assignedItems.total}
							link={(p) => link({ page: p })}
						/>
					)}
				</>
			)}

			{tab === "tracks" && (
				<>
					<Form method="get" className="flex items-center gap-3">
						<Input type="hidden" name="tab" value="tracks" />
						<SearchInput
							name="q"
							defaultValue={q}
							placeholder="Search submissions in your tracks…"
						/>
						<Button type="submit" variant="ghost">
							Search
						</Button>
					</Form>
					<Table>
						<THead>
							<Th>Submission</Th>
							<Th>Tracks</Th>
							<Th>My decision</Th>
							<Th></Th>
						</THead>
						<TBody>
							{(trackItems?.rows ?? []).map((item) => (
								<Tr key={item.id}>
									<Td kind="strong">{item.title}</Td>
									<Td>
										<div className="flex flex-wrap gap-3">
											{item.tracks.map((t) => (
												<Chip key={`${item.id}-${t.name}`} color={t.color}>
													{t.name}
												</Chip>
											))}
										</div>
									</Td>
									<Td>
										{item.decision ? (
											<StatusBadge
												tone={REVIEW_DECISION_TONE[item.decision] ?? "neutral"}
											>
												{item.decision}
											</StatusBadge>
										) : (
											<StatusBadge tone="faint">Not reviewed</StatusBadge>
										)}
									</Td>
									<Td>
										<TextLink to={`/reviews/${item.id}`}>
											{item.decision ? "Open" : "Review"}
										</TextLink>
									</Td>
								</Tr>
							))}
							{(trackItems?.rows ?? []).length === 0 && (
								<EmptyRow colSpan={4}>
									{q
										? `Nothing in your tracks matches “${q}”.`
										: "No submissions in your tracks yet — when submissions carry a track you cover, they appear here for your approve/maybe/deny decision."}
								</EmptyRow>
							)}
						</TBody>
					</Table>
					{trackItems && (
						<Pager
							page={page}
							total={trackItems.total}
							link={(p) => link({ page: p })}
						/>
					)}
				</>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load your reviews"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
