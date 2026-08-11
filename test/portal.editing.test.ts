import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmissionDetailView } from "../app/components/portal/submission-detail-view";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	forms,
	participants,
	submissionRevisions,
	submissions,
} from "../app/db/schema";
import {
	action as detailAction,
	loader as detailLoader,
} from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import { loader as submissionsLoader } from "../app/routes/portals.$eventSlug.$portalId.submissions";
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

type ActionArgs = Parameters<typeof detailAction>[0];
type DetailLoaderArgs = Parameters<typeof detailLoader>[0];
type SubmissionsLoaderArgs = Parameters<typeof submissionsLoader>[0];

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

type RolePolicyOptions = {
	allowChairperson?: boolean;
	allowModerator?: boolean;
	roleSpeakerMin?: number;
	roleSpeakerMax?: number | null;
	roleChairpersonMin?: number;
	roleChairpersonMax?: number | null;
	roleModeratorMin?: number;
	roleModeratorMax?: number | null;
};

async function seedEditableSubmission(
	closeAt: Date,
	rolePolicy: RolePolicyOptions = {},
) {
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
	await db.insert(forms).values({
		id: "form1",
		eventId: "e1",
		publicId: "form-pub-1",
		internalName: "CFP",
		status: "open",
		closeAt,
		roleSpeakerMin: rolePolicy.roleSpeakerMin ?? 1,
		roleSpeakerMax:
			rolePolicy.roleSpeakerMax === undefined ? 3 : rolePolicy.roleSpeakerMax,
		allowChairperson: rolePolicy.allowChairperson ?? false,
		roleChairpersonMin: rolePolicy.roleChairpersonMin ?? 0,
		roleChairpersonMax: rolePolicy.roleChairpersonMax ?? null,
		allowModerator: rolePolicy.allowModerator ?? false,
		roleModeratorMin: rolePolicy.roleModeratorMin ?? 0,
		roleModeratorMax: rolePolicy.roleModeratorMax ?? null,
	});
	await db.insert(submissions).values({
		id: "s1",
		eventId: "e1",
		formId: "form1",
		title: "Original title",
		description: "<p>Original</p>",
		status: "pending",
		submitterId: "u_priya",
	});
	await db.insert(participants).values({
		id: "p_me",
		submissionId: "s1",
		contactId: "c_priya",
		role: "speaker",
		isPrimary: true,
		position: 0,
	});
}

