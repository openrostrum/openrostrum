import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	events,
	fileComments,
	files,
	portalForms,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { persistInitialPortalFormResponse } from "../app/domain/portal-task-form";
import {
	action as taskAction,
	loader as taskLoader,
} from "../app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId";
import {
	authedRequest,
	BASE,
	catchThrown,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
	thrownStatus,
	unwrap,
} from "./portal.helpers";

type ActionArgs = Parameters<typeof taskAction>[0];
type LoaderArgs = Parameters<typeof taskLoader>[0];

async function seedTasks() {
	await seedPortalWorld();
	const db = getDb(env);
	await makeUser("u_priya", "priya@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
	await makeUser("u_dana", "dana@example.com");
	await makeContact("c_dana", "e1", "dana@example.com", "u_dana", "Dana", "O");

	await db.insert(portalForms).values({
		id: "pf_hotel",
		eventId: "e1",
		name: "Hotel Stay",
		title: "Book your hotel",
		sendConfirmationEmail: true,
		schema: [
			{ name: "Check-in Date", type: "date", required: true },
			{ name: "Check-out Date", type: "date", required: true },
			{
				name: "Room Preference",
				type: "dropdown",
				required: false,
				options: ["King", "Queen", "Double"],
			},
			{ name: "Special Requests", type: "textarea", required: false },
		],
	});
	await db.insert(tasks).values([
		{
			id: "t_announce",
			eventId: "e1",
			name: "Announce your participation",
			required: false,
		},
		{
			id: "t_hotel",
			eventId: "e1",
			name: "Hotel Stay Requirements",
			portalFormId: "pf_hotel",
		},
		{
			id: "t_slides",
			eventId: "e1",
			name: "Presentation Upload",
			type: "submission",
			isFileRequest: true,
		},
		{
			id: "t_headshot",
			eventId: "e1",
			name: "Headshot Upload",
			isFileRequest: true,
		},
	]);
	await db.insert(submissions).values({
		id: "sub_priya",
		eventId: "e1",
		type: "session",
		title: "Priya's Talk",
		status: "accepted",
		submitterId: "u_priya",
	});
	await db.insert(taskAssignments).values([
		{ id: "ta_announce", taskId: "t_announce", contactId: "c_priya" },
		{ id: "ta_hotel", taskId: "t_hotel", contactId: "c_priya" },
		{
			id: "ta_slides",
			taskId: "t_slides",
			contactId: "c_priya",
			submissionId: "sub_priya",
		},
		{ id: "ta_headshot", taskId: "t_headshot", contactId: "c_priya" },
		{ id: "ta_dana", taskId: "t_announce", contactId: "c_dana" },
	]);
}

function act(
	userId: string,
	assignmentId: string,
	body: FormData | URLSearchParams,
) {
	return authedRequest(userId, `${BASE}/tasks/${assignmentId}`, {
		method: "POST",
		body,
	});
}

const params = (assignmentId: string) => ({ ...PORTAL_PARAMS, assignmentId });

describe("portal tasks", () => {
	it("404s another contact's assignment by direct URL", async () => {
		await seedTasks();
		const thrown = await catchThrown(async () =>
			taskLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/tasks/ta_dana`),
				params: params("ta_dana"),
			} as unknown as LoaderArgs),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("marks a simple task complete (and back to incomplete)", async () => {
		await seedTasks();
		const db = getDb(env);
		const done = await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_announce",
				new URLSearchParams({ intent: "complete" }),
			),
			params: params("ta_announce"),
		} as unknown as ActionArgs);
		expect((done as Response).status).toBe(302);
		let [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_announce"));
		expect(row?.status).toBe("complete");
		expect(row?.completedAt).not.toBeNull();

		await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_announce",
				new URLSearchParams({ intent: "uncomplete" }),
			),
			params: params("ta_announce"),
		} as unknown as ActionArgs);
		[row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_announce"));
		expect(row?.status).toBe("incomplete");
	});

	it("atomically persists only one concurrent first form response", async () => {
		await seedTasks();
		const db = getDb(env);
		const completedAt = new Date("2026-10-01T12:00:00Z");
		const [first, second] = await Promise.all([
			persistInitialPortalFormResponse(db, {
				assignmentId: "ta_hotel",
				contactId: "c_priya",
				answers: { "Check-in Date": "2026-10-11" },
				completedAt,
			}),
			persistInitialPortalFormResponse(db, {
				assignmentId: "ta_hotel",
				contactId: "c_priya",
				answers: { "Check-in Date": "2026-10-12" },
				completedAt,
			}),
		]);
		expect([first, second].sort()).toEqual([false, true]);
		const [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_hotel"));
		expect(row?.status).toBe("complete");
		expect(["2026-10-11", "2026-10-12"]).toContain(
			(row?.response as Record<string, string> | null)?.["Check-in Date"],
		);
	});

	it("rejects a form submission with a missing required field — nothing persisted", async () => {
		await seedTasks();
		const db = getDb(env);
		const result = (await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_hotel",
				new URLSearchParams({
					intent: "submit-form",
					"answer:Check-out Date": "2026-10-15",
				}),
			),
			params: params("ta_hotel"),
		} as unknown as ActionArgs)) as {
			fieldErrors?: Record<string, string[]>;
		};
		expect(result.fieldErrors?.["Check-in Date"]?.[0]).toBeTruthy();
		const [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_hotel"));
		expect(row?.response).toBeNull();
		expect(row?.status).toBe("incomplete");
	});

	it("stores the hotel-form answers, completes the task, and sends the confirmation email", async () => {
		await seedTasks();
		const db = getDb(env);
		const response = await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_hotel",
				new URLSearchParams({
					intent: "submit-form",
					"answer:Check-in Date": "2026-10-11",
					"answer:Check-out Date": "2026-10-15",
					"answer:Room Preference": "King",
					"answer:Special Requests": "Ground floor, near elevator",
				}),
			),
			params: params("ta_hotel"),
		} as unknown as ActionArgs);
		expect((response as Response).status).toBe(302);

		const [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_hotel"));
		expect(row?.status).toBe("complete");
		expect(row?.response).toMatchObject({
			"Check-in Date": "2026-10-11",
			"Check-out Date": "2026-10-15",
			"Room Preference": "King",
		});
		const outbox = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya@example.com"));
		expect(outbox).toHaveLength(1);

		// A second submit is refused — answers are review-owned once filed.
		const again = (await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_hotel",
				new URLSearchParams({
					intent: "submit-form",
					"answer:Check-in Date": "2026-10-12",
					"answer:Check-out Date": "2026-10-16",
				}),
			),
			params: params("ta_hotel"),
		} as unknown as ActionArgs)) as { formError?: string };
		expect(again.formError).toMatch(/already/i);
	});

	it("uploads a file into review (pending_feedback), versions the re-upload, round-trips bytes", async () => {
		await seedTasks();
		const db = getDb(env);

		const upload = async (name: string, content: string) => {
			const form = new FormData();
			form.set("intent", "upload");
			form.set("file", new File([content], name, { type: "application/pdf" }));
			return taskAction({
				context: CONTEXT,
				request: await act("u_priya", "ta_slides", form),
				params: params("ta_slides"),
			} as unknown as ActionArgs);
		};

		expect(((await upload("deck-v1.pdf", "PDF-ONE")) as Response).status).toBe(
			302,
		);
		let uploads = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_slides"));
		expect(uploads).toHaveLength(1);
		expect(uploads[0]?.version).toBe(1);
		expect(uploads[0]?.reviewStatus).toBe("pending");
		// Session tasks anchor their uploads: the files library's Session column
		// resolves through this copy of the assignment's submission.
		expect(uploads[0]?.submissionId).toBe("sub_priya");

		// A speaker-scoped (contact) file request has no session anywhere in its
		// chain — its upload stays honestly unattributed, never inferred.
		const headshotForm = new FormData();
		headshotForm.set("intent", "upload");
		headshotForm.set(
			"file",
			new File(["PNG"], "face.png", { type: "image/png" }),
		);
		await taskAction({
			context: CONTEXT,
			request: await act("u_priya", "ta_headshot", headshotForm),
			params: params("ta_headshot"),
		} as unknown as ActionArgs);
		const [headshotUpload] = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_headshot"));
		expect(headshotUpload?.submissionId).toBeNull();

		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_slides"));
		expect(assignment?.status).toBe("pending_feedback");

		expect(((await upload("deck-v2.pdf", "PDF-TWO")) as Response).status).toBe(
			302,
		);
		uploads = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_slides"));
		expect(uploads.map((u) => u.version).sort()).toEqual([1, 2]);

		// Byte-exact storage round-trip for the latest version.
		const v2 = uploads.find((u) => u.version === 2);
		const stored = await env.BLOBS.get(v2?.r2Key ?? "");
		expect(await stored?.text()).toBe("PDF-TWO");
	});

	it("rejects a disallowed extension and never writes a files row", async () => {
		await seedTasks();
		const db = getDb(env);
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File(["x"], "malware.exe", { type: "application/x-dosexec" }),
		);
		const result = (await taskAction({
			context: CONTEXT,
			request: await act("u_priya", "ta_slides", form),
			params: params("ta_slides"),
		} as unknown as ActionArgs)) as { fieldErrors?: Record<string, string[]> };
		expect(result.fieldErrors?.file?.[0]).toBeTruthy();
		expect(
			await db
				.select()
				.from(files)
				.where(eq(files.taskAssignmentId, "ta_slides")),
		).toHaveLength(0);
	});

	it("adds a comment to my uploaded file and refuses a foreign fileId", async () => {
		await seedTasks();
		const db = getDb(env);
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File(["PDF"], "deck.pdf", { type: "application/pdf" }),
		);
		await taskAction({
			context: CONTEXT,
			request: await act("u_priya", "ta_slides", form),
			params: params("ta_slides"),
		} as unknown as ActionArgs);
		const [upload] = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_slides"));

		const commented = unwrap<{ ok?: boolean }>(
			await taskAction({
				context: CONTEXT,
				request: await act(
					"u_priya",
					"ta_slides",
					new URLSearchParams({
						intent: "comment",
						fileId: upload?.id ?? "",
						body: "Speaker notes are on slide 12.",
					}),
				),
				params: params("ta_slides"),
			} as unknown as ActionArgs),
		);
		expect(commented.ok).toBe(true);
		const thread = await db
			.select()
			.from(fileComments)
			.where(eq(fileComments.fileId, upload?.id ?? ""));
		expect(thread).toHaveLength(1);
		expect(thread[0]?.authorName).toBe("Priya R");

		// A file that is not attached to THIS assignment is unreachable.
		await db.insert(files).values({
			id: "f_foreign",
			eventId: "e1",
			r2Key: "x/foreign",
			fileName: "foreign.pdf",
		});
		const thrown = await catchThrown(async () =>
			taskAction({
				context: CONTEXT,
				request: await act(
					"u_priya",
					"ta_slides",
					new URLSearchParams({
						intent: "comment",
						fileId: "f_foreign",
						body: "nope",
					}),
				),
				params: params("ta_slides"),
			} as unknown as ActionArgs),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});

	it("lands a replayed comment POST once; a fresh key posts the same words again", async () => {
		await seedTasks();
		const db = getDb(env);
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File(["PDF"], "deck.pdf", { type: "application/pdf" }),
		);
		await taskAction({
			context: CONTEXT,
			request: await act("u_priya", "ta_slides", form),
			params: params("ta_slides"),
		} as unknown as ActionArgs);
		const [upload] = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_slides"));

		const comment = async (body: string, commentKey: string) =>
			taskAction({
				context: CONTEXT,
				request: await act(
					"u_priya",
					"ta_slides",
					new URLSearchParams({
						intent: "comment",
						fileId: upload?.id ?? "",
						commentKey,
						body,
					}),
				),
				params: params("ta_slides"),
			} as unknown as ActionArgs);

		const thread = () =>
			db
				.select()
				.from(fileComments)
				.where(eq(fileComments.fileId, upload?.id ?? ""));

		// One submit firing twice replays the SAME client key — both report
		// success, one row lands.
		const key = crypto.randomUUID();
		const [firstResponse, secondResponse] = await Promise.all([
			comment("Speaker notes are on slide 12.", key),
			comment("Speaker notes are on slide 12.", key),
		]);
		const first = unwrap<{
			ok?: boolean;
			commentKey?: string;
			commentFileId?: string;
		}>(firstResponse);
		const second = unwrap<{
			ok?: boolean;
			commentKey?: string;
			commentFileId?: string;
		}>(secondResponse);
		expect(first).toMatchObject({ ok: true, commentFileId: upload?.id });
		expect(second).toMatchObject({ ok: true, commentFileId: upload?.id });
		expect(first.commentKey).not.toBe(key);
		expect(second.commentKey).not.toBe(key);
		expect(await thread()).toHaveLength(1);

		// The author label is server-derived display data, not part of the
		// logical operation. A rename between a committed write and its replay
		// must not turn that replay into a second comment.
		await db
			.update(contacts)
			.set({ firstName: "Priyanka" })
			.where(eq(contacts.id, "c_priya"));
		await comment("Speaker notes are on slide 12.", key);
		expect(await thread()).toHaveLength(1);

		// Reusing a visible key with changed text is a new logical comment, but
		// replaying that changed request still lands once.
		await comment("Edited speaker notes.", key);
		await comment("Edited speaker notes.", key);
		expect(await thread()).toHaveLength(2);

		// A deliberate re-post of the same words rides a FRESH key and lands —
		// comments send no notifications, so a re-ping must never vanish.
		await comment("Speaker notes are on slide 12.", crypto.randomUUID());
		expect(await thread()).toHaveLength(3);

		// A missing/garbage key never blocks the post — the server mints one.
		const bare = await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_slides",
				new URLSearchParams({
					intent: "comment",
					fileId: upload?.id ?? "",
					commentKey: "not-a-uuid",
					body: "No key, still lands.",
				}),
			),
			params: params("ta_slides"),
		} as unknown as ActionArgs);
		expect(unwrap<{ ok?: boolean }>(bare).ok).toBe(true);
		expect(await thread()).toHaveLength(4);

		// Comment ids are visible in loader payloads — a key colliding with
		// ANOTHER author's row is not a replay and must not eat the comment.
		const organizerRowId = crypto.randomUUID();
		await db.insert(fileComments).values({
			id: organizerRowId,
			fileId: upload?.id ?? "",
			authorId: null,
			authorName: "Olive Organizer",
			body: "Looks good.",
		});
		await comment("Collides with a foreign id, still lands.", organizerRowId);
		await comment("Collides with a foreign id, still lands.", organizerRowId);
		expect(await thread()).toHaveLength(6);
	});

	it("serializes comments with the author's real name, an isYou flag, and a date+time stamp", async () => {
		await seedTasks();
		const db = getDb(env);
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File(["PDF"], "deck.pdf", { type: "application/pdf" }),
		);
		await taskAction({
			context: CONTEXT,
			request: await act("u_priya", "ta_slides", form),
			params: params("ta_slides"),
		} as unknown as ActionArgs);
		const [upload] = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_slides"));
		await taskAction({
			context: CONTEXT,
			request: await act(
				"u_priya",
				"ta_slides",
				new URLSearchParams({
					intent: "comment",
					fileId: upload?.id ?? "",
					body: "Ready for review.",
				}),
			),
			params: params("ta_slides"),
		} as unknown as ActionArgs);
		await db.insert(fileComments).values({
			fileId: upload?.id ?? "",
			authorId: null,
			authorName: "Olive Organizer",
			body: "Looks great.",
		});
		await db
			.update(files)
			.set({ createdAt: new Date("2026-08-10T00:30:00Z") })
			.where(eq(files.id, upload?.id ?? ""));
		await db
			.update(fileComments)
			.set({ createdAt: new Date("2026-08-10T01:30:00Z") })
			.where(eq(fileComments.body, "Ready for review."));
		await db
			.update(fileComments)
			.set({ createdAt: new Date("2026-08-10T02:30:00Z") })
			.where(eq(fileComments.body, "Looks great."));
		await db
			.update(events)
			.set({ timezone: "Not/A-Timezone" })
			.where(eq(events.id, "e1"));

		const loaded = unwrap<{
			fileRequest: {
				files: Array<{
					commentKey: string;
					uploadedOn: string;
					comments: Array<{
						author: string;
						isYou: boolean;
						body: string;
						on: string;
					}>;
				}>;
			};
		}>(
			await taskLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/tasks/ta_slides`),
				params: params("ta_slides"),
			} as unknown as LoaderArgs),
		);
		const file = loaded.fileRequest.files[0];
		expect(file?.commentKey).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		// The thread names its authors — the viewer is flagged, never renamed.
		expect(file?.comments.map((c) => [c.author, c.isYou])).toEqual([
			["Priya R", true],
			["Olive Organizer", false],
		]);
		// The invalid imported timezone degrades to exact UTC date-times.
		expect(file?.uploadedOn).toBe("Aug 10, 2026, 12:30 AM UTC");
		expect(file?.comments.map((comment) => comment.on)).toEqual([
			"Aug 10, 2026, 1:30 AM UTC",
			"Aug 10, 2026, 2:30 AM UTC",
		]);
	});
});
