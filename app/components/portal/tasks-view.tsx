import { EmptyState, StatusBadge, TextLink } from "~/ui";
import { Card, Muted, Row, RowList } from "./bits";
import type { TaskRowView } from "./types";

export type TasksViewData = {
	base: string;
	tasks: TaskRowView[];
};

export function TaskRows({
	base,
	tasks,
}: {
	base: string;
	tasks: TaskRowView[];
}) {
	return (
		<RowList>
			{tasks.map((t) => (
				<Row
					key={t.id}
					right={
						<StatusBadge tone={t.status.tone}>{t.status.label}</StatusBadge>
					}
				>
					<TextLink to={`${base}/tasks/${t.id}`}>{t.name}</TextLink>
					<div>
						{t.required && <Muted>Required</Muted>}
						{t.required && (t.due || t.submissionTitle) && <Muted> · </Muted>}
						{t.due && (
							<Muted tone={t.overdue ? "danger" : "muted"}>
								{t.overdue ? "Overdue — was due " : "Due "}
								{t.due}
							</Muted>
						)}
						{t.due && t.submissionTitle && <Muted> · </Muted>}
						{t.submissionTitle && <Muted>{t.submissionTitle}</Muted>}
					</div>
				</Row>
			))}
		</RowList>
	);
}

export function TasksView({ data }: { data: TasksViewData }) {
	const myTasks = data.tasks.filter((t) => t.type !== "submission");
	const submissionTasks = data.tasks.filter((t) => t.type === "submission");
	const outstanding = data.tasks.filter((t) => t.open).length;

	if (data.tasks.length === 0) {
		return (
			<Card title="Tasks">
				<EmptyState
					icon="calendar"
					title="No tasks yet"
					body="Tasks from the event team appear here — most arrive once a session is accepted. You'll see due dates and what's required at a glance."
				/>
			</Card>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<Card
				title="My Tasks"
				count={`${myTasks.filter((t) => t.open).length} of ${myTasks.length} open`}
			>
				{myTasks.length === 0 ? (
					<EmptyState
						icon="calendar"
						title="No personal tasks"
						body="Tasks assigned to you directly (hotel, travel, profile checks) appear here."
					/>
				) : (
					<TaskRows base={data.base} tasks={myTasks} />
				)}
			</Card>
			<Card
				title="Submission Tasks"
				count={`${submissionTasks.filter((t) => t.open).length} of ${submissionTasks.length} open`}
			>
				{submissionTasks.length === 0 ? (
					<EmptyState
						icon="mic"
						title="No submission tasks"
						body="Tasks tied to one of your sessions (slides upload, session details) appear here."
					/>
				) : (
					<TaskRows base={data.base} tasks={submissionTasks} />
				)}
			</Card>
			{outstanding === 0 && (
				<Muted>All caught up — every task is complete. 🎉</Muted>
			)}
		</div>
	);
}
