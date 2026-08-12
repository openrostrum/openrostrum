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
import {
	calendarInviteProcessedOutbox,
	calendarInviteRevisions,
	calendarInviteSequenceFrontiers,
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
	submissionIdFromIcsUid,
	type SubmissionInvite,
} from "~/domain/accept";
import {
	claimInviteSequences,
	deliveredInviteFrontiers,
	type InviteFrontier,
	inviteStateHash,
	proposedSequence,
} from "~/domain/calendar-sequence";
import { sha256Hex } from "~/lib/api-token";
import { normalizeEmail } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatScheduleRange } from "~/lib/format-date";
import { escapeHtml } from "~/lib/html";
import { inspectIcsAttachment, type ParsedIcsEvent } from "~/lib/ics";
import { track } from "~/lib/track";
import {
	EmailDeliveryError,
	EmailSendInFlightError,
	getEmailSender,
} from "~/ports/email";

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
	/** Durable normalization has more rows — a later request can resume it. */
	truncated: boolean;
	/** Sent history is invalid — operator diagnosis is required before delivery. */
	blocked: boolean;
};

const EMPTY: ScheduleChangeSet = {
	changes: [],
	speakers: 0,
	truncated: false,
	blocked: false,
};

const OUTBOX_NORMALIZE_PAGE = 200;
const SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT = 200;
const D1_QUERY_CHUNK = 80;
const ATTEMPT_INSERT_CHUNK = 8;
const MARKER_INSERT_CHUNK = 25;
// Normalization runs in its own action phase. Keep each pass below D1's
// per-invocation statement ceiling so continuation requests always have room.
const NORMALIZATION_STATEMENT_BUDGET = 600;
// Attachment metadata is read before any body. Large individual bodies are
// quarantined, while the aggregate cap bounds each Worker's response memory.
const MAX_ICS_ATTACHMENT_BYTES = 512 * 1024;
const MAX_NORMALIZATION_ATTACHMENT_BYTES = 1024 * 1024;
// The only multi-event producer is schedule updates, which select at most this
// many submissions. Larger historical attachments cannot be product output.
const MAX_ICS_EVENTS_PER_OUTBOX = SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT;

/** Correlated SQL form of inviteRecipients' primary-speaker/fallback rule. */
function inviteRecipientEmailSql() {
	return sql<string | null>`coalesce(
		(select c.email
			from participants p
			inner join contacts c on c.id = p.contact_id
			where p.submission_id = ${submissions.id} and p.role = 'speaker'
			order by p.is_primary desc, p.position asc
			limit 1),
		(select u.email from users u where u.id = ${submissions.submitterId})
	)`;
}

const NORMALIZATION_METADATA_COLUMNS = {
	id: emailOutbox.id,
	dedupeKey: emailOutbox.dedupeKey,
	to: emailOutbox.to,
	createdAt: emailOutbox.createdAt,
	hasIcs: sql<number>`case when ${emailOutbox.icsAttachment} is null then 0 else 1 end`,
	icsBytes: sql<number>`coalesce(length(cast(${emailOutbox.icsAttachment} as blob)), 0)`,
};

type NormalizationMetadataRow = {
	id: string;
	dedupeKey: string | null;
	to: string;
	createdAt: Date;
	hasIcs: number;
	icsBytes: number;
};

type NormalizationRow = {
	id: string;
	dedupeKey: string | null;
	to: string;
	ics: string | null;
	attachmentOversized: boolean;
	createdAt: Date;
};

type ParsedNormalizationRow = NormalizationRow & {
	invites: ParsedIcsEvent[];
	acceptanceSubmissionId: string | null;
	associatedSubmissionIds: Set<string>;
	icsEventCount: number;
};

type NormalizationMetadataPrefix = {
	rows: NormalizationMetadataRow[];
	bodyStatements: number;
	deferred: boolean;
};

function normalizationMetadataPrefix(
	rows: readonly NormalizationMetadataRow[],
	bodyStatementBudget: number,
): NormalizationMetadataPrefix {
	const selected: NormalizationMetadataRow[] = [];
	let attachmentBytes = 0;
	let bodyCount = 0;

	for (const row of rows) {
		const bytes = Number(row.icsBytes);
		const oversized = bytes > MAX_ICS_ATTACHMENT_BYTES;
		const needsBody = row.hasIcs !== 0 && !oversized;
		if (
			!oversized &&
			attachmentBytes + bytes > MAX_NORMALIZATION_ATTACHMENT_BYTES
		) {
			break;
		}
		const nextBodyCount = bodyCount + (needsBody ? 1 : 0);
		if (chunkCount(nextBodyCount, D1_QUERY_CHUNK) > bodyStatementBudget) {
			break;
		}
		selected.push(row);
		if (!oversized) attachmentBytes += bytes;
		bodyCount = nextBodyCount;
	}

	return {
		rows: selected,
		bodyStatements: chunkCount(bodyCount, D1_QUERY_CHUNK),
		deferred: selected.length < rows.length,
	};
}

