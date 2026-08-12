import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, fileComments, files, taskAssignments } from "../app/db/schema";
import {
	addFileComment,
	insertDirectUpload,
	insertTaskUpload,
} from "../app/domain/files";
import { loader as libraryLoader } from "../app/routes/admin.files";
import { action as uploadAction } from "../app/routes/files.upload";
import {
	action as detailAction,
	loader as detailLoader,
} from "../app/routes/admin.files_.$id";
import { CONTEXT, authedRequest, postForm } from "./tasks-fixtures";
import {
	catchThrown,
	makeUser,
	requestAs,
	seedFilesWorld,
	thrownStatus,
	unwrap,
	uploadForm,
} from "./files.helpers";

type LibraryArgs = Parameters<typeof libraryLoader>[0];
type DetailLoaderArgs = Parameters<typeof detailLoader>[0];
type DetailActionArgs = Parameters<typeof detailAction>[0];

/** Priya's slides chain, exactly as the portal upload loop writes it. */
async function seedSlidesChain() {
	const db = await seedFilesWorld();
	await env.BLOBS.put("t/v1", "slides v1");
	await env.BLOBS.put("t/v2", "slides v2");
	await db.insert(files).values([
		{
			id: "f_slides_v1",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/v1",
			fileName: "slides.pdf",
			kind: "slides",
			sizeBytes: 9,
			version: 1,
			reviewStatus: "pending",
			createdAt: new Date("2026-08-01T10:00:00Z"),
		},
		{
			id: "f_slides_v2",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/v2",
			fileName: "slides.pdf",
			kind: "slides",
			sizeBytes: 9,
			version: 2,
			reviewStatus: "pending",
			createdAt: new Date("2026-08-02T10:00:00Z"),
		},
	]);
	await db
		.update(taskAssignments)
		.set({ status: "pending_feedback" })
		.where(eq(taskAssignments.id, "ta_priya_slides"));
	return db;
}

async function loadLibrary(query = "") {
	const request = await authedRequest(`http://localhost/admin/files${query}`);
	return unwrap<{
		rows: Array<{
			id: string;
			fileName: string;
			version: number;
			versionCount: number;
			submissionTitle: string | null;
			speakerName: string | null;
			reviewStatus: string;
			sharedToPortal: boolean;
			createdAt: Date;
		}>;
		total: number;
		timezone: string;
	}>(
		await libraryLoader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as LibraryArgs),
	);
}

async function loadDetail(fileId: string) {
	const request = await authedRequest(`http://localhost/admin/files/${fileId}`);
	return unwrap<{
		commentKey: string;
		latest: { id: string; version: number; reviewStatus: string };
		reviewFile: {
			id: string;
			version: number;
			reviewStatus: string;
		} | null;
		canonicalSharedToPortal: boolean;
		contact: { id: string } | null;
		assignment: { id: string } | null;
		versions: Array<{ id: string; version: number; uploadedOn: string }>;
		comments: Array<{
			author: string;
			body: string;
			version: number | null;
			on: string;
		}>;
	}>(
		await detailLoader({
			context: CONTEXT,
			request,
			params: { id: fileId },
		} as unknown as DetailLoaderArgs),
	);
}

async function postDetail(fileId: string, fields: Record<string, string>) {
	const url = `http://localhost/admin/files/${fileId}`;
	const request = await authedRequest(url, {}, postForm(url, fields));
	return detailAction({
		context: CONTEXT,
		request,
		params: { id: fileId },
	} as unknown as DetailActionArgs);
}

