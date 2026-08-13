import { and, count, countDistinct, eq, isNotNull, ne, sql } from "drizzle-orm";
import { data, redirect } from "react-router";
import { AlertLink } from "~/components/alert-link";
import { GettingStartedCard } from "~/components/getting-started";
import { SectionHeading } from "~/components/section-heading";
import { StatCard, StatCell } from "~/components/stat-card";
import { getDb } from "~/db";
import { SUBMISSION_STATUS } from "~/db/constants";
import {
	formats,
	forms,
	participants,
	submissions,
	taskAssignments,
	tasks,
	tracks,
} from "~/db/schema";
import { cfpPath, formIsOpen } from "~/domain/forms";
import { deriveGettingStarted } from "~/domain/getting-started";
import { getActiveEvent, isSecureRequest, requireAdmin } from "~/lib/auth";
import {
	dismissGettingStartedCookie,
	isGettingStartedDismissed,
} from "~/lib/getting-started-dismissal";
import { countEventReviewers } from "~/lib/reviewers";
import {
	calendarDaysUntil,
	eventCountdown,
	greetingForHour,
	resolveTimezone,
	zonedHour,
} from "~/lib/event-time";
import { formatInTimeZone } from "~/lib/dates";
import { formatDateLine } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import {
	ButtonLink,
	EmptyRow,
	EmptyState,
	PageHeader,
	Panel,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Table,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin._index";

const RECENT_LIMIT = 8;

/** Pipeline order first, then the two non-decision states. The Record forces
 * a compile error when SUBMISSION_STATUS grows, so a new status can't
 * silently vanish from the breakdown row. */
const STATUS_ROW_POSITION: Record<(typeof SUBMISSION_STATUS)[number], number> =
	{
		pending: 0,
		accept_queue: 1,
		accepted: 2,
		decline_queue: 3,
		declined: 4,
		withdrawn: 5,
		draft: 6,
	};
const STATUS_ROW_ORDER = [...SUBMISSION_STATUS].sort(
	(a, b) => STATUS_ROW_POSITION[a] - STATUS_ROW_POSITION[b],
);

// Without this export RR7 drops loader headers from DOCUMENT responses —
// Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader (single-fetch
	// can run this loader alone via `?_routes=`).
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const firstName = user.name?.trim().split(/\s+/)[0] || null;
	const now = new Date();

	if (!event) {
		return {
			event: null,
			greeting: greet(now, "UTC", firstName),
			dateLine: formatDateLine(now, "UTC"),
		};
	}

	const tz = resolveTimezone(event.timezone);
	const db = getDb(env);
	const timings = createTimings();

	// One round trip: a single pass over submissions covers the status row, the
	// headline count, and two alerts (GROUP BY status with conditional sums).
	const [
		statusAgg,
		speakerAgg,
		outstandingAgg,
		formRows,
		formCounts,
		recentRows,
		trackAgg,
		formatAgg,
		reviewerAgg,
	] = await timings.time("db", () =>
		db.batch([
			db
				.select({
					status: submissions.status,
					n: count(),
					unscheduled: sql<number>`sum(case when ${submissions.startsAt} is null then 1 else 0 end)`,
					notPublic: sql<number>`sum(case when ${submissions.contentStatus} <> 'approved' then 1 else 0 end)`,
				})
				.from(submissions)
				.where(eq(submissions.eventId, event.id))
				.groupBy(submissions.status),
			db
				.select({ n: countDistinct(participants.contactId) })
				.from(participants)
				.innerJoin(submissions, eq(submissions.id, participants.submissionId))
				.where(
					and(
						eq(submissions.eventId, event.id),
						eq(submissions.status, "accepted"),
						eq(participants.role, "speaker"),
					),
				),
			db
				.select({ n: countDistinct(taskAssignments.contactId) })
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.where(
					and(
						eq(tasks.eventId, event.id),
						ne(taskAssignments.status, "complete"),
					),
				),
			db
				.select({
					id: forms.id,
					publicId: forms.publicId,
					internalName: forms.internalName,
					status: forms.status,
					closeAt: forms.closeAt,
					submissionLimit: forms.submissionLimit,
				})
				.from(forms)
				.where(eq(forms.eventId, event.id)),
			db
				.select({
					formId: submissions.formId,
					submitted: sql<number>`sum(case when ${submissions.status} <> 'draft' then 1 else 0 end)`,
					drafts: sql<number>`sum(case when ${submissions.status} = 'draft' then 1 else 0 end)`,
				})
				.from(submissions)
				.where(
					and(eq(submissions.eventId, event.id), isNotNull(submissions.formId)),
				)
				.groupBy(submissions.formId),
			db.query.submissions.findMany({
				where: (s, { and, eq, ne }) =>
					and(eq(s.eventId, event.id), ne(s.status, "draft")),
				columns: { id: true, title: true, status: true, createdAt: true },
				with: {
					form: { columns: { internalName: true } },
					participants: {
						columns: { role: true, isPrimary: true, position: true },
						with: {
							contact: { columns: { firstName: true, lastName: true } },
						},
					},
				},
				orderBy: (s, { desc }) => [desc(s.createdAt), desc(s.id)],
				limit: RECENT_LIMIT,
			}),
			db
				.select({ n: count() })
				.from(tracks)
				.where(eq(tracks.eventId, event.id)),
			db
				.select({ n: count() })
				.from(formats)
				.where(eq(formats.eventId, event.id)),
			countEventReviewers(db, event.id),
		]),
	);

	const statusCounts: Record<(typeof SUBMISSION_STATUS)[number], number> = {
		draft: 0,
		pending: 0,
		accept_queue: 0,
		accepted: 0,
		decline_queue: 0,
		declined: 0,
		withdrawn: 0,
	};
	let unscheduled = 0;
	let notPublic = 0;
	for (const row of statusAgg) {
		statusCounts[row.status] = row.n;
		if (row.status === "accepted") {
			unscheduled = row.unscheduled ?? 0;
			notPublic = row.notPublic ?? 0;
		}
	}
	const submissionsTotal = SUBMISSION_STATUS.reduce(
		(total, s) => (s === "draft" ? total : total + statusCounts[s]),
		0,
	);

	const formCards = formRows
		.map((f) => {
			const counts = formCounts.find((c) => c.formId === f.id);
			const isOpen = formIsOpen(f, now);
			return {
				id: f.id,
				name: f.internalName,
				state: isOpen
					? ("open" as const)
					: f.status === "draft"
						? ("draft" as const)
						: ("closed" as const),
				// closeAt is a real instant: the day a form stops accepting is its
				// EVENT-local date (formIsOpen flips at that wall clock), not UTC's.
				closeDate: f.closeAt ? formatInTimeZone(f.closeAt, tz, "date") : null,
				closesInDays:
					isOpen && f.closeAt ? calendarDaysUntil(now, f.closeAt, tz) : null,
				submitted: counts?.submitted ?? 0,
				drafts: counts?.drafts ?? 0,
				limit: f.submissionLimit ?? event.submissionLimit ?? null,
			};
		})
		.sort(
			(a, b) =>
				Number(b.state === "open") - Number(a.state === "open") ||
				(a.closesInDays ?? Number.MAX_SAFE_INTEGER) -
					(b.closesInDays ?? Number.MAX_SAFE_INTEGER) ||
				a.name.localeCompare(b.name),
		);

	const closingSoon = formCards.filter(
		(f) => f.state === "open" && f.closesInDays !== null && f.closesInDays <= 7,
	);

	// Shareable CFP link is the event's short alias once any form is open.
	// Oldest-open resolution lives on /cfp/:slug; this surface only advertises
	// that there is something to share.
	const firstOpenCard = formCards.find((f) => f.state === "open");
	const gettingStarted = {
		...deriveGettingStarted({
			hasDates: event.startsAt !== null && event.endsAt !== null,
			hasLocation: (event.location ?? "").trim().length > 0,
			trackCount: trackAgg[0]?.n ?? 0,
			formatCount: formatAgg[0]?.n ?? 0,
			publishedFormCount: formRows.filter((f) => f.status !== "draft").length,
			reviewerCount: reviewerAgg[0]?.n ?? 0,
			submissionCount: submissionsTotal,
		}),
		dismissed: await isGettingStartedDismissed(request, user.id, event.id),
		cfpUrl: firstOpenCard
			? new URL(request.url).origin + cfpPath(event.slug)
			: null,
	};

	const recent = recentRows.map((r) => ({
		id: r.id,
		title: r.title,
		status: r.status,
		formName: r.form?.internalName ?? "Manual",
		submitted: formatInTimeZone(r.createdAt, tz, "date"),
		speakers: r.participants
			.filter((p) => p.role === "speaker")
			.sort(
				(a, b) =>
					Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position,
			)
			.map((p) => `${p.contact.firstName} ${p.contact.lastName}`.trim()),
	}));

	return data(
		{
			event: {
				name: event.name,
				startDate: event.startsAt
					? formatInTimeZone(event.startsAt, tz, "date")
					: null,
				endDate: event.endsAt
					? formatInTimeZone(event.endsAt, tz, "date")
					: null,
			},
			greeting: greet(now, tz, firstName),
			dateLine: formatDateLine(now, tz),
			countdown: eventCountdown(now, tz, event.startsAt, event.endsAt),
			stats: {
				submissions: submissionsTotal,
				drafts: statusCounts.draft,
				acceptedSpeakers: speakerAgg[0]?.n ?? 0,
				acceptedSessions: statusCounts.accepted,
			},
			statusCounts,
			alerts: {
				notPublic,
				unscheduled,
				outstandingSpeakers: outstandingAgg[0]?.n ?? 0,
				closingSoon: {
					count: closingSoon.length,
					firstName: closingSoon[0]?.name ?? null,
					firstDays: closingSoon[0]?.closesInDays ?? null,
				},
			},
			recent,
			forms: formCards,
			gettingStarted,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — actions never inherit the layout loader's auth.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const form = await request.formData();
	if (form.get("intent") !== "dismiss-getting-started" || !event) {
		return redirect("/admin");
	}
	track("getting_started.dismissed", { userId: user.id, eventId: event.id });
	// The dismissal is server-derived (session user + active event) — a client
	// can't hide the checklist for someone else's event.
	return redirect("/admin", {
		headers: {
			"Set-Cookie": await dismissGettingStartedCookie(
				request,
				user.id,
				event.id,
				isSecureRequest(request),
			),
		},
	});
}

function greet(now: Date, tz: string, firstName: string | null): string {
	const salutation = greetingForHour(zonedHour(now, tz));
	return firstName ? `${salutation}, ${firstName}` : salutation;
}

function plural(n: number, singular: string, pluralForm?: string): string {
	return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
	if (loaderData.event === null) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
				<PageHeader
					title={loaderData.greeting}
					subtitle={loaderData.dateLine}
				/>
				<Panel>
					<EmptyState
						icon="calendar"
						title="No event yet"
						body="Your organization has no events. Create one and the dashboard will track its submissions, speakers, and tasks."
						action={
							<ButtonLink to="/admin/events/new">Create an event</ButtonLink>
						}
					/>
				</Panel>
			</div>
		);
	}

	const {
		event,
		greeting,
		dateLine,
		countdown,
		stats,
		statusCounts,
		alerts,
		recent,
		forms: formCards,
		gettingStarted,
	} = loaderData;
	const showChecklist = !gettingStarted.complete && !gettingStarted.dismissed;

	const daysChip =
		countdown.phase === "upcoming"
			? `${countdown.days} ${plural(countdown.days, "day")} to event`
			: countdown.phase === "running"
				? `Day ${countdown.day} of ${countdown.ofDays}`
				: countdown.phase === "ended"
					? "Event ended"
					: undefined;

	const subtitle = [
		dateLine,
		event.name,
		event.startDate
			? `${event.startDate} – ${event.endDate ?? event.startDate}`
			: "Add event dates in Settings to see the countdown",
	].join(" · ");

	const alertRows: Array<{
		key: string;
		to: string;
		action: string;
		text: string;
	}> = [];
	if (alerts.notPublic > 0) {
		alertRows.push({
			key: "not-public",
			to: "/admin/submissions",
			action: "Review submissions",
			text: `${alerts.notPublic} accepted ${plural(alerts.notPublic, "session isn't", "sessions aren't")} public yet`,
		});
	}
	if (alerts.outstandingSpeakers > 0) {
		alertRows.push({
			key: "tasks",
			to: "/admin/tasks",
			action: "Open tasks",
			text: `${alerts.outstandingSpeakers} ${plural(alerts.outstandingSpeakers, "speaker still has", "speakers still have")} outstanding onboarding tasks`,
		});
	}
	if (alerts.unscheduled > 0) {
		alertRows.push({
			key: "unscheduled",
			to: "/admin/agenda",
			action: "Open agenda",
			text: `${alerts.unscheduled} accepted ${plural(alerts.unscheduled, "session still needs", "sessions still need")} a time slot`,
		});
	}
	if (alerts.closingSoon.count === 1 && alerts.closingSoon.firstName) {
		alertRows.push({
			key: "closing",
			to: "/admin/forms",
			action: "Review forms",
			text: `"${alerts.closingSoon.firstName}" closes ${
				alerts.closingSoon.firstDays === 0
					? "today"
					: `in ${alerts.closingSoon.firstDays} ${plural(alerts.closingSoon.firstDays ?? 0, "day")}`
			}`,
		});
	} else if (alerts.closingSoon.count > 1) {
		alertRows.push({
			key: "closing",
			to: "/admin/forms",
			action: "Review forms",
			text: `${alerts.closingSoon.count} CFP forms close within 7 days`,
		});
	}

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader title={greeting} count={daysChip} subtitle={subtitle} />

			{showChecklist && (
				<GettingStartedCard
					state={gettingStarted}
					cfpUrl={gettingStarted.cfpUrl}
				/>
			)}

			<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Submissions"
					value={stats.submissions}
					hint={
						stats.drafts > 0
							? `+ ${stats.drafts} ${plural(stats.drafts, "draft")} in progress`
							: stats.submissions === 0
								? "None yet — publish your form and share its public link"
								: undefined
					}
				/>
				<StatCard
					label="Accepted speakers"
					value={stats.acceptedSpeakers}
					hint={
						stats.acceptedSpeakers === 0
							? "Speakers appear here when you accept submissions"
							: `on ${stats.acceptedSessions} accepted ${plural(stats.acceptedSessions, "session")}`
					}
				/>
				<div className="lg:col-span-2">
					<Panel>
						<div className="flex flex-col gap-3">
							<SectionHeading
								aside={<TextLink to="/admin/submissions">View all →</TextLink>}
							>
								Submission status
							</SectionHeading>
							<div className="flex flex-wrap gap-x-6 gap-y-3">
								{STATUS_ROW_ORDER.map((status) => (
									<StatCell
										key={status}
										label={
											<StatusBadge tone={SUBMISSION_STATUS_TONE[status]}>
												{status.replace("_", " ")}
											</StatusBadge>
										}
										count={statusCounts[status]}
									/>
								))}
							</div>
						</div>
					</Panel>
				</div>
			</div>

			<Panel>
				<div className="flex flex-col gap-3">
					<SectionHeading>Also check</SectionHeading>
					{alertRows.length > 0 ? (
						<ul className="flex flex-col gap-2">
							{alertRows.map((a) => (
								<AlertLink key={a.key} to={a.to} action={a.action}>
									{a.text}
								</AlertLink>
							))}
						</ul>
					) : (
						<div className="flex">
							<StatusBadge tone="success">
								All clear — nothing needs attention right now
							</StatusBadge>
						</div>
					)}
				</div>
			</Panel>

			<div className="flex flex-col gap-2">
				<SectionHeading>Your forms</SectionHeading>
				<Table>
					<THead>
						<Th>Form</Th>
						<Th>Status</Th>
						<Th>Closes</Th>
						<Th>Submitted</Th>
						<Th>Drafts</Th>
						<Th>Limit</Th>
					</THead>
					<TBody>
						{formCards.map((f) => (
							<Tr key={f.id}>
								<Td kind="strong">{f.name}</Td>
								<Td>
									<StatusBadge
										tone={
											f.state === "open"
												? "success"
												: f.state === "draft"
													? "faint"
													: "neutral"
										}
									>
										{f.state}
									</StatusBadge>
								</Td>
								<Td kind="mono">
									{f.closeDate
										? f.closesInDays !== null
											? `${f.closeDate} (${
													f.closesInDays === 0
														? "today"
														: `in ${f.closesInDays} ${plural(f.closesInDays, "day")}`
												})`
											: f.closeDate
										: "—"}
								</Td>
								<Td kind="mono">{f.submitted}</Td>
								<Td kind="mono">{f.drafts}</Td>
								<Td kind="mono">
									{f.limit !== null ? `${f.limit} per submitter` : "—"}
								</Td>
							</Tr>
						))}
						{formCards.length === 0 && (
							<EmptyRow colSpan={6}>
								<EmptyState
									icon="inbox"
									title="No forms yet"
									body="Build and publish your submission form — speakers send proposals through its public link."
									action={
										<ButtonLink to="/admin/forms" variant="ghost">
											Open forms
										</ButtonLink>
									}
								/>
							</EmptyRow>
						)}
					</TBody>
				</Table>
			</div>

			<div className="flex flex-col gap-2">
				<SectionHeading
					aside={<TextLink to="/admin/submissions">View all →</TextLink>}
				>
					Recent submissions
				</SectionHeading>
				<Table>
					<THead>
						<Th>Title</Th>
						<Th>Status</Th>
						<Th>Speakers</Th>
						<Th>Form</Th>
						<Th>Submitted</Th>
					</THead>
					<TBody>
						{recent.map((r) => (
							<Tr key={r.id}>
								<Td kind="strong">{r.title}</Td>
								<Td>
									<StatusBadge tone={SUBMISSION_STATUS_TONE[r.status]}>
										{r.status.replace("_", " ")}
									</StatusBadge>
								</Td>
								<Td>
									{r.speakers.length === 0
										? "—"
										: r.speakers.length <= 2
											? r.speakers.join(", ")
											: `${r.speakers.slice(0, 2).join(", ")} +${r.speakers.length - 2}`}
								</Td>
								<Td>{r.formName}</Td>
								<Td kind="mono">{r.submitted}</Td>
							</Tr>
						))}
						{recent.length === 0 && (
							<EmptyRow colSpan={5}>
								No submissions yet — publish your form, share its public link,
								and the first proposals land here.{" "}
								<TextLink to="/admin/forms">Open forms →</TextLink>
							</EmptyRow>
						)}
					</TBody>
				</Table>
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — the raw error can carry SQL/row values; the detail
	// is in the server logs.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load the dashboard"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
