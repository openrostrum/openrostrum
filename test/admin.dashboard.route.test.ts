import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	forms,
	organizationMembers,
	organizations,
	participants,
	submissions,
	taskAssignments,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { DAY_MS, zonedCalendarDate } from "../app/lib/event-time";
import { loader } from "../app/routes/admin._index";
import { authedRequest, CONTEXT, seedTasksBaseline } from "./tasks-fixtures";

// The dashboard's numbers must equal an independent aggregation of the
// fixture: 5 submitted (+1 draft), 2 accepted sessions carrying 2 distinct
// speakers, 1 accepted session unscheduled, 1 not content-approved, 1 speaker
// owing tasks, and exactly one form closing inside the 7-day window.

// Loader-derived types: the with-event branch returns `data(body, { headers })`,
// the no-event branch a plain object — typing from the real return value means
// a shape change here fails to compile instead of silently drifting.
type LoaderReturn = Awaited<ReturnType<typeof loader>>;
type FullData = Extract<LoaderReturn, { data: unknown }>["data"];
type NoEventData = Exclude<LoaderReturn, { data: unknown }>;

function unwrap(result: LoaderReturn): FullData | NoEventData {
	return "data" in result ? result.data : result;
}

async function runLoader(request: Request): Promise<FullData> {
	const result = unwrap(
		await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0]),
	);
	if (result.event === null) {
		throw new Error("expected an active event on the dashboard");
	}
	return result;
}

async function runLoaderNoEvent(request: Request): Promise<NoEventData> {
	const result = unwrap(
		await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0]),
	);
	if (result.event !== null) throw new Error("expected the no-event shape");
	return result;
}

/** Noon UTC `n` calendar days after today in the event zone (the seeded event
 * has no timezone set, so the column default America/Los_Angeles applies) —
 * pins closing-soon thresholds without midnight flakiness. */
function laDayPlus(n: number): Date {
	return new Date(
		zonedCalendarDate(new Date(), "America/Los_Angeles") +
			n * DAY_MS +
			12 * 60 * 60 * 1000,
	);
}

/** A moment `mins` minutes ago, on a whole second (D1 stores epoch seconds). */
function minutesAgo(mins: number): Date {
	return new Date(Math.floor(Date.now() / 1000) * 1000 - mins * 60_000);
}

/**
 * On top of the shared baseline (accepted s1=Priya, s2=Bob, pending s3=Carol):
 * three forms, a draft + declined + queued submission, s1 scheduled and
 * content-approved, Carol as a SECONDARY on s2, and one outstanding + one
 * complete task assignment.
 */
async function seedDashboard() {
	const db = await seedTasksBaseline();
	await db.insert(forms).values([
		{
			id: "f_open",
			eventId: "e1",
			internalName: "Session CFP",
			status: "open",
			closeAt: laDayPlus(3),
			submissionLimit: 3,
		},
		{
			id: "f_far",
			eventId: "e1",
			internalName: "Abstract CFP",
			status: "open",
			closeAt: laDayPlus(30),
		},
		{
			id: "f_closed",
			eventId: "e1",
			internalName: "Workshop CFP",
			status: "closed",
			closeAt: laDayPlus(-10),
		},
	]);
	await db.insert(submissions).values([
		{
			id: "s_draft",
			eventId: "e1",
			title: "Draft idea",
			status: "draft",
			formId: "f_open",
			createdAt: minutesAgo(5),
		},
		{
			id: "s_declined",
			eventId: "e1",
			title: "Not this year",
			status: "declined",
			formId: "f_open",
			createdAt: minutesAgo(20),
		},
		{
			id: "s_queue",
			eventId: "e1",
			title: "Queued talk",
			status: "accept_queue",
			formId: "f_far",
			createdAt: minutesAgo(10),
		},
	]);
	await db
		.update(submissions)
		.set({
			startsAt: new Date("2026-10-12T17:00:00Z"),
			contentStatus: "approved",
			createdAt: minutesAgo(50),
		})
		.where(eq(submissions.id, "s1"));
	await db
		.update(submissions)
		.set({ contentStatus: "in_review", createdAt: minutesAgo(40) })
		.where(eq(submissions.id, "s2"));
	await db
		.update(submissions)
		.set({ createdAt: minutesAgo(30) })
		.where(eq(submissions.id, "s3"));
	// A non-speaker role on an accepted session must NOT count as a speaker.
	await db.insert(participants).values({
		id: "p_secondary",
		submissionId: "s2",
		contactId: "c_carol",
		role: "secondary",
	});
	await db.insert(taskAssignments).values([
		{
			id: "ta_priya",
			taskId: "t_hotel",
			contactId: "c_priya",
			status: "incomplete",
		},
		{
			id: "ta_bob",
			taskId: "t_hotel",
			contactId: "c_bob",
			status: "complete",
			completedAt: new Date(),
		},
	]);
	return db;
}

