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
import { icsUidForSubmission } from "~/domain/accept";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { escapeHtml } from "~/lib/html";
import { buildIcs, parseIcsAttachment } from "~/lib/ics";
import { track } from "~/lib/track";
import { getEmailSender } from "~/ports/email";

/**
 * Schedule-update notifications. The decision email attaches an .ics per
 * submission (a real slot, or a save-the-date hold); when the agenda later
 * moves that session — the NORMAL order is accept first, schedule after —
 * the speaker's calendar goes stale unless a new payload with the same UID
 * and a HIGHER SEQUENCE reaches them. The `email_outbox` ledger (every sent
 * invite, verbatim) is the source of truth for what each speaker's calendar
 * last received, so detection can never disagree with what was actually sent.
 */

type EventRow = typeof events.$inferSelect;

/** What the speaker's calendar should say NOW (already the save-the-date
 * fallback when the session lost its slot). */
type DesiredInvite = {
	title: string;
	start: Date;
	end: Date;
	location: string | null;
};

export type ScheduleChange = {
	submissionId: string;
	submissionTitle: string;
	invite: DesiredInvite;
	/** Last sent SEQUENCE + 1 — what the update email must carry. */
	nextSequence: number;
};

/** Mirrors buildDecisionIcs in accept.ts: exact times when scheduled,
 * otherwise an event-wide hold — both under the submission's stable UID. */
function desiredInvite(
	row: {
		title: string;
		startsAt: Date | null;
		endsAt: Date | null;
		roomId: string | null;
	},
	event: EventRow,
	roomName: ReadonlyMap<string, string>,
): DesiredInvite | null {
	if (row.startsAt && row.endsAt) {
		return {
			title: `${row.title} — ${event.name}`,
			start: row.startsAt,
			end: row.endsAt,
			location:
				(row.roomId ? roomName.get(row.roomId) : undefined) ??
				event.location ??
				null,
		};
	}
	if (!event.startsAt || !event.endsAt) return null;
	return {
		title: `${event.name} (save the date): ${row.title}`,
		start: event.startsAt,
		end: event.endsAt,
		location: event.location ?? null,
	};
}

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

	// The ledger: every invite this event ever attached, narrowed to the ics
	// column (html is the heavy one). Bounded by event size — an event sends
	// O(sessions) decision emails plus O(changes) updates. Only rows the
	// provider took count ("bounced" counts too: re-sending to a bouncing
	// address would loop); a "failed" attempt never reached a calendar, so it
	// must not advance the ledger.
	const ledgerRows = await db
		.select({ ics: emailOutbox.icsAttachment })
		.from(emailOutbox)
		.where(
			and(
				eq(emailOutbox.eventId, event.id),
				isNotNull(emailOutbox.icsAttachment),
				inArray(emailOutbox.status, ["sent", "bounced"]),
			),
		);
	if (ledgerRows.length === 0) return [];
	// Highest SEQUENCE per UID wins — the revision counter IS the version, so
	// same-second outbox rows can't scramble "latest".
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
		const invite = desiredInvite(row, event, roomName);
		if (!invite) continue;
		const unchanged =
			last.start.getTime() === invite.start.getTime() &&
			last.end.getTime() === invite.end.getTime() &&
			(last.location ?? null) === (invite.location ?? null);
		if (unchanged) continue;
		changes.push({
			submissionId: row.id,
			submissionTitle: row.title,
			invite,
			nextSequence: last.sequence + 1,
		});
	}
	return changes;
}

/** Per-send cap shared with the decision sender — the ledger advances with
 * each batch, so a further click sends the next slice. */
export const SCHEDULE_UPDATE_BATCH_LIMIT = 100;

export type ScheduleUpdateSendResult = {
	sent: number;
	deduped: number;
	failed: number;
	/** Changes beyond the batch cap — still pending after this call. */
	remaining: number;
};

function updateEmailHtml(
	change: ScheduleChange,
	event: EventRow,
	scheduled: boolean,
): string {
	const when = formatScheduleRange(
		change.invite.start,
		change.invite.end,
		event.timezone,
	);
	const lines = [
		`<p>The schedule for your session at ${escapeHtml(event.name)} has been updated.</p>`,
		`<p><strong>Session:</strong> ${escapeHtml(change.submissionTitle)}</p>`,
	];
	if (scheduled) {
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
 * Send the update emails for `changes` (first batch of ≤100). Transactional —
 * a schedule change is about the recipient's own session, so it always
 * delivers. Same recipient rule as the decision email: primary speaker
 * contact, submitter account fallback. The dedupe key carries the SEQUENCE:
 * a double-click can't send the same revision twice, while the next real
 * change (higher sequence) always delivers.
 */
export async function sendScheduleUpdates(
	db: Db,
	env: Env,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<ScheduleUpdateSendResult> {
	const batch = changes.slice(0, SCHEDULE_UPDATE_BATCH_LIMIT);
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
			.select({ id: users.id, submissionId: submissions.id })
			.from(submissions)
			.innerJoin(users, eq(users.id, submissions.submitterId))
			.where(inArray(submissions.id, ids)),
	]);
	const submitterEmailBySubmission = new Map<string, string>();
	if (submitterRows.length > 0) {
		const userRows = await db
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(inArray(users.id, [...new Set(submitterRows.map((r) => r.id))]));
		const byUser = new Map(userRows.map((u) => [u.id, u.email]));
		for (const r of submitterRows) {
			const email = byUser.get(r.id);
			if (email) submitterEmailBySubmission.set(r.submissionId, email);
		}
	}

	const scheduledSet = new Set(
		(
			await db
				.select({ id: submissions.id })
				.from(submissions)
				.where(
					and(inArray(submissions.id, ids), isNotNull(submissions.startsAt)),
				)
		).map((r) => r.id),
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
			submitterEmailBySubmission.get(change.submissionId);
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
				},
			],
		});
		try {
			const sent = await sender.send({
				to,
				subject: `Schedule update: ${change.submissionTitle} — ${event.name}`,
				html: updateEmailHtml(
					change,
					event,
					scheduledSet.has(change.submissionId),
				),
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
