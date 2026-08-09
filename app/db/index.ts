import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Build a Drizzle client bound to this request's D1 database.
 * Call from a loader/action with the Cloudflare env:
 *   const db = getDb(context.cloudflare.env);
 */
export function getDb(env: Env) {
	return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
export * as schema from "./schema";
