import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { participants, submissions } from "../app/db/schema";
import { loader as detailLoader } from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import { loader as listLoader } from "../app/routes/portals.$eventSlug.$portalId.submissions";
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

async function seedSpeakerWithStatuses() {
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
	await db.insert(submissions).values([
		{
			id: "s_aq",
			eventId: "e1",
			title: "Staged accept",
			status: "accept_queue",
		},
		{
			id: "s_dq",
			eventId: "e1",
			title: "Staged decline",
			status: "decline_queue",
		},
		{ id: "s_acc", eventId: "e1", title: "Accepted talk", status: "accepted" },
		{ id: "s_dec", eventId: "e1", title: "Declined talk", status: "declined" },
	]);
	await db.insert(participants).values([
		{ id: "p1", submissionId: "s_aq", contactId: "c_priya" },
		{ id: "p2", submissionId: "s_dq", contactId: "c_priya" },
		{ id: "p3", submissionId: "s_acc", contactId: "c_priya" },
		{ id: "p4", submissionId: "s_dec", contactId: "c_priya" },
	]);
}

type ListArgs = Parameters<typeof listLoader>[0];
type DetailArgs = Parameters<typeof detailLoader>[0];

describe("portal status masking (server-side)", () => {
	it("renders BOTH queue statuses as Pending and ships no queue token in the payload", async () => {
		await seedSpeakerWithStatuses();
		const result = await listLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/submissions`),
			params: PORTAL_PARAMS,
		} as unknown as ListArgs);
		const data = unwrap<{
			submissions: Array<{ id: string; status: { label: string } }>;
		}>(result);

		const byId = new Map(data.submissions.map((s) => [s.id, s.status.label]));
		expect(byId.get("s_aq")).toBe("Pending");
		expect(byId.get("s_dq")).toBe("Pending");
		expect(byId.get("s_acc")).toBe("Accepted");
		expect(byId.get("s_dec")).toBe("Declined");
		// The raw enum must never serialize to the portal client.
		expect(JSON.stringify(data)).not.toMatch(/queue/i);
	});

	it("masks the queue status on the detail view too", async () => {
		await seedSpeakerWithStatuses();
		const result = await detailLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/submissions/s_dq`),
			params: { ...PORTAL_PARAMS, submissionId: "s_dq" },
		} as unknown as DetailArgs);
		const data = unwrap<{ status: { label: string } }>(result);
		expect(data.status.label).toBe("Pending");
		expect(JSON.stringify(data)).not.toMatch(/queue/i);
	});
});

describe("portal submission scoping", () => {
	it("lists exactly my participant-linked rows plus my own drafts — never a stranger's", async () => {
		await seedSpeakerWithStatuses();
		const db = getDb(env);
		// A draft Priya saved before the participant step — no participants row.
		await db.insert(submissions).values({
			id: "s_draft",
			eventId: "e1",
			title: "My early draft",
			status: "draft",
			submitterId: "u_priya",
		});
		// Someone else's submission in the same event.
		await makeUser("u_other", "other@example.com");
		await makeContact("c_other", "e1", "other@example.com", "u_other");
		await db.insert(submissions).values({
			id: "s_foreign",
			eventId: "e1",
			title: "Foreign talk",
			status: "pending",
			submitterId: "u_other",
		});
		await db
			.insert(participants)
			.values({ id: "p_f", submissionId: "s_foreign", contactId: "c_other" });

		const result = await listLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/submissions`),
			params: PORTAL_PARAMS,
		} as unknown as ListArgs);
		const data = unwrap<{ submissions: Array<{ id: string }> }>(result);
		const ids = data.submissions.map((s) => s.id);

		expect(ids).toContain("s_draft");
		expect(ids).toHaveLength(5); // 4 participant links + 1 draft
		expect(JSON.stringify(data)).not.toContain("Foreign talk");
	});

	it("404s a direct detail URL for someone else's submission, with no data in the throw", async () => {
		await seedSpeakerWithStatuses();
		await makeUser("u_dana", "dana@example.com");
		await makeContact("c_dana", "e1", "dana@example.com", "u_dana");

		const thrown = await catchThrown(async () =>
			detailLoader({
				context: CONTEXT,
				request: await authedRequest("u_dana", `${BASE}/submissions/s_acc`),
				params: { ...PORTAL_PARAMS, submissionId: "s_acc" },
			} as unknown as DetailArgs),
		);
		expect(thrownStatus(thrown)).toBe(404);
		expect(JSON.stringify(thrown)).not.toContain("Accepted talk");
	});
});
