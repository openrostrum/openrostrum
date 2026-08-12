import {
	and,
	desc,
	eq,
	isNotNull,
	isNull,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
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
		.where(
			and(
				eq(files.eventId, eventId),
				eq(files.contactId, contactId),
				eq(files.kind, "headshot"),
			),
		)
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

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FileCommentWrite = {
	fileId: string;
	authorId: string | null;
	authorName: string;
	body: string;
};

function sameComment(
	existing: FileCommentWrite | undefined,
	comment: FileCommentWrite,
): boolean {
	return (
		existing?.fileId === comment.fileId &&
		existing.authorId === comment.authorId &&
		(existing.authorId !== null ||
			existing.authorName === comment.authorName) &&
		existing.body === comment.body
	);
}

function commentAuthorIdentity(comment: FileCommentWrite): [string, string] {
	return comment.authorId === null
		? ["name", comment.authorName]
		: ["id", comment.authorId];
}

async function collisionCommentId(
	requestedId: string,
	comment: FileCommentWrite,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify([
				requestedId,
				comment.fileId,
				commentAuthorIdentity(comment),
				comment.body,
			]),
		),
	);
	const bytes = Array.from(new Uint8Array(digest).slice(0, 16));
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * THE file-comment write path (portal and admin). The client-minted key IS
 * the row id; replay conflicts compare the logical payload. For identified users,
 * the mutable display-name snapshot is not identity. A key colliding with other
 * content moves to a deterministic fallback, so its own replay stays safe.
 */
