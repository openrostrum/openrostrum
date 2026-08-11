import { and, eq } from "drizzle-orm";
import type { Db } from "~/db";
import {
	contacts,
	events,
	forms,
	passwordResets,
	type Submission,
	users,
} from "~/db/schema";
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from "~/db/constants";
import { sha256Hex } from "~/lib/api-token";
import { hasSetPassword, mintSentinelHash, normalizeEmail } from "~/lib/auth";
import { escapeHtml } from "~/lib/html";
import { firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { getEmailSender } from "~/ports/email";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
type Event = typeof events.$inferSelect;

export interface AddedParticipant {
	participantId: string;
	contactId: string;
	wasExistingContact: boolean;
	isSelf: boolean;
	role: ParticipantRole;
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
): Promise<{ sent: boolean; deduped: boolean; warning?: string }> {
	if (input.added.isSelf) return { sent: false, deduped: false };

	const [contact] = await db
		.select({
			id: contacts.id,
			userId: contacts.userId,
			email: contacts.email,
			firstName: contacts.firstName,
			lastName: contacts.lastName,
		})
		.from(contacts)
		.where(
			and(
				eq(contacts.id, input.added.contactId),
				eq(contacts.eventId, input.event.id),
			),
		)
		.limit(1);
	if (!contact) throw new Error("Participant contact not found");

	if (input.added.wasExistingContact && input.submission.formId) {
		const [sourceForm] = await db
			.select({ notifyExistingContacts: forms.notifyExistingContacts })
			.from(forms)
			.where(
				and(
					eq(forms.id, input.submission.formId),
					eq(forms.eventId, input.event.id),
				),
			)
			.limit(1);
		if (sourceForm && !sourceForm.notifyExistingContacts) {
			return { sent: false, deduped: false };
		}
	}

	const normalizedEmail = normalizeEmail(contact.email);
	let account = contact.userId
		? (
				await db
					.select({
						id: users.id,
						passwordHash: users.passwordHash,
					})
					.from(users)
					.where(eq(users.id, contact.userId))
					.limit(1)
			)[0]
		: undefined;

	if (!account) {
		account = (
			await db
				.select({ id: users.id, passwordHash: users.passwordHash })
				.from(users)
				.where(eq(users.email, normalizedEmail))
				.limit(1)
		)[0];
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
				.returning({ id: users.id, passwordHash: users.passwordHash })
		)[0];

		if (!account) {
			account = (
				await db
					.select({ id: users.id, passwordHash: users.passwordHash })
					.from(users)
					.where(eq(users.email, normalizedEmail))
					.limit(1)
			)[0];
		}
	}
	if (!account) throw new Error("Participant account could not be provisioned");

	if (contact.userId !== account.id) {
		await db
			.update(contacts)
			.set({ userId: account.id })
			.where(
				and(eq(contacts.id, contact.id), eq(contacts.eventId, input.event.id)),
			);
	}

	let accessUrl: string;
	if (hasSetPassword(account.passwordHash)) {
		const portalPublicId = (await firstPortalsByEvent(db, input.event.id)).get(
			input.event.id,
		);
		if (!portalPublicId) throw new Error("Speaker portal not found");
		accessUrl = portalUrl(input.origin, input.event.slug, portalPublicId);
	} else {
		const token = await sha256Hex(
			`participant-added:${input.added.participantId}:${account.id}`,
		);
		await db
			.insert(passwordResets)
			.values({
				userId: account.id,
				organizationId: null,
				token,
				expiresAt: new Date(Date.now() + INVITE_TTL_MS),
			})
			.onConflictDoNothing({ target: passwordResets.token });
		accessUrl = `${input.origin}/set-password/${token}`;
	}

	const safeFirstName = escapeHtml(contact.firstName);
	const safeEventName = escapeHtml(input.event.name);
	const safeSubmissionTitle = escapeHtml(input.submission.title);
	const safeRole = escapeHtml(PARTICIPANT_ROLE_LABELS[input.added.role]);
	const safeAccessUrl = escapeHtml(accessUrl);
	const emailResult = await getEmailSender(env).send({
		to: normalizedEmail,
		subject: `You’ve been added to ${input.submission.title}`,
		html: `<p>Hi ${safeFirstName},</p><p>You’ve been added as <strong>${safeRole}</strong> to <strong>${safeSubmissionTitle}</strong> for ${safeEventName}.</p><p><a href="${safeAccessUrl}">Open your speaker portal</a></p>`,
		kind: "transactional",
		dedupeKey: `participant-added:${input.added.participantId}`,
		eventId: input.event.id,
	});

	return {
		sent: !emailResult.suppressed,
		deduped: emailResult.deduped,
	};
}
