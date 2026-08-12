import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	events,
	files,
	organizations,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { action, loader } from "../app/routes/admin.tasks_.$assignmentId";
import {
	authedRequest,
	CONTEXT,
	DAY_MS,
	postForm,
	seedTasksBaseline,
	unwrap,
} from "./tasks-fixtures";

// Contracts under test: the admin reads the submitted answers verbatim on
// screen; deny reopens the task while approve (and only approve) completes it,
// with every version row retained; editing dueAt re-arms the automated reminder.

async function seedAssignment() {
	const db = await seedTasksBaseline();
	await db.insert(taskAssignments).values({
		id: "ta_priya_hotel",
		taskId: "t_hotel",
		contactId: "c_priya",
		status: "complete",
		response: {
			"Hotel name": "Marriott Marquis",
			"Check-in date": "2026-10-11",
		},
		completedAt: new Date(),
		dueAt: new Date(Date.now() + 10 * DAY_MS),
		reminderSentAt: new Date(),
	});
	return db;
}

type UnwrappedAction = {
	notice?: string;
	formError?: string;
	fieldErrors?: Record<string, string[]>;
};

/** Actions may return `data(result, { headers })` — read through the wrapper. */
const unwrapAction = (result: unknown) => unwrap<UnwrappedAction>(result);

async function callAction(
	assignmentId: string,
	fields: Record<string, string>,
) {
	const url = `http://localhost/admin/tasks/${assignmentId}`;
	const request = await authedRequest(url, {}, postForm(url, fields));
	return unwrapAction(
		await action({
			context: CONTEXT,
			request,
			params: { assignmentId },
		} as unknown as Parameters<typeof action>[0]),
	);
}

describe("task response view", () => {
	it("returns the submitted answers verbatim with the form schema", async () => {
		await seedAssignment();
		const request = await authedRequest(
			"http://localhost/admin/tasks/ta_priya_hotel",
		);
		const result = (await loader({
			context: CONTEXT,
			request,
			params: { assignmentId: "ta_priya_hotel" },
		} as unknown as Parameters<typeof loader>[0])) as unknown as {
			data: {
				assignment: { response: Record<string, unknown>; status: string };
				portalForm: { schema: Array<{ name: string }> } | null;
				contact: { email: string } | null;
			};
		};
		expect(result.data.assignment.response["Hotel name"]).toBe(
			"Marriott Marquis",
		);
		expect(result.data.assignment.response["Check-in date"]).toBe("2026-10-11");
		expect(result.data.portalForm?.schema.map((f) => f.name)).toEqual([
			"Hotel name",
			"Check-in date",
		]);
		expect(result.data.contact?.email).toBe("priya.sharma@example.com");
	});

	it("404s for an assignment outside the admin's active event", async () => {
		const db = await seedAssignment();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other",
			slug: "other",
		});
		await db.insert(tasks).values({
			id: "t_other",
			eventId: "e2",
			name: "Other task",
			type: "contact",
		});
		await db.insert(taskAssignments).values({
			id: "ta_other",
			taskId: "t_other",
			status: "incomplete",
		});
		// Admin's active event is e1 — e2's assignment must be unreachable.
		const request = await authedRequest(
			"http://localhost/admin/tasks/ta_other",
		);
		const thrown = await loader({
			context: CONTEXT,
			request,
			params: { assignmentId: "ta_other" },
		} as unknown as Parameters<typeof loader>[0]).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(404);
	});
});

describe("due-date edits (reminder re-arm)", () => {
	it("setting a new due date clears reminderSentAt so the cron re-fires", async () => {
		const db = await seedAssignment();
		const result = await callAction("ta_priya_hotel", {
			intent: "set-due",
			dueDate: "2026-12-01",
		});
		expect(result.notice).toContain("re-armed");
		const [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_hotel"));
		expect(row?.reminderSentAt).toBeNull();
		// Stored as UTC end-of-day of the chosen date.
		expect(row?.dueAt?.toISOString()).toBe("2026-12-01T23:59:59.000Z");
	});

	it("clearing the due date also clears the reminder stamp", async () => {
		const db = await seedAssignment();
		await callAction("ta_priya_hotel", { intent: "set-due", dueDate: "" });
		const [row] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_hotel"));
		expect(row?.dueAt).toBeNull();
		expect(row?.reminderSentAt).toBeNull();
	});
});

describe("file-request review (approve/deny)", () => {
	async function seedUpload() {
		const db = await seedTasksBaseline();
		await db.insert(taskAssignments).values({
			id: "ta_priya_slides",
			taskId: "t_slides",
			contactId: "c_priya",
			submissionId: "s1",
			status: "pending_feedback",
		});
		await db.insert(files).values({
			id: "f_v1",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "tasks/ta_priya_slides/v1/vector-search-keynote-v1.pdf",
			fileName: "vector-search-keynote-v1.pdf",
			kind: "slides",
			version: 1,
			reviewStatus: "pending",
		});
		return db;
	}

	it("deny reopens the task and records the note; the version row is kept", async () => {
		const db = await seedUpload();
		const result = await callAction("ta_priya_slides", {
			intent: "deny-file",
			fileId: "f_v1",
			reviewNote: "Wrong deck — please upload the final version.",
		});
		expect(result.notice).toContain("denied");
		const [file] = await db.select().from(files).where(eq(files.id, "f_v1"));
		expect(file?.reviewStatus).toBe("denied");
		expect(file?.reviewNote).toBe(
			"Wrong deck — please upload the final version.",
		);
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("incomplete");
		expect(assignment?.completedAt).toBeNull();
	});

	it("approve completes the task; earlier denied versions are retained", async () => {
		const db = await seedUpload();
		await callAction("ta_priya_slides", {
			intent: "deny-file",
			fileId: "f_v1",
			reviewNote: "",
		});
		await db.insert(files).values({
			id: "f_v2",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "tasks/ta_priya_slides/v2/vector-search-keynote-v2.pdf",
			fileName: "vector-search-keynote-v2.pdf",
			kind: "slides",
			version: 2,
			reviewStatus: "pending",
		});
		const result = await callAction("ta_priya_slides", {
			intent: "approve-file",
			fileId: "f_v2",
		});
		expect(result.notice).toContain("approved");
		const rows = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, "ta_priya_slides"))
			.orderBy(files.version);
		expect(rows.map((r) => [r.version, r.reviewStatus])).toEqual([
			[1, "denied"],
			[2, "approved"],
		]);
		const [assignment] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_priya_slides"));
		expect(assignment?.status).toBe("complete");
		expect(assignment?.completedAt).not.toBeNull();
	});

	it("refuses a file that belongs to a different assignment", async () => {
		const db = await seedUpload();
		await db.insert(taskAssignments).values({
			id: "ta_bob_slides",
			taskId: "t_slides",
			contactId: "c_bob",
			submissionId: "s2",
			status: "incomplete",
		});
		const result = await callAction("ta_bob_slides", {
			intent: "approve-file",
			fileId: "f_v1", // Priya's upload
		});
		expect(result.formError).toBeTruthy();
		const [file] = await db.select().from(files).where(eq(files.id, "f_v1"));
		expect(file?.reviewStatus).toBe("pending");
		const [bob] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_bob_slides"));
		expect(bob?.status).toBe("incomplete");
	});
});
