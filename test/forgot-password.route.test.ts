import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	emailSuppressions,
	passwordResets,
	users,
} from "../app/db/schema";
import { hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/forgot-password";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedUser(email = "sam@example.com") {
	await getDb(env)
		.insert(users)
		.values({
			id: "u_sam",
			email,
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
}

function post(email: string) {
	return action({
		context: CONTEXT,
		request: new Request("http://localhost/forgot-password", {
			method: "POST",
			body: new URLSearchParams({ email }),
		}),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

describe("forgot password", () => {
	it("mints a 1-hour reset token (organizationId NULL) and emails the link", async () => {
		await seedUser();
		const before = Date.now();
		const result = await post("Sam@Example.com"); // case-insensitive lookup
		expect(result).toMatchObject({ sent: true, email: "sam@example.com" });

		const [reset] = await getDb(env).select().from(passwordResets);
		expect(reset?.userId).toBe("u_sam");
		expect(reset?.organizationId).toBeNull();
		expect(reset?.usedAt).toBeNull();
		const ttlMs = (reset?.expiresAt.getTime() ?? 0) - before;
		expect(ttlMs).toBeGreaterThan(55 * 60 * 1000);
		expect(ttlMs).toBeLessThan(65 * 60 * 1000);

		const [mail] = await getDb(env)
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "sam@example.com"));
		expect(mail?.html).toContain(`/set-password/${reset?.token}`);
		expect(mail?.status).toBe("sent");
	});

	it("responds identically whether or not the account exists (non-disclosure)", async () => {
		await seedUser();
		const known = await post("sam@example.com");
		const unknown = await post("ghost@example.com");
		expect(unknown).toEqual({ ...known, email: "ghost@example.com" });
		// ...but does no work for the unknown address.
		const rows = await getDb(env).select().from(emailOutbox);
		expect(rows.map((r) => r.to)).toEqual(["sam@example.com"]);
		expect(await getDb(env).select().from(passwordResets)).toHaveLength(1);
	});

	it("throttles repeat requests: one live token/email within the window", async () => {
		await seedUser();
		await post("sam@example.com");
		await post("sam@example.com");
		expect(await getDb(env).select().from(passwordResets)).toHaveLength(1);
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(1);
	});

	it("delivers the reset email even to an unsubscribed address (transactional)", async () => {
		await seedUser();
		await getDb(env)
			.insert(emailSuppressions)
			.values({ email: "sam@example.com", reason: "unsubscribe_link" });
		await post("sam@example.com");
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(1);
	});

	it("rejects a malformed email with a field error and does nothing", async () => {
		const result = (await post("not-an-email")) as { fieldError?: string };
		expect(result.fieldError).toBeTruthy();
		expect(await getDb(env).select().from(passwordResets)).toHaveLength(0);
	});
});
