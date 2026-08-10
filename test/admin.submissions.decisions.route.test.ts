import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	emailTemplates,
	events,
	organizations,
	participants,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/admin.submissions";

// Wiring oracle: the admin route's decision intents must run through the
// shared spine with the caller-side guarantees the scenarios demand — event
// scoping (cross-event rows untouchable), no email on status change, and the
// send action emailing + finalizing in one explicit step.

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedWorld() {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org1", name: "Org One" },
		{ id: "org2", name: "Org Two" },
	]);
	await db.insert(events).values([
		{ id: "e1", organizationId: "org1", name: "Mine", slug: "mine" },
		{ id: "e2", organizationId: "org2", name: "Theirs", slug: "theirs" },
	]);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	await db.insert(emailTemplates).values([
		{
			id: "et_accept",
			eventId: "e1",
			key: "accept",
			name: "Accept Sessions",
			subject: "Your session was accepted",
			bodyHtml: "<p>You are in!</p>",
		},
		{
			id: "et_decline",
			eventId: "e1",
			key: "decline",
			name: "Decline Sessions",
			subject: "Update on your submission",
			bodyHtml: "<p>Thanks for submitting.</p>",
		},
	]);
	await db.insert(tasks).values([
		{
			id: "task_hotel",
			eventId: "e1",
			name: "Hotel Stay Requirement",
			type: "contact",
			isOnboardingDefault: true,
		},
		{
			id: "task_flight",
			eventId: "e1",
			name: "Flight Reimbursement",
			type: "contact",
			isOnboardingDefault: true,
		},
	]);
	return db;
}

