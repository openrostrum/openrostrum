import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	events,
	fields,
	files,
	organizationMembers,
	organizations,
	participants,
	sessionStatuses,
	submissionAnswers,
	submissionRevisions,
	submissions,
	submissionTracks,
	taskAssignments,
	tasks,
	tracks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.submissions.$id";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function unwrap(result: unknown) {
	return result as {
		data: {
			notice?: string;
			formError?: string;
			fieldErrors?: Record<string, string[] | undefined>;
		};
		init: { headers: Record<string, string> };
	};
}

/** Two orgs, two events; the admin is a member of org1 only (active on e1). */
async function seedWorld() {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org1", name: "Org One" },
		{ id: "org2", name: "Org Two" },
	]);
	await db.insert(events).values([
		{
			id: "e1",
			organizationId: "org1",
			name: "Mine",
			slug: "mine",
			timezone: "America/Los_Angeles",
		},
		{ id: "e2", organizationId: "org2", name: "Theirs", slug: "theirs" },
	]);
	await db.insert(users).values([
		{
			id: "u_admin",
			email: "admin@test.co",
			passwordHash: await hashPassword("pw"),
			name: "Demo Admin",
			role: "admin",
			activeEventId: "e1",
		},
		{
			id: "u_speaker",
			email: "speaker@test.co",
			passwordHash: await hashPassword("pw"),
			name: "Sam Speaker",
			role: "speaker",
		},
	]);
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	return db;
}

async function detailRequest(body?: URLSearchParams): Promise<Request> {
	const setCookie = await createSession(env, "u_admin");
	return new Request("http://localhost/admin/submissions/s1", {
		method: body ? "POST" : "GET",
		body,
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
}

function callLoader(request: Request, id = "s1") {
	return loader({
		context: CONTEXT,
		request,
		params: { id },
	} as unknown as Parameters<typeof loader>[0]);
}

function callAction(request: Request, id = "s1") {
	return action({
		context: CONTEXT,
		request,
		params: { id },
	} as unknown as Parameters<typeof action>[0]);
}

const is404 = (thrown: unknown) =>
	typeof thrown === "object" &&
	thrown !== null &&
	"init" in thrown &&
	(thrown as { init: { status?: number } }).init?.status === 404;

describe("submission detail loader", () => {
	it("returns the full record: per-participant acceptance, answers, withdrawal metadata", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Withdrawn talk",
			description: "Full description intact.",
			status: "withdrawn",
			type: "session",
			withdrawnAt: new Date("2026-08-01T12:00:00Z"),
			withdrawnById: "u_speaker",
			withdrawnReason: "Visa denied.",
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
		]);
		await db.insert(participants).values([
			{
				id: "p1",
				submissionId: "s1",
				contactId: "c1",
				role: "speaker",
				isPrimary: true,
				position: 0,
				acceptanceStatus: "accepted",
			},
			{
				id: "p2",
				submissionId: "s1",
				contactId: "c2",
				role: "moderator",
				isPrimary: false,
				position: 1,
				acceptanceStatus: "declined",
			},
		]);
		await db.insert(fields).values({
			id: "f1",
			eventId: "e1",
			name: "Prior speaking experience",
			type: "dropdown",
		});
		await db.insert(submissionAnswers).values({
			id: "a1",
			submissionId: "s1",
			fieldId: "f1",
			value: "Experienced",
		});

		const result = unwrap(await callLoader(await detailRequest()));
		const payload = result.data as unknown as {
			submission: {
				title: string;
				withdrawal: { by: string; reason: string } | null;
			};
			participants: Array<{
				name: string;
				role: string;
				acceptanceStatus: string;
			}>;
			answers: Array<{ label: string; value: string | null }>;
		};
		expect(payload.submission.title).toBe("Withdrawn talk");
		// who/when/why survives on the record — nothing is wiped by withdrawal
		expect(payload.submission.withdrawal?.by).toBe("Sam Speaker");
		expect(payload.submission.withdrawal?.reason).toBe("Visa denied.");
		// primary participant first; each carries their own acceptance state
		expect(payload.participants.map((p) => p.acceptanceStatus)).toEqual([
			"accepted",
			"declined",
		]);
		expect(payload.participants[1]?.role).toBe("moderator");
		expect(payload.answers).toEqual([
			{ id: "a1", label: "Prior speaking experience", value: "Experienced" },
		]);
	});

	it("404s another event's submission and unknown ids alike", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "foreign",
			eventId: "e2",
			title: "Not yours",
			status: "pending",
		});
		await expect(
			callLoader(await detailRequest(), "foreign"),
		).rejects.toSatisfy(is404);
		await expect(
			callLoader(await detailRequest(), "missing"),
		).rejects.toSatisfy(is404);
	});
});