async function normalizationRowsWithBodies(
	db: Db,
	metadataRows: readonly NormalizationMetadataRow[],
): Promise<NormalizationRow[]> {
	const bodyIds = metadataRows
		.filter(
			(row) =>
				row.hasIcs !== 0 && Number(row.icsBytes) <= MAX_ICS_ATTACHMENT_BYTES,
		)
		.map((row) => row.id);
	const bodies = new Map<string, string | null>();
	for (let offset = 0; offset < bodyIds.length; offset += D1_QUERY_CHUNK) {
		const rows = await db
			.select({ id: emailOutbox.id, ics: emailOutbox.icsAttachment })
			.from(emailOutbox)
			.where(
				inArray(emailOutbox.id, bodyIds.slice(offset, offset + D1_QUERY_CHUNK)),
			);
		for (const row of rows) bodies.set(row.id, row.ics);
	}

	return metadataRows.map((row) => ({
		id: row.id,
		dedupeKey: row.dedupeKey,
		to: row.to,
		ics:
			row.hasIcs !== 0 && Number(row.icsBytes) <= MAX_ICS_ATTACHMENT_BYTES
				? (bodies.get(row.id) ?? null)
				: null,
		attachmentOversized: Number(row.icsBytes) > MAX_ICS_ATTACHMENT_BYTES,
		createdAt: row.createdAt,
	}));
}

function chunkCount(rows: number, chunkSize: number): number {
	return Math.ceil(rows / chunkSize);
}

function normalizationStatementUpperBound(
	rows: readonly ParsedNormalizationRow[],
): number {
	const associatedSubmissionIds = new Set<string>();
	let attemptUpperBound = 0;
	for (const row of rows) {
		attemptUpperBound += row.associatedSubmissionIds.size;
		for (const submissionId of row.associatedSubmissionIds) {
			associatedSubmissionIds.add(submissionId);
		}
	}
	return (
		chunkCount(associatedSubmissionIds.size, D1_QUERY_CHUNK) +
		chunkCount(attemptUpperBound, ATTEMPT_INSERT_CHUNK) +
		chunkCount(rows.length, MARKER_INSERT_CHUNK)
	);
}

function normalizationPrefixWithinBudget(
	rows: readonly ParsedNormalizationRow[],
	statementBudget: number,
): ParsedNormalizationRow[] {
	const associatedSubmissionIds = new Set<string>();
	let attemptUpperBound = 0;
	let length = 0;
	for (const row of rows) {
		let newSubmissionIds = 0;
		for (const submissionId of row.associatedSubmissionIds) {
			if (!associatedSubmissionIds.has(submissionId)) newSubmissionIds += 1;
		}
		const nextAttemptUpperBound =
			attemptUpperBound + row.associatedSubmissionIds.size;
		const nextStatementUpperBound =
			chunkCount(
				associatedSubmissionIds.size + newSubmissionIds,
				D1_QUERY_CHUNK,
			) +
			chunkCount(nextAttemptUpperBound, ATTEMPT_INSERT_CHUNK) +
			chunkCount(length + 1, MARKER_INSERT_CHUNK);
		if (nextStatementUpperBound > statementBudget) break;
		for (const submissionId of row.associatedSubmissionIds) {
			associatedSubmissionIds.add(submissionId);
		}
		attemptUpperBound = nextAttemptUpperBound;
		length += 1;
	}
	return rows.slice(0, length);
}

type RevisionInsert = typeof calendarInviteRevisions.$inferInsert;
type ProcessedOutboxInsert = typeof calendarInviteProcessedOutbox.$inferInsert;

function acceptanceSubmissionId(dedupeKey: string | null): string | null {
	if (!dedupeKey?.startsWith("decision:accept:")) return null;
	const submissionId = dedupeKey.slice(dedupeKey.lastIndexOf(":") + 1);
	return submissionId.length > 0 ? submissionId : null;
}

function parseNormalizationRows(
	rows: readonly NormalizationRow[],
): ParsedNormalizationRow[] {
	return rows.map((row) => {
		const inspection = row.attachmentOversized
			? { events: [], eventCount: 0 }
			: inspectIcsAttachment(row.ics ?? "", MAX_ICS_EVENTS_PER_OUTBOX);
		const acceptedId = acceptanceSubmissionId(row.dedupeKey);
		const tooManyEvents = inspection.eventCount > MAX_ICS_EVENTS_PER_OUTBOX;
		const invites = tooManyEvents ? [] : inspection.events;
		const associatedSubmissionIds = new Set<string>();
		if (acceptedId) associatedSubmissionIds.add(acceptedId);
		for (const invite of invites) {
			const submissionId = submissionIdFromIcsUid(invite.uid);
			if (submissionId) associatedSubmissionIds.add(submissionId);
		}
		return {
			...row,
			invites,
			acceptanceSubmissionId: acceptedId,
			associatedSubmissionIds,
			icsEventCount: row.ics === null ? 0 : inspection.eventCount,
		};
	});
}

type SubmissionIdScopes = {
	currentEvent: Set<string>;
	known: Set<string>;
};

