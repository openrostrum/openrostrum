import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { users } from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/login";

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

// Authenticated visitors to /login route by ROLE (flows: speaker -> portal,
// reviewer -> reviews, admin -> admin shell) — never blanket /admin, which
// bounced speakers to a bare /403.
describe("login loader (already signed in)", () => {
	async function seedRoleUser(role: "admin" | "speaker" | "reviewer") {
		await getDb(env)
			.insert(users)
			.values({
				id: `u_${role}`,
				email: `${role}@b.co`,
				passwordHash: await hashPassword("pw"),
				role,
			});
		const setCookie = await createSession(env, `u_${role}`);
		return setCookie.split(";")[0] ?? "";
	}

	async function runLoader(cookie: string, url = "http://localhost/login") {
		try {
			await loader({
				context: CONTEXT,
				request: new Request(url, { headers: { Cookie: cookie } }),
				params: {},
			} as unknown as Parameters<typeof loader>[0]);
		} catch (thrown) {
			return thrown as Response;
		}
		throw new Error("expected a redirect for an authenticated visitor");
	}

	it("sends a signed-in speaker to their portal, not /admin", async () => {
		const res = await runLoader(await seedRoleUser("speaker"));
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/portal");
	});

	it("sends a reviewer to /reviews and an admin to /admin", async () => {
		const reviewer = await runLoader(await seedRoleUser("reviewer"));
		expect(reviewer.headers.get("Location")).toBe("/reviews");
		const admin = await runLoader(await seedRoleUser("admin"));
		expect(admin.headers.get("Location")).toBe("/admin");
	});

	it("honors a safe redirectTo but drops an external one", async () => {
		const cookie = await seedRoleUser("speaker");
		const safe = await runLoader(
			cookie,
			"http://localhost/login?redirectTo=%2Fportal%2Fdevflow%2Fabc",
		);
		expect(safe.headers.get("Location")).toBe("/portal/devflow/abc");
		const external = await runLoader(
			cookie,
			"http://localhost/login?redirectTo=//evil.com",
		);
		expect(external.headers.get("Location")).toBe("/portal");
	});
});
