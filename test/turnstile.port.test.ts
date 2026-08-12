import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	createCloudflareTurnstile,
	getTurnstile,
	type TurnstileTransport,
} from "../app/ports/turnstile";

const KEYED = { ...env, TURNSTILE_SECRET: "secret" } as typeof env;

// Short enough that the deadline firing is part of the test rather than a wait.
const TEST_TIMEOUT_MS = 20;

function transport(fetchImpl: TurnstileTransport["fetch"]): TurnstileTransport {
	return { fetch: fetchImpl, timeoutMs: TEST_TIMEOUT_MS };
}

const answers = (success: boolean) =>
	transport(
		(async () =>
			new Response(JSON.stringify({ success }), {
				headers: { "Content-Type": "application/json" },
			})) as unknown as TurnstileTransport["fetch"],
	);

describe("turnstile siteverify", () => {
	it("passes a verified token and refuses an unverified one", async () => {
		expect(
			await createCloudflareTurnstile(KEYED, answers(true)).verify("t"),
		).toBe(true);
		expect(
			await createCloudflareTurnstile(KEYED, answers(false)).verify("t"),
		).toBe(false);
	});

	// This call sits in the CFP submit and signup paths, so every outage shape has
	// to fail closed rather than reach the speaker as an error page. The status
	// branch was already handled; a refused connection was not.
	it("fails closed when siteverify errors or refuses the connection", async () => {
		const status = transport(
			(async () =>
				new Response("upstream", {
					status: 502,
				})) as unknown as TurnstileTransport["fetch"],
		);
		expect(await createCloudflareTurnstile(KEYED, status).verify("t")).toBe(
			false,
		);

		const refused = transport((async () => {
			throw new TypeError("network error");
		}) as unknown as TurnstileTransport["fetch"]);
		expect(await createCloudflareTurnstile(KEYED, refused).verify("t")).toBe(
			false,
		);
	});

	// The outage the adapter had no answer for: a server that accepts and then
	// says nothing, which nothing here bounded, so a speaker's submit hung until
	// the platform gave up. The fake settles only because the adapter's own
	// deadline aborts it — remove the deadline and this test hangs, not fails.
	it("gives up on a siteverify that accepts the connection and never answers", async () => {
		const silent = transport(
			((_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("timed out", "TimeoutError")),
					);
				})) as unknown as TurnstileTransport["fetch"],
		);

		expect(await createCloudflareTurnstile(KEYED, silent).verify("t")).toBe(
			false,
		);
	});

	it("passes through when no secret is configured, so agents can submit", async () => {
		expect(await getTurnstile(env).verify("anything")).toBe(true);
	});
});
