import { useState } from "react";
import { formatRole } from "~/lib/format";
import type { loader } from "~/routes/portals.$eventSlug.$portalId.home";
import { Avatar, EmptyState, StatusBadge, TextLink } from "~/ui";
import { RichHtml } from "../rich-html";
import { Card, Muted, PillToggle, Row, RowList } from "./bits";
import { TaskRows } from "./tasks-view";
import { isSubmissionTask } from "./types";

/** The owning loader's payload — derived, never hand-mirrored (type-only
 * import; the route↔view cycle is erased at build). */
export type HomeViewData = Awaited<ReturnType<typeof loader>>["data"];

const TASK_TABS = ["All", "My Tasks", "Submission Tasks"] as const;

export function HomeView({ data }: { data: HomeViewData }) {
	const {
		base,
		welcomeHtml,
		firstName,
		profile,
		userEmail,
		submissions,
		submissionCount,
		tasks,
	} = data;
	const [taskTab, setTaskTab] = useState<(typeof TASK_TABS)[number]>("All");
	const visibleTasks = tasks.filter((t) =>
		taskTab === "All"
			? true
			: taskTab === "Submission Tasks"
				? isSubmissionTask(t)
				: !isSubmissionTask(t),
	);
	const outstanding = tasks.filter((t) => t.open).length;
	const profileRole = profile ? formatRole(profile) : "";

	return (
		<div className="flex flex-col gap-5">
			<section className="rounded-card bg-surface p-4 shadow-card">
				<h2 className="mb-1 font-display text-[17px] font-semibold text-fg">
					Welcome{firstName ? `, ${firstName}` : ""}
				</h2>
				{welcomeHtml ? (
					<RichHtml html={welcomeHtml} />
				) : (
					<p className="text-[13px] text-fg-muted">
						Track your submissions, keep your speaker profile current, and
						complete your tasks — all in one place.
					</p>
				)}
			</section>

			<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Card
					title="My Submissions"
					count={String(submissionCount)}
					action={<TextLink to={`${base}/submissions`}>View all</TextLink>}
				>
					{submissions.length === 0 ? (
						<EmptyState
							icon="mic"
							title="No submissions yet"
							body="When you submit to this event's call for papers, your sessions and their status appear here."
						/>
					) : (
						<RowList>
							{submissions.map((s) => (
								<Row
									key={s.id}
									right={
										<StatusBadge tone={s.status.tone}>
											{s.status.label}
										</StatusBadge>
									}
								>
									<TextLink to={`${base}/submissions/${s.id}`}>
										{s.title}
									</TextLink>
									{s.format && (
										<div>
											<Muted>{s.format}</Muted>
										</div>
									)}
								</Row>
							))}
						</RowList>
					)}
				</Card>

				<Card
					title="My Profile"
					action={<TextLink to={`${base}/profile`}>View more</TextLink>}
				>
					{profile ? (
						<div className="flex items-center gap-3">
							<Avatar name={profile.name} size={40} />
							<div className="min-w-0">
								<div className="text-[13px] font-medium text-fg">
									{profile.name}
								</div>
								<div className="truncate text-[12.5px] text-fg-muted">
									{profile.email}
								</div>
								{profileRole && (
									<div className="truncate text-[12px] text-fg-faint">
										{profileRole}
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="flex items-center gap-3">
							<Avatar name={userEmail} size={40} />
							<p className="text-[12.5px] text-fg-muted">
								Your speaker profile is created when you join a submission — it
								will appear here once you are on one.
							</p>
						</div>
					)}
				</Card>
			</div>

			<Card
				title="Tasks"
				count={outstanding > 0 ? `${outstanding} outstanding` : undefined}
				action={
					<div className="flex gap-1">
						{TASK_TABS.map((tab) => (
							<PillToggle
								key={tab}
								label={tab}
								active={taskTab === tab}
								onSelect={() => setTaskTab(tab)}
							/>
						))}
					</div>
				}
			>
				{visibleTasks.length === 0 ? (
					<EmptyState
						icon="calendar"
						title={
							taskTab === "All"
								? "No tasks yet"
								: `No ${taskTab.toLowerCase()} yet`
						}
						body="Tasks from the event team appear here — most arrive once a session is accepted."
					/>
				) : (
					<TaskRows base={base} tasks={visibleTasks} />
				)}
			</Card>
		</div>
	);
}
