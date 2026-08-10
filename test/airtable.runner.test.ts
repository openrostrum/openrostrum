import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	airtableLinks,
	contacts,
	events,
	organizations,
	participants,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { createFakeAirtableBase, MERGE_FIELD } from "../app/ports/airtable";
import { readSyncState, runAirtableSync } from "../app/sync/runner";

// Functional oracle for both sync directions against the port fake
// (docs/airtable-sync-design.md): Tier-1 push with snapshot change detection
// and the Demo-org tenant guard, Tier-2 pull with three-way reconciliation
// (Airtable wins team-editable conflicts), honor-the-delete semantics, and
// the >20% mass-delete circuit breaker.

const db = () => getDb(env);
const run = (fake: ReturnType<typeof createFakeAirtableBase>, ack = false) =>
	runAirtableSync(
		env,
		{ trigger: "manual", acknowledgeDeletions: ack },
		{ base: fake },
	);

async function seedOrgs() {
	await db()
		.insert(organizations)
		.values([
			{ id: "org_demo", name: "Demo" },
			{ id: "org_other", name: "Other Org" },
		]);
	await db()
		.insert(events)
		.values([
			{ id: "e1", organizationId: "org_demo", name: "Demo Conf", slug: "demo" },
			{
				id: "e2",
				organizationId: "org_other",
				name: "Other Conf",
				slug: "other",
			},
		]);
}

async function seedSubmission(id: string, eventId = "e1", title?: string) {
	await db()
		.insert(submissions)
		.values({ id, eventId, title: title ?? `Talk ${id}`, status: "pending" });
}

async function seedContact(id: string, eventId = "e1") {
	await db()
		.insert(contacts)
		.values({
			id,
			eventId,
			email: `${id}@example.com`,
			firstName: "Ada",
			lastName: "Lovelace",
			bio: "Original bio",
		});
}

async function seedAssignment(id = "ta1") {
	await db()
		.insert(tasks)
		.values({ id: "t1", eventId: "e1", name: "Hotel Stay Requirement Form" });
	await db()
		.insert(taskAssignments)
		.values({ id, taskId: "t1", contactId: "c1", status: "incomplete" });
}

function recordFor(
	fake: ReturnType<typeof createFakeAirtableBase>,
	table: string,
	recordId: string,
) {
	return fake.all(table).find((r) => r.fields[MERGE_FIELD] === recordId);
}

describe("airtable sync runner — Tier 1 push", () => {
	it("pushes only Demo-org rows across all three tables and links them", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		await seedSubmission("s_other", "e2");
		await seedContact("c1");
		await seedContact("c_other", "e2");
		await seedAssignment();
		const fake = createFakeAirtableBase();

		const result = await run(fake);

		expect(result.status).toBe("ok");
		expect(fake.all("Sessions").map((r) => r.fields[MERGE_FIELD])).toEqual([
			"s1",
		]);
		expect(fake.all("Contacts").map((r) => r.fields[MERGE_FIELD])).toEqual([
			"c1",
		]);
		expect(
			fake.all("Task Assignments").map((r) => r.fields[MERGE_FIELD]),
		).toEqual(["ta1"]);
		expect(recordFor(fake, "Sessions", "s1")?.fields.Title).toBe("Talk s1");
		expect(recordFor(fake, "Sessions", "s1")?.fields.Status).toBe("Pending");
		expect(recordFor(fake, "Task Assignments", "ta1")?.fields).toMatchObject({
			Task: "Hotel Stay Requirement Form",
			Contact: "Ada Lovelace <c1@example.com>",
			Status: "Incomplete",
		});

		const links = await db().select().from(airtableLinks);
		const sessionLink = links.find(
			(l) => l.tableName === "submissions" && l.recordId === "s1",
		);
		expect(sessionLink?.airtableId).toBe(
			recordFor(fake, "Sessions", "s1")?.airtableId,
		);
		expect(sessionLink?.baseSnapshot).toMatchObject({ Title: "Talk s1" });
		expect(links.some((l) => l.recordId === "s_other")).toBe(false);
		expect(links.some((l) => l.recordId === "c_other")).toBe(false);
	});

	it("pushes only rows that changed since the last snapshot, into the same record", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		await seedSubmission("s2");
		await seedContact("c1");
		const fake = createFakeAirtableBase();
		await run(fake);
		fake.calls.length = 0;

		await db()
			.update(submissions)
			.set({ title: "Renamed talk" })
			.where(eq(submissions.id, "s1"));

		const result = await run(fake);
		expect(result.status).toBe("ok");

		const upserts = fake.calls.filter((c) => c.op === "upsert");
		expect(upserts).toHaveLength(1);
		expect(upserts[0]?.table).toBe("Sessions");
		const payload = upserts[0]?.payload as Array<Record<string, unknown>>;
		expect(payload).toHaveLength(1);
		expect(payload[0]).toEqual({ [MERGE_FIELD]: "s1", Title: "Renamed talk" });
		// Merge key kept it the SAME record — no duplicate row was minted.
		expect(fake.all("Sessions")).toHaveLength(2);
		expect(recordFor(fake, "Sessions", "s1")?.fields.Title).toBe(
			"Renamed talk",
		);
	});

	it("propagates an app-side hard delete to the base and drops the link", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const fake = createFakeAirtableBase();
		await run(fake);
		expect(fake.all("Sessions")).toHaveLength(1);

		await db().delete(submissions).where(eq(submissions.id, "s1"));
		const result = await run(fake);

		expect(result.status).toBe("ok");
		expect(fake.all("Sessions")).toHaveLength(0);
		expect(await db().select().from(airtableLinks)).toEqual([
			expect.objectContaining({ tableName: "$sync" }),
		]);
	});
});

