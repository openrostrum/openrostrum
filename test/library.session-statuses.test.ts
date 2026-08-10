import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	sessionStatuses,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.settings.library";
import { unwrap } from "./tasks-fixtures";

const CONTEXT = { cloudflare: { env, ctx: {} } };

type LibResult = {
	ok?: true;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

/** Two tenants: u_a admins e_a, u_b admins e_b — the cross-tenant probe. */
async function seed(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(events).values([
		{ id: "e_a", organizationId: "org_a", name: "A", slug: "a" },
		{ id: "e_b", organizationId: "org_b", name: "B", slug: "b" },
	]);
	await db.insert(users).values([
		{
			id: "u_a",
			email: "a@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
			activeEventId: "e_a",
		},
		{
			id: "u_b",
			email: "b@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
			activeEventId: "e_b",
		},
	]);
	await db.insert(organizationMembers).values([
		{ organizationId: "org_a", userId: "u_a" },
		{ organizationId: "org_b", userId: "u_b" },
	]);
}

async function post(
	fields: Record<string, string>,
	userId = "u_a",
): Promise<LibResult> {
	const setCookie = await createSession(env, userId);
	const request = new Request("http://localhost/admin/settings/library", {
		method: "POST",
		headers: new Headers({ Cookie: setCookie.split(";")[0] ?? "" }),
		body: new URLSearchParams(fields),
	});
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	return unwrap<LibResult>(result);
}

describe("library — session statuses (custom statuses)", () => {
	it("creates event-scoped statuses with color and append-ordered positions", async () => {
		await seed();
		expect(
			(
				await post({
					intent: "status.create",
					name: "Offered",
					color: "#0E6C66",
				})
			).ok,
		).toBe(true);
		expect(
			(
				await post({
					intent: "status.create",
					name: "Pending Contract",
					color: "#D97706",
				})
			).ok,
		).toBe(true);

		const rows = await getDb(env)
			.select()
			.from(sessionStatuses)
			.orderBy(sessionStatuses.position);
		expect(rows.map((r) => [r.eventId, r.name, r.color, r.position])).toEqual([
			["e_a", "Offered", "#0E6C66", 0],
			["e_a", "Pending Contract", "#D97706", 1],
		]);
	});

	it("rejects a blank name and inserts nothing", async () => {
		await seed();
		const result = await post({
			intent: "status.create",
			name: "  ",
			color: "#0E6C66",
		});
		expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
		expect(await getDb(env).select().from(sessionStatuses)).toHaveLength(0);
	});

	it("renames in place; a foreign tenant's forged update touches nothing", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(sessionStatuses).values({
			id: "st_offered",
			eventId: "e_a",
			name: "Offered",
			color: "#0E6C66",
		});
		expect(
			(
				await post({
					intent: "status.update",
					id: "st_offered",
					name: "Offer Sent",
					color: "#2563EB",
				})
			).ok,
		).toBe(true);
		const [renamed] = await db.select().from(sessionStatuses);
		expect(renamed).toMatchObject({ name: "Offer Sent", color: "#2563EB" });

		const forged = await post(
			{
				intent: "status.update",
				id: "st_offered",
				name: "Hijacked",
				color: "#000000",
			},
			"u_b",
		);
		expect(forged.formError).toMatch(/no longer exists/);
		const [after] = await db.select().from(sessionStatuses);
		expect(after?.name).toBe("Offer Sent");
	});

	it("refuses deleting a status a submission still carries — never silently stripped", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(sessionStatuses).values({
			id: "st_offered",
			eventId: "e_a",
			name: "Offered",
			color: "#0E6C66",
		});
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e_a",
			title: "Talk",
			customStatusId: "st_offered",
		});

		const refused = await post({ intent: "status.delete", id: "st_offered" });
		expect(refused.formError).toMatch(/1 submission/);
		const [sub] = await db.select().from(submissions);
		expect(sub?.customStatusId).toBe("st_offered");

		await db
			.update(submissions)
			.set({ customStatusId: null })
			.where(eq(submissions.id, "s1"));
		expect((await post({ intent: "status.delete", id: "st_offered" })).ok).toBe(
			true,
		);
		expect(await db.select().from(sessionStatuses)).toHaveLength(0);
	});

	it("the loader lists statuses with their in-use counts, scoped to the active event", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(sessionStatuses).values([
			{ id: "st_a", eventId: "e_a", name: "Offered", color: "#0E6C66" },
			{ id: "st_b", eventId: "e_b", name: "Foreign", color: "#000000" },
		]);
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e_a",
			title: "Talk",
			customStatusId: "st_a",
		});
		const setCookie = await createSession(env, "u_a");
		const data = unwrap<{
			sessionStatuses: Array<{ id: string; name: string; inUse: number }>;
		}>(
			await loader({
				context: CONTEXT,
				request: new Request("http://localhost/admin/settings/library", {
					headers: new Headers({ Cookie: setCookie.split(";")[0] ?? "" }),
				}),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(data.sessionStatuses).toEqual([
			expect.objectContaining({ id: "st_a", name: "Offered", inUse: 1 }),
		]);
	});
});