export async function addFileComment(
	db: Db,
	values: { key: FormDataEntryValue | null } & FileCommentWrite,
): Promise<{ deduped: boolean }> {
	const { key, ...comment } = values;
	const requestedId =
		typeof key === "string" && UUID_RE.test(key)
			? key.toLowerCase()
			: crypto.randomUUID();
	const insert = (id: string) =>
		db
			.insert(fileComments)
			.values({ id, ...comment })
			.onConflictDoNothing({ target: fileComments.id })
			.returning({ id: fileComments.id });
	const find = async (id: string) =>
		(
			await db
				.select({
					fileId: fileComments.fileId,
					authorId: fileComments.authorId,
					authorName: fileComments.authorName,
					body: fileComments.body,
				})
				.from(fileComments)
				.where(eq(fileComments.id, id))
				.limit(1)
		)[0];

	if ((await insert(requestedId)).length > 0) return { deduped: false };
	if (sameComment(await find(requestedId), comment)) return { deduped: true };

	const fallbackId = await collisionCommentId(requestedId, comment);
	if ((await insert(fallbackId)).length > 0) return { deduped: false };
	if (sameComment(await find(fallbackId), comment)) return { deduped: true };
	throw new Error("Could not allocate a unique file-comment id");
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

/** Chain identity: one deliverable slot re-uploaded over time — a person's
 * headshot chains per (event, contact) because a contact has exactly one face
 * whatever the file is called, task uploads chain per assignment, everything
 * else per target + lowercased filename.
 * The ONLY encoding of the rule; TS callers resolve keys through SQL. */
export const GROUP_KEY_SQL = sql<string>`case
	when ${files.kind} = 'headshot' then 'h:' || ${files.eventId} || ':' || ${files.contactId}
	when ${files.taskAssignmentId} is not null then 'a:' || ${files.taskAssignmentId}
	when ${files.submissionId} is not null then 's:' || ${files.submissionId} || ':' || lower(${files.fileName})
	when ${files.contactId} is not null then 'c:' || ${files.contactId} || ':' || lower(${files.fileName})
	else 'e:' || ${files.eventId} || ':' || lower(${files.fileName})
end`;

export function currentHeadshotsSql(eventId: string, contactId?: string): SQL {
	const contactFilter = contactId ? sql`and contact_id = ${contactId}` : sql``;
	return sql`(
		select id, event_id, contact_id, r2_key
		from (
			select id, event_id, contact_id, r2_key,
				row_number() over (
					partition by event_id, contact_id
					order by version desc, created_at desc, id desc
				) as position
			from ${files}
			where kind = 'headshot'
				and event_id = ${eventId}
				${contactFilter}
		) ranked
		where position = 1
	)`;
}

export type FileRow = typeof files.$inferSelect;

/** Every event file with one canonical presentation key. A direct row joins a
 * unique task chain only after either side proves it is a later version; two
 * unrelated v1 rows with the same filename remain independent. */
export function canonicalRowsSql(eventId: string): SQL {
	return sql`(
		with task_matches as (
			select task_file.event_id, task_file.submission_id,
				lower(task_file.file_name) as file_name_key,
				min(task_file.task_assignment_id) as assignment_id,
				count(distinct task_file.task_assignment_id) as assignment_count,
				max(task_file.version) as task_max_version
			from ${files} task_file
			where task_file.event_id = ${eventId}
				and task_file.submission_id is not null
				and task_file.task_assignment_id is not null
			group by task_file.event_id, task_file.submission_id,
				lower(task_file.file_name)
		), direct_matches as (
			select direct_file.event_id, direct_file.submission_id,
				lower(direct_file.file_name) as file_name_key,
				max(direct_file.version) as direct_max_version
			from ${files} direct_file
			where direct_file.event_id = ${eventId}
				and direct_file.submission_id is not null
				and direct_file.task_assignment_id is null
			group by direct_file.event_id, direct_file.submission_id,
				lower(direct_file.file_name)
		)
		select ${files}.*,
			case
				when ${files.taskAssignmentId} is null
					and tm.assignment_count = 1
					and (tm.task_max_version > 1 or dm.direct_max_version > 1)
				then tm.assignment_id
				else ${files.taskAssignmentId}
			end as canonical_task_assignment_id,
			case
				when ${files.taskAssignmentId} is null
					and tm.assignment_count = 1
					and (tm.task_max_version > 1 or dm.direct_max_version > 1)
				then 'a:' || tm.assignment_id
				else ${GROUP_KEY_SQL}
			end as grp
		from ${files}
		left join task_matches tm
			on tm.event_id = ${files.eventId}
			and tm.submission_id = ${files.submissionId}
			and tm.file_name_key = lower(${files.fileName})
		left join direct_matches dm
			on dm.event_id = ${files.eventId}
			and dm.submission_id = ${files.submissionId}
			and dm.file_name_key = lower(${files.fileName})
		where ${files.eventId} = ${eventId}
	)`;
}

/** One row per logical version, ranked latest-first inside its canonical key.
 * A duplicate direct/task row with the same version keeps the task-owned row. */
export function rankedChainsSql(eventId: string): SQL {
	const canonical = canonicalRowsSql(eventId);
	return sql`(
		select logical.*,
			row_number() over (
				partition by logical.grp
				order by logical.version desc, logical.created_at desc, logical.id desc
			) as rn,
			count(*) over (partition by logical.grp) as version_count,
			first_value(logical.review_status) over (
				partition by logical.grp
				order by case when logical.task_assignment_id is null then 1 else 0 end,
					logical.version desc, logical.created_at desc, logical.id desc
			) as canonical_review_status,
			max(logical.shared_to_portal) over (
				partition by logical.grp
			) as canonical_shared_to_portal
		from (
			select c.*,
				row_number() over (
					partition by c.grp, c.version
					order by case when c.task_assignment_id is null then 1 else 0 end,
						c.created_at desc, c.id desc
				) as canonical_position
			from ${canonical} c
		) logical
		where logical.canonical_position = 1
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

/** Appends one physical upload atomically. `maxVersion` may bridge direct
 * and task sources; `flagChain` never does, preserving each source's access
 * policy while the central library presents one logical deliverable. */
async function appendToChain(
	db: Db,
	maxVersion: SQL,
	flagChain: SQL,
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
				version: sql`coalesce((${maxVersion}), 0) + 1`,
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
						where ${flagChain} and ${files.id} != ${id} and ${files.sharedToPortal} = 1) > 0`,
				),
			),
		db
			.update(files)
			.set({ sharedToPortal: false })
			.where(and(flagChain, ne(files.id, id))),
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

/** Admin uploads stay direct resources. Version allocation can bridge one
 * existing task chain, but never changes speaker ownership or task lifecycle. */
