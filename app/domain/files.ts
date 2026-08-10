import { and, desc, eq, isNull, ne, type SQL, sql } from "drizzle-orm";
import { data } from "react-router";
import type { Db } from "~/db";
import {
	contacts,
	type FILE_KIND,
	fileComments,
	files,
	submissions,
	taskAssignments,
} from "~/db/schema";
import { HEADSHOT_MAX_BYTES, HEADSHOT_TYPES } from "~/lib/headshot";
import { likeContains } from "~/lib/like";
import type { BadgeTone } from "~/ui";

export type HeadshotUploadResult =
	| { ok: true; r2Key: string }
	| { ok: false; error: string };

/**
 * THE speaker-headshot write path — portal self-service and the admin contact
 * record both go through here, so `contacts.headshotKey` (what avatars render)
 * and the versioned `files` history can never disagree. Validation failures
 * return; storage failures throw (callers map them to their surface's copy).
 */
export async function uploadHeadshot(
	env: Env,
	db: Db,
	args: { eventId: string; contactId: string; file: FormDataEntryValue | null },
): Promise<HeadshotUploadResult> {
	const { eventId, contactId, file } = args;
	if (!(file instanceof File) || file.size === 0) {
		return { ok: false, error: "Choose an image first." };
	}
	const ext = HEADSHOT_TYPES[file.type];
	if (!ext) {
		return { ok: false, error: "Use a PNG, JPEG, or WebP image." };
	}
	if (file.size > HEADSHOT_MAX_BYTES) {
		return { ok: false, error: "Keep the image under 5 MB." };
	}
	const r2Key = `headshots/${eventId}/${contactId}/${crypto.randomUUID()}.${ext}`;
	const bytes = await file.arrayBuffer();
	await env.BLOBS.put(r2Key, bytes, {
		httpMetadata: { contentType: file.type },
	});
	const [prior] = await db
		.select({ version: files.version })
		.from(files)
		.where(and(eq(files.contactId, contactId), eq(files.kind, "headshot")))
		.orderBy(desc(files.version))
		.limit(1);
	await db.batch([
		db.insert(files).values({
			eventId,
			contactId,
			r2Key,
			fileName: file.name,
			kind: "headshot",
			contentType: file.type,
			sizeBytes: file.size,
			version: (prior?.version ?? 0) + 1,
		}),
		db
			.update(contacts)
			.set({ headshotKey: r2Key })
			.where(eq(contacts.id, contactId)),
	]);
	return { ok: true, r2Key };
}

/** Streams a private R2 object inline (headshots, portal logos). */
export async function serveBlob(env: Env, key: string): Promise<Response> {
	const object = await env.BLOBS.get(key);
	if (!object) throw data(null, { status: 404 });
	return new Response(object.body, {
		headers: {
			"Content-Type":
				object.httpMetadata?.contentType ?? "application/octet-stream",
			"Cache-Control": "private, max-age=3600",
		},
	});
}

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_CONSTRAINTS =
	"PDF, PowerPoint, Keynote, Word, Excel, images, ZIP, or text — up to 25 MB.";

/** Extension allowlist doubling as kind derivation — `accept=` is a hint,
 * this map is the enforcement (admin and portal upload loops share it). */
export const EXT_KIND: Record<string, (typeof FILE_KIND)[number]> = {
	pdf: "slides",
	ppt: "slides",
	pptx: "slides",
	key: "slides",
	doc: "doc",
	docx: "doc",
	txt: "doc",
	md: "doc",
	xls: "doc",
	xlsx: "doc",
	png: "other",
	jpg: "other",
	jpeg: "other",
	zip: "other",
};

export const UPLOAD_ACCEPT = Object.keys(EXT_KIND)
	.map((ext) => `.${ext}`)
	.join(",");

/** Upload failures ride the redirect as CODES (the form posts to
 * /files/upload, not the page, so actionData can't reach the library);
 * pages map codes to copy — free text never rides a URL. */
export const UPLOAD_ERRORS = {
	"choose-file": "Choose a file first.",
	"bad-type": UPLOAD_CONSTRAINTS,
	"too-large": "Keep the file under 25 MB.",
	"foreign-submission": "That submission does not belong to this event.",
	"no-event": "No event is configured yet.",
	failed: "The upload failed — please try again.",
} as const;

/** One rule for how long a deny note / file comment may be, every caller. */
export const REVIEW_NOTE_MAX = 2000;

/**
 * A repeat of the thread's latest comment only counts as a double-submit
 * inside this window; past it, an identical re-post is a deliberate bump —
 * comments send no notifications, so a re-ping is the author's only nudge.
 */
export const COMMENT_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

