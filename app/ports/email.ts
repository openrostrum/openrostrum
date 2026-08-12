import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, type Db } from "~/db";
import { emailOutbox, emailSuppressions } from "~/db/schema";
import { sha256Hex } from "~/lib/api-token";
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
	/**
	 * What a LIVE claimant on the same `dedupeKey` means to this caller.
	 * "dedupe" (default) — report it like any other duplicate: right for the
	 * user-initiated route actions, where a double-clicked button must stay a
	 * no-op instead of becoming an error page.
	 * "reject" — throw `EmailSendInFlightError`. Required wherever the caller
	 * writes durable delivered-state (`submissions.notified_at`, the calendar
	 * sequence frontier) that must never be stamped for a delivery this request
	 * did not complete.
	 */
	onInFlight?: "dedupe" | "reject";
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

/** A provider or network outcome the caller may report as a delivery failure. */
export class EmailDeliveryError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "EmailDeliveryError";
	}
}

/** A matching provider send still owns the outbox row; retry after its lease. */
export class EmailSendInFlightError extends Error {
	constructor() {
		super("An email with this delivery key is already in flight.");
		this.name = "EmailSendInFlightError";
	}
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
						.select({ id: emailOutbox.id, status: emailOutbox.status })
						.from(emailOutbox)
						.where(eq(emailOutbox.dedupeKey, msg.dedupeKey))
						.limit(1)
				: [];
			const prior = existing[0];
			if (!prior) {
				return { id: crypto.randomUUID(), deduped: true, suppressed: false };
			}
			// Only a row that REACHED the recipient dedupes. A failed or abandoned
			// attempt is retried on its own row — as the Resend adapter does — so a
			// deployment without a provider key can still clear a stuck send, and
			// the row keeps showing what the retry actually delivered.
			if (prior.status !== "sent" && prior.status !== "bounced") {
				const [retried] = await db
					.update(emailOutbox)
					.set({
						to: msg.to,
						replyTo: msg.replyTo ?? null,
						subject: msg.subject,
						html: msg.html,
						icsAttachment: msg.ics ?? null,
						templateId: msg.templateId ?? null,
						status: "sent",
						sentAt: new Date(),
						error: null,
						sendClaimId: null,
						sendClaimExpiresAt: null,
					})
					.where(
						and(
							eq(emailOutbox.id, prior.id),
							ne(emailOutbox.status, "sent"),
							ne(emailOutbox.status, "bounced"),
						),
					)
					.returning({ id: emailOutbox.id });
				if (retried) {
					return { id: retried.id, deduped: false, suppressed: false };
				}
			}
			return { id: prior.id, deduped: true, suppressed: false };
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

/**
 * A live claimant owns this dedupe identity. Either that is this caller's
 * problem (it keeps delivered-state) or it is the same outcome as any other
 * duplicate — the winning request is delivering exactly this message.
 */
function inFlightOutcome(
	onInFlight: EmailMessage["onInFlight"],
	row: { id: string; providerId?: string | null },
): EmailResult {
	if (onInFlight === "reject") throw new EmailSendInFlightError();
	return { id: row.providerId ?? row.id, deduped: true, suppressed: false };
}

async function reconcileSendClaim(
	db: Db,
	outboxId: string,
	onInFlight: EmailMessage["onInFlight"],
): Promise<EmailResult> {
	const [current] = await db
		.select({
			id: emailOutbox.id,
			status: emailOutbox.status,
			providerId: emailOutbox.providerId,
			sendClaimExpiresAt: emailOutbox.sendClaimExpiresAt,
		})
		.from(emailOutbox)
		.where(eq(emailOutbox.id, outboxId))
		.limit(1);
	if (!current) throw new Error("email_outbox row disappeared during delivery");
	if (current.status === "sent" || current.status === "bounced") {
		return {
			id: current.providerId ?? current.id,
			deduped: true,
			suppressed: false,
		};
	}
	if (
		current.status === "queued" &&
		sendClaimIsActive(current.sendClaimExpiresAt)
	) {
		return inFlightOutcome(onInFlight, current);
	}
	throw new Error(
		`email_outbox delivery claim could not be reconciled from ${current.status}`,
	);
}

/**
 * Provider idempotency key: readable dedupeKey prefix (so a Resend log entry
 * still names the send) plus a digest of the key AND the exact request body.
 * The digest covers the full dedupeKey, so truncating the prefix cannot make
 * two different keys collide. Bounded well under Resend's 256-char limit.
 */
async function payloadScopedIdempotencyKey(
	dedupeKey: string,
	body: Record<string, unknown>,
): Promise<string> {
	const digest = await sha256Hex(`${dedupeKey}\n${JSON.stringify(body)}`);
	return `${dedupeKey.slice(0, 120)}:${digest.slice(0, 32)}`;
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
					return inFlightOutcome(msg.onInFlight, existing);
				}
				const [claimed] = await db
					.update(emailOutbox)
					.set({
						// The row is the delivery evidence AND the source the calendar
						// ledger normalizes: keeping a superseded payload here would
						// record an invite that no speaker ever received.
						to: msg.to,
						replyTo: msg.replyTo ?? null,
						subject: msg.subject,
						html: msg.html,
						icsAttachment: msg.ics ?? null,
						templateId: msg.templateId ?? null,
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
					return inFlightOutcome(msg.onInFlight, existing);
				}
				outboxId = claimed.id;
			}

