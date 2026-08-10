import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	forms,
	participants,
	submissionRevisions,
	submissions,
} from "../app/db/schema";
import { action as detailAction } from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import {
	authedRequest,
	BASE,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
} from "./portal.helpers";

type ActionArgs = Parameters<typeof detailAction>[0];

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

async function seedEditableSubmission(closeAt: Date) {
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
		roleSpeakerMin: 1,
		roleSpeakerMax: 3,
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
	await db
		.insert(participants)
		.values({ id: "p_me", submissionId: "s1", contactId: "c_priya" });
}

function updateRequest(body: Record<string, string>) {
	return authedRequest("u_priya", `${BASE}/submissions/s1`, {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

const detailParams = { ...PORTAL_PARAMS, submissionId: "s1" };

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

	it("adds a co-speaker (reusing an existing contact by email) and blocks a duplicate add", async () => {
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
});
