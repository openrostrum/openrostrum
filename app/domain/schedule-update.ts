import {
	and,
	asc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	like,
	lte,
	or,
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "~/db";
import {
	calendarInviteLedgerCursors,
	calendarInviteRevisions,
	emailOutbox,
	type events,
	rooms,
	submissions,
} from "~/db/schema";
import {
	EMAIL_BATCH_LIMIT,
	icsForInvites,
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

const OUTBOX_NORMALIZE_PAGE = 100;
const D1_QUERY_CHUNK = 80;
const D1_BATCH_CHUNK = 50;
const OUTBOX_ROWID = sql<number>`${emailOutbox}.rowid`;

const NORMALIZATION_COLUMNS = {
	rowid: OUTBOX_ROWID,
	id: emailOutbox.id,
	dedupeKey: emailOutbox.dedupeKey,
	to: emailOutbox.to,
	ics: emailOutbox.icsAttachment,
	createdAt: emailOutbox.createdAt,
};

type NormalizationRow = {
	rowid: number;
	id: string;
	dedupeKey: string | null;
	to: string;
	ics: string | null;
	createdAt: Date;
};

type ParsedNormalizationRow = NormalizationRow & {
	invites: ParsedIcsEvent[];
	acceptanceSubmissionId: string | null;
	associatedSubmissionIds: Set<string>;
};

type InviteBaseline = {
	start: Date;
	end: Date;
	location: string | null;
	sequence: number;
	to: string;
};

function acceptanceSubmissionId(dedupeKey: string | null): string | null {
	if (!dedupeKey?.startsWith("decision:accept:")) return null;
	const submissionId = dedupeKey.slice(dedupeKey.lastIndexOf(":") + 1);
	return submissionId.length > 0 ? submissionId : null;
}

function stableUidSubmissionId(uid: string): string | null {
	const prefix = "submission-";
	const suffix = "@openrostrum";
	if (!uid.startsWith(prefix) || !uid.endsWith(suffix)) return null;
	const submissionId = uid.slice(prefix.length, -suffix.length);
	return submissionId.length > 0 ? submissionId : null;
}

function parseNormalizationRows(
	rows: readonly NormalizationRow[],
): ParsedNormalizationRow[] {
	return rows.map((row) => {
		// Parse exactly once even when one message contains several VEVENTs.
		const invites = parseIcsAttachment(row.ics ?? "");
		const acceptedId = acceptanceSubmissionId(row.dedupeKey);
		const associatedSubmissionIds = new Set<string>();
		if (acceptedId) associatedSubmissionIds.add(acceptedId);
		for (const invite of invites) {
			const submissionId = stableUidSubmissionId(invite.uid);
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

async function eventSubmissionIds(
	db: Db,
	eventId: string,
	ids: readonly string[],
): Promise<Set<string>> {
	const validIds = new Set<string>();
	for (let offset = 0; offset < ids.length; offset += D1_QUERY_CHUNK) {
		const rows = await db
			.select({ id: submissions.id })
			.from(submissions)
			.where(
				and(
					eq(submissions.eventId, eventId),
					inArray(submissions.id, ids.slice(offset, offset + D1_QUERY_CHUNK)),
				),
			);
		for (const row of rows) validIds.add(row.id);
	}
	return validIds;
}

async function normalizedInviteStateHash(
	eventId: string,
	submissionId: string,
	to: string,
	invite: ParsedIcsEvent,
): Promise<string> {
	return sha256Hex(
		JSON.stringify({
			eventId,
			submissionId,
			recipient: normalizeEmail(to),
			start: invite.start.toISOString(),
			end: invite.end.toISOString(),
			location: invite.location ?? null,
			title: null,
		}),
	);
}

async function runNormalizationWrites(
	db: Db,
	writes: readonly BatchItem<"sqlite">[],
): Promise<void> {
	for (let offset = 0; offset < writes.length; offset += D1_BATCH_CHUNK) {
		const chunk = writes.slice(offset, offset + D1_BATCH_CHUNK);
		const first = chunk[0];
		if (!first) continue;
		await db.batch([first, ...chunk.slice(1)]);
	}
}

async function advanceNormalizationCursor(
	db: Db,
	eventId: string,
	lastOutboxRowid: number,
): Promise<void> {
	await db
		.insert(calendarInviteLedgerCursors)
		.values({ eventId, lastOutboxRowid, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: calendarInviteLedgerCursors.eventId,
			set: {
				lastOutboxRowid: sql<number>`max(${calendarInviteLedgerCursors.lastOutboxRowid}, ${lastOutboxRowid})`,
				updatedAt: new Date(),
			},
		});
}

/**
 * Project structured calendar history into durable revisions. A fixed high-water
 * mark makes each run finite; rowid keyset pages bound every read without ever
 * treating row count as a completeness limit.
 */
export async function normalizeCalendarInviteHistory(
	db: Db,
	eventId: string,
): Promise<void> {
	const [cursorRow] = await db
		.select({ lastOutboxRowid: calendarInviteLedgerCursors.lastOutboxRowid })
		.from(calendarInviteLedgerCursors)
		.where(eq(calendarInviteLedgerCursors.eventId, eventId))
		.limit(1);
	const [highWaterRow] = await db
		.select({ rowid: sql<number | null>`max(${OUTBOX_ROWID})` })
		.from(emailOutbox)
		.where(eq(emailOutbox.eventId, eventId));
	const highWater = Number(highWaterRow?.rowid ?? 0);
	let cursor = cursorRow?.lastOutboxRowid ?? 0;
	if (cursor >= highWater) return;

	while (cursor < highWater) {
		const page = (await db
			.select(NORMALIZATION_COLUMNS)
			.from(emailOutbox)
			.where(
				and(
					eq(emailOutbox.eventId, eventId),
					gt(OUTBOX_ROWID, cursor),
					lte(OUTBOX_ROWID, highWater),
					or(
						like(emailOutbox.dedupeKey, "decision:accept:%"),
						like(emailOutbox.dedupeKey, "schedule-update:%"),
					),
				),
			)
			.orderBy(asc(OUTBOX_ROWID))
			.limit(OUTBOX_NORMALIZE_PAGE)) as NormalizationRow[];
		if (page.length === 0) {
			await advanceNormalizationCursor(db, eventId, highWater);
			return;
		}

		const parsedPage = parseNormalizationRows(page);
		const associatedIds = [
			...new Set(parsedPage.flatMap((row) => [...row.associatedSubmissionIds])),
		];
		const validSubmissionIds = await eventSubmissionIds(
			db,
			eventId,
			associatedIds,
		);
		const writes: BatchItem<"sqlite">[] = [];

		for (const row of parsedPage) {
			for (const invite of row.invites) {
				const submissionId = stableUidSubmissionId(invite.uid);
				if (!submissionId || !validSubmissionIds.has(submissionId)) continue;
				const stateHash = await normalizedInviteStateHash(
					eventId,
					submissionId,
					row.to,
					invite,
				);
				writes.push(
					db
						.insert(calendarInviteRevisions)
						.values({
							id: crypto.randomUUID(),
							submissionId,
							sequence: invite.sequence,
							stateHash,
							recipient: row.to,
							startsAt: invite.start,
							endsAt: invite.end,
							location: invite.location ?? null,
							title: null,
							outboxId: row.id,
							invalid: false,
							createdAt: row.createdAt,
						})
						.onConflictDoUpdate({
							target: [
								calendarInviteRevisions.submissionId,
								calendarInviteRevisions.sequence,
							],
							set: { outboxId: row.id },
							setWhere: eq(calendarInviteRevisions.stateHash, stateHash),
						}),
				);
			}

			const acceptedId = row.acceptanceSubmissionId;
			if (!acceptedId || !validSubmissionIds.has(acceptedId)) continue;
			const hasExpectedInvite = row.invites.some(
				(invite) => stableUidSubmissionId(invite.uid) === acceptedId,
			);
			if (hasExpectedInvite) continue;
			const invalid = row.ics !== null;
			const markerKind = invalid
				? "invalid-acceptance-ics"
				: "acceptance-without-ics";
			const markerIdentity = await sha256Hex(
				JSON.stringify({
					markerKind,
					outboxId: row.id,
					submissionId: acceptedId,
				}),
			);
			const stateHash = await sha256Hex(
				JSON.stringify({
					eventId,
					submissionId: acceptedId,
					recipient: normalizeEmail(row.to),
					markerKind,
				}),
			);
			writes.push(
				db
					.insert(calendarInviteRevisions)
					.values({
						id: `calendar-marker:${markerIdentity}`,
						submissionId: acceptedId,
						sequence: null,
						stateHash,
						recipient: row.to,
						startsAt: null,
						endsAt: null,
						location: null,
						title: null,
						outboxId: row.id,
						invalid,
						createdAt: row.createdAt,
					})
					.onConflictDoNothing({ target: calendarInviteRevisions.id }),
			);
		}

		await runNormalizationWrites(db, writes);
		const lastRowid = page[page.length - 1]?.rowid ?? cursor;
		const checkpoint =
			page.length < OUTBOX_NORMALIZE_PAGE ? highWater : lastRowid;
		await advanceNormalizationCursor(db, eventId, checkpoint);
		cursor = checkpoint;
	}
}

type RevisionProjection = {
	submissionId: string;
	sequence: number | null;
	recipient: string;
	startsAt: Date | null;
	endsAt: Date | null;
	location: string | null;
	outboxId: string | null;
	invalid: boolean;
	outboxStatus: (typeof emailOutbox.$inferSelect)["status"] | null;
	outboxRecipient: string | null;
	outboxRowid: number | null;
};

async function revisionHistory(
	db: Db,
	submissionIds: readonly string[],
): Promise<RevisionProjection[]> {
	const revisions: RevisionProjection[] = [];
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		revisions.push(
			...(await db
				.select({
					submissionId: calendarInviteRevisions.submissionId,
					sequence: calendarInviteRevisions.sequence,
					recipient: calendarInviteRevisions.recipient,
					startsAt: calendarInviteRevisions.startsAt,
					endsAt: calendarInviteRevisions.endsAt,
					location: calendarInviteRevisions.location,
					outboxId: calendarInviteRevisions.outboxId,
					invalid: calendarInviteRevisions.invalid,
					outboxStatus: emailOutbox.status,
					outboxRecipient: emailOutbox.to,
					outboxRowid: sql<number | null>`${emailOutbox}.rowid`,
				})
				.from(calendarInviteRevisions)
				.leftJoin(
					emailOutbox,
					eq(calendarInviteRevisions.outboxId, emailOutbox.id),
				)
				.where(
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
				)),
		);
	}
	return revisions;
}

/**
 * Every accepted, already-notified submission whose current slot differs from
 * the last delivered normalized revision, with its recipient resolved. Rows
 * never notified are skipped — their decision email will carry the schedule.
 */
export async function computeScheduleChanges(
	db: Db,
	event: EventRow,
): Promise<ScheduleChangeSet> {
	await normalizeCalendarInviteHistory(db, event.id);
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

	const candidateIds = candidates.map((candidate) => candidate.id);
	const revisions = await revisionHistory(db, candidateIds);
	const trackedCandidates = new Set<string>();
	const lastSent = new Map<string, InviteBaseline>();
	const latestBounce = new Map<string, { id: string; rowid: number }>();
	let unsafe = false;
	for (const revision of revisions) {
		trackedCandidates.add(revision.submissionId);
		if (revision.invalid && revision.outboxStatus === "sent") unsafe = true;
		if (
			revision.outboxStatus === "sent" &&
			!revision.invalid &&
			revision.sequence !== null &&
			revision.startsAt !== null &&
			revision.endsAt !== null
		) {
			const prior = lastSent.get(revision.submissionId);
			// Sequence uniqueness preserves the first state projected at an equal
			// revision. Only a strictly higher delivered sequence replaces it.
			if (!prior || revision.sequence > prior.sequence) {
				lastSent.set(revision.submissionId, {
					start: revision.startsAt,
					end: revision.endsAt,
					location: revision.location,
					sequence: revision.sequence,
					to: revision.outboxRecipient ?? revision.recipient,
				});
			}
		}
		if (
			revision.outboxStatus === "bounced" &&
			revision.outboxId !== null &&
			revision.outboxRowid !== null
		) {
			const prior = latestBounce.get(revision.submissionId);
			if (!prior || revision.outboxRowid > prior.rowid) {
				latestBounce.set(revision.submissionId, {
					id: revision.outboxId,
					rowid: revision.outboxRowid,
				});
			}
		}
	}
	if (unsafe) return { ...EMPTY, truncated: true };

	const recipientById = await inviteRecipients(db, candidateIds);
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
		changes.push({
			submissionId: row.id,
			submissionTitle: row.title,
			scheduled: Boolean(row.startsAt && row.endsAt),
			invite,
			nextSequence: last ? last.sequence + 1 : 0,
			to,
			retryAfterBounceId: latestBounce.get(row.id)?.id ?? null,
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
