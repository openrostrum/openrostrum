import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { emailSuppressions } from "../app/db/schema";
import {
	appendUnsubscribeFooter,
	mintUnsubscribeToken,
	verifyUnsubscribeToken,
} from "../app/lib/unsubscribe";
import { action, loader } from "../app/routes/unsubscribe.$token";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function args(token: string, init?: RequestInit) {
	return {
		context: CONTEXT,
		request: new Request(`http://localhost/unsubscribe/${token}`, init),
		params: { token },
	} as unknown as Parameters<typeof loader>[0];
}

describe("unsubscribe token", () => {
	it("round-trips and normalizes the address", async () => {
		const token = await mintUnsubscribeToken(env, " Leo@Example.COM ");
		expect(await verifyUnsubscribeToken(env, token)).toBe("leo@example.com");
	});

	it("rejects a tampered signature and garbage tokens", async () => {
		const token = await mintUnsubscribeToken(env, "leo@example.com");
		const [payload, sig] = token.split(".") as [string, string];
		const flipped = `${payload}.${sig.slice(0, -2)}${sig.slice(-2, -1) === "A" ? "BB" : "AA"}`;
		expect(await verifyUnsubscribeToken(env, flipped)).toBeNull();
		expect(await verifyUnsubscribeToken(env, "not-a-token")).toBeNull();
		expect(await verifyUnsubscribeToken(env, `${payload}.`)).toBeNull();
	});

	it("keys the HMAC on the secret — a token minted under one secret fails under another", async () => {
		const envA = { ...env, UNSUBSCRIBE_SECRET: "secret-a" } as Env;
		const envB = { ...env, UNSUBSCRIBE_SECRET: "secret-b" } as Env;
		const token = await mintUnsubscribeToken(envA, "leo@example.com");
		expect(await verifyUnsubscribeToken(envA, token)).toBe("leo@example.com");
		expect(await verifyUnsubscribeToken(envB, token)).toBeNull();
	});

	it("fails loud when real mail is configured without a signing secret", async () => {
		const prodish = { ...env, RESEND_API_KEY: "re_x" } as Env;
		await expect(
			mintUnsubscribeToken(prodish, "leo@example.com"),
		).rejects.toThrow(/UNSUBSCRIBE_SECRET/);
	});

	it("footer carries a working unsubscribe link for that recipient", async () => {
		const html = await appendUnsubscribeFooter(
			env,
			"<p>News</p>",
			"http://localhost",
			"leo@example.com",
		);
		const url = html.match(/href="([^"]+)"/)?.[1];
		expect(url).toContain("http://localhost/unsubscribe/");
		const token = url?.split("/unsubscribe/")[1] ?? "";
		expect(await verifyUnsubscribeToken(env, token)).toBe("leo@example.com");
		expect(html).toContain("your own submissions");
	});
});

describe("unsubscribe route", () => {
	it("valid link: confirm state, then POST writes exactly one suppression", async () => {
		const db = getDb(env);
		const token = await mintUnsubscribeToken(env, "leo@example.com");

		const view = await loader(args(token));
		expect(view).toEqual({ state: "confirm", email: "leo@example.com" });

		const result = await action(args(token, { method: "POST" }));
		expect(result).toEqual({ state: "done", email: "leo@example.com" });
		// Second confirm (double-click / re-visit) is a no-op, not an error.
		await action(args(token, { method: "POST" }));
		const rows = await db.select().from(emailSuppressions);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.email).toBe("leo@example.com");
	});

	it("already-unsubscribed link shows done without needing another POST", async () => {
		await getDb(env)
			.insert(emailSuppressions)
			.values({ email: "leo@example.com" });
		const token = await mintUnsubscribeToken(env, "leo@example.com");
		expect(await loader(args(token))).toEqual({
			state: "done",
			email: "leo@example.com",
		});
	});

	it("tampered token: invalid state and NO suppression written", async () => {
		const result = await action(args("bad.token", { method: "POST" }));
		expect(result).toEqual({ state: "invalid", email: null });
		expect(await getDb(env).select().from(emailSuppressions)).toHaveLength(0);
	});
});
