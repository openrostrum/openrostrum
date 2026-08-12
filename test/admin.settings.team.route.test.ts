import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	authSessions,
	emailOutbox,
	events,
	organizationMembers,
	organizations,
	passwordResets,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import Team, { action, loader } from "../app/routes/admin.settings.team";

// Invites mint org-intent tokens (organizationId set at mint time, never a
// membership), the last member can never be removed, and a member of org A
// can never see or mutate org B.

const CONTEXT = { cloudflare: { env, ctx: {} } };
const URL_ = "http://localhost/admin/settings/team";

type ActionResult = {
	fieldErrors?: Record<string, string[]>;
	formError?: string;
};

async function seedOrgA() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "orgA", name: "Org A" });
	await db
		.insert(events)
		.values({ id: "eA", organizationId: "orgA", name: "Event A", slug: "ea" });
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		name: "Ada Admin",
		role: "admin",
		activeEventId: "eA",
	});
	await db
		.insert(organizationMembers)
		.values({ id: "omA", organizationId: "orgA", userId: "u_admin" });
	return db;
}

async function seedOrgB() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "orgB", name: "Org B" });
	await db
		.insert(events)
		.values({ id: "eB", organizationId: "orgB", name: "Event B", slug: "eb" });
	await db.insert(users).values({
		id: "u_other",
		email: "other@test.co",
		passwordHash: await hashPassword("pw"),
		name: "Bea Other",
		role: "admin",
	});
	await db
		.insert(organizationMembers)
		.values({ id: "omB", organizationId: "orgB", userId: "u_other" });
	return db;
}

async function authedRequest(init?: RequestInit): Promise<Request> {
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(URL_, { ...init, headers });
}

function post(body: Record<string, string>) {
	return { method: "POST", body: new URLSearchParams(body) };
}

