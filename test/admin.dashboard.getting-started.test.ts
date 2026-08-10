import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	formats,
	forms,
	organizationMembers,
	organizations,
	reviewerTracks,
	submissions,
	tracks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin._index";
import {
	authedRequest,
	CONTEXT,
	postForm,
	seedTasksBaseline,
} from "./tasks-fixtures";

// The checklist's contract: every step's done-state is read from live rows at
// load time (spec: derived, never stored), the dismissal cookie is scoped to
// exactly one user+event, and the CFP link is the soonest-closing OPEN form.

type LoaderReturn = Awaited<ReturnType<typeof loader>>;
type FullData = Extract<LoaderReturn, { data: unknown }>["data"];

async function runLoader(request: Request): Promise<FullData> {
	const result = await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
	if (!("data" in result) || result.data.event === null) {
		throw new Error("expected an active event on the dashboard");
	}
	return result.data;
}

function runAction(request: Request): Promise<Response> {
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]) as Promise<Response>;
}

function stepDone(data: FullData, id: string): boolean | undefined {
	return data.gettingStarted.steps.find((s) => s.id === id)?.done;
}

/** An admin + empty event in their own org — the post-onboarding state. */
async function freshOrgAdmin(tag: string) {
	const db = getDb(env);
	const orgId = `org_${tag}`;
	const eventId = `e_${tag}`;
	const userId = `u_${tag}`;
	await db.insert(organizations).values({ id: orgId, name: `Org ${tag}` });
	await db.insert(events).values({
		id: eventId,
		organizationId: orgId,
		name: `Conf ${tag}`,
		slug: `conf-${tag}`,
	});
	await db.insert(users).values({
		id: userId,
		email: `${userId}@test.co`,
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: eventId,
	});
	await db.insert(organizationMembers).values({
		id: `om_${userId}`,
		organizationId: orgId,
		userId,
	});
	const setCookie = await createSession(env, userId);
	const sessionCookie = setCookie.split(";")[0] ?? "";
	return { db, orgId, eventId, userId, sessionCookie };
}

function getRequest(cookies: string[]): Request {
	return new Request("http://localhost/admin", {
		headers: { Cookie: cookies.join("; ") },
	});
}

