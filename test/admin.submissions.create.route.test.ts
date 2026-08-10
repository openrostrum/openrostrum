import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	events,
	organizationMembers,
	organizations,
	participants,
	submissionRevisions,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/admin.submissions";

// The "+ Add Submission / Add Session" drawer POSTs to the ONE create action
// on /admin/submissions — these tests pin the drawer-specific contract.

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
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	await db.insert(contacts).values([
		{
			id: "c1",
			eventId: "e1",
			email: "a@x.co",
			firstName: "Ada",
			lastName: "One",
		},
		{
			id: "c2",
			eventId: "e1",
			email: "b@x.co",
			firstName: "Bo",
			lastName: "Two",
		},
		{
			id: "c_foreign",
			eventId: "e2",
			email: "f@x.co",
			firstName: "Not",
			lastName: "Yours",
		},
	]);
	return db;
}

async function post(body: URLSearchParams) {
	const setCookie = await createSession(env, "u_admin");
	const request = new Request("http://localhost/admin/submissions", {
		method: "POST",
		body,
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

describe("drawer create", () => {
	it("creates with speakers, server-derives eventId, snapshots the content, answers data (not a redirect)", async () => {
		const db = await seedWorld();
		const result = (await post(
			new URLSearchParams([
				["drawer", "1"],
				["title", "Manual session"],
				["type", "session"],
				["status", "pending"],
				["description", "Added by hand."],
				["participantContactIds", "c1"],
				["participantContactIds", "c2"],
				["eventId", "e2"], // forged — must be ignored
			]),
		)) as { data: { created?: boolean; notice?: string } };

		expect(result.data.created).toBe(true);
		const [row] = await db.select().from(submissions);
		expect(row?.eventId).toBe("e1"); // server-derived, never the client's
		expect(row?.title).toBe("Manual session");
		expect(row?.description).toBe("Added by hand.");

		const people = await db
			.select()
			.from(participants)
			.orderBy(participants.position);
		expect(people).toHaveLength(2);
		expect(people[0]?.contactId).toBe("c1");
		expect(people[0]?.isPrimary).toBe(true);
		expect(people[1]?.isPrimary).toBe(false);
		expect(people.every((p) => p.role === "speaker")).toBe(true);

		// creation is the first content save — restorable from history
		const [revision] = await db.select().from(submissionRevisions);
		expect(revision?.title).toBe("Manual session");
		expect(revision?.editedById).toBe("u_admin");
	});

	it("creating AS accepted runs the accept spine: provisioning + content gating, still no email", async () => {
		const db = await seedWorld();
		await db.insert(tasks).values({
			id: "task_hotel",
			eventId: "e1",
			name: "Hotel Stay",
			type: "contact",
			isOnboardingDefault: true,
		});
		const result = (await post(
			new URLSearchParams([
				["drawer", "1"],
				["title", "Pre-accepted keynote"],
				["type", "session"],
				["status", "accepted"],
				["participantContactIds", "c1"],
			]),
		)) as { data: { created?: boolean } };

		expect(result.data.created).toBe(true);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("accepted");
		expect(row?.contentStatus).toBe("in_review");
		expect(row?.statusChangedAt).toBeInstanceOf(Date);
		const assignments = await db.select().from(taskAssignments);
		expect(assignments).toHaveLength(1);
		expect(assignments[0]?.contactId).toBe("c1");
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("refuses contacts from another event without creating anything", async () => {
		const db = await seedWorld();
		const result = (await post(
			new URLSearchParams([
				["drawer", "1"],
				["title", "Sneaky"],
				["type", "session"],
				["status", "pending"],
				["participantContactIds", "c_foreign"],
			]),
		)) as { data: { formError?: string } };

		expect(result.data.formError).toMatch(/do not belong/i);
		expect(await db.select().from(submissions)).toHaveLength(0);
		expect(await db.select().from(participants)).toHaveLength(0);
	});

	it("keeps the classic non-drawer flow: redirect to the submissions list", async () => {
		const db = await seedWorld();
		const response = (await post(
			new URLSearchParams({
				title: "Classic create",
				type: "session",
				status: "pending",
			}),
		)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin/submissions");
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.title, "Classic create"));
		expect(row?.eventId).toBe("e1");
	});
});
