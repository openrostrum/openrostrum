import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	events,
	organizationMembers,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import type { SubmissionListData } from "../app/lib/submission-list";
import {
	action as abstractsAction,
	loader as abstractsLoader,
} from "../app/routes/admin.abstracts";
import {
	action as sessionsAction,
	loader as sessionsLoader,
} from "../app/routes/admin.sessions";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function unwrapLoader(result: unknown): SubmissionListData {
	const r = result as { data?: SubmissionListData } & SubmissionListData;
	return (r.data ?? r) as SubmissionListData;
}

function unwrapAction(result: unknown) {
	const r = result as {
		data?: { notice?: string; formError?: string; skipped?: string[] };
	} & { notice?: string; formError?: string; skipped?: string[] };
	return r.data ?? r;
}

async function seedWorld() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "Mine",
		slug: "mine",
	});
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	return db;
}

async function requestAs(url: string, body?: URLSearchParams) {
	const setCookie = await createSession(env, "u_admin");
	return new Request(url, {
		method: body ? "POST" : "GET",
		body,
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
}

type LoaderArgs = Parameters<typeof abstractsLoader>[0];
type ActionArgs = Parameters<typeof abstractsAction>[0];

describe("abstracts / sessions type partition", () => {
	it("each tab lists only its own type, with counts excluding drafts from All", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values([
			{
				id: "a1",
				eventId: "e1",
				type: "abstract",
				title: "Vector search abstract",
				status: "pending",
			},
			{
				id: "a2",
				eventId: "e1",
				type: "abstract",
				title: "Draft abstract",
				status: "draft",
			},
			{
				id: "a3",
				eventId: "e1",
				type: "abstract",
				title: "Accepted abstract",
				status: "accepted",
			},
			{
				id: "s1",
				eventId: "e1",
				type: "session",
				title: "Closing Keynote: The Post-SaaS Stack",
				status: "accepted",
			},
		]);

		const abstracts = unwrapLoader(
			await abstractsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/abstracts"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(abstracts.counts.all).toBe(2);
		expect(abstracts.counts.draft).toBe(1);
		expect(abstracts.rows.map((r) => r.id).sort()).toEqual(["a1", "a3"]);
		// the Session fixture never leaks into Abstracts
		expect(abstracts.rows.some((r) => r.id === "s1")).toBe(false);

		const sessions = unwrapLoader(
			await sessionsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/sessions"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(sessions.counts.all).toBe(1);
		expect(sessions.rows.map((r) => r.id)).toEqual(["s1"]);
	});

	it("search filters titles (wildcards escaped) and pagination clamps to real pages", async () => {
		const db = await seedWorld();
		const rows = Array.from({ length: 30 }, (_, i) => ({
			id: `a${i}`,
			eventId: "e1",
			type: "abstract" as const,
			title: i === 7 ? "Edge-Native Vector Search on D1" : `Talk ${i}`,
			status: "pending" as const,
		}));
		// chunked: a single 30-row VALUES insert exceeds D1's bind-variable cap
		for (let i = 0; i < rows.length; i += 10) {
			await db.insert(submissions).values(rows.slice(i, i + 10));
		}

		const searched = unwrapLoader(
			await abstractsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/abstracts?q=vector"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(searched.total).toBe(1);
		expect(searched.rows[0]?.title).toBe("Edge-Native Vector Search on D1");

		// a literal "%" must not match everything
		const wildcard = unwrapLoader(
			await abstractsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/abstracts?q=%25"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(wildcard.total).toBe(0);

		const page2 = unwrapLoader(
			await abstractsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/abstracts?page=2"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(page2.total).toBe(30);
		expect(page2.rows).toHaveLength(5);

		// out-of-range page clamps instead of rendering an empty page 99
		const clamped = unwrapLoader(
			await abstractsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/abstracts?page=99"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(clamped.page).toBe(2);
		expect(clamped.rows.length).toBeGreaterThan(0);
	});
});

describe("bulk status through the spine", () => {
	it("transitions the selection, skips drafts, sends nothing", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values([
			{
				id: "a1",
				eventId: "e1",
				type: "abstract",
				title: "One",
				status: "pending",
			},
			{
				id: "a2",
				eventId: "e1",
				type: "abstract",
				title: "Two",
				status: "pending",
			},
			{
				id: "a3",
				eventId: "e1",
				type: "abstract",
				title: "Draft",
				status: "draft",
			},
		]);
		const result = unwrapAction(
			await abstractsAction({
				context: CONTEXT,
				request: await requestAs(
					"http://localhost/admin/abstracts",
					new URLSearchParams([
						["intent", "bulk-set-status"],
						["submissionIds", "a1"],
						["submissionIds", "a2"],
						["submissionIds", "a3"],
						["status", "accept_queue"],
					]),
				),
				params: {},
			} as unknown as ActionArgs),
		);
		expect(result.notice).toContain("2 submissions set to accept queue");
		expect(result.skipped?.join(" ")).toMatch(/draft/i);
		const rows = await db.select().from(submissions);
		const byId = new Map(rows.map((r) => [r.id, r.status]));
		expect(byId.get("a1")).toBe("accept_queue");
		expect(byId.get("a2")).toBe("accept_queue");
		expect(byId.get("a3")).toBe("draft");
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});
});

describe("approve all accepted", () => {
	it("approves every accepted-but-unapproved submission and leaves the rest alone", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values([
			{
				id: "s1",
				eventId: "e1",
				type: "session",
				title: "A",
				status: "accepted",
				contentStatus: "in_review",
			},
			{
				id: "s2",
				eventId: "e1",
				type: "session",
				title: "B",
				status: "accepted",
				contentStatus: "draft",
			},
			{
				id: "s3",
				eventId: "e1",
				type: "abstract",
				title: "C",
				status: "accepted",
				contentStatus: "in_review",
			},
			{
				id: "s4",
				eventId: "e1",
				type: "session",
				title: "D",
				status: "pending",
				contentStatus: "draft",
			},
			{
				id: "s5",
				eventId: "e1",
				type: "session",
				title: "E",
				status: "accepted",
				contentStatus: "approved",
			},
		]);
		const result = unwrapAction(
			await sessionsAction({
				context: CONTEXT,
				request: await requestAs(
					"http://localhost/admin/sessions",
					new URLSearchParams({ intent: "approve-all-accepted" }),
				),
				params: {},
			} as unknown as ActionArgs),
		);
		// accepted abstracts are sessions-side too — the gate opener covers them
		expect(result.notice).toContain("3 accepted sessions approved");
		const rows = await db.select().from(submissions);
		const byId = new Map(rows.map((r) => [r.id, r.contentStatus]));
		expect(byId.get("s1")).toBe("approved");
		expect(byId.get("s2")).toBe("approved");
		expect(byId.get("s3")).toBe("approved");
		expect(byId.get("s4")).toBe("draft"); // not accepted — never auto-published
		expect(byId.get("s5")).toBe("approved");

		const again = unwrapAction(
			await sessionsAction({
				context: CONTEXT,
				request: await requestAs(
					"http://localhost/admin/sessions",
					new URLSearchParams({ intent: "approve-all-accepted" }),
				),
				params: {},
			} as unknown as ActionArgs),
		);
		expect(again.notice).toMatch(/already approved/i);
	});

	it("loader reports how many accepted sessions are not public yet", async () => {
		const db = await seedWorld();
		await db.insert(submissions).values([
			{
				id: "s1",
				eventId: "e1",
				type: "session",
				title: "A",
				status: "accepted",
				contentStatus: "in_review",
			},
			{
				id: "s2",
				eventId: "e1",
				type: "session",
				title: "B",
				status: "accepted",
				contentStatus: "approved",
			},
		]);
		const data = unwrapLoader(
			await sessionsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/sessions"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(data.notPublicCount).toBe(1);
	});
});

describe("auth + empty event", () => {
	it("refuses a non-admin", async () => {
		const db = await seedWorld();
		await db.insert(users).values({
			id: "u_speaker",
			email: "speaker@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const setCookie = await createSession(env, "u_speaker");
		const request = new Request("http://localhost/admin/abstracts", {
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		await expect(
			abstractsLoader({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as LoaderArgs),
		).rejects.toSatisfy(
			(thrown) =>
				thrown instanceof Response && thrown.headers.get("Location") === "/403",
		);
	});

	it("an admin with no membership gets the empty state, not someone else's data", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db.insert(events).values({
			id: "e1",
			organizationId: "org1",
			name: "Foreign",
			slug: "foreign",
		});
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			type: "session",
			title: "Hidden",
			status: "pending",
		});
		await db.insert(users).values({
			id: "u_admin",
			email: "admin@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		const data = unwrapLoader(
			await sessionsLoader({
				context: CONTEXT,
				request: await requestAs("http://localhost/admin/sessions"),
				params: {},
			} as unknown as LoaderArgs),
		);
		expect(data.eventName).toBeNull();
		expect(data.rows).toEqual([]);
	});
});
