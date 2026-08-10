/**
 * Shared caught-error boundary. The `prefer-error-normalizer` lint rule bans
 * inline `x instanceof Error ? x.message : ...` ternaries in favor of these.
 * (Uses an `if`, not a ternary, so it doesn't trip its own rule.)
 */
export function toError(value: unknown): Error {
	if (value instanceof Error) return value;
	return new Error(typeof value === "string" ? value : JSON.stringify(value));
}

export function errorMessage(value: unknown): string {
	return toError(value).message;
}

/**
 * Drizzle wraps D1 failures ("Failed query: …") with the real constraint
 * message on `cause` — batch failures surface it on the top-level message —
 * so constraint detection must walk the whole chain.
 */
export function errorChainIncludes(error: unknown, needle: string): boolean {
	for (let e: unknown = error; e instanceof Error; e = e.cause) {
		if (e.message.includes(needle)) return true;
	}
	return false;
}

export function errorName(value: unknown): string {
	return toError(value).name;
}