async function submissionIdScopes(
	db: Db,
	eventId: string,
	ids: readonly string[],
): Promise<SubmissionIdScopes> {
	const currentEvent = new Set<string>();
	const known = new Set<string>();
	for (let offset = 0; offset < ids.length; offset += D1_QUERY_CHUNK) {
		const rows = await db
			.select({ id: submissions.id, eventId: submissions.eventId })
			.from(submissions)
			.where(
				inArray(submissions.id, ids.slice(offset, offset + D1_QUERY_CHUNK)),
			);
		for (const row of rows) {
			known.add(row.id);
			if (row.eventId === eventId) currentEvent.add(row.id);
		}
	}
	return { currentEvent, known };
}

function normalizationRowIsInvalid(
	row: ParsedNormalizationRow,
	validSubmissionIds: ReadonlySet<string>,
	knownSubmissionIds: ReadonlySet<string>,
): boolean {
	if (row.attachmentOversized) return true;
	if (row.icsEventCount > MAX_ICS_EVENTS_PER_OUTBOX) return true;
	const submissionIds = row.invites.map((invite) =>
		submissionIdFromIcsUid(invite.uid),
	);
	const parsedCompletely =
		row.ics !== null &&
		row.icsEventCount > 0 &&
		row.icsEventCount === row.invites.length;
	const allInvitesUsable = row.invites.every((invite, index) => {
		const submissionId = submissionIds[index];
		return (
			invite.title !== null &&
			submissionId !== null &&
			submissionId !== undefined &&
			(validSubmissionIds.has(submissionId) ||
				!knownSubmissionIds.has(submissionId))
		);
	});
	const uniqueSubmissions = new Set(submissionIds.filter((id) => id !== null));
	const hasDuplicateSubmission =
		uniqueSubmissions.size !== submissionIds.length;

	if (row.dedupeKey?.startsWith("decision:accept:")) {
		const acceptedId = row.acceptanceSubmissionId;
		if (
			!acceptedId ||
			(knownSubmissionIds.has(acceptedId) &&
				!validSubmissionIds.has(acceptedId))
		) {
			return true;
		}
		if (row.ics === null) return false;
		return (
			!parsedCompletely ||
			!allInvitesUsable ||
			hasDuplicateSubmission ||
			!submissionIds.includes(acceptedId)
		);
	}

	return !parsedCompletely || !allInvitesUsable || hasDuplicateSubmission;
}

async function normalizationAttemptsForRow(
	row: ParsedNormalizationRow,
	eventId: string,
	validSubmissionIds: ReadonlySet<string>,
	knownSubmissionIds: ReadonlySet<string>,
): Promise<{ attempts: RevisionInsert[]; invalid: boolean }> {
	const invalid = normalizationRowIsInvalid(
		row,
		validSubmissionIds,
		knownSubmissionIds,
	);
	const attempts = new Map<string, RevisionInsert>();

	for (const invite of row.invites) {
		const submissionId = submissionIdFromIcsUid(invite.uid);
		if (!submissionId || !validSubmissionIds.has(submissionId)) continue;
		if (attempts.has(submissionId)) continue;
		attempts.set(submissionId, {
			id: crypto.randomUUID(),
			submissionId,
			sequence: invite.sequence,
			stateHash: await inviteStateHash(eventId, submissionId, row.to, invite),
			recipient: row.to,
			startsAt: invite.start,
			endsAt: invite.end,
			location: invite.location ?? null,
			title: invite.title,
			outboxId: row.id,
			invalid,
			createdAt: row.createdAt,
		});
	}

	const acceptedId = row.acceptanceSubmissionId;
	if (
		acceptedId &&
		validSubmissionIds.has(acceptedId) &&
		!attempts.has(acceptedId)
	) {
		const markerKind =
			row.ics === null && !row.attachmentOversized
				? "acceptance-without-ics"
				: "invalid-acceptance-ics";
		attempts.set(acceptedId, {
			id: crypto.randomUUID(),
			submissionId: acceptedId,
			sequence: null,
			stateHash: await sha256Hex(
				JSON.stringify({
					eventId,
					submissionId: acceptedId,
					recipient: normalizeEmail(row.to),
					markerKind,
				}),
			),
			recipient: row.to,
			startsAt: null,
			endsAt: null,
			location: null,
			title: null,
			outboxId: row.id,
			invalid,
			createdAt: row.createdAt,
		});
	}

	return { attempts: [...attempts.values()], invalid };
}

async function insertNormalizationAttempts(
	db: Db,
	attempts: readonly RevisionInsert[],
): Promise<void> {
	const statements = [];
	for (
		let offset = 0;
		offset < attempts.length;
		offset += ATTEMPT_INSERT_CHUNK
	) {
		const chunk = attempts.slice(offset, offset + ATTEMPT_INSERT_CHUNK);
		if (chunk.length === 0) continue;
		statements.push(
			db
				.insert(calendarInviteRevisions)
				.values(chunk)
				.onConflictDoNothing({
					target: [
						calendarInviteRevisions.outboxId,
						calendarInviteRevisions.submissionId,
					],
				}),
		);
	}
	const [first, ...rest] = statements;
	if (first) await db.batch([first, ...rest]);
}

