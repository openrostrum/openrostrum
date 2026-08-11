import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	fileComments,
	files,
	portalForms,
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
	]);
	await db.insert(taskAssignments).values([
		{ id: "ta_announce", taskId: "t_announce", contactId: "c_priya" },
		{ id: "ta_hotel", taskId: "t_hotel", contactId: "c_priya" },
		{ id: "ta_slides", taskId: "t_slides", contactId: "c_priya" },
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
});
