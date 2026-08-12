import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	crmNotes,
	pipelineCards,
	pipelineStageChanges,
} from "../app/db/schema";
import {
	action as boardAction,
	loader as boardLoader,
} from "../app/routes/admin.crm.pipeline";
import CardDetail, {
	action as cardAction,
	loader as cardLoader,
} from "../app/routes/admin.crm.pipeline_.$cardId";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";
import { catchThrown, thrownStatus } from "./thrown";

async function runBoardAction(userId: string, body: URLSearchParams) {
	const request = await requestAs(
		userId,
		"http://localhost/admin/crm/pipeline",
		{
			method: "POST",
			body,
		},
	);
	return boardAction({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof boardAction>[0]);
}

async function runCardAction(
	userId: string,
	cardId: string,
	body: URLSearchParams,
) {
	const request = await requestAs(
		userId,
		`http://localhost/admin/crm/pipeline/${cardId}`,
		{ method: "POST", body },
	);
	return cardAction({
		context: CONTEXT,
		request,
		params: { cardId },
	} as unknown as Parameters<typeof cardAction>[0]);
}

async function enrollMarcus(userId = "u_admin1"): Promise<string> {
	const db = getDb(env);
	await runBoardAction(
		userId,
		new URLSearchParams({
			intent: "enroll",
			email: "marcus@example.com",
			stage: "identified",
			score: "85",
			rationale: "Strong platform-engineering track record.",
		}),
	);
	const [card] = await db.select().from(pipelineCards);
	if (!card) throw new Error("enroll did not create a card");
	return card.id;
}

describe("CRM card timestamps", () => {
	// 7pm in the event's zone (America/Los_Angeles, the schema default) is
	// already tomorrow in UTC — so a stamp read as UTC names the wrong day AND
	// the wrong hour to the organizer who wrote it.
	const EVENING = new Date("2026-10-13T02:00:00.000Z");
	const EVENT_LABEL = "Oct 12, 2026, 7:00 PM PDT";
	const UTC_LABEL = "Oct 13, 2026, 2:00 AM UTC";

	async function renderCardWithStampsAt(cardId: string) {
		const db = getDb(env);
		await db.update(pipelineStageChanges).set({ createdAt: EVENING });
		await db.update(crmNotes).set({ createdAt: EVENING });
		const request = await requestAs(
			"u_admin1",
			`http://localhost/admin/crm/pipeline/${cardId}`,
		);
		const result = (await cardLoader({
			context: CONTEXT,
			request,
			params: { cardId },
		} as unknown as Parameters<typeof cardLoader>[0])) as unknown as {
			data: unknown;
		};
		const RoutesStub = createRoutesStub([
			{
				path: "/",
				Component: () =>
					createElement(CardDetail as ElementType, {
						loaderData: result.data,
						actionData: undefined,
					}),
			},
		]);
		return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
	}

	it("stamps stage history and notes in the event's zone, not the worker's", async () => {
		await seedCrmBaseline();
		const cardId = await enrollMarcus();
		await runCardAction(
			"u_admin1",
			cardId,
			new URLSearchParams({
				intent: "add-note",
				body: "Called after the evening keynote.",
			}),
		);

		const html = await renderCardWithStampsAt(cardId);
		expect(html).toContain(EVENT_LABEL);
		expect(html).not.toContain(UTC_LABEL);
		// Both surfaces on this page, not just the one that happens to be first.
		expect(html.split(EVENT_LABEL)).toHaveLength(3);
	});
});

describe("CRM pipeline", () => {
	it("enrolls a directory contact with an identity snapshot and an enrollment history row", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const cardId = await enrollMarcus();

		const [card] = await db.select().from(pipelineCards);
		expect(card?.organizationId).toBe("org1");
		expect(card?.firstName).toBe("Marcus");
		expect(card?.companyName).toBe("BuildScale");
		expect(card?.stage).toBe("identified");
		expect(card?.score).toBe(85);

		const history = await db
			.select()
			.from(pipelineStageChanges)
			.where(eq(pipelineStageChanges.cardId, cardId));
		expect(history).toHaveLength(1);
		expect(history[0]?.fromStage).toBeNull();
		expect(history[0]?.toStage).toBe("identified");
		expect(history[0]?.changedByName).toBe("Org One Admin");
	});

	it("refuses enrolling an email outside the org, and double-enrolling", async () => {
		await seedCrmBaseline();
		const db = getDb(env);

		// zara only exists in org2 — org1's admin cannot enroll her.
		const foreign = (await runBoardAction(
			"u_admin1",
			new URLSearchParams({
				intent: "enroll",
				email: "zara@rival.com",
				stage: "identified",
			}),
		)) as { data?: { fieldErrors?: { email?: string[] } } };
		expect(foreign.data?.fieldErrors?.email?.[0]).toMatch(/no contact/i);
		expect(await db.select().from(pipelineCards)).toHaveLength(0);

		await enrollMarcus();
		const again = (await runBoardAction(
			"u_admin1",
			new URLSearchParams({
				intent: "enroll",
				email: "marcus@example.com",
				stage: "contacted",
			}),
		)) as { data?: { fieldErrors?: { email?: string[] } } };
		expect(again.data?.fieldErrors?.email?.[0]).toMatch(
			/already in the pipeline/i,
		);
		expect(await db.select().from(pipelineCards)).toHaveLength(1);
	});

	it("moves a card between stages, appending each transition to the history", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const cardId = await enrollMarcus();

		await runBoardAction(
			"u_admin1",
			new URLSearchParams({ intent: "move", cardId, stage: "contacted" }),
		);
		await runBoardAction(
			"u_admin1",
			new URLSearchParams({ intent: "move", cardId, stage: "interested" }),
		);

		const [card] = await db.select().from(pipelineCards);
		expect(card?.stage).toBe("interested");
		const history = await db
			.select()
			.from(pipelineStageChanges)
			.where(eq(pipelineStageChanges.cardId, cardId))
			.orderBy(pipelineStageChanges.createdAt);
		expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([
			[null, "identified"],
			["identified", "contacted"],
			["contacted", "interested"],
		]);
	});

	it("never lets another org see or move a card", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const cardId = await enrollMarcus();

		// org2's admin cannot move org1's card…
		const move = (await runBoardAction(
			"u_admin2",
			new URLSearchParams({ intent: "move", cardId, stage: "declined" }),
		)) as { formError?: string };
		expect(move.formError).toMatch(/not in your pipeline/i);
		const [card] = await db.select().from(pipelineCards);
		expect(card?.stage).toBe("identified"); // …and the stage did not change.

		// …and cannot open its detail.
		const request = await requestAs(
			"u_admin2",
			`http://localhost/admin/crm/pipeline/${cardId}`,
		);
		const thrown = await catchThrown(() =>
			cardLoader({
				context: CONTEXT,
				request,
				params: { cardId },
			} as unknown as Parameters<typeof cardLoader>[0]),
		);
		expect(thrownStatus(thrown)).toBe(404);

		// org2's own board shows nothing.
		const boardRequest = await requestAs(
			"u_admin2",
			"http://localhost/admin/crm/pipeline",
		);
		const board = (await boardLoader({
			context: CONTEXT,
			request: boardRequest,
			params: {},
		} as unknown as Parameters<typeof boardLoader>[0])) as unknown as {
			data: { total: number };
		};
		expect(board.data.total).toBe(0);
	});

	it("removing a card keeps the person's notes", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const cardId = await enrollMarcus();

		await runCardAction(
			"u_admin1",
			cardId,
			new URLSearchParams({
				intent: "add-note",
				body: "Left voicemail; follow up next week.",
			}),
		);
		const removed = (await runCardAction(
			"u_admin1",
			cardId,
			new URLSearchParams({ intent: "remove" }),
		)) as Response;
		expect(removed.status).toBe(302);

		expect(await db.select().from(pipelineCards)).toHaveLength(0);
		const notes = await db.select().from(crmNotes);
		expect(notes).toHaveLength(1);
		expect(notes[0]?.email).toBe("marcus@example.com");
		expect(notes[0]?.body).toBe("Left voicemail; follow up next week.");
	});
});