async function insertProcessedOutboxMarkers(
	db: Db,
	markers: readonly ProcessedOutboxInsert[],
): Promise<void> {
	const statements = [];
	for (let offset = 0; offset < markers.length; offset += MARKER_INSERT_CHUNK) {
		const chunk = markers.slice(offset, offset + MARKER_INSERT_CHUNK);
		if (chunk.length === 0) continue;
		statements.push(
			db
				.insert(calendarInviteProcessedOutbox)
				.values(chunk)
				.onConflictDoNothing({
					target: calendarInviteProcessedOutbox.outboxId,
				}),
		);
	}
	const [first, ...rest] = statements;
	if (first) await db.batch([first, ...rest]);
}

export type CalendarHistoryNormalizationResult = {
	processed: number;
	remaining: boolean;
};

export async function normalizeCalendarInviteHistory(
	db: Db,
	eventId: string,
): Promise<CalendarHistoryNormalizationResult> {
	let remainingStatements = NORMALIZATION_STATEMENT_BUDGET;
	let processed = 0;
	while (remainingStatements > 1) {
		// The page read itself consumes one D1 statement. Keep one statement in
		// reserve to determine whether another request must continue the scan.
		remainingStatements -= 1;
		const metadataPage = await db
			.select(NORMALIZATION_METADATA_COLUMNS)
			.from(emailOutbox)
			.leftJoin(
				calendarInviteProcessedOutbox,
				eq(calendarInviteProcessedOutbox.outboxId, emailOutbox.id),
			)
			.where(
				and(
					eq(emailOutbox.eventId, eventId),
					or(
						like(emailOutbox.dedupeKey, "decision:accept:%"),
						like(emailOutbox.dedupeKey, "schedule-update:%"),
					),
					isNull(calendarInviteProcessedOutbox.outboxId),
				),
			)
			.orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
			.limit(OUTBOX_NORMALIZE_PAGE);
		if (metadataPage.length === 0) return { processed, remaining: false };

		const metadataPrefix = normalizationMetadataPrefix(
			metadataPage,
			remainingStatements - 1,
		);
		if (metadataPrefix.rows.length === 0) {
			return { processed, remaining: true };
		}
		remainingStatements -= metadataPrefix.bodyStatements;
		const page = await normalizationRowsWithBodies(db, metadataPrefix.rows);
		const parsedPage = parseNormalizationRows(page);
		const parsed = normalizationPrefixWithinBudget(
			parsedPage,
			remainingStatements - 1,
		);
		if (parsed.length === 0) return { processed, remaining: true };
		remainingStatements -= normalizationStatementUpperBound(parsed);
		const associatedIds = [
			...new Set(parsed.flatMap((row) => [...row.associatedSubmissionIds])),
		];
		const scopes = await submissionIdScopes(db, eventId, associatedIds);
		const attempts: RevisionInsert[] = [];
		const markers: ProcessedOutboxInsert[] = [];
		const processedAt = new Date();

		for (const row of parsed) {
			const normalized = await normalizationAttemptsForRow(
				row,
				eventId,
				scopes.currentEvent,
				scopes.known,
			);
			attempts.push(...normalized.attempts);
			markers.push({
				outboxId: row.id,
				eventId,
				invalid: normalized.invalid,
				processedAt,
			});
		}

		await insertNormalizationAttempts(db, attempts);
		await insertProcessedOutboxMarkers(db, markers);
		processed += markers.length;
		if (parsed.length < parsedPage.length || metadataPrefix.deferred) {
			return { processed, remaining: true };
		}
		if (metadataPage.length < OUTBOX_NORMALIZE_PAGE) {
			return { processed, remaining: false };
		}
	}
	return {
		processed,
		remaining: await hasUnprocessedCalendarInviteHistory(db, eventId),
	};
}

async function hasUnprocessedCalendarInviteHistory(
	db: Db,
	eventId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: emailOutbox.id })
		.from(emailOutbox)
		.leftJoin(
			calendarInviteProcessedOutbox,
			eq(calendarInviteProcessedOutbox.outboxId, emailOutbox.id),
		)
		.where(
			and(
				eq(emailOutbox.eventId, eventId),
				or(
					like(emailOutbox.dedupeKey, "decision:accept:%"),
					like(emailOutbox.dedupeKey, "schedule-update:%"),
				),
				isNull(calendarInviteProcessedOutbox.outboxId),
			),
		)
		.limit(1);
	return row !== undefined;
}

async function hasUnsafeSentCalendarHistory(
	db: Db,
	eventId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: emailOutbox.id })
		.from(emailOutbox)
		.innerJoin(
			calendarInviteProcessedOutbox,
			eq(calendarInviteProcessedOutbox.outboxId, emailOutbox.id),
		)
		.where(
			and(
				eq(emailOutbox.eventId, eventId),
				eq(emailOutbox.status, "sent"),
				eq(calendarInviteProcessedOutbox.invalid, true),
			),
		)
		.limit(1);
	return row !== undefined;
}

