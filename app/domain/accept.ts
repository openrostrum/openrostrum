import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "~/db";
import { DECISION_STATUS, SUBMISSION_STATUS } from "~/db/constants";
import {
	contacts,
	emailTemplates,
	events,
	forms,
	participants,
	rooms,
	type Submission,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "~/db/schema";
import { normalizeEmail } from "~/lib/auth";
import { formatInTimeZone } from "~/lib/dates";
import { type MergeTag, renderBody, renderSubject } from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { buildIcs } from "~/lib/ics";
import { emailOrigin, firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { track } from "~/lib/track";
import { type EmailResult, getEmailSender } from "~/ports/email";

/**
 * The accept/decline spine — the ONE code path for every submission decision
 * (admin inline flip, bulk edit, compat API, Airtable-inbound). Caller
 * contract: pass rows you already fetched, authorized, and scoped to your
 * tenant boundary — the spine takes no org/event parameter and must never
 * receive a row the caller wasn't allowed to touch. Status changes NEVER
 * send email; `sendDecisionEmails` is the separate, explicit notification.
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
 * `draft` rows are pre-submission and can never receive a decision; every
 * other status (including `withdrawn`, whose resolutions are decline or
 * undo) may take any decision status, and a same-status re-apply is legal.
 */
export function canReceiveDecision(
	from: SubmissionStatus,
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
 * Transition rows to a decision status — single or bulk, one code path;
 * illegal rows are skipped and reported per-row. On `accepted` it also
 * provisions the speaker side (see `planAcceptProvisioning`); leaving
 * `accepted` never un-provisions. Leaving `withdrawn` clears the withdrawal
 * metadata ONLY on a genuine undo — the decline path (`decline_queue`,
 * `declined`) keeps who/when/why as the record of why it ended declined.
 * All writes per call run in one `db.batch`.
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
		const check = canReceiveDecision(row.status);
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
		const set: Partial<typeof submissions.$inferInsert> = {};
		if (row.status !== to) {
			set.status = to;
			set.statusChangedAt = now;
		}
		if (
			row.status === "withdrawn" &&
			to !== "declined" &&
			to !== "decline_queue"
		) {
			set.withdrawnAt = null;
			set.withdrawnById = null;
			set.withdrawnReason = null;
		}
		if (to === "accepted" && row.contentStatus === "draft") {
			set.contentStatus = "in_review";
		}
		if (Object.keys(set).length) {
			statements.push(
				db.update(submissions).set(set).where(eq(submissions.id, row.id)),
			);
		}
	}

	const provisioning =
		to === "accepted" ? await planAcceptProvisioning(db, legal, now) : null;
	if (provisioning) statements.push(...provisioning.statements);

	if (statements.length) {
		await db.batch(
			statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
		);
	}

	// A same-status re-apply is legal (it re-runs provisioning) but is not a
	// transition — the event stream must record only real changes.
	for (const row of legal.filter((r) => r.status !== to)) {
		track("submission.status_changed", {
			submissionId: row.id,
			eventId: row.eventId,
			from: row.status,
			to,
		});
	}
	provisioning?.emitEvents();
	return results;
}

interface ProvisioningPlan {
	statements: BatchItem<"sqlite">[];
	/** Deferred so events fire only after the batch commits. */
	emitEvents: () => void;
}

/**
 * Accept-time provisioning: link speaker contacts to existing accounts by
 * normalized email (never mints users, never emails — the invite flow is the
 * explicit path that creates accounts), and mint onboarding task assignments
 * for every speaker-role contact. Idempotency mirrors the two partial unique
 * indexes on task_assignments: contact-scoped tasks exist once per (task,
 * contact) and are shared across a speaker's submissions; submission-scoped
 * tasks exist once per (task, contact, submission), so a multi-talk speaker
 * gets one e.g. slides-upload assignment PER accepted submission. Replaying
 * an accept mints nothing; submission-scoped true duplicates are surfaced
 * via `accept.assignment_skipped`. Group-type tasks have no assignable
 * target (no group model) and are never minted.
 */
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

	const speakerContactIds = [...new Set(speakerRows.map((s) => s.contactId))];
	const existing =
		taskDefs.length && speakerContactIds.length
			? await db
					.select({
						taskId: taskAssignments.taskId,
						contactId: taskAssignments.contactId,
						submissionId: taskAssignments.submissionId,
					})
					.from(taskAssignments)
					.where(
						and(
							inArray(
								taskAssignments.taskId,
								taskDefs.map((t) => t.id),
							),
							inArray(taskAssignments.contactId, speakerContactIds),
						),
					)
			: [];
	// Key per idempotency scope: (task, contact) when submission_id is NULL,
	// (task, contact, submission) otherwise — the same split as the partial
	// unique indexes.
	const scopeKey = (
		taskId: string,
		contactId: string | null,
		submissionId: string | null,
	) =>
		submissionId === null
			? `${taskId}:${contactId}`
			: `${taskId}:${contactId}:${submissionId}`;
	const existingKeys = new Set(
		existing.map((e) => scopeKey(e.taskId, e.contactId, e.submissionId)),
	);

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

	const statements: BatchItem<"sqlite">[] = [];
	const linkedContactIds = new Set<string>();
	for (const [contactId, email] of unlinkedByContact) {
		const userId = userByEmail.get(normalizeEmail(email));
		if (!userId) continue;
		linkedContactIds.add(contactId);
		statements.push(
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
	const planned = new Set(existingKeys);
	type Skip = {
		submissionId: string;
		eventId: string;
		taskId: string;
		contactId: string;
	};
	const skips: Skip[] = [];
	const perSubmission = new Map<
		string,
		{ speakers: number; assignmentsPlanned: number; contactsLinked: number }
	>();
	for (const row of rows) {
		const speakers = speakerRows.filter((s) => s.submissionId === row.id);
		const stats = {
			speakers: speakers.length,
			assignmentsPlanned: 0,
			contactsLinked: speakers.filter((s) => linkedContactIds.has(s.contactId))
				.length,
		};
		perSubmission.set(row.id, stats);
		for (const def of tasksByEvent.get(row.eventId) ?? []) {
			if (def.type === "group") continue;
			for (const speaker of speakers) {
				const submissionId = def.type === "submission" ? row.id : null;
				const key = scopeKey(def.id, speaker.contactId, submissionId);
				if (planned.has(key)) {
					// The identical assignment already exists (or is planned by this
					// very batch) — a true duplicate, never a lost mint. Contact-scoped
					// tasks are shared across a speaker's submissions by design and
					// stay silent; submission-scoped replays are surfaced.
					if (submissionId !== null) {
						skips.push({
							submissionId: row.id,
							eventId: row.eventId,
							taskId: def.id,
							contactId: speaker.contactId,
						});
					}
					continue;
				}
				planned.add(key);
				stats.assignmentsPlanned += 1;
				values.push({
					taskId: def.id,
					contactId: speaker.contactId,
					submissionId,
					status: "incomplete",
					dueAt:
						def.dueInDays == null
							? null
							: new Date(now.getTime() + def.dueInDays * 86_400_000),
				});
			}
		}
	}
	if (values.length) {
		statements.push(
			db
				.insert(taskAssignments)
				.values(values)
				// Race guard only — the pre-read above already excluded known rows.
				// Targetless because the conflict may land on either partial unique
				// index, and SQLite's ON CONFLICT target cannot address them without
				// repeating their WHERE clauses.
				.onConflictDoNothing(),
		);
	}

	return {
		statements,
		emitEvents() {
			for (const row of rows) {
				track("accept.provisioned", {
					submissionId: row.id,
					eventId: row.eventId,
					...perSubmission.get(row.id),
				});
			}
			for (const skip of skips) track("accept.assignment_skipped", skip);
		},
	};
}

/**
 * Null `byUserId` = system-initiated withdrawal (e.g. row deleted in the
 * team's Airtable base); the reason is a mandatory record. Unschedules the
 * session; content columns stay untouched.
 */
export async function withdrawSubmission(
	db: Db,
	opts: { submission: Submission; byUserId: string | null; reason: string },
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

/** Product state, not an infrastructure failure — callers show it verbatim. */
export class MissingTemplateError extends Error {
	constructor(decision: "accept" | "decline") {
		super(
			`The "${decision}" email template is missing for this event — create it under Email Templates before sending decisions.`,
		);
		this.name = "MissingTemplateError";
	}
}

/**
 * The EXPLICIT decision notification — never triggered by a status change.
 * One transactional email per submission (primary speaker contact, fallback
 * submitter account) from the event's accept/decline template, with an .ics
 * on accept (exact times when scheduled, otherwise a save-the-date hold that
 * later schedule updates revise in place via the stable UID). `idempotencyKey`
 * is minted by the submitting form: a double-submit dedupes, a fresh page is
 * a deliberate re-send. Stamps `notifiedAt`; a deduped result proves a prior
 * send, so it back-fills a missing stamp (partial-failure retry). Treat
 * `notifiedAt` as a dispatch flag — the outbox row's `sentAt` is the
 * authoritative send time. Refuses more than 100 rows per call (the per-send
 * cap every caller inherits).
 */
export async function sendDecisionEmails(
	db: Db,
	env: Env,
	opts: {
		event: typeof events.$inferSelect;
		rows: Submission[];
		decision: "accept" | "decline";
		idempotencyKey: string;
		/** Request origin for {{portal_link}}; omitted → APP_ORIGIN fallback. */
		origin?: string | null;
	},
): Promise<DecisionSendResult[]> {
	const { event, rows, decision, idempotencyKey } = opts;
	if (rows.length === 0) return [];
	if (rows.length > 100) {
		throw new Error(
			"Decision emails go out in batches of up to 100 — narrow the selection.",
		);
	}

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
	if (!template) throw new MissingTemplateError(decision);

	const ids = rows.map((r) => r.id);
	const speakerRows = await db
		.select({
			submissionId: participants.submissionId,
			email: contacts.email,
			firstName: contacts.firstName,
			lastName: contacts.lastName,
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
				.select({ id: users.id, email: users.email, name: users.name })
				.from(users)
				.where(inArray(users.id, submitterIds))
		: [];
	const submitterById = new Map(submitterRows.map((u) => [u.id, u]));

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

	const formIds = [
		...new Set(rows.map((r) => r.formId).filter((v): v is string => !!v)),
	];
	const formRows = formIds.length
		? await db
				.select({
					id: forms.id,
					externalTitle: forms.externalTitle,
					closeAt: forms.closeAt,
				})
				.from(forms)
				.where(inArray(forms.id, formIds))
		: [];
	const formById = new Map(formRows.map((f) => [f.id, f]));

	const origin = opts.origin ?? emailOrigin(env);
	const portalPublicId = (await firstPortalsByEvent(db, event.id)).get(
		event.id,
	);
	const portalLink =
		origin && portalPublicId
			? portalUrl(origin, event.slug, portalPublicId)
			: null;

	const sender = getEmailSender(env);
	const results: DecisionSendResult[] = [];
	const newlySent: string[] = [];
	const dedupedIds: string[] = [];
	for (const row of rows) {
		const speaker = speakerRows.find((s) => s.submissionId === row.id);
		const submitter = row.submitterId
			? submitterById.get(row.submitterId)
			: undefined;
		const to = speaker?.email ?? submitter?.email;
		if (!to) {
			results.push({
				submissionId: row.id,
				ok: false,
				reason: "No speaker or submitter email on this submission.",
			});
			continue;
		}
		const room = row.roomId ? roomName.get(row.roomId) : undefined;
		// The SAME renderer the template editor previews with — a sent email must
		// never carry a literal {{merge_tag}} the preview showed resolved.
		// Speaker names stay structured (splitting would mangle "Mary Jane");
		// only the submitter fallback needs a split — users.name is one field.
		const [subFirst = "", ...subRest] = (submitter?.name ?? "")
			.trim()
			.split(/\s+/);
		const firstName = speaker ? speaker.firstName : subFirst;
		const lastName = speaker ? speaker.lastName : subRest.join(" ");
		const form = row.formId ? formById.get(row.formId) : undefined;
		// Full Record, not MergeContext (Partial): a tag added to MERGE_TAGS must
		// fail compilation HERE, or it renders resolved in the editor preview and
		// blank in the delivered email.
		const ctx: Record<MergeTag, string | null> = {
			first_name: firstName,
			last_name: lastName,
			full_name: `${firstName} ${lastName}`.trim(),
			email: to,
			event_name: event.name,
			session_title: row.title,
			session_date_time: row.startsAt
				? formatInTimeZone(row.startsAt, event.timezone)
				: null,
			session_room: room ?? null,
			portal_link: portalLink,
			form_title: form?.externalTitle ?? null,
			form_close_date: form?.closeAt
				? formatInTimeZone(form.closeAt, event.timezone)
				: null,
		};
		let result: EmailResult;
		try {
			result = await sender.send({
				to,
				replyTo: template.replyTo ?? undefined,
				subject: renderSubject(template.subject, ctx),
				html:
					renderBody(template.bodyHtml, ctx) +
					decisionDetailsHtml(row, event, decision, room),
				ics:
					decision === "accept"
						? buildDecisionIcs(row, event, room)
						: undefined,
				// The decision is part of the identity: an accept then a corrective
				// decline on the SAME untouched selection must both deliver.
				dedupeKey: `decision:${decision}:${idempotencyKey}:${row.id}`,
				eventId: event.id,
				templateId: template.id,
				kind: "transactional",
			});
		} catch (error) {
			// One undeliverable recipient must not sink the batch: the rest still
			// send and finalize, this row stays un-finalized and is reported
			// per-row (provider detail stays in Email history, not the UI).
			track("email.decision_send_failed", {
				submissionId: row.id,
				eventId: event.id,
				decision,
				error: errorMessage(error),
			});
			results.push({
				submissionId: row.id,
				ok: false,
				to,
				reason: `Sending to ${to} failed — see Email history for the reason, then retry.`,
			});
			continue;
		}
		(result.deduped ? dedupedIds : newlySent).push(row.id);
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
	const now = new Date();
	if (newlySent.length) {
		await db
			.update(submissions)
			.set({ notifiedAt: now })
			.where(inArray(submissions.id, newlySent));
	}
	if (dedupedIds.length) {
		await db
			.update(submissions)
			.set({ notifiedAt: now })
			.where(
				and(
					inArray(submissions.id, dedupedIds),
					isNull(submissions.notifiedAt),
				),
			);
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
	return buildIcs({
		calendarName: event.name,
		events: [
			{
				uid: icsUidForSubmission(row.id),
				start,
				end,
				title: scheduled
					? `${row.title} — ${event.name}`
					: `${event.name} (save the date): ${row.title}`,
				location: (scheduled ? room : undefined) ?? event.location ?? undefined,
			},
		],
	});
}

/** Appended below the template body so the recipient knows WHICH submission the decision covers (a speaker can have several in flight). */
function decisionDetailsHtml(
	row: Submission,
	event: typeof events.$inferSelect,
	decision: "accept" | "decline",
	room: string | undefined,
): string {
	const lines = [`<p><strong>Session:</strong> ${escapeHtml(row.title)}</p>`];
	if (decision === "accept") {
		const when = formatScheduleRange(row.startsAt, row.endsAt, event.timezone);
		if (when) {
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

function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