async function runAction(request: Request) {
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

async function runLoader(request: Request) {
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as {
		data: {
			org: { id: string; name: string } | null;
			members: Array<{
				membershipId: string;
				email: string;
				userId: string;
				joinedLabel: string;
			}>;
			invites: Array<{ id: string; email: string; link: string }>;
		};
	};
}

describe("team joined dates", () => {
	// Late evening in the event's zone (America/Los_Angeles) is already the
	// next calendar day in UTC — so the server's zone must never decide this.
	const JOINED_AT = new Date("2026-10-13T02:00:00.000Z");
	const JOINED_LABEL = "Oct 12, 2026";

	async function seedLateJoiner() {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_late",
			email: "late@test.co",
			passwordHash: await hashPassword("pw"),
			name: "Cy Late",
			role: "admin",
		});
		await db.insert(organizationMembers).values({
			id: "omLate",
			organizationId: "orgA",
			userId: "u_late",
			createdAt: JOINED_AT,
		});
	}

	it("dates a membership by the event's calendar, not the server's", async () => {
		await seedLateJoiner();
		const result = await runLoader(await authedRequest());
		const late = result.data.members.find((m) => m.membershipId === "omLate");
		expect(late?.joinedLabel).toBe(JOINED_LABEL);
	});

	it("renders the server-formatted date, so hydration cannot shift it", async () => {
		await seedLateJoiner();
		const result = await runLoader(await authedRequest());
		const RoutesStub = createRoutesStub([
			{
				path: "/",
				Component: () =>
					createElement(Team as ElementType, {
						loaderData: result.data,
						actionData: undefined,
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);
		expect(html).toContain(JOINED_LABEL);
	});
});

describe("team invites", () => {
	it("mints a sentinel admin user with an org-intent token, shows the link, and emails it", async () => {
		const db = await seedOrgA();
		const request = await authedRequest(
			post({ name: "Newbie Nine", email: "Newbie@Test.co" }),
		);

		const response = (await runAction(request)) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain(
			"invited=newbie%40test.co",
		);

		const [invitee] = await db
			.select()
			.from(users)
			.where(eq(users.email, "newbie@test.co"));
		expect(invitee).toBeDefined();
		expect(invitee?.role).toBe("admin");

		const resets = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, invitee?.id ?? ""));
		expect(resets).toHaveLength(1);
		expect(resets[0]?.organizationId).toBe("orgA"); // the mint-time intent
		expect(resets[0]?.usedAt).toBeNull();
		expect(resets[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

		// Inviting mints a token, never a membership — that happens at accept.
		expect(await db.select().from(organizationMembers)).toHaveLength(1);

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("newbie@test.co");
		expect(outbox[0]?.html).toContain(`/set-password/${resets[0]?.token}`);

		// The pending invite (with its copyable link) is on the page after PRG.
		const result = await runLoader(await authedRequest());
		expect(result.data.invites).toHaveLength(1);
		expect(result.data.invites[0]?.link).toContain(
			`/set-password/${resets[0]?.token}`,
		);
	});

	it("rejects a blank name and an invalid email without creating anything", async () => {
		const db = await seedOrgA();
		const request = await authedRequest(
			post({ name: "", email: "not-an-email" }),
		);

		const result = (await runAction(request)) as ActionResult;

		expect(result.fieldErrors?.name?.[0]).toBeTruthy();
		expect(result.fieldErrors?.email?.[0]).toBeTruthy();
		expect(await db.select().from(users)).toHaveLength(1);
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("refuses inviting an email that is already a member", async () => {
		const db = await seedOrgA();
		const request = await authedRequest(
			post({ name: "Ada", email: "admin@test.co" }),
		);

		const result = (await runAction(request)) as ActionResult;

		expect(result.fieldErrors?.email?.[0]).toMatch(/already a member/i);
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("refuses inviting an existing speaker account (no token, no membership)", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_spk",
			email: "sam@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const request = await authedRequest(
			post({ name: "Sam", email: "sam@test.co" }),
		);

		const result = (await runAction(request)) as ActionResult;

		expect(result.fieldErrors?.email?.[0]).toBeTruthy();
		expect(await db.select().from(passwordResets)).toHaveLength(0);
		expect(await db.select().from(organizationMembers)).toHaveLength(1);
	});

	// The invite link renders on-screen to the INVITER and redeeming it resets
	// the account password — minting one for a credentialed account would let
	// any org member take that account over.
	it("refuses inviting an email with an existing credentialed account (takeover guard)", async () => {
		const db = await seedOrgA();
		await seedOrgB();

		const result = (await runAction(
			await authedRequest(post({ name: "Bea", email: "other@test.co" })),
		)) as ActionResult;

		expect(result.fieldErrors?.email?.[0]).toMatch(/already has/i);
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("re-inviting an email with a pending invite refreshes the token instead of refusing", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_inv",
			email: "invitee@test.co",
			passwordHash: "invite-pending$fixture",
			role: "admin",
		});
		await db.insert(passwordResets).values({
			id: "pr_old",
			userId: "u_inv",
			organizationId: "orgA",
			token: "tok-old",
			expiresAt: new Date(Date.now() + 1000),
		});

		const response = (await runAction(
			await authedRequest(post({ name: "Invitee", email: "invitee@test.co" })),
		)) as Response;

		expect(response.status).toBe(302);
		const resets = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, "u_inv"));
		expect(resets).toHaveLength(1);
		expect(resets[0]?.token).not.toBe("tok-old");
		expect(resets[0]?.organizationId).toBe("orgA");
	});

	it("resend replaces the old token and sends a fresh email", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_inv",
			email: "invitee@test.co",
			passwordHash: "invite-pending$fixture",
			role: "admin",
		});
		await db.insert(passwordResets).values({
			id: "pr_old",
			userId: "u_inv",
			organizationId: "orgA",
			token: "tok-old",
			expiresAt: new Date(Date.now() + 1000),
		});

		const response = (await runAction(
			await authedRequest(post({ resend: "pr_old" })),
		)) as Response;

		expect(response.status).toBe(302);
		const resets = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, "u_inv"));
		expect(resets).toHaveLength(1);
		expect(resets[0]?.token).not.toBe("tok-old");
		expect(resets[0]?.organizationId).toBe("orgA");
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.html).toContain(`/set-password/${resets[0]?.token}`);
	});

	it("revoke deletes the pending token; a stale id gets an explicit message", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_inv",
			email: "invitee@test.co",
			passwordHash: "invite-pending$fixture",
			role: "admin",
		});
		await db.insert(passwordResets).values({
			id: "pr1",
			userId: "u_inv",
			organizationId: "orgA",
			token: "tok-1",
			expiresAt: new Date(Date.now() + 1000),
		});

		const response = (await runAction(
			await authedRequest(post({ revoke: "pr1" })),
		)) as Response;
		expect(response.status).toBe(302);
		expect(await db.select().from(passwordResets)).toHaveLength(0);

		const stale = (await runAction(
			await authedRequest(post({ revoke: "pr1" })),
		)) as ActionResult;
		expect(stale.formError).toBeTruthy();
	});

	// A revoked invite must not orphan the sentinel account it minted, or the
	// email reads as "an existing account" and can never be invited again.
	it("a revoked invite leaves the email invitable again", async () => {
		const db = await seedOrgA();
		const invite = (await runAction(
			await authedRequest(post({ name: "Newbie", email: "newbie@test.co" })),
		)) as Response;
		expect(invite.status).toBe(302);
		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.organizationId, "orgA"));

		const revoke = (await runAction(
			await authedRequest(post({ revoke: reset?.id ?? "" })),
		)) as Response;
		expect(revoke.status).toBe(302);
		// The sentinel account is garbage-collected with its invite...
		expect(
			await db.select().from(users).where(eq(users.email, "newbie@test.co")),
		).toHaveLength(0);

		// ...so the same email can be invited again.
		const reinvite = (await runAction(
			await authedRequest(post({ name: "Newbie", email: "newbie@test.co" })),
		)) as Response;
		expect(reinvite.status).toBe(302);
		const resets = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.organizationId, "orgA"));
		expect(resets).toHaveLength(1);
	});
});

