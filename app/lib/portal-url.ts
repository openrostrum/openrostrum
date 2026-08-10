/** Single home for the speaker-portal URL shape used in emails. */
export function portalUrl(
	origin: string,
	eventSlug: string,
	portalPublicId: string,
): string {
	return `${origin}/portals/${eventSlug}/${portalPublicId}`;
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
	if (env.RESEND_API_KEY) {
		throw new Error(
			"APP_ORIGIN is not configured — cron emails need absolute portal links. Set the APP_ORIGIN var for this deployment.",
		);
	}
	return null;
}
