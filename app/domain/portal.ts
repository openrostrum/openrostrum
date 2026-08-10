import { and, desc, eq, isNull } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import type { SUBMISSION_STATUS } from "~/db/constants";
import {
	type Contact,
	contacts,
	events,
	formats,
	forms,
	participants,
	portals,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "~/db/schema";
import { normalizeEmail } from "~/lib/auth";
import type { BadgeTone } from "~/ui";

type AppUser = typeof users.$inferSelect;
type AppEvent = typeof events.$inferSelect;
type Portal = typeof portals.$inferSelect;

/** What a status looks like to a PORTAL user — never the raw enum. */
export type PortalStatus = { label: string; tone: BadgeTone };

/**
 * SERVER-SIDE status masking (flows/09 rule e): Accept Queue / Decline Queue
 * are admin staging so outcomes can be emailed before they're visible — the
 * portal must render them as "Pending". Loaders return THIS label, never the
 * raw enum, so queue names cannot reach portal HTML by construction.
 */
const STATUS_PROJECTION: Record<
	(typeof SUBMISSION_STATUS)[number],
	PortalStatus
> = {
	draft: { label: "Draft", tone: "faint" },
	pending: { label: "Pending", tone: "warning" },
	accept_queue: { label: "Pending", tone: "warning" },
	decline_queue: { label: "Pending", tone: "warning" },
	accepted: { label: "Accepted", tone: "success" },
	declined: { label: "Declined", tone: "danger" },
	withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function portalStatus(
	status: (typeof SUBMISSION_STATUS)[number],
): PortalStatus {
	return STATUS_PROJECTION[status];
}

/** Per-person acceptance, in portal words ("declined" reads as Withdrawn). */
export const PARTICIPATION_PROJECTION: Record<string, PortalStatus> = {
	pending: { label: "Confirmation needed", tone: "warning" },
	accepted: { label: "Confirmed", tone: "success" },
	declined: { label: "Withdrawn", tone: "neutral" },
};

export type PortalContext = {
	event: AppEvent;
	portal: Portal;
	/** Null = authenticated user with no contact in this event yet (e.g. draft-only). */
	contact: Contact | null;
};

/**
 * The portal identity chain: URL slug → event → portal (scoped to that event)
 * → the caller's contact via `contacts.userId + contacts.eventId`. Cross-tenant
 * denial is inherited from this join — a foreign event/portal 404s before any
 * data query, and every downstream read anchors on the resolved contact.
 * A contact created before the user existed (co-speaker added by someone else)
 * is linked here by normalized-email match, once, at first portal entry.
 */
export async function getPortalContext(
	env: Env,
	user: AppUser,
	params: { eventSlug: string; portalId: string },
): Promise<PortalContext> {
	const db = getDb(env);
	const [event] = await db
		.select()
		.from(events)
		.where(eq(events.slug, params.eventSlug))
		.limit(1);
	if (!event) throw data(null, { status: 404 });
	const [portal] = await db
		.select()
		.from(portals)
		.where(
			and(eq(portals.publicId, params.portalId), eq(portals.eventId, event.id)),
		)
		.limit(1);
	if (!portal) throw data(null, { status: 404 });

	let [contact] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.userId, user.id), eq(contacts.eventId, event.id)))
		.limit(1);
	if (!contact) {
		const [match] = await db
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.eventId, event.id),
					eq(contacts.email, normalizeEmail(user.email)),
					isNull(contacts.userId),
				),
			)
			.limit(1);
		if (match) {
			await db
				.update(contacts)
				.set({ userId: user.id })
				.where(eq(contacts.id, match.id));
			contact = { ...match, userId: user.id };
		}
	}
	return { event, portal, contact: contact ?? null };
}

export function portalPath(ctx: PortalContext, suffix = ""): string {
	return `/portals/${ctx.event.slug}/${ctx.portal.publicId}${suffix}`;
}

export type PortalSubmissionRow = {
	id: string;
	title: string;
	status: PortalStatus;
	format: string | null;
	createdAt: number;
	/** My participants row on this submission, if any. */
	participation: {
		id: string;
		status: PortalStatus;
		raw: string;
		confirmable: boolean;
	} | null;
};

/**
 * My Sessions = submissions I'm a PARTICIPANT on ∪ submissions I SUBMITTED
 * (a draft saved before the participant step has no participants row, and a
 * submitter isn't necessarily listed as a speaker). Both halves are anchored
 * on my ids — the other ~N of the event's submissions can never join in.
 */