function updateRequest(body: Record<string, string>) {
	return authedRequest("u_priya", `${BASE}/submissions/s1`, {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

const detailParams = { ...PORTAL_PARAMS, submissionId: "s1" };

function actionBody<T>(result: unknown): T {
	if (result && typeof result === "object" && "data" in result) {
		return unwrap<T>(result);
	}
	return result as T;
}

function contextWith(overrides: Record<string, unknown>) {
	return {
		cloudflare: { env: { ...env, ...overrides } as unknown as Env, ctx: {} },
	};
}

async function loadDetail(userId = "u_priya") {
	return unwrap<Awaited<ReturnType<typeof detailLoader>>["data"]>(
		await detailLoader({
			context: CONTEXT,
			request: await authedRequest(userId, `${BASE}/submissions/s1`),
			params: detailParams,
		} as unknown as DetailLoaderArgs),
	);
}

function renderDetail(
	data: Awaited<ReturnType<typeof detailLoader>>["data"],
): string {
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(SubmissionDetailView, { data }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("edit-until-close (portal View Submission)", () => {
	it("saves an edit before close, appends an editor-attributed revision, and sanitizes hostile HTML", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		const response = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "update",
				title: "Sharper title",
				description:
					'<p>Safe <strong>bold</strong></p><script>alert(1)</script><p onclick="x()">click</p><a href="javascript:evil()">link</a>',
			}),
			params: detailParams,
		} as unknown as ActionArgs);

		expect((response as Response).status).toBe(302);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.title).toBe("Sharper title");
		expect(row?.description).toContain("<strong>bold</strong>");
		expect(row?.description).not.toContain("<script");
		expect(row?.description).not.toContain("onclick");
		expect(row?.description).not.toContain("javascript:");

		const revisions = await db
			.select()
			.from(submissionRevisions)
			.where(eq(submissionRevisions.submissionId, "s1"));
		expect(revisions).toHaveLength(1);
		expect(revisions[0]?.title).toBe("Sharper title");
		expect(revisions[0]?.editedById).toBe("u_priya");
	});

	it("refuses every edit after the form's close date — content unchanged", async () => {
		await seedEditableSubmission(PAST);
		const db = getDb(env);
		const result = (await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "update",
				title: "Too late",
				description: "<p>late</p>",
			}),
			params: detailParams,
		} as unknown as ActionArgs)) as { formError?: string };

		expect(result.formError).toMatch(/closed/i);
		const [row] = await db
			.select({ title: submissions.title })
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.title).toBe("Original title");
	});

	it("rejects an exact same-contact/same-role replay and sends one invitation", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		// Dana already exists as a contact in this event under this email.
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");

		const add = () =>
			updateRequest({
				intent: "add-participant",
				firstName: "Dana",
				lastName: "Okafor",
				email: "Dana@Example.com", // cased on purpose — must normalize
				role: "speaker",
			});
		const first = await detailAction({
			context: CONTEXT,
			request: await add(),
			params: detailParams,
		} as unknown as ActionArgs);
		expect((first as Response).status).toBe(302);

		const danaContacts = await db
			.select()
			.from(contacts)
			.where(
				and(eq(contacts.eventId, "e1"), eq(contacts.email, "dana@example.com")),
			);
		expect(danaContacts).toHaveLength(1); // reused, not duplicated
		const links = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(links).toHaveLength(2);

		const second = (await detailAction({
			context: CONTEXT,
			request: await add(),
			params: detailParams,
		} as unknown as ActionArgs)) as { formError?: string };
		expect(second.formError).toMatch(/already/i);
		const invitations = await db
			.select({ status: emailOutbox.status })
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "dana@example.com"));
		expect(invitations).toEqual([{ status: "sent" }]);
	});

	it("removes a co-speaker but never the last speaker, and never yourself", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db
			.insert(participants)
			.values({ id: "p_dana", submissionId: "s1", contactId: "c_dana" });

		// Removing myself is refused (participation controls own that path).
		const self = (await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "remove-participant",
				participantId: "p_me",
			}),
			params: detailParams,
		} as unknown as ActionArgs)) as { formError?: string };
		expect(self.formError).toBeTruthy();

		const removed = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "remove-participant",
				participantId: "p_dana",
			}),
			params: detailParams,
		} as unknown as ActionArgs);
		expect((removed as Response).status).toBe(302);

		// p_me is now the last speaker — the floor holds.
		const last = (await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "remove-participant",
				participantId: "p_me",
			}),
			params: detailParams,
		} as unknown as ActionArgs)) as { formError?: string };
		expect(last.formError).toBeTruthy();
		const remaining = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(remaining.map((p) => p.id)).toEqual(["p_me"]);
	});

	it("withdraws the whole submission: status flips, schedule clears, reason recorded", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		await db
			.update(submissions)
			.set({
				status: "accepted",
				startsAt: new Date("2026-10-12T17:00:00Z"),
				endsAt: new Date("2026-10-12T17:30:00Z"),
			})
			.where(eq(submissions.id, "s1"));

		const response = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "withdraw-submission",
				reason: "Schedule conflict",
			}),
			params: detailParams,
		} as unknown as ActionArgs);
		expect((response as Response).status).toBe(302);

		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("withdrawn");
		expect(row?.withdrawnById).toBe("u_priya");
		expect(row?.withdrawnReason).toBe("Schedule conflict");
		expect(row?.startsAt).toBeNull();
		expect(row?.endsAt).toBeNull();
	});

	it("blocks whole-submission withdrawal for a co-speaker who is not the submitter", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		await db
			.update(submissions)
			.set({ status: "accepted" })
			.where(eq(submissions.id, "s1"));
		await makeUser("u_dana", "dana@example.com");
		await makeContact(
			"c_dana",
			"e1",
			"dana@example.com",
			"u_dana",
			"Dana",
			"O",
		);
		await db
			.insert(participants)
			.values({ id: "p_dana", submissionId: "s1", contactId: "c_dana" });

		let status: number | undefined;
		try {
			await detailAction({
				context: CONTEXT,
				request: await authedRequest("u_dana", `${BASE}/submissions/s1`, {
					method: "POST",
					body: new URLSearchParams({ intent: "withdraw-submission" }),
				}),
				params: detailParams,
			} as unknown as ActionArgs);
		} catch (thrown) {
			status = (thrown as { init?: { status?: number } }).init?.status;
		}
		expect(status).toBe(404);
		const db2 = getDb(env);
		const [row] = await db2
			.select({ status: submissions.status })
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(row?.status).toBe("accepted"); // the write never happened
	});

	it("repairs the single-primary invariant when adding a non-speaker", async () => {
		await seedEditableSubmission(FUTURE, { allowModerator: true });
		const db = getDb(env);
		await db
			.update(participants)
			.set({ isPrimary: false })
			.where(eq(participants.id, "p_me"));

		const response = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "add-participant",
				firstName: "Morgan",
				lastName: "Moderator",
				email: "morgan@example.com",
				role: "moderator",
			}),
			params: detailParams,
		} as unknown as ActionArgs);
		expect((response as Response).status).toBe(302);

		const speakers = await db
			.select({ id: participants.id, primary: participants.isPrimary })
			.from(participants)
			.where(
				and(
					eq(participants.submissionId, "s1"),
					eq(participants.role, "speaker"),
				),
			);
		expect(speakers).toEqual([{ id: "p_me", primary: true }]);
	});

	it("adds enabled chairperson and moderator roles before close", async () => {
		await seedEditableSubmission(FUTURE, {
			allowChairperson: true,
			allowModerator: true,
			roleChairpersonMax: 2,
			roleModeratorMax: 2,
		});
		const db = getDb(env);

		for (const person of [
			{
				firstName: "Chair",
				lastName: "Person",
				email: "chair@example.com",
				role: "chairperson",
			},
			{
				firstName: "Mod",
				lastName: "Person",
				email: "moderator@example.com",
				role: "moderator",
			},
		]) {
			const response = await detailAction({
				context: CONTEXT,
				request: await updateRequest({ intent: "add-participant", ...person }),
				params: detailParams,
			} as unknown as ActionArgs);
			expect((response as Response).status).toBe(302);
		}

		const rows = await db
			.select({ email: contacts.email, role: participants.role })
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId))
			.where(eq(participants.submissionId, "s1"));
		expect(
			rows
				.filter((row) => row.email !== "priya@example.com")
				.sort((a, b) => a.email.localeCompare(b.email)),
		).toEqual([
			{ email: "chair@example.com", role: "chairperson" },
			{ email: "moderator@example.com", role: "moderator" },
		]);
	});

	it("refuses a role disabled on the source form without creating a contact", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		const result = actionBody<{ formError?: string }>(
			await detailAction({
				context: CONTEXT,
				request: await updateRequest({
					intent: "add-participant",
					firstName: "Chair",
					lastName: "Person",
					email: "disabled-chair@example.com",
					role: "chairperson",
				}),
				params: detailParams,
			} as unknown as ActionArgs),
		);

		expect(result.formError).toMatch(/not enabled|not available/i);
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "disabled-chair@example.com")),
		).toEqual([]);
	});

	it("refuses speaker additions above the source-form maximum", async () => {
		await seedEditableSubmission(FUTURE, { roleSpeakerMax: 1 });
		const db = getDb(env);
		const result = actionBody<{ formError?: string }>(
			await detailAction({
				context: CONTEXT,
				request: await updateRequest({
					intent: "add-participant",
					firstName: "Dana",
					lastName: "Okafor",
					email: "speaker-overflow@example.com",
					role: "speaker",
				}),
				params: detailParams,
			} as unknown as ActionArgs),
		);

		expect(result.formError).toMatch(/at most 1 speaker/i);
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "speaker-overflow@example.com")),
		).toEqual([]);
	});

	it("enforces the configured speaker minimum on role change and removal", async () => {
		await seedEditableSubmission(FUTURE, {
			allowModerator: true,
			roleSpeakerMin: 2,
		});
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db.insert(participants).values({
			id: "p_dana",
			submissionId: "s1",
			contactId: "c_dana",
			role: "speaker",
			position: 1,
		});

		const mutations: Array<Record<string, string>> = [
			{ intent: "remove-participant", participantId: "p_dana" },
			{
				intent: "set-participant-role",
				participantId: "p_dana",
				role: "moderator",
			},
		];
		for (const body of mutations) {
			const result = actionBody<{ formError?: string }>(
				await detailAction({
					context: CONTEXT,
					request: await updateRequest(body),
					params: detailParams,
				} as unknown as ActionArgs),
			);
			expect(result.formError).toMatch(/at least 2 speakers/i);
		}

		const [dana] = await db
			.select({ role: participants.role })
			.from(participants)
			.where(eq(participants.id, "p_dana"));
		expect(dana?.role).toBe("speaker");
	});

	it("changes a primary co-speaker to moderator and atomically promotes the next speaker", async () => {
		await seedEditableSubmission(FUTURE, { allowModerator: true });
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db.batch([
			db
				.update(participants)
				.set({ isPrimary: false })
				.where(eq(participants.id, "p_me")),
			db.insert(participants).values({
				id: "p_dana",
				submissionId: "s1",
				contactId: "c_dana",
				role: "speaker",
				isPrimary: true,
				position: 1,
			}),
		]);

		const response = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "set-participant-role",
				participantId: "p_dana",
				role: "moderator",
			}),
			params: detailParams,
		} as unknown as ActionArgs);
		expect((response as Response).status).toBe(302);

		const rows = await db
			.select({
				id: participants.id,
				role: participants.role,
				primary: participants.isPrimary,
			})
			.from(participants)
			.where(eq(participants.submissionId, "s1"));
		expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
			{ id: "p_dana", role: "moderator", primary: false },
			{ id: "p_me", role: "speaker", primary: true },
		]);
	});

	it("allows the same contact under a distinct enabled role", async () => {
		await seedEditableSubmission(FUTURE, { allowModerator: true });
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");

		for (const role of ["speaker", "moderator"]) {
			const response = await detailAction({
				context: CONTEXT,
				request: await updateRequest({
					intent: "add-participant",
					firstName: "Dana",
					lastName: "Okafor",
					email: "DANA@example.com",
					role,
				}),
				params: detailParams,
			} as unknown as ActionArgs);
			expect((response as Response).status).toBe(302);
		}

		const roles = await db
			.select({ role: participants.role })
			.from(participants)
			.where(
				and(
					eq(participants.submissionId, "s1"),
					eq(participants.contactId, "c_dana"),
				),
			);
		expect(roles.map((row) => row.role).sort()).toEqual([
			"moderator",
			"speaker",
		]);
	});

	it("keeps a confirmed participant link and returns a warning when invitation delivery fails", async () => {
		await seedEditableSubmission(FUTURE);
		await makeUser("u_dana", "dana@example.com");
		await makeContact(
			"c_dana",
			"e1",
			"dana@example.com",
			"u_dana",
			"Dana",
			"O",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: "provider rejected send" }), {
					status: 422,
				}),
			),
		);

		const result = actionBody<{ ok?: boolean; warning?: string }>(
			await detailAction({
				context: contextWith({
					RESEND_API_KEY: "re_test",
					EMAIL_FROM: "OpenRostrum <noreply@test.example>",
				}),
				request: await updateRequest({
					intent: "add-participant",
					firstName: "Dana",
					lastName: "Okafor",
					email: "dana@example.com",
					role: "speaker",
				}),
				params: detailParams,
			} as unknown as ActionArgs),
		);

		expect(result.ok).toBe(true);
		expect(result.warning).toMatch(/invitation/i);
		const db = getDb(env);
		expect(
			await db
				.select({ id: participants.id })
				.from(participants)
				.where(eq(participants.contactId, "c_dana")),
		).toHaveLength(1);
		expect(
			await db
				.select({ status: emailOutbox.status })
				.from(emailOutbox)
				.where(eq(emailOutbox.to, "dana@example.com")),
		).toEqual([{ status: "failed" }]);
	});

	it("blocks add, role change, and removal after the form closes", async () => {
		await seedEditableSubmission(PAST, { allowModerator: true });
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db.insert(participants).values({
			id: "p_dana",
			submissionId: "s1",
			contactId: "c_dana",
			role: "speaker",
			position: 1,
		});

		const mutations: Array<Record<string, string>> = [
			{
				intent: "add-participant",
				firstName: "Late",
				lastName: "Person",
				email: "late@example.com",
				role: "speaker",
			},
			{
				intent: "set-participant-role",
				participantId: "p_dana",
				role: "moderator",
			},
			{ intent: "remove-participant", participantId: "p_dana" },
		];
		for (const body of mutations) {
			const result = actionBody<{ formError?: string }>(
				await detailAction({
					context: CONTEXT,
					request: await updateRequest(body),
					params: detailParams,
				} as unknown as ActionArgs),
			);
			expect(result.formError).toMatch(/closed/i);
		}

		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "late@example.com")),
		).toEqual([]);
		const [dana] = await db
			.select({ role: participants.role })
			.from(participants)
			.where(eq(participants.id, "p_dana"));
		expect(dana?.role).toBe("speaker");
	});

	it("blocks add, role change, and removal for a foreign portal user", async () => {
		await seedEditableSubmission(FUTURE, { allowModerator: true });
		const db = getDb(env);
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db.insert(participants).values({
			id: "p_dana",
			submissionId: "s1",
			contactId: "c_dana",
			role: "speaker",
			position: 1,
		});
		await makeUser("u_foreign", "foreign@example.com");
		await makeContact(
			"c_foreign",
			"e1",
			"foreign@example.com",
			"u_foreign",
			"Foreign",
			"User",
		);

		const mutations: Array<Record<string, string>> = [
			{
				intent: "add-participant",
				firstName: "Intruder",
				lastName: "Add",
				email: "intruder@example.com",
				role: "speaker",
			},
			{
				intent: "set-participant-role",
				participantId: "p_dana",
				role: "moderator",
			},
			{ intent: "remove-participant", participantId: "p_dana" },
		];
		for (const body of mutations) {
			const thrown = await catchThrown(async () =>
				detailAction({
					context: CONTEXT,
					request: await authedRequest("u_foreign", `${BASE}/submissions/s1`, {
						method: "POST",
						body: new URLSearchParams(body),
					}),
					params: detailParams,
				} as unknown as ActionArgs),
			);
			expect(thrownStatus(thrown)).toBe(404);
		}

		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "intruder@example.com")),
		).toEqual([]);
		const [dana] = await db
			.select({ role: participants.role })
			.from(participants)
			.where(eq(participants.id, "p_dana"));
		expect(dana?.role).toBe("speaker");
	});

	it("loads canonical allowed roles and human labels and renders inline role controls", async () => {
		await seedEditableSubmission(FUTURE, {
			allowChairperson: true,
			allowModerator: true,
		});
		const db = getDb(env);
		await makeContact(
			"c_chair",
			"e1",
			"chair@example.com",
			null,
			"Chair",
			"Person",
		);
		await db.insert(participants).values({
			id: "p_chair",
			submissionId: "s1",
			contactId: "c_chair",
			role: "chairperson",
			position: 1,
		});

		const loaded = (await loadDetail()) as Awaited<
			ReturnType<typeof loadDetail>
		> & {
			allowedParticipantRoles: string[];
			participants: Array<{ id: string; roleLabel: string }>;
		};
		expect(loaded.allowedParticipantRoles).toEqual([
			"speaker",
			"chairperson",
			"moderator",
			"secondary",
		]);
		expect(
			loaded.participants.find((participant) => participant.id === "p_chair")
				?.roleLabel,
		).toBe("Chairperson");

		const html = renderDetail(loaded);
		expect(html).toContain('value="chairperson"');
		expect(html).toContain('value="moderator"');
		expect(html).toContain('value="set-participant-role"');
	});

	it("renders the explicit participant empty state", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		await db.delete(participants).where(eq(participants.submissionId, "s1"));

		const loaded = await loadDetail();
		expect(loaded.participants).toEqual([]);
		expect(renderDetail(loaded)).toContain("No participants are listed");
	});

	it("uses one deterministic multi-role participation control and updates every non-secondary role link", async () => {
		await seedEditableSubmission(FUTURE, { allowModerator: true });
		const db = getDb(env);
		await db.batch([
			db
				.update(submissions)
				.set({ status: "accepted" })
				.where(eq(submissions.id, "s1")),
			db
				.update(participants)
				.set({ position: 2, acceptanceStatus: "pending" })
				.where(eq(participants.id, "p_me")),
			db.insert(participants).values({
				id: "p_moderator",
				submissionId: "s1",
				contactId: "c_priya",
				role: "moderator",
				position: 1,
				acceptanceStatus: "declined",
			}),
			db.insert(participants).values({
				id: "p_secondary",
				submissionId: "s1",
				contactId: "c_priya",
				role: "secondary",
				position: 0,
				acceptanceStatus: "declined",
			}),
		]);

		const detail = await loadDetail();
		expect(detail.myParticipation?.id).toBe("p_moderator");
		expect(detail.myParticipation?.raw).toBe("declined");
		const list = unwrap<{
			submissions: Array<{
				id: string;
				participation: { id: string } | null;
			}>;
		}>(
			await submissionsLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/submissions`),
				params: PORTAL_PARAMS,
			} as unknown as SubmissionsLoaderArgs),
		);
		expect(list.submissions[0]?.participation?.id).toBe("p_moderator");

		const response = await detailAction({
			context: CONTEXT,
			request: await updateRequest({
				intent: "confirm-participation",
				participantId: "p_moderator",
			}),
			params: detailParams,
		} as unknown as ActionArgs);
		expect(actionBody<{ ok?: boolean }>(response).ok).toBe(true);

		const acceptance = await db
			.select({
				role: participants.role,
				status: participants.acceptanceStatus,
			})
			.from(participants)
			.where(eq(participants.contactId, "c_priya"));
		expect(acceptance.sort((a, b) => a.role.localeCompare(b.role))).toEqual([
			{ role: "moderator", status: "accepted" },
			{ role: "secondary", status: "declined" },
			{ role: "speaker", status: "accepted" },
		]);
	});

	it("gives a secondary-only link ownership without an acceptance control", async () => {
		await seedEditableSubmission(FUTURE);
		const db = getDb(env);
		await db.batch([
			db
				.update(submissions)
				.set({ status: "accepted" })
				.where(eq(submissions.id, "s1")),
			db
				.update(participants)
				.set({ role: "secondary", isPrimary: false })
				.where(eq(participants.id, "p_me")),
		]);

		const detail = await loadDetail();
		expect(detail.myParticipation).toBeNull();
		const list = unwrap<{
			submissions: Array<{ participation: unknown }>;
		}>(
			await submissionsLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/submissions`),
				params: PORTAL_PARAMS,
			} as unknown as SubmissionsLoaderArgs),
		);
		expect(list.submissions[0]?.participation).toBeNull();
	});
});
