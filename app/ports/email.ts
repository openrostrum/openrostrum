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

/** Prod adapter (Resend) — wired in the verification-capabilities phase. */
export function createResendEmailSender(_env: Env): EmailSender {
	return {
		async send() {
			throw new Error(
				"Resend adapter not configured yet (capabilities phase).",
			);
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
