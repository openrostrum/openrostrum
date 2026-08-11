import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	like,
	or,
	sql,
} from "drizzle-orm";
import type { Db } from "~/db";
import { emailOutbox, type events, rooms, submissions } from "~/db/schema";
import {
	EMAIL_BATCH_LIMIT,
	icsForInvites,
	icsUidForSubmission,
	inviteForSubmission,
	inviteRecipients,
	type SubmissionInvite,
} from "~/domain/accept";
import { sha256Hex } from "~/lib/api-token";
import { normalizeEmail } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { escapeHtml } from "~/lib/html";
import { type ParsedIcsEvent, parseIcsAttachment } from "~/lib/ics";
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
	/** Next delivered revision; zero when no calendar attachment has landed yet. */
	nextSequence: number;
	/** Primary speaker (submitter fallback) — null when nobody is emailable. */
	to: string | null;
	/** Latest matching bounce, included in retry identity without advancing SEQUENCE. */
	retryAfterBounceId: string | null;
};

export type ScheduleChangeSet = {
	changes: ScheduleChange[];
	/** Distinct emailable recipients — the "N speakers" the agenda banner shows. */
	speakers: number;
	/** Completeness could not be established — no changes were inferred. */
	truncated: boolean;
};

const EMPTY: ScheduleChangeSet = { changes: [], speakers: 0, truncated: false };

const LEDGER_SCAN_LIMIT = 1000;
const D1_QUERY_CHUNK = 80;

const LEDGER_COLUMNS = {
	id: emailOutbox.id,
	dedupeKey: emailOutbox.dedupeKey,
	to: emailOutbox.to,
	ics: emailOutbox.icsAttachment,
	status: emailOutbox.status,
	createdAt: emailOutbox.createdAt,
	sentAt: emailOutbox.sentAt,
};

type LedgerRow = {
	id: string;
	dedupeKey: string | null;
	to: string;
	ics: string | null;
	status: (typeof emailOutbox.$inferSelect)["status"];
	createdAt: Date;
	sentAt: Date | null;
};

type InviteBaseline = ParsedIcsEvent & { to: string };

const deliveryOrder = () => [
	asc(sql`coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt})`),
	asc(emailOutbox.createdAt),
	asc(emailOutbox.id),
];

async function structuredLedgerRows(
	db: Db,
	eventId: string,
): Promise<LedgerRow[]> {
	return db
		.select(LEDGER_COLUMNS)
		.from(emailOutbox)
		.where(
			and(
				eq(emailOutbox.eventId, eventId),
				inArray(emailOutbox.status, ["sent", "bounced"]),
				or(
					like(emailOutbox.dedupeKey, "decision:accept:%"),
					like(emailOutbox.dedupeKey, "schedule-update:%"),
				),
			),
		)
		.orderBy(...deliveryOrder())
		.limit(LEDGER_SCAN_LIMIT + 1);
}

type ParsedLedgerRow = LedgerRow & {
	invites: ParsedIcsEvent[];
	acceptanceSubmissionId: string | null;
	associatedSubmissionIds: Set<string>;
};

function acceptanceSubmissionId(
	dedupeKey: string | null,
	candidateIds: ReadonlySet<string>,
): string | null {
	if (!dedupeKey?.startsWith("decision:accept:")) return null;
	const submissionId = dedupeKey.slice(dedupeKey.lastIndexOf(":") + 1);
	return candidateIds.has(submissionId) ? submissionId : null;
}

function parseLedgerRows(
	rows: readonly LedgerRow[],
	candidateIds: ReadonlySet<string>,
	candidateByUid: ReadonlyMap<string, string>,
): ParsedLedgerRow[] {
	return rows.map((row) => {
		// Parse once per attachment. All later association and baseline work consumes
		// this projection rather than reparsing multi-VEVENT payloads per candidate.
		const invites = parseIcsAttachment(row.ics ?? "");
		const acceptedId = acceptanceSubmissionId(row.dedupeKey, candidateIds);
		const associatedSubmissionIds = new Set<string>();
		if (acceptedId) associatedSubmissionIds.add(acceptedId);
		for (const invite of invites) {
			const submissionId = candidateByUid.get(invite.uid);
			if (submissionId) associatedSubmissionIds.add(submissionId);
		}
		return {
			...row,
			invites,
			acceptanceSubmissionId: acceptedId,
			associatedSubmissionIds,
		};
	});
}

function inviteHistoryBySubmission(
	rows: readonly ParsedLedgerRow[],
): Map<string, ParsedLedgerRow[]> {
	const history = new Map<string, ParsedLedgerRow[]>();
	for (const row of rows) {
		for (const submissionId of row.associatedSubmissionIds) {
			const prior = history.get(submissionId) ?? [];
			prior.push(row);
			history.set(submissionId, prior);
		}
	}
	return history;
}

