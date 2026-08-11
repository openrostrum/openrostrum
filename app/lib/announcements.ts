import {
	type EmailMessage,
	type EmailResult,
	getEmailSender,
} from "~/ports/email";
import {
	assertUnsubscribeSigningConfigured,
	unsubscribeUrl,
} from "~/lib/unsubscribe";

/**
 * Throws when this deployment cannot send a compliant announcement (the
 * unsubscribe footer would be unmintable). Callers run it BEFORE a recipient
 * loop so a configuration failure surfaces as one actionable error — never as
 * a per-recipient "failed" outcome. The thrown message is the operator-facing
 * copy; don't rewrite it at the call site.
 */
export function assertAnnouncementsConfigured(env: Env): void {
	assertUnsubscribeSigningConfigured(env);
}

async function appendUnsubscribeFooter(
	env: Env,
	html: string,
	origin: string,
	email: string,
): Promise<string> {
	const url = await unsubscribeUrl(env, origin, email);
	return `${html}<hr style="margin-top:24px;border:none;border-top:1px solid #ddd" /><p style="font-size:12px;color:#777">You received this announcement from an event organizer. <a href="${url}">Unsubscribe</a> from announcements — you'll still receive emails about your own submissions.</p>`;
}

/**
 * THE way to send an announcement. Couples the three things no bulk send may
 * separate — the unsubscribe footer, `kind: "bulk"` (suppression check), and
 * a required dedupeKey (a retried blast must not deliver twice) — into one
 * call, so a compliant send is the only send a caller can write.
 * Transactional mail (about the recipient's own submissions/account) goes
 * through the EmailSender port directly and never carries the footer.
 */
export async function sendAnnouncement(
	env: Env,
	origin: string,
	msg: Omit<EmailMessage, "kind"> & { dedupeKey: string },
): Promise<EmailResult> {
	const html = await appendUnsubscribeFooter(env, msg.html, origin, msg.to);
	return getEmailSender(env).send({ ...msg, html, kind: "bulk" });
}
