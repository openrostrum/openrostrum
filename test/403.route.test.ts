import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { users } from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/403";

// The denial page routes each viewer somewhere sensible: signed-in users get
// THEIR home (a speaker must never be pointed back at /admin), signed-out
// visitors get the sign-in door.

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedUser(role: "admin" | "speaker" | "reviewer") {
	await getDb(env)
		.insert(users)
		.values({
			id: `u_${role}`,
			email: `${role}@test.co`,
			passwordHash: await hashPassword("pw"),
			role,
		});
	const setCookie = await createSession(env, `u_${role}`);
	return setCookie.split(";")[0] ?? "";
}

async function runLoader(cookie?: string) {
	const request = new Request("http://localhost/403", {
		headers: cookie ? { Cookie: cookie } : undefined,
	});
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as {
		viewer: { email: string; homePath: string } | null;
	};
}

describe("403 route", () => {
	it("offers sign-in (not a dead end) to anonymous visitors", async () => {
		const result = await runLoader();
		expect(result.viewer).toBeNull();
	});

	it("points a signed-in speaker at their portal, not back at /admin", async () => {
		const cookie = await seedUser("speaker");
		const result = await runLoader(cookie);
		expect(result.viewer?.email).toBe("speaker@test.co");
		expect(result.viewer?.homePath).toBe("/portal");
	});

	it("points a reviewer at /reviews and an admin at /admin", async () => {
		const reviewer = await runLoader(await seedUser("reviewer"));
		expect(reviewer.viewer?.homePath).toBe("/reviews");
		const admin = await runLoader(await seedUser("admin"));
		expect(admin.viewer?.homePath).toBe("/admin");
	});
});
