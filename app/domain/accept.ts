import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { createEvent } from "ics";
import type { Db } from "~/db";
import { DECISION_STATUS, SUBMISSION_STATUS } from "~/db/constants";
import {
	contacts,
	emailTemplates,
	events,
	participants,
	rooms,
	type Submission,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "~/db/schema";
import { normalizeEmail } from "~/lib/auth";
import { track } from "~/lib/track";
import { getEmailSender } from "~/ports/email";

/**
 * The accept/decline spine — the ONE place every submission decision runs
 * through, whatever triggered it (admin inline flip, bulk edit, the compat
 * API, an Airtable-inbound status change). Routes never inline these writes.
 *
 * Caller contract: callers pass submission rows they have ALREADY fetched,
 * authorized, and scoped (the route action scopes by the active event; the
 * API by its token's organization; the Airtable sync by its org-filtered
 * link set). The spine takes no org/event parameter — everything it needs is
 * on the row, and an unauthorized row must never reach it.
 *
 * Guarantees:
 * - Status changes NEVER send email. Decision emails are a separate,
 *   explicit action (`sendDecisionEmails`).
 * - Accepting provisions the speaker side (user linkage, onboarding task
 *   assignments) idempotently — replaying an accept adds nothing, and
 *   leaving `accepted` never un-provisions (task responses are kept).
 * - Every transition emits a `track()` event.
 */

export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
export type DecisionStatus = (typeof DECISION_STATUS)[number];

export interface TransitionResult {
	submissionId: string;
	from: SubmissionStatus;
	to: SubmissionStatus;
	ok: boolean;
	/** Human-readable refusal, present when `ok` is false. */
	reason?: string;
}

/**
 * Legality of a decision transition. `draft` rows are pre-submission — they
 * have never been submitted, so they cannot receive a decision. Every other
 * status (including `withdrawn`, whose resolutions are decline or undo) may
 * move to any decision status; a same-status re-apply is legal and re-runs
 * the accept provisioning idempotently.
 */
export function canTransition(
	from: SubmissionStatus,
	_to: DecisionStatus,
): { ok: true } | { ok: false; reason: string } {
	if (from === "draft") {
		return {
			ok: false,
			reason:
				"Draft submissions have not been submitted — no decision applies.",
		};
	}
	return { ok: true };
}

/**
 * Transition submissions to a decision status — single row or bulk, one code
 * path. Illegal rows are skipped and reported per-row; legal rows proceed.
 *
 * On `accepted`, additionally (all writes in one `db.batch`):
 * - links `contacts.userId` for speaker contacts whose email matches an
 *   existing account (case-insensitive; never mints users, never emails);
 * - marks content `in_review` when it is still `draft` (approved stays);
 * - mints onboarding task assignments for every speaker-role contact:
 *   contact tasks once per contact, submission tasks per (contact,
 *   submission-scoped row). The `task_assignments` unique index on
 *   (taskId, contactId) makes re-runs no-ops; group-type tasks have no
 *   auto-assign target (no group model) and are never minted here.
 *
 * Leaving `withdrawn` for anything but `declined` clears the withdrawal
 * metadata (the withdrawal was undone); declining a withdrawn submission
 * keeps who/when/why as the record of why it ended declined.
 */
export async function transitionSubmissions(
	db: Db,
	rows: Submission[],
	to: DecisionStatus,
): Promise<TransitionResult[]> {
	const now = new Date();
	const results: TransitionResult[] = [];
	const legal: Submission[] = [];
	for (const row of rows) {
		const check = canTransition(row.status, to);
		if (check.ok) {
			legal.push(row);
			results.push({ submissionId: row.id, from: row.status, to, ok: true });
		} else {
			results.push({
				submissionId: row.id,
				from: row.status,
				to,
				ok: false,
				reason: check.reason,
			});
		}
	}
	if (legal.length === 0) return results;

	const statements: BatchItem<"sqlite">[] = [];
	for (const row of legal) {
		const set: Partial<typeof submissions.$inferInsert> = { status: to };
		if (row.status !== to) set.statusChangedAt = now;
		if (row.status === "withdrawn" && to !== "declined") {
			set.withdrawnAt = null;
			set.withdrawnById = null;
			set.withdrawnReason = null;
		}
		if (to === "accepted" && row.contentStatus === "draft") {
			set.contentStatus = "in_review";
		}
		statements.push(
			db.update(submissions).set(set).where(eq(submissions.id, row.id)),
		);
	}

	const provisioning =
		to === "accepted" ? await planAcceptProvisioning(db, legal, now) : null;
	if (provisioning) {
		statements.push(...provisioning.linkStatements);
		if (provisioning.insertStatement) {
			statements.push(provisioning.insertStatement);
		}
	}

	const batchResults = await db.batch(
		statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
	);

	for (const row of legal) {
		track("submission.status_changed", {
			submissionId: row.id,
			eventId: row.eventId,
			from: row.status,
			to,
		});
	}
	if (provisioning) {
		const inserted = provisioning.insertStatement
			? (batchResults.at(-1) as { taskId: string; contactId: string }[])
			: [];
		const insertedBySubmission = new Map<string, number>();
		for (const row of inserted) {
			const source = provisioning.sourceByKey.get(
				`${row.taskId}:${row.contactId}`,
			);
			if (!source) continue;
			insertedBySubmission.set(
				source,
				(insertedBySubmission.get(source) ?? 0) + 1,
			);
		}
		for (const row of legal) {
			track("accept.provisioned", {
				submissionId: row.id,
				eventId: row.eventId,
				speakers: provisioning.speakerCounts.get(row.id) ?? 0,
				assignmentsInserted: insertedBySubmission.get(row.id) ?? 0,
				contactsLinked: provisioning.linkedBySubmission.get(row.id) ?? 0,
			});
		}
	}
	return results;
}

interface ProvisioningPlan {
	linkStatements: BatchItem<"sqlite">[];
	insertStatement: BatchItem<"sqlite"> | null;
	/** (taskId:contactId) → the accepted submission that planned the row. */
	sourceByKey: Map<string, string>;
	speakerCounts: Map<string, number>;
	linkedBySubmission: Map<string, number>;
}

async function planAcceptProvisioning(
	db: Db,
	rows: Submission[],
	now: Date,
): Promise<ProvisioningPlan> {
	const ids = rows.map((r) => r.id);
	const eventIds = [...new Set(rows.map((r) => r.eventId))];

	const speakerRows = await db
		.select({
			submissionId: participants.submissionId,
			contactId: contacts.id,
			contactEmail: contacts.email,
			contactUserId: contacts.userId,
		})
		.from(participants)
		.innerJoin(contacts, eq(contacts.id, participants.contactId))
		.where(
			and(
				inArray(participants.submissionId, ids),
				eq(participants.role, "speaker"),
			),
		);

	const taskDefs = await db
		.select()
		.from(tasks)
		.where(
			and(
				inArray(tasks.eventId, eventIds),
				eq(tasks.isOnboardingDefault, true),
			),
		);

	// Speaker → account linkage: attach existing users by email so an already
	// registered co-speaker's portal lights up on accept. Never creates users
	// (a co-speaker without an account gets one via the invite flow, which is
	// an explicit send — accept stays silent).
	const unlinkedByContact = new Map<string, string>();
	for (const s of speakerRows) {
		if (!s.contactUserId) unlinkedByContact.set(s.contactId, s.contactEmail);
	}
	const emails = [
		...new Set([...unlinkedByContact.values()].map(normalizeEmail)),
	];
	const userRows = emails.length
		? await db
				.select({ id: users.id, email: users.email })
				.from(users)
				.where(inArray(users.email, emails))
		: [];
	const userByEmail = new Map(userRows.map((u) => [u.email, u.id]));

	const linkStatements: BatchItem<"sqlite">[] = [];
	const linkedContactIds = new Set<string>();
	for (const [contactId, email] of unlinkedByContact) {
		const userId = userByEmail.get(normalizeEmail(email));
		if (!userId) continue;
		linkedContactIds.add(contactId);
		linkStatements.push(
			db
				.update(contacts)
				.set({ userId })
				.where(and(eq(contacts.id, contactId), isNull(contacts.userId))),
		);
	}

	const tasksByEvent = new Map<string, typeof taskDefs>();
	for (const def of taskDefs) {
		const list = tasksByEvent.get(def.eventId) ?? [];
		list.push(def);
		tasksByEvent.set(def.eventId, list);
	}

	const values: (typeof taskAssignments.$inferInsert)[] = [];
	const sourceByKey = new Map<string, string>();
	const speakerCounts = new Map<string, number>();
	const linkedBySubmission = new Map<string, number>();
	for (const row of rows) {
		const speakers = speakerRows.filter((s) => s.submissionId === row.id);
		speakerCounts.set(row.id, speakers.length);
		linkedBySubmission.set(
			row.id,
			speakers.filter((s) => linkedContactIds.has(s.contactId)).length,
		);
		for (const def of tasksByEvent.get(row.eventId) ?? []) {
			if (def.type === "group") continue;
			for (const speaker of speakers) {
				const key = `${def.id}:${speaker.contactId}`;
				if (sourceByKey.has(key)) continue;
				sourceByKey.set(key, row.id);
				values.push({
					taskId: def.id,
					contactId: speaker.contactId,
					submissionId: def.type === "submission" ? row.id : null,
					status: "incomplete",
					dueAt:
						def.dueInDays == null
							? null
							: new Date(now.getTime() + def.dueInDays * 86_400_000),
				});
			}
		}
	}

	const insertStatement = values.length
		? db
				.insert(taskAssignments)
				.values(values)
				.onConflictDoNothing({
					target: [taskAssignments.taskId, taskAssignments.contactId],
				})
				.returning({
					taskId: taskAssignments.taskId,
					contactId: taskAssignments.contactId,
				})
		: null;

	return {
		linkStatements,
		insertStatement,
		sourceByKey,
		speakerCounts,
		linkedBySubmission,
	};
}

/**
 * Speaker-initiated withdrawal (the portal action's domain half; an admin
 * resolution path can reuse it). Requires a reason — the who/when/why is
 * mandatory record, not optional. Unschedules the session so no withdrawn
 * ghost stays on the agenda grid; content columns are untouched.
 */
export async function withdrawSubmission(
	db: Db,
	opts: { submission: Submission; byUserId: string; reason: string },
): Promise<TransitionResult> {
	const { submission } = opts;
	const reason = opts.reason.trim();
	const base = {
		submissionId: submission.id,
		from: submission.status,
		to: "withdrawn",
	} as const;
	if (!reason) {
		return { ...base, ok: false, reason: "A withdrawal reason is required." };
	}
	if (submission.status === "draft") {
		return {
			...base,
			ok: false,
			reason: "Drafts are not submitted — delete the draft instead.",
		};
	}
	if (submission.status === "withdrawn") {
		return {
			...base,
			ok: false,
			reason: "This submission is already withdrawn.",
		};
	}
	const now = new Date();
	await db
		.update(submissions)
		.set({
			status: "withdrawn",
			statusChangedAt: now,
			withdrawnAt: now,
			withdrawnById: opts.byUserId,
			withdrawnReason: reason,
			startsAt: null,
			endsAt: null,
			roomId: null,
		})
		.where(eq(submissions.id, submission.id));
	track("submission.withdrawn", {
		submissionId: submission.id,
		eventId: submission.eventId,
		from: submission.status,
	});
	return { ...base, ok: true };
}

export interface DecisionSendResult {
	submissionId: string;
	ok: boolean;
	to?: string;
	/** True when the idempotency key already covered this send (no new email). */
	deduped?: boolean;
	reason?: string;
}

/**
 * The EXPLICIT decision notification — never triggered by a status change.
 * Sends the event's accept/decline template to one recipient per submission
 * (primary speaker contact, falling back to the submitter account) as
 * transactional mail, and stamps `notifiedAt` on newly notified rows.
 *
 * `idempotencyKey` comes from the submitting form (minted at render): a
 * double-submit replays the same key and dedupes to zero extra emails, while
 * a deliberate later re-send (fresh page, fresh key) goes out again.
 *
 * Accept emails attach an .ics — exact times when the session is scheduled,
 * otherwise a save-the-date hold spanning the event that later schedule
 * updates revise in place (stable UID via `icsUidForSubmission`, SEQUENCE
 * increments on updates).
 */
export async function sendDecisionEmails(
	db: Db,
	env: Env,
	opts: {
		event: typeof events.$inferSelect;
		rows: Submission[];
		decision: "accept" | "decline";
		idempotencyKey: string;
	},
): Promise<DecisionSendResult[]> {
	const { event, rows, decision, idempotencyKey } = opts;
	if (rows.length === 0) return [];

	const [template] = await db
		.select()
		.from(emailTemplates)
		.where(
			and(
				eq(emailTemplates.eventId, event.id),
				eq(emailTemplates.key, decision),
			),
		)
		.limit(1);
	if (!template) {
		throw new Error(
			`The "${decision}" email template is missing for this event — create it under Email Templates before sending decisions.`,
		);
	}

	const ids = rows.map((r) => r.id);
	const speakerRows = await db
		.select({
			submissionId: participants.submissionId,
			email: contacts.email,
		})
		.from(participants)
		.innerJoin(contacts, eq(contacts.id, participants.contactId))
		.where(
			and(
				inArray(participants.submissionId, ids),
				eq(participants.role, "speaker"),
			),
		)
		.orderBy(desc(participants.isPrimary), asc(participants.position));

	const submitterIds = [
		...new Set(rows.map((r) => r.submitterId).filter((v): v is string => !!v)),
	];
	const submitterRows = submitterIds.length
		? await db
				.select({ id: users.id, email: users.email })
				.from(users)
				.where(inArray(users.id, submitterIds))
		: [];
	const submitterEmail = new Map(submitterRows.map((u) => [u.id, u.email]));

	const roomIds = [
		...new Set(rows.map((r) => r.roomId).filter((v): v is string => !!v)),
	];
	const roomRows = roomIds.length
		? await db
				.select({ id: rooms.id, name: rooms.name })
				.from(rooms)
				.where(inArray(rooms.id, roomIds))
		: [];
	const roomName = new Map(roomRows.map((r) => [r.id, r.name]));

	const sender = getEmailSender(env);
	const results: DecisionSendResult[] = [];
	const newlyNotified: string[] = [];
	for (const row of rows) {
		const to =
			speakerRows.find((s) => s.submissionId === row.id)?.email ??
			(row.submitterId ? submitterEmail.get(row.submitterId) : undefined);
		if (!to) {
			results.push({
				submissionId: row.id,
				ok: false,
				reason: "No speaker or submitter email on this submission.",
			});
			continue;
		}
		const room = row.roomId ? roomName.get(row.roomId) : undefined;
		const result = await sender.send({
			to,
			replyTo: template.replyTo ?? undefined,
			subject: template.subject,
			html: template.bodyHtml + decisionDetailsHtml(row, event, decision, room),
			ics:
				decision === "accept" ? buildDecisionIcs(row, event, room) : undefined,
			dedupeKey: `decision:${idempotencyKey}:${row.id}`,
			eventId: event.id,
			templateId: template.id,
			kind: "transactional",
		});
		if (!result.deduped) newlyNotified.push(row.id);
		track("email.decision_sent", {
			submissionId: row.id,
			eventId: event.id,
			decision,
			deduped: result.deduped,
		});
		results.push({
			submissionId: row.id,
			ok: true,
			to,
			deduped: result.deduped,
		});
	}
	if (newlyNotified.length) {
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(inArray(submissions.id, newlyNotified));
	}
	return results;
}

/** Stable calendar identity per submission — schedule updates reuse it and bump SEQUENCE so clients revise the entry instead of duplicating it. */
export function icsUidForSubmission(submissionId: string): string {
	return `submission-${submissionId}@openrostrum`;
}

function buildDecisionIcs(
	row: Submission,
	event: typeof events.$inferSelect,
	room: string | undefined,
): string | undefined {
	const scheduled = Boolean(row.startsAt && row.endsAt);
	const start = scheduled ? row.startsAt : event.startsAt;
	const end = scheduled ? row.endsAt : event.endsAt;
	if (!start || !end) return undefined;
	const { error, value } = createEvent({
		title: scheduled
			? `${row.title} — ${event.name}`
			: `${event.name} (save the date): ${row.title}`,
		start: icsDateArray(start),
		end: icsDateArray(end),
		startInputType: "utc",
		endInputType: "utc",
		uid: icsUidForSubmission(row.id),
		sequence: 0,
		location: (scheduled ? room : undefined) ?? event.location ?? undefined,
		status: "CONFIRMED",
	});
	if (error || !value) {
		track("email.ics_build_failed", {
			submissionId: row.id,
			eventId: row.eventId,
			error: error?.message ?? "empty ics output",
		});
		return undefined;
	}
	return value;
}

function icsDateArray(d: Date): [number, number, number, number, number] {
	return [
		d.getUTCFullYear(),
		d.getUTCMonth() + 1,
		d.getUTCDate(),
		d.getUTCHours(),
		d.getUTCMinutes(),
	];
}

/**
 * Appended below the organizer's template body so the recipient knows WHICH
 * submission the decision covers (a speaker can have several in flight).
 */
function decisionDetailsHtml(
	row: Submission,
	event: typeof events.$inferSelect,
	decision: "accept" | "decline",
	room: string | undefined,
): string {
	const lines = [`<p><strong>Session:</strong> ${escapeHtml(row.title)}</p>`];
	if (decision === "accept") {
		if (row.startsAt && row.endsAt) {
			const when = `${formatInTimezone(row.startsAt, event.timezone)} – ${formatInTimezone(row.endsAt, event.timezone, true)}`;
			lines.push(
				`<p><strong>When:</strong> ${escapeHtml(when)}${room ? ` · ${escapeHtml(room)}` : ""}</p>`,
			);
		} else {
			lines.push(
				"<p><strong>When:</strong> schedule to be announced — you'll receive a calendar update once your session is placed.</p>",
			);
		}
	}
	return `<hr>${lines.join("")}`;
}

function formatInTimezone(d: Date, timeZone: string, timeOnly = false): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone,
			...(timeOnly
				? { timeStyle: "short" }
				: { dateStyle: "medium", timeStyle: "short" }),
		}).format(d);
	} catch {
		return d.toISOString();
	}
}

function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
