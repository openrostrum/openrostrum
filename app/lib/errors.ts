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
