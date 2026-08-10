import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/admin.events.switch";

// The event switcher is a tenancy chokepoint: it may set users.activeEventId
// ONLY to an event of an org the caller belongs to (docs/multi-tenancy-design.md
// §Authorization — "the event switcher lists only your orgs' events").

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seed(): Promise<void> {
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
		{ id: "e_a1", organizationId: "org_a", name: "A1", slug: "a1" },
		{ id: "e_a2", organizationId: "org_a", name: "A2", slug: "a2" },
		{ id: "e_b1", organizationId: "org_b", name: "B1", slug: "b1" },
	]);
}

async function postSwitch(
	fields: Record<string, string>,
	userId?: string,
): Promise<Response> {
	const headers = new Headers();
	if (userId) {
		const setCookie = await createSession(env, userId);
		headers.set("Cookie", setCookie.split(";")[0] ?? "");
	}
	const request = new Request("http://localhost/admin/events/switch", {
		method: "POST",
		headers,
		body: new URLSearchParams(fields),
	});
	try {
		return (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
	} catch (thrown) {
		if (thrown instanceof Response) return thrown; // requireUser throws redirects
		throw thrown;
	}
}

async function activeEventOf(userId: string): Promise<string | null> {
	const row = await getDb(env).query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId),
	});
	return row?.activeEventId ?? null;
}

describe("admin.events.switch action", () => {
	it("switches to an own-org event and redirects to /admin by default", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_a2" }, "u_a");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin");
		expect(await activeEventOf("u_a")).toBe("e_a2");
	});

	it("honors a same-origin redirectTo and rejects an external one", async () => {
		await seed();
		const ok = await postSwitch(
			{ eventId: "e_a1", redirectTo: "/admin/submissions" },
			"u_a",
		);
		expect(ok.headers.get("Location")).toBe("/admin/submissions");
		const evil = await postSwitch(
			{ eventId: "e_a2", redirectTo: "//evil.example" },
			"u_a",
		);
		expect(evil.headers.get("Location")).toBe("/admin");
	});

	it("refuses another org's event with 403 and does not write (cross-tenant denial)", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_b1" }, "u_a");
		expect(response.status).toBe(403);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("refuses an unknown event id with 403 (no existence disclosure) and does not write", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_nope" }, "u_a");
		expect(response.status).toBe(403);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("rejects a blank eventId with 400", async () => {
		await seed();
		const response = await postSwitch({ eventId: "" }, "u_a");
		expect(response.status).toBe(400);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("redirects an anonymous POST to /login and writes nothing", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_a1" });
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain("/login");
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("denies a non-admin role with /403 and writes nothing", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_spk",
			email: "s@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const response = await postSwitch({ eventId: "e_a1" }, "u_spk");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/403");
		expect(await activeEventOf("u_spk")).toBeNull();
	});
});
