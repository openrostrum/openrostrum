import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events, forms, organizations } from "../app/db/schema";
import { loader } from "../app/routes/cfp";

// `/cfp` is the homepage's stable "Call for speakers" URL: it must land on
// the default event's oldest OPEN submission form and never dead-end (no
// open form → homepage, not a 404).

type LoaderArgs = Parameters<typeof loader>[0];
const CONTEXT = { cloudflare: { env, ctx: {} } };

function call() {
	return loader({
		context: CONTEXT,
		request: new Request("http://localhost/cfp"),
		params: {},
	} as unknown as LoaderArgs);
}

async function seedEvent() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(events)
		.values({ id: "e1", organizationId: "org1", name: "Conf", slug: "conf" });
	return db;
}

describe("/cfp alias", () => {
	it("redirects to the default event's oldest open form", async () => {
		const db = await seedEvent();
		await db.insert(forms).values([
			{
				id: "f_closed",
				eventId: "e1",
				publicId: "closed-uuid",
				internalName: "Closed",
				status: "closed",
				createdAt: new Date("2026-01-01"),
			},
			{
				id: "f_open",
				eventId: "e1",
				publicId: "open-uuid",
				internalName: "Open",
				status: "open",
				createdAt: new Date("2026-02-01"),
			},
			{
				id: "f_open_later",
				eventId: "e1",
				publicId: "later-uuid",
				internalName: "Open later",
				status: "open",
				createdAt: new Date("2026-03-01"),
			},
		]);
		const res = await call();
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/submit/conf/open-uuid");
	});

	it("falls back to the homepage when nothing is open (and when no event exists)", async () => {
		const db = await seedEvent();
		await db.insert(forms).values({
			id: "f_draft",
			eventId: "e1",
			publicId: "draft-uuid",
			internalName: "Draft",
			status: "draft",
		});
		const res = await call();
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/");
	});
});
