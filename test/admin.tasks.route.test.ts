import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	contacts,
	emailOutbox,
	emailSuppressions,
	events,
	organizations,
	participants,
	portalForms,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { action, loader } from "../app/routes/admin.tasks";
import {
	authedRequest,
	CONTEXT,
	DAY_MS,
	postForm,
	seedTasksBaseline,
} from "./tasks-fixtures";

// The dashboard's numbers must equal an independent aggregation of the fixture:
// Priya owes 2 (one overdue), Bob owes 1 (pending feedback), Carol owes 0.

type UnwrappedAction = {
	notice?: string;
	formError?: string;
	fieldErrors?: Record<string, string[]>;
};

/** Actions may return `data(result, { headers })` — read through the wrapper. */
function unwrapAction(result: unknown): UnwrappedAction {
	const maybe = result as { data?: UnwrappedAction };
	return maybe && typeof maybe === "object" && "data" in maybe && maybe.data
		? maybe.data
		: (result as UnwrappedAction);
}

async function seedAssignmentsMix() {
	const db = await seedTasksBaseline();
	const past = new Date(Date.now() - 5 * DAY_MS);
	const future = new Date(Date.now() + 5 * DAY_MS);
	await db.insert(taskAssignments).values([
		{
			id: "ta_priya_hotel",
			taskId: "t_hotel",
			contactId: "c_priya",
			status: "incomplete",
			dueAt: past,
		},
		{
			id: "ta_priya_flight",
			taskId: "t_flight",
			contactId: "c_priya",
			status: "incomplete",
			dueAt: future,
		},
		{
			id: "ta_bob_slides",
			taskId: "t_slides",
			contactId: "c_bob",
			submissionId: "s2",
			status: "pending_feedback",
		},
		{
			id: "ta_bob_hotel",
			taskId: "t_hotel",
			contactId: "c_bob",
			status: "complete",
			completedAt: new Date(),
		},
		{
			id: "ta_carol_hotel",
			taskId: "t_hotel",
			contactId: "c_carol",
			status: "complete",
			completedAt: new Date(),
		},
	]);
	return db;
}

type LoaderResult = {
	data: {
		stats: {
			speakersOutstanding: number;
			totalOutstanding: number;
			overdue: number;
			totalAssignments: number;
		};
		speakers: Array<{
			email: string;
			outstanding: number;
			items: Array<{ taskName: string; overdue: boolean }>;
		}>;
		speakersTotal: number;
		assignments: Array<{ id: string; status: string; email: string }>;
		assignmentsTotal: number;
	};
};

async function runLoader(url: string): Promise<LoaderResult["data"]> {
	const request = await authedRequest(url);
	const result = (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
	return result.data;
}

describe("outstanding-tasks dashboard", () => {
	it("aggregates per speaker and the headline counts match the seeded truth", async () => {
		await seedAssignmentsMix();
		const data = await runLoader("http://localhost/admin/tasks");

		expect(data.stats.speakersOutstanding).toBe(2);
		expect(data.stats.totalOutstanding).toBe(3);
		expect(data.stats.overdue).toBe(1);
		expect(data.stats.totalAssignments).toBe(5);

		// Priya (2 outstanding) ranks above Bob (1); Carol is absent.
		expect(data.speakers.map((s) => s.email)).toEqual([
			"priya.sharma@example.com",
			"bob@example.com",
		]);
		const priya = data.speakers[0];
		expect(priya?.outstanding).toBe(2);
		expect(priya?.items.map((i) => i.taskName).sort()).toEqual([
			"Flight Reimbursement",
			"Hotel Stay Requirements",
		]);
		expect(
			priya?.items.find((i) => i.taskName === "Hotel Stay Requirements")
				?.overdue,
		).toBe(true);
	});

	it("search and the task filter narrow the speaker list", async () => {
		await seedAssignmentsMix();
		const byName = await runLoader("http://localhost/admin/tasks?q=priya");
		expect(byName.speakers.map((s) => s.email)).toEqual([
			"priya.sharma@example.com",
		]);
		expect(byName.speakersTotal).toBe(1);

		const byTask = await runLoader(
			"http://localhost/admin/tasks?taskId=t_flight",
		);
		expect(byTask.speakers.map((s) => s.email)).toEqual([
			"priya.sharma@example.com",
		]);

		const noMatch = await runLoader("http://localhost/admin/tasks?q=zzz");
		expect(noMatch.speakers).toEqual([]);
	});

	it("assignments view filters by status and due date", async () => {
		await seedAssignmentsMix();
		const complete = await runLoader(
			"http://localhost/admin/tasks?view=assignments&status=complete",
		);
		expect(complete.assignments).toHaveLength(2);
		expect(complete.assignments.every((a) => a.status === "complete")).toBe(
			true,
		);

		const overdue = await runLoader(
			"http://localhost/admin/tasks?view=assignments&due=overdue",
		);
		expect(overdue.assignments.map((a) => a.id)).toEqual(["ta_priya_hotel"]);

		const pending = await runLoader(
			"http://localhost/admin/tasks?view=assignments&status=pending_feedback",
		);
		expect(pending.assignments.map((a) => a.id)).toEqual(["ta_bob_slides"]);
	});

	it("rejects non-admin users", async () => {
		await seedAssignmentsMix();
		const request = await authedRequest("http://localhost/admin/tasks", {
			role: "speaker",
		});
		const thrown = await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0]).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});
});

