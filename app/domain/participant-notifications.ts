import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
	contacts,
	events,
	forms,
	participants,
	passwordResets,
	submissions,
	type Submission,
	users,
} from "~/db/schema";
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from "~/db/constants";
import { hasSetPassword, mintSentinelHash, normalizeEmail } from "~/lib/auth";
import { escapeHtml } from "~/lib/html";
import { firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { getEmailSender } from "~/ports/email";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
type Event = typeof events.$inferSelect;
type Account = Pick<typeof users.$inferSelect, "id" | "email" | "passwordHash">;

export type ParticipantNotificationDelivery = "sent" | "deduped" | "suppressed";

export interface AddedParticipant {
	participantId: string;
	contactId: string;
	wasExistingContact: boolean;
	isSelf: boolean;
	role: ParticipantRole;
}

function normalizeOrigin(origin: string): string {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error("Participant notification origin is invalid");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			"Participant notification origin must be a credential-free HTTP(S) origin",
		);
	}
	return url.origin;
}

async function accountById(
	db: Db,
	userId: string,
): Promise<Account | undefined> {
	return (
		await db
			.select({
				id: users.id,
				email: users.email,
				passwordHash: users.passwordHash,
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
}

async function accountByNormalizedEmail(
	db: Db,
	normalizedEmail: string,
): Promise<Account | undefined> {
	const matches = await db
		.select({
			id: users.id,
			email: users.email,
			passwordHash: users.passwordHash,
		})
		.from(users)
		.where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
		.limit(2);
	if (matches.length > 1) {
		throw new Error("Participant email identity is ambiguous");
	}
	return matches[0];
}

function assertEmailIdentity(account: Account, normalizedEmail: string): void {
	if (normalizeEmail(account.email) !== normalizedEmail) {
		throw new Error(
			"Participant contact and linked user email identity differ",
		);
	}
}

async function authoritativeAccount(
	db: Db,
	contact: { id: string; eventId: string; email: string },
	normalizedEmail: string,
): Promise<Account> {
	const [current] = await db
		.select({ userId: contacts.userId, email: contacts.email })
		.from(contacts)
		.where(
			and(eq(contacts.id, contact.id), eq(contacts.eventId, contact.eventId)),
		)
		.limit(1);
	if (!current || current.email !== contact.email || !current.userId) {
		throw new Error(
			"Participant email identity changed during account linking",
		);
	}
	const account = await accountById(db, current.userId);
	if (!account) {
		throw new Error(
			"Participant linked user email identity could not be resolved",
		);
	}
	assertEmailIdentity(account, normalizedEmail);
	return account;
}

async function provisionAccount(
	db: Db,
	contact: {
		id: string;
		eventId: string;
		userId: string | null;
		email: string;
		firstName: string;
		lastName: string;
	},
): Promise<Account> {
	const normalizedEmail = normalizeEmail(contact.email);
	let account = contact.userId
		? await accountById(db, contact.userId)
		: await accountByNormalizedEmail(db, normalizedEmail);

	if (contact.userId) {
		if (!account) {
			throw new Error(
				"Participant linked user email identity could not be resolved",
			);
		}
		assertEmailIdentity(account, normalizedEmail);
	}

	if (!account) {
		const name = `${contact.firstName} ${contact.lastName}`.trim();
		account = (
			await db
				.insert(users)
				.values({
					email: normalizedEmail,
					passwordHash: mintSentinelHash(),
					name: name || null,
					role: "speaker",
				})
				.onConflictDoNothing({ target: users.email })
				.returning({
					id: users.id,
					email: users.email,
					passwordHash: users.passwordHash,
				})
		)[0];
		account ??= await accountByNormalizedEmail(db, normalizedEmail);
	}
	if (!account) throw new Error("Participant account could not be provisioned");
	assertEmailIdentity(account, normalizedEmail);

	if (contact.userId !== account.id) {
		const linked = await db
			.update(contacts)
			.set({ userId: account.id })
			.where(
				and(
					eq(contacts.id, contact.id),
					eq(contacts.eventId, contact.eventId),
					eq(contacts.email, contact.email),
					contact.userId === null
						? isNull(contacts.userId)
						: eq(contacts.userId, contact.userId),
				),
			)
			.returning({ userId: contacts.userId });
		if (linked[0]?.userId !== account.id) {
			return authoritativeAccount(db, contact, normalizedEmail);
		}
	}

	return authoritativeAccount(db, contact, normalizedEmail);
}

async function activeSpeakerToken(
	db: Db,
	accountId: string,
	contact: { id: string; eventId: string; email: string },
): Promise<string> {
	const now = new Date();
	const nowSeconds = Math.floor(now.getTime() / 1_000);
	const expiresAtSeconds = Math.floor((now.getTime() + INVITE_TTL_MS) / 1_000);
	const candidateToken = crypto.randomUUID();

	await db.run(sql`
		INSERT INTO password_resets
			(id, user_id, organization_id, token, expires_at, used_at, created_at)
		SELECT
			${crypto.randomUUID()}, ${accountId}, NULL, ${candidateToken},
			${expiresAtSeconds}, NULL, ${nowSeconds}
		WHERE EXISTS (
			SELECT 1 FROM contacts
			WHERE id = ${contact.id}
				AND event_id = ${contact.eventId}
				AND email = ${contact.email}
				AND user_id = ${accountId}
		)
		AND NOT EXISTS (
			SELECT 1 FROM password_resets
			WHERE user_id = ${accountId}
				AND organization_id IS NULL
				AND used_at IS NULL
				AND expires_at > ${nowSeconds}
		)
	`);

	const [active] = await db
		.select({ token: passwordResets.token })
		.from(passwordResets)
		.where(
			and(
				eq(passwordResets.userId, accountId),
				isNull(passwordResets.organizationId),
				isNull(passwordResets.usedAt),
				gt(passwordResets.expiresAt, now),
			),
		)
		.orderBy(asc(passwordResets.createdAt), asc(passwordResets.id))
		.limit(1);
	if (!active)
		throw new Error("Participant access token could not be provisioned");
	return active.token;
}

export async function notifyParticipantAdded(
	db: Db,
	env: Env,
	input: {
		added: AddedParticipant;
		event: Pick<Event, "id" | "name" | "slug">;
		submission: Pick<Submission, "id" | "title" | "formId" | "submitterId">;
		origin: string;
	},
): Promise<{
	delivery: ParticipantNotificationDelivery;
	warning?: string;
}> {
	const origin = normalizeOrigin(input.origin);
	const [persisted] = await db
		.select({
			participantId: participants.id,
			participantContactId: participants.contactId,
			participantSubmissionId: participants.submissionId,
			participantRole: participants.role,
			contactId: contacts.id,
			contactEventId: contacts.eventId,
			contactUserId: contacts.userId,
			contactEmail: contacts.email,
			contactFirstName: contacts.firstName,
			contactLastName: contacts.lastName,
			submissionId: submissions.id,
			submissionEventId: submissions.eventId,
			submissionFormId: submissions.formId,
			submissionSubmitterId: submissions.submitterId,
			submissionTitle: submissions.title,
			eventId: events.id,
			eventName: events.name,
			eventSlug: events.slug,
			sourceFormId: forms.id,
			notifyExistingContacts: forms.notifyExistingContacts,
		})
		.from(participants)
		.innerJoin(submissions, eq(submissions.id, participants.submissionId))
		.innerJoin(events, eq(events.id, submissions.eventId))
		.innerJoin(
			contacts,
			and(
				eq(contacts.id, participants.contactId),
				eq(contacts.eventId, submissions.eventId),
			),
		)
		.leftJoin(
			forms,
			and(eq(forms.id, submissions.formId), eq(forms.eventId, events.id)),
		)
		.where(eq(participants.id, input.added.participantId))
		.limit(1);

	if (
		!persisted ||
		persisted.participantContactId !== input.added.contactId ||
		persisted.contactId !== input.added.contactId ||
		persisted.participantSubmissionId !== input.submission.id ||
		persisted.submissionId !== input.submission.id ||
		persisted.participantRole !== input.added.role ||
		persisted.eventId !== input.event.id ||
		persisted.contactEventId !== persisted.eventId ||
		persisted.submissionEventId !== persisted.eventId ||
		persisted.submissionSubmitterId !== input.submission.submitterId
	) {
		throw new Error(
			"Participant relationship does not match persisted records",
		);
	}

	const persistedIsSelf =
		persisted.contactUserId !== null &&
		persisted.contactUserId === persisted.submissionSubmitterId;
	if (persistedIsSelf !== input.added.isSelf) {
		throw new Error("Participant relationship self identity does not match");
	}

	const contact = {
		id: persisted.contactId,
		eventId: persisted.eventId,
		userId: persisted.contactUserId,
		email: persisted.contactEmail,
		firstName: persisted.contactFirstName,
		lastName: persisted.contactLastName,
	};
	const normalizedEmail = normalizeEmail(contact.email);
	const account = await provisionAccount(db, contact);

	if (persistedIsSelf) return { delivery: "suppressed" };

	let warning: string | undefined;
	let deliverySuppressed = false;
	if (input.added.wasExistingContact) {
		if (
			persisted.submissionFormId === null ||
			persisted.sourceFormId !== persisted.submissionFormId
		) {
			deliverySuppressed = true;
			warning =
				"Existing-contact notification suppressed because the source form is missing or outside the event";
		} else if (!persisted.notifyExistingContacts) {
			deliverySuppressed = true;
		}
	}

	let accessUrl: string;
	let dedupeKey: string;
	if (hasSetPassword(account.passwordHash)) {
		if (deliverySuppressed) return { delivery: "suppressed", warning };
		const portalPublicId = (
			await firstPortalsByEvent(db, persisted.eventId)
		).get(persisted.eventId);
		if (!portalPublicId) throw new Error("Speaker portal not found");
		accessUrl = portalUrl(origin, persisted.eventSlug, portalPublicId);
		dedupeKey = `participant-added:${persisted.participantId}:portal:${account.id}`;
	} else {
		const token = await activeSpeakerToken(db, account.id, contact);
		await authoritativeAccount(db, contact, normalizedEmail);
		if (deliverySuppressed) return { delivery: "suppressed", warning };
		accessUrl = `${origin}/set-password/${token}`;
		dedupeKey = `participant-added:${persisted.participantId}:${token}`;
	}

	const safeFirstName = escapeHtml(persisted.contactFirstName);
	const safeEventName = escapeHtml(persisted.eventName);
	const safeSubmissionTitle = escapeHtml(persisted.submissionTitle);
	const safeRole = escapeHtml(
		PARTICIPANT_ROLE_LABELS[persisted.participantRole],
	);
	const safeAccessUrl = escapeHtml(accessUrl);
	const emailResult = await getEmailSender(env).send({
		to: normalizedEmail,
		subject: `You’ve been added to ${persisted.submissionTitle}`,
		html: `<p>Hi ${safeFirstName},</p><p>You’ve been added as <strong>${safeRole}</strong> to <strong>${safeSubmissionTitle}</strong> for ${safeEventName}.</p><p><a href="${safeAccessUrl}">Open your speaker portal</a></p>`,
		kind: "transactional",
		dedupeKey,
		eventId: persisted.eventId,
	});

	return {
		delivery: emailResult.suppressed
			? "suppressed"
			: emailResult.deduped
				? "deduped"
				: "sent",
	};
}
