import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	organizationMembers,
	participants,
	portalForms,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import {
	action as submissionDetailAction,
	loader as submissionDetailLoader,
} from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import { loader as submissionsLoader } from "../app/routes/portals.$eventSlug.$portalId.submissions";
import { action as taskDetailAction } from "../app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId";
import { loader as tasksLoader } from "../app/routes/portals.$eventSlug.$portalId.tasks";
import { loader as shellLoader } from "../app/routes/portals.$eventSlug.$portalId";
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

const PREVIEW_COOKIE = "__portal_preview=c_priya";

/** Portal world + an org1 admin, Priya (form task + simple task), and Mallory. */
async function seedPreviewWorld() {
	await seedPortalWorld();
	const db = getDb(env);
	await makeUser("u_admin", "admin@org1.co", "admin");
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	await makeUser("u_badmin", "admin@org2.co", "admin");
	await db.insert(organizationMembers).values({
		organizationId: "org2",
		userId: "u_badmin",
	});

	await makeUser("u_priya", "priya@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
	await makeUser("u_mallory", "mallory@example.com");
	await makeContact(
		"c_mallory",
		"e1",
		"mallory@example.com",
		"u_mallory",
		"Mallory",
		"M",
	);
	await makeContact("c_out", "e2", "out@example.com", null, "Out", "Sider");

	await db.insert(portalForms).values({
		id: "pf_hotel",
		eventId: "e1",
		name: "Hotel Stay",
		title: "Book your hotel",
		schema: [
			{ name: "Hotel name", type: "text", required: true },
			{ name: "Check-in date", type: "date", required: true },
		],
	});
	await db.insert(tasks).values([
		{
			id: "t_form",
			eventId: "e1",
			name: "Hotel Stay Requirements",
			type: "contact",
			portalFormId: "pf_hotel",
		},
		{
			id: "t_simple",
			eventId: "e1",
			name: "Confirm your bio",
			type: "contact",
		},
	]);
	await db.insert(taskAssignments).values([
		{ id: "ta_form", taskId: "t_form", contactId: "c_priya" },
		{ id: "ta_simple", taskId: "t_simple", contactId: "c_priya" },
		{ id: "ta_mallory", taskId: "t_simple", contactId: "c_mallory" },
	]);
	await db.insert(submissions).values([
		{
			id: "s_priya_owned",
			eventId: "e1",
			title: "Priya's proposal",
			status: "pending",
			submitterId: "u_priya",
		},
		{
			id: "s_panel",
			eventId: "e1",
			title: "Speaker panel",
			status: "accepted",
			submitterId: "u_mallory",
		},
	]);
	await db.insert(participants).values([
		{
			id: "p_priya",
			submissionId: "s_panel",
			contactId: "c_priya",
		},
		{
			id: "p_mallory",
			submissionId: "s_panel",
			contactId: "c_mallory",
		},
	]);
	return db;
}

async function requestWithPreview(
	userId: string,
	url: string,
	init?: RequestInit,
	previewCookie = PREVIEW_COOKIE,
): Promise<Request> {
	const request = await authedRequest(userId, url, init);
	const session = request.headers.get("Cookie") ?? "";
	const headers = new Headers(request.headers);
	headers.set("Cookie", `${session}; ${previewCookie}`);
	return new Request(url, {
		method: request.method,
		headers,
		body: init?.body,
	});
}

type ShellData = {
	preview: { contactName: string } | null;
	user: { email: string };
};
type TasksData = { tasks: Array<{ id: string; name: string }> };

describe("admin portal preview (View portal as)", () => {
	it("shows the speaker's portal to an org admin with the preview banner data", async () => {
		await seedPreviewWorld();
		const shell = (await shellLoader({
			context: CONTEXT,
			request: await requestWithPreview("u_admin", BASE),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0])) as ShellData;
		expect(shell.preview).toEqual({ contactName: "Priya R" });

		const tasksData = unwrap<TasksData>(
			await tasksLoader({
				context: CONTEXT,
				request: await requestWithPreview("u_admin", `${BASE}/tasks`),
				params: PORTAL_PARAMS,
			} as unknown as Parameters<typeof tasksLoader>[0]),
		);
		expect(tasksData.tasks.map((t) => t.id).sort()).toEqual([
			"ta_form",
			"ta_simple",
		]);
	});

	it("uses the selected speaker's linked account for every submission read affordance", async () => {
		await seedPreviewWorld();
		const list = unwrap<{
			submissions: Array<{ id: string }>;
		}>(
			await submissionsLoader({
				context: CONTEXT,
				request: await requestWithPreview("u_admin", `${BASE}/submissions`),
				params: PORTAL_PARAMS,
			} as unknown as Parameters<typeof submissionsLoader>[0]),
		);
		expect(list.submissions.map((row) => row.id)).toContain("s_priya_owned");

		const owned = unwrap<{
			canWithdrawSubmission: boolean;
		}>(
			await submissionDetailLoader({
				context: CONTEXT,
				request: await requestWithPreview(
					"u_admin",
					`${BASE}/submissions/s_priya_owned`,
				),
				params: { ...PORTAL_PARAMS, submissionId: "s_priya_owned" },
			} as unknown as Parameters<typeof submissionDetailLoader>[0]),
		);
		expect(owned.canWithdrawSubmission).toBe(true);

		const panel = unwrap<{
			participants: Array<{ id: string; isMe: boolean; removable: boolean }>;
		}>(
			await submissionDetailLoader({
				context: CONTEXT,
				request: await requestWithPreview(
					"u_admin",
					`${BASE}/submissions/s_panel`,
				),
				params: { ...PORTAL_PARAMS, submissionId: "s_panel" },
			} as unknown as Parameters<typeof submissionDetailLoader>[0]),
		);
		expect(panel.participants.find((p) => p.id === "p_priya")).toMatchObject({
			isMe: true,
			removable: false,
		});
	});

	it("blocks every mutation server-side while previewing — 403 AND the write never happened", async () => {
		const db = await seedPreviewWorld();

		const submitRequest = await requestWithPreview(
			"u_admin",
			`${BASE}/tasks/ta_form`,
			{
				method: "POST",
				body: new URLSearchParams({
					intent: "submit-form",
					"answer:Hotel name": "Marriott Marquis",
					"answer:Check-in date": "2026-10-11",
				}),
			},
		);
		const submitThrown = await catchThrown(() =>
			taskDetailAction({
				context: CONTEXT,
				request: submitRequest,
				params: { ...PORTAL_PARAMS, assignmentId: "ta_form" },
			} as unknown as Parameters<typeof taskDetailAction>[0]),
		);
		expect(thrownStatus(submitThrown)).toBe(403);

		const completeRequest = await requestWithPreview(
			"u_admin",
			`${BASE}/tasks/ta_simple`,
			{ method: "POST", body: new URLSearchParams({ intent: "complete" }) },
		);
		const completeThrown = await catchThrown(() =>
			taskDetailAction({
				context: CONTEXT,
				request: completeRequest,
				params: { ...PORTAL_PARAMS, assignmentId: "ta_simple" },
			} as unknown as Parameters<typeof taskDetailAction>[0]),
		);
		expect(thrownStatus(completeThrown)).toBe(403);

		const withdrawRequest = await requestWithPreview(
			"u_admin",
			`${BASE}/submissions/s_priya_owned`,
			{
				method: "POST",
				body: new URLSearchParams({ intent: "withdraw-submission" }),
			},
		);
		const withdrawThrown = await catchThrown(() =>
			submissionDetailAction({
				context: CONTEXT,
				request: withdrawRequest,
				params: { ...PORTAL_PARAMS, submissionId: "s_priya_owned" },
			} as unknown as Parameters<typeof submissionDetailAction>[0]),
		);
		expect(thrownStatus(withdrawThrown)).toBe(403);
		const [owned] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s_priya_owned"));
		expect(owned?.status).toBe("pending");

		const rows = await db.select().from(taskAssignments);
		for (const row of rows) {
			expect(row.status).toBe("incomplete");
			expect(row.response).toBeNull();
			expect(row.completedAt).toBeNull();
		}
	});

	it("ignores the preview cookie for non-admins — no impersonation, no lockout", async () => {
		const db = await seedPreviewWorld();
		const shell = (await shellLoader({
			context: CONTEXT,
			request: await requestWithPreview("u_mallory", BASE),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0])) as ShellData;
		expect(shell.preview).toBeNull();

		const tasksData = unwrap<TasksData>(
			await tasksLoader({
				context: CONTEXT,
				request: await requestWithPreview("u_mallory", `${BASE}/tasks`),
				params: PORTAL_PARAMS,
			} as unknown as Parameters<typeof tasksLoader>[0]),
		);
		expect(tasksData.tasks.map((t) => t.id)).toEqual(["ta_mallory"]);

		// Her own mutations still work — the stray cookie must not lock her out.
		const result = await taskDetailAction({
			context: CONTEXT,
			request: await requestWithPreview(
				"u_mallory",
				`${BASE}/tasks/ta_mallory`,
				{
					method: "POST",
					body: new URLSearchParams({ intent: "complete" }),
				},
			),
			params: { ...PORTAL_PARAMS, assignmentId: "ta_mallory" },
		} as unknown as Parameters<typeof taskDetailAction>[0]);
		expect((result as Response).status).toBe(302);
		const [own] = await db
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.id, "ta_mallory"));
		expect(own?.status).toBe("complete");
	});

	it("refuses preview across tenants — another org's admin gets no impersonation", async () => {
		await seedPreviewWorld();
		const shell = (await shellLoader({
			context: CONTEXT,
			request: await requestWithPreview("u_badmin", BASE),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0])) as ShellData;
		expect(shell.preview).toBeNull();
	});

	it("ignores a preview cookie naming a contact from another event", async () => {
		await seedPreviewWorld();
		const shell = (await shellLoader({
			context: CONTEXT,
			request: await requestWithPreview(
				"u_admin",
				BASE,
				undefined,
				"__portal_preview=c_out",
			),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0])) as ShellData;
		expect(shell.preview).toBeNull();
	});

	it("performs no writes while previewing — the email-match contact link is skipped", async () => {
		const db = await seedPreviewWorld();
		// An unlinked contact matching the admin's email: normal portal entry
		// would claim it (control below); preview must not.
		await makeContact("c_adminmail", "e1", "admin@org1.co", null, "Ada", "Min");

		await shellLoader({
			context: CONTEXT,
			request: await requestWithPreview("u_admin", BASE),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0]);
		const [afterPreview] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_adminmail"));
		expect(afterPreview?.userId).toBeNull();

		// Control: the same GET without the preview cookie links the contact,
		// proving the assertion above can catch a regression.
		await shellLoader({
			context: CONTEXT,
			request: await authedRequest("u_admin", BASE),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof shellLoader>[0]);
		const [afterNormal] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_adminmail"));
		expect(afterNormal?.userId).toBe("u_admin");
	});
});
