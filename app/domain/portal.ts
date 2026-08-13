import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { PARTICIPANT_ROLE, type SUBMISSION_STATUS } from "~/db/constants";
import {
	type Contact,
	contactIdentityAliases,
	contacts,
	events,
	FILE_REVIEW_STATUS,
	formats,
	forms,
	PARTICIPANT_ACCEPTANCE,
	participants,
	portals,
	submissions,
	TASK_STATUS,
	taskAssignments,
	tasks,
	users,
} from "~/db/schema";
import { resolveContactIdentityAlias } from "~/domain/contact-merge";
import { normalizeEmail, userCanAccessEvent } from "~/lib/auth";
import { formatDateUTC } from "~/lib/format";
import {
	contactDisplayName,
	previewContactForEvent,
} from "~/lib/portal-preview";
import { isOverdue } from "~/lib/task-status";
import type { BadgeTone } from "~/ui";

type AppUser = typeof users.$inferSelect;
type AppEvent = typeof events.$inferSelect;
type Portal = typeof portals.$inferSelect;

/** What a status looks like to a PORTAL user — never the raw enum. */
export type PortalStatus = { label: string; tone: BadgeTone };

/**
 * SERVER-SIDE status masking: Accept Queue / Decline Queue are admin staging
 * so outcomes can be emailed before they're visible — the portal must render
 * them as "Pending". Loaders return THIS label, never the raw enum, so queue
 * names cannot reach portal HTML by construction.
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
export const PARTICIPATION_PROJECTION: Record<
	(typeof PARTICIPANT_ACCEPTANCE)[number],
	PortalStatus
> = {
	pending: { label: "Confirmation needed", tone: "warning" },
	accepted: { label: "Confirmed", tone: "success" },
	declined: { label: "Withdrawn", tone: "neutral" },
};

/** File-request review states, in portal words. */
export const FILE_REVIEW_PROJECTION: Record<
	(typeof FILE_REVIEW_STATUS)[number],
	PortalStatus
> = {
	pending: { label: "Pending review", tone: "info" },
	approved: { label: "Approved", tone: "success" },
	denied: { label: "Changes requested", tone: "danger" },
	none: { label: "Uploaded", tone: "neutral" },
};

export type PortalContext = {
	event: AppEvent;
	portal: Portal;
	/** Null = authenticated user with no contact in this event yet (e.g. draft-only). */
	contact: Contact | null;
	/** Account whose ownership portal GETs project; null for an unlinked preview contact. */
	subjectUserId: string | null;
	/** Set while an org admin views the portal as `contact` — read-only mode. */
	preview: { contactName: string } | null;
};

/**
 * Resolves URL, event, portal, and effective contact as one tenancy chain.
 * Preview keeps organizer authority while projecting the selected contact;
 * rejecting non-GET requests here blocks every nested mutation before effects.
 */
export async function getPortalContext(
	env: Env,
	user: AppUser,
	params: { eventSlug: string; portalId: string },
	request: Request,
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

	if (user.role === "admin") {
		const previewContact = await previewContactForEvent(db, request, event.id);
		if (previewContact && (await userCanAccessEvent(env, user.id, event.id))) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				throw data(null, { status: 403 });
			}
			return {
				event,
				portal,
				contact: previewContact,
				subjectUserId: previewContact.userId,
				preview: { contactName: contactDisplayName(previewContact) },
			};
		}
	}

	const alias = await resolveContactIdentityAlias(
		db,
		event.organizationId,
		user.id,
	);
	const subjectUserId = alias?.survivorUserId ?? user.id;
	let [contact] = alias
		? await db
				.select()
				.from(contacts)
				.where(
					and(
						eq(contacts.eventId, event.id),
						sql`lower(${contacts.email}) = ${alias.survivorEmail}`,
					),
				)
				.limit(1)
		: await db
				.select()
				.from(contacts)
				.where(
					and(
						eq(contacts.userId, subjectUserId),
						eq(contacts.eventId, event.id),
					),
				)
				.limit(1);
	if (!contact && !alias) {
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
	return {
		event,
		portal,
		contact: contact ?? null,
		subjectUserId,
		preview: null,
	};
}

export function portalPath(ctx: PortalContext, suffix = ""): string {
	return `/portals/${ctx.event.slug}/${ctx.portal.publicId}${suffix}`;
}

