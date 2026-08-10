import { and, eq, type SQL } from "drizzle-orm";
import { getDb } from "~/db";
import { apiTokens, events } from "~/db/schema";
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";

/**
 * Tenant resolution for `x-access-token` bearer tokens (the /api/v1 compat
 * surface). Tokens are organization-scoped, optionally restricted to one
 * event; every read the API serves must stay inside apiTokenEventFilter.
 */

export type ApiTokenPrincipal = {
	id: string;
	organizationId: string;
	/** Non-null = the token may only read this one event of its org. */
	eventId: string | null;
};

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	let hex = "";
	for (const byte of new Uint8Array(digest))
		hex += byte.toString(16).padStart(2, "0");
	return hex;
}

/**
 * Resolve a presented raw token to its tenant, or null (respond 401). Lookup
 * is by SHA-256 — the raw value is never stored. `lastUsedAt` is stamped only
 * on a hit, so garbage tokens can't cause write amplification. Pass
 * `waitUntil` (request handlers) to stamp off the critical path; without it
 * the stamp is awaited (deterministic for tests and jobs).
 */
export async function authenticateApiToken(
	env: Env,
	rawToken: string,
	waitUntil?: (promise: Promise<unknown>) => void,
): Promise<ApiTokenPrincipal | null> {
	const db = getDb(env);
	const tokenHash = await sha256Hex(rawToken);
	const [row] = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.tokenHash, tokenHash))
		.limit(1);
	if (!row) return null;
	const stamp = async () => {
		try {
			await db
				.update(apiTokens)
				.set({ lastUsedAt: new Date() })
				.where(eq(apiTokens.id, row.id));
		} catch (error) {
			// A failed stamp must never fail the authenticated request.
			track("api.token_stamp_failed", {
				tokenId: row.id,
				error: errorMessage(error),
			});
		}
	};
	if (waitUntil) waitUntil(stamp());
	else await stamp();
	return {
		id: row.id,
		organizationId: row.organizationId,
		eventId: row.eventId,
	};
}

/**
 * The `events`-table predicate bounding everything this token may read — its
 * org's events, or just the restricted one. The org predicate applies even
 * when a restriction is set, so a misconfigured restriction naming another
 * org's event yields an empty set (fails closed), never a cross-org grant.
 */
export function apiTokenEventFilter(principal: ApiTokenPrincipal): SQL {
	const filter = and(
		eq(events.organizationId, principal.organizationId),
		principal.eventId ? eq(events.id, principal.eventId) : undefined,
	);
	if (!filter) throw new Error("empty api-token event filter");
	return filter;
}

/** The event ids this token may read. */
export async function listApiTokenEventIds(
	env: Env,
	principal: ApiTokenPrincipal,
): Promise<string[]> {
	const rows = await getDb(env)
		.select({ id: events.id })
		.from(events)
		.where(apiTokenEventFilter(principal));
	return rows.map((r) => r.id);
}

/**
 * Resolve one eventId inside the token's readable set, or null. Callers must
 * answer null with 404 — existence-hiding, so probing other orgs' event ids
 * is indistinguishable from probing ids that don't exist.
 */
export async function resolveApiTokenEvent(
	env: Env,
	principal: ApiTokenPrincipal,
	eventId: string,
): Promise<typeof events.$inferSelect | null> {
	const [row] = await getDb(env)
		.select()
		.from(events)
		.where(and(eq(events.id, eventId), apiTokenEventFilter(principal)))
		.limit(1);
	return row ?? null;
}
