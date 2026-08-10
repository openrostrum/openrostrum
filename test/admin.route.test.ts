import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/admin";

// The admin shell feeds the sidebar event switcher. Its listing is a tenancy
// surface (docs/multi-tenancy-design.md: "the event switcher lists only your
// orgs' events") and its current-event mark is what tells an admin which
// event every admin screen is scoped to.

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seed(activeEventId: string | null): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(users).values({
		id: "u_a",
		email: "a@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: null,
	});
	await db
		.insert(organizationMembers)
		.values({ id: "om_a", organizationId: "org_a", userId: "u_a" });
	await db.insert(events).values([
		{
			id: "e_a1",
			organizationId: "org_a",
			name: "A1",
			slug: "a1",
			type: "Conference",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			id: "e_a2",
			organizationId: "org_a",
			name: "A2",
			slug: "a2",
			type: "Meetup",
			startsAt: new Date("2026-10-12T00:00:00Z"),
			endsAt: new Date("2026-10-14T00:00:00Z"),
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
		{ id: "e_b1", organizationId: "org_b", name: "B1", slug: "b1" },
	]);
	if (activeEventId) {
		await db.update(users).set({ activeEventId }).where(eq(users.id, "u_a"));
	}
}

async function runLoader(userId?: string) {
	const headers = new Headers();
	if (userId) {
		const setCookie = await createSession(env, userId);
		headers.set("Cookie", setCookie.split(";")[0] ?? "");
	}
	const request = new Request("http://localhost/admin", { headers });
	return loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
}

describe("admin shell loader (event switcher data)", () => {
	it("lists ONLY my orgs' events, oldest first, with the sticky active event marked current", async () => {
		await seed("e_a2");
		const result = await runLoader("u_a");
		expect(result.events.map((e) => e.id)).toEqual(["e_a1", "e_a2"]);
		expect(result.events.filter((e) => e.isCurrent).map((e) => e.id)).toEqual([
			"e_a2",
		]);
	});

	it("renders each entry's dates as a UTC calendar range, falling back to the event type", async () => {
		await seed("e_a2");
		const result = await runLoader("u_a");
		const [a1, a2] = result.events;
		// No dates set → the menu's second line falls back to the type.
		expect(a1).toMatchObject({ dates: null, type: "Conference" });
		// UTC rendering — an event-timezone render could shift the calendar date.
		expect(a2?.dates).toBe("Oct 12, 2026 – Oct 14, 2026");
	});

	it("falls back to my oldest event when activeEventId is null and marks it current", async () => {
		await seed(null);
		const result = await runLoader("u_a");
		expect(result.events.filter((e) => e.isCurrent).map((e) => e.id)).toEqual([
			"e_a1",
		]);
	});

	it("serves the shell with an empty listing (no current mark) for a membership-less admin", async () => {
		await seed(null);
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_lone",
			email: "lone@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		const result = await runLoader("u_lone");
		expect(result.events).toEqual([]);
	});
});
