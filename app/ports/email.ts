import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~/db";
import { emailOutbox, emailSuppressions } from "~/db/schema";
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";

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
const SEND_CLAIM_LEASE_MS = 5 * 60 * 1000;

function createSendClaim(now = Date.now()): { id: string; expiresAt: Date } {
	return {
		id: crypto.randomUUID(),
		expiresAt: new Date(now + SEND_CLAIM_LEASE_MS),
	};
}

function sendClaimIsActive(expiresAt: Date | null, now = Date.now()): boolean {
	return expiresAt !== null && expiresAt.getTime() > now;
}

/** base64 of a UTF-8 string — btoa alone corrupts non-Latin1 bytes. */
function base64Utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

/**
 * Prod adapter: real mail via Resend from the verified openrostrum.com domain.
 *
 * Every attempt is recorded in `email_outbox` BEFORE the provider call and
 * resolved to `sent` (with the provider id) or `failed` (with the reason)
 * after it — `/admin/emails/history` is the delivery evidence in prod exactly
 * as it is locally (docs/observability.md), and a provider rejection is a
 * queryable `failed` row, never a vanished send. The outbox row is also the
 * dedupe ledger: a retry of a `sent` dedupeKey short-circuits without calling
 * the provider, while a `failed` row stays retryable in place.
 */
export function createResendEmailSender(env: Env): EmailSender {
	// The verified sender, e.g. "OpenRostrum <noreply@yourdomain.com>". Set per
	// deployment (wrangler var / self-host config) — never hardcode a domain, so
	// a fork sends from THEIR verified Resend domain. Fail loud if missing.
	const from = env.EMAIL_FROM;
	if (!from) {
		throw new Error(
			"EMAIL_FROM is not configured — set it to your verified Resend sender address.",
		);
	}
	const db = getDb(env);
	return {
		async send(msg) {
			const sendClaim = createSendClaim();
			// 1. Claim the outbox row. A dedupeKey conflict means a prior attempt
			// exists: already sent/bounced → done (idempotent), failed/queued →
			// retry on the SAME row so history shows one attempt per key.
			const [inserted] = await db
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
					status: "queued",
					sendClaimId: sendClaim.id,
					sendClaimExpiresAt: sendClaim.expiresAt,
				})
				.onConflictDoNothing({ target: emailOutbox.dedupeKey })
				.returning({ id: emailOutbox.id });

			let outboxId = inserted?.id;
			if (!outboxId) {
				const [existing] = msg.dedupeKey
					? await db
							.select({
								id: emailOutbox.id,
								status: emailOutbox.status,
								providerId: emailOutbox.providerId,
								sendClaimId: emailOutbox.sendClaimId,
								sendClaimExpiresAt: emailOutbox.sendClaimExpiresAt,
							})
							.from(emailOutbox)
							.where(eq(emailOutbox.dedupeKey, msg.dedupeKey))
							.limit(1)
					: [];
				if (!existing) {
					throw new Error("email_outbox insert returned no row");
				}
				if (existing.status === "sent" || existing.status === "bounced") {
					return {
						id: existing.providerId ?? existing.id,
						deduped: true,
						suppressed: false,
					};
				}
				if (
					existing.status === "queued" &&
					sendClaimIsActive(existing.sendClaimExpiresAt)
				) {
					return {
						id: existing.id,
						deduped: true,
						suppressed: false,
					};
				}
				const [claimed] = await db
					.update(emailOutbox)
					.set({
						status: "queued",
						error: null,
						sendClaimId: sendClaim.id,
						sendClaimExpiresAt: sendClaim.expiresAt,
					})
					.where(
						and(
							eq(emailOutbox.id, existing.id),
							eq(emailOutbox.status, existing.status),
							existing.sendClaimId === null
								? isNull(emailOutbox.sendClaimId)
								: eq(emailOutbox.sendClaimId, existing.sendClaimId),
						),
					)
					.returning({ id: emailOutbox.id });
				if (!claimed) {
					return {
						id: existing.id,
						deduped: true,
						suppressed: false,
					};
				}
				outboxId = claimed.id;
			}

			// 2. The provider call — success and failure both land on the row.
			try {
				const body: Record<string, unknown> = {
					from,
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
				// Resend also dedupes server-side on this key for 24h — belt and
				// braces under the outbox ledger above.
				if (msg.dedupeKey) headers["Idempotency-Key"] = msg.dedupeKey;

				const res = await fetch(RESEND_ENDPOINT, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					// Surface for the caller's catch (which logs + shows a generic
					// message); never leak provider detail into the UI. The full
					// reason lives on the failed outbox row for the admin.
					throw new Error(
						`Resend send failed (${res.status}): ${await res.text()}`,
					);
				}
				const data = (await res.json()) as { id: string };
				await db
					.update(emailOutbox)
					.set({
						status: "sent",
						providerId: data.id,
						sentAt: new Date(),
						error: null,
						sendClaimId: null,
						sendClaimExpiresAt: null,
					})
					.where(
						and(
							eq(emailOutbox.id, outboxId),
							eq(emailOutbox.sendClaimId, sendClaim.id),
						),
					);
				return { id: data.id, deduped: false, suppressed: false };
			} catch (error) {
				const reason = errorMessage(error);
				await db
					.update(emailOutbox)
					.set({
						status: "failed",
						error: reason,
						sendClaimId: null,
						sendClaimExpiresAt: null,
					})
					.where(
						and(
							eq(emailOutbox.id, outboxId),
							eq(emailOutbox.sendClaimId, sendClaim.id),
						),
					);
				track("email.send_failed", {
					outboxId,
					eventId: msg.eventId,
					templateId: msg.templateId,
					error: reason,
				});
				throw error;
			}
		},
	};
}

export function hasRealEmailProvider(env: Env): boolean {
	return Boolean(env.RESEND_API_KEY);
}

/**
 * Resolve the adapter by CAPABILITY, not by APP_ENV. The local D1 sink is used
 * only when there is no real provider key configured; prod (with RESEND_API_KEY)
 * always sends real mail, local/test (no key) log to `email_outbox`. This is
 * fail-safe independent of APP_ENV, so a misconfigured env string can never make
 * production silently swallow mail into a table nobody reads.
 */
export function getEmailSender(env: Env): EmailSender {
	const adapter = hasRealEmailProvider(env)
		? createResendEmailSender(env)
		: createLocalEmailSender(env);
	return withSuppression(env, adapter);
}