async function requestAs(
	userId: string,
	body: URLSearchParams,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	return new Request("http://localhost/admin/submissions", {
		method: "POST",
		body,
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
}

async function seedSubmissionWithSpeaker(
	id: string,
	status: (typeof submissions.$inferInsert)["status"],
	email: string,
	eventId = "e1",
) {
	const db = getDb(env);
	await db.insert(submissions).values({
		id,
		eventId,
		title: `Talk ${id}`,
		status,
	});
	await db.insert(contacts).values({
		id: `c_${id}`,
		eventId,
		email,
		firstName: "F",
		lastName: "L",
	});
	await db.insert(participants).values({
		submissionId: id,
		contactId: `c_${id}`,
		role: "speaker",
		isPrimary: true,
	});
}

describe("set-status intent", () => {
	it("flips the status through the spine and sends nothing", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker("s1", "pending", "priya@example.com");
		const request = await requestAs(
			"u_admin",
			new URLSearchParams({
				intent: "set-status",
				submissionId: "s1",
				status: "accept_queue",
			}),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as { notice?: string };

		expect(result.notice).toContain("accept queue");
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("accept_queue");
		expect(row?.statusChangedAt).toBeInstanceOf(Date);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("rejects withdrawn as an inline target (the withdraw flow owns it)", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker("s1", "accepted", "priya@example.com");
		const request = await requestAs(
			"u_admin",
			new URLSearchParams({
				intent: "set-status",
				submissionId: "s1",
				status: "withdrawn",
			}),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: Record<string, string[] | undefined>;
		};
		expect(result.fieldErrors?.status?.[0]).toBeTruthy();
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("accepted");
	});

	it("cannot touch another event's submission", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker(
			"foreign",
			"pending",
			"other@example.com",
			"e2",
		);
		const request = await requestAs(
			"u_admin",
			new URLSearchParams({
				intent: "set-status",
				submissionId: "foreign",
				status: "accepted",
			}),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as { formError?: string };

		expect(result.formError).toMatch(/does not belong/i);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "foreign"));
		expect(row?.status).toBe("pending");
		expect(await db.select().from(taskAssignments)).toHaveLength(0);
	});

	it("refuses a non-admin session before any write", async () => {
		const db = await seedWorld();
		await db.insert(users).values({
			id: "u_speaker",
			email: "speaker@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		await seedSubmissionWithSpeaker("s1", "pending", "priya@example.com");
		const request = await requestAs(
			"u_speaker",
			new URLSearchParams({
				intent: "set-status",
				submissionId: "s1",
				status: "accepted",
			}),
		);
		await expect(
			action({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as Parameters<typeof action>[0]),
		).rejects.toSatisfy(
			(thrown) =>
				thrown instanceof Response && thrown.headers.get("Location") === "/403",
		);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("pending");
	});
});

describe("bulk + send-decisions intents", () => {
	it("bulk apply transitions the selection and reports skipped rows", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker("s1", "pending", "a@example.com");
		await seedSubmissionWithSpeaker("s2", "pending", "b@example.com");
		await seedSubmissionWithSpeaker("s3", "draft", "c@example.com");
		const request = await requestAs(
			"u_admin",
			new URLSearchParams([
				["intent", "bulk-set-status"],
				["submissionIds", "s1"],
				["submissionIds", "s2"],
				["submissionIds", "s3"],
				["status", "decline_queue"],
			]),
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			notice?: string;
			skipped?: string[];
		};
		expect(result.notice).toContain("2 submissions set to decline queue");
		expect(result.skipped?.join(" ")).toMatch(/draft/i);
		const rows = await db.select().from(submissions);
		const byId = new Map(rows.map((r) => [r.id, r.status]));
		expect(byId.get("s1")).toBe("decline_queue");
		expect(byId.get("s2")).toBe("decline_queue");
		expect(byId.get("s3")).toBe("draft");
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("send-accept emails each selected row, finalizes it, and provisions — replay-safe", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker("s1", "accept_queue", "marco@example.com");
		await seedSubmissionWithSpeaker("s2", "accept_queue", "dana@example.com");
		await seedSubmissionWithSpeaker("s3", "draft", "ghost@example.com");
		const body = new URLSearchParams([
			["intent", "send-accept"],
			["submissionIds", "s1"],
			["submissionIds", "s2"],
			["submissionIds", "s3"],
			["idempotencyKey", "form-key-1"],
		]);
		const result = (await action({
			context: CONTEXT,
			request: await requestAs("u_admin", body),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			notice?: string;
			skipped?: string[];
		};

		expect(result.notice).toContain("2 accept emails sent");
		expect(result.notice).toContain("2 submissions finalized as accepted");
		expect(result.skipped?.join(" ")).toMatch(/draft/i);

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
		expect(new Set(outbox.map((o) => o.to))).toEqual(
			new Set(["marco@example.com", "dana@example.com"]),
		);
		expect(outbox.every((o) => o.subject === "Your session was accepted")).toBe(
			true,
		);
		const rows = await db.select().from(submissions);
		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.get("s1")?.status).toBe("accepted");
		expect(byId.get("s2")?.status).toBe("accepted");
		expect(byId.get("s1")?.notifiedAt).toBeInstanceOf(Date);
		expect(byId.get("s3")?.status).toBe("draft");
		expect(byId.get("s3")?.notifiedAt).toBeNull();
		// The spine ran: 2 speakers × 2 onboarding tasks.
		expect(await db.select().from(taskAssignments)).toHaveLength(4);

		// Double-submit replay: same form key → no extra email, no extra tasks.
		const replay = (await action({
			context: CONTEXT,
			request: await requestAs("u_admin", body),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as { notice?: string };
		expect(replay.notice).toContain("0 accept emails sent");
		expect(await db.select().from(emailOutbox)).toHaveLength(2);
		expect(await db.select().from(taskAssignments)).toHaveLength(4);
	});

	it("send-decline finalizes to declined with the decline template", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker("s1", "decline_queue", "tom@example.com");
		const result = (await action({
			context: CONTEXT,
			request: await requestAs(
				"u_admin",
				new URLSearchParams([
					["intent", "send-decline"],
					["submissionIds", "s1"],
					["idempotencyKey", "form-key-2"],
				]),
			),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as { notice?: string };

		expect(result.notice).toContain("1 decline email sent");
		const [mail] = await db.select().from(emailOutbox);
		expect(mail?.subject).toBe("Update on your submission");
		expect(mail?.icsAttachment).toBeNull();
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("declined");
		// Declining provisions nothing.
		expect(await db.select().from(taskAssignments)).toHaveLength(0);
	});

	it("send-accept refuses rows from another event without emailing them", async () => {
		const db = await seedWorld();
		await seedSubmissionWithSpeaker(
			"foreign",
			"accept_queue",
			"other@example.com",
			"e2",
		);
		const result = (await action({
			context: CONTEXT,
			request: await requestAs(
				"u_admin",
				new URLSearchParams([
					["intent", "send-accept"],
					["submissionIds", "foreign"],
					["idempotencyKey", "form-key-3"],
				]),
			),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			skipped?: string[];
		};
		expect(result.skipped?.join(" ")).toMatch(/not part of this event/i);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "foreign"));
		expect(row?.status).toBe("accept_queue");
	});
});
