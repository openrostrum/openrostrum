import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	authSessions,
	events,
	organizationMembers,
	organizations,
	passwordResets,
	users,
} from "../app/db/schema";
import { createSession, hashPassword, verifyPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/set-password.$token";

// Pins the invite-token intent rule (docs/multi-tenancy-design.md): what a
// token grants derives from its mint-time organizationId column — set means
// org-member invite (accept creates the membership), NULL means speaker /
// reviewer / plain reset and must NEVER create one. The NULL case is the
// admin-escalation regression this suite exists for.

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedOrg() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "orgA", name: "Org A" });
	await db
		.insert(events)
		.values({ id: "eA", organizationId: "orgA", name: "Event A", slug: "ea" });
	return db;
}

async function seedUserWithToken(opts: {
	userId: string;
	role: "admin" | "speaker" | "reviewer";
	token: string;
	organizationId: string | null;
	expiresAt?: Date;
	usedAt?: Date;
}) {
	const db = getDb(env);
	await db.insert(users).values({
		id: opts.userId,
		email: `${opts.userId}@test.co`,
		passwordHash: await hashPassword(crypto.randomUUID()),
		name: "Invited Person",
		role: opts.role,
	});
	await db.insert(passwordResets).values({
		id: `pr_${opts.token}`,
		userId: opts.userId,
		organizationId: opts.organizationId,
		token: opts.token,
		expiresAt: opts.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
		usedAt: opts.usedAt ?? null,
	});
	return db;
}

function postRequest(token: string, fields: Record<string, string>) {
	return new Request(`http://localhost/set-password/${token}`, {
		method: "POST",
		body: new URLSearchParams(fields),
	});
}

async function runAction(token: string, fields: Record<string, string>) {
	return action({
		context: CONTEXT,
		request: postRequest(token, fields),
		params: { token },
	} as unknown as Parameters<typeof action>[0]);
}

async function runLoader(token: string) {
	const result = (await loader({
		context: CONTEXT,
		request: new Request(`http://localhost/set-password/${token}`),
		params: { token },
	} as unknown as Parameters<typeof loader>[0])) as unknown as {
		data: { state: string; orgName?: string | null };
	};
	return result.data;
}

const GOOD = { password: "SuperSecret1", confirm: "SuperSecret1" };

