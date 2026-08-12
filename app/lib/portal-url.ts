import { asc, eq } from "drizzle-orm";
import type { Db } from "~/db";
import { portals } from "~/db/schema";
import { hasRealEmailProvider } from "~/ports/email";

export function portalUrl(
	origin: string,
	eventSlug: string,
	portalPublicId: string,
): string {
	return `${origin}/portals/${eventSlug}/${portalPublicId}`;
}

/**
 * The event's canonical portal for email links = its FIRST portal (creation
 * order). One home for that rule; callers take `.get(eventId)`. Request paths
 * MUST pass their event id — only the cross-event cron reads unscoped.
 */
export async function firstPortalsByEvent(
	db: Db,
	eventId?: string,
): Promise<Map<string, string>> {
	const rows = await db
		.select({ eventId: portals.eventId, publicId: portals.publicId })
		.from(portals)
		.where(eventId ? eq(portals.eventId, eventId) : undefined)
		.orderBy(asc(portals.createdAt));
	const byEvent = new Map<string, string>();
	for (const row of rows) {
		if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, row.publicId);
	}
	return byEvent;
}

/**
 * Origin for links in emails sent OUTSIDE a request (cron); request-driven
 * senders derive it from `request.url`. With a real mail provider configured, a
 * missing APP_ORIGIN is a deployment misconfiguration — fail loudly rather than
 * ship link-less emails (the EMAIL_FROM precedent). Without one, null is fine.
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
