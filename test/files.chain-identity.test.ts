import { env } from "cloudflare:test";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	fileComments,
	files,
	submissions,
	taskAssignments,
} from "../app/db/schema";
import {
	addFileComment,
	insertDirectUpload,
	insertTaskUpload,
	SESSION_OPTION_LIMIT,
	uploadHeadshot,
} from "../app/domain/files";
import { loader as libraryLoader } from "../app/routes/admin.files";
import {
	action as detailAction,
	loader as detailLoader,
} from "../app/routes/admin.files_.$id";
import { seedFilesWorld } from "./files.helpers";
import { authedRequest, CONTEXT, postForm, unwrap } from "./tasks-fixtures";

type LibraryRow = {
	id: string;
	fileName: string;
	version: number;
	versionCount: number;
	submissionId: string | null;
	submissionTitle: string | null;
	speakerName: string | null;
};

async function library(search = "") {
	return unwrap<{
		rows: LibraryRow[];
		total: number;
		sessionOptions: Array<{ id: string; title: string }>;
		sessionTotal: number;
	}>(
		await libraryLoader({
			context: CONTEXT,
			request: await authedRequest(`http://localhost/admin/files${search}`),
			params: {},
		} as unknown as Parameters<typeof libraryLoader>[0]),
	);
}

/** Enough sessions that no picker can honestly ship them all. */
async function seedManySessions(
	db: Awaited<ReturnType<typeof seedFilesWorld>>,
) {
	const bulk = Array.from({ length: SESSION_OPTION_LIMIT + 40 }, (_, n) => ({
		id: `s_bulk_${n}`,
		eventId: "e1",
		title: `Session ${String(n).padStart(3, "0")}`,
		status: "accepted" as const,
	}));
	// D1 caps bound variables per statement, so seed in small batches.
	for (let at = 0; at < bulk.length; at += 10) {
		await db.insert(submissions).values(bulk.slice(at, at + 10));
	}
}

type DetailData = {
	sessionOptions: Array<{ id: string; title: string }>;
	sessionTotal: number;
	sessionQuery: string;
};

async function detail(fileId: string, search = "") {
	const url = `http://localhost/admin/files/${fileId}${search}`;
	return unwrap<DetailData>(
		await detailLoader({
			context: CONTEXT,
			request: await authedRequest(url),
			params: { id: fileId },
		} as unknown as Parameters<typeof detailLoader>[0]),
	);
}

async function postDetail(fileId: string, fields: Record<string, string>) {
	const url = `http://localhost/admin/files/${fileId}`;
	return detailAction({
		context: CONTEXT,
		request: await authedRequest(url, {}, postForm(url, fields)),
		params: { id: fileId },
	} as unknown as Parameters<typeof detailAction>[0]);
}

/** Three event-level uploads of the same deck — the "I forgot to pick the
 * session" path an organizer actually takes. */
async function seedLooseDeck(db: Awaited<ReturnType<typeof seedFilesWorld>>) {
	const ids: string[] = [];
	for (let n = 1; n <= 3; n += 1) {
		await env.BLOBS.put(`t/loose-${n}`, `deck v${n}`);
		const row = await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: null,
			r2Key: `t/loose-${n}`,
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 7,
			sharedToPortal: false,
		});
		ids.push(row.id);
	}
	return ids;
}

describe("a contact's headshot is one deliverable, whatever the file is called", () => {
	it("versions a differently-named replacement into the same library row", async () => {
		const db = await seedFilesWorld();
		const first = await uploadHeadshot(env, db, {
			eventId: "e1",
			contactId: "c_priya",
			file: new File(["one"], "headshot.png", { type: "image/png" }),
		});
		const second = await uploadHeadshot(env, db, {
			eventId: "e1",
			contactId: "c_priya",
			file: new File(["two"], "priya-raman.png", { type: "image/png" }),
		});
		expect(first.ok && second.ok).toBe(true);

		const { rows, total } = await library();
		expect(total).toBe(1);
		expect(rows[0]).toMatchObject({
			fileName: "priya-raman.png",
			version: 2,
			versionCount: 2,
			speakerName: "Priya Sharma",
		});
	});

	it("numbers versions within the contact's own event", async () => {
		const db = await seedFilesWorld();
		// A headshot row filed under another event must not lend its version
		// number to this event's first upload.
		await env.BLOBS.put("t/foreign-headshot", "foreign");
		await db.insert(files).values({
			id: "f_foreign_headshot",
			eventId: "e2",
			contactId: "c_priya",
			r2Key: "t/foreign-headshot",
			fileName: "headshot.png",
			kind: "headshot",
			version: 7,
		});

		await uploadHeadshot(env, db, {
			eventId: "e1",
			contactId: "c_priya",
			file: new File(["one"], "headshot.png", { type: "image/png" }),
		});
		const [row] = await db
			.select({ version: files.version })
			.from(files)
			.where(and(eq(files.eventId, "e1"), eq(files.kind, "headshot")));
		expect(row?.version).toBe(1);
	});
});