describe("airtable sync runner — Tier 2 pull", () => {
	it("applies a team edit of a descriptive field to D1 and settles (no ping-pong)", async () => {
		await seedOrgs();
		await seedContact("c1");
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Contacts", "c1");
		fake.edit("Contacts", record?.airtableId ?? "", {
			Bio: "Rewritten in Airtable",
		});
		await run(fake);

		const [contact] = await db()
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(contact?.bio).toBe("Rewritten in Airtable");

		fake.calls.length = 0;
		await run(fake);
		expect(fake.calls.filter((c) => c.op === "upsert")).toHaveLength(0);
	});

	it("lets Airtable win when both sides edited the same team-editable field", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const fake = createFakeAirtableBase();
		await run(fake);

		await db()
			.update(submissions)
			.set({ title: "Local rename" })
			.where(eq(submissions.id, "s1"));
		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", {
			Title: "Airtable rename",
		});
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.title).toBe("Airtable rename");
		expect(recordFor(fake, "Sessions", "s1")?.fields.Title).toBe(
			"Airtable rename",
		);
		// The lost local edit leaves a persistent in-app audit trail.
		const state = await readSyncState(db());
		expect(state.recentConflicts).toContainEqual(
			expect.objectContaining({
				table: "submissions",
				recordId: "s1",
				field: "Title",
			}),
		);
	});

	it("corrects a team edit of an app-owned field back to the app's value", async () => {
		await seedOrgs();
		await seedContact("c1");
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Contacts", "c1");
		fake.edit("Contacts", record?.airtableId ?? "", {
			Email: "hijacked@evil.example",
		});
		await run(fake);

		expect(recordFor(fake, "Contacts", "c1")?.fields.Email).toBe(
			"c1@example.com",
		);
		const [contact] = await db()
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(contact?.email).toBe("c1@example.com");
	});

	it("rejects an unknown status label and writes the app's status back", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", { Status: "Banana" });
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("pending");
		expect(recordFor(fake, "Sessions", "s1")?.fields.Status).toBe("Pending");
	});

	it("applies an inbound Withdrawn status through the withdraw semantics (unscheduled, reason recorded)", async () => {
		await seedOrgs();
		await db()
			.insert(submissions)
			.values({
				id: "s1",
				eventId: "e1",
				title: "Scheduled talk",
				status: "accepted",
				startsAt: new Date("2026-10-13T17:00:00Z"),
				endsAt: new Date("2026-10-13T18:00:00Z"),
			});
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", { Status: "Withdrawn" });
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("withdrawn");
		expect(row?.withdrawnReason).toBe("Withdrawn in Airtable");
		expect(row?.withdrawnAt).not.toBeNull();
		expect(row?.startsAt).toBeNull();
		expect(row?.endsAt).toBeNull();
	});

	it("routes an inbound Accepted edit through the accept spine — status flips AND onboarding tasks provision", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		await seedContact("c1");
		await db().insert(participants).values({
			id: "p1",
			submissionId: "s1",
			contactId: "c1",
			role: "speaker",
		});
		await db().insert(tasks).values({
			id: "t1",
			eventId: "e1",
			name: "Hotel Stay Requirement Form",
			isOnboardingDefault: true,
		});
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", { Status: "Accepted" });
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("accepted");
		// The acceptance side effects fired — this was a domain transition, not
		// a raw column write.
		const assignments = await db().select().from(taskAssignments);
		expect(assignments).toHaveLength(1);
		expect(assignments[0]).toMatchObject({ taskId: "t1", contactId: "c1" });
		expect(recordFor(fake, "Sessions", "s1")?.fields.Status).toBe("Accepted");

		// The provisioned assignment reaches the base on the following tick.
		await run(fake);
		expect(
			fake.all("Task Assignments").map((r) => r.fields[MERGE_FIELD]),
		).toEqual([assignments[0]?.id]);
	});

	it("rejects a decision edit on a draft (the spine refuses) and writes the app's status back", async () => {
		await seedOrgs();
		await db().insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Draft talk",
			status: "draft",
		});
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", { Status: "Accepted" });
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("draft");
		expect(recordFor(fake, "Sessions", "s1")?.fields.Status).toBe("Draft");
	});

	it("marks a task assignment complete from a team edit, stamping completedAt", async () => {
		await seedOrgs();
		await seedContact("c1");
		await seedAssignment();
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Task Assignments", "ta1");
		fake.edit("Task Assignments", record?.airtableId ?? "", {
			Status: "Complete",
		});
		await run(fake);

		const [row] = await db()
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta1"));
		expect(row?.status).toBe("complete");
		expect(row?.completedAt).not.toBeNull();
	});

	it("never reads or writes the team's own columns, and keeps them out of snapshots", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.edit("Sessions", record?.airtableId ?? "", {
			"Team Notes": "ping them about AV",
		});
		await db()
			.update(submissions)
			.set({ title: "Renamed" })
			.where(eq(submissions.id, "s1"));
		await run(fake);

		const after = recordFor(fake, "Sessions", "s1");
		expect(after?.fields.Title).toBe("Renamed");
		expect(after?.fields["Team Notes"]).toBe("ping them about AV");
		const [link] = await db()
			.select()
			.from(airtableLinks)
			.where(eq(airtableLinks.recordId, "s1"));
		expect(link?.baseSnapshot).not.toHaveProperty("Team Notes");
	});
});

