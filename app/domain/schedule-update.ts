import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "~/db";
import {
	contacts,
	emailOutbox,
	type events,
	participants,
	rooms,
	submissions,
	users,
} from "~/db/schema";
import {
	EMAIL_BATCH_LIMIT,
	icsUidForSubmission,
	inviteForSubmission,
	type SubmissionInvite,
} from "~/domain/accept";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { escapeHtml } from "~/lib/html";
import { buildIcs, parseIcsAttachment } from "~/lib/ics";
import { track } from "~/lib/track";
import { getEmailSender } from "~/ports/email";

/**
 * Schedule-update notifications: when the agenda moves an already-invited
 * session (accept first, schedule after is the NORMAL order), the speaker's
 * calendar goes stale unless the same UID reaches them with a higher SEQUENCE.
 * The outbox ledger — every invite actually sent — is the detection baseline.
 */

type EventRow = typeof events.$inferSelect;

export type ScheduleChange = {
	submissionId: string;
	submissionTitle: string;
	/** False = the session lost its slot; the invite is the event-wide hold. */
	scheduled: boolean;
	invite: SubmissionInvite;
	/** Last sent SEQUENCE + 1 — what the update email must carry. */
	nextSequence: number;
};

/** Newest rows first + max-SEQUENCE-per-UID keeps truncation safe: a UID whose
 * invites all fell outside the window reads as never-invited (skipped), never
 * as a spurious change. */
const LEDGER_SCAN_LIMIT = 1000;

/**
 * Every accepted, already-notified submission whose current slot differs from
 * the last invite in the outbox ledger. Never-notified rows are skipped — the
 * decision email itself will carry their current schedule when it goes out.
 */
export async function computeScheduleChanges(
	db: Db,
	event: EventRow,
): Promise<ScheduleChange[]> {
	const candidates = await db
		.select({
			id: submissions.id,
			title: submissions.title,
			startsAt: submissions.startsAt,
			endsAt: submissions.endsAt,
			roomId: submissions.roomId,
		})
		.from(submissions)
		.where(
			and(
				eq(submissions.eventId, event.id),
				eq(submissions.status, "accepted"),
				isNotNull(submissions.notifiedAt),
				isNull(submissions.parentId),
			),
		);
	if (candidates.length === 0) return [];

	// Narrowed to the ics column (html is the heavy one) and capped. A "failed"
	// attempt never reached a calendar so it must not advance the ledger;
	// "bounced" counts — re-sending to a bouncing address would loop.
	const ledgerRows = await db
		.select({ ics: emailOutbox.icsAttachment })
		.from(emailOutbox)
		.where(
			and(
				eq(emailOutbox.eventId, event.id),
				isNotNull(emailOutbox.icsAttachment),
				inArray(emailOutbox.status, ["sent", "bounced"]),
			),
		)
		.orderBy(desc(emailOutbox.createdAt))
		.limit(LEDGER_SCAN_LIMIT);
	if (ledgerRows.length === 0) return [];
	const lastSent = new Map<
		string,
		{ start: Date; end: Date; location: string | null; sequence: number }
	>();
	for (const row of ledgerRows) {
		for (const ev of parseIcsAttachment(row.ics ?? "")) {
			const prior = lastSent.get(ev.uid);
			if (!prior || ev.sequence >= prior.sequence) lastSent.set(ev.uid, ev);
		}
	}

	const roomIds = [
		...new Set(candidates.map((c) => c.roomId).filter((v): v is string => !!v)),
	];
	const roomRows = roomIds.length
		? await db
				.select({ id: rooms.id, name: rooms.name })
				.from(rooms)
				.where(inArray(rooms.id, roomIds))
		: [];
	const roomName = new Map(roomRows.map((r) => [r.id, r.name]));

	const changes: ScheduleChange[] = [];
	for (const row of candidates) {
		const last = lastSent.get(icsUidForSubmission(row.id));
		if (!last) continue;
		const invite = inviteForSubmission(
			row,
			event,
			row.roomId ? roomName.get(row.roomId) : undefined,
		);
		if (!invite) continue;
		const unchanged =
			last.start.getTime() === invite.start.getTime() &&
			last.end.getTime() === invite.end.getTime() &&
			(last.location ?? null) === (invite.location ?? null);
		if (unchanged) continue;
		changes.push({
			submissionId: row.id,
			submissionTitle: row.title,
			scheduled: Boolean(row.startsAt && row.endsAt),
			invite,
			nextSequence: last.sequence + 1,
		});
	}
	return changes;
}

