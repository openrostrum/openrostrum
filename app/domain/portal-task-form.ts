import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "~/db";
import { taskAssignments } from "~/db/schema";

export async function persistInitialPortalFormResponse(
	db: Db,
	input: {
		assignmentId: string;
		contactId: string;
		answers: Record<string, unknown>;
		completedAt: Date;
	},
): Promise<boolean> {
	const [updated] = await db
		.update(taskAssignments)
		.set({
			status: "complete",
			completedAt: input.completedAt,
			response: input.answers,
		})
		.where(
			and(
				eq(taskAssignments.id, input.assignmentId),
				eq(taskAssignments.contactId, input.contactId),
				isNull(taskAssignments.response),
			),
		)
		.returning({ id: taskAssignments.id });
	return updated !== undefined;
}