async function staleScheduleCandidates(db: Db, event: EventRow) {
	// A queued or failed attempt may still have reached the speaker — the
	// provider hand-off is not transactional with the row that records it. So
	// the baseline is the newest ATTEMPT, not the newest confirmed send: if the
	// schedule later returns to what was last confirmed, that attempt is what
	// the speaker's calendar is still showing and it must be corrected.
	const ranked = db
		.select({
			submissionId: calendarInviteRevisions.submissionId,
			sequence: calendarInviteRevisions.sequence,
			startsAt: calendarInviteRevisions.startsAt,
			endsAt: calendarInviteRevisions.endsAt,
			title: calendarInviteRevisions.title,
			location: calendarInviteRevisions.location,
			to: emailOutbox.to,
			status: emailOutbox.status,
			// Two attempts at the SAME sequence describing DIFFERENT states leave
			// us unable to name what the speaker is looking at: RFC 5545 §3.8.7.4
			// makes SEQUENCE the revision counter, so an equal-SEQUENCE redelivery
			// is exactly the payload a client is entitled to discard as a duplicate
			// — one speaker kept the first, another kept the second, and the row
			// order here cannot tell them apart. Acceptance re-sends make this
			// reachable: every one of them mints SEQUENCE 0. Picking either side as
			// the baseline lets today's slot "match" a state half the speakers
			// never saw, and silence is unrecoverable — no speaker can ask the
			// product for a corrected invite. So ambiguity itself is the stale
			// signal, and the update that resolves it goes out at a HIGHER
			// sequence, which every client applies.
			divergentAtSequence:
				sql<number>`case when min(${calendarInviteRevisions.stateHash}) over (
				partition by ${calendarInviteRevisions.submissionId}, ${calendarInviteRevisions.sequence}
			) <> max(${calendarInviteRevisions.stateHash}) over (
				partition by ${calendarInviteRevisions.submissionId}, ${calendarInviteRevisions.sequence}
			) then 1 else 0 end`.as("divergent_at_sequence"),
			deliveryRank: sql<number>`row_number() over (
				partition by ${calendarInviteRevisions.submissionId}
				order by ${calendarInviteRevisions.sequence} desc,
					coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt}) asc,
					${emailOutbox.id} asc
			)`.as("delivery_rank"),
		})
		.from(calendarInviteRevisions)
		.innerJoin(
			emailOutbox,
			eq(calendarInviteRevisions.outboxId, emailOutbox.id),
		)
		.where(
			and(
				eq(emailOutbox.eventId, event.id),
				inArray(emailOutbox.status, ["sent", "queued", "failed"]),
				eq(calendarInviteRevisions.invalid, false),
				isNotNull(calendarInviteRevisions.sequence),
				isNotNull(calendarInviteRevisions.startsAt),
				isNotNull(calendarInviteRevisions.endsAt),
				isNotNull(calendarInviteRevisions.title),
			),
		)
		.as("ranked_attempted_schedule_invites");
	const latest = db
		.select({
			submissionId: ranked.submissionId,
			sequence: ranked.sequence,
			startsAt: ranked.startsAt,
			endsAt: ranked.endsAt,
			title: ranked.title,
			location: ranked.location,
			to: ranked.to,
			status: ranked.status,
			divergentAtSequence: ranked.divergentAtSequence,
		})
		.from(ranked)
		.where(eq(ranked.deliveryRank, 1))
		.as("latest_attempted_schedule_invites");
	const scheduled = sql`${submissions.startsAt} is not null and ${submissions.endsAt} is not null`;
	const eventStartsAt = event.startsAt
		? Math.floor(event.startsAt.getTime() / 1000)
		: null;
	const eventEndsAt = event.endsAt
		? Math.floor(event.endsAt.getTime() / 1000)
		: null;
	const currentRecipient = inviteRecipientEmailSql();
	const hasCurrentInvite =
		eventStartsAt !== null && eventEndsAt !== null ? sql`1` : scheduled;
	const stateChanged = sql`
		${latest.startsAt} is not (case when ${scheduled} then ${submissions.startsAt} else ${eventStartsAt} end)
		or ${latest.endsAt} is not (case when ${scheduled} then ${submissions.endsAt} else ${eventEndsAt} end)
		or ${latest.title} is not (case when ${scheduled}
			then ${submissions.title} || ' — ' || ${event.name}
			else ${event.name} || ' (save the date): ' || ${submissions.title}
		end)
		or ${latest.location} is not (case when ${scheduled}
			then coalesce(${rooms.name}, ${event.location})
			else ${event.location}
		end)
		or lower(trim(${latest.to})) is not lower(trim(${currentRecipient}))
	`;
	// An unconfirmed newest attempt stays in the change set even when its content
	// already matches: the retry click is the only thing that can turn a failed
	// or abandoned attempt into a delivery.
	const attemptUnconfirmed = sql`${latest.status} is not 'sent'`;
	// See `divergentAtSequence`: nobody can say which of two equal-SEQUENCE
	// deliveries a given client kept, so the session stays in the change set
	// until an update at a higher sequence settles it.
	const baselineAmbiguous = sql`${latest.divergentAtSequence} = 1`;

	return (
		db
			.select({
				id: submissions.id,
				title: submissions.title,
				startsAt: submissions.startsAt,
				endsAt: submissions.endsAt,
				roomId: submissions.roomId,
				roomName: rooms.name,
				lastSubmissionId: latest.submissionId,
				lastSequence: latest.sequence,
				lastStartsAt: latest.startsAt,
				lastEndsAt: latest.endsAt,
				lastTitle: latest.title,
				lastLocation: latest.location,
				lastTo: latest.to,
				lastStatus: latest.status,
				lastDivergentAtSequence: latest.divergentAtSequence,
			})
			.from(submissions)
			.leftJoin(latest, eq(latest.submissionId, submissions.id))
			.leftJoin(rooms, eq(rooms.id, submissions.roomId))
			.where(
				and(
					eq(submissions.eventId, event.id),
					eq(submissions.status, "accepted"),
					isNotNull(submissions.notifiedAt),
					isNull(submissions.parentId),
					hasCurrentInvite,
					sql`exists (
					select 1 from calendar_invite_revisions tracked
					inner join email_outbox tracked_outbox
						on tracked_outbox.id = tracked.outbox_id
					where tracked.submission_id = ${submissions.id}
						and tracked_outbox.event_id = ${event.id}
						and tracked.invalid = 0
				)`,
					or(
						isNull(latest.submissionId),
						stateChanged,
						attemptUnconfirmed,
						baselineAmbiguous,
					),
				),
			)
			// Deliverable sessions first. A session whose speaker contact is gone can
			// never leave the change set, so on identifier order alone a batch of them
			// would occupy the whole window forever and no speaker anywhere in the
			// event would ever receive an update. They still surface — as the failed
			// count that tells an admin whose contact to fix — but from the tail.
			.orderBy(
				sql`case when ${currentRecipient} is null then 1 else 0 end`,
				asc(submissions.id),
			)
			.limit(SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT + 1)
	);
}

