import { and, eq } from "drizzle-orm";
import { getDb } from "~/db";
import { apiTokens, events } from "~/db/schema";

/**
 * Tenant resolution for `x-access-token` bearer tokens (the /api/v1 compat
 * surface). Tokens are organization-scoped, optionally restricted to one
 * event; every read the API serves must stay inside listApiTokenEventIds.
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
 * on a hit, so garbage tokens can't cause write amplification.
 */
export async function authenticateApiToken(
	env: Env,
	rawToken: string,
): Promise<ApiTokenPrincipal | null> {
	const db = getDb(env);
	const tokenHash = await sha256Hex(rawToken);
	const [row] = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.tokenHash, tokenHash))
		.limit(1);
	if (!row) return null;
	await db
		.update(apiTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiTokens.id, row.id));
	return {
		id: row.id,
		organizationId: row.organizationId,
		eventId: row.eventId,
	};
}

/**
 * The event ids this token may read — all its org's events, or just the
 * restricted one. The org predicate applies even when a restriction is set,
 * so a misconfigured restriction naming another org's event yields an empty
 * set (fails closed), never a cross-org grant.
 */
export async function listApiTokenEventIds(
	env: Env,
	principal: ApiTokenPrincipal,
): Promise<string[]> {
	const rows = await getDb(env)
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.organizationId, principal.organizationId),
				principal.eventId ? eq(events.id, principal.eventId) : undefined,
			),
		);
	return rows.map((r) => r.id);
}