describe("content saves + revision history", () => {
	async function seedSubmission(db: Awaited<ReturnType<typeof seedWorld>>) {
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Original title",
			description: "Original description",
			status: "pending",
			submitterId: "u_speaker",
		});
	}

	it("first save snapshots the pre-edit content AND the new content; no-op saves record nothing", async () => {
		const db = await seedWorld();
		await seedSubmission(db);

		const save = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "save-content",
						title: "Edited title",
						description: "Edited description",
					}),
				),
			),
		);
		expect(save.data.notice).toMatch(/revision/i);
		const [row] = await db.select().from(submissions);
		expect(row?.title).toBe("Edited title");
		const revisions = await db.select().from(submissionRevisions);
		// original (attributed to the submitter) + the edit (to the admin)
		expect(revisions).toHaveLength(2);
		const original = revisions.find((r) => r.title === "Original title");
		const edited = revisions.find((r) => r.title === "Edited title");
		expect(original?.editedById).toBe("u_speaker");
		expect(edited?.editedById).toBe("u_admin");

		const noop = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "save-content",
						title: "Edited title",
						description: "Edited description",
					}),
				),
			),
		);
		expect(noop.data.notice).toMatch(/no changes/i);
		expect(await db.select().from(submissionRevisions)).toHaveLength(2);
	});

	it("restore writes the snapshot back and appends the restore as a new revision", async () => {
		const db = await seedWorld();
		await seedSubmission(db);
		await callAction(
			await detailRequest(
				new URLSearchParams({
					intent: "save-content",
					title: "V2 title",
					description: "V2 description",
				}),
			),
		);
		const revisions = await db.select().from(submissionRevisions);
		const original = revisions.find((r) => r.title === "Original title");
		expect(original).toBeDefined();

		const restore = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "restore-revision",
						revisionId: original?.id ?? "",
					}),
				),
			),
		);
		expect(restore.data.notice).toMatch(/restored/i);
		const [row] = await db.select().from(submissions);
		expect(row?.title).toBe("Original title");
		expect(row?.description).toBe("Original description");
		// history is append-only: original + v2 + the restore = 3 rows
		const after = await db.select().from(submissionRevisions);
		expect(after).toHaveLength(3);
		const restored = after.filter((r) => r.title === "Original title");
		expect(restored.some((r) => r.editedById === "u_admin")).toBe(true);
	});

	it("refuses to restore a revision that belongs to a different submission", async () => {
		const db = await seedWorld();
		await seedSubmission(db);
		await db.insert(submissions).values({
			id: "s2",
			eventId: "e1",
			title: "Other",
			status: "pending",
		});
		await db.insert(submissionRevisions).values({
			id: "rev_other",
			submissionId: "s2",
			title: "Injected",
			description: "",
		});
		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "restore-revision",
						revisionId: "rev_other",
					}),
				),
			),
		);
		expect(result.data.formError).toMatch(/does not belong/i);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.title).toBe("Original title");
	});
});