async function latestBounces(
	db: Db,
	eventId: string,
	submissionIds: readonly string[],
): Promise<Map<string, string>> {
	const bounces = new Map<string, string>();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		const ranked = db
			.select({
				submissionId: calendarInviteRevisions.submissionId,
				outboxId: calendarInviteRevisions.outboxId,
				deliveryRank: sql<number>`row_number() over (
					partition by ${calendarInviteRevisions.submissionId}
					order by coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt}) desc,
						${emailOutbox.id} desc
				)`.as("delivery_rank"),
			})
			.from(calendarInviteRevisions)
			.innerJoin(
				emailOutbox,
				eq(calendarInviteRevisions.outboxId, emailOutbox.id),
			)
			.where(
				and(
					eq(emailOutbox.eventId, eventId),
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
					eq(emailOutbox.status, "bounced"),
				),
			)
			.as("ranked_bounced_calendar_invites");
		const rows = await db
			.select({
				submissionId: ranked.submissionId,
				outboxId: ranked.outboxId,
			})
			.from(ranked)
			.where(eq(ranked.deliveryRank, 1));
		for (const row of rows) bounces.set(row.submissionId, row.outboxId);
	}
	return bounces;
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
	if (await hasUnprocessedCalendarInviteHistory(db, event.id)) {
		return { ...EMPTY, truncated: true };
	}
	if (await hasUnsafeSentCalendarHistory(db, event.id)) {
		return { ...EMPTY, blocked: true };
	}

	const candidates = await staleScheduleCandidates(db, event);
	if (candidates.length === 0) return EMPTY;

	const candidateIds = candidates.map((candidate) => candidate.id);
	const [latestBounce, recipientById] = await Promise.all([
		latestBounces(db, event.id, candidateIds),
		inviteRecipients(db, candidateIds),
	]);

	const changes: ScheduleChange[] = [];
	for (const row of candidates) {
		const last =
			row.lastSubmissionId !== null &&
			row.lastSequence !== null &&
			row.lastStartsAt !== null &&
			row.lastEndsAt !== null &&
			row.lastTitle !== null
				? {
						start: row.lastStartsAt,
						end: row.lastEndsAt,
						title: row.lastTitle,
						location: row.lastLocation,
						sequence: row.lastSequence,
						to: row.lastTo ?? "",
					}
				: undefined;
		const invite = inviteForSubmission(row, event, row.roomName ?? undefined);
		if (!invite) continue;
		const to = recipientById.get(row.id) ?? null;
		const inviteUnchanged =
			last !== undefined &&
			last.start.getTime() === invite.start.getTime() &&
			last.end.getTime() === invite.end.getTime() &&
			last.title === invite.title &&
			(last.location ?? null) === (invite.location ?? null);
		const recipientUnchanged =
			last !== undefined &&
			to !== null &&
			normalizeEmail(last.to) === normalizeEmail(to);
		// An attempt the provider never confirmed may or may not have reached the
		// speaker, so an unchanged invite still belongs in the change set —
		// resending is the only way to close that gap. It keeps the attempt's own
		// SEQUENCE: a client that already has the entry then sees no revision,
		// while one that never received it gets the invite for the first time.
		// When two attempts share a SEQUENCE and describe different states, matching
		// one of them proves nothing about what the speaker is looking at (see
		// `divergentAtSequence`). So "unchanged" is not a claim we can make here,
		// and the update has to go out at a HIGHER sequence — the only revision
		// every client is obliged to apply — rather than replaying the ambiguous one.
		const baselineAmbiguous = row.lastDivergentAtSequence === 1;
		const retryUnchanged =
			inviteUnchanged && recipientUnchanged && !baselineAmbiguous;
		if (retryUnchanged && row.lastStatus === "sent") continue;
		changes.push({
			submissionId: row.id,
			submissionTitle: row.title,
			scheduled: Boolean(row.startsAt && row.endsAt),
			invite,
			nextSequence: last ? last.sequence + (retryUnchanged ? 0 : 1) : 0,
			to,
			retryAfterBounceId: latestBounce.get(row.id) ?? null,
		});
	}
	if (changes.length === 0) return EMPTY;

	const speakers = new Set(
		changes.flatMap((change) =>
			change.to === null ? [] : [normalizeEmail(change.to)],
		),
	).size;
	return { changes, speakers, truncated: false, blocked: false };
}