export type AccessiblePortal = {
	eventName: string;
	href: string;
};

/**
 * Every event the speaker can enter, one canonical portal each. Union of
 * linked contacts, same-email contacts, merge aliases, and their own
 * submissions — never a silent first-match.
 */
export async function listAccessiblePortals(
	env: Env,
	user: Pick<AppUser, "id" | "email">,
): Promise<AccessiblePortal[]> {
	const db = getDb(env);
	const email = normalizeEmail(user.email);
	const [linked, byEmail, aliased, submitted] = await Promise.all([
		db
			.select({ eventId: contacts.eventId })
			.from(contacts)
			.where(eq(contacts.userId, user.id)),
		db
			.select({ eventId: contacts.eventId })
			.from(contacts)
			.where(and(eq(contacts.email, email), isNull(contacts.userId))),
		db
			.select({ eventId: contacts.eventId })
			.from(contactIdentityAliases)
			.innerJoin(
				events,
				eq(events.organizationId, contactIdentityAliases.organizationId),
			)
			.innerJoin(
				contacts,
				and(
					eq(contacts.eventId, events.id),
					sql`lower(${contacts.email}) = ${contactIdentityAliases.survivorEmail}`,
				),
			)
			.where(eq(contactIdentityAliases.sourceUserId, user.id)),
		db
			.select({ eventId: submissions.eventId })
			.from(submissions)
			.where(eq(submissions.submitterId, user.id)),
	]);
	const eventIds = [
		...new Set(
			[...linked, ...byEmail, ...aliased, ...submitted].map(
				(row) => row.eventId,
			),
		),
	];
	if (eventIds.length === 0) return [];

	const rows = await db
		.select({
			eventId: events.id,
			eventName: events.name,
			slug: events.slug,
			publicId: portals.publicId,
		})
		.from(portals)
		.innerJoin(events, eq(events.id, portals.eventId))
		.where(inArray(events.id, eventIds))
		.orderBy(asc(events.name), asc(portals.createdAt), asc(portals.id));

	const choices: AccessiblePortal[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (seen.has(row.eventId)) continue;
		seen.add(row.eventId);
		choices.push({
			eventName: row.eventName,
			href: `/portals/${row.slug}/${row.publicId}/home`,
		});
	}
	return choices;
}

/**
 * The headshot key of a person the caller is entitled to see: themselves, or a
 * co-speaker they share a submission with in THIS event. Anyone else — another
 * contact in the same event, or any contact outside it — resolves to null, so
 * the route 404s instead of falling back to the caller's own photo.
 */
export async function visibleHeadshotKey(
	env: Env,
	ctx: PortalContext,
	contactId: string | null,
): Promise<string | null> {
	if (!ctx.contact) return null;
	if (!contactId || contactId === ctx.contact.id)
		return ctx.contact.headshotKey;
	const db = getDb(env);
	const mine = db
		.select({ submissionId: participants.submissionId })
		.from(participants)
		.innerJoin(submissions, eq(submissions.id, participants.submissionId))
		.where(
			and(
				eq(participants.contactId, ctx.contact.id),
				eq(submissions.eventId, ctx.event.id),
			),
		);
	const [row] = await db
		.select({ headshotKey: contacts.headshotKey })
		.from(contacts)
		.innerJoin(participants, eq(participants.contactId, contacts.id))
		.where(
			and(
				eq(contacts.id, contactId),
				eq(contacts.eventId, ctx.event.id),
				inArray(participants.submissionId, mine),
			),
		)
		.limit(1);
	return row?.headshotKey ?? null;
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

const PORTAL_SUBMISSION_LIMIT = 100;

type PortalSubmissionList = {
	rows: PortalSubmissionRow[];
	truncated: boolean;
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
): Promise<PortalSubmissionList> {
	const db = getDb(env);
	const byId = new Map<string, PortalSubmissionRow>();

	if (ctx.subjectUserId !== null) {
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
					eq(submissions.submitterId, ctx.subjectUserId),
					eq(submissions.eventId, ctx.event.id),
				),
			)
			.orderBy(desc(submissions.createdAt))
			.limit(PORTAL_SUBMISSION_LIMIT + 1);
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
				participantRole: participants.role,
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
			.orderBy(
				desc(submissions.createdAt),
				asc(participants.position),
				asc(participants.createdAt),
				asc(participants.id),
			)
			.limit((PORTAL_SUBMISSION_LIMIT + 1) * PARTICIPANT_ROLE.length);
		for (const row of linked) {
			const existing = byId.get(row.id) ?? {
				id: row.id,
				title: row.title,
				status: portalStatus(row.status),
				format: row.format,
				createdAt: row.createdAt.getTime(),
				participation: null,
			};
			if (row.participantRole !== "secondary" && !existing.participation) {
				existing.participation = {
					id: row.participantId,
					status: PARTICIPATION_PROJECTION[row.acceptance],
					raw: row.acceptance,
					confirmable: row.status === "accepted",
				};
			}
			byId.set(row.id, existing);
		}
	}

	const rows = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
	return {
		rows: rows.slice(0, PORTAL_SUBMISSION_LIMIT),
		truncated: rows.length > PORTAL_SUBMISSION_LIMIT,
	};
}

