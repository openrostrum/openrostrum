import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	reviewerTracks,
	tracks,
	users,
} from "../app/db/schema";
import {
	getActiveEvent,
	getReviewerEventIds,
	listMyEvents,
	userCanAccessEvent,
} from "../app/lib/auth";

// Tenancy contract for event resolution (docs/multi-tenancy-design.md
// §Authorization): access = event → org → member. The any-event fallback was
// the hole this closes — a user must NEVER resolve to an event of an org they
// don't belong to, and a membership-less user resolves to null (not a 500,
// not someone else's event).

async function seedTwoOrgs(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(users).values({
		id: "u_a",
		email: "a@test.co",
		passwordHash: "x",
		role: "admin",
	});
	await db
		.insert(organizationMembers)
		.values({ id: "om_a", organizationId: "org_a", userId: "u_a" });
	// org B's event is OLDER than org A's — a naive "first event in the
	// database" fallback would pick org B's and fail the tests below.
	await db.insert(events).values([
		{
			id: "e_b1",
			organizationId: "org_b",
			name: "Foreign Conf",
			slug: "foreign-conf",
			createdAt: new Date(1_000_000),
		},
		{
			id: "e_a1",
			organizationId: "org_a",
			name: "My Conf",
			slug: "my-conf",
			createdAt: new Date(2_000_000),
		},
		{
			id: "e_a2",
			organizationId: "org_a",
			name: "My Later Conf",
			slug: "my-later-conf",
			createdAt: new Date(3_000_000),
		},
	]);
}

async function findUser(id: string) {
	const db = getDb(env);
	const user = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, id),
	});
	if (!user) throw new Error(`test user ${id} missing`);
	return user;
}

describe("getActiveEvent (membership-aware)", () => {
	it("falls back to the first event of MY orgs when activeEventId is null — never another org's", async () => {
		await seedTwoOrgs();
		const event = await getActiveEvent(env, await findUser("u_a"));
		expect(event?.id).toBe("e_a1");
	});

	it("returns null for a membership-less user even when events exist (reviewers hold no membership)", async () => {
		await seedTwoOrgs();
		await getDb(env).insert(users).values({
			id: "u_rev",
			email: "rev@test.co",
			passwordHash: "x",
			role: "reviewer",
		});
		expect(await getActiveEvent(env, await findUser("u_rev"))).toBeNull();
	});

	it("ignores an activeEventId pointing at another org's event and falls back to my orgs", async () => {
		await seedTwoOrgs();
		const forged = { ...(await findUser("u_a")), activeEventId: "e_b1" };
		expect((await getActiveEvent(env, forged))?.id).toBe("e_a1");
	});

	it("honors a sticky activeEventId the user is entitled to", async () => {
		await seedTwoOrgs();
		const sticky = { ...(await findUser("u_a")), activeEventId: "e_a2" };
		expect((await getActiveEvent(env, sticky))?.id).toBe("e_a2");
	});

	it("returns null for a member of an org with zero events", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_c", name: "Org C" });
		await db.insert(users).values({
			id: "u_c",
			email: "c@test.co",
			passwordHash: "x",
			role: "admin",
		});
		await db
			.insert(organizationMembers)
			.values({ id: "om_c", organizationId: "org_c", userId: "u_c" });
		expect(await getActiveEvent(env, await findUser("u_c"))).toBeNull();
	});
});

describe("listMyEvents (event-switcher listing)", () => {
	it("lists only the user's orgs' events, oldest first — org B's never appear", async () => {
		await seedTwoOrgs();
		const listed = await listMyEvents(env, "u_a");
		expect(listed.map((e) => e.id)).toEqual(["e_a1", "e_a2"]);
	});

	it("is empty for a membership-less user", async () => {
		await seedTwoOrgs();
		await getDb(env).insert(users).values({
			id: "u_rev",
			email: "rev@test.co",
			passwordHash: "x",
			role: "reviewer",
		});
		expect(await listMyEvents(env, "u_rev")).toEqual([]);
	});
});

describe("userCanAccessEvent (row-level membership guard)", () => {
	it("allows own-org events and denies another org's and unknown ids", async () => {
		await seedTwoOrgs();
		expect(await userCanAccessEvent(env, "u_a", "e_a1")).toBe(true);
		expect(await userCanAccessEvent(env, "u_a", "e_b1")).toBe(false);
		expect(await userCanAccessEvent(env, "u_a", "e_nope")).toBe(false);
	});
});

describe("getReviewerEventIds (reviewer_tracks → tracks.event_id)", () => {
	it("derives the reviewer's events from track assignments only, deduplicated", async () => {
		await seedTwoOrgs();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_rev",
			email: "rev@test.co",
			passwordHash: "x",
			role: "reviewer",
		});
		await db.insert(tracks).values([
			{ id: "t_a1", eventId: "e_a1", name: "AI", color: "#000000" },
			{ id: "t_a2", eventId: "e_a1", name: "Web", color: "#000000" },
			{ id: "t_b1", eventId: "e_b1", name: "Sec", color: "#000000" },
		]);
		// Two tracks in the same event → one event id; e_b1's track is unassigned.
		await db.insert(reviewerTracks).values([
			{ userId: "u_rev", trackId: "t_a1" },
			{ userId: "u_rev", trackId: "t_a2" },
		]);
		expect(await getReviewerEventIds(env, "u_rev")).toEqual(["e_a1"]);
	});

	it("is empty for a reviewer with no track assignments", async () => {
		await seedTwoOrgs();
		await getDb(env).insert(users).values({
			id: "u_rev",
			email: "rev@test.co",
			passwordHash: "x",
			role: "reviewer",
		});
		expect(await getReviewerEventIds(env, "u_rev")).toEqual([]);
	});
});
