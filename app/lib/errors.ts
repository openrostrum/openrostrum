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

export function errorName(value: unknown): string {
	return toError(value).name;
}

/** True when the error (or anything on its cause chain — drizzle wraps the
 * original D1 error) is a SQLite UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
	for (
		let current: unknown = error;
		current != null;
		current = (current as { cause?: unknown }).cause
	) {
		if (/unique constraint failed/i.test(errorMessage(current))) return true;
	}
	return false;
}