describe("central files library", () => {
	it("lists ONE row per version chain with the latest version and a version count of the whole chain", async () => {
		const db = await seedSlidesChain();
		// an unrelated single-version admin upload must stay its own row
		await db.insert(files).values({
			id: "f_kit",
			eventId: "e1",
			r2Key: "t/kit",
			fileName: "speaker-kit.pdf",
			kind: "doc",
			version: 1,
		});
		const { rows, total } = await loadLibrary();
		expect(total).toBe(2);
		const slides = rows.find((r) => r.fileName === "slides.pdf");
		expect(slides).toMatchObject({
			version: 2,
			versionCount: 2,
			submissionTitle: "Talk A",
			speakerName: "Priya Sharma",
		});
		expect(rows.find((r) => r.fileName === "speaker-kit.pdf")).toMatchObject({
			versionCount: 1,
		});
	});

	it("admin session upload then speaker re-upload is one session row with combined versions and comments", async () => {
		const db = await seedFilesWorld();
		const uploaded = (await uploadAction({
			context: CONTEXT,
			request: await authedRequest(
				"http://localhost/files/upload",
				{},
				{
					method: "POST",
					body: uploadForm(
						{ name: "slides.pdf", content: "admin v1" },
						{ destination: "session", submissionId: "s1" },
					),
				},
			),
			params: {},
		} as unknown as Parameters<typeof uploadAction>[0])) as Response;
		expect(uploaded.headers.get("Location") ?? "").toContain("notice=uploaded");

		const [adminRow] = await db.select().from(files);
		expect(adminRow?.submissionId).toBe("s1");
		await addFileComment(db, {
			key: crypto.randomUUID(),
			fileId: adminRow?.id ?? "",
			authorId: null,
			authorName: "Jordan Alvarez",
			body: "Please export 16:9.",
		});

		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/portal-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		const { rows, total } = await loadLibrary();
		expect(total).toBe(1);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 2,
			versionCount: 2,
			submissionTitle: "Talk A",
			speakerName: "Priya Sharma",
		});
		expect(rows[0]?.createdAt).toBeInstanceOf(Date);
		expect(rows[0]?.createdAt.getTime()).not.toBeNaN();

		const detail = await loadDetail(rows[0]?.id ?? "");
		expect(detail.versions.map((version) => version.version)).toEqual([2, 1]);
		expect(detail.comments.map((comment) => comment.body)).toEqual([
			"Please export 16:9.",
		]);
	});

	it("shows one session-linked row with an upload date after direct v1 and portal v2", async () => {
		const db = await seedFilesWorld();
		await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/admin-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 8,
			sharedToPortal: false,
		});
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/portal-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		const { rows, total } = await loadLibrary();
		expect(total).toBe(1);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 2,
			versionCount: 2,
			submissionTitle: "Talk A",
			speakerName: "Priya Sharma",
		});
		expect(rows[0]?.createdAt).toBeInstanceOf(Date);
		expect(rows[0]?.createdAt.getTime()).not.toBeNaN();
	});

	it("keeps an established direct history together when it joins one task chain", async () => {
		const db = await seedFilesWorld();
		await db.insert(files).values([
			{
				id: "f_direct_history_v1",
				eventId: "e1",
				submissionId: "s1",
				r2Key: "t/direct-history-v1",
				fileName: "slides.pdf",
				kind: "slides",
				version: 1,
			},
			{
				id: "f_direct_history_v2",
				eventId: "e1",
				submissionId: "s1",
				r2Key: "t/direct-history-v2",
				fileName: "slides.pdf",
				kind: "slides",
				version: 2,
			},
			{
				id: "f_task_history_v1",
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_slides",
				r2Key: "t/task-history-v1",
				fileName: "slides.pdf",
				kind: "slides",
				version: 1,
			},
		]);

		const { rows, total } = await loadLibrary();
		expect(total).toBe(1);
		expect(rows[0]).toMatchObject({ version: 2, versionCount: 2 });
		expect(
			(await loadDetail("f_direct_history_v1")).versions.map(
				(version) => version.version,
			),
		).toEqual([2, 1]);
	});

	it("hides a duplicate direct row when an established task chain receives the same deliverable", async () => {
		const db = await seedFilesWorld();
		await db.insert(files).values({
			id: "f_existing_task_v1",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/existing-task-v1",
			fileName: "slides.pdf",
			kind: "slides",
			version: 1,
			reviewStatus: "pending",
		});
		await db.insert(files).values({
			id: "f_direct_slides_v1",
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/direct-slides-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 8,
			version: 1,
		});
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-slides-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		const { rows, total } = await loadLibrary();
		expect(total).toBe(1);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			fileName: "slides.pdf",
			version: 2,
			versionCount: 2,
			submissionTitle: "Talk A",
			speakerName: "Priya Sharma",
		});
		const fromDirectAlias = await loadDetail("f_direct_slides_v1");
		expect(fromDirectAlias.versions.map((version) => version.version)).toEqual([
			2, 1,
		]);
		expect(fromDirectAlias.latest.id).toBeDefined();
	});

	it("keeps a same-name direct file separate from a one-version task chain", async () => {
		const db = await seedFilesWorld();
		await db.insert(files).values([
			{
				id: "f_single_task_v1",
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_slides",
				r2Key: "t/single-task-v1",
				fileName: "slides.pdf",
				kind: "slides",
				version: 1,
			},
			{
				id: "f_independent_direct_v1",
				eventId: "e1",
				submissionId: "s1",
				r2Key: "t/independent-direct-v1",
				fileName: "slides.pdf",
				kind: "slides",
				version: 1,
			},
		]);

		const { rows, total } = await loadLibrary();
		expect(total).toBe(2);
		expect(rows).toHaveLength(2);
	});

	it("keeps a direct upload visible when multiple task assignments make identity ambiguous", async () => {
		const db = await seedFilesWorld();
		await db.insert(taskAssignments).values({
			id: "ta_priya_other",
			taskId: "t_hotel",
			contactId: "c_priya",
			submissionId: "s1",
		});
		await db.insert(files).values([
			{
				id: "f_task_a",
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_slides",
				r2Key: "t/task-a",
				fileName: "slides.pdf",
				kind: "slides",
			},
			{
				id: "f_task_b",
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_other",
				r2Key: "t/task-b",
				fileName: "slides.pdf",
				kind: "slides",
			},
			{
				id: "f_direct_ambiguous",
				eventId: "e1",
				submissionId: "s1",
				r2Key: "t/direct-ambiguous",
				fileName: "slides.pdf",
				kind: "slides",
			},
		]);

		const { rows, total } = await loadLibrary();
		expect(total).toBe(3);
		expect(rows).toHaveLength(3);
		expect(rows.every((row) => row.fileName === "slides.pdf")).toBe(true);
	});

	it("search matches file name, session title, and speaker name; review filter narrows", async () => {
		const db = await seedSlidesChain();
		await db.insert(files).values({
			id: "f_other",
			eventId: "e1",
			r2Key: "t/other",
			fileName: "logo.png",
			kind: "other",
			version: 1,
		});
		expect((await loadLibrary("?q=slides")).total).toBe(1);
		expect((await loadLibrary("?q=Talk+A")).total).toBe(1);
		expect((await loadLibrary("?q=Priya")).total).toBe(1);
		expect((await loadLibrary("?q=zzz-nothing")).total).toBe(0);
		expect((await loadLibrary("?status=pending")).total).toBe(1);
		expect((await loadLibrary("?status=none")).total).toBe(1);
	});

	it("treats %/_ in the search term as literals, not wildcards", async () => {
		const db = await seedFilesWorld();
		await db.insert(files).values([
			{
				id: "f_kit",
				eventId: "e1",
				r2Key: "t/kit",
				fileName: "speaker_kit.pdf",
				kind: "doc",
				version: 1,
			},
			{
				id: "f_deck",
				eventId: "e1",
				r2Key: "t/deck",
				fileName: "speakerXkit.pdf",
				kind: "doc",
				version: 1,
			},
		]);
		// "_" must match ONLY the literal underscore, never act as single-char wildcard
		const underscore = await loadLibrary("?q=speaker_kit");
		expect(underscore.rows.map((r) => r.fileName)).toEqual(["speaker_kit.pdf"]);
		// "%" is a literal too — no file contains one, so nothing matches
		expect((await loadLibrary("?q=%25")).total).toBe(0);
	});

	it("filters to one session's files via ?submission=", async () => {
		const db = await seedSlidesChain();
		await db.insert(files).values({
			id: "f_talkb",
			eventId: "e1",
			submissionId: "s2",
			r2Key: "t/talkb",
			fileName: "deck.pdf",
			kind: "slides",
			version: 1,
		});
		const filtered = await loadLibrary("?submission=s1");
		expect(filtered.rows.map((r) => r.fileName)).toEqual(["slides.pdf"]);
	});

	it("never mixes another event's files into the library", async () => {
		const db = await seedSlidesChain();
		await db.insert(files).values({
			id: "f_foreign",
			eventId: "e2",
			r2Key: "t/foreign",
			fileName: "foreign.pdf",
			kind: "doc",
			version: 1,
		});
		const { rows } = await loadLibrary();
		expect(rows.map((r) => r.fileName)).not.toContain("foreign.pdf");
	});

	it("paginates without dropping or repeating chains", async () => {
		const db = await seedFilesWorld();
		const rows = Array.from({ length: 55 }, (_, i) => ({
			id: `f_bulk_${i}`,
			eventId: "e1",
			r2Key: `t/bulk_${i}`,
			fileName: `doc-${i}.pdf`,
			kind: "doc" as const,
			version: 1,
		}));
		// D1 caps bound variables per statement — insert in slices
		for (let i = 0; i < rows.length; i += 10) {
			await db.insert(files).values(rows.slice(i, i + 10));
		}
		const page1 = await loadLibrary();
		const page2 = await loadLibrary("?page=2");
		expect(page1.total).toBe(55);
		const ids = [...page1.rows, ...page2.rows].map((r) => r.id);
		expect(new Set(ids).size).toBe(55);
	});

	it("falls back to UTC when an imported event timezone is invalid", async () => {
		const db = await seedSlidesChain();
		await db
			.update(events)
			.set({ timezone: "Not/A-Timezone" })
			.where(eq(events.id, "e1"));
		expect((await loadLibrary()).timezone).toBe("UTC");
	});
});