/** An admin whose membership (and active event) live in another org — the
 * shared fixture helper hardcodes org1, so tenancy tests build their own. */
async function authedForOrg(orgId: string, activeEventId: string | null) {
	const db = getDb(env);
	const id = `u_${orgId}_${crypto.randomUUID().slice(0, 8)}`;
	await db.insert(users).values({
		id,
		email: `${id}@test.co`,
		passwordHash: await hashPassword("pw"),
		name: "Orga Nizer",
		role: "admin",
		activeEventId,
	});
	await db.insert(organizationMembers).values({
		id: `om_${id}`,
		organizationId: orgId,
		userId: id,
	});
	const setCookie = await createSession(env, id);
	return new Request("http://localhost/admin", {
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
}

describe("dashboard aggregates", () => {
	it("matches an independent count of the seeded truth", async () => {
		await seedDashboard();
		const data = await runLoader(await authedRequest("http://localhost/admin"));

		expect(data.event?.name).toBe("DemoConf");
		expect(data.stats).toEqual({
			submissions: 5, // s1 s2 s3 s_declined s_queue — the draft is excluded
			drafts: 1,
			acceptedSpeakers: 2, // Priya + Bob; Carol is a secondary, not a speaker
			acceptedSessions: 2,
		});
		expect(data.statusCounts).toEqual({
			draft: 1,
			pending: 1,
			accept_queue: 1,
			accepted: 2,
			decline_queue: 0,
			declined: 1,
			withdrawn: 0,
		});
		expect(data.alerts.notPublic).toBe(1); // s2 is still in_review
		expect(data.alerts.unscheduled).toBe(1); // s2 has no time slot
		expect(data.alerts.outstandingSpeakers).toBe(1); // Priya
		expect(data.alerts.closingSoon).toMatchObject({
			count: 1,
			firstName: "Session CFP",
		});
	});

	it("lists recent submissions newest-first, drafts excluded, speakers by role", async () => {
		await seedDashboard();
		const data = await runLoader(await authedRequest("http://localhost/admin"));

		expect(data.recent.map((r) => r.id)).toEqual([
			"s_queue",
			"s_declined",
			"s3",
			"s2",
			"s1",
		]);
		const s2 = data.recent.find((r) => r.id === "s2");
		expect(s2?.speakers).toEqual(["Bob Jones"]); // Carol (secondary) hidden
		expect(s2?.formName).toBe("Manual"); // baseline rows have no source form
		expect(data.recent.find((r) => r.id === "s_queue")?.formName).toBe(
			"Abstract CFP",
		);
	});

	it("reports per-form submitted/draft counts and the per-submitter limit", async () => {
		await seedDashboard();
		const data = await runLoader(await authedRequest("http://localhost/admin"));

		const byId = new Map(data.forms.map((f) => [f.id, f]));
		expect(byId.get("f_open")).toMatchObject({
			state: "open",
			submitted: 1, // s_declined
			drafts: 1, // s_draft
			limit: 3,
		});
		expect(byId.get("f_far")).toMatchObject({
			state: "open",
			submitted: 1, // s_queue
			drafts: 0,
			limit: null, // no form or event level limit set
		});
		expect(byId.get("f_closed")).toMatchObject({
			state: "closed",
			submitted: 0,
			drafts: 0,
		});
		// Open forms sort ahead of closed ones, closest close date first.
		expect(data.forms.map((f) => f.id)).toEqual([
			"f_open",
			"f_far",
			"f_closed",
		]);
	});
});

describe("alert thresholds", () => {
	it("closing-soon includes day 7, excludes day 8, closed forms, and past-dated open forms", async () => {
		const db = await seedTasksBaseline();
		await db.insert(forms).values([
			{
				id: "f_b7",
				eventId: "e1",
				internalName: "Edge 7",
				status: "open",
				closeAt: laDayPlus(7),
			},
			{
				id: "f_b8",
				eventId: "e1",
				internalName: "Edge 8",
				status: "open",
				closeAt: laDayPlus(8),
			},
			{
				id: "f_closed_soon",
				eventId: "e1",
				internalName: "Closed soon",
				status: "closed",
				closeAt: laDayPlus(2),
			},
			{
				id: "f_stale_open",
				eventId: "e1",
				internalName: "Stale open",
				status: "open",
				closeAt: new Date(Date.now() - 60_000),
			},
		]);
		const data = await runLoader(await authedRequest("http://localhost/admin"));

		expect(data.alerts.closingSoon).toMatchObject({
			count: 1,
			firstName: "Edge 7",
			firstDays: 7,
		});
		// A stored-"open" form whose close date has passed renders as closed.
		expect(data.forms.find((f) => f.id === "f_stale_open")?.state).toBe(
			"closed",
		);
		expect(data.forms.find((f) => f.id === "f_b8")?.state).toBe("open");
	});
});

describe("event scoping", () => {
	async function seedOtherOrg() {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "OtherConf",
			slug: "otherconf",
		});
		await db.insert(forms).values({
			id: "f_other",
			eventId: "e2",
			internalName: "Other CFP",
			status: "open",
			closeAt: laDayPlus(2),
		});
		await db.insert(submissions).values([
			{ id: "so_1", eventId: "e2", title: "Other talk", status: "accepted" },
			{ id: "so_2", eventId: "e2", title: "Other pending", status: "pending" },
		]);
		return db;
	}

	it("never counts another org's event", async () => {
		await seedDashboard();
		await seedOtherOrg();
		const data = await runLoader(await authedRequest("http://localhost/admin"));

		// Identical to the single-org run — e2's rows are invisible from e1.
		expect(data.stats.submissions).toBe(5);
		expect(data.statusCounts.accepted).toBe(2);
		expect(data.forms.map((f) => f.id)).not.toContain("f_other");
		expect(data.recent.map((r) => r.id)).not.toContain("so_1");
		expect(data.alerts.closingSoon.firstName).toBe("Session CFP");
	});

	it("a forged activeEventId pointing at another org's event is ignored", async () => {
		await seedDashboard();
		await seedOtherOrg();
		// Member of org1 only, but their cookie-backed profile claims e2.
		const data = await runLoader(
			await authedRequest("http://localhost/admin", { activeEventId: "e2" }),
		);
		expect(data.event?.name).toBe("DemoConf"); // fell back to their own org
		expect(data.stats.submissions).toBe(5);
	});

	it("the other org's admin sees only their own numbers", async () => {
		await seedDashboard();
		await seedOtherOrg();
		const data = await runLoader(await authedForOrg("org2", "e2"));

		expect(data.event?.name).toBe("OtherConf");
		expect(data.stats.submissions).toBe(2);
		expect(data.stats.acceptedSpeakers).toBe(0);
		expect(data.alerts.outstandingSpeakers).toBe(0);
		expect(data.forms.map((f) => f.id)).toEqual(["f_other"]);
	});
});

