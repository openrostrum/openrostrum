import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	events,
	organizationMembers,
	organizations,
	participants,
	passwordResets,
	portals,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.contacts_.$id";

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

async function seedEventAndContact(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	await db
		.insert(events)
		.values({ id: "e1", organizationId: "org1", name: "E", slug: "e" });
	await db.insert(portals).values({
		id: "portal1",
		eventId: "e1",
		publicId: "portal-public",
		name: "Speaker Portal",
	});
	await db.insert(contacts).values({
		id: "c1",
		eventId: "e1",
		email: "priya@example.com",
		firstName: "Priya",
		lastName: "Raman",
	});
}

const CONTEXT = { cloudflare: { env, ctx: {} } };

function args(request: Request, id: string) {
	return { context: CONTEXT, request, params: { id } } as unknown as Parameters<
		typeof action
	>[0];
}

describe("contact record", () => {
	it("404s for a contact that belongs to another org's event", async () => {
		const db = getDb(env);
		const request = await adminRequest("http://localhost/admin/contacts/cx");
		await seedEventAndContact();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db
			.insert(events)
			.values({ id: "e2", organizationId: "org2", name: "F", slug: "f" });
		await db.insert(contacts).values({
			id: "cx",
			eventId: "e2",
			email: "foreign@example.com",
			firstName: "Not",
			lastName: "Yours",
		});

		await expect(
			loader(args(request, "cx") as unknown as Parameters<typeof loader>[0]),
		).rejects.toMatchObject({ init: { status: 404 } });
	});

	it("persists profile edits including logistics notes and status", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({
			intent: "update",
			firstName: "Priya",
			lastName: "Raman",
			email: "priya@example.com",
			bio: "Bio SBEK-ORG-EDIT-01",
			logisticsNotes: "Arrival May 11, aisle seat; dietary: Vegetarian",
			status: "confirmed",
		});
		const request = await adminRequest("http://localhost/admin/contacts/c1", {
			method: "POST",
			body,
		});
		await seedEventAndContact();

		const response = (await action(args(request, "c1"))) as Response;

		expect(response.status).toBe(302);
		const [row] = await db.select().from(contacts).where(eq(contacts.id, "c1"));
		expect(row?.bio).toBe("Bio SBEK-ORG-EDIT-01");
		expect(row?.logisticsNotes).toBe(
			"Arrival May 11, aisle seat; dietary: Vegetarian",
		);
		expect(row?.status).toBe("confirmed");
	});

	it("invites a speaker: sentinel-hash account, NULL-org token, logged email, and NO org membership", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({ intent: "invite", inviteKey: "k1" });
		const request = await adminRequest("http://localhost/admin/contacts/c1", {
			method: "POST",
			body,
		});
		await seedEventAndContact();

		const result = (await action(args(request, "c1"))) as { invited: boolean };
		expect(result.invited).toBe(true);

		const [account] = await db
			.select()
			.from(users)
			.where(eq(users.email, "priya@example.com"));
		expect(account).toBeDefined();
		expect(account?.role).toBe("speaker");
		// House sentinel-hash convention: structurally un-loginable until the
		// invitee sets a password, and detectable by the shared prefix.
		expect(account?.passwordHash.startsWith("invite-pending$")).toBe(true);
		expect(account?.passwordHash.startsWith("pbkdf2$")).toBe(false);

		const [contact] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(contact?.userId).toBe(account?.id);

		const resets = await db.select().from(passwordResets);
		expect(resets).toHaveLength(1);
		// Speaker invites must never mint org-member invites.
		expect(resets[0]?.organizationId).toBeNull();
		expect(resets[0]?.userId).toBe(account?.id);

		// The invite never grants an organization membership (only the admin has one).
		const memberships = await db.select().from(organizationMembers);
		expect(memberships).toHaveLength(1);
		expect(memberships[0]?.userId).toBe("u_admin");

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("priya@example.com");
		expect(outbox[0]?.html).toContain(`/set-password/${resets[0]?.token}`);
	});

	it("re-invites an account that already has a password with the portal link, minting no token", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({ intent: "invite", inviteKey: "k2" });
		const request = await adminRequest("http://localhost/admin/contacts/c1", {
			method: "POST",
			body,
		});
		await seedEventAndContact();
		await db.insert(users).values({
			id: "u_priya",
			email: "priya@example.com",
			passwordHash: await hashPassword("already-set"),
			role: "speaker",
		});

		await action(args(request, "c1"));

		expect(await db.select().from(passwordResets)).toHaveLength(0);
		const outbox = await db.select().from(emailOutbox);
		expect(outbox[0]?.html).toContain("/portals/e/portal-public");
		const [contact] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(contact?.userId).toBe("u_priya");
	});

	it("deletes a contact with its roles and task assignments, keeping sessions and users", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({ intent: "delete" });
		const request = await adminRequest("http://localhost/admin/contacts/c1", {
			method: "POST",
			body,
		});
		await seedEventAndContact();
		await db
			.insert(submissions)
			.values({ id: "s1", eventId: "e1", title: "Talk", status: "accepted" });
		await db
			.insert(participants)
			.values({ id: "p1", submissionId: "s1", contactId: "c1" });
		await db
			.insert(tasks)
			.values({ id: "t1", eventId: "e1", name: "Confirm participation" });
		await db
			.insert(taskAssignments)
			.values({ id: "ta1", taskId: "t1", contactId: "c1" });

		const response = (await action(args(request, "c1"))) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin/contacts");
		expect(await db.select().from(contacts)).toHaveLength(0);
		expect(await db.select().from(participants)).toHaveLength(0);
		expect(await db.select().from(taskAssignments)).toHaveLength(0);
		// The submission and the admin user survive the cascade.
		expect(await db.select().from(submissions)).toHaveLength(1);
		expect(await db.select().from(users)).toHaveLength(1);
	});

	it("refuses to delete another event's contact through the scoped action", async () => {
		const db = getDb(env);
		const body = new URLSearchParams({ intent: "delete" });
		const request = await adminRequest("http://localhost/admin/contacts/cx", {
			method: "POST",
			body,
		});
		await seedEventAndContact();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db
			.insert(events)
			.values({ id: "e2", organizationId: "org2", name: "F", slug: "f" });
		await db.insert(contacts).values({
			id: "cx",
			eventId: "e2",
			email: "foreign@example.com",
			firstName: "Not",
			lastName: "Yours",
		});

		await expect(action(args(request, "cx"))).rejects.toMatchObject({
			init: { status: 404 },
		});
		expect(await db.select().from(contacts)).toHaveLength(2);
	});
});
