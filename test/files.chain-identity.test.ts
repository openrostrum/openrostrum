import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { files } from "../app/db/schema";
import { insertDirectUpload, uploadHeadshot } from "../app/domain/files";
import { loader as libraryLoader } from "../app/routes/admin.files";
import { action as detailAction } from "../app/routes/admin.files_.$id";
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

async function library() {
	return unwrap<{ rows: LibraryRow[]; total: number }>(
		await libraryLoader({
			context: CONTEXT,
			request: await authedRequest("http://localhost/admin/files"),
			params: {},
		} as unknown as Parameters<typeof libraryLoader>[0]),
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
