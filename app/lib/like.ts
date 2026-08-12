import type { AnyColumn, SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

/**
 * %/_ in a user's search term are literals, not wildcards. Escaping the pattern
 * only works when the query also declares the escape character, and drizzle's
 * `like()` emits none — so this returns the whole predicate, keeping the two
 * halves impossible to separate. Every search box goes through it.
 */
export function likeContains(column: AnyColumn | SQL, term: string): SQL {
	const pattern = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
	return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
