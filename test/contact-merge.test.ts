import { env } from "cloudflare:test";
import { and, count, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	airtableLinks,
	contactFieldValues,
	contactIdentityAliases,
	contactMerges,
	contacts,
	crmNotes,
	events,
	fields,
	files,
	organizationMembers,
	organizations,
	participants,
	passwordResets,
	pipelineCards,
	pipelineStageChanges,
	portals,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "../app/db/schema";
import {
	buildContactMergePreview,
	executeContactMerge,
} from "../app/domain/contact-merge";
import {
	getPortalContext,
	listPortalSubmissions,
	listPortalTasks,
} from "../app/domain/portal";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader as portalLoader } from "../app/routes/portal";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedMergeBaseline() {
	const db = getDb(env);
	await db.insert(users).values([
		{
			id: "admin-a",
			email: "admin-a@example.com",
			passwordHash: await hashPassword("pw"),
			name: "Admin A",
			role: "admin",
		},
		{
			id: "admin-b",
			email: "admin-b@example.com",
			passwordHash: await hashPassword("pw"),
			name: "Admin B",
			role: "admin",
		},
	]);
	await db.insert(organizations).values([
		{ id: "org-a", name: "Org A" },
		{ id: "org-b", name: "Org B" },
	]);
	await db.insert(organizationMembers).values([
		{ id: "member-a", organizationId: "org-a", userId: "admin-a" },
		{ id: "member-b", organizationId: "org-b", userId: "admin-b" },
	]);
	await db.insert(events).values([
		{
			id: "event-a1",
			organizationId: "org-a",
			name: "Event A1",
			slug: "event-a1",
		},
		{
			id: "event-a2",
			organizationId: "org-a",
			name: "Event A2",
			slug: "event-a2",
		},
		{
			id: "event-b1",
			organizationId: "org-b",
			name: "Event B1",
			slug: "event-b1",
		},
	]);
	await db.insert(contacts).values([
		{
			id: "survivor-a1",
			eventId: "event-a1",
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			companyName: "Analytical Engines",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			id: "source-a1",
			eventId: "event-a1",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			jobTitle: "Researcher",
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
		{
			id: "source-a2",
			eventId: "event-a2",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			createdAt: new Date("2026-03-01T00:00:00Z"),
		},
		{
			id: "foreign-b1",
			eventId: "event-b1",
			email: "foreign@example.com",
			firstName: "Foreign",
			lastName: "Person",
		},
	]);
}

async function authenticatedRequest(
	userId: string,
	url: string,
): Promise<Request> {
	const cookie = await createSession(env, userId);
	return new Request(url, {
		headers: { Cookie: cookie.split(";")[0] ?? "" },
	});
}

async function seedReferenceMatrix() {
	await seedMergeBaseline();
	const db = getDb(env);
	await db.insert(users).values([
		{
			id: "survivor-user",
			email: "ada@example.com",
			passwordHash: await hashPassword("survivor-password"),
			name: "Ada Lovelace",
			role: "speaker",
		},
		{
			id: "source-user",
			email: "ada.alt@example.com",
			passwordHash: await hashPassword("source-password"),
			name: "Ada Lovelace",
			role: "speaker",
		},
	]);
	await db
		.update(contacts)
		.set({ userId: "survivor-user" })
		.where(eq(contacts.id, "survivor-a1"));
	await db
		.update(contacts)
		.set({ userId: "source-user" })
		.where(inArray(contacts.id, ["source-a1", "source-a2"]));

	await db.insert(submissions).values([
		{
			id: "submission-source",
			eventId: "event-a1",
			title: "Source-owned session",
			submitterId: "source-user",
		},
		{
			id: "submission-conflict",
			eventId: "event-a1",
			title: "Shared session",
			submitterId: "survivor-user",
		},
		{
			id: "submission-a2",
			eventId: "event-a2",
			title: "Second-event session",
			submitterId: "source-user",
		},
		{
			id: "submission-foreign",
			eventId: "event-b1",
			title: "Foreign session",
			submitterId: "admin-b",
		},
	]);
	await db.insert(participants).values([
		{
			id: "participant-source-only",
			submissionId: "submission-source",
			contactId: "source-a1",
			role: "speaker",
		},
		{
			id: "participant-source-conflict",
			submissionId: "submission-conflict",
			contactId: "source-a1",
			role: "speaker",
			isPrimary: true,
			position: 0,
			acceptanceStatus: "accepted",
		},
		{
			id: "participant-target-conflict",
			submissionId: "submission-conflict",
			contactId: "survivor-a1",
			role: "speaker",
			position: 2,
			acceptanceStatus: "pending",
		},
		{
			id: "participant-source-a2",
			submissionId: "submission-a2",
			contactId: "source-a2",
			role: "speaker",
		},
		{
			id: "participant-foreign",
			submissionId: "submission-foreign",
			contactId: "foreign-b1",
			role: "speaker",
		},
	]);

	await db.insert(tasks).values([
		{ id: "task-source-only", eventId: "event-a1", name: "Source task" },
		{ id: "task-conflict", eventId: "event-a1", name: "Shared task" },
		{ id: "task-a2", eventId: "event-a2", name: "Second event task" },
	]);
	await db.insert(taskAssignments).values([
		{
			id: "assignment-source-only",
			taskId: "task-source-only",
			contactId: "source-a1",
			status: "incomplete",
		},
		{
			id: "assignment-source-conflict",
			taskId: "task-conflict",
			contactId: "source-a1",
			submissionId: "submission-conflict",
			status: "complete",
			response: { sourceOnly: "source", shared: "source" },
			fileKey: "source-file-key",
			dueAt: new Date("2026-08-01T00:00:00Z"),
			completedAt: new Date("2026-07-20T00:00:00Z"),
		},
		{
			id: "assignment-target-conflict",
			taskId: "task-conflict",
			contactId: "survivor-a1",
			submissionId: "submission-conflict",
			status: "incomplete",
			response: { targetOnly: "target", shared: "target" },
			dueAt: new Date("2026-08-05T00:00:00Z"),
			reminderSentAt: new Date("2026-07-15T00:00:00Z"),
		},
		{
			id: "assignment-source-a2",
			taskId: "task-a2",
			contactId: "source-a2",
			status: "pending_feedback",
		},
	]);

	await db.insert(files).values([
		{
			id: "file-source-a1",
			eventId: "event-a1",
			contactId: "source-a1",
			taskAssignmentId: "assignment-source-only",
			r2Key: "source-a1-key",
			fileName: "source-a1.pdf",
		},
		{
			id: "file-source-a2",
			eventId: "event-a2",
			contactId: "source-a2",
			r2Key: "source-a2-key",
			fileName: "source-a2.pdf",
		},
		{
			id: "file-foreign",
			eventId: "event-b1",
			contactId: "foreign-b1",
			r2Key: "foreign-key",
			fileName: "foreign.pdf",
		},
	]);

	await db.insert(fields).values([
		{
			id: "field-source-only",
			eventId: "event-a1",
			name: "Source only",
		},
		{
			id: "field-conflict",
			eventId: "event-a1",
			name: "Shared field",
		},
	]);
	await db.insert(contactFieldValues).values([
		{
			id: "value-source-only",
			contactId: "source-a1",
			fieldId: "field-source-only",
			value: "source-only-value",
		},
		{
			id: "value-source-conflict",
			contactId: "source-a1",
			fieldId: "field-conflict",
			value: "source-value",
		},
		{
			id: "value-target-conflict",
			contactId: "survivor-a1",
			fieldId: "field-conflict",
			value: "survivor-value",
		},
	]);

	await db.insert(crmNotes).values([
		{
			id: "note-source-1",
			organizationId: "org-a",
			email: "ada.alt@example.com",
			authorId: "admin-a",
			authorName: "Admin A",
			body: "Source note one",
		},
		{
			id: "note-source-2",
			organizationId: "org-a",
			email: "ada.alt@example.com",
			authorId: "admin-a",
			authorName: "Admin A",
			body: "Source note two",
		},
		{
			id: "note-target",
			organizationId: "org-a",
			email: "ada@example.com",
			authorId: "admin-a",
			authorName: "Admin A",
			body: "Target note",
		},
	]);

	await db.insert(pipelineCards).values([
		{
			id: "pipeline-source",
			organizationId: "org-a",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			stage: "contacted",
		},
		{
			id: "pipeline-target",
			organizationId: "org-a",
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			stage: "identified",
		},
	]);
	await db.insert(pipelineStageChanges).values([
		{
			id: "history-source-1",
			cardId: "pipeline-source",
			fromStage: null,
			toStage: "identified",
			changedById: "admin-a",
			changedByName: "Admin A",
		},
		{
			id: "history-source-2",
			cardId: "pipeline-source",
			fromStage: "identified",
			toStage: "contacted",
			changedById: "admin-a",
			changedByName: "Admin A",
		},
	]);

	await db.insert(passwordResets).values({
		id: "source-invite",
		userId: "source-user",
		token: "source-invite-token",
		expiresAt: new Date("2027-01-01T00:00:00Z"),
	});
	await db.insert(airtableLinks).values([
		{
			id: "airtable-source-a1",
			tableName: "contacts",
			recordId: "source-a1",
			airtableId: "air-source-a1",
		},
		{
			id: "airtable-target-a1",
			tableName: "contacts",
			recordId: "survivor-a1",
			airtableId: "air-target-a1",
		},
		{
			id: "airtable-source-a2",
			tableName: "contacts",
			recordId: "source-a2",
			airtableId: "air-source-a2",
		},
		{
			id: "airtable-foreign",
			tableName: "contacts",
			recordId: "foreign-b1",
			airtableId: "air-foreign",
		},
	]);
}

async function runReferenceMerge() {
	return executeContactMerge(getDb(env), "org-a", {
		sourceEmail: "ada.alt@example.com",
		survivorEmail: "ada@example.com",
		idempotencyKey: "22222222-2222-4222-8222-222222222222",
		actor: { id: "admin-a", name: "Admin A" },
	});
}

describe("contact merge", () => {
	it("enforces one audit per organization merge key", async () => {
		await seedMergeBaseline();
		const insert = env.DB.prepare(
			`INSERT INTO contact_merges
			 (id, organization_id, source_email, survivor_email, actor_id, actor_name,
			  idempotency_key, summary, retired_contacts, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
		);
		await insert
			.bind(
				"merge-1",
				"org-a",
				"ada.alt@example.com",
				"ada@example.com",
				"admin-a",
				"Admin A",
				"11111111-1111-4111-8111-111111111111",
				"{}",
				"[]",
			)
			.run();

		await expect(
			insert
				.bind(
					"merge-2",
					"org-a",
					"other@example.com",
					"ada@example.com",
					"admin-a",
					"Admin A",
					"11111111-1111-4111-8111-111111111111",
					"{}",
					"[]",
				)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it("previews each source event and whether the survivor row must be created", async () => {
		await seedMergeBaseline();
		const result = await buildContactMergePreview(
			getDb(env),
			"org-a",
			"ada.alt@example.com",
			"ada@example.com",
		);

		expect(result).toMatchObject({
			ok: true,
			preview: {
				source: { email: "ada.alt@example.com" },
				survivor: { email: "ada@example.com" },
				events: [
					{
						eventId: "event-a1",
						sourceContactId: "source-a1",
						survivorContactId: "survivor-a1",
						createsSurvivor: false,
					},
					{
						eventId: "event-a2",
						sourceContactId: "source-a2",
						survivorContactId: null,
						createsSurvivor: true,
					},
				],
				summary: {
					eventContactsCreated: 1,
					contactsRetired: 2,
					profileFieldsFilled: 1,
				},
			},
		});
	});

	it("treats a foreign source or survivor as missing without writing", async () => {
		await seedMergeBaseline();
		const db = getDb(env);

		expect(
			await buildContactMergePreview(
				db,
				"org-a",
				"foreign@example.com",
				"ada@example.com",
			),
		).toEqual({
			ok: false,
			code: "missing",
			reason: "Both contacts must exist in your organization.",
		});
		expect(
			await buildContactMergePreview(
				db,
				"org-a",
				"ada.alt@example.com",
				"foreign@example.com",
			),
		).toEqual({
			ok: false,
			code: "missing",
			reason: "Both contacts must exist in your organization.",
		});
		expect(await db.select({ n: count() }).from(contactMerges)).toEqual([
			{ n: 0 },
		]);
	});

	it("denies execution when either merge direction crosses the organization boundary", async () => {
		await seedMergeBaseline();
		const db = getDb(env);
		const base = {
			idempotencyKey: "33333333-3333-4333-8333-333333333333",
			actor: { id: "admin-a", name: "Admin A" },
		};
		expect(
			await executeContactMerge(db, "org-a", {
				...base,
				sourceEmail: "foreign@example.com",
				survivorEmail: "ada@example.com",
			}),
		).toMatchObject({ ok: false, code: "missing" });
		expect(
			await executeContactMerge(db, "org-a", {
				...base,
				idempotencyKey: "44444444-4444-4444-8444-444444444444",
				sourceEmail: "ada.alt@example.com",
				survivorEmail: "foreign@example.com",
			}),
		).toMatchObject({ ok: false, code: "missing" });
		expect(await db.select({ n: count() }).from(contactMerges)).toEqual([
			{ n: 0 },
		]);
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.eventId, "event-b1")),
		).toEqual([{ id: "foreign-b1" }]);
	});

	it("rolls back every re-point when any statement in the D1 batch fails", async () => {
		await seedReferenceMatrix();
		const result = await executeContactMerge(getDb(env), "org-a", {
			sourceEmail: "ada.alt@example.com",
			survivorEmail: "ada@example.com",
			idempotencyKey: "55555555-5555-4555-8555-555555555555",
			actor: { id: "missing-actor", name: "Missing Actor" },
		});
		expect(result).toMatchObject({ ok: false, code: "failed" });
		const db = getDb(env);
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(inArray(contacts.id, ["source-a1", "source-a2"])),
		).toHaveLength(2);
		expect(
			await db
				.select({ contactId: participants.contactId })
				.from(participants)
				.where(eq(participants.id, "participant-source-only")),
		).toEqual([{ contactId: "source-a1" }]);
		expect(await db.select().from(contactMerges)).toHaveLength(0);
		expect(await db.select().from(contactIdentityAliases)).toHaveLength(0);
	});

	it("retires source event rows only after creating the complete survivor set and audit", async () => {
		await seedReferenceMatrix();
		const result = await runReferenceMerge();
		expect(result).toMatchObject({
			ok: true,
			replayed: false,
			survivorEmail: "ada@example.com",
			summary: {
				eventContactsCreated: 1,
				contactsRetired: 2,
				profileFieldsFilled: 1,
				participantLinksMoved: 2,
				participantLinksConsolidated: 1,
				taskAssignmentsMoved: 2,
				taskAssignmentsConsolidated: 1,
				filesMoved: 2,
				customValuesMoved: 1,
				customValuesConsolidated: 1,
				notesMoved: 2,
				pipelineCardsConsolidated: 1,
				pipelineHistoryMoved: 2,
				portalIdentitiesAliased: 1,
				submissionsReassigned: 2,
				airtableLinksMoved: 1,
				airtableLinksConsolidated: 1,
			},
		});
		const db = getDb(env);
		const orgContacts = await db
			.select()
			.from(contacts)
			.where(inArray(contacts.eventId, ["event-a1", "event-a2"]));
		expect(orgContacts.map((row) => row.email).sort()).toEqual([
			"ada@example.com",
			"ada@example.com",
		]);
		expect(orgContacts.find((row) => row.id === "survivor-a1")).toMatchObject({
			jobTitle: "Researcher",
			companyName: "Analytical Engines",
			userId: "survivor-user",
		});
		expect(orgContacts.find((row) => row.eventId === "event-a2")).toMatchObject(
			{
				firstName: "Ada",
				lastName: "Lovelace",
				userId: "survivor-user",
			},
		);
		const [audit] = await db.select().from(contactMerges);
		expect(audit?.retiredContacts.map((row) => row.id).sort()).toEqual([
			"source-a1",
			"source-a2",
		]);
		expect(audit?.summary).toEqual(
			expect.objectContaining({ contactsRetired: 2, filesMoved: 2 }),
		);
	});

	it("moves participant links and consolidates duplicate roles without losing acceptance", async () => {
		await seedReferenceMatrix();
		expect((await runReferenceMerge()).ok).toBe(true);
		const db = getDb(env);
		const rows = await db.select().from(participants);
		expect(rows.find((row) => row.id === "participant-source-conflict")).toBe(
			undefined,
		);
		expect(
			rows.find((row) => row.id === "participant-target-conflict"),
		).toMatchObject({
			contactId: "survivor-a1",
			isPrimary: true,
			position: 0,
			acceptanceStatus: "accepted",
		});
		expect(
			rows.find((row) => row.id === "participant-source-only")?.contactId,
		).toBe("survivor-a1");
		const survivorA2 = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(
				and(
					eq(contacts.eventId, "event-a2"),
					eq(contacts.email, "ada@example.com"),
				),
			)
			.then((resultRows) => resultRows[0]);
		expect(
			rows.find((row) => row.id === "participant-source-a2")?.contactId,
		).toBe(survivorA2?.id);
		expect(
			rows.find((row) => row.id === "participant-foreign")?.contactId,
		).toBe("foreign-b1");
	});

	it("moves task assignments and retains the strongest conflicting completion data", async () => {
		await seedReferenceMatrix();
		expect((await runReferenceMerge()).ok).toBe(true);
		const rows = await getDb(env).select().from(taskAssignments);
		expect(rows.find((row) => row.id === "assignment-source-conflict")).toBe(
			undefined,
		);
		expect(
			rows.find((row) => row.id === "assignment-target-conflict"),
		).toMatchObject({
			contactId: "survivor-a1",
			status: "complete",
			response: {
				sourceOnly: "source",
				targetOnly: "target",
				shared: "target",
			},
			fileKey: "source-file-key",
		});
		expect(
			rows.find((row) => row.id === "assignment-target-conflict")?.dueAt,
		).toEqual(new Date("2026-08-01T00:00:00Z"));
		expect(
			rows.find((row) => row.id === "assignment-source-only")?.contactId,
		).toBe("survivor-a1");
	});

	it("moves contact files and source-only custom values while preserving survivor conflicts", async () => {
		await seedReferenceMatrix();
		expect((await runReferenceMerge()).ok).toBe(true);
		const db = getDb(env);
		const survivorA2 = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(
				and(
					eq(contacts.eventId, "event-a2"),
					eq(contacts.email, "ada@example.com"),
				),
			)
			.then((rows) => rows[0]);
		const fileRows = await db.select().from(files);
		expect(fileRows.find((row) => row.id === "file-source-a1")?.contactId).toBe(
			"survivor-a1",
		);
		expect(fileRows.find((row) => row.id === "file-source-a2")?.contactId).toBe(
			survivorA2?.id,
		);
		expect(fileRows.find((row) => row.id === "file-foreign")?.contactId).toBe(
			"foreign-b1",
		);
		const values = await db.select().from(contactFieldValues);
		expect(values.find((row) => row.id === "value-source-only")).toMatchObject({
			contactId: "survivor-a1",
			value: "source-only-value",
		});
		expect(values.find((row) => row.id === "value-source-conflict")).toBe(
			undefined,
		);
		expect(
			values.find((row) => row.id === "value-target-conflict")?.value,
		).toBe("survivor-value");
	});

	it("unions CRM notes and pipeline history on the chosen survivor", async () => {
		await seedReferenceMatrix();
		expect((await runReferenceMerge()).ok).toBe(true);
		const db = getDb(env);
		const notes = await db
			.select({ email: crmNotes.email, body: crmNotes.body })
			.from(crmNotes)
			.where(eq(crmNotes.organizationId, "org-a"));
		expect(notes).toHaveLength(3);
		expect(new Set(notes.map((row) => row.email))).toEqual(
			new Set(["ada@example.com"]),
		);
		const cards = await db
			.select()
			.from(pipelineCards)
			.where(eq(pipelineCards.organizationId, "org-a"));
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: "pipeline-target",
			email: "ada@example.com",
			stage: "identified",
		});
		const history = await db.select().from(pipelineStageChanges);
		expect(history.map((row) => row.cardId)).toEqual([
			"pipeline-target",
			"pipeline-target",
		]);
	});

	it("aliases the retired portal identity, moves submitter ownership, and cleans soft contact links", async () => {
		await seedReferenceMatrix();
		expect((await runReferenceMerge()).ok).toBe(true);
		const db = getDb(env);
		expect(await db.select().from(contactIdentityAliases)).toEqual([
			expect.objectContaining({
				organizationId: "org-a",
				sourceUserId: "source-user",
				survivorUserId: "survivor-user",
				survivorEmail: "ada@example.com",
			}),
		]);
		const orgSubmissions = await db
			.select({ id: submissions.id, submitterId: submissions.submitterId })
			.from(submissions)
			.where(inArray(submissions.eventId, ["event-a1", "event-a2"]));
		expect(orgSubmissions).toEqual(
			expect.arrayContaining([
				{ id: "submission-source", submitterId: "survivor-user" },
				{ id: "submission-a2", submitterId: "survivor-user" },
			]),
		);
		expect(await db.select().from(passwordResets)).toEqual([
			expect.objectContaining({ id: "source-invite", userId: "source-user" }),
		]);
		const links = await db.select().from(airtableLinks);
		expect(links.find((row) => row.id === "airtable-source-a1")).toBe(
			undefined,
		);
		expect(
			links.find((row) => row.id === "airtable-source-a2")?.recordId,
		).not.toBe("source-a2");
		expect(links.find((row) => row.id === "airtable-foreign")?.recordId).toBe(
			"foreign-b1",
		);
	});

	it("sends a retired portal login to the survivor with unioned submissions and tasks", async () => {
		await seedReferenceMatrix();
		const db = getDb(env);
		await db.insert(portals).values([
			{
				id: "portal-a1",
				eventId: "event-a1",
				publicId: "portal-public-a1",
				name: "Event A1 Portal",
			},
			{
				id: "portal-a2",
				eventId: "event-a2",
				publicId: "portal-public-a2",
				name: "Event A2 Portal",
			},
		]);
		expect((await runReferenceMerge()).ok).toBe(true);
		const [sourceUser] = await db
			.select()
			.from(users)
			.where(eq(users.id, "source-user"));
		if (!sourceUser) throw new Error("Missing retired portal fixture user.");
		const ctx = await getPortalContext(
			env,
			sourceUser,
			{ eventSlug: "event-a1", portalId: "portal-public-a1" },
			new Request("http://localhost/portals/event-a1/portal-public-a1/home"),
		);
		expect(ctx.contact).toMatchObject({
			email: "ada@example.com",
			id: "survivor-a1",
		});
		expect(ctx.subjectUserId).toBe("survivor-user");
		expect(
			(await listPortalSubmissions(env, ctx)).rows.map((row) => row.id).sort(),
		).toEqual(["submission-conflict", "submission-source"]);
		expect(
			(await listPortalTasks(env, ctx)).map((row) => row.id).sort(),
		).toEqual(["assignment-source-only", "assignment-target-conflict"]);

		let thrown: unknown;
		try {
			await portalLoader({
				context: CONTEXT,
				request: await authenticatedRequest(
					"source-user",
					"http://localhost/portal",
				),
				params: {},
			} as unknown as Parameters<typeof portalLoader>[0]);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toBe(
			"/portals/event-a2/portal-public-a2/home",
		);
	});

	it("returns the recorded result when the same merge POST is replayed", async () => {
		await seedReferenceMatrix();
		const first = await runReferenceMerge();
		const replay = await runReferenceMerge();
		expect(first).toMatchObject({ ok: true, replayed: false });
		expect(replay).toMatchObject({
			ok: true,
			replayed: true,
			mergeId: first.ok ? first.mergeId : "unreachable",
		});
		expect(await getDb(env).select({ n: count() }).from(contactMerges)).toEqual(
			[{ n: 1 }],
		);
	});
});
