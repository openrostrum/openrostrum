import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	files,
	participants,
	submissions,
	taskAssignments,
} from "../app/db/schema";
import { insertTaskUpload, UPLOAD_MAX_BYTES } from "../app/domain/files";
import { loader as downloadLoader } from "../app/routes/files.$id";
import { action as uploadAction } from "../app/routes/files.upload";
import { CONTEXT, authedRequest } from "./tasks-fixtures";
import {
	catchThrown,
	makeUser,
	requestAs,
	seedFilesWorld,
	thrownStatus,
	uploadForm,
} from "./files.helpers";

type UploadArgs = Parameters<typeof uploadAction>[0];
type DownloadArgs = Parameters<typeof downloadLoader>[0];

async function upload(
	form: FormData,
	requestBuilder?: () => Promise<Request>,
): Promise<Response> {
	const request = requestBuilder
		? await requestBuilder()
		: await authedRequest(
				"http://localhost/files/upload",
				{},
				{ method: "POST", body: form },
			);
	return (await uploadAction({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as UploadArgs)) as Response;
}

function locationOf(response: Response): string {
	return response.headers.get("Location") ?? "";
}

describe("admin file upload", () => {
	it("re-uploading the same name to the same session continues the chain at version+1", async () => {
		const db = await seedFilesWorld();
		const first = await upload(
			uploadForm(
				{ name: "speaker-kit.pdf", content: "kit v1" },
				{ submissionId: "s1" },
			),
		);
		expect(locationOf(first)).toContain("notice=uploaded");
		const second = await upload(
			uploadForm(
				{ name: "speaker-kit.pdf", content: "kit v2 — updated" },
				{ submissionId: "s1" },
			),
		);
		expect(locationOf(second)).toContain("notice=uploaded");

		const rows = await db
			.select()
			.from(files)
			.where(eq(files.submissionId, "s1"))
			.orderBy(asc(files.version));
		expect(rows.map((r) => r.version)).toEqual([1, 2]);
		expect(rows.every((r) => r.eventId === "e1")).toBe(true);
		// both blobs exist — versioning never overwrites
		const [v1, v2] = rows;
		expect(await (await env.BLOBS.get(v1?.r2Key ?? ""))?.text()).toBe("kit v1");
		expect(await (await env.BLOBS.get(v2?.r2Key ?? ""))?.text()).toBe(
			"kit v2 — updated",
		);
	});

	it("rejects a type outside the allowlist and persists nothing", async () => {
		const db = await seedFilesWorld();
		// R2 storage is NOT wiped between tests — assert no NEW objects instead
		const before = (await env.BLOBS.list()).objects.length;
		const response = await upload(
			uploadForm({ name: "malware.exe", content: "MZ..." }),
		);
		expect(locationOf(response)).toContain("uploadError=bad-type");
		expect(await db.select().from(files)).toHaveLength(0);
		expect((await env.BLOBS.list()).objects).toHaveLength(before);
	});

	it("rejects a file over the stated 25 MB cap and persists nothing", async () => {
		const db = await seedFilesWorld();
		const before = (await env.BLOBS.list()).objects.length;
		const response = await upload(
			uploadForm({
				name: "huge.pdf",
				content: new Uint8Array(UPLOAD_MAX_BYTES + 1),
			}),
		);
		expect(locationOf(response)).toContain("uploadError=too-large");
		expect(await db.select().from(files)).toHaveLength(0);
		expect((await env.BLOBS.list()).objects).toHaveLength(before);
	});

	it("refuses to attach to another event's submission", async () => {
		const db = await seedFilesWorld();
		const response = await upload(
			uploadForm(
				{ name: "deck.pdf", content: "deck" },
				{ submissionId: "s_e2" },
			),
		);
		expect(locationOf(response)).toContain("uploadError=foreign-submission");
		expect(await db.select().from(files)).toHaveLength(0);
	});

	it("keeps the portal-shared flag on exactly the latest version of a chain", async () => {
		const db = await seedFilesWorld();
		await upload(
			uploadForm(
				{ name: "template.pptx", content: "old template" },
				{ sharedToPortal: "on" },
			),
		);
		await upload(
			uploadForm({ name: "template.pptx", content: "new template" }),
		);
		const rows = await db
			.select()
			.from(files)
			.where(eq(files.eventId, "e1"))
			.orderBy(asc(files.version));
		expect(rows.map((r) => [r.version, r.sharedToPortal])).toEqual([
			[1, false],
			[2, true],
		]);
	});
});

describe("cross-path deliverable identity", () => {
	it("adopts a matching direct session upload when the portal adds version 2", async () => {
		const db = await seedFilesWorld();
		await upload(
			uploadForm(
				{ name: "slides.pdf", content: "admin v1" },
				{ submissionId: "s1" },
			),
		);

		const portal = await insertTaskUpload(db, {
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

		expect(portal.version).toBe(2);
		const rows = await db
			.select({
				version: files.version,
				taskAssignmentId: files.taskAssignmentId,
				contactId: files.contactId,
			})
			.from(files)
			.orderBy(asc(files.version));
		expect(rows).toEqual([
			{
				version: 1,
				taskAssignmentId: null,
				contactId: null,
			},
			{
				version: 2,
				taskAssignmentId: "ta_priya_slides",
				contactId: "c_priya",
			},
		]);
	});

	it("continues one matching portal deliverable when admin uploads version 2", async () => {
		const db = await seedFilesWorld();
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/portal-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		await upload(
			uploadForm(
				{ name: "slides.pdf", content: "admin v2" },
				{ submissionId: "s1" },
			),
		);

		const rows = await db
			.select({
				version: files.version,
				taskAssignmentId: files.taskAssignmentId,
				reviewStatus: files.reviewStatus,
			})
			.from(files)
			.orderBy(asc(files.version));
		expect(rows).toEqual([
			{
				version: 1,
				taskAssignmentId: "ta_priya_slides",
				reviewStatus: "pending",
			},
			{
				version: 2,
				taskAssignmentId: null,
				reviewStatus: "none",
			},
		]);
	});

	it("continues the canonical sequence when a later task upload is renamed", async () => {
		const db = await seedFilesWorld();
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-slides-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});
		await upload(
			uploadForm(
				{ name: "slides.pdf", content: "admin v2" },
				{ submissionId: "s1" },
			),
		);

		const renamed = await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/task-deck-v3",
			fileName: "deck.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});

		expect(renamed.version).toBe(3);
		expect(
			(
				await db
					.select({ version: files.version })
					.from(files)
					.orderBy(asc(files.version))
			).map((row) => row.version),
		).toEqual([1, 2, 3]);
	});

	it("does not reopen an approved task when admin uploads a session file", async () => {
		const db = await seedFilesWorld();
		await insertTaskUpload(db, {
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "t/approved-v1",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 9,
		});
		const completedAt = new Date("2026-08-05T12:00:00Z");
		await db
			.update(taskAssignments)
			.set({ status: "complete", completedAt })
			.where(eq(taskAssignments.id, "ta_priya_slides"));

		await upload(
			uploadForm(
				{ name: "slides.pdf", content: "admin replacement" },
				{ submissionId: "s1" },
			),
		);

		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("complete");
		expect(assignment?.completedAt).toEqual(completedAt);
		const adminVersion = (
			await db.select().from(files).where(eq(files.reviewStatus, "none"))
		)[0];
		expect(adminVersion).toMatchObject({
			version: 2,
			taskAssignmentId: null,
		});
	});
});

describe("task upload chain (shared with the portal loop)", () => {
	it("versions per assignment and moves an admin-shared flag to the re-upload", async () => {
		const db = await seedFilesWorld();
		const put = (n: number) =>
			insertTaskUpload(db, {
				eventId: "e1",
				submissionId: "s1",
				contactId: "c_priya",
				taskAssignmentId: "ta_priya_slides",
				r2Key: `t/task-v${n}`,
				fileName: "slides.pdf",
				kind: "slides",
				contentType: "application/pdf",
				sizeBytes: 9,
			});
		const v1 = await put(1);
		expect(v1.version).toBe(1);
		// organizer shares the current version from the admin detail page…
		await db
			.update(files)
			.set({ sharedToPortal: true })
			.where(eq(files.id, v1.id));
		// …then the speaker re-uploads: the flag must FOLLOW the latest version,
		// or the portal keeps serving the stale deck.
		const v2 = await put(2);
		expect(v2.version).toBe(2);
		const rows = await db
			.select({ version: files.version, shared: files.sharedToPortal })
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_priya_slides"))
			.orderBy(asc(files.version));
		expect(rows).toEqual([
			{ version: 1, shared: false },
			{ version: 2, shared: true },
		]);
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("pending_feedback");
		expect(assignment?.fileKey).toBe("t/task-v2");
	});
});

describe("file byte serving (/files/:id)", () => {
	async function seedHeadshot(options: {
		fileId: string;
		contactId: "c_priya" | "c_carol";
		submissionId: "s1" | "s3";
		approved: boolean;
	}): Promise<Uint8Array> {
		const db = await seedFilesWorld();
		if (options.approved) {
			await db
				.update(submissions)
				.set({ contentStatus: "approved" })
				.where(eq(submissions.id, options.submissionId));
		}
		const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const key = `headshots/${options.fileId}.png`;
		await env.BLOBS.put(key, bytes, {
			httpMetadata: { contentType: "image/png" },
		});
		await db.insert(files).values({
			id: options.fileId,
			eventId: "e1",
			submissionId: options.submissionId,
			contactId: options.contactId,
			r2Key: key,
			fileName: `${options.contactId}.png`,
			kind: "headshot",
			contentType: "image/png",
			sizeBytes: bytes.length,
			version: 1,
		});
		return bytes;
	}

	// Seeded the way the portal upload loop writes it: contact-owned bytes.
	async function seedUpload(): Promise<string> {
		const db = await seedFilesWorld();
		await env.BLOBS.put("t/deck", "the deck bytes");
		await db.insert(files).values({
			id: "f_deck",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			r2Key: "t/deck",
			fileName: "slides.pdf",
			kind: "slides",
			contentType: "application/pdf",
			sizeBytes: 14,
			version: 1,
		});
		return "f_deck";
	}

	async function download(fileId: string, request: Request) {
		return (await downloadLoader({
			context: CONTEXT,
			request,
			params: { id: fileId },
		} as unknown as DownloadArgs)) as Response;
	}

	it("serves a public program speaker headshot anonymously as inline image bytes", async () => {
		const bytes = await seedHeadshot({
			fileId: "f_public_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		const response = await download(
			"f_public_headshot",
			new Request("http://localhost/files/f_public_headshot"),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(response.headers.get("Content-Disposition")).toBeNull();
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	it("does not expose a pending submission speaker headshot anonymously", async () => {
		await seedHeadshot({
			fileId: "f_pending_headshot",
			contactId: "c_carol",
			submissionId: "s3",
			approved: true,
		});
		const thrown = await catchThrown(() =>
			download(
				"f_pending_headshot",
				new Request("http://localhost/files/f_pending_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not expose an accepted but unapproved speaker headshot", async () => {
		await seedHeadshot({
			fileId: "f_unapproved_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: false,
		});
		const thrown = await catchThrown(() =>
			download(
				"f_unapproved_headshot",
				new Request("http://localhost/files/f_unapproved_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not expose a hidden contact's headshot", async () => {
		await seedHeadshot({
			fileId: "f_hidden_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		await getDb(env)
			.update(contacts)
			.set({ publicVisible: false })
			.where(eq(contacts.id, "c_priya"));
		const thrown = await catchThrown(() =>
			download(
				"f_hidden_headshot",
				new Request("http://localhost/files/f_hidden_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not authorize a cross-event contact link", async () => {
		await seedHeadshot({
			fileId: "f_cross_event_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		await getDb(env)
			.update(contacts)
			.set({ eventId: "e2" })
			.where(eq(contacts.id, "c_priya"));
		const thrown = await catchThrown(() =>
			download(
				"f_cross_event_headshot",
				new Request("http://localhost/files/f_cross_event_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not expose a secondary contact's headshot", async () => {
		await seedHeadshot({
			fileId: "f_secondary_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		await getDb(env)
			.update(participants)
			.set({ role: "secondary" })
			.where(eq(participants.id, "p1"));
		const thrown = await catchThrown(() =>
			download(
				"f_secondary_headshot",
				new Request("http://localhost/files/f_secondary_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not expose a child-session-only speaker headshot", async () => {
		await seedHeadshot({
			fileId: "f_child_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		await getDb(env)
			.update(submissions)
			.set({ parentId: "s2" })
			.where(eq(submissions.id, "s1"));
		const thrown = await catchThrown(() =>
			download(
				"f_child_headshot",
				new Request("http://localhost/files/f_child_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("does not expose a superseded public-speaker headshot", async () => {
		await seedHeadshot({
			fileId: "f_old_headshot",
			contactId: "c_priya",
			submissionId: "s1",
			approved: true,
		});
		const db = getDb(env);
		await env.BLOBS.put("headshots/f_current_headshot.png", "new photo", {
			httpMetadata: { contentType: "image/png" },
		});
		await db.insert(files).values({
			id: "f_current_headshot",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			r2Key: "headshots/f_current_headshot.png",
			fileName: "priya-current.png",
			kind: "headshot",
			contentType: "image/png",
			sizeBytes: 9,
			version: 2,
		});

		const thrown = await catchThrown(() =>
			download(
				"f_old_headshot",
				new Request("http://localhost/files/f_old_headshot"),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("serves the exact bytes to an admin of the owning org, as an attachment", async () => {
		const fileId = await seedUpload();
		const response = await download(
			fileId,
			await authedRequest(`http://localhost/files/${fileId}`),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("the deck bytes");
		expect(response.headers.get("Content-Disposition")).toContain("attachment");
	});

	it("404s (zero bytes) for an admin of ANOTHER org", async () => {
		const fileId = await seedUpload();
		await makeUser("u_admin2", "admin2@other.co", "admin", {
			activeEventId: "e2",
			memberOfOrg: "org2",
		});
		const request = await requestAs(
			"u_admin2",
			`http://localhost/files/${fileId}`,
		);
		const thrown = await catchThrown(() => download(fileId, request));
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("serves the owning contact's user, and 404s any other speaker", async () => {
		const fileId = await seedUpload();
		const db = getDb(env);
		await makeUser("u_priya", "priya.sharma@example.com");
		await db
			.update(contacts)
			.set({ userId: "u_priya" })
			.where(eq(contacts.id, "c_priya"));
		const own = await download(
			fileId,
			await requestAs("u_priya", `http://localhost/files/${fileId}`),
		);
		expect(own.status).toBe(200);
		expect(await own.text()).toBe("the deck bytes");

		await makeUser("u_mallory", "mallory@example.com");
		const thrown = await catchThrown(async () =>
			download(
				fileId,
				await requestAs("u_mallory", `http://localhost/files/${fileId}`),
			),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("404s a logged-out request for a private file without any bytes", async () => {
		const fileId = await seedUpload();
		const thrown = await catchThrown(() =>
			download(fileId, new Request(`http://localhost/files/${fileId}`)),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});
});
