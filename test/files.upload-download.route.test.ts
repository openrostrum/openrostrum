import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contacts, files, taskAssignments } from "../app/db/schema";
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

	it("redirects a logged-out request to /login without any file bytes", async () => {
		const fileId = await seedUpload();
		const thrown = await catchThrown(() =>
			download(fileId, new Request(`http://localhost/files/${fileId}`)),
		);
		expect(thrown).toBeInstanceOf(Response);
		const response = thrown as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain("/login");
		expect(await response.text()).toBe("");
	});
});
