import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { participants, submissions } from "../app/db/schema";
import { action as detailAction } from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
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

/** Panel with two speakers: Priya (u_priya/c_priya/p_priya) + Dana (…/p_dana). */
async function seedPanel(status: "accepted" | "pending") {
	await seedPortalWorld();
	const db = getDb(env);
	await makeUser("u_priya", "priya@example.com");
	await makeUser("u_dana", "dana@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
	await makeContact("c_dana", "e1", "dana@example.com", "u_dana", "Dana", "O");
	await db.insert(submissions).values({
		id: "s_panel",
		eventId: "e1",
		title: "Practitioners Panel",
		status,
	});
	await db.insert(participants).values([
		{ id: "p_priya", submissionId: "s_panel", contactId: "c_priya" },
		{ id: "p_dana", submissionId: "s_panel", contactId: "c_dana" },
	]);
}

function act(userId: string, body: Record<string, string>) {
	return authedRequest(userId, `${BASE}/submissions/s_panel`, {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

const params = { ...PORTAL_PARAMS, submissionId: "s_panel" };

async function acceptance(id: string) {
	const db = getDb(env);
	const [row] = await db
		.select({ acceptance: participants.acceptanceStatus })
		.from(participants)
		.where(eq(participants.id, id));
	return row?.acceptance;
}

describe("per-participant acceptance", () => {
	it("keeps two co-speakers' confirmations independent: one confirms, one withdraws", async () => {
		await seedPanel("accepted");

		const confirm = unwrap<{ ok?: boolean }>(
			await detailAction({
				context: CONTEXT,
				request: await act("u_priya", {
					intent: "confirm-participation",
					participantId: "p_priya",
				}),
				params,
			} as unknown as ActionArgs),
		);
		expect(confirm.ok).toBe(true);

		const withdraw = unwrap<{ ok?: boolean }>(
			await detailAction({
				context: CONTEXT,
				request: await act("u_dana", {
					intent: "withdraw-participation",
					participantId: "p_dana",
				}),
				params,
			} as unknown as ActionArgs),
		);
		expect(withdraw.ok).toBe(true);

		expect(await acceptance("p_priya")).toBe("accepted");
		expect(await acceptance("p_dana")).toBe("declined");
	});

	it("refuses confirmation on a session that is not Accepted (queue/pending stay untouchable)", async () => {
		await seedPanel("pending");
		const result = (await detailAction({
			context: CONTEXT,
			request: await act("u_priya", {
				intent: "confirm-participation",
				participantId: "p_priya",
			}),
			params,
		} as unknown as ActionArgs)) as { formError?: string };
		expect(result.formError).toMatch(/accepted/i);
		expect(await acceptance("p_priya")).toBe("pending");
	});

	it("404s a forged participantId targeting the co-speaker's row — no write happens", async () => {
		await seedPanel("accepted");
		const thrown = await catchThrown(async () =>
			detailAction({
				context: CONTEXT,
				request: await act("u_priya", {
					intent: "withdraw-participation",
					participantId: "p_dana", // Dana's row, Priya's session
				}),
				params,
			} as unknown as ActionArgs),
		);
		expect(thrownStatus(thrown)).toBe(404);
		expect(await acceptance("p_dana")).toBe("pending");
	});
});