/**
 * THE file-comment write path (portal and admin) — re-posting the thread's
 * latest comment verbatim within the dedupe window is a double-submit
 * (double-click, retry, back-button repost), so it lands nothing and reports
 * `deduped`. One conditional INSERT…SELECT: a read-then-insert pair would let
 * two overlapping POSTs both pass the read (D1 serializes statements, not
 * request interleavings), which is the very race being closed. "Latest" is
 * max(rowid) — insertion order — because createdAt is second-granular and
 * quick exchanges tie.
 */
export async function addFileComment(
	db: Db,
	values: {
		fileId: string;
		authorId: string;
		authorName: string;
		body: string;
	},
	now: Date = new Date(),
): Promise<{ deduped: boolean }> {
	const nowEpoch = Math.floor(now.getTime() / 1000);
	const windowSeconds = COMMENT_DEDUPE_WINDOW_MS / 1000;
	const result = await db.run(sql`
		insert into ${fileComments} (id, file_id, author_id, author_name, body, created_at)
		select ${crypto.randomUUID()}, ${values.fileId}, ${values.authorId},
			${values.authorName}, ${values.body}, ${nowEpoch}
		where not exists (
			select 1 from ${fileComments}
			where rowid = (
					select max(rowid) from ${fileComments}
					where ${fileComments.fileId} = ${values.fileId}
				)
				and ${fileComments.authorId} = ${values.authorId}
				and ${fileComments.body} = ${values.body}
				and ${nowEpoch} - ${fileComments.createdAt} < ${windowSeconds}
		)`);
	return { deduped: result.meta.changes === 0 };
}

export type UploadErrorCode = keyof typeof UPLOAD_ERRORS;

/** File review states in ADMIN words (the portal has its own projection). */
export const FILE_REVIEW_LABEL: Record<string, string> = {
	pending: "Pending review",
	approved: "Approved",
	denied: "Changes requested",
	none: "Not reviewed",
};

export const FILE_REVIEW_TONE: Record<string, BadgeTone> = {
	pending: "info",
	approved: "success",
	denied: "danger",
	none: "neutral",
};

export function uploadKindForName(
	fileName: string,
): (typeof FILE_KIND)[number] | null {
	const ext = (fileName.split(".").pop() ?? "").toLowerCase();
	return EXT_KIND[ext] ?? null;
}

export type UploadCheck =
	| { ok: true; kind: (typeof FILE_KIND)[number] }
	| { ok: false; code: "bad-type" | "too-large"; error: string };

export function checkUpload(file: File): UploadCheck {
	const kind = uploadKindForName(file.name);
	if (!kind) {
		return { ok: false, code: "bad-type", error: UPLOAD_ERRORS["bad-type"] };
	}
	if (file.size > UPLOAD_MAX_BYTES) {
		return {
			ok: false,
			code: "too-large",
			error: UPLOAD_ERRORS["too-large"],
		};
	}
	return { ok: true, kind };
}

/** Chain identity: one deliverable slot re-uploaded over time — task uploads
 * chain per assignment, everything else per target + lowercased filename.
 * The ONLY encoding of the rule; TS callers resolve keys through SQL. */
export const GROUP_KEY_SQL = sql<string>`case
	when ${files.taskAssignmentId} is not null then 'a:' || ${files.taskAssignmentId}
	when ${files.submissionId} is not null then 's:' || ${files.submissionId} || ':' || lower(${files.fileName})
	when ${files.contactId} is not null then 'c:' || ${files.contactId} || ':' || lower(${files.fileName})
	else 'e:' || ${files.eventId} || ':' || lower(${files.fileName})
end`;

export type FileRow = typeof files.$inferSelect;

/** Every file of the event, ranked within its chain (rn = 1 is latest,
 * version_count spans the chain) — the single source of "latest", shared by
 * the library and the ZIP export so they can never disagree. */
export function rankedChainsSql(eventId: string): SQL {
	return sql`(
		select ${files}.*,
			${GROUP_KEY_SQL} as grp,
			row_number() over (
				partition by ${GROUP_KEY_SQL}
				order by ${files.version} desc, ${files.createdAt} desc, ${files.id} desc
			) as rn,
			count(*) over (partition by ${GROUP_KEY_SQL}) as version_count
		from ${files}
		where ${files.eventId} = ${eventId}
	)`;
}

type ChainValues = {
	eventId: string;
	submissionId: string | null;
	contactId: string | null;
	taskAssignmentId: string | null;
	r2Key: string;
	fileName: string;
	kind: (typeof FILE_KIND)[number];
	contentType: string;
	sizeBytes: number;
	reviewStatus: FileRow["reviewStatus"];
	sharedToPortal: boolean;
};

type BatchItem = Parameters<Db["batch"]>[0][number];

