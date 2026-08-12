import { z } from "zod";

/**
 * JavaScript lets anything be thrown, so reading a caught value is a parse:
 * an Error carries its own message, a string IS one, anything else has to be
 * serialized before it can become one.
 */
const Thrown = z.union([
	z.instanceof(Error),
	z.string().transform((message) => new Error(message)),
	z.unknown().transform((value) => new Error(JSON.stringify(value))),
]);

/**
 * Shared caught-error boundary. The `prefer-error-normalizer` lint rule bans
 * inline `x instanceof Error ? x.message : ...` ternaries in favor of these.
 */
export function toError(value: unknown): Error {
	return Thrown.parse(value);
}

export function errorMessage(value: unknown): string {
	return toError(value).message;
}

/**
 * Drizzle wraps D1 failures ("Failed query: …") with the real constraint
 * message on `cause` — batch failures surface it on the top-level message —
 * so constraint detection must walk the WHOLE chain, including non-Error
 * links (workerd sometimes throws plain objects).
 */
function* errorChainMessages(error: unknown): Generator<string> {
	for (
		let current: unknown = error;
		current != null;
		current = (current as { cause?: unknown }).cause
	) {
		yield errorMessage(current);
	}
}

export function errorChainIncludes(error: unknown, needle: string): boolean {
	for (const message of errorChainMessages(error)) {
		if (message.includes(needle)) return true;
	}
	return false;
}

export function errorName(value: unknown): string {
	return toError(value).name;
}

/** True when the error (or anything on its cause chain — drizzle wraps the
 * original D1 error) is a SQLite UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
	for (const message of errorChainMessages(error)) {
		if (/unique constraint failed/i.test(message)) return true;
	}
	return false;
}
