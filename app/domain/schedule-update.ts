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
	icsForInvites,
	icsUidForSubmission,
	inviteForSubmission,
	type SubmissionInvite,
} from "~/domain/accept";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { escapeHtml } from "~/lib/html";
import { parseIcsAttachment } from "~/lib/ics";
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
	/** Primary speaker (submitter fallback) — null when nobody is emailable. */
	to: string | null;
};

export type ScheduleChangeSet = {
	changes: ScheduleChange[];
	/** Distinct emailable recipients — the "N speakers" the agenda banner shows. */
	speakers: number;
	/** The ledger scan hit its cap — some stale calendars may not be counted. */
	truncated: boolean;
};

const EMPTY: ScheduleChangeSet = { changes: [], speakers: 0, truncated: false };

/** Newest rows first + max-SEQUENCE-per-UID keeps truncation safe: a UID whose
 * invites all fell outside the window reads as never-invited (skipped), never
 * as a spurious change — and `truncated` lets the UI say so. */
const LEDGER_SCAN_LIMIT = 1000;

/**
 * Every accepted, already-notified submission whose current slot differs from
 * the last invite in the outbox ledger, with its recipient resolved. Rows
 * never notified are skipped — their decision email will carry the schedule.
 */
export async function computeScheduleChanges(
	db: Db,
	event: EventRow,
): Promise<ScheduleChangeSet> {
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
	if (candidates.length === 0) return EMPTY;

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
	const truncated = ledgerRows.length === LEDGER_SCAN_LIMIT;
	if (ledgerRows.length === 0) return { ...EMPTY, truncated };
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

	const changed: Omit<ScheduleChange, "to">[] = [];
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
		changed.push({
			submissionId: row.id,
			submissionTitle: row.title,
			scheduled: Boolean(row.startsAt && row.endsAt),
			invite,
			nextSequence: last.sequence + 1,
		});
	}
	if (changed.length === 0) return { ...EMPTY, truncated };

	// Same recipient rule as the decision email: primary speaker first,
	// submitter account as fallback.
	const ids = changed.map((c) => c.submissionId);
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
	const changes: ScheduleChange[] = changed.map((c) => ({
		...c,
		to:
			speakerRows.find((s) => s.submissionId === c.submissionId)?.email ??
			submitterEmail.get(c.submissionId) ??
			null,
	}));
	const speakers = new Set(
		changes.flatMap((c) => (c.to === null ? [] : [c.to])),
	).size;
	return { changes, speakers, truncated };
}

export type ScheduleUpdateSendResult = {
	/** Units are EMAILS (one per speaker), not sessions. */
	sent: number;
	deduped: number;
	failed: number;
	/** Speakers beyond the batch cap — still pending after this call. */
	remaining: number;
};

function sessionBlockHtml(change: ScheduleChange, event: EventRow): string {
	const lines = [
		`<p><strong>Session:</strong> ${escapeHtml(change.submissionTitle)}</p>`,
	];
	if (change.scheduled) {
		const when = formatScheduleRange(
			change.invite.start,
			change.invite.end,
			event.timezone,
		);
		lines.push(`<p><strong>When:</strong> ${escapeHtml(when ?? "")}</p>`);
		if (change.invite.location) {
			lines.push(
				`<p><strong>Where:</strong> ${escapeHtml(change.invite.location)}</p>`,
			);
		}
	} else {
		lines.push(
			"<p>This session's exact time slot is being rearranged — the attached invite holds the event dates until the new slot is confirmed.</p>",
		);
	}
	return lines.join("");
}

function updateEmailHtml(
	items: readonly ScheduleChange[],
	event: EventRow,
): string {
	const plural = items.length !== 1;
	return [
		`<p>The schedule for ${plural ? `${items.length} of your sessions` : "your session"} at ${escapeHtml(event.name)} has been updated.</p>`,
		...items.map((c) => sessionBlockHtml(c, event)),
		`<p>The attached calendar invite updates the previous ${plural ? "entries" : "entry"} in place.</p>`,
	].join("");
}

/**
 * One update email PER SPEAKER (an afternoon of drag-and-drop must never fire
 * an email per move — nor one per session): all of a recipient's changed
 * sessions ride in one message whose .ics carries one VEVENT per session,
 * same UID + SEQUENCE+1 each. The dedupe key encodes every (submission,
 * revision) in the email, so a double-click can't re-send while the next real
 * change always delivers. First EMAIL_BATCH_LIMIT speakers per call.
 */
export async function sendScheduleUpdates(
	db: Db,
	env: Env,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<ScheduleUpdateSendResult> {
	const result: ScheduleUpdateSendResult = {
		sent: 0,
		deduped: 0,
		failed: 0,
		remaining: 0,
	};
	const byRecipient = new Map<string, ScheduleChange[]>();
	for (const change of changes) {
		if (change.to === null) {
			// No speaker or submitter email — surfaced as a failure, not skipped
			// silently; the row stays flagged for a later retry.
			result.failed += 1;
			continue;
		}
		const list = byRecipient.get(change.to) ?? [];
		list.push(change);
		byRecipient.set(change.to, list);
	}
	const recipients = [...byRecipient.keys()].sort();
	const batch = recipients.slice(0, EMAIL_BATCH_LIMIT);
	result.remaining = recipients.length - batch.length;

	const sender = getEmailSender(env);
	for (const to of batch) {
		const items = (byRecipient.get(to) ?? []).sort((a, b) =>
			a.submissionId.localeCompare(b.submissionId),
		);
		const first = items[0];
		if (!first) continue;
		const ics = icsForInvites(
			event,
			items.map((c) => ({
				submissionId: c.submissionId,
				invite: c.invite,
				sequence: c.nextSequence,
			})),
		);
		const revisionKey = items
			.map((c) => `${c.submissionId}@${c.nextSequence}`)
			.join(",");
		try {
			const sent = await sender.send({
				to,
				subject:
					items.length === 1
						? `Schedule update: ${first.submissionTitle} — ${event.name}`
						: `Schedule updates: ${items.length} of your sessions — ${event.name}`,
				html: updateEmailHtml(items, event),
				ics,
				dedupeKey: `schedule-update:${revisionKey}`,
				eventId: event.id,
				kind: "transactional",
			});
			if (sent.deduped) result.deduped += 1;
			else result.sent += 1;
			track("email.schedule_update_sent", {
				eventId: event.id,
				sessions: items.length,
				deduped: sent.deduped,
			});
		} catch (error) {
			// One undeliverable recipient must not sink the batch — their rows stay
			// detected as changed and a retry click re-sends them.
			result.failed += 1;
			track("email.schedule_update_failed", {
				eventId: event.id,
				sessions: items.length,
				error: errorMessage(error),
			});
		}
	}
	return result;
}
