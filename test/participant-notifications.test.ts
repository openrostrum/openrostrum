import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	emailSuppressions,
	events,
	forms,
	organizations,
	participants,
	passwordResets,
	portals,
	submissions,
	users,
} from "../app/db/schema";
import { notifyParticipantAdded } from "../app/domain/participant-notifications";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const db = () => getDb(env);

async function seedSubmission(options?: {
	notifyExistingContacts?: boolean;
	eventName?: string;
	submissionTitle?: string;
}) {
	const suffix = crypto.randomUUID();
	const fixture = {
		organizationId: `organization-${suffix}`,
		eventId: `event-${suffix}`,
		eventName: options?.eventName ?? "OpenRostrum Summit",
		eventSlug: `openrostrum-${suffix}`,
		formId: `form-${suffix}`,
		portalId: `portal-${suffix}`,
		portalPublicId: `speaker-portal-${suffix}`,
		submitterId: `submitter-${suffix}`,
		submissionId: `submission-${suffix}`,
		submissionTitle: options?.submissionTitle ?? "A production-ready talk",
	};

	await db().batch([
		db().insert(organizations).values({
			id: fixture.organizationId,
			name: "Test organization",
		}),
		db().insert(events).values({
			id: fixture.eventId,
			organizationId: fixture.organizationId,
			name: fixture.eventName,
			slug: fixture.eventSlug,
		}),
		db()
			.insert(forms)
			.values({
				id: fixture.formId,
				eventId: fixture.eventId,
				internalName: "Call for proposals",
				notifyExistingContacts: options?.notifyExistingContacts ?? true,
			}),
		db()
			.insert(users)
			.values({
				id: fixture.submitterId,
				email: `submitter-${suffix}@example.com`,
				passwordHash: "pbkdf2$test-credential",
				name: "Original Submitter",
				role: "speaker",
			}),
		db().insert(submissions).values({
			id: fixture.submissionId,
			eventId: fixture.eventId,
			formId: fixture.formId,
			title: fixture.submissionTitle,
			submitterId: fixture.submitterId,
		}),
		db().insert(portals).values({
			id: fixture.portalId,
			eventId: fixture.eventId,
			publicId: fixture.portalPublicId,
		}),
	]);

	return fixture;
}

async function seedParticipant(
	fixture: Awaited<ReturnType<typeof seedSubmission>>,
	options?: {
		participantId?: string;
		contactId?: string;
		email?: string;
		firstName?: string;
		lastName?: string;
		role?: "speaker" | "chairperson" | "moderator" | "secondary";
		userId?: string | null;
	},
) {
	const participant = {
		participantId:
			options?.participantId ?? `participant-${crypto.randomUUID()}`,
		contactId: options?.contactId ?? `contact-${crypto.randomUUID()}`,
		email: options?.email ?? `participant-${crypto.randomUUID()}@example.com`,
		firstName: options?.firstName ?? "Ada",
		lastName: options?.lastName ?? "Lovelace",
		role: options?.role ?? ("speaker" as const),
		userId: options?.userId ?? null,
	};

	await db().batch([
		db().insert(contacts).values({
			id: participant.contactId,
			eventId: fixture.eventId,
			userId: participant.userId,
			email: participant.email,
			firstName: participant.firstName,
			lastName: participant.lastName,
		}),
		db().insert(participants).values({
			id: participant.participantId,
			submissionId: fixture.submissionId,
			contactId: participant.contactId,
			role: participant.role,
		}),
	]);

	return participant;
}

function notificationInput(
	fixture: Awaited<ReturnType<typeof seedSubmission>>,
	participant: Awaited<ReturnType<typeof seedParticipant>>,
	wasExistingContact: boolean,
) {
	return {
		added: {
			participantId: participant.participantId,
			contactId: participant.contactId,
			wasExistingContact,
			isSelf: false,
			role: participant.role,
		},
		event: {
			id: fixture.eventId,
			name: fixture.eventName,
			slug: fixture.eventSlug,
		},
		submission: {
			id: fixture.submissionId,
			title: fixture.submissionTitle,
			formId: fixture.formId,
			submitterId: fixture.submitterId,
		},
		origin: "https://conference.example",
	};
}

