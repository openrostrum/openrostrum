import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizations,
	participants,
	submissions,
	submissionTracks,
	tracks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.submissions";

// Seeds D1, authenticates as an admin, calls the loader AND the action with a
// real Cloudflare context, and asserts on results (incl. that validation is
// SOUND — a blank required field is rejected and never written).

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

const CONTEXT = { cloudflare: { env, ctx: {} } };

describe("admin submissions route", () => {
	it("loads submissions with tracks + participants", async () => {
		const db = getDb(env);
		const request = await adminRequest("http://localhost/admin/submissions");
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db.insert(events).values({
			id: "e1",
			organizationId: "org1",
			name: "E",
			slug: "e",
		});
		await db
			.insert(tracks)
			.values({ id: "t1", eventId: "e1", name: "AI", color: "#000000" });
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "a@b.c",
			firstName: "A",
			lastName: "B",
		});
		await db
			.insert(submissions)
			.values({ id: "s1", eventId: "e1", title: "Talk", status: "accepted" });
		await db
			.insert(submissionTracks)
			.values({ submissionId: "s1", trackId: "t1" });
		await db
			.insert(participants)
			.values({ id: "p1", submissionId: "s1", contactId: "c1" });

		const result = (await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as {
			data: {
				submissions: Array<{
					title: string;
					submissionTracks: Array<{ track: { name: string } }>;
					participants: unknown[];
				}>;
			};
			init: { headers: Record<string, string> };
		};

		expect(result.data.submissions).toHaveLength(1);
		expect(result.data.submissions[0]?.title).toBe("Talk");
		expect(result.data.submissions[0]?.submissionTracks[0]?.track.name).toBe(
			"AI",
		);
		expect(result.data.submissions[0]?.participants).toHaveLength(1);
		expect(result.init.headers["Server-Timing"]).toContain("db;dur=");
	});

	it("creates a submission via the action (server-derives eventId)", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			title: "New talk",
			type: "session",
			status: "pending",
		});
		const request = await adminRequest("http://localhost/admin/submissions", {
			method: "POST",
			body,
		});
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db.insert(events).values({
			id: "e1",
			organizationId: "org1",
			name: "E",
			slug: "e",
		});

		const response = await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0]);

		expect((response as Response).status).toBe(302);
		const rows = await db.select().from(submissions);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe("New talk");
		expect(rows[0]?.eventId).toBe("e1"); // server-derived, not client-supplied
	});

	// Guards against the false-positive that a bare createInsertSchema allows:
	// an event IS seeded, so a blank title can only be rejected by validation,
	// not masked by a DB FK error.
	it("rejects a blank required title with a field error (validation is sound)", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			title: "",
			type: "session",
			status: "pending",
		});
		const request = await adminRequest("http://localhost/admin/submissions", {
			method: "POST",
			body,
		});
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db.insert(events).values({
			id: "e1",
			organizationId: "org1",
			name: "E",
			slug: "e",
		});

		const result = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			fieldErrors?: { title?: string[] };
			formError?: string;
		};

		expect(result.fieldErrors?.title?.[0]).toBeTruthy();
		expect(result.formError).toBeUndefined();
		expect(await db.select().from(submissions)).toHaveLength(0);
	});
});