describe("team member removal", () => {
	it("refuses removing the last member, with an explicit message", async () => {
		const db = await seedOrgA();
		const result = (await runAction(
			await authedRequest(post({ remove: "omA" })),
		)) as ActionResult;

		expect(result.formError).toMatch(/at least one member/i);
		expect(await db.select().from(organizationMembers)).toHaveLength(1);
	});

	it("removes another member (their event access dies with the membership)", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_two",
			email: "two@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
			activeEventId: "eA",
		});
		await db
			.insert(organizationMembers)
			.values({ id: "om2", organizationId: "orgA", userId: "u_two" });

		const response = (await runAction(
			await authedRequest(post({ remove: "om2" })),
		)) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin/settings/team");
		const remaining = await db.select().from(organizationMembers);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.userId).toBe("u_admin");
	});

	it("removing yourself destroys the session and redirects to login", async () => {
		const db = await seedOrgA();
		await db.insert(users).values({
			id: "u_two",
			email: "two@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db
			.insert(organizationMembers)
			.values({ id: "om2", organizationId: "orgA", userId: "u_two" });

		const response = (await runAction(
			await authedRequest(post({ remove: "omA" })),
		)) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
		expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
		const remaining = await db.select().from(organizationMembers);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.userId).toBe("u_two");
		expect(
			await db
				.select()
				.from(authSessions)
				.where(eq(authSessions.userId, "u_admin")),
		).toHaveLength(0);
	});
});

describe("cross-org isolation", () => {
	it("a member of org A never lists org B, even with org B's event active", async () => {
		const db = await seedOrgA();
		await seedOrgB();
		// Point the org-A admin's active event into org B (the pre-membership
		// fallback hole): the page must still resolve to org A.
		await db
			.update(users)
			.set({ activeEventId: "eB" })
			.where(eq(users.id, "u_admin"));

		const result = await runLoader(await authedRequest());

		expect(result.data.org?.id).toBe("orgA");
		expect(result.data.members.map((m) => m.email)).toEqual(["admin@test.co"]);
	});

	it("cannot remove an org B membership from an org A seat", async () => {
		const db = await seedOrgA();
		await seedOrgB();

		const result = (await runAction(
			await authedRequest(post({ remove: "omB" })),
		)) as ActionResult;

		expect(result.formError).toMatch(/wasn't found/i);
		expect(
			await db
				.select()
				.from(organizationMembers)
				.where(eq(organizationMembers.id, "omB")),
		).toHaveLength(1);
	});

	it("invites minted from an org A seat always carry org A's id", async () => {
		const db = await seedOrgA();
		await seedOrgB();
		await db
			.update(users)
			.set({ activeEventId: "eB" })
			.where(eq(users.id, "u_admin"));

		const response = (await runAction(
			await authedRequest(post({ name: "New", email: "new@test.co" })),
		)) as Response;

		expect(response.status).toBe(302);
		const resets = await db.select().from(passwordResets);
		expect(resets).toHaveLength(1);
		expect(resets[0]?.organizationId).toBe("orgA");
	});
});
