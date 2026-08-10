import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { users } from "../app/db/schema";
import { hashPassword, verifyPassword } from "../app/lib/auth";
import { action } from "../app/routes/signup";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function post(body: Record<string, string>): Request {
	return new Request("http://localhost/signup", {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

function act(body: Record<string, string>) {
	return action({
		context: CONTEXT,
		request: post(body),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

describe("signup route", () => {
	it("creates an admin account, normalizes the email, and redirects to onboarding", async () => {
		const res = (await act({
			name: "Ada Lovelace",
			email: " Ada@Example.COM ",
			password: "correct-horse-9",
		})) as Response;

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/onboarding");
		expect(res.headers.get("Set-Cookie")).toContain("__session=");

		const rows = await getDb(env).select().from(users);
		expect(rows).toHaveLength(1);
		const user = rows[0];
		expect(user?.email).toBe("ada@example.com"); // cased signup can't mint a duplicate identity
		expect(user?.role).toBe("admin");
		expect(user?.name).toBe("Ada Lovelace");
		// The stored hash must verify the submitted password — the account can log in.
		expect(
			await verifyPassword("correct-horse-9", user?.passwordHash ?? ""),
		).toBe(true);
	});

	it("steers an existing email to sign-in — a message, never an error page", async () => {
		await getDb(env)
			.insert(users)
			.values({
				id: "u1",
				email: "ada@example.com",
				passwordHash: await hashPassword("secret-123"),
				role: "admin",
			});

		const result = await act({
			name: "Ada Again",
			email: "ADA@example.com", // different casing must hit the same account
			password: "another-pass-9",
		});

		expect(result).not.toBeInstanceOf(Response); // no redirect, no throw — an inline message
		expect(result).toHaveProperty("existingAccount", true);

		const rows = await getDb(env).select().from(users);
		expect(rows).toHaveLength(1); // no duplicate account minted
	});

	it("rejects a too-short password with a field error and creates no account", async () => {
		const result = await act({
			name: "Ada",
			email: "ada@example.com",
			password: "short",
		});

		expect(result).toHaveProperty("fieldErrors");
		expect(
			(result as { fieldErrors?: { password?: string[] } }).fieldErrors
				?.password?.[0],
		).toBeTruthy();
		expect(await getDb(env).select().from(users)).toHaveLength(0);
	});
});
