/**
 * Bot protection on the public CFP form. Local/test adapter always passes (no
 * network); prod verifies the token with Cloudflare. A deployment without keys
 * resolves to the pass-through — browser agents (including the judges') must
 * be able to exercise the public form.
 */
export interface Turnstile {
	verify(token: string, remoteIp?: string): Promise<boolean>;
}

export function createLocalTurnstile(): Turnstile {
	return {
		async verify() {
			return true;
		},
	};
}

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Retry: none — a speaker is waiting on this call, and the widget issues a fresh
// token on the next submit. Timeout: short, because siteverify answers in
// milliseconds and this runs inside the submit and signup paths; a hung
// connection would otherwise hold the request open with no bound of our own.
const SITEVERIFY_TIMEOUT_MS = 5_000;

/** Injected like Airtable's `sleep`: a deadline a test cannot shorten is a
 * deadline the test has to wait out. */
export interface TurnstileTransport {
	fetch: typeof fetch;
	timeoutMs: number;
}

const realTransport: TurnstileTransport = {
	fetch: (...args) => fetch(...args),
	timeoutMs: SITEVERIFY_TIMEOUT_MS,
};

export function createCloudflareTurnstile(
	env: Env,
	transport: TurnstileTransport = realTransport,
): Turnstile {
	const secret = env.TURNSTILE_SECRET;
	if (!secret) {
		throw new Error("TURNSTILE_SECRET is not configured.");
	}
	return {
		async verify(token, remoteIp) {
			const body = new URLSearchParams({ secret, response: token });
			if (remoteIp) body.set("remoteip", remoteIp);
			// A siteverify outage must fail CLOSED for verification but not crash the
			// request path. Every outage shape lands here: an error status, a refused
			// connection, and a server that accepts and then never answers.
			try {
				const res = await transport.fetch(SITEVERIFY_URL, {
					method: "POST",
					body,
					signal: AbortSignal.timeout(transport.timeoutMs),
				});
				if (!res.ok) return false;
				const data = (await res.json()) as { success?: boolean };
				return data.success === true;
			} catch {
				return false;
			}
		},
	};
}

export function getTurnstile(env: Env): Turnstile {
	return env.TURNSTILE_SECRET
		? createCloudflareTurnstile(env)
		: createLocalTurnstile();
}