describe("task definitions", () => {
	it("rejects an empty name and writes no row", async () => {
		const db = await seedTasksBaseline();
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "create-task",
				name: "   ",
				type: "contact",
			}),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: Record<string, string[]>;
		};
		expect(result.fieldErrors?.name?.[0]).toBe("Task name is required");
		const rows = await db.select().from(tasks).where(eq(tasks.eventId, "e1"));
		expect(rows).toHaveLength(3); // only the seeded definitions
	});

	it("flags the new definition in the redirect and loader so the create form resets (consecutive creates must not inherit the previous task's values)", async () => {
		const db = await seedTasksBaseline();
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "create-task",
				name: "Task Alpha",
				type: "contact",
				dueInDays: "5",
				required: "yes",
				autoAssign: "no",
			}),
		);
		const result = await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0]);
		expect(result).toBeInstanceOf(Response);
		const [row] = await db
			.select({ id: tasks.id })
			.from(tasks)
			.where(and(eq(tasks.eventId, "e1"), eq(tasks.name, "Task Alpha")));
		expect(row).toBeTruthy();
		// The `created` flag is what remounts (clears) the client form.
		expect((result as Response).headers.get("Location")).toBe(
			`/admin/tasks?view=definitions&created=${row?.id}`,
		);

		const loaderRequest = await authedRequest(
			`http://localhost/admin/tasks?view=definitions&created=${row?.id}`,
		);
		const loaded = (await loader({
			context: CONTEXT,
			request: loaderRequest,
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as {
			data: { createdId: string | null; createdName: string | null };
		};
		expect(loaded.data.createdId).toBe(row?.id);
		expect(loaded.data.createdName).toBe("Task Alpha");
	});

	it("creates a task with an attached portal form and due-in-days", async () => {
		const db = await seedTasksBaseline();
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "create-task",
				name: "AV Requirements Check",
				type: "contact",
				description: "Tell us your microphone and display needs.",
				completion: "form:pf_hotel",
				dueInDays: "7",
				required: "yes",
				autoAssign: "no",
			}),
		);
		const result = await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0]);
		expect(result).toBeInstanceOf(Response); // redirect on success
		const [row] = await db
			.select()
			.from(tasks)
			.where(
				and(eq(tasks.eventId, "e1"), eq(tasks.name, "AV Requirements Check")),
			);
		expect(row).toMatchObject({
			portalFormId: "pf_hotel",
			isFileRequest: false,
			dueInDays: 7,
			required: true,
			isOnboardingDefault: false,
		});
	});

	it("refuses to attach a portal form that belongs to another event", async () => {
		const db = await seedTasksBaseline();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other",
			slug: "other",
		});
		await db.insert(portalForms).values({
			id: "pf_other",
			eventId: "e2",
			name: "Other form",
			targetType: "contact",
		});
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "create-task",
				name: "Sneaky",
				type: "contact",
				completion: "form:pf_other",
				required: "yes",
				autoAssign: "no",
			}),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: Record<string, string[]>;
		};
		expect(result.fieldErrors?.completion?.[0]).toBeTruthy();
		const rows = await db.select().from(tasks).where(eq(tasks.name, "Sneaky"));
		expect(rows).toHaveLength(0);
	});
});