function inviteBaselines(
	rows: readonly ParsedLedgerRow[],
	candidateByUid: ReadonlyMap<string, string>,
): Map<string, InviteBaseline> {
	const baselines = new Map<string, InviteBaseline>();
	for (const row of rows) {
		// A bounce proves an attempt, not delivery to a calendar. It must not consume
		// a SEQUENCE that a corrected or recovered recipient still needs to receive.
		if (row.status !== "sent") continue;
		for (const invite of row.invites) {
			const submissionId = candidateByUid.get(invite.uid);
			if (!submissionId) continue;
			const prior = baselines.get(submissionId);
			// Rows arrive in delivery order, so equal revisions deliberately keep the
			// earliest delivered snapshot; only a higher SEQUENCE can replace it.
			if (!prior || invite.sequence > prior.sequence) {
				baselines.set(submissionId, { ...invite, to: row.to });
			}
		}
	}
	return baselines;
}

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

	const recipientById = await inviteRecipients(
		db,
		candidates.map((candidate) => candidate.id),
	);
	const candidateByUid = new Map(
		candidates.map((candidate) => [
			icsUidForSubmission(candidate.id),
			candidate.id,
		]),
	);
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	const ledger = await structuredLedgerRows(db, event.id);
	if (ledger.length > LEDGER_SCAN_LIMIT) {
		return { ...EMPTY, truncated: true };
	}
	const parsedLedger = parseLedgerRows(ledger, candidateIds, candidateByUid);
	const historyBySubmission = inviteHistoryBySubmission(parsedLedger);
	const lastSent = inviteBaselines(parsedLedger, candidateByUid);
	const trackedCandidates = new Set<string>();
	for (const candidate of candidates) {
		const history = historyBySubmission.get(candidate.id);
		// notifiedAt is shared by several notification paths. Only structured
		// acceptance history or an exact stable VEVENT UID proves calendar history.
		if (!history) continue;
		trackedCandidates.add(candidate.id);
		const expectedUid = icsUidForSubmission(candidate.id);
		if (
			history.some(
				(row) =>
					row.acceptanceSubmissionId === candidate.id &&
					row.status === "sent" &&
					row.ics !== null &&
					!row.invites.some((invite) => invite.uid === expectedUid),
			)
		) {
			return { ...EMPTY, truncated: true };
		}
	}

	const roomIds = [
		...new Set(candidates.map((c) => c.roomId).filter((v): v is string => !!v)),
	];
	const roomRows: { id: string; name: string }[] = [];
	for (let offset = 0; offset < roomIds.length; offset += D1_QUERY_CHUNK) {
		roomRows.push(
			...(await db
				.select({ id: rooms.id, name: rooms.name })
				.from(rooms)
				.where(
					inArray(rooms.id, roomIds.slice(offset, offset + D1_QUERY_CHUNK)),
				)),
		);
	}
	const roomName = new Map(roomRows.map((r) => [r.id, r.name]));

	const changes: ScheduleChange[] = [];
	for (const row of candidates) {
		if (!trackedCandidates.has(row.id)) continue;
		const history = historyBySubmission.get(row.id) ?? [];
		const last = lastSent.get(row.id);
		const invite = inviteForSubmission(
			row,
			event,
			row.roomId ? roomName.get(row.roomId) : undefined,
		);
		if (!invite) continue;
		const to = recipientById.get(row.id) ?? null;
		const inviteUnchanged =
			last !== undefined &&
			last.start.getTime() === invite.start.getTime() &&
			last.end.getTime() === invite.end.getTime() &&
			(last.location ?? null) === (invite.location ?? null);
		const recipientUnchanged =
			last !== undefined &&
			to !== null &&
			normalizeEmail(last.to) === normalizeEmail(to);
		if (inviteUnchanged && recipientUnchanged) continue;
		let retryAfterBounceId: string | null = null;
		for (const ledgerRow of history) {
			if (ledgerRow.status === "bounced") retryAfterBounceId = ledgerRow.id;
		}
		changes.push({
			submissionId: row.id,
			submissionTitle: row.title,
			scheduled: Boolean(row.startsAt && row.endsAt),
			invite,
			nextSequence: last ? last.sequence + 1 : 0,
			to,
			retryAfterBounceId,
		});
	}
	if (changes.length === 0) return EMPTY;

	const speakers = new Set(
		changes.flatMap((change) =>
			change.to === null ? [] : [normalizeEmail(change.to)],
		),
	).size;
	return { changes, speakers, truncated: false };
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
 * One message per normalized recipient, with all changed VEVENTs attached.
 * The semantic-state hash dedupes concurrent requests and replays without
 * collapsing a later real revision; bounce row IDs salt retries. Each call
 * sends at most one batch.
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
	type RecipientGroup = { to: string; items: ScheduleChange[] };
	const byRecipient = new Map<string, RecipientGroup>();
	for (const change of [...changes].sort((a, b) =>
		a.submissionId.localeCompare(b.submissionId),
	)) {
		if (change.to === null) {
			// No speaker or submitter email — surfaced as a failure, not skipped
			// silently; the row stays flagged for a later retry.
			result.failed += 1;
			continue;
		}
		const identity = normalizeEmail(change.to);
		const group = byRecipient.get(identity);
		if (group) group.items.push(change);
		else byRecipient.set(identity, { to: change.to, items: [change] });
	}
	const recipients = [...byRecipient.keys()].sort();
	const batch = recipients.slice(0, EMAIL_BATCH_LIMIT);
	result.remaining = recipients.length - batch.length;

	const sender = getEmailSender(env);
	for (const recipient of batch) {
		const group = byRecipient.get(recipient);
		if (!group) continue;
		const { to, items } = group;
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
		const state = JSON.stringify({
			eventId: event.id,
			recipient,
			revisions: items.map((item) => ({
				submissionId: item.submissionId,
				sequence: item.nextSequence,
				start: item.invite.start.toISOString(),
				end: item.invite.end.toISOString(),
				location: item.invite.location,
				title: item.invite.title,
				retryAfterBounceId: item.retryAfterBounceId,
			})),
		});
		const dedupeKey = `schedule-update:${await sha256Hex(state)}`;
		try {
			const sent = await sender.send({
				to,
				subject:
					items.length === 1
						? `Schedule update: ${first.submissionTitle} — ${event.name}`
						: `Schedule updates: ${items.length} of your sessions — ${event.name}`,
				html: updateEmailHtml(items, event),
				ics,
				dedupeKey,
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
