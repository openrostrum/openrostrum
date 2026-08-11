import {
	and,
	asc,
	desc,
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

const OUTBOX_NORMALIZE_PAGE = 200;
const D1_QUERY_CHUNK = 80;
const ATTEMPT_INSERT_CHUNK = 8;
const MARKER_INSERT_CHUNK = 25;
// Reserve 400 D1 statements for change detection, delivery, and post-send
// normalization that share the same Worker request.
const NORMALIZATION_STATEMENT_BUDGET = 600;

const NORMALIZATION_COLUMNS = {
	id: emailOutbox.id,
	dedupeKey: emailOutbox.dedupeKey,
	to: emailOutbox.to,
	ics: emailOutbox.icsAttachment,
	createdAt: emailOutbox.createdAt,
};

type NormalizationRow = {
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
	icsEventCount: number;
};

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
	for (let length = rows.length; length > 0; length -= 1) {
		const prefix = rows.slice(0, length);
		if (normalizationStatementUpperBound(prefix) <= statementBudget) {
			return prefix;
		}
	}
	return [];
}

type InviteBaseline = {
	start: Date;
	end: Date;
	title: string;
	location: string | null;
	sequence: number;
	to: string;
};

type RevisionInsert = typeof calendarInviteRevisions.$inferInsert;
type ProcessedOutboxInsert = typeof calendarInviteProcessedOutbox.$inferInsert;

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

function countIcsEvents(ics: string): number {
	const unfolded = ics.replace(/\r?\n[ \t]/g, "");
	return unfolded.match(/^BEGIN:VEVENT\r?$/gm)?.length ?? 0;
}

