import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { emailOutbox, emailSuppressions } from "~/db/schema";

/** Callers depend on this interface, never on Resend directly. */
export interface EmailMessage {
	to: string;
	/** Organizer inbox that speaker replies should land in (from the template). */
	replyTo?: string;
	subject: string;
	html: string;
	/** iCalendar text, attached by the sender. Built by a util, not this port. */
	ics?: string;
	/** template+recipient+occurrence — makes sends idempotent (cron-safe). */
	dedupeKey?: string;
	eventId?: string;
	templateId?: string;
	/**
	 * "transactional" (default) = every email that is a consequence of the
	 * recipient's own submission/account: confirmations, ACCEPT/DECLINE
	 * decisions, invites, password resets, task-due + draft-close reminders,
	 * schedule updates — ALWAYS delivered (unsubscribing must never hide an
	 * acceptance). "bulk" = general announcements only (the compose-to-speakers
	 * blast) — SKIPPED for suppressed (unsubscribed) recipients and carries the
	 * unsubscribe footer. Callers of announcement sends MUST set "bulk".
	 */
	kind?: "transactional" | "bulk";
}

export interface EmailResult {
	/** The email_outbox row id (local) or provider id (prod). "" if suppressed. */
	id: string;
	/** True when a prior send with the same dedupeKey already existed. */
	deduped: boolean;
	/** True when skipped because the recipient is on the suppression list. */
	suppressed: boolean;
}

export interface EmailSender {
	send(msg: EmailMessage): Promise<EmailResult>;
}

/**
 * Local/dev/test adapter: writes to the D1 `email_outbox` table — the readable
 * inbox agents query to verify a send actually happened. Idempotent on
 * dedupeKey: a duplicate returns the ORIGINAL row's id with `deduped: true`
 * (never a fabricated id), so the verification oracle stays truthful.
 */
export function createLocalEmailSender(env: Env): EmailSender {
	const db = getDb(env);
	return {
		async send(msg) {
			const [row] = await db
				.insert(emailOutbox)
				.values({
					dedupeKey: msg.dedupeKey ?? null,
					to: msg.to,
					replyTo: msg.replyTo ?? null,
					subject: msg.subject,
					html: msg.html,
					icsAttachment: msg.ics ?? null,
					eventId: msg.eventId ?? null,
					templateId: msg.templateId ?? null,
					status: "sent",
					sentAt: new Date(),
				})
				.onConflictDoNothing({ target: emailOutbox.dedupeKey })
				.returning({ id: emailOutbox.id });

			if (row) return { id: row.id, deduped: false, suppressed: false };

			// Dedupe hit → return the existing row's real id.
			const existing = msg.dedupeKey
				? await db
						.select({ id: emailOutbox.id })
						.from(emailOutbox)
						.where(eq(emailOutbox.dedupeKey, msg.dedupeKey))
						.limit(1)
				: [];
			return {
				id: existing[0]?.id ?? crypto.randomUUID(),
				deduped: true,
				suppressed: false,
			};
		},
	};
}

/**
 * Suppression gate: a `kind: "bulk"` message to a suppressed (unsubscribed)
 * address is dropped BEFORE the adapter runs; transactional messages always
 * pass. Both adapters inherit it via getEmailSender, so no caller can forget
 * the check.
 */
function withSuppression(env: Env, sender: EmailSender): EmailSender {
	const db = getDb(env);
	return {
		async send(msg) {
			if (msg.kind === "bulk") {
				const addr = msg.to.trim().toLowerCase();
				const [hit] = await db
					.select({ id: emailSuppressions.id })
					.from(emailSuppressions)
					.where(eq(emailSuppressions.email, addr))
					.limit(1);
				if (hit) return { id: "", deduped: false, suppressed: true };
			}
			return sender.send(msg);
		},
	};
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Verified sending domain (see VERIFICATION-CAPABILITIES.md #4). SPF/DKIM live
// on openrostrum.com; sending as any other domain silently fails delivery.
const DEFAULT_FROM = "OpenRostrum <noreply@openrostrum.com>";

/** base64 of a UTF-8 string — btoa alone corrupts non-Latin1 bytes. */
function base64Utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

/** Prod adapter: real mail via Resend from the verified openrostrum.com domain. */
export function createResendEmailSender(env: Env): EmailSender {
	return {
		async send(msg) {
			const body: Record<string, unknown> = {
				from: DEFAULT_FROM,
				to: [msg.to],
				subject: msg.subject,
				html: msg.html,
			};
			if (msg.replyTo) body.reply_to = msg.replyTo;
			if (msg.ics) {
				body.attachments = [
					{
						filename: "invite.ics",
						content: base64Utf8(msg.ics),
						content_type: "text/calendar; method=REQUEST",
					},
				];
			}
			const headers: Record<string, string> = {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			};
			// Resend dedupes server-side on this key for 24h, so a retried send
			// (cron re-run, double-submit) never delivers twice.
			if (msg.dedupeKey) headers["Idempotency-Key"] = msg.dedupeKey;

			const res = await fetch(RESEND_ENDPOINT, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				// Surface for the caller's catch (which logs + shows a generic
				// message); never leak provider detail into the UI.
				throw new Error(
					`Resend send failed (${res.status}): ${await res.text()}`,
				);
			}
			const data = (await res.json()) as { id: string };
			return { id: data.id, deduped: false, suppressed: false };
		},
	};
}

/**
 * Resolve the adapter by CAPABILITY, not by APP_ENV. The local D1 sink is used
 * only when there is no real provider key configured; prod (with RESEND_API_KEY)
 * always sends real mail, local/test (no key) log to `email_outbox`. This is
 * fail-safe independent of APP_ENV, so a misconfigured env string can never make
 * production silently swallow mail into a table nobody reads.
 */
export function getEmailSender(env: Env): EmailSender {
	const adapter = env.RESEND_API_KEY
		? createResendEmailSender(env)
		: createLocalEmailSender(env);
	return withSuppression(env, adapter);
}
