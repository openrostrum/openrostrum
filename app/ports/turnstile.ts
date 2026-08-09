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

/** Prod: Cloudflare Turnstile siteverify — wired in the capabilities phase. */
export function createCloudflareTurnstile(_env: Env): Turnstile {
	return {
		async verify() {
			throw new Error(
				"Turnstile adapter not configured yet (capabilities phase).",
			);
		},
	};
}

export function getTurnstile(env: Env): Turnstile {
	return env.TURNSTILE_SECRET
		? createCloudflareTurnstile(env)
		: createLocalTurnstile();
}