export async function insertDirectUpload(
	db: Db,
	input: DirectUploadInput,
): Promise<{ id: string; version: number }> {
	const scope = input.submissionId
		? eq(files.submissionId, input.submissionId)
		: and(isNull(files.submissionId), isNull(files.contactId));
	const directChain = and(
		eq(files.eventId, input.eventId),
		isNull(files.taskAssignmentId),
		scope,
		sql`lower(${files.fileName}) = lower(${input.fileName})`,
	) as SQL;
	const versionScope = input.submissionId
		? (or(
				directChain,
				and(
					eq(files.eventId, input.eventId),
					eq(files.submissionId, input.submissionId),
					isNotNull(files.taskAssignmentId),
					sql`lower(${files.fileName}) = lower(${input.fileName})`,
					sql`(select count(distinct candidate.task_assignment_id)
						from ${files} candidate
						where candidate.event_id = ${input.eventId}
							and candidate.submission_id = ${input.submissionId}
							and candidate.task_assignment_id is not null
							and lower(candidate.file_name) = lower(${input.fileName})) = 1`,
				),
			) as SQL)
		: directChain;
	return appendToChain(
		db,
		sql`select max(${files.version}) from ${files} where ${versionScope}`,
		directChain,
		{
			...input,
			contactId: null,
			taskAssignmentId: null,
			reviewStatus: "none",
		},
	);
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

/** Speaker upload: task ownership and review stay assignment-scoped, while a
 * uniquely attributable direct predecessor can supply the next version number. */
export async function insertTaskUpload(
	db: Db,
	input: TaskUploadInput,
): Promise<{ id: string; version: number }> {
	const taskChain = and(
		eq(files.eventId, input.eventId),
		eq(files.taskAssignmentId, input.taskAssignmentId),
	) as SQL;
	const canonical = canonicalRowsSql(input.eventId);
	const maxVersion = input.submissionId
		? sql`select max(source.version) from (
				select c.version
				from ${canonical} c
				where c.canonical_task_assignment_id = ${input.taskAssignmentId}
				union all
				select direct_candidate.version
				from ${files} direct_candidate
				where direct_candidate.event_id = ${input.eventId}
					and direct_candidate.submission_id = ${input.submissionId}
					and direct_candidate.task_assignment_id is null
					and lower(direct_candidate.file_name) = lower(${input.fileName})
					and not exists (
						select 1 from ${files} competing_task
						where competing_task.event_id = ${input.eventId}
							and competing_task.submission_id = ${input.submissionId}
							and competing_task.task_assignment_id is not null
							and competing_task.task_assignment_id != ${input.taskAssignmentId}
							and lower(competing_task.file_name) = lower(${input.fileName})
					)
			) source`
		: sql`select max(${files.version}) from ${files} where ${taskChain}`;
	return appendToChain(
		db,
		maxVersion,
		taskChain,
		{ ...input, reviewStatus: "pending", sharedToPortal: false },
		[
			db
				.update(taskAssignments)
				.set({
					status: "pending_feedback",
					fileKey: input.r2Key,
					completedAt: null,
				})
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

export type RefileResult =
	| { ok: true; submissionTitle: string | null; versionCount: number }
	| { ok: false; error: string };

/**
 * Moves an admin-uploaded chain onto a session (or back to event level) and
 * merges it with whatever history the destination already holds. Version
 * numbers are re-issued 1..N over the merged set because two rows sharing a
 * number collapse into ONE presented version — the renumber is part of the
 * move, not housekeeping.
 * A speaker's task upload and a headshot are not re-filable: their identity is
 * the assignment and the person respectively, and re-filing would break the
 * review loop or detach a face from its contact.
 */
export async function refileChain(
	db: Db,
	chain: {
		eventId: string;
		fileName: string;
		submissionId: string | null;
		kind: string;
		taskAssignmentId: string | null;
	},
	targetSubmissionId: string | null,
): Promise<RefileResult> {
	if (chain.taskAssignmentId) {
		return {
			ok: false,
			error:
				"This is a speaker's task upload — it stays with its task. Re-file it by moving the task instead.",
		};
	}
	if (chain.kind === "headshot") {
		return {
			ok: false,
			error: "A headshot belongs to a person, not a session.",
		};
	}
	let submissionTitle: string | null = null;
	if (targetSubmissionId) {
		const [target] = await db
			.select({ title: submissions.title })
			.from(submissions)
			.where(
				and(
					eq(submissions.id, targetSubmissionId),
					eq(submissions.eventId, chain.eventId),
				),
			)
			.limit(1);
		if (!target) {
			return { ok: false, error: "That session isn't part of this event." };
		}
		submissionTitle = target.title;
		// A task upload of the same name on the destination would absorb these
		// rows into the speaker's review loop (see canonicalRowsSql) and take
		// their version numbers with it. Refuse rather than silently merge.
		const [clash] = await db
			.select({ id: files.id })
			.from(files)
			.where(
				and(
					eq(files.eventId, chain.eventId),
					eq(files.submissionId, targetSubmissionId),
					isNotNull(files.taskAssignmentId),
					sql`lower(${files.fileName}) = lower(${chain.fileName})`,
				),
			)
			.limit(1);
		if (clash) {
			return {
				ok: false,
				error: `A speaker already uploaded ${chain.fileName} to that session through a task — that history stays with them.`,
			};
		}
	}
	const scope = (submissionId: string | null) =>
		and(
			eq(files.eventId, chain.eventId),
			isNull(files.taskAssignmentId),
			isNull(files.contactId),
			submissionId
				? eq(files.submissionId, submissionId)
				: isNull(files.submissionId),
			sql`lower(${files.fileName}) = lower(${chain.fileName})`,
		) as SQL;
	const merged = await db
		.select({
			id: files.id,
			createdAt: files.createdAt,
			sharedToPortal: files.sharedToPortal,
		})
		.from(files)
		.where(or(scope(chain.submissionId), scope(targetSubmissionId)) as SQL);
	merged.sort(
		(a, b) =>
			a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
	);
	// One shared row per chain, as appendToChain maintains: a merge that left two
	// flagged would expose an older version for portal download.
	const shared = merged.some((row) => row.sharedToPortal);
	const writes: BatchItem[] = merged.map((row, index) =>
		db
			.update(files)
			.set({
				submissionId: targetSubmissionId,
				version: index + 1,
				sharedToPortal: shared && index === merged.length - 1,
			})
			.where(eq(files.id, row.id)),
	);
	const [first, ...rest] = writes;
	if (!first) return { ok: false, error: "That file is no longer here." };
	await db.batch([first, ...rest]);
	return { ok: true, submissionTitle, versionCount: merged.length };
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
		conditions.push(sql`r.canonical_review_status = ${filters.reviewStatus}`);
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
		left join ${taskAssignments} ta on ta.id = r.canonical_task_assignment_id
		left join ${contacts} c on c.id = coalesce(r.contact_id, ta.contact_id)
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
			r.canonical_review_status as review_status,
			r.canonical_shared_to_portal as shared_to_portal, r.created_at,
			r.submission_id, s.title as submission_title,
			coalesce(r.contact_id, ta.contact_id) as contact_id,
			c.first_name, c.last_name
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

/** A file's canonical version chain, descending — index 0 is the latest.
 * `members` retains duplicate alias ids so their comments remain in-thread. */
export async function getFileChain(
	db: Db,
	eventId: string,
	fileId: string,
): Promise<{
	versions: FileRow[];
	members: Array<{ id: string; version: number }>;
	canonicalTaskAssignmentId: string | null;
	canonicalSharedToPortal: boolean;
} | null> {
	const canonical = canonicalRowsSql(eventId);
	const ranked = rankedChainsSql(eventId);
	const targetGroup = sql`(
		select target.grp from ${canonical} target
		where target.id = ${fileId}
		limit 1
	)`;
	const [versions, members, context] = await Promise.all([
		db
			.select()
			.from(files)
			.where(
				and(
					eq(files.eventId, eventId),
					sql`${files.id} in (
						select r.id from ${ranked} r where r.grp = ${targetGroup}
					)`,
				),
			)
			.orderBy(desc(files.version), desc(files.createdAt), desc(files.id)),
		db.all<{ id: string; version: number }>(sql`
			select c.id, c.version from ${canonical} c
			where c.grp = ${targetGroup}`),
		db.all<{
			canonical_task_assignment_id: string | null;
			canonical_shared_to_portal: number;
		}>(sql`
			select r.canonical_task_assignment_id,
				r.canonical_shared_to_portal
			from ${ranked} r
			where r.grp = ${targetGroup} and r.rn = 1
			limit 1`),
	]);
	if (versions.length === 0) return null;
	return {
		versions,
		members,
		canonicalTaskAssignmentId: context[0]?.canonical_task_assignment_id ?? null,
		canonicalSharedToPortal: context[0]?.canonical_shared_to_portal === 1,
	};
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
