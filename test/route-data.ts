/**
 * Shared `data()`-unwrapping for loader/action tests, replacing ten
 * near-identical copies. The feature helper files re-export it.
 */
import type { data } from "react-router";

/** What `data(payload, init)` returns: the payload plus the response init. */
export type Wrapped<T> = ReturnType<typeof data<T>>;

/**
 * A handler returns the payload or a tagged `data(payload, init)` — read the
 * tag. The copies this replaces asked `"data" in result`, which over-matches.
 */
export function unwrap<T>(result: unknown): T {
	const wrapped = result as Partial<Wrapped<T>>;
	return wrapped?.type === "DataWithResponseInit"
		? (wrapped.data as T)
		: (result as T);
}