describe("airtable sync runner — deletes and the circuit breaker", () => {
	it("archives a submission the team deleted (withdrawn, unscheduled) and never recreates the row", async () => {
		await seedOrgs();
		for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
			await seedSubmission(id);
		}
		const fake = createFakeAirtableBase();
		await run(fake);

		const record = recordFor(fake, "Sessions", "s1");
		fake.remove("Sessions", record?.airtableId ?? "");
		const result = await run(fake);

		expect(result.status).toBe("ok");
		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("withdrawn");
		expect(row?.withdrawnReason).toBe("Deleted from the Airtable base");
		expect(fake.all("Sessions")).toHaveLength(5);

		// The delete stays honored on later ticks — no zombie row returns.
		await run(fake);
		expect(fake.all("Sessions")).toHaveLength(5);
	});

	it("un-archives a row restored from Airtable's trash and resumes syncing it", async () => {
		await seedOrgs();
		for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
			await seedSubmission(id);
		}
		const fake = createFakeAirtableBase();
		await run(fake);
		const record = recordFor(fake, "Sessions", "s1");
		const airtableId = record?.airtableId ?? "";
		const storedFields = { ...record?.fields };
		fake.remove("Sessions", airtableId);
		await run(fake);

		// Restore-from-trash: same record id, same fields (Status "Pending"),
		// then a team edit.
		fake.seed("Sessions", storedFields as never, airtableId);
		fake.edit("Sessions", airtableId, { Title: "Restored and renamed" });
		await run(fake);

		const [row] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		// Symmetric with archive-on-delete: the restore un-archives.
		expect(row?.status).toBe("pending");
		expect(row?.withdrawnAt).toBeNull();
		expect(row?.withdrawnReason).toBeNull();
		expect(row?.title).toBe("Restored and renamed");
	});

	it("trips the breaker instead of mass-archiving when >20% of linked rows vanish, and resumes on acknowledgement", async () => {
		await seedOrgs();
		for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
			await seedSubmission(id);
		}
		const fake = createFakeAirtableBase();
		await run(fake);
		for (const recordId of ["s1", "s2"]) {
			fake.remove(
				"Sessions",
				recordFor(fake, "Sessions", recordId)?.airtableId ?? "",
			);
		}

		const tripped = await run(fake);
		expect(tripped).toMatchObject({
			status: "breaker_tripped",
			absent: 2,
			linked: 5,
		});
		const statuses = await db()
			.select({ status: submissions.status })
			.from(submissions);
		expect(statuses.every((s) => s.status === "pending")).toBe(true);
		expect((await readSyncState(db())).pausedAt).toBeTruthy();

		// Paused: nothing runs until an admin acknowledges.
		expect((await run(fake)).status).toBe("paused");

		const resumed = await run(fake, true);
		expect(resumed.status).toBe("ok");
		const after = await db().select().from(submissions);
		expect(after.filter((s) => s.status === "withdrawn")).toHaveLength(2);
		expect((await readSyncState(db())).pausedAt).toBeUndefined();
	});

	it("ignores a resume acknowledgement when sync is not paused — the breaker still trips", async () => {
		await seedOrgs();
		for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
			await seedSubmission(id);
		}
		const fake = createFakeAirtableBase();
		await run(fake);
		for (const recordId of ["s1", "s2"]) {
			fake.remove(
				"Sessions",
				recordFor(fake, "Sessions", recordId)?.airtableId ?? "",
			);
		}

		// A stale/replayed resume POST arrives while nothing is paused: it must
		// not disable the mass-delete protection.
		const result = await run(fake, true);
		expect(result.status).toBe("breaker_tripped");
		const statuses = await db()
			.select({ status: submissions.status })
			.from(submissions);
		expect(statuses.every((s) => s.status === "pending")).toBe(true);
	});

	it("refuses a link bound to another organization's row — nothing is read, written, or deleted through it", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		await seedSubmission("s_other", "e2", "Foreign talk");
		const fake = createFakeAirtableBase();
		const foreignId = fake.seed("Sessions", {
			[MERGE_FIELD]: "s_other",
			Title: "Foreign talk",
			Status: "Accepted",
		});
		await db().insert(airtableLinks).values({
			tableName: "submissions",
			recordId: "s_other",
			airtableId: foreignId,
			baseSnapshot: null,
		});

		const result = await run(fake);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.tables.submissions.refusedLinks).toBe(1);
		}

		// The foreign row was not pulled into, corrected, or deleted.
		const [foreign] = await db()
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s_other"));
		expect(foreign?.status).toBe("pending");
		expect(foreign?.title).toBe("Foreign talk");
		expect(fake.get("Sessions", foreignId)).toMatchObject({
			Status: "Accepted",
		});
		const [link] = await db()
			.select()
			.from(airtableLinks)
			.where(eq(airtableLinks.recordId, "s_other"));
		expect(link).toBeTruthy();
	});
});

