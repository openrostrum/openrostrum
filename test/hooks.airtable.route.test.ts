import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { action, loader } from "../app/routes/hooks.airtable";
import { readSyncState } from "../app/sync/runner";

// The webhook receiver's contract: HMAC-verified (X-Airtable-Content-MAC over
// the raw body), 200 fast with the reconcile tick handed to waitUntil — and a
// hard rejection for anything unsigned, mis-signed, or aimed at another base.

const SECRET_B64 = btoa("test-webhook-secret");
const BASE_ID = "appTESTBASE";

async function sign(body: string, secretB64 = SECRET_B64): Promise<string> {
	const secret = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		"raw",
		secret,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
	);
	return `hmac-sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function ping(timestamp = "2026-08-10T12:00:00.000Z"): string {
	return JSON.stringify({
		base: { id: BASE_ID },
		webhook: { id: "ach00000000000000" },
		timestamp,
	});
}

function makeContext(overrides: Record<string, unknown> = {}) {
	const scheduled: Promise<unknown>[] = [];
	const testEnv = {
		...env,
		AIRTABLE_WEBHOOK_SECRET: SECRET_B64,
		AIRTABLE_BASE_ID: BASE_ID,
		...overrides,
	};
	return {
		scheduled,
		context: {
			cloudflare: {
				env: testEnv,
				ctx: {
					waitUntil: (p: Promise<unknown>) => {
						scheduled.push(p);
					},
				},
			},
		},
	};
}

function post(body: string, mac?: string): Request {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (mac) headers.set("X-Airtable-Content-MAC", mac);
	return new Request("http://localhost/hooks/airtable", {
		method: "POST",
		body,
		headers,
	});
}

type ActionArgs = Parameters<typeof action>[0];

describe("POST /hooks/airtable", () => {
	it("rejects GET navigation", async () => {
		const response = await loader();
		expect(response.status).toBe(405);
	});

	it("responds 503 when no webhook secret is configured (fail loud, never a silent no-op)", async () => {
		const { context } = makeContext({ AIRTABLE_WEBHOOK_SECRET: undefined });
		const body = ping();
		const response = (await action({
			context,
			request: post(body, await sign(body)),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(503);
	});

	it("rejects a ping with a wrong signature and schedules no work", async () => {
		const { context, scheduled } = makeContext();
		const body = ping();
		const response = (await action({
			context,
			request: post(body, await sign(body, btoa("some-other-secret"))),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(401);
		expect(scheduled).toHaveLength(0);
		expect((await readSyncState(getDb(env))).lastWebhookAt).toBeUndefined();
	});

	it("rejects an unsigned ping", async () => {
		const { context, scheduled } = makeContext();
		const response = (await action({
			context,
			request: post(ping()),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(401);
		expect(scheduled).toHaveLength(0);
	});

	it("rejects a correctly signed ping for a different base", async () => {
		const { context, scheduled } = makeContext();
		const body = JSON.stringify({
			base: { id: "appSOMEOTHERBASE" },
			webhook: { id: "ach1" },
			timestamp: "2026-08-10T12:00:00.000Z",
		});
		const response = (await action({
			context,
			request: post(body, await sign(body)),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(401);
		expect(scheduled).toHaveLength(0);
	});

	it("rejects a signed but malformed payload", async () => {
		const { context, scheduled } = makeContext();
		const body = "not-json";
		const response = (await action({
			context,
			request: post(body, await sign(body)),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(400);
		expect(scheduled).toHaveLength(0);
	});

	it("accepts a verified ping: 200 immediately, tick scheduled out-of-band, ping timestamp recorded", async () => {
		const { context, scheduled } = makeContext();
		const body = ping("2026-08-10T12:34:56.000Z");
		const response = (await action({
			context,
			request: post(body, await sign(body)),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(scheduled).toHaveLength(1);
		// No AIRTABLE_API_KEY in the test env → the scheduled tick resolves as
		// not-configured without any network I/O.
		await expect(scheduled[0]).resolves.toMatchObject({
			status: "not_configured",
		});
		expect((await readSyncState(getDb(env))).lastWebhookAt).toBe(
			"2026-08-10T12:34:56.000Z",
		);
	});

	it("still accepts an at-least-once replay of an old ping (idempotent by design)", async () => {
		const { context, scheduled } = makeContext();
		const first = ping("2026-08-10T12:34:56.000Z");
		await action({
			context,
			request: post(first, await sign(first)),
			params: {},
		} as unknown as ActionArgs);
		const replay = ping("2026-08-10T12:00:00.000Z");
		const response = (await action({
			context,
			request: post(replay, await sign(replay)),
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(200);
		expect(scheduled).toHaveLength(2);
		// The high-water mark is kept, not regressed by the replay.
		expect((await readSyncState(getDb(env))).lastWebhookAt).toBe(
			"2026-08-10T12:34:56.000Z",
		);
	});
});
