import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { CONTACT_STATUS as CLIENT_CONTACT_STATUS } from "../app/db/constants";
import {
	CONTACT_STATUS as SCHEMA_CONTACT_STATUS,
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.contacts";

async function adminRequest(url: string, init?: RequestInit): Promise<Request> {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

async function seedEvent(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	await db
		.insert(events)
		.values({ id: "e1", organizationId: "org1", name: "E", slug: "e" });
}

const CONTEXT = { cloudflare: { env, ctx: {} } };

type LoaderResult = {
	data: {
		rows: Array<{ email: string; status: string }>;
		counts: Record<string, number>;
		total: number;
		page: number;
	};
};

describe("contacts roster", () => {
	// The client tuple in db/constants and the schema's column enum must never
	// diverge — the roster's filter tabs are built from the client copy.
	it("keeps the client CONTACT_STATUS tuple in lockstep with the schema", () => {
		expect(CLIENT_CONTACT_STATUS).toEqual(SCHEMA_CONTACT_STATUS);
	});

	it("filters by search and status server-side, scoped to the active event", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts?q=lattice&status=confirmed",
		);
		await seedEvent();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db
			.insert(events)
			.values({ id: "e2", organizationId: "org2", name: "F", slug: "f" });
		await db.insert(contacts).values([
			{
				id: "c1",
				eventId: "e1",
				email: "priya@example.com",
				firstName: "Priya",
				lastName: "Raman",
				companyName: "Latticework Systems",
				status: "confirmed",
			},
			{
				id: "c2",
				eventId: "e1",
				email: "marcus@example.com",
				firstName: "Marcus",
				lastName: "Okafor",
				companyName: "Latticework Systems",
				status: "pending",
			},
			// Same search match but in ANOTHER org's event — must never appear.
			{
				id: "c3",
				eventId: "e2",
				email: "other@example.com",
				firstName: "Priya",
				lastName: "Lattice",
				status: "confirmed",
			},
		]);

		const result = (await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;

		expect(result.data.rows.map((r) => r.email)).toEqual(["priya@example.com"]);
		// Tab counts reflect the search across all statuses (both Latticework
		// people), never the other event's rows.
		expect(result.data.counts.all).toBe(2);
		expect(result.data.counts.confirmed).toBe(1);
		expect(result.data.counts.pending).toBe(1);
	});

	it("paginates past 50 rows instead of rendering an unbounded table", async () => {
		const db = getDb(env);
		await adminRequest("http://localhost/admin/contacts"); // seeds the admin
		await seedEvent();
		const inserts = [];
		for (let i = 0; i < 60; i += 1) {
			inserts.push(
				db.insert(contacts).values({
					id: `bulk${i}`,
					eventId: "e1",
					email: `speaker${i}@example.com`,
					firstName: "Speaker",
					lastName: `Number${String(i).padStart(2, "0")}`,
				}),
			);
		}
		const [head, ...rest] = inserts;
		if (head) await db.batch([head, ...rest]);

		const setCookie = await createSession(env, "u_admin");
		const request = new Request("http://localhost/admin/contacts?page=2", {
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		const page2 = (await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;

		expect(page2.data.total).toBe(60);
		expect(page2.data.page).toBe(2);
		expect(page2.data.rows).toHaveLength(10);
	});

	it("creates a contact with a server-derived event and normalized email", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			firstName: "Priya",
			lastName: "Raman",
			email: "  PRIYA@Example.com ",
			jobTitle: "Principal Engineer",
			companyName: "Latticework Systems",
			bio: "Distributed builds.",
		});
		const request = await adminRequest("http://localhost/admin/contacts", {
			method: "POST",
			body,
		});
		await seedEvent();

		const response = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;

		expect(response.status).toBe(302);
		const rows = await db.select().from(contacts);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.eventId).toBe("e1");
		expect(rows[0]?.email).toBe("priya@example.com");
		expect(response.headers.get("Location")).toBe(
			`/admin/contacts/${rows[0]?.id}`,
		);
	});

	it("warns before creating a same-name contact under a different email", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			firstName: "sam",
			lastName: "SPEAKER",
			email: "sam.other@example.com",
		});
		const request = await adminRequest("http://localhost/admin/contacts", {
			method: "POST",
			body,
		});
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_sam",
			eventId: "e1",
			email: "speaker@example.com",
			firstName: "Sam",
			lastName: "Speaker",
		});

		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as unknown as {
			data: { duplicate?: { name: string; email: string } };
		};

		expect(result.data.duplicate?.email).toBe("speaker@example.com");
		expect(await db.select().from(contacts)).toHaveLength(1);

		body.set("confirmDuplicate", "1");
		const setCookie = await createSession(env, "u_admin");
		const confirmed = (await action({
			context: CONTEXT,
			request: new Request("http://localhost/admin/contacts", {
				method: "POST",
				body,
				headers: { Cookie: setCookie.split(";")[0] ?? "" },
			}),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
		expect(confirmed.status).toBe(302);
		expect(await db.select().from(contacts)).toHaveLength(2);
	});

	it("does not name-warn when the conflict is the email itself", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			firstName: "Sam",
			lastName: "Speaker",
			email: "speaker@example.com",
		});
		const request = await adminRequest("http://localhost/admin/contacts", {
			method: "POST",
			body,
		});
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_sam",
			eventId: "e1",
			email: "speaker@example.com",
			firstName: "Sam",
			lastName: "Speaker",
		});

		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: { email?: string[] };
		};

		// The unique-violation message names the real conflict — not a
		// create-anyway loop that could never succeed.
		expect(result.fieldErrors?.email?.[0]).toMatch(/already exists/i);
	});

	it("rejects a duplicate email with a field error instead of a 500", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			firstName: "Priya",
			lastName: "Raman",
			email: "priya@example.com",
		});
		const request = await adminRequest("http://localhost/admin/contacts", {
			method: "POST",
			body,
		});
		await seedEvent();
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "P",
			lastName: "R",
		});

		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: { email?: string[] };
		};

		expect(result.fieldErrors?.email?.[0]).toMatch(/already exists/i);
		expect(await db.select().from(contacts)).toHaveLength(1);
	});
});
