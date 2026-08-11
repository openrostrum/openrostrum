import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { PARTICIPANT_ROLE as CLIENT_PARTICIPANT_ROLE } from "../app/db/constants";
import {
	PARTICIPANT_ROLE as SCHEMA_PARTICIPANT_ROLE,
	contacts,
	emailOutbox,
	events,
	fields,
	files,
	forms,
	organizationMembers,
	organizations,
	participants,
	passwordResets,
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
import SubmissionDetail, {
	action,
	loader,
} from "../app/routes/admin.submissions_.$id";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function contextWith(overrides: Partial<Env>) {
	return {
		cloudflare: {
			env: { ...env, ...overrides } as Env,
			ctx: {},
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

function unwrap(result: unknown) {
	return result as {
		data: {
			notice?: string;
			warning?: string;
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

function callAction(
	request: Request,
	id = "s1",
	context: typeof CONTEXT = CONTEXT,
) {
	return action({
		context,
		request,
		params: { id },
	} as unknown as Parameters<typeof action>[0]);
}

function renderDetail(loaderData: unknown): string {
	const Detail = SubmissionDetail as unknown as ComponentType<{
		loaderData: unknown;
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(Detail, { loaderData }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
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

describe("revision history stays bounded on the loader", () => {
	// A rapid-edit history: every save appends a row, so a submission can carry
	// hundreds of multi-KB snapshots. The judged production failure: the loader
	// returned ALL of them WITH their bodies, so its payload grew without bound
	// per edit until the Worker exceeded its CPU budget (HTTP 1102).
	const FAT = "x".repeat(3_000);

	async function seedFatRevisions(count: number) {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Edited a lot",
			description: FAT,
			status: "pending",
		});
		for (let start = 0; start < count; start += 20) {
			const chunk = Array.from(
				{ length: Math.min(20, count - start) },
				(_, i) => ({
					id: `rev${start + i}`,
					submissionId: "s1",
					title: `Edit ${start + i}`,
					description: FAT,
				}),
			);
			await db.insert(submissionRevisions).values(chunk);
		}
	}

	type RevisionsPayload = {
		revisions: Array<Record<string, unknown>>;
		revisionsTruncated: boolean;
	};

	it("caps the list at 50, newest first, and never ships snapshot bodies", async () => {
		await seedFatRevisions(60);
		const result = unwrap(await callLoader(await detailRequest()));
		const payload = result.data as unknown as RevisionsPayload;
		expect(payload.revisions).toHaveLength(50);
		expect(payload.revisionsTruncated).toBe(true);
		// newest snapshot (last inserted) leads — the row marked "Current"
		expect(payload.revisions[0]?.title).toBe("Edit 59");
		// the list carries metadata only; restore re-reads its snapshot from D1
		for (const rev of payload.revisions) {
			expect(rev).not.toHaveProperty("description");
		}
		// 50 rows of metadata, independent of the 3KB bodies (was ~150KB+)
		expect(JSON.stringify(payload.revisions).length).toBeLessThan(20_000);
	});

	it("?revisions=all reaches the full history so no snapshot is stranded", async () => {
		await seedFatRevisions(60);
		const setCookie = await createSession(env, "u_admin");
		const request = new Request(
			"http://localhost/admin/submissions/s1?revisions=all",
			{ headers: { Cookie: setCookie.split(";")[0] ?? "" } },
		);
		const result = unwrap(await callLoader(request));
		const payload = result.data as unknown as RevisionsPayload;
		expect(payload.revisions).toHaveLength(60);
		expect(payload.revisionsTruncated).toBe(false);
	});

	it("does not claim truncation at exactly the cap", async () => {
		await seedFatRevisions(50);
		const result = unwrap(await callLoader(await detailRequest()));
		const payload = result.data as unknown as RevisionsPayload;
		expect(payload.revisions).toHaveLength(50);
		expect(payload.revisionsTruncated).toBe(false);
	});
});

describe("participant management", () => {
	// Organizer-composed submissions start with no participants; without an
	// attach path, decision emails skip them forever ("No speaker or
	// submitter email"). These pin the attach/remove contract.
	async function seedBareSubmission() {
		const db = await seedWorld();
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Organizer-composed",
			status: "pending",
			type: "session",
		});
		await db.insert(contacts).values([
			{
				id: "c1",
				eventId: "e1",
				email: "ada@x.co",
				firstName: "Ada",
				lastName: "One",
			},
			{
				id: "c2",
				eventId: "e1",
				email: "bo@x.co",
				firstName: "Bo",
				lastName: "Two",
			},
			{
				id: "c_foreign",
				eventId: "e2",
				email: "eve@x.co",
				firstName: "Eve",
				lastName: "Theirs",
			},
		]);
		return db;
	}

	it("attaches existing contacts: first becomes primary, order follows selection", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c1");
		body.append("contactIds", "c2");
		const result = unwrap(await callAction(await detailRequest(body)));

		expect(result.data.notice).toContain("2 participants attached as speaker");
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(rows).toHaveLength(2);
		const byContact = new Map(rows.map((r) => [r.contactId, r]));
		expect(byContact.get("c1")?.isPrimary).toBe(true);
		expect(byContact.get("c1")?.position).toBe(0);
		expect(byContact.get("c2")?.isPrimary).toBe(false);
		expect(byContact.get("c2")?.position).toBe(1);

		// The SAME rows feed the contact record's session list — the two surfaces
		// read one table, so they can never contradict each other.
		const loaded = unwrap(await callLoader(await detailRequest()))
			.data as unknown as {
			participants: Array<{ email: string; role: string }>;
		};
		expect(loaded.participants.map((p) => p.email).sort()).toEqual([
			"ada@x.co",
			"bo@x.co",
		]);
	});

	it("treats contact and role as attachment identity and exact replay does not duplicate links or invitations", async () => {
		const db = await seedBareSubmission();
		const attach = async (role: "speaker" | "moderator") => {
			const body = new URLSearchParams({ intent: "add-participants", role });
			body.append("contactIds", "c1");
			return callAction(await detailRequest(body));
		};

		await attach("speaker");
		await attach("moderator");
		const replay = unwrap(await attach("speaker"));

		expect(replay.data.notice).toMatch(/already/i);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.role).sort()).toEqual([
			"moderator",
			"speaker",
		]);
		expect(rows.filter((row) => row.isPrimary).map((row) => row.role)).toEqual([
			"speaker",
		]);
		const invitations = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "ada@x.co"));
		expect(invitations).toHaveLength(2);
		expect(new Set(invitations.map((mail) => mail.dedupeKey)).size).toBe(2);
	});

	it("notifies an existing contact on a manual submission by default", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c1");

		const result = unwrap(await callAction(await detailRequest(body)));

		expect(result.data.warning).toBeUndefined();
		const [mail] = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "ada@x.co"));
		expect(mail?.html).toContain("/set-password/");
	});

	it("obeys the source form policy for existing contacts while still provisioning access", async () => {
		const db = await seedBareSubmission();
		await db.insert(forms).values({
			id: "form_no_existing_mail",
			eventId: "e1",
			internalName: "Private participant updates",
			notifyExistingContacts: false,
		});
		await db
			.update(submissions)
			.set({ formId: "form_no_existing_mail" })
			.where(eq(submissions.id, "s1"));
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c1");

		await callAction(await detailRequest(body));

		expect(await db.select().from(participants)).toHaveLength(1);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
		const [contact] = await db
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(contact?.userId).toBeTruthy();
		expect(
			await db
				.select()
				.from(passwordResets)
				.where(eq(passwordResets.userId, contact?.userId ?? "")),
		).toHaveLength(1);
	});

	it("refuses a contact from another event without writing anything", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c_foreign");
		const result = unwrap(await callAction(await detailRequest(body)));

		expect(result.data.formError).toMatch(/do not belong/i);
		expect(
			await db
				.select()
				.from(participants)
				.where(eq(participants.submissionId, "s1")),
		).toHaveLength(0);
	});

	it("replaying an attach is clean: no duplicate row, an honest notice", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c1");
		unwrap(await callAction(await detailRequest(body)));
		const replay = unwrap(await callAction(await detailRequest(body)));

		expect(replay.data.notice).toMatch(/already participants/i);
		expect(
			await db
				.select()
				.from(participants)
				.where(eq(participants.submissionId, "s1")),
		).toHaveLength(1);
	});

	it("creates a new contact with usable access and dedupes an exact attachment replay", async () => {
		const db = await seedBareSubmission();
		const createAndAttach = async () =>
			callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "add-new-participant",
						firstName: "Grace",
						lastName: "Hopper",
						email: "  Grace@Navy.mil ",
						role: "speaker",
					}),
				),
			);

		const result = unwrap(await createAndAttach());
		expect(result.data.notice).toContain("1 participant attached as speaker");
		const [contact] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "grace@navy.mil"));
		expect(contact?.eventId).toBe("e1");
		expect(contact?.userId).toBeTruthy();
		const [account] = await db
			.select({ passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.id, contact?.userId ?? ""));
		expect(account?.passwordHash).toMatch(/^invite-pending\$/);
		const resets = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, contact?.userId ?? ""));
		expect(resets).toHaveLength(1);
		const [invitation] = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "grace@navy.mil"));
		expect(invitation?.html).toContain(`/set-password/${resets[0]?.token}`);

		const replay = unwrap(await createAndAttach());
		expect(replay.data.notice).toMatch(/already/i);
		expect(
			await db
				.select()
				.from(participants)
				.where(eq(participants.submissionId, "s1")),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(emailOutbox)
				.where(eq(emailOutbox.to, "grace@navy.mil")),
		).toHaveLength(1);
	});

	it("keeps a confirmed attachment and returns the exact warning when the email provider fails", async () => {
		const db = await seedBareSubmission();
		const provider = vi.fn().mockResolvedValue(
			new Response("provider unavailable", {
				status: 503,
				statusText: "Service Unavailable",
			}),
		);
		vi.stubGlobal("fetch", provider);
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c1");

		const result = unwrap(
			await callAction(
				await detailRequest(body),
				"s1",
				contextWith({
					RESEND_API_KEY: "test-provider-key",
					EMAIL_FROM: "OpenRostrum <onboarding@resend.dev>",
				}),
			),
		);

		expect(result.data.warning).toBe(
			"Participant attached, but the invitation failed — see Email history and retry from the contact record",
		);
		expect(await db.select().from(participants)).toHaveLength(1);
		const [failed] = await db.select().from(emailOutbox);
		expect(failed?.status).toBe("failed");
		expect(failed?.error).toContain("503");
		expect(provider).toHaveBeenCalledTimes(1);
	});

	it("an email that already belongs to an event contact attaches THAT contact — no duplicate", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-new-participant",
			firstName: "Different",
			lastName: "Name",
			email: "ADA@x.co",
			role: "moderator",
		});
		const result = unwrap(await callAction(await detailRequest(body)));

		expect(result.data.notice).toMatch(
			/already exists — attached the existing contact/i,
		);
		// Still exactly one contact with that email on the event.
		expect(
			await db.select().from(contacts).where(eq(contacts.email, "ada@x.co")),
		).toHaveLength(1);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.contactId).toBe("c1");
		expect(rows[0]?.role).toBe("moderator");
	});

	it("rejects an invalid new-contact email with a field error, writes nothing", async () => {
		const db = await seedBareSubmission();
		const body = new URLSearchParams({
			intent: "add-new-participant",
			firstName: "No",
			lastName: "Email",
			email: "not-an-email",
			role: "speaker",
		});
		const result = unwrap(await callAction(await detailRequest(body)));

		expect(result.data.fieldErrors?.email?.[0]).toBeTruthy();
		expect(await db.select().from(participants)).toHaveLength(0);
	});

	it("changes the primary speaker role, preserves acceptance, and promotes the next ordered speaker", async () => {
		const db = await seedBareSubmission();
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
				role: "speaker",
				position: 1,
			},
		]);

		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-participant-role",
						participantId: "p1",
						role: "moderator",
					}),
				),
			),
		);

		expect(result.data.notice).toMatch(/moderator/i);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get("p1")).toMatchObject({
			role: "moderator",
			isPrimary: false,
			acceptanceStatus: "accepted",
			position: 0,
		});
		expect(byId.get("p2")).toMatchObject({
			role: "speaker",
			isPrimary: true,
			position: 1,
		});
	});

	it("does not let a stale non-speaker primary displace the existing primary when its role becomes speaker", async () => {
		const db = await seedBareSubmission();
		await db.insert(participants).values([
			{
				id: "p_target",
				submissionId: "s1",
				contactId: "c2",
				role: "moderator",
				isPrimary: true,
				position: 0,
			},
			{
				id: "p_primary",
				submissionId: "s1",
				contactId: "c1",
				role: "speaker",
				isPrimary: true,
				position: 1,
			},
		]);

		await callAction(
			await detailRequest(
				new URLSearchParams({
					intent: "set-participant-role",
					participantId: "p_target",
					role: "speaker",
				}),
			),
		);

		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get("p_primary")?.isPrimary).toBe(true);
		expect(byId.get("p_target")).toMatchObject({
			role: "speaker",
			isPrimary: false,
		});
	});

	it("rejects a role change that collides with the contact's existing target-role link", async () => {
		const db = await seedBareSubmission();
		await db.insert(participants).values([
			{
				id: "p_speaker",
				submissionId: "s1",
				contactId: "c1",
				role: "speaker",
				isPrimary: true,
				position: 0,
			},
			{
				id: "p_moderator",
				submissionId: "s1",
				contactId: "c1",
				role: "moderator",
				position: 1,
			},
		]);

		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-participant-role",
						participantId: "p_speaker",
						role: "moderator",
					}),
				),
			),
		);

		expect(result.data.formError).toMatch(/already.*selected role/i);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get("p_speaker")).toMatchObject({
			role: "speaker",
			isPrimary: true,
		});
		expect(byId.get("p_moderator")).toMatchObject({
			role: "moderator",
			isPrimary: false,
		});
	});

	it("rejects non-canonical organizer role input without changing the participant", async () => {
		const db = await seedBareSubmission();
		await db.insert(participants).values({
			id: "p1",
			submissionId: "s1",
			contactId: "c1",
			role: "speaker",
			isPrimary: true,
		});

		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "set-participant-role",
						participantId: "p1",
						role: "co_presenter",
					}),
				),
			),
		);

		expect(result.data.formError).toMatch(/valid participant role/i);
		const [row] = await db.select().from(participants);
		expect(row).toMatchObject({ role: "speaker", isPrimary: true });
	});

	// A submission with speakers must always keep exactly one primary: task
	// provisioning targets the primary and decision emails address it first,
	// so a primary-less submission silently drops out of both.
	it("removing the primary promotes the next speaker by position", async () => {
		const db = await seedBareSubmission();
		await db.insert(participants).values([
			{
				id: "p1",
				submissionId: "s1",
				contactId: "c1",
				role: "speaker",
				isPrimary: true,
				position: 0,
			},
			{
				id: "p2",
				submissionId: "s1",
				contactId: "c2",
				role: "speaker",
				isPrimary: false,
				position: 1,
			},
		]);
		const result = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "remove-participant",
						participantId: "p1",
					}),
				),
			),
		);
		expect(result.data.notice).toMatch(/next speaker is now primary/i);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe("p2");
		expect(rows[0]?.isPrimary).toBe(true);
	});

	it("attaching a speaker where none is primary grants primary (swap flow ends whole)", async () => {
		const db = await seedBareSubmission();
		// Only a moderator on the submission — no primary exists.
		await db.insert(participants).values({
			id: "p_mod",
			submissionId: "s1",
			contactId: "c1",
			role: "moderator",
			isPrimary: false,
			position: 0,
		});
		const body = new URLSearchParams({
			intent: "add-participants",
			role: "speaker",
		});
		body.append("contactIds", "c2");
		unwrap(await callAction(await detailRequest(body)));
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		const speaker = rows.find((r) => r.contactId === "c2");
		expect(speaker?.isPrimary).toBe(true);
		expect(rows.find((r) => r.id === "p_mod")?.isPrimary).toBe(false);
	});

	it("removes a participant from this submission only — a foreign id is refused", async () => {
		const db = await seedBareSubmission();
		await db.insert(submissions).values({
			id: "s_other",
			eventId: "e1",
			title: "Other",
			status: "pending",
		});
		await db.insert(participants).values([
			{ id: "p1", submissionId: "s1", contactId: "c1", role: "speaker" },
			{
				id: "p_other",
				submissionId: "s_other",
				contactId: "c2",
				role: "speaker",
			},
		]);

		const foreign = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "remove-participant",
						participantId: "p_other",
					}),
				),
			),
		);
		expect(foreign.data.formError).toMatch(/not on this submission/i);
		expect(await db.select().from(participants)).toHaveLength(2);

		const removed = unwrap(
			await callAction(
				await detailRequest(
					new URLSearchParams({
						intent: "remove-participant",
						participantId: "p1",
					}),
				),
			),
		);
		expect(removed.data.notice).toMatch(/removed/i);
		expect(
			await db
				.select()
				.from(participants)
				.where(eq(participants.submissionId, "s1")),
		).toHaveLength(0);
	});

	it("renders human role labels and an inline canonical role selector for each participant", async () => {
		const db = await seedBareSubmission();
		await db.insert(participants).values({
			id: "p_secondary",
			submissionId: "s1",
			contactId: "c1",
			role: "secondary",
			position: 0,
		});
		const loaded = unwrap(await callLoader(await detailRequest())).data;

		const html = renderDetail(loaded);

		expect(html).toContain("Secondary contact");
		expect(html).toContain(">Speaker<");
		expect(html).toContain(">Chairperson<");
		expect(html).toContain(">Moderator<");
		expect(html).toContain('value="set-participant-role"');
		expect(html).toContain('name="participantId" value="p_secondary"');
		expect(html).toContain("Save role");
	});
});

describe("PARTICIPANT_ROLE lockstep", () => {
	// The client-safe tuple (route components must not import schema.ts) and
	// the integration-owned schema enum must never diverge.
	it("keeps the client PARTICIPANT_ROLE tuple in lockstep with the schema", () => {
		expect(CLIENT_PARTICIPANT_ROLE).toEqual(SCHEMA_PARTICIPANT_ROLE);
	});
});