describe("set-password accept flow", () => {
	it("org-intent token: sets the password, creates the membership, revokes old sessions, lands in /admin", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-org",
			organizationId: "orgA",
		});
		const oldCookie = await createSession(env, "u_new");
		const oldSessionId = oldCookie.split(";")[0]?.split("=")[1];

		const response = (await runAction("tok-org", GOOD)) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin");
		expect(response.headers.get("Set-Cookie")).toContain("__session=");

		const memberships = await db.select().from(organizationMembers);
		expect(memberships).toHaveLength(1);
		expect(memberships[0]?.organizationId).toBe("orgA");
		expect(memberships[0]?.userId).toBe("u_new");

		const [user] = await db.select().from(users).where(eq(users.id, "u_new"));
		expect(await verifyPassword("SuperSecret1", user?.passwordHash ?? "")).toBe(
			true,
		);
		expect(user?.activeEventId).toBe("eA");

		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.token, "tok-org"));
		expect(reset?.usedAt).not.toBeNull();

		// The pre-existing session died with the credential change.
		const sessions = await db
			.select()
			.from(authSessions)
			.where(eq(authSessions.userId, "u_new"));
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.id).not.toBe(oldSessionId);
	});

	it("NULL-organizationId token (a speaker invite) NEVER creates a membership", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_spk",
			role: "speaker",
			token: "tok-null",
			organizationId: null,
		});

		const response = (await runAction("tok-null", GOOD)) as Response;

		expect(response.status).toBe(302);
		// Speaker tokens land on the speaker surface, never the admin shell.
		expect(response.headers.get("Location")).toBe("/portal");
		expect(await db.select().from(organizationMembers)).toHaveLength(0);
		const [user] = await db.select().from(users).where(eq(users.id, "u_spk"));
		expect(await verifyPassword("SuperSecret1", user?.passwordHash ?? "")).toBe(
			true,
		);
	});

	it("a used token is rejected and changes nothing", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-used",
			organizationId: "orgA",
			usedAt: new Date(),
		});
		const [before] = await db.select().from(users).where(eq(users.id, "u_new"));

		const result = (await runAction("tok-used", GOOD)) as {
			formError?: string;
		};

		expect(result.formError).toBeTruthy();
		const [after] = await db.select().from(users).where(eq(users.id, "u_new"));
		expect(after?.passwordHash).toBe(before?.passwordHash);
		expect(await db.select().from(organizationMembers)).toHaveLength(0);
	});

	it("an expired org token is rejected — no membership appears", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-expired",
			organizationId: "orgA",
			expiresAt: new Date(Date.now() - 1000),
		});

		const result = (await runAction("tok-expired", GOOD)) as {
			formError?: string;
		};

		expect(result.formError).toBeTruthy();
		expect(await db.select().from(organizationMembers)).toHaveLength(0);

		const view = (await runLoader("tok-expired")) as { state: string };
		expect(view.state).toBe("invalid");
	});

	it("a too-short password is rejected and the token survives for a retry", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-org",
			organizationId: "orgA",
		});

		const result = (await runAction("tok-org", {
			password: "short",
			confirm: "short",
		})) as { fieldErrors?: Record<string, string[]> };

		expect(result.fieldErrors?.password?.[0]).toBeTruthy();
		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.token, "tok-org"));
		expect(reset?.usedAt).toBeNull();
		expect(await db.select().from(organizationMembers)).toHaveLength(0);
	});

	it("a mismatched confirmation is rejected inline", async () => {
		await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-org",
			organizationId: "orgA",
		});

		const result = (await runAction("tok-org", {
			password: "SuperSecret1",
			confirm: "SomethingElse2",
		})) as { fieldErrors?: Record<string, string[]> };

		expect(result.fieldErrors?.confirm?.[0]).toBeTruthy();
	});

	// An outstanding link surviving a credential change would let its holder
	// re-take the account later — every other unused token dies on redemption.
	it("redeeming a token voids the user's other outstanding tokens", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_spk",
			role: "speaker",
			token: "tok-null",
			organizationId: null,
		});
		await db.insert(passwordResets).values({
			id: "pr_other",
			userId: "u_spk",
			organizationId: "orgA",
			token: "tok-org-stale",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		});

		const response = (await runAction("tok-null", GOOD)) as Response;

		expect(response.status).toBe(302);
		const remaining = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, "u_spk"));
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.token).toBe("tok-null");
		expect(remaining[0]?.usedAt).not.toBeNull();
		// And the NULL-intent redemption still granted nothing.
		expect(await db.select().from(organizationMembers)).toHaveLength(0);
	});

	it("accepting an invite while already a member stays idempotent", async () => {
		const db = await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-org",
			organizationId: "orgA",
		});
		await db
			.insert(organizationMembers)
			.values({ id: "om1", organizationId: "orgA", userId: "u_new" });

		const response = (await runAction("tok-org", GOOD)) as Response;

		expect(response.status).toBe(302);
		expect(await db.select().from(organizationMembers)).toHaveLength(1);
	});

	it("the loader names the organization for an org invite and stays generic otherwise", async () => {
		await seedOrg();
		await seedUserWithToken({
			userId: "u_new",
			role: "admin",
			token: "tok-org",
			organizationId: "orgA",
		});
		await seedUserWithToken({
			userId: "u_spk",
			role: "speaker",
			token: "tok-null",
			organizationId: null,
		});

		const orgView = (await runLoader("tok-org")) as {
			state: string;
			orgName?: string | null;
		};
		expect(orgView.state).toBe("valid");
		expect(orgView.orgName).toBe("Org A");

		const nullView = (await runLoader("tok-null")) as {
			state: string;
			orgName?: string | null;
		};
		expect(nullView.state).toBe("valid");
		expect(nullView.orgName).toBeNull();

		const missing = (await runLoader("tok-nope")) as { state: string };
		expect(missing.state).toBe("invalid");
	});
});