/**
 * Ownership gate for a single submission: participant via my contact OR my
 * own submitted row — anything else 404s (never 403: existence itself is data).
 */
export async function requireOwnedSubmission(
	env: Env,
	ctx: PortalContext,
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
	let ownsThroughParticipant = false;
	if (ctx.contact) {
		const links = await db
			.select({
				id: participants.id,
				role: participants.role,
				acceptanceStatus: participants.acceptanceStatus,
			})
			.from(participants)
			.where(
				and(
					eq(participants.submissionId, submission.id),
					eq(participants.contactId, ctx.contact.id),
				),
			)
			.orderBy(
				asc(participants.position),
				asc(participants.createdAt),
				asc(participants.id),
			);
		ownsThroughParticipant = links.length > 0;
		myParticipant = links.find((link) => link.role !== "secondary") ?? null;
	}
	if (
		!ownsThroughParticipant &&
		(ctx.subjectUserId === null || submission.submitterId !== ctx.subjectUserId)
	)
		throw data(null, { status: 404 });
	return { submission, myParticipant };
}

export const TASK_STATUS_PROJECTION: Record<
	(typeof TASK_STATUS)[number],
	PortalStatus
> = {
	incomplete: { label: "Incomplete", tone: "warning" },
	complete: { label: "Complete", tone: "success" },
	pending_feedback: { label: "Pending review", tone: "info" },
};

export type PortalTaskRow = {
	id: string;
	name: string;
	required: boolean;
	type: string;
	status: PortalStatus;
	open: boolean;
	/** Due date pre-rendered in the EVENT's timezone. */
	due: string | null;
	overdue: boolean;
	submissionId: string | null;
	submissionTitle: string | null;
};

/**
 * All of MY task assignments as display rows (converted once at this
 * boundary), required-then-due-soonest, open work first.
 */
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
			submissionId: submissions.id,
			submissionTitle: submissions.title,
		})
		.from(taskAssignments)
		.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
		.leftJoin(submissions, eq(submissions.id, taskAssignments.submissionId))
		.where(eq(taskAssignments.contactId, ctx.contact.id));
	return rows
		.sort(
			(a, b) =>
				Number(b.status !== "complete") - Number(a.status !== "complete") ||
				Number(b.required) - Number(a.required) ||
				(a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
				a.name.localeCompare(b.name),
		)
		.map((r) => ({
			id: r.id,
			name: r.name,
			required: r.required,
			type: r.type,
			status: TASK_STATUS_PROJECTION[r.status],
			open: r.status !== "complete",
			due: r.dueAt ? formatDateUTC(r.dueAt) : null,
			overdue: isOverdue(r.dueAt, r.status, now),
			submissionId: r.submissionId,
			submissionTitle: r.submissionTitle,
		}));
}

export type EditWindow = {
	editable: boolean;
	/** Why editing is off, in speaker-readable words (null while editable). */
	reason: string | null;
	closesAt: Date | null;
};

/**
 * Speakers edit their SUBMITTED proposal until the source form's close date;
 * withdrawn and organizer-created rows (no source form) have no edit path. The
 * same rule gates content AND participant edits; per-person Confirm/Withdraw is
 * deliberately NOT close-gated, since acceptance happens after the CFP closes.
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
		.where(
			and(
				eq(forms.id, submission.formId),
				eq(forms.eventId, submission.eventId),
			),
		)
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