export type ScheduleUpdateSendResult = {
	/** Units are EMAILS (one per speaker), not sessions. */
	sent: number;
	deduped: number;
	failed: number;
	inFlight: number;
	/** Speakers beyond the batch cap — still pending after this call. */
	remaining: number;
};

type RecipientGroup<T extends ScheduleChange = ScheduleChange> = {
	to: string;
	items: T[];
};

function groupChangesByRecipient<T extends ScheduleChange>(
	changes: readonly T[],
): Map<string, RecipientGroup<T>> {
	const groups = new Map<string, RecipientGroup<T>>();
	for (const change of [...changes].sort((a, b) =>
		a.submissionId.localeCompare(b.submissionId),
	)) {
		if (change.to === null) continue;
		const identity = normalizeEmail(change.to);
		const group = groups.get(identity);
		if (group) group.items.push(change);
		else groups.set(identity, { to: change.to, items: [change] });
	}
	return groups;
}

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

type CurrentInviteSnapshot = {
	stateHash: string;
	frontier: InviteFrontier | null;
};

async function currentInviteSnapshots(
	db: Db,
	event: EventRow,
	submissionIds: readonly string[],
): Promise<Map<string, CurrentInviteSnapshot>> {
	const snapshots = new Map<string, CurrentInviteSnapshot>();
	const currentRecipient = inviteRecipientEmailSql();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		const rows = await db
			.select({
				id: submissions.id,
				title: submissions.title,
				startsAt: submissions.startsAt,
				endsAt: submissions.endsAt,
				roomId: submissions.roomId,
				roomName: rooms.name,
				recipient: currentRecipient,
				frontierSequence: calendarInviteSequenceFrontiers.sequence,
				frontierStateHash: calendarInviteSequenceFrontiers.stateHash,
			})
			.from(submissions)
			.leftJoin(rooms, eq(rooms.id, submissions.roomId))
			.leftJoin(
				calendarInviteSequenceFrontiers,
				eq(calendarInviteSequenceFrontiers.submissionId, submissions.id),
			)
			.where(
				and(
					eq(submissions.eventId, event.id),
					eq(submissions.status, "accepted"),
					isNotNull(submissions.notifiedAt),
					isNull(submissions.parentId),
					inArray(
						submissions.id,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
				),
			);
		for (const row of rows) {
			if (!row.recipient) continue;
			const invite = inviteForSubmission(row, event, row.roomName ?? undefined);
			if (!invite) continue;
			snapshots.set(row.id, {
				stateHash: await inviteStateHash(
					event.id,
					row.id,
					row.recipient,
					invite,
				),
				frontier:
					row.frontierSequence === null || row.frontierStateHash === null
						? null
						: {
								sequence: row.frontierSequence,
								stateHash: row.frontierStateHash,
							},
			});
		}
	}
	return snapshots;
}

async function currentInviteStateHashes(
	db: Db,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<Map<string, string>> {
	const snapshots = await currentInviteSnapshots(db, event, [
		...new Set(changes.map((change) => change.submissionId)),
	]);
	return new Map(
		[...snapshots].map(([submissionId, snapshot]) => [
			submissionId,
			snapshot.stateHash,
		]),
	);
}

type ClaimedScheduleChange = ScheduleChange & { stateHash: string };

/**
 * The event row feeds every invite (session titles carry the event name, an
 * unscheduled hold carries its dates and location), so a request holding a
 * stale copy would reconstruct — and re-deliver — an invite the organizer has
 * already replaced. Both claiming and per-recipient revalidation therefore read
 * the event fresh; a stale caller then fails its own hash check and drops out.
 */
async function reloadEvent(db: Db, eventId: string): Promise<EventRow | null> {
	return (
		(await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, eventId),
		})) ?? null
	);
}

