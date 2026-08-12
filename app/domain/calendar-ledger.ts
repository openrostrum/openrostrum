import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
	calendarInviteProcessedOutbox,
	calendarInviteRevisions,
	emailOutbox,
	submissions,
} from "~/db/schema";
import { inviteStateHash } from "~/domain/calendar-sequence";
import { sha256Hex } from "~/lib/api-token";
import { normalizeEmail } from "~/lib/auth";
import { inspectIcsAttachment, type ParsedIcsEvent } from "~/lib/ics";

/**
 * The delivery ledger: one row per (invite email, session) describing what that
 * speaker's calendar was told. Both producers — the durable scan and the send
 * paths — index through these functions, so a row written at send time is
 * byte-identical to the scan's.
 */

/** How many rows one query may name — D1 binds parameters per statement. */
export const D1_QUERY_CHUNK = 80;
export const ATTEMPT_INSERT_CHUNK = 8;
export const MARKER_INSERT_CHUNK = 25;
// Attachment metadata is read before any body. Large individual bodies are
// quarantined, while the aggregate cap bounds each Worker's response memory.
export const MAX_ICS_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_NORMALIZATION_ATTACHMENT_BYTES = 1024 * 1024;
export const SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT = 200;
// The only multi-event producer is schedule updates, which select at most this
// many submissions. Larger historical attachments cannot be product output.
export const MAX_ICS_EVENTS_PER_OUTBOX = SCHEDULE_UPDATE_SUBMISSION_BATCH_LIMIT;

export function chunkCount(rows: number, chunkSize: number): number {
	return Math.ceil(rows / chunkSize);
}

/** Stable identity shared by acceptance and schedule-update calendar revisions. */
export function icsUidForSubmission(submissionId: string): string {
	return `submission-${submissionId}@openrostrum`;
}

export function submissionIdFromIcsUid(uid: string): string | null {
	const prefix = "submission-";
	const suffix = "@openrostrum";
	if (!uid.startsWith(prefix) || !uid.endsWith(suffix)) return null;
	const submissionId = uid.slice(prefix.length, -suffix.length);
	return submissionId.length > 0 ? submissionId : null;
}

/**
 * The outbox rows that carry calendar invites. Every ledger query filters on
 * exactly this — a row the scan would look at and a row a send indexes have to
 * be the same set, or one path silently leaves work for the other.
 */
export function calendarInviteOutboxFilter() {
	return or(
		like(emailOutbox.dedupeKey, "decision:accept:%"),
		like(emailOutbox.dedupeKey, "schedule-update:%"),
	);
}

export const NORMALIZATION_METADATA_COLUMNS = {
	id: emailOutbox.id,
	dedupeKey: emailOutbox.dedupeKey,
	to: emailOutbox.to,
	createdAt: emailOutbox.createdAt,
	hasIcs: sql<number>`case when ${emailOutbox.icsAttachment} is null then 0 else 1 end`,
	icsBytes: sql<number>`coalesce(length(cast(${emailOutbox.icsAttachment} as blob)), 0)`,
};

export type NormalizationMetadataRow = {
	id: string;
	dedupeKey: string | null;
	to: string;
	createdAt: Date;
	hasIcs: number;
	icsBytes: number;
};

export type NormalizationRow = {
	id: string;
	dedupeKey: string | null;
	to: string;
	ics: string | null;
	attachmentOversized: boolean;
	createdAt: Date;
};

export type ParsedNormalizationRow = NormalizationRow & {
	invites: ParsedIcsEvent[];
	acceptanceSubmissionId: string | null;
	associatedSubmissionIds: Set<string>;
	icsEventCount: number;
};

export async function normalizationRowsWithBodies(
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

type RevisionInsert = typeof calendarInviteRevisions.$inferInsert;
type ProcessedOutboxInsert = typeof calendarInviteProcessedOutbox.$inferInsert;

function acceptanceSubmissionId(dedupeKey: string | null): string | null {
	if (!dedupeKey?.startsWith("decision:accept:")) return null;
	const submissionId = dedupeKey.slice(dedupeKey.lastIndexOf(":") + 1);
	return submissionId.length > 0 ? submissionId : null;
}

export function parseNormalizationRows(
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

/**
 * Revisions and their processed markers land in ONE batch: a marker without its
 * revisions is a row the scan will never look at again, so it would silently
 * lower every affected session's delivered SEQUENCE frontier.
 */
async function writeLedgerEntries(
	db: Db,
	attempts: readonly RevisionInsert[],
	markers: readonly ProcessedOutboxInsert[],
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

/** Index parsed rows into the ledger; returns how many outbox rows were marked. */
export async function writeParsedInviteRows(
	db: Db,
	eventId: string,
	parsed: readonly ParsedNormalizationRow[],
): Promise<number> {
	if (parsed.length === 0) return 0;
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

	await writeLedgerEntries(db, attempts, markers);
	return markers.length;
}

/** How many statements `writeParsedInviteRows` may spend on these rows. */
export function ledgerWriteStatementUpperBound(
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

/**
 * Index the invites THIS request just wrote: leaving them to the durable scan
 * re-arms it after every send round, so the agenda keeps offering to go check
 * history on an event nobody neglected. A failure here throws; the emails are
 * already durable, so the next scan re-indexes them and no send is repeated.
 */
export async function recordSentCalendarInvites(
	db: Db,
	eventId: string,
	dedupeKeys: readonly string[],
): Promise<void> {
	const keys = [...new Set(dedupeKeys)];
	for (let offset = 0; offset < keys.length; offset += D1_QUERY_CHUNK) {
		const metadata = await db
			.select(NORMALIZATION_METADATA_COLUMNS)
			.from(emailOutbox)
			.where(
				and(
					eq(emailOutbox.eventId, eventId),
					calendarInviteOutboxFilter(),
					inArray(
						emailOutbox.dedupeKey,
						keys.slice(offset, offset + D1_QUERY_CHUNK),
					),
				),
			);
		if (metadata.length === 0) continue;
		const rows = await normalizationRowsWithBodies(db, metadata);
		await writeParsedInviteRows(db, eventId, parseNormalizationRows(rows));
	}
}