describe("notifyParticipantAdded", () => {
	it("provisions a new participant and sends a transactional set-password invitation", async () => {
		const fixture = await seedSubmission({
			eventName: "Open & <Rostrum>",
			submissionTitle: "A <script>alert('unsafe')</script> talk",
		});
		const participant = await seedParticipant(fixture, {
			email: `new-speaker-${crypto.randomUUID()}@example.com`,
			firstName: "Ada <Lovelace>",
			lastName: "Byron & Co",
		});
		await db().insert(emailSuppressions).values({
			email: participant.email,
			reason: "unsubscribed from announcements",
		});
		const startedAt = Date.now();

		const result = await notifyParticipantAdded(
			db(),
			env,
			notificationInput(fixture, participant, false),
		);
		const finishedAt = Date.now();

		expect(result).toEqual({ sent: true, deduped: false });
		const [linkedContact] = await db()
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, participant.contactId));
		expect(linkedContact?.userId).toBeTruthy();

		const [account] = await db()
			.select({
				id: users.id,
				email: users.email,
				passwordHash: users.passwordHash,
				role: users.role,
			})
			.from(users)
			.where(eq(users.id, linkedContact?.userId ?? ""));
		expect(account).toMatchObject({
			email: participant.email,
			role: "speaker",
		});
		expect(account?.passwordHash).toMatch(/^invite-pending\$/);

		const resets = await db()
			.select({
				userId: passwordResets.userId,
				organizationId: passwordResets.organizationId,
				token: passwordResets.token,
				expiresAt: passwordResets.expiresAt,
				usedAt: passwordResets.usedAt,
			})
			.from(passwordResets)
			.where(eq(passwordResets.userId, account?.id ?? ""));
		expect(resets).toHaveLength(1);
		expect(resets[0]).toMatchObject({
			organizationId: null,
			usedAt: null,
		});
		expect(resets[0]?.expiresAt.getTime()).toBeGreaterThanOrEqual(
			startedAt + INVITE_TTL_MS - 1_000,
		);
		expect(resets[0]?.expiresAt.getTime()).toBeLessThanOrEqual(
			finishedAt + INVITE_TTL_MS,
		);

		const [email] = await db()
			.select({
				to: emailOutbox.to,
				dedupeKey: emailOutbox.dedupeKey,
				html: emailOutbox.html,
				status: emailOutbox.status,
			})
			.from(emailOutbox)
			.where(eq(emailOutbox.to, participant.email));
		expect(email).toMatchObject({
			to: participant.email,
			dedupeKey: `participant-added:${participant.participantId}`,
			status: "sent",
		});
		expect(email?.html).toContain(
			`https://conference.example/set-password/${resets[0]?.token}`,
		);
		expect(email?.html).toContain("Ada &lt;Lovelace&gt;");
		expect(email?.html).toContain("Open &amp; &lt;Rostrum&gt;");
		expect(email?.html).not.toContain("<script>");
	});

	it("links an existing credentialed user and sends the event portal URL without a reset", async () => {
		const fixture = await seedSubmission();
		const accountId = `existing-user-${crypto.randomUUID()}`;
		const email = `existing-${crypto.randomUUID()}@example.com`;
		await db().insert(users).values({
			id: accountId,
			email,
			passwordHash: "pbkdf2$existing-credential",
			name: "Existing Speaker",
			role: "speaker",
		});
		const participant = await seedParticipant(fixture, { email });

		const result = await notifyParticipantAdded(
			db(),
			env,
			notificationInput(fixture, participant, true),
		);

		expect(result).toEqual({ sent: true, deduped: false });
		const [linkedContact] = await db()
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, participant.contactId));
		expect(linkedContact?.userId).toBe(accountId);
		const resets = await db()
			.select({ id: passwordResets.id })
			.from(passwordResets)
			.where(eq(passwordResets.userId, accountId));
		expect(resets).toEqual([]);

		const [outbox] = await db()
			.select({ html: emailOutbox.html })
			.from(emailOutbox)
			.where(eq(emailOutbox.to, email));
		expect(outbox?.html).toContain(
			`https://conference.example/portals/${fixture.eventSlug}/${fixture.portalPublicId}`,
		);
		expect(outbox?.html).not.toContain("/set-password/");
	});

	it("does not notify an existing contact when the source form disables it", async () => {
		const fixture = await seedSubmission({ notifyExistingContacts: false });
		const accountId = `known-user-${crypto.randomUUID()}`;
		const email = `known-${crypto.randomUUID()}@example.com`;
		await db().insert(users).values({
			id: accountId,
			email,
			passwordHash: "pbkdf2$known-credential",
			role: "speaker",
		});
		const participant = await seedParticipant(fixture, {
			email,
			userId: accountId,
		});

		const result = await notifyParticipantAdded(
			db(),
			env,
			notificationInput(fixture, participant, true),
		);

		expect(result).toEqual({ sent: false, deduped: false });
		const emails = await db()
			.select({ id: emailOutbox.id })
			.from(emailOutbox)
			.where(eq(emailOutbox.to, email));
		expect(emails).toEqual([]);
	});

	it("dedupes replay by participant link and keeps one stable password reset", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		const input = notificationInput(fixture, participant, false);

		const first = await notifyParticipantAdded(db(), env, input);
		const replay = await notifyParticipantAdded(db(), env, input);

		expect(first).toEqual({ sent: true, deduped: false });
		expect(replay).toEqual({ sent: true, deduped: true });
		const emails = await db()
			.select({ id: emailOutbox.id })
			.from(emailOutbox)
			.where(
				and(
					eq(emailOutbox.to, participant.email),
					eq(
						emailOutbox.dedupeKey,
						`participant-added:${participant.participantId}`,
					),
				),
			);
		expect(emails).toHaveLength(1);

		const [account] = await db()
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, participant.contactId));
		const resets = await db()
			.select({ token: passwordResets.token })
			.from(passwordResets)
			.where(eq(passwordResets.userId, account?.userId ?? ""));
		expect(resets).toHaveLength(1);
	});
});