async function revalidateScheduleClaims(
	db: Db,
	eventId: string,
	changes: readonly ClaimedScheduleChange[],
): Promise<{ event: EventRow; items: ClaimedScheduleChange[] } | null> {
	if (changes.length === 0) return null;
	const event = await reloadEvent(db, eventId);
	if (!event) return null;
	const snapshots = await currentInviteSnapshots(
		db,
		event,
		changes.map((change) => change.submissionId),
	);
	const items = changes.filter((change) => {
		const snapshot = snapshots.get(change.submissionId);
		return (
			snapshot?.stateHash === change.stateHash &&
			snapshot.frontier?.stateHash === change.stateHash &&
			snapshot.frontier.sequence === change.nextSequence
		);
	});
	return { event, items };
}

async function claimScheduleSequences(
	db: Db,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<ClaimedScheduleChange[]> {
	if (changes.length === 0) return [];
	const [priorFrontiers, currentStateHashes] = await Promise.all([
		deliveredInviteFrontiers(
			db,
			changes.map((change) => change.submissionId),
		),
		currentInviteStateHashes(db, event, changes),
	]);
	const claimPlans: { change: ScheduleChange; stateHash: string }[] = [];
	for (const change of changes) {
		if (change.to === null) continue;
		const stateHash = await inviteStateHash(
			event.id,
			change.submissionId,
			change.to,
			change.invite,
		);
		if (currentStateHashes.get(change.submissionId) !== stateHash) continue;
		claimPlans.push({ change, stateHash });
	}

	const sequences = await claimInviteSequences(
		db,
		claimPlans.map(({ change, stateHash }) => ({
			submissionId: change.submissionId,
			stateHash,
			proposedSequence: proposedSequence(
				stateHash,
				priorFrontiers.get(change.submissionId),
				change.nextSequence,
			),
		})),
	);
	const claimed: ClaimedScheduleChange[] = claimPlans.map(
		({ change, stateHash }) => {
			const sequence = sequences.get(change.submissionId);
			if (sequence === undefined) {
				throw new Error("Calendar sequence claim returned no row");
			}
			return { ...change, nextSequence: sequence, stateHash };
		},
	);

	// Per-recipient revalidation immediately before the provider effect is the
	// relevant race closure; a global pass here would duplicate those reads.
	return claimed;
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
		inFlight: 0,
		remaining: 0,
	};
	result.failed += changes.filter((change) => change.to === null).length;
	const pendingByRecipient = groupChangesByRecipient(changes);

	// Claim only work this invocation can send. The submission cap bounds the
	// one-statement-per-frontier CAS even when one speaker owns many sessions.
	const selected: ScheduleChange[] = [];
	let selectedRecipients = 0;
	for (const recipient of [...pendingByRecipient.keys()].sort()) {
		const group = pendingByRecipient.get(recipient);
		if (!group) continue;
		const capacity = SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT - selected.length;
		if (selectedRecipients >= EMAIL_BATCH_LIMIT || capacity <= 0) {
			result.remaining += 1;
			continue;
		}
		const items = group.items.slice(0, capacity);
		selected.push(...items);
		selectedRecipients += 1;
		if (items.length < group.items.length) result.remaining += 1;
	}

	const claimEvent = await reloadEvent(db, event.id);
	if (!claimEvent) return result;
	const byRecipient = groupChangesByRecipient(
		await claimScheduleSequences(db, claimEvent, selected),
	);
	const batch = [...byRecipient.keys()].sort();

	const sender = getEmailSender(env);
	for (const recipient of batch) {
		const group = byRecipient.get(recipient);
		if (!group) continue;
		const { to } = group;
		// Each provider call gets a fresh D1 snapshot. A remote HTTP side effect
		// cannot share a transaction with D1, so provider idempotency and monotonic
		// SEQUENCE protect the irreducible interval after this read.
		const revalidated = await revalidateScheduleClaims(
			db,
			event.id,
			group.items,
		);
		if (!revalidated) continue;
		const { event: current, items } = revalidated;
		const first = items[0];
		if (!first) continue;
		const ics = icsForInvites(
			current,
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
						? `Schedule update: ${first.submissionTitle} — ${current.name}`
						: `Schedule updates: ${items.length} of your sessions — ${current.name}`,
				html: updateEmailHtml(items, current),
				ics,
				dedupeKey,
				eventId: event.id,
				kind: "transactional",
				// Success here advances the durable calendar sequence frontier, so a
				// delivery another request owns must surface as in-flight, not as ours.
				onInFlight: "reject",
			});
			if (sent.deduped) result.deduped += 1;
			else result.sent += 1;
			track("email.schedule_update_sent", {
				eventId: event.id,
				sessions: items.length,
				deduped: sent.deduped,
			});
		} catch (error) {
			if (error instanceof EmailSendInFlightError) {
				result.inFlight += 1;
				track("email.schedule_update_in_flight", {
					eventId: event.id,
					sessions: items.length,
				});
				continue;
			}
			if (!(error instanceof EmailDeliveryError)) throw error;
			// One provider-rejected recipient must not sink the batch — their rows
			// stay detected as changed and a retry click re-sends them.
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
