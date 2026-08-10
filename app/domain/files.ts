import { and, desc, eq, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
	contacts,
	type FILE_KIND,
	files,
	submissions,
	taskAssignments,
} from "~/db/schema";
import { likeContains } from "~/lib/like";
import type { BadgeTone } from "~/ui";

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_CONSTRAINTS =
	"PDF, PowerPoint, Keynote, Word, Excel, images, ZIP, or text — up to 25 MB.";

/** Extension allowlist doubling as kind derivation — `accept=` is a hint, this
 * map is the enforcement. Shared by the admin and speaker-portal upload loops. */
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

/** Upload failures round-trip as CODES in a redirect query param (the upload
 * form posts to /files/upload, not the page, so actionData can't reach the
 * library) — pages map codes to copy, and no free text ever rides the URL. */
export const UPLOAD_ERRORS = {
	"choose-file": "Choose a file first.",
	"bad-type": "That file type isn't accepted — see the stated formats.",
	"too-large": "Keep the file under 25 MB.",
	"foreign-submission": "That submission does not belong to this event.",
	"foreign-speaker": "That speaker does not belong to this event.",
	"no-event": "No event is configured yet.",
	failed: "The upload failed — please try again.",
} as const;

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
		return { ok: false, code: "bad-type", error: UPLOAD_CONSTRAINTS };
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

/**
 * A "version chain" is one deliverable slot re-uploaded over time. Portal
 * task uploads chain per task assignment (any filename replaces the prior
 * one); everything else chains per attachment target + case-insensitive
 * filename. Latest = highest version — there is no stored flag to drift.
 * This SQL expression is the ONLY encoding of chain identity; TS callers
 * resolve a row's key through SQL, never a re-implementation.
 */
export const GROUP_KEY_SQL = sql<string>`case
	when ${files.taskAssignmentId} is not null then 'a:' || ${files.taskAssignmentId}
	when ${files.submissionId} is not null then 's:' || ${files.submissionId} || ':' || lower(${files.fileName})
	when ${files.contactId} is not null then 'c:' || ${files.contactId} || ':' || lower(${files.fileName})
	else 'e:' || ${files.eventId} || ':' || lower(${files.fileName})
end`;

export type FileRow = typeof files.$inferSelect;

/**
 * Every file of the event, ranked within its version chain (rn = 1 is the
 * latest; version_count spans the chain). The single source for "latest of a
 * chain" — the library and the ZIP export must never disagree on it.
 */
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

/** The direct (non-task) chain a new admin upload belongs to. */
function directChain(target: {
	eventId: string;
	submissionId: string | null;
	contactId: string | null;
	fileName: string;
}): SQL {
	const scope = target.submissionId
		? eq(files.submissionId, target.submissionId)
		: target.contactId
			? and(isNull(files.submissionId), eq(files.contactId, target.contactId))
			: and(isNull(files.submissionId), isNull(files.contactId));
	return and(
		eq(files.eventId, target.eventId),
		isNull(files.taskAssignmentId),
		scope,
		sql`lower(${files.fileName}) = lower(${target.fileName})`,
	) as SQL;
}

export type DirectUploadInput = {
	eventId: string;
	submissionId: string | null;
	contactId: string | null;
	r2Key: string;
	fileName: string;
	kind: (typeof FILE_KIND)[number];
	contentType: string;
	sizeBytes: number;
	sharedToPortal: boolean;
};

/**
 * Inserts a direct upload at the chain's next version in ONE statement
 * (version = max+1 computed inside the INSERT, so a double-submit can't mint
 * two rows with the same version), then migrates the portal-shared flag to
 * this latest version: the portal lists shared rows flat, so the flag lives
 * on exactly one version per chain — inherited forward, cleared behind.
 */
export async function insertDirectUpload(
	db: Db,
	input: DirectUploadInput,
): Promise<{ id: string; version: number }> {
	const id = crypto.randomUUID();
	const chain = directChain(input);
	await db.run(sql`
		insert into ${files} (id, event_id, submission_id, contact_id, task_assignment_id,
			r2_key, file_name, kind, content_type, size_bytes, version, review_status,
			shared_to_portal, created_at)
		select ${id}, ${input.eventId}, ${input.submissionId}, ${input.contactId}, null,
			${input.r2Key}, ${input.fileName}, ${input.kind}, ${input.contentType},
			${input.sizeBytes},
			coalesce((select max(${files.version}) from ${files} where ${chain}), 0) + 1,
			'none', ${input.sharedToPortal ? 1 : 0}, ${Math.floor(Date.now() / 1000)}`);
	await db.batch([
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
	]);
	const [row] = await db
		.select({ id: files.id, version: files.version })
		.from(files)
		.where(eq(files.id, id))
		.limit(1);
	if (!row) throw new Error("direct upload insert failed");
	return row;
}

/**
 * Review decision on an upload. Approve completes the owning task; deny
 * reopens it (status back to incomplete) so the speaker's portal offers the
 * re-upload path again, with the note rendered as "Changes requested".
 * Deny sends no email by design — Sessionboard parity.
 */
export async function setFileReview(
	db: Db,
	file: Pick<FileRow, "id" | "taskAssignmentId">,
	decision: "approved" | "denied",
	note?: string | null,
): Promise<void> {
	const fileUpdate = db
		.update(files)
		.set(
			decision === "approved"
				? { reviewStatus: "approved", reviewNote: null }
				: { reviewStatus: "denied", reviewNote: note?.trim() || null },
		)
		.where(eq(files.id, file.id));
	if (!file.taskAssignmentId) {
		await fileUpdate;
		return;
	}
	await db.batch([
		fileUpdate,
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

/**
 * The central library: ONE row per version chain, carrying the latest
 * version's metadata plus the chain's version count. Ranking happens in SQL
 * (window over the chain key) so pagination never splits a chain.
 */
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

/** A file plus its whole version chain (descending — index 0 is latest). */
export async function getFileChain(
	db: Db,
	eventId: string,
	fileId: string,
): Promise<{ file: FileRow; versions: FileRow[] } | null> {
	const [file] = await db
		.select()
		.from(files)
		.where(and(eq(files.id, fileId), eq(files.eventId, eventId)))
		.limit(1);
	if (!file) return null;
	// The subquery's `files` shadows the outer one, so both sides of the
	// comparison evaluate the SAME chain-key expression on their own row.
	const versions = await db
		.select()
		.from(files)
		.where(
			and(
				eq(files.eventId, eventId),
				sql`${GROUP_KEY_SQL} = (select ${GROUP_KEY_SQL} from ${files} where ${files.id} = ${fileId})`,
			),
		)
		.orderBy(desc(files.version), desc(files.createdAt));
	return { file, versions };
}

/** Windows-and-zip-safe display name (also used for Content-Disposition). */
export function sanitizeFileName(name: string): string {
	const safe = name.replace(/[^\w.\- ()]+/g, "_").trim();
	return safe || "file";
}