/** Appends a row to its chain in ONE batch (D1 has no transactions): the
 * insert mints version = max+1 via a scalar subquery (a double-submit can't
 * duplicate versions), the portal-shared flag migrates to this latest version
 * (the portal lists shared rows flat — one flagged version per chain), and
 * caller statements (e.g. the assignment flip) commit atomically with it. */
async function appendToChain(
	db: Db,
	chain: SQL,
	values: ChainValues,
	alongside: BatchItem[] = [],
): Promise<{ id: string; version: number }> {
	const id = crypto.randomUUID();
	const [inserted] = await db.batch([
		db
			.insert(files)
			.values({
				id,
				eventId: values.eventId,
				submissionId: values.submissionId,
				contactId: values.contactId,
				taskAssignmentId: values.taskAssignmentId,
				r2Key: values.r2Key,
				fileName: values.fileName,
				kind: values.kind,
				contentType: values.contentType,
				sizeBytes: values.sizeBytes,
				version: sql`coalesce((select max(${files.version}) from ${files} where ${chain}), 0) + 1`,
				reviewStatus: values.reviewStatus,
				sharedToPortal: values.sharedToPortal,
			})
			.returning({ id: files.id, version: files.version }),
		db
			.update(files)
			.set({ sharedToPortal: true })
			.where(
				and(
					eq(files.id, id),
					sql`(select count(*) from ${files}
						where ${chain} and ${files.id} != ${id} and ${files.sharedToPortal} = 1) > 0`,
				),
			),
		db
			.update(files)
			.set({ sharedToPortal: false })
			.where(and(chain, ne(files.id, id))),
		...alongside,
	]);
	const row = inserted[0];
	if (!row) throw new Error("file insert failed");
	return row;
}

export type DirectUploadInput = {
	eventId: string;
	submissionId: string | null;
	r2Key: string;
	fileName: string;
	kind: (typeof FILE_KIND)[number];
	contentType: string;
	sizeBytes: number;
	sharedToPortal: boolean;
};

/** Admin (non-task) upload: chains per submission-or-event + filename. */
export async function insertDirectUpload(
	db: Db,
	input: DirectUploadInput,
): Promise<{ id: string; version: number }> {
	const scope = input.submissionId
		? eq(files.submissionId, input.submissionId)
		: and(isNull(files.submissionId), isNull(files.contactId));
	const chain = and(
		eq(files.eventId, input.eventId),
		isNull(files.taskAssignmentId),
		scope,
		sql`lower(${files.fileName}) = lower(${input.fileName})`,
	) as SQL;
	return appendToChain(db, chain, {
		...input,
		contactId: null,
		taskAssignmentId: null,
		reviewStatus: "none",
	});
}

export type TaskUploadInput = {
	eventId: string;
	submissionId: string | null;
	contactId: string | null;
	taskAssignmentId: string;
	r2Key: string;
	fileName: string;
	kind: (typeof FILE_KIND)[number];
	contentType: string;
	sizeBytes: number;
};

/** Speaker file-request upload: chains per assignment, lands in the review
 * queue, and flips the assignment to pending_feedback in the same batch. */
export async function insertTaskUpload(
	db: Db,
	input: TaskUploadInput,
): Promise<{ id: string; version: number }> {
	const chain = eq(files.taskAssignmentId, input.taskAssignmentId) as SQL;
	return appendToChain(
		db,
		chain,
		{ ...input, reviewStatus: "pending", sharedToPortal: false },
		[
			db
				.update(taskAssignments)
				.set({ status: "pending_feedback", fileKey: input.r2Key })
				.where(eq(taskAssignments.id, input.taskAssignmentId)),
		],
	);
}

/** Review exists ONLY for task uploads. Approve completes the owning task;
 * deny reopens it (back to incomplete) so the portal offers the re-upload
 * path with the note as "Changes requested". No email either way — parity. */
export async function setFileReview(
	db: Db,
	file: { id: string; taskAssignmentId: string },
	decision: "approved" | "denied",
	note?: string | null,
): Promise<void> {
	await db.batch([
		db
			.update(files)
			.set(
				decision === "approved"
					? { reviewStatus: "approved", reviewNote: null }
					: { reviewStatus: "denied", reviewNote: note?.trim() || null },
			)
			.where(eq(files.id, file.id)),
		db
			.update(taskAssignments)
			.set(
				decision === "approved"
					? { status: "complete", completedAt: new Date() }
					: { status: "incomplete", completedAt: null },
			)
			.where(eq(taskAssignments.id, file.taskAssignmentId)),
	]);
}

