import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { users } from "../app/db/schema";
import { hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/login";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedUser(): Promise<void> {
	await getDb(env)
		.insert(users)
		.values({
			id: "u1",
			email: "a@b.co",
			passwordHash: await hashPassword("secret"),
			role: "admin",
		});
}

function post(body: Record<string, string>): Request {
	return new Request("http://localhost/login", {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

describe("login route", () => {
	it("sets a session cookie on correct credentials", async () => {
		await seedUser();
		const res = (await action({
			context: CONTEXT,
			request: post({ email: "a@b.co", password: "secret" }),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;

		expect(res.status).toBe(302);
		expect(res.headers.get("Set-Cookie")).toContain("__session=");
	});

	it("rejects a wrong password without a cookie", async () => {
		await seedUser();
		const res = await action({
			context: CONTEXT,
			request: post({ email: "a@b.co", password: "nope" }),
			params: {},
		} as unknown as Parameters<typeof action>[0]);

		expect(res).toHaveProperty("error");
	});

	it("ignores an external redirectTo (no open redirect via backslash)", async () => {
		await seedUser();
		const request = new Request(
			"http://localhost/login?redirectTo=/\\evil.com",
			{
				method: "POST",
				body: new URLSearchParams({ email: "a@b.co", password: "secret" }),
			},
		);
		const res = (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/admin"); // external target dropped
	});
});