describe("airtable sync runner — configuration and run lock", () => {
	it("reports not-configured (and does nothing) when no base is bound", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const result = await runAirtableSync(env, { trigger: "cron" });
		expect(result.status).toBe("not_configured");
		expect(await db().select().from(airtableLinks)).toHaveLength(0);
	});

	it("skips a tick while another run holds the lock, and steals a crashed run's stale lock", async () => {
		await seedOrgs();
		await seedSubmission("s1");
		const fake = createFakeAirtableBase();

		await db().insert(airtableLinks).values({
			tableName: "$sync",
			recordId: "lock",
			airtableId: "$sync:lock",
			syncedAt: new Date(),
		});
		expect((await run(fake)).status).toBe("already_running");
		expect(fake.all("Sessions")).toHaveLength(0);

		// A crashed run's lock is older than the TTL — it must not wedge sync
		// forever.
		await db()
			.update(airtableLinks)
			.set({ syncedAt: new Date(Date.now() - 10 * 60_000) })
			.where(
				and(
					eq(airtableLinks.tableName, "$sync"),
					eq(airtableLinks.recordId, "lock"),
				),
			);
		expect((await run(fake)).status).toBe("ok");
		expect(fake.all("Sessions")).toHaveLength(1);
	});

	it("refreshes the webhook expiry on cron ticks only, when the webhook id is configured", async () => {
		await seedOrgs();
		const fake = createFakeAirtableBase();
		const envWithId = { ...env, AIRTABLE_WEBHOOK_ID: "ach_test" } as Env;

		await runAirtableSync(envWithId, { trigger: "cron" }, { base: fake });
		expect(fake.calls.filter((c) => c.op === "refresh")).toEqual([
			{ op: "refresh", table: "", payload: "ach_test" },
		]);

		fake.calls.length = 0;
		await runAirtableSync(envWithId, { trigger: "manual" }, { base: fake });
		expect(fake.calls.filter((c) => c.op === "refresh")).toHaveLength(0);
	});
});
