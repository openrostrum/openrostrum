import { getDb } from "~/db";
import { emailOutbox } from "~/db/schema";

/**
 * EMAIL PORT — the pattern for every external seam (see docs/tech-stack.md).
 * One typed interface, a local adapter (used in dev/tests/worktrees) and a prod
 * adapter. Callers depend on the interface, never on Resend directly.
 */
export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	/** iCalendar text, attached by the sender. Built by a util, not this port. */
	ics?: string;
	/** template+recipient+occurrence — makes sends idempotent (cron-safe). */
	dedupeKey?: string;
}

export interface EmailSender {
	send(msg: EmailMessage): Promise<{ id: string }>;
}

/**
 * Local/dev/test adapter: writes to the D1 `email_outbox` table — the readable
 * inbox agents query to verify a send actually happened. Idempotent on dedupeKey.
 */
export function createLocalEmailSender(env: Env): EmailSender {
	const db = getDb(env);
	return {
		async send(msg) {
			const id = crypto.randomUUID();
			await db
				.insert(emailOutbox)
				.values({
					id,
					dedupeKey: msg.dedupeKey ?? null,
					to: msg.to,
					subject: msg.subject,
					html: msg.html,
					icsAttachment: msg.ics ?? null,
				})
				.onConflictDoNothing({ target: emailOutbox.dedupeKey });
			return { id };
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

/** Resolve the adapter for the current environment. */
export function getEmailSender(env: Env): EmailSender {
	// APP_ENV is typed as its dev literal by `wrangler types`; widen to compare.
	return (env.APP_ENV as string) === "production"
		? createResendEmailSender(env)
		: createLocalEmailSender(env);
}