describe("status + content status + custom status", () => {
	it("set-status routes through the accept spine: provisioning runs, no email leaves", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Spine me",
			status: "pending",
		});
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "sp@x.co",
			firstName: "Sp",
			lastName: "Eaker",
		});
		await db.insert(participants).values({
			id: "p1",
			submissionId: "s1",
			contactId: "c1",
			role: "speaker",
			isPrimary: true,
		});
		await db.insert(tasks).values({
			id: "task_hotel",
			eventId: "e1",
			name: "Hotel Stay",
			type: "contact",
			isOnboardingDefault: true,
		});

		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({ intent: "set-status", status: "accepted" }),
				),
			),
		);
		expect(result.data.notice).toMatch(/accepted/i);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("accepted");
		expect(row?.statusChangedAt).toBeInstanceOf(Date);
		// the spine's side effects, not an inline UPDATE's:
		expect(row?.contentStatus).toBe("in_review");
		expect(await db.select().from(taskAssignments)).toHaveLength(1);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("content status transitions persist and gate copy reflects approval", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Gate me",
			status: "accepted",
			contentStatus: "in_review",
		});
		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-content-status",
						contentStatus: "approved",
					}),
				),
			),
		);
		expect(result.data.notice).toMatch(/public/i);
		const [row] = await db.select().from(submissions);
		expect(row?.contentStatus).toBe("approved");

		const invalid = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-content-status",
						contentStatus: "published",
					}),
				),
			),
		);
		expect(invalid.data.formError).toBeTruthy();
	});

	it("custom status accepts this event's statuses only", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Custom",
			status: "accepted",
		});
		await db.insert(sessionStatuses).values([
			{ id: "cs_mine", eventId: "e1", name: "Offered" },
			{ id: "cs_theirs", eventId: "e2", name: "Foreign" },
		]);

		const foreign = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-custom-status",
						customStatusId: "cs_theirs",
					}),
				),
			),
		);
		expect(foreign.data.formError).toMatch(/does not belong/i);

		const mine = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-custom-status",
						customStatusId: "cs_mine",
					}),
				),
			),
		);
		expect(mine.data.notice).toContain("Offered");
		const [row] = await db.select().from(submissions);
		expect(row?.customStatusId).toBe("cs_mine");
	});
});

describe("guarded delete", () => {
	it("deletes the row, cascades children, keeps contacts and detaches files", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Doomed",
			status: "declined",
			type: "session",
		});
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "keep@x.co",
			firstName: "Keep",
			lastName: "Me",
		});
		await db.insert(participants).values({
			id: "p1",
			submissionId: "s1",
			contactId: "c1",
			role: "speaker",
		});
		await db.insert(tracks).values({ id: "t1", eventId: "e1", name: "AI" });
		await db
			.insert(submissionTracks)
			.values({ submissionId: "s1", trackId: "t1" });
		await db.insert(submissionRevisions).values({
			id: "rev1",
			submissionId: "s1",
			title: "Doomed",
			description: "",
		});
		await db.insert(files).values({
			id: "file1",
			eventId: "e1",
			submissionId: "s1",
			r2Key: "k",
			fileName: "slides.pdf",
		});

		const response = (await callAction(
			await detailRequest(new URLSearchParams({ intent: "delete" })),
		)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin/sessions");

		expect(await db.select().from(submissions)).toHaveLength(0);
		expect(await db.select().from(participants)).toHaveLength(0);
		expect(await db.select().from(submissionTracks)).toHaveLength(0);
		expect(await db.select().from(submissionRevisions)).toHaveLength(0);
		// the person and the file record survive — only the linkage dies
		expect(await db.select().from(contacts)).toHaveLength(1);
		const [file] = await db.select().from(files);
		expect(file?.submissionId).toBeNull();
	});

	it("cannot delete another event's submission", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "foreign",
			eventId: "e2",
			title: "Not yours",
			status: "pending",
		});
		await expect(
			callAction(
				await detailRequest(new URLSearchParams({ intent: "delete" })),
				"foreign",
			),
		).rejects.toSatisfy(is404);
		expect(await db.select().from(submissions)).toHaveLength(1);
	});

	it("refuses a non-admin before any write", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Guarded",
			status: "pending",
		});
		const setCookie = await createSession(env, "u_speaker");
		const request = new Request("http://localhost/admin/submissions/s1", {
			method: "POST",
			body: new URLSearchParams({ intent: "delete" }),
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		await expect(callAction(request)).rejects.toSatisfy(
			(thrown) =>
				thrown instanceof Response && thrown.headers.get("Location") === "/403",
		);
		expect(await db.select().from(submissions)).toHaveLength(1);
	});
});
