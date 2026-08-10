import type { BadgeTone } from "~/ui";

/** One home for task-assignment status presentation — both task routes render it. */
export const TASK_STATUS_TONE: Record<string, BadgeTone> = {
	incomplete: "warning",
	pending_feedback: "info",
	complete: "success",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
	incomplete: "Incomplete",
	pending_feedback: "Pending feedback",
	complete: "Complete",
};

/** THE overdue definition: past due and not done. */
export function isOverdue(
	dueAt: Date | null,
	status: string,
	now: Date,
): boolean {
	return (
		dueAt != null && dueAt.getTime() < now.getTime() && status !== "complete"
	);
}