export type FileLibraryRow = {
	id: string;
	fileName: string;
	kind: string;
	sizeBytes: number | null;
	version: number;
	versionCount: number;
	reviewStatus: FileRow["reviewStatus"];
	sharedToPortal: boolean;
	createdAt: Date;
	submissionId: string | null;
	submissionTitle: string | null;
	contactId: string | null;
	speakerName: string | null;
};

export type FileLibraryFilters = {
	q?: string;
	reviewStatus?: FileRow["reviewStatus"];
	submissionId?: string;
	page?: number;
	pageSize?: number;
};

/** The central library: ONE row per version chain (latest metadata + chain
 * version count), ranked in SQL so pagination never splits a chain. */
export async function listFileGroups(
	db: Db,
	eventId: string,
	filters: FileLibraryFilters = {},
): Promise<{ rows: FileLibraryRow[]; total: number }> {
	const page = Math.max(1, filters.page ?? 1);
	const pageSize = filters.pageSize ?? 50;
	const conditions = [sql`r.rn = 1`];
	if (filters.reviewStatus) {
		conditions.push(sql`r.review_status = ${filters.reviewStatus}`);
	}
	if (filters.submissionId) {
		conditions.push(sql`r.submission_id = ${filters.submissionId}`);
	}
	if (filters.q) {
		const like = likeContains(filters.q);
		conditions.push(
			sql`(r.file_name like ${like} escape '\\'
				or s.title like ${like} escape '\\'
				or (c.first_name || ' ' || c.last_name) like ${like} escape '\\')`,
		);
	}
	const where = sql.join(conditions, sql` and `);
	const base = sql`
		from ${rankedChainsSql(eventId)} r
		left join ${submissions} s on s.id = r.submission_id
		left join ${contacts} c on c.id = r.contact_id
		where ${where}`;

	type Raw = {
		id: string;
		file_name: string;
		kind: string;
		size_bytes: number | null;
		version: number;
		version_count: number;
		review_status: FileRow["reviewStatus"];
		shared_to_portal: number;
		created_at: number;
		submission_id: string | null;
		submission_title: string | null;
		contact_id: string | null;
		first_name: string | null;
		last_name: string | null;
	};
	const rows = await db.all<Raw>(sql`
		select r.id, r.file_name, r.kind, r.size_bytes, r.version, r.version_count,
			r.review_status, r.shared_to_portal, r.created_at,
			r.submission_id, s.title as submission_title,
			r.contact_id, c.first_name, c.last_name
		${base}
		order by r.created_at desc, r.id desc
		limit ${pageSize} offset ${(page - 1) * pageSize}`);
	const [count] = await db.all<{ total: number }>(
		sql`select count(*) as total ${base}`,
	);
	return {
		total: count?.total ?? 0,
		rows: rows.map((r) => ({
			id: r.id,
			fileName: r.file_name,
			kind: r.kind,
			sizeBytes: r.size_bytes,
			version: r.version,
			versionCount: r.version_count,
			reviewStatus: r.review_status,
			sharedToPortal: r.shared_to_portal === 1,
			// timestamps persist as unix seconds (schema convention)
			createdAt: new Date(r.created_at * 1000),
			submissionId: r.submission_id,
			submissionTitle: r.submission_title,
			contactId: r.contact_id,
			speakerName: r.first_name ? `${r.first_name} ${r.last_name}` : null,
		})),
	};
}

/** A file's whole version chain, descending — index 0 is the latest.
 * Null when the id doesn't resolve inside the event. */
export async function getFileChain(
	db: Db,
	eventId: string,
	fileId: string,
): Promise<{ versions: FileRow[] } | null> {
	// The subquery's `files` shadows the outer one — both sides evaluate the
	// same chain-key expression on their own row.
	const versions = await db
		.select()
		.from(files)
		.where(
			and(
				eq(files.eventId, eventId),
				sql`${GROUP_KEY_SQL} = (select ${GROUP_KEY_SQL} from ${files} where ${files.id} = ${fileId} and ${files.eventId} = ${eventId})`,
			),
		)
		.orderBy(desc(files.version), desc(files.createdAt));
	if (versions.length === 0) return null;
	return { versions };
}

/** Windows-and-zip-safe display name (also used for Content-Disposition). */
export function sanitizeFileName(name: string): string {
	const safe = name.replace(/[^\w.\- ()]+/g, "_").trim();
	return safe || "file";
}

/** The one shape file bytes leave the app in — attachment, private, no-store. */
export function fileAttachmentResponse(
	body: ReadableStream | null,
	file: Pick<FileRow, "fileName" | "contentType">,
): Response {
	return new Response(body, {
		headers: {
			"Content-Type": file.contentType ?? "application/octet-stream",
			"Content-Disposition": `attachment; filename="${sanitizeFileName(file.fileName)}"`,
			"Cache-Control": "private, no-store",
		},
	});
}
