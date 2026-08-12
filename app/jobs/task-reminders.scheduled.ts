import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb } from "~/db";
import { contacts, events, taskAssignments, tasks } from "~/db/schema";
import { errorMessage } from "~/lib/errors";
import { formatDateUTC } from "~/lib/format";
import { escapeHtml } from "~/lib/html";
import { emailOrigin, firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { type Clock, systemClock } from "~/ports/clock";
import { getEmailSender } from "~/ports/email";
import { track } from "~/lib/track";
import { DAILY_CRON } from "./cadence";
import type { ScheduledJob } from "./registry";

/** How far ahead of the due date the reminder goes out. */
export const REMINDER_WINDOW_DAYS = 3;

function reminderEmail(row: {
	firstName: string;
	taskName: string;
	eventName: string;
	dueAt: Date;
	overdue: boolean;
	portalUrl: string | null;
}): { subject: string; html: string } {
	const due = formatDateUTC(row.dueAt);
	const subject = row.overdue
		? `Overdue: "${row.taskName}" was due ${due}`
		: `Reminder: "${row.taskName}" is due ${due}`;
	const portal = row.portalUrl
		? `<p><a href="${row.portalUrl}">Open your speaker portal</a> to complete it.</p>`
		: `<p>Log in to your speaker portal to complete it.</p>`;
	const html =
		`<p>Hi ${escapeHtml(row.firstName)},</p>` +
		`<p>Your task <strong>${escapeHtml(row.taskName)}</strong> for ${escapeHtml(row.eventName)} ` +
		(row.overdue ? `was due ${due} and is now overdue.` : `is due ${due}.`) +
		`</p>${portal}`;
	return { subject, html };
}

/**
 * Sends one email per (assignment, due date). `reminderSentAt` is the
 * double-fire guard: stamped after a send, CLEARED whenever an admin edits the
 * due date, so an extended deadline re-arms it. The outbox `dedupeKey` embeds
 * the due date for the same reason — the earlier send must not swallow a re-arm.
 */
export async function runTaskDueReminders(
	env: Env,
	clock: Clock,
): Promise<{ sent: number; failed: number }> {
	const db = getDb(env);
	// Resolved up front: a prod deployment missing APP_ORIGIN must fail loudly
	// before any link-less email goes out.
	const origin = emailOrigin(env);
	const now = clock.now();
	const horizon = new Date(
		now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
	);

	// `incomplete` only: a pending_feedback upload is waiting on the ORGANIZER —
	// nagging the speaker about it would be wrong. NULL dueAt never matches lte().
	const due = await db
		.select({
			assignmentId: taskAssignments.id,
			dueAt: taskAssignments.dueAt,
			taskId: tasks.id,
			taskName: tasks.name,
			eventId: events.id,
			eventName: events.name,
			eventSlug: events.slug,
			email: contacts.email,
			firstName: contacts.firstName,
		})
		.from(taskAssignments)
		.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
		.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
		.innerJoin(events, eq(events.id, tasks.eventId))
		.where(
			and(
				eq(taskAssignments.status, "incomplete"),
				isNull(taskAssignments.reminderSentAt),
				lte(taskAssignments.dueAt, horizon),
			),
		);
	if (due.length === 0) return { sent: 0, failed: 0 };

	const portalByEvent = await firstPortalsByEvent(db);

	const sender = getEmailSender(env);
	let sent = 0;
	let failed = 0;
	for (const row of due) {
		if (!row.dueAt) continue;
		const publicId = portalByEvent.get(row.eventId);
		const { subject, html } = reminderEmail({
			firstName: row.firstName,
			taskName: row.taskName,
			eventName: row.eventName,
			dueAt: row.dueAt,
			overdue: row.dueAt.getTime() < now.getTime(),
			portalUrl:
				origin && publicId ? portalUrl(origin, row.eventSlug, publicId) : null,
		});
		try {
			const result = await sender.send({
				to: row.email,
				subject,
				html,
				kind: "transactional",
				dedupeKey: `task-due:${row.assignmentId}:${Math.floor(row.dueAt.getTime() / 1000)}`,
				eventId: row.eventId,
			});
			await db
				.update(taskAssignments)
				.set({ reminderSentAt: now })
				.where(
					and(
						eq(taskAssignments.id, row.assignmentId),
						isNull(taskAssignments.reminderSentAt),
					),
				);
			track("task.reminder_sent", {
				eventId: row.eventId,
				taskId: row.taskId,
				assignmentId: row.assignmentId,
				deduped: result.deduped,
			});
			sent += 1;
		} catch (error) {
			// No stamp on failure — the next tick retries this assignment.
			failed += 1;
			track("task.reminder_send_failed", {
				eventId: row.eventId,
				assignmentId: row.assignmentId,
				error: errorMessage(error),
			});
		}
	}
	return { sent, failed };
}

const job: ScheduledJob = {
	name: "task-due-reminders",
	cron: DAILY_CRON,
	async run(env) {
		await runTaskDueReminders(env, systemClock);
	},
};

export default job;