export type ScheduleUpdateSendResult = {
	sent: number;
	deduped: number;
	failed: number;
	/** Changes beyond the batch cap — still pending after this call. */
	remaining: number;
};

function updateEmailHtml(change: ScheduleChange, event: EventRow): string {
	const when = formatScheduleRange(
		change.invite.start,
		change.invite.end,
		event.timezone,
	);
	const lines = [
		`<p>The schedule for your session at ${escapeHtml(event.name)} has been updated.</p>`,
		`<p><strong>Session:</strong> ${escapeHtml(change.submissionTitle)}</p>`,
	];
	if (change.scheduled) {
		lines.push(`<p><strong>When:</strong> ${escapeHtml(when ?? "")}</p>`);
		if (change.invite.location) {
			lines.push(
				`<p><strong>Where:</strong> ${escapeHtml(change.invite.location)}</p>`,
			);
		}
	} else {
		lines.push(
			"<p>Your session's exact time slot is being rearranged — the attached invite holds the event dates until the new slot is confirmed.</p>",
		);
	}
	lines.push(
		"<p>The attached calendar invite updates the previous one in place.</p>",
	);
	return lines.join("");
}

/**
 * Send the update emails for `changes` (first EMAIL_BATCH_LIMIT; the ledger
 * advances per batch, so a further click sends the next slice). Transactional
 * — a schedule change is about the recipient's own session. Same recipient
 * rule as the decision email: primary speaker, submitter account fallback.
 * The dedupe key carries the SEQUENCE: a double-click can't send the same
 * revision twice, while the next real change (higher sequence) delivers.
 */
export async function sendScheduleUpdates(
	db: Db,
	env: Env,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<ScheduleUpdateSendResult> {
	const batch = changes.slice(0, EMAIL_BATCH_LIMIT);
	const remaining = changes.length - batch.length;
	if (batch.length === 0) {
		return { sent: 0, deduped: 0, failed: 0, remaining: 0 };
	}

	const ids = batch.map((c) => c.submissionId);
	const [speakerRows, submitterRows] = await Promise.all([
		db
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
			.orderBy(desc(participants.isPrimary), asc(participants.position)),
		db
			.select({ submissionId: submissions.id, email: users.email })
			.from(submissions)
			.innerJoin(users, eq(users.id, submissions.submitterId))
			.where(inArray(submissions.id, ids)),
	]);
	const submitterEmail = new Map(
		submitterRows.map((r) => [r.submissionId, r.email]),
	);

	const sender = getEmailSender(env);
	const result: ScheduleUpdateSendResult = {
		sent: 0,
		deduped: 0,
		failed: 0,
		remaining,
	};
	for (const change of batch) {
		const to =
			speakerRows.find((s) => s.submissionId === change.submissionId)?.email ??
			submitterEmail.get(change.submissionId);
		if (!to) {
			result.failed += 1;
			continue;
		}
		const ics = buildIcs({
			calendarName: event.name,
			method: "PUBLISH",
			events: [
				{
					uid: icsUidForSubmission(change.submissionId),
					start: change.invite.start,
					end: change.invite.end,
					title: change.invite.title,
					location: change.invite.location ?? undefined,
					sequence: change.nextSequence,
					status: "CONFIRMED",
				},
			],
		});
		try {
			const sent = await sender.send({
				to,
				subject: `Schedule update: ${change.submissionTitle} — ${event.name}`,
				html: updateEmailHtml(change, event),
				ics,
				dedupeKey: `schedule-update:${change.submissionId}:${change.nextSequence}`,
				eventId: event.id,
				kind: "transactional",
			});
			if (sent.deduped) result.deduped += 1;
			else result.sent += 1;
			track("email.schedule_update_sent", {
				submissionId: change.submissionId,
				eventId: event.id,
				sequence: change.nextSequence,
				deduped: sent.deduped,
			});
		} catch (error) {
			// One undeliverable recipient must not sink the batch — the row stays
			// detected as changed and a retry click re-sends it.
			result.failed += 1;
			track("email.schedule_update_failed", {
				submissionId: change.submissionId,
				eventId: event.id,
				error: errorMessage(error),
			});
		}
	}
	return result;
}