function parseNormalizationRows(
	rows: readonly NormalizationRow[],
): ParsedNormalizationRow[] {
	return rows.map((row) => {
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
			icsEventCount: row.ics === null ? 0 : countIcsEvents(row.ics),
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
	invite: Pick<ParsedIcsEvent, "start" | "end" | "location" | "title">,
): Promise<string> {
	return sha256Hex(
		JSON.stringify({
			eventId,
			submissionId,
			recipient: normalizeEmail(to),
			start: invite.start.toISOString(),
			end: invite.end.toISOString(),
			location: invite.location ?? null,
			title: invite.title,
		}),
	);
}

function normalizationRowIsInvalid(
	row: ParsedNormalizationRow,
	validSubmissionIds: ReadonlySet<string>,
): boolean {
	const submissionIds = row.invites.map((invite) =>
		stableUidSubmissionId(invite.uid),
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
			validSubmissionIds.has(submissionId)
		);
	});
	const uniqueSubmissions = new Set(submissionIds.filter((id) => id !== null));
	const hasDuplicateSubmission =
		uniqueSubmissions.size !== submissionIds.length;

	if (row.dedupeKey?.startsWith("decision:accept:")) {
		const acceptedId = row.acceptanceSubmissionId;
		if (!acceptedId || !validSubmissionIds.has(acceptedId)) return true;
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
): Promise<{ attempts: RevisionInsert[]; invalid: boolean }> {
	const invalid = normalizationRowIsInvalid(row, validSubmissionIds);
	const attempts = new Map<string, RevisionInsert>();

	for (const invite of row.invites) {
		const submissionId = stableUidSubmissionId(invite.uid);
		if (!submissionId || !validSubmissionIds.has(submissionId)) continue;
		if (attempts.has(submissionId)) continue;
		attempts.set(submissionId, {
			id: crypto.randomUUID(),
			submissionId,
			sequence: invite.sequence,
			stateHash: await normalizedInviteStateHash(
				eventId,
				submissionId,
				row.to,
				invite,
			),
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
			row.ics === null ? "acceptance-without-ics" : "invalid-acceptance-ics";
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
	for (
		let offset = 0;
		offset < attempts.length;
		offset += ATTEMPT_INSERT_CHUNK
	) {
		const chunk = attempts.slice(offset, offset + ATTEMPT_INSERT_CHUNK);
		if (chunk.length === 0) continue;
		await db
			.insert(calendarInviteRevisions)
			.values(chunk)
			.onConflictDoNothing({
				target: [
					calendarInviteRevisions.outboxId,
					calendarInviteRevisions.submissionId,
				],
			});
	}
}

async function insertProcessedOutboxMarkers(
	db: Db,
	markers: readonly ProcessedOutboxInsert[],
): Promise<void> {
	for (let offset = 0; offset < markers.length; offset += MARKER_INSERT_CHUNK) {
		const chunk = markers.slice(offset, offset + MARKER_INSERT_CHUNK);
		if (chunk.length === 0) continue;
		await db
			.insert(calendarInviteProcessedOutbox)
			.values(chunk)
			.onConflictDoNothing({
				target: calendarInviteProcessedOutbox.outboxId,
			});
	}
}

export async function normalizeCalendarInviteHistory(
	db: Db,
	eventId: string,
): Promise<void> {
	let remainingStatements = NORMALIZATION_STATEMENT_BUDGET;
	while (remainingStatements > 1) {
		// The page read itself consumes one D1 statement.
		remainingStatements -= 1;
		const page = await db
			.select(NORMALIZATION_COLUMNS)
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
		if (page.length === 0) return;

		const parsedPage = parseNormalizationRows(page);
		const parsed = normalizationPrefixWithinBudget(
			parsedPage,
			remainingStatements,
		);
		if (parsed.length === 0) return;
		remainingStatements -= normalizationStatementUpperBound(parsed);
		const associatedIds = [
			...new Set(parsed.flatMap((row) => [...row.associatedSubmissionIds])),
		];
		const validSubmissionIds = await eventSubmissionIds(
			db,
			eventId,
			associatedIds,
		);
		const attempts: RevisionInsert[] = [];
		const markers: ProcessedOutboxInsert[] = [];
		const processedAt = new Date();

		for (const row of parsed) {
			const normalized = await normalizationAttemptsForRow(
				row,
				eventId,
				validSubmissionIds,
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
		if (parsed.length < parsedPage.length) return;
	}
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

async function trackedSubmissionIds(
	db: Db,
	submissionIds: readonly string[],
): Promise<Set<string>> {
	const tracked = new Set<string>();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		const rows = await db
			.selectDistinct({ submissionId: calendarInviteRevisions.submissionId })
			.from(calendarInviteRevisions)
			.innerJoin(
				emailOutbox,
				eq(calendarInviteRevisions.outboxId, emailOutbox.id),
			)
			.where(
				and(
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
					eq(calendarInviteRevisions.invalid, false),
				),
			);
		for (const row of rows) tracked.add(row.submissionId);
	}
	return tracked;
}

async function sentInviteBaselines(
	db: Db,
	submissionIds: readonly string[],
): Promise<Map<string, InviteBaseline>> {
	const baselines = new Map<string, InviteBaseline>();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		const ranked = db
			.select({
				submissionId: calendarInviteRevisions.submissionId,
				sequence: calendarInviteRevisions.sequence,
				startsAt: calendarInviteRevisions.startsAt,
				endsAt: calendarInviteRevisions.endsAt,
				title: calendarInviteRevisions.title,
				location: calendarInviteRevisions.location,
				to: emailOutbox.to,
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
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
					eq(emailOutbox.status, "sent"),
					eq(calendarInviteRevisions.invalid, false),
					isNotNull(calendarInviteRevisions.sequence),
					isNotNull(calendarInviteRevisions.startsAt),
					isNotNull(calendarInviteRevisions.endsAt),
					isNotNull(calendarInviteRevisions.title),
				),
			)
			.as("ranked_sent_calendar_invites");
		const rows = await db
			.select({
				submissionId: ranked.submissionId,
				sequence: ranked.sequence,
				startsAt: ranked.startsAt,
				endsAt: ranked.endsAt,
				title: ranked.title,
				location: ranked.location,
				to: ranked.to,
			})
			.from(ranked)
			.where(eq(ranked.deliveryRank, 1));
		for (const row of rows) {
			if (
				row.sequence === null ||
				row.startsAt === null ||
				row.endsAt === null ||
				row.title === null
			) {
				continue;
			}
			baselines.set(row.submissionId, {
				start: row.startsAt,
				end: row.endsAt,
				title: row.title,
				location: row.location,
				sequence: row.sequence,
				to: row.to,
			});
		}
	}
	return baselines;
}

async function latestBounces(
	db: Db,
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
		return { ...EMPTY, truncated: true };
	}

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
	const [trackedCandidates, lastSent, latestBounce, recipientById] =
		await Promise.all([
			trackedSubmissionIds(db, candidateIds),
			sentInviteBaselines(db, candidateIds),
			latestBounces(db, candidateIds),
			inviteRecipients(db, candidateIds),
		]);
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
			last.title === invite.title &&
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
			retryAfterBounceId: latestBounce.get(row.id) ?? null,
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

type AttemptFrontier = { sequence: number; stateHash: string };

async function currentInviteStateHashes(
	db: Db,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<Map<string, string>> {
	const submissionIds = [
		...new Set(changes.map((change) => change.submissionId)),
	];
	const currentRows: {
		id: string;
		title: string;
		startsAt: Date | null;
		endsAt: Date | null;
		roomId: string | null;
	}[] = [];
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		currentRows.push(
			...(await db
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
						inArray(
							submissions.id,
							submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
						),
					),
				)),
		);
	}
	const roomIds = [
		...new Set(
			currentRows
				.map((row) => row.roomId)
				.filter((roomId): roomId is string => roomId !== null),
		),
	];
	const roomNames = new Map<string, string>();
	for (let offset = 0; offset < roomIds.length; offset += D1_QUERY_CHUNK) {
		const rows = await db
			.select({ id: rooms.id, name: rooms.name })
			.from(rooms)
			.where(inArray(rooms.id, roomIds.slice(offset, offset + D1_QUERY_CHUNK)));
		for (const row of rows) roomNames.set(row.id, row.name);
	}
	const recipients = await inviteRecipients(db, submissionIds);
	const hashes = new Map<string, string>();
	for (const row of currentRows) {
		const to = recipients.get(row.id);
		const invite = inviteForSubmission(
			row,
			event,
			row.roomId ? roomNames.get(row.roomId) : undefined,
		);
		if (!to || !invite) continue;
		hashes.set(
			row.id,
			await normalizedInviteStateHash(event.id, row.id, to, invite),
		);
	}
	return hashes;
}

async function latestAttemptFrontiers(
	db: Db,
	submissionIds: readonly string[],
): Promise<Map<string, AttemptFrontier>> {
	const frontiers = new Map<string, AttemptFrontier>();
	for (
		let offset = 0;
		offset < submissionIds.length;
		offset += D1_QUERY_CHUNK
	) {
		const rows = await db
			.select({
				submissionId: calendarInviteRevisions.submissionId,
				sequence: calendarInviteRevisions.sequence,
				stateHash: calendarInviteRevisions.stateHash,
			})
			.from(calendarInviteRevisions)
			.innerJoin(
				emailOutbox,
				eq(emailOutbox.id, calendarInviteRevisions.outboxId),
			)
			.where(
				and(
					inArray(
						calendarInviteRevisions.submissionId,
						submissionIds.slice(offset, offset + D1_QUERY_CHUNK),
					),
					inArray(emailOutbox.status, ["sent", "queued", "failed"]),
					eq(calendarInviteRevisions.invalid, false),
					isNotNull(calendarInviteRevisions.sequence),
				),
			)
			.orderBy(
				desc(calendarInviteRevisions.sequence),
				desc(calendarInviteRevisions.createdAt),
				desc(calendarInviteRevisions.id),
			);
		for (const row of rows) {
			if (row.sequence === null || frontiers.has(row.submissionId)) continue;
			frontiers.set(row.submissionId, {
				sequence: row.sequence,
				stateHash: row.stateHash,
			});
		}
	}
	return frontiers;
}

async function claimScheduleSequences(
	db: Db,
	event: EventRow,
	changes: readonly ScheduleChange[],
): Promise<ScheduleChange[]> {
	if (changes.length === 0) return [];
	const [priorFrontiers, currentStateHashes] = await Promise.all([
		latestAttemptFrontiers(
			db,
			changes.map((change) => change.submissionId),
		),
		currentInviteStateHashes(db, event, changes),
	]);
	const claimed: ScheduleChange[] = [];
	const claimedStateHashes = new Map<string, string>();

	for (const change of changes) {
		if (change.to === null) continue;
		const stateHash = await normalizedInviteStateHash(
			event.id,
			change.submissionId,
			change.to,
			change.invite,
		);
		if (currentStateHashes.get(change.submissionId) !== stateHash) continue;
		const prior = priorFrontiers.get(change.submissionId);
		const proposedSequence =
			prior?.stateHash === stateHash
				? prior.sequence
				: Math.max(change.nextSequence, (prior?.sequence ?? -1) + 1);
		const [frontier] = await db
			.insert(calendarInviteSequenceFrontiers)
			.values({
				submissionId: change.submissionId,
				sequence: proposedSequence,
				stateHash,
			})
			.onConflictDoUpdate({
				target: calendarInviteSequenceFrontiers.submissionId,
				set: {
					sequence: sql<number>`case
						when ${calendarInviteSequenceFrontiers.stateHash} = excluded.state_hash
							then max(${calendarInviteSequenceFrontiers.sequence}, excluded.sequence)
						else max(${calendarInviteSequenceFrontiers.sequence} + 1, excluded.sequence)
					end`,
					stateHash: sql`excluded.state_hash`,
					updatedAt: new Date(),
				},
			})
			.returning({ sequence: calendarInviteSequenceFrontiers.sequence });
		if (!frontier) throw new Error("Calendar sequence claim returned no row");
		claimed.push({ ...change, nextSequence: frontier.sequence });
		claimedStateHashes.set(change.submissionId, stateHash);
	}

	// A schedule can move after the pre-claim snapshot. Re-read after every claim:
	// if a newer state claimed first, this drops the stale higher sequence; if the
	// move happens later, its claim necessarily receives the higher sequence.
	const latestStateHashes = await currentInviteStateHashes(db, event, claimed);
	return claimed.filter(
		(change) =>
			latestStateHashes.get(change.submissionId) ===
			claimedStateHashes.get(change.submissionId),
	);
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
	const sendable: ScheduleChange[] = [];
	for (const change of [...changes].sort((a, b) =>
		a.submissionId.localeCompare(b.submissionId),
	)) {
		if (change.to === null) {
			// No speaker or submitter email — surfaced as a failure, not skipped
			// silently; the row stays flagged for a later retry.
			result.failed += 1;
			continue;
		}
		sendable.push(change);
	}

	const byRecipient = new Map<string, RecipientGroup>();
	for (const change of await claimScheduleSequences(db, event, sendable)) {
		if (change.to === null) continue;
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