export async function listPortalSubmissions(
	env: Env,
	ctx: PortalContext,
	userId: string,
): Promise<PortalSubmissionRow[]> {
	const db = getDb(env);
	const byId = new Map<string, PortalSubmissionRow>();

	const own = await db
		.select({
			id: submissions.id,
			title: submissions.title,
			status: submissions.status,
			format: formats.name,
			createdAt: submissions.createdAt,
		})
		.from(submissions)
		.leftJoin(formats, eq(formats.id, submissions.formatId))
		.where(
			and(
				eq(submissions.submitterId, userId),
				eq(submissions.eventId, ctx.event.id),
			),
		)
		.orderBy(desc(submissions.createdAt));
	for (const row of own) {
		byId.set(row.id, {
			id: row.id,
			title: row.title,
			status: portalStatus(row.status),
			format: row.format,
			createdAt: row.createdAt.getTime(),
			participation: null,
		});
	}

	if (ctx.contact) {
		const linked = await db
			.select({
				id: submissions.id,
				title: submissions.title,
				status: submissions.status,
				format: formats.name,
				createdAt: submissions.createdAt,
				participantId: participants.id,
				acceptance: participants.acceptanceStatus,
			})
			.from(participants)
			.innerJoin(submissions, eq(submissions.id, participants.submissionId))
			.leftJoin(formats, eq(formats.id, submissions.formatId))
			.where(
				and(
					eq(participants.contactId, ctx.contact.id),
					eq(submissions.eventId, ctx.event.id),
				),
			)
			.orderBy(desc(submissions.createdAt));
		for (const row of linked) {
			byId.set(row.id, {
				id: row.id,
				title: row.title,
				status: portalStatus(row.status),
				format: row.format,
				createdAt: row.createdAt.getTime(),
				participation: {
					id: row.participantId,
					status: PARTICIPATION_PROJECTION[row.acceptance] ?? {
						label: "Confirmation needed",
						tone: "warning",
					},
					raw: row.acceptance,
					// Per-person Confirm/Withdraw exists ONLY on Accepted sessions.
					confirmable: row.status === "accepted",
				},
			});
		}
	}

	return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Ownership gate for a single submission: participant via my contact OR my
 * own submitted row — anything else 404s (never 403: existence itself is data).
 */
export async function requireOwnedSubmission(
	env: Env,
	ctx: PortalContext,
	userId: string,
	submissionId: string,
) {
	const db = getDb(env);
	const [submission] = await db
		.select()
		.from(submissions)
		.where(
			and(
				eq(submissions.id, submissionId),
				eq(submissions.eventId, ctx.event.id),
			),
		)
		.limit(1);
	if (!submission) throw data(null, { status: 404 });
	let myParticipant = null;
	if (ctx.contact) {
		const [p] = await db
			.select()
			.from(participants)
			.where(
				and(
					eq(participants.submissionId, submission.id),
					eq(participants.contactId, ctx.contact.id),
				),
			)
			.limit(1);
		myParticipant = p ?? null;
	}
	if (!myParticipant && submission.submitterId !== userId)
		throw data(null, { status: 404 });
	return { submission, myParticipant };
}

export const TASK_STATUS_PROJECTION: Record<string, PortalStatus> = {
	incomplete: { label: "Incomplete", tone: "warning" },
	complete: { label: "Complete", tone: "success" },
	pending_feedback: { label: "Pending review", tone: "info" },
};

export type PortalTaskRow = {
	id: string;
	name: string;
	required: boolean;
	type: string;
	isFileRequest: boolean;
	hasForm: boolean;
	status: PortalStatus;
	open: boolean;
	dueAtMs: number | null;
	overdue: boolean;
	submissionTitle: string | null;
};

/** All of MY task assignments, required-then-due-soonest, open work first. */
export async function listPortalTasks(
	env: Env,
	ctx: PortalContext,
	now: Date = new Date(),
): Promise<PortalTaskRow[]> {
	if (!ctx.contact) return [];
	const db = getDb(env);
	const rows = await db
		.select({
			id: taskAssignments.id,
			status: taskAssignments.status,
			dueAt: taskAssignments.dueAt,
			name: tasks.name,
			required: tasks.required,
			type: tasks.type,
			isFileRequest: tasks.isFileRequest,
			portalFormId: tasks.portalFormId,
			submissionTitle: submissions.title,
		})
		.from(taskAssignments)
		.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
		.leftJoin(submissions, eq(submissions.id, taskAssignments.submissionId))
		.where(eq(taskAssignments.contactId, ctx.contact.id));
	return rows
		.map((r) => ({
			id: r.id,
			name: r.name,
			required: r.required,
			type: r.type,
			isFileRequest: r.isFileRequest,
			hasForm: r.portalFormId !== null,
			status: TASK_STATUS_PROJECTION[r.status] ?? {
				label: "Incomplete",
				tone: "warning" as const,
			},
			open: r.status !== "complete",
			dueAtMs: r.dueAt?.getTime() ?? null,
			overdue: r.status !== "complete" && !!r.dueAt && r.dueAt < now,
			submissionTitle: r.submissionTitle,
		}))
		.sort(
			(a, b) =>
				Number(b.open) - Number(a.open) ||
				Number(b.required) - Number(a.required) ||
				(a.dueAtMs ?? Infinity) - (b.dueAtMs ?? Infinity) ||
				a.name.localeCompare(b.name),
		);
}

export type EditWindow = {
	editable: boolean;
	/** Why editing is off, in speaker-readable words (null while editable). */
	reason: string | null;
	closesAt: Date | null;
};

/**
 * Speakers edit their SUBMITTED proposal until the source form's close date;
 * withdrawn rows and organizer-created rows (no source form) have no edit
 * path. The same rule gates content edits AND participant edits; per-person
 * Confirm/Withdraw is deliberately NOT close-gated — acceptance happens after
 * the CFP closes.
 */
export async function getEditWindow(
	env: Env,
	submission: typeof submissions.$inferSelect,
	now: Date = new Date(),
): Promise<EditWindow> {
	if (submission.status === "withdrawn") {
		return {
			editable: false,
			reason: "This submission was withdrawn and can no longer be edited.",
			closesAt: null,
		};
	}
	if (!submission.formId) {
		return {
			editable: false,
			reason:
				"This session was created by the organizers — contact the event team to request changes.",
			closesAt: null,
		};
	}
	const db = getDb(env);
	const [form] = await db
		.select({ closeAt: forms.closeAt })
		.from(forms)
		.where(eq(forms.id, submission.formId))
		.limit(1);
	const closesAt = form?.closeAt ?? null;
	if (closesAt && closesAt.getTime() <= now.getTime()) {
		return {
			editable: false,
			reason:
				"The submission form has closed, so editing is no longer available. Contact the event team if you need a change.",
			closesAt,
		};
	}
	return { editable: true, reason: null, closesAt };
}