describe("an event-level upload chain can be filed against its session", () => {
	it("moves the whole history onto the session in one action", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);

		const before = await library();
		expect(before.rows[0]).toMatchObject({
			versionCount: 3,
			submissionTitle: null,
		});

		const result = (await postDetail(ids[2] ?? "", {
			intent: "assign-session",
			submissionId: "s1",
		})) as { data?: { notice?: string; formError?: string } };
		expect(result.data?.formError).toBeUndefined();

		const after = await library();
		expect(after.total).toBe(1);
		expect(after.rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 3,
			versionCount: 3,
			submissionId: "s1",
			submissionTitle: "Talk A",
		});
	});

	it("merges into the session's existing history of the same file, renumbered", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);
		await env.BLOBS.put("t/session-copy", "session copy");
		await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/session-copy",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 12,
			sharedToPortal: false,
		});
		expect((await library()).total).toBe(2);

		await postDetail(ids[2] ?? "", {
			intent: "assign-session",
			submissionId: "s1",
		});

		const after = await library();
		expect(after.total).toBe(1);
		expect(after.rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 4,
			versionCount: 4,
			submissionTitle: "Talk A",
		});
		const versions = await db
			.select({ version: files.version })
			.from(files)
			.where(eq(files.submissionId, "s1"));
		expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
	});

	it("refiling an event-level deck onto a session that already has the speaker's upload keeps one history", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);
		for (const [index, id] of ids.entries()) {
			await db
				.update(files)
				.set({ createdAt: new Date(`2026-08-0${index + 1}T10:00:00Z`) })
				.where(eq(files.id, id));
		}
		const looseCommentKey = crypto.randomUUID();
		await addFileComment(db, {
			key: looseCommentKey,
			fileId: ids[2] ?? "",
			authorId: null,
			authorName: "Jordan Alvarez",
			body: "Use the widescreen export.",
		});
		await db
			.update(fileComments)
			.set({ createdAt: new Date("2026-08-01T12:00:00Z") })
			.where(eq(fileComments.id, looseCommentKey));
		await env.BLOBS.put("t/task-draft", "speaker draft");
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-draft",
			fileName: "draft.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 13,
		});
		await db
			.update(files)
			.set({ createdAt: new Date("2026-08-04T10:00:00Z") })
			.where(eq(files.taskAssignmentId, "ta_priya_slides"));
		await env.BLOBS.put("t/task-v2", "speaker v2");
		const speaker = await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 10,
		});
		const speakerCommentKey = crypto.randomUUID();
		await addFileComment(db, {
			key: speakerCommentKey,
			fileId: speaker.id,
			authorId: null,
			authorName: "Priya Sharma",
			body: "Draft deck - final version coming Friday.",
		});
		await db
			.update(fileComments)
			.set({ createdAt: new Date("2026-08-04T12:00:00Z") })
			.where(eq(fileComments.id, speakerCommentKey));
		expect((await library()).total).toBe(2);

		const result = (await postDetail(ids[2] ?? "", {
			intent: "assign-session",
			submissionId: "s1",
		})) as { data?: { formError?: string } };
		expect(result.data?.formError).toBeUndefined();

		const after = await library();
		expect(after.total).toBe(1);
		expect(after.rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 5,
			versionCount: 5,
			submissionTitle: "Talk A",
			speakerName: "Priya Sharma",
		});
		const versions = await db
			.select({ version: files.version })
			.from(files)
			.where(eq(files.submissionId, "s1"));
		expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3, 4, 5]);
		const shown = unwrap<{ comments: Array<{ body: string }> }>(
			await detailLoader({
				context: CONTEXT,
				request: await authedRequest(
					`http://localhost/admin/files/${after.rows[0]?.id ?? ""}`,
				),
				params: { id: after.rows[0]?.id ?? "" },
			} as unknown as Parameters<typeof detailLoader>[0]),
		);
		expect(shown.comments.map((c) => c.body)).toEqual([
			"Use the widescreen export.",
			"Draft deck - final version coming Friday.",
		]);
	});

	it("files independently when multiple task-owned deliverables share the same name", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);
		await db.insert(taskAssignments).values({
			id: "ta_priya_other_slides",
			taskId: "t_hotel",
			contactId: "c_priya",
			submissionId: "s1",
			status: "incomplete",
		});
		for (const assignmentId of ["ta_priya_slides", "ta_priya_other_slides"]) {
			await insertTaskUpload(db, {
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: assignmentId,
				r2Key: `t/${assignmentId}`,
				fileName: "slides.pdf",
				kind: "slides",
				contentType: "application/pdf",
				sizeBytes: 10,
			});
		}

		const result = (await postDetail(ids[2] ?? "", {
			intent: "assign-session",
			submissionId: "s1",
		})) as { data?: { formError?: string } };

		expect(result.data?.formError).toBeUndefined();
		const directRows = await db
			.select({ submissionId: files.submissionId })
			.from(files)
			.where(isNull(files.taskAssignmentId));
		expect(directRows.every((row) => row.submissionId === "s1")).toBe(true);
		expect((await library()).total).toBe(3);
	});

	it("files a chain back to event level", async () => {
		const db = await seedFilesWorld();
		await env.BLOBS.put("t/misfiled", "misfiled");
		const row = await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/misfiled",
			fileName: "sponsor-deck.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 8,
			sharedToPortal: false,
		});

		await postDetail(row.id, { intent: "assign-session", submissionId: "" });

		const after = await library();
		expect(after.rows[0]).toMatchObject({
			fileName: "sponsor-deck.pdf",
			submissionId: null,
			submissionTitle: null,
		});
	});

	it("keeps the picker bounded on an event with more sessions than fit", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);
		// A real CFP runs to hundreds; the picker may not ship all of them.
		await seedManySessions(db);

		const capped = await detail(ids[2] ?? "");
		expect(capped.sessionOptions).toHaveLength(SESSION_OPTION_LIMIT);
		// An honest count (the 140 bulk + the world's 3), so the hint can say what
		// is being withheld.
		expect(capped.sessionTotal).toBe(SESSION_OPTION_LIMIT + 43);

		// The one past the cap is still reachable by name.
		const found = await detail(ids[2] ?? "", "?session=Session%20139");
		expect(found.sessionOptions.map((s) => s.title)).toEqual(["Session 139"]);
		expect(found.sessionQuery).toBe("Session 139");
	});

	it("keeps the library's upload picker bounded and searchable too", async () => {
		const db = await seedFilesWorld();
		await seedManySessions(db);

		const capped = await library();
		expect(capped.sessionOptions).toHaveLength(SESSION_OPTION_LIMIT);
		expect(capped.sessionTotal).toBe(SESSION_OPTION_LIMIT + 43);

		const found = await library("?session=Session%20139");
		expect(found.sessionOptions.map((s) => s.title)).toEqual(["Session 139"]);

		// Filtering the table by a session past the cap must still name it — the
		// badge and the picker both read from these options.
		const filtered = await library("?submission=s_bulk_139");
		expect(filtered.sessionOptions.map((s) => s.id)).toContain("s_bulk_139");
	});

	it("keeps the file's own session pickable while a search is narrowing the list", async () => {
		const db = await seedFilesWorld();
		await env.BLOBS.put("t/filed", "filed");
		const row = await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/filed",
			fileName: "sponsor-deck.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 5,
			sharedToPortal: false,
		});

		// Searching for something else must not silently re-point the select at
		// another session — a save would then move the file the organizer meant
		// to leave alone.
		const narrowed = await detail(row.id, "?session=Talk%20B");
		expect(narrowed.sessionOptions.map((s) => s.id)).toContain("s1");
	});

	it("refuses another event's session and refuses to move a speaker's task upload", async () => {
		const db = await seedFilesWorld();
		const ids = await seedLooseDeck(db);

		const foreign = (await postDetail(ids[2] ?? "", {
			intent: "assign-session",
			submissionId: "s_e2",
		})) as { data?: { formError?: string } };
		expect(foreign.data?.formError).toMatch(/session/i);
		const [untouched] = await db
			.select({ submissionId: files.submissionId })
			.from(files)
			.where(eq(files.id, ids[2] ?? ""));
		expect(untouched?.submissionId).toBeNull();

		await env.BLOBS.put("t/task-upload", "task upload");
		const [taskRow] = await db
			.insert(files)
			.values({
				id: "f_task_upload",
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_slides",
				r2Key: "t/task-upload",
				fileName: "deck.pdf",
				kind: "slides",
				version: 1,
				reviewStatus: "pending",
			})
			.returning({ id: files.id });

		const owned = (await postDetail(taskRow?.id ?? "", {
			intent: "assign-session",
			submissionId: "s2",
		})) as { data?: { formError?: string } };
		expect(owned.data?.formError).toMatch(/task/i);
		const [stillOnS1] = await db
			.select({ submissionId: files.submissionId })
			.from(files)
			.where(eq(files.id, "f_task_upload"));
		expect(stillOnS1?.submissionId).toBe("s1");
	});
});
