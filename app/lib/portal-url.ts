import { asc } from "drizzle-orm";
import type { Db } from "~/db";
import { portals } from "~/db/schema";
import { hasRealEmailProvider } from "~/ports/email";

/** Single home for the speaker-portal URL shape used in emails. */
export function portalUrl(
	origin: string,
	eventSlug: string,
	portalPublicId: string,
): string {
	return `${origin}/portals/${eventSlug}/${portalPublicId}`;
}

/**
 * The event's canonical portal for email links = its FIRST portal (creation
 * order). One home for that rule; callers take `.get(eventId)`.
 */
export async function firstPortalsByEvent(
	db: Db,
): Promise<Map<string, string>> {
	const rows = await db
		.select({ eventId: portals.eventId, publicId: portals.publicId })
		.from(portals)
		.orderBy(asc(portals.createdAt));
	const byEvent = new Map<string, string>();
	for (const row of rows) {
		if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, row.publicId);
	}
	return byEvent;
}

/**
 * Origin for links in emails sent OUTSIDE a request (cron). Request-driven
 * senders derive it from `request.url` instead. When a real mail provider is
 * configured, a missing APP_ORIGIN is a deployment misconfiguration — fail
 * loudly rather than ship link-less emails forever (the EMAIL_FROM precedent).
 * Without a provider (local dev/test outbox), null is fine: register the var
 * in .dev.vars to get full links locally.
 */
export function emailOrigin(env: Env): string | null {
	if (env.APP_ORIGIN) return env.APP_ORIGIN;
	if (hasRealEmailProvider(env)) {
		throw new Error(
			"APP_ORIGIN is not configured — cron emails need absolute portal links. Set the APP_ORIGIN var for this deployment.",
		);
	}
	return null;
}