describe("empty states", () => {
	it("a fresh event renders all-zero cards, no alerts, and empty lists", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org2", name: "Fresh Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "FreshConf",
			slug: "freshconf",
		});
		const data = await runLoader(await authedForOrg("org2", "e2"));

		expect(data.event?.name).toBe("FreshConf");
		expect(data.stats).toEqual({
			submissions: 0,
			drafts: 0,
			acceptedSpeakers: 0,
			acceptedSessions: 0,
		});
		expect(Object.values(data.statusCounts)).toEqual([0, 0, 0, 0, 0, 0, 0]);
		expect(data.alerts).toEqual({
			notPublic: 0,
			unscheduled: 0,
			outstandingSpeakers: 0,
			closingSoon: { count: 0, firstName: null, firstDays: null },
		});
		expect(data.recent).toEqual([]);
		expect(data.forms).toEqual([]);
		// No event dates yet → the countdown offers nothing to mis-render.
		expect(data.countdown).toEqual({ phase: "unset" });
	});

	it("an admin whose org has no events gets the no-event shape, not a crash", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org3", name: "Eventless" });
		const data = await runLoaderNoEvent(await authedForOrg("org3", null));
		expect(data.event).toBeNull();
		expect(data.greeting).toMatch(/^Good (morning|afternoon|evening)/);
	});
});

describe("auth", () => {
	it("rejects non-admin users", async () => {
		await seedDashboard();
		const request = await authedRequest("http://localhost/admin", {
			role: "speaker",
		});
		const thrown = await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0]).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});
});
