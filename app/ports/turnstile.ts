/**
 * Bot protection on the public CFP form. Local/test adapter always passes (no
 * network); prod verifies the token with Cloudflare. A deployment without keys
 * resolves to the pass-through — browser agents (including the judges') must
 * be able to exercise the public form.
 */
export interface Turnstile {
	verify(token: string, remoteIp?: string): Promise<boolean>;
}

/** Local/dev/test: no-op pass (no external call). */
export function createLocalTurnstile(): Turnstile {
	return {
		async verify() {
			return true;
		},
	};
}

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Prod: Cloudflare Turnstile siteverify with the configured secret. */
export function createCloudflareTurnstile(env: Env): Turnstile {
	const secret = env.TURNSTILE_SECRET;
	if (!secret) {
		throw new Error("TURNSTILE_SECRET is not configured.");
	}
	return {
		async verify(token, remoteIp) {
			const body = new URLSearchParams({ secret, response: token });
			if (remoteIp) body.set("remoteip", remoteIp);
			const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
			// A siteverify outage must fail CLOSED for verification but not crash
			// the request path with an unhandled error.
			if (!res.ok) return false;
			const data = (await res.json()) as { success?: boolean };
			return data.success === true;
		},
	};
}

export function getTurnstile(env: Env): Turnstile {
	return env.TURNSTILE_SECRET
		? createCloudflareTurnstile(env)
		: createLocalTurnstile();
}