describe("bulk assignment", () => {
	async function assign(taskId: string, target = "accepted") {
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "assign-task",
				taskId,
				target,
				dueDate: "",
			}),
		);
		return unwrapAction(
			await action({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as Parameters<typeof action>[0]),
		);
	}

	it("is idempotent — re-running the assign never duplicates", async () => {
		const db = await seedTasksBaseline();
		const first = await assign("t_flight");
		expect(first.notice).toContain("2 speakers"); // Priya + Bob are accepted
		const second = await assign("t_flight");
		expect(second.notice).toContain("0 speakers");
		expect(second.notice).toContain("2 already had it");
		const rows = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "t_flight"));
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.contactId)).size).toBe(2);
	});

	it("submission-type assignments always carry contactId AND submissionId", async () => {
		const db = await seedTasksBaseline();
		await assign("t_slides");
		const rows = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "t_slides"));
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.contactId).toBeTruthy();
			expect(row.submissionId).toBeTruthy();
		}
		expect(rows.map((r) => r.submissionId).sort()).toEqual(["s1", "s2"]);
	});

	it("assigns accepted-session work to every speaker role and excludes non-speaker roles", async () => {
		const db = await seedTasksBaseline();
		await db.insert(contacts).values([
			{
				id: "c_co_speaker",
				eventId: "e1",
				email: "co-speaker@example.com",
				firstName: "Co",
				lastName: "Speaker",
			},
			{
				id: "c_moderator",
				eventId: "e1",
				email: "moderator@example.com",
				firstName: "Mo",
				lastName: "Derator",
			},
		]);
		await db.insert(participants).values([
			{
				id: "p_co_speaker",
				submissionId: "s1",
				contactId: "c_co_speaker",
				role: "speaker",
				position: 1,
			},
			{
				id: "p_moderator",
				submissionId: "s1",
				contactId: "c_moderator",
				role: "moderator",
				position: 2,
			},
		]);

		await assign("t_slides");
		await assign("t_flight");

		const allAssignments = await db.select().from(taskAssignments);
		const slides = allAssignments.filter((row) => row.taskId === "t_slides");
		expect(slides.map((row) => row.contactId).sort()).toEqual([
			"c_bob",
			"c_co_speaker",
			"c_priya",
		]);
		const flights = allAssignments.filter((row) => row.taskId === "t_flight");
		expect(flights.map((row) => row.contactId).sort()).toEqual([
			"c_bob",
			"c_co_speaker",
			"c_priya",
		]);
		expect(allAssignments.some((row) => row.contactId === "c_moderator")).toBe(
			false,
		);
	});

	it("a multi-talk speaker gets one submission-task assignment per accepted talk — and replays add nothing", async () => {
		const db = await seedTasksBaseline();
		// Priya picks up a second accepted talk.
		await db.insert(submissions).values({
			id: "s4",
			eventId: "e1",
			title: "Talk C",
			status: "accepted",
		});
		await db.insert(participants).values({
			id: "p4",
			submissionId: "s4",
			contactId: "c_priya",
			role: "speaker",
			isPrimary: true,
		});

		const first = await assign("t_slides");
		expect(first.notice).toContain("3 speakers");
		const rows = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "t_slides"));
		expect(rows.map((r) => r.submissionId).sort()).toEqual(["s1", "s2", "s4"]);
		expect(rows.filter((r) => r.contactId === "c_priya")).toHaveLength(2);

		const second = await assign("t_slides");
		expect(second.notice).toContain("0 speakers");
		expect(second.notice).toContain("3 already had it");
		expect(
			await db
				.select()
				.from(taskAssignments)
				.where(eq(taskAssignments.taskId, "t_slides")),
		).toHaveLength(3);
	});

	it("derives dueAt from the task's dueInDays when no date is given", async () => {
		const db = await seedTasksBaseline();
		await assign("t_hotel"); // dueInDays: 14
		const rows = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "t_hotel"));
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.dueAt).not.toBeNull();
			const days = (row.dueAt as Date).getTime() - Date.now();
			expect(days).toBeGreaterThan(13 * DAY_MS);
			expect(days).toBeLessThanOrEqual(14 * DAY_MS);
		}
	});
});

describe("bulk reminder (manual)", () => {
	async function remind() {
		const request = await authedRequest(
			"http://localhost/admin/tasks",
			{},
			postForm("http://localhost/admin/tasks", {
				intent: "remind-outstanding",
				taskId: "",
			}),
		);
		return unwrapAction(
			await action({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as Parameters<typeof action>[0]),
		);
	}

	it("emails exactly the speakers with INCOMPLETE work — pending feedback and complete are skipped", async () => {
		const db = await seedAssignmentsMix();
		// Unsubscribed speakers still get task reminders — they are a consequence
		// of the speaker's own participation, never suppressed.
		await db
			.insert(emailSuppressions)
			.values({ email: "priya.sharma@example.com" });

		const result = await remind();
		expect(result.notice).toContain("Sent 1 reminder");
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("priya.sharma@example.com");
		expect(outbox[0]?.subject).toContain("2 outstanding speaker tasks");
		expect(outbox[0]?.html).toContain("Hotel Stay Requirements");
		expect(outbox[0]?.html).toContain("Flight Reimbursement");
		expect(outbox[0]?.html).toContain("/portals/democonf/portal-public-1");
	});

	it("a double-submit (or a retry after partial failure) never re-delivers the same batch", async () => {
		const db = await seedAssignmentsMix();
		await remind();
		const again = await remind();
		expect(again.notice).toContain("already sent");
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
	});

	it("re-sends once the speaker's outstanding set changes", async () => {
		const db = await seedAssignmentsMix();
		await remind();
		// Priya completes one of her two tasks — her outstanding set changed.
		await db
			.update(taskAssignments)
			.set({ status: "complete", completedAt: new Date() })
			.where(eq(taskAssignments.id, "ta_priya_hotel"));
		await remind();
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
		expect(new Set(outbox.map((o) => o.dedupeKey)).size).toBe(2);
		const second = outbox.find((o) =>
			o.subject.includes("1 outstanding speaker task"),
		);
		expect(second?.html).toContain("Flight Reimbursement");
		expect(second?.html).not.toContain("Hotel Stay Requirements");
	});
});