			// 2. Keep the external effect separate from D1 reconciliation: only
			// provider/network outcomes become EmailDeliveryError.
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
						content_type: "text/calendar; method=PUBLISH",
					},
				];
			}
			const headers: Record<string, string> = {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			};
			// Resend replays this key for 24h — belt and braces under the outbox
			// ledger above. It is scoped to the PAYLOAD because Resend answers a
			// reused key carrying different content with 409
			// invalid_idempotent_request: on the bare dedupeKey a corrected retry
			// (fixed template, moved room) could never be sent at all, while an
			// identical retry still lands on the same key and is deduped.
			if (msg.dedupeKey) {
				headers["Idempotency-Key"] = await payloadScopedIdempotencyKey(
					msg.dedupeKey,
					body,
				);
			}

			let providerData: { id: string };
			try {
				const res = await fetch(RESEND_ENDPOINT, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					throw new EmailDeliveryError(
						`Resend send failed (${res.status}): ${await res.text()}`,
					);
				}
				providerData = (await res.json()) as { id: string };
			} catch (error) {
				const deliveryError =
					error instanceof EmailDeliveryError
						? error
						: new EmailDeliveryError(errorMessage(error), error);
				const [failed] = await db
					.update(emailOutbox)
					.set({
						status: "failed",
						error: deliveryError.message,
						sendClaimId: null,
						sendClaimExpiresAt: null,
					})
					.where(
						and(
							eq(emailOutbox.id, outboxId),
							eq(emailOutbox.sendClaimId, sendClaim.id),
						),
					)
					.returning({ id: emailOutbox.id });
				if (!failed) return reconcileSendClaim(db, outboxId, msg.onInFlight);
				track("email.send_failed", {
					outboxId,
					eventId: msg.eventId,
					templateId: msg.templateId,
					error: deliveryError.message,
				});
				throw deliveryError;
			}

			const [persisted] = await db
				.update(emailOutbox)
				.set({
					status: "sent",
					providerId: providerData.id,
					sentAt: new Date(),
					error: null,
					sendClaimId: null,
					sendClaimExpiresAt: null,
				})
				.where(
					and(
						eq(emailOutbox.id, outboxId),
						ne(emailOutbox.status, "sent"),
						ne(emailOutbox.status, "bounced"),
					),
				)
				.returning({ id: emailOutbox.id });
			if (!persisted) return reconcileSendClaim(db, outboxId, msg.onInFlight);
			return {
				id: providerData.id,
				deduped: false,
				suppressed: false,
			};
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