describe("getting-started derivation from live rows", () => {
	it("a brand-new event has nothing done and starts at basics", async () => {
		const { sessionCookie } = await freshOrgAdmin("fresh");
		const data = await runLoader(getRequest([sessionCookie]));

		expect(data.gettingStarted.steps.map((s) => s.done)).toEqual([
			false,
			false,
			false,
			false,
			false,
		]);
		expect(data.gettingStarted.activeStepId).toBe("basics");
		expect(data.gettingStarted.complete).toBe(false);
		expect(data.gettingStarted.dismissed).toBe(false);
		expect(data.gettingStarted.cfpUrl).toBeNull();
	});

	it("a fully configured event checks every step off", async () => {
		const db = await seedTasksBaseline(); // e1 already has 3 real submissions
		await db
			.update(events)
			.set({
				startsAt: new Date("2027-03-01T00:00:00Z"),
				endsAt: new Date("2027-03-03T00:00:00Z"),
				location: "Lisbon, Portugal",
			})
			.where(eq(events.id, "e1"));
		await db.insert(tracks).values({ id: "t1", eventId: "e1", name: "AI" });
		await db.insert(formats).values({ id: "fm1", eventId: "e1", name: "Talk" });
		await db.insert(forms).values({
			id: "f1",
			eventId: "e1",
			publicId: "pub-cfp",
			internalName: "CFP",
			status: "open",
			closeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		});
		await db.insert(users).values({
			id: "u_rev",
			email: "rev@test.co",
			passwordHash: await hashPassword("pw"),
			role: "reviewer",
		});
		await db.insert(reviewerTracks).values({ userId: "u_rev", trackId: "t1" });

		const data = await runLoader(await authedRequest("http://localhost/admin"));
		expect(data.gettingStarted.complete).toBe(true);
		expect(data.gettingStarted.doneCount).toBe(5);
		expect(data.gettingStarted.activeStepId).toBeNull();
		expect(data.gettingStarted.cfpUrl).toBe(
			"http://localhost/submit/democonf/pub-cfp",
		);
	});

	it("draft forms and draft submissions satisfy nothing", async () => {
		const { db, eventId, sessionCookie } = await freshOrgAdmin("drafts");
		await db.insert(forms).values({
			id: "f_draft",
			eventId,
			internalName: "Unpublished",
			status: "draft",
		});
		await db.insert(submissions).values({
			id: "s_only_draft",
			eventId,
			title: "Half-written idea",
			status: "draft",
		});
		const data = await runLoader(getRequest([sessionCookie]));

		expect(stepDone(data, "cfp")).toBe(false);
		expect(stepDone(data, "first_submission")).toBe(false);
		expect(data.gettingStarted.cfpUrl).toBeNull();
	});

	it("a closed form counts as published but yields no share link", async () => {
		const { db, eventId, sessionCookie } = await freshOrgAdmin("closed");
		await db.insert(forms).values({
			id: "f_closed",
			eventId,
			publicId: "pub-closed",
			internalName: "Last year's CFP",
			status: "closed",
			closeAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
		});
		const data = await runLoader(getRequest([sessionCookie]));

		expect(stepDone(data, "cfp")).toBe(true);
		expect(data.gettingStarted.cfpUrl).toBeNull();
	});

	it("the share link is the soonest-closing open form", async () => {
		const { db, eventId, sessionCookie } = await freshOrgAdmin("linkpick");
		const day = 24 * 60 * 60 * 1000;
		await db.insert(forms).values([
			{
				id: "f_far",
				eventId,
				publicId: "pub-far",
				internalName: "Late CFP",
				status: "open",
				closeAt: new Date(Date.now() + 30 * day),
			},
			{
				id: "f_soon",
				eventId,
				publicId: "pub-soon",
				internalName: "Early CFP",
				status: "open",
				closeAt: new Date(Date.now() + 3 * day),
			},
		]);
		const data = await runLoader(getRequest([sessionCookie]));

		expect(data.gettingStarted.cfpUrl).toBe(
			`http://localhost/submit/conf-linkpick/pub-soon`,
		);
	});

	it("another event's tracks and reviewers never leak in", async () => {
		await seedTasksBaseline();
		const db = getDb(env);
		// e1 gets a track+format+reviewer; the fresh event must not see them.
		await db.insert(tracks).values({ id: "t_e1", eventId: "e1", name: "AI" });
		await db
			.insert(formats)
			.values({ id: "fm_e1", eventId: "e1", name: "Talk" });
		await db.insert(users).values({
			id: "u_rev2",
			email: "rev2@test.co",
			passwordHash: await hashPassword("pw"),
			role: "reviewer",
		});
		await db
			.insert(reviewerTracks)
			.values({ userId: "u_rev2", trackId: "t_e1" });

		const { sessionCookie } = await freshOrgAdmin("scoped");
		const data = await runLoader(getRequest([sessionCookie]));
		expect(stepDone(data, "program")).toBe(false);
		expect(stepDone(data, "reviewers")).toBe(false);
	});
});

describe("getting-started dismissal", () => {
	it("dismiss → hidden for that admin+event; a teammate still sees it", async () => {
		const { sessionCookie, userId } = await freshOrgAdmin("dismiss");
		const post = new Request("http://localhost/admin", {
			...postForm("http://localhost/admin", {
				intent: "dismiss-getting-started",
			}),
			headers: {
				Cookie: sessionCookie,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		});
		const response = await runAction(post);
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin");
		const setCookie = response.headers.get("Set-Cookie") ?? "";
		expect(setCookie).toContain("or_gs_dismissed=");
		expect(setCookie).toContain(userId);

		const gsCookie = setCookie.split(";")[0] ?? "";
		const again = await runLoader(getRequest([sessionCookie, gsCookie]));
		expect(again.gettingStarted.dismissed).toBe(true);

		// A second admin of the SAME org+event carrying the same browser cookie
		// (shared machine) still gets the checklist — dismissal is per user.
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_teammate",
			email: "teammate@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
			activeEventId: "e_dismiss",
		});
		await db.insert(organizationMembers).values({
			id: "om_teammate",
			organizationId: "org_dismiss",
			userId: "u_teammate",
		});
		const teammateSession = (await createSession(env, "u_teammate")).split(
			";",
		)[0];
		const teammate = await runLoader(
			getRequest([teammateSession ?? "", gsCookie]),
		);
		expect(teammate.gettingStarted.dismissed).toBe(false);
	});

	it("an unrelated POST intent redirects without touching the cookie", async () => {
		const { sessionCookie } = await freshOrgAdmin("nointent");
		const post = new Request("http://localhost/admin", {
			...postForm("http://localhost/admin", { intent: "something-else" }),
			headers: {
				Cookie: sessionCookie,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		});
		const response = await runAction(post);
		expect(response.status).toBe(302);
		expect(response.headers.get("Set-Cookie")).toBeNull();
	});
});