describe("file detail — versions, review, comments", () => {
	it("returns the full chain latest-first from ANY version's id", async () => {
		await seedSlidesChain();
		const fromOld = await loadDetail("f_slides_v1");
		expect(fromOld.versions.map((v) => v.version)).toEqual([2, 1]);
		expect(fromOld.latest.id).toBe("f_slides_v2");
		expect(fromOld.commentKey).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("renders timestamps in UTC when an imported timezone is invalid", async () => {
		const db = await seedSlidesChain();
		await db
			.update(events)
			.set({ timezone: "Not/A-Timezone" })
			.where(eq(events.id, "e1"));
		const detail = await loadDetail("f_slides_v1");
		expect(detail.versions.map((version) => version.uploadedOn)).toEqual([
			"Aug 2, 2026, 10:00 AM UTC",
			"Aug 1, 2026, 10:00 AM UTC",
		]);
	});

	it("404s a file belonging to another event", async () => {
		const db = await seedSlidesChain();
		await db.insert(files).values({
			id: "f_foreign",
			eventId: "e2",
			r2Key: "t/foreign",
			fileName: "foreign.pdf",
			kind: "doc",
			version: 1,
		});
		const thrown = await catchThrown(() => loadDetail("f_foreign"));
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("keeps pending task ownership reviewable when a direct upload is canonical latest", async () => {
		const db = await seedFilesWorld();
		const task = await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/pending-task-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});
		const direct = await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/direct-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
			sharedToPortal: false,
		});

		const detail = await loadDetail(direct.id);
		expect(detail.latest).toMatchObject({ id: direct.id, version: 2 });
		expect(detail.contact?.id).toBe("c_priya");
		expect(detail.assignment?.id).toBe("ta_priya_slides");
		expect(detail.reviewFile).toMatchObject({
			id: task.id,
			version: 1,
			reviewStatus: "pending",
		});

		await postDetail(direct.id, { intent: "approve" });
		const [reviewed] = await db
			.select()
			.from(files)
			.where(eq(files.id, task.id));
		expect(reviewed?.reviewStatus).toBe("approved");
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("complete");
	});

	it("shows and clears portal sharing across canonical physical members", async () => {
		const db = await seedFilesWorld();
		const direct = await insertDirectUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			r2Key: "t/shared-direct-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
			sharedToPortal: true,
		});
		const task = await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-v2",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		expect((await loadLibrary()).rows[0]?.sharedToPortal).toBe(true);
		expect((await loadDetail(task.id)).canonicalSharedToPortal).toBe(true);
		await postDetail(task.id, { intent: "unshare" });
		expect(
			(
				await db
					.select({ shared: files.sharedToPortal })
					.from(files)
					.where(eq(files.submissionId, "s1"))
			).map((row) => row.shared),
		).toEqual([false, false]);
		expect(direct.version).toBe(1);
	});

	it("loads more than D1's bound-variable cap of versions and comments", async () => {
		const db = await seedFilesWorld();
		const values = Array.from({ length: 101 }, (_, index) => ({
			id: `f_long_${index + 1}`,
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: `t/long-${index + 1}`,
			fileName: "long-lived.pdf",
			kind: "slides" as const,
			version: index + 1,
		}));
		for (let index = 0; index < values.length; index += 5) {
			await db.insert(files).values(values.slice(index, index + 5));
		}
		await db.insert(fileComments).values({
			id: "fc_long",
			fileId: "f_long_1",
			authorName: "Priya Sharma",
			body: "Still in this thread.",
		});

		const detail = await loadDetail("f_long_1");
		expect(detail.versions).toHaveLength(101);
		expect(detail.versions[0]?.version).toBe(101);
		expect(detail.comments).toHaveLength(1);
		expect(detail.comments[0]?.version).toBe(1);
	});

	it("approve marks the latest version approved AND completes the speaker's task", async () => {
		const db = await seedSlidesChain();
		await postDetail("f_slides_v2", { intent: "approve" });
		const [file] = await db
			.select()
			.from(files)
			.where(eq(files.id, "f_slides_v2"));
		expect(file?.reviewStatus).toBe("approved");
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("complete");
		expect(assignment?.completedAt).not.toBeNull();
	});

	it("deny stores the note and REOPENS the task so the speaker can re-upload", async () => {
		const db = await seedSlidesChain();
		await postDetail("f_slides_v2", {
			intent: "deny",
			reviewNote: "Wrong aspect ratio — please export 16:9.",
		});
		const [file] = await db
			.select()
			.from(files)
			.where(eq(files.id, "f_slides_v2"));
		expect(file?.reviewStatus).toBe("denied");
		expect(file?.reviewNote).toBe("Wrong aspect ratio — please export 16:9.");
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		// incomplete = the portal's upload gate reopens (it blocks only "complete")
		expect(assignment?.status).toBe("incomplete");
		expect(assignment?.completedAt).toBeNull();
	});

	it("shows the speaker's comment and appends the organizer reply to the same thread", async () => {
		const db = await seedSlidesChain();
		await db.insert(fileComments).values({
			id: "fc_speaker",
			fileId: "f_slides_v1",
			authorName: "Priya Sharma",
			body: "Draft deck - final version coming Friday.",
			createdAt: new Date("2026-08-01T11:00:00Z"),
		});
		const submittedCommentKey = crypto.randomUUID();
		const response = unwrap<{
			ok?: boolean;
			commentKey?: string;
			commentFileId?: string;
		}>(
			await postDetail("f_slides_v2", {
				intent: "comment",
				fileId: "f_slides_v2",
				commentKey: submittedCommentKey,
				body: "Thanks - please confirm the final version by Tuesday.",
			}),
		);
		expect(response).toMatchObject({ ok: true, commentFileId: "f_slides_v2" });
		expect(response.commentKey).not.toBe(submittedCommentKey);

		const detail = await loadDetail("f_slides_v1");
		expect(detail.comments.map((c) => [c.author, c.body])).toEqual([
			["Priya Sharma", "Draft deck - final version coming Friday."],
			[
				expect.stringContaining("@") as unknown as string,
				"Thanks - please confirm the final version by Tuesday.",
			],
		]);
		// speaker's comment stays attributed to the version it was made on
		expect(detail.comments[0]?.version).toBe(1);

		// A double-fired reply replays the same client key AS THE SAME USER and
		// lands once; the same words under a fresh key are a real comment.
		// (postDetail mints a fresh admin per call, so drive the replay pair
		// as one fixed user.)
		await makeUser("u_replier", "replier@test.co", "admin", {
			activeEventId: "e1",
			memberOfOrg: "org1",
		});
		const url = "http://localhost/admin/files/f_slides_v2";
		const replayKey = crypto.randomUUID();
		const reply = async () =>
			detailAction({
				context: CONTEXT,
				request: await requestAs(
					"u_replier",
					url,
					postForm(url, {
						intent: "comment",
						fileId: "f_slides_v2",
						commentKey: replayKey,
						body: "Ping - any update?",
					}),
				),
				params: { id: "f_slides_v2" },
			} as unknown as DetailActionArgs);
		await Promise.all([reply(), reply()]);
		expect((await loadDetail("f_slides_v1")).comments).toHaveLength(3);

		// A response-lost retry still targets the rendered version even when a new
		// upload becomes latest before the exact POST is replayed.
		await db.insert(files).values({
			id: "f_slides_v3",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/v3",
			fileName: "slides.pdf",
			kind: "slides",
			sizeBytes: 9,
			version: 3,
			reviewStatus: "pending",
		});
		await reply();
		expect((await loadDetail("f_slides_v1")).comments).toHaveLength(3);

		await postDetail("f_slides_v3", {
			intent: "comment",
			fileId: "f_slides_v3",
			commentKey: crypto.randomUUID(),
			body: "Ping - any update?",
		});
		expect((await loadDetail("f_slides_v1")).comments).toHaveLength(4);
	});

	it("rejects an over-long deny note without touching the file or the task", async () => {
		const db = await seedSlidesChain();
		const result = unwrap<{ fieldErrors?: Record<string, string[]> }>(
			await postDetail("f_slides_v2", {
				intent: "deny",
				reviewNote: "x".repeat(2001),
			}),
		);
		expect(result.fieldErrors?.reviewNote?.[0]).toBeTruthy();
		const [file] = await db
			.select()
			.from(files)
			.where(eq(files.id, "f_slides_v2"));
		expect(file?.reviewStatus).toBe("pending");
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("pending_feedback");
	});

	it("rejects an empty comment without writing a row", async () => {
		const db = await seedSlidesChain();
		const commentKey = crypto.randomUUID();
		const result = unwrap<{
			commentKey?: string;
			commentFileId?: string;
			fieldErrors?: Record<string, string[]>;
		}>(
			await postDetail("f_slides_v2", {
				intent: "comment",
				fileId: "f_slides_v2",
				commentKey,
				body: "   ",
			}),
		);
		expect(result).toMatchObject({
			commentKey,
			commentFileId: "f_slides_v2",
		});
		expect(result.fieldErrors?.body?.[0]).toBeTruthy();
		expect(await db.select().from(fileComments)).toHaveLength(0);
	});
});
