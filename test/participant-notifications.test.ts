import { env } from "cloudflare:test";
import { and, eq, gt, isNull } from "drizzle-orm";
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
		submitterEmail: `submitter-${suffix}@example.com`,
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
		db().insert(users).values({
			id: fixture.submitterId,
			email: fixture.submitterEmail,
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

async function oldIdDerivedToken(participantId: string, userId: string) {
	const bytes = new TextEncoder().encode(
		`participant-added:${participantId}:${userId}`,
	);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function outboxFor(email: string) {
	return db()
		.select({
			id: emailOutbox.id,
			dedupeKey: emailOutbox.dedupeKey,
			html: emailOutbox.html,
			status: emailOutbox.status,
			to: emailOutbox.to,
		})
		.from(emailOutbox)
		.where(eq(emailOutbox.to, email));
}

async function resetsFor(userId: string) {
	return db()
		.select({
			id: passwordResets.id,
			organizationId: passwordResets.organizationId,
			token: passwordResets.token,
			expiresAt: passwordResets.expiresAt,
			usedAt: passwordResets.usedAt,
			userId: passwordResets.userId,
		})
		.from(passwordResets)
		.where(eq(passwordResets.userId, userId));
}

async function linkedUserId(contactId: string) {
	const [contact] = await db()
		.select({ userId: contacts.userId })
		.from(contacts)
		.where(eq(contacts.id, contactId));
	return contact?.userId ?? null;
}

describe("notifyParticipantAdded", () => {
	it("provisions one random-token invitation and sends exactly one transactional email", async () => {
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
		const input = notificationInput(fixture, participant, false);
		input.origin = "https://conference.example/";
		const startedAt = Date.now();

		const result = await notifyParticipantAdded(db(), env, input);
		const finishedAt = Date.now();

		expect(result).toEqual({ delivery: "sent" });
		const userId = await linkedUserId(participant.contactId);
		expect(userId).toBeTruthy();
		const [account] = await db()
			.select({
				email: users.email,
				passwordHash: users.passwordHash,
				role: users.role,
			})
			.from(users)
			.where(eq(users.id, userId ?? ""));
		expect(account).toMatchObject({
			email: participant.email,
			role: "speaker",
		});
		expect(account?.passwordHash).toMatch(/^invite-pending\$/);

		const resets = await resetsFor(userId ?? "");
		expect(resets).toHaveLength(1);
		expect(resets[0]).toMatchObject({ organizationId: null, usedAt: null });
		expect(resets[0]?.expiresAt.getTime()).toBeGreaterThanOrEqual(
			startedAt + INVITE_TTL_MS - 1_000,
		);
		expect(resets[0]?.expiresAt.getTime()).toBeLessThanOrEqual(
			finishedAt + INVITE_TTL_MS,
		);
		expect(resets[0]?.token).not.toBe(
			await oldIdDerivedToken(participant.participantId, userId ?? ""),
		);

		const emails = await outboxFor(participant.email);
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			to: participant.email,
			dedupeKey: `participant-added:${participant.participantId}:${resets[0]?.token}`,
			status: "sent",
		});
		expect(emails[0]?.html).toContain(
			`https://conference.example/set-password/${resets[0]?.token}`,
		);
		expect(emails[0]?.html).not.toContain(
			"https://conference.example//set-password/",
		);
		expect(emails[0]?.html).toContain("Ada &lt;Lovelace&gt;");
		expect(emails[0]?.html).toContain("Open &amp; &lt;Rostrum&gt;");
		expect(emails[0]?.html).not.toContain("<script>");
	});

	it("links an existing normalized-email user and sends the persisted event portal URL", async () => {
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
		const input = notificationInput(fixture, participant, true);
		input.event.name = "Caller-supplied stale name";
		input.event.slug = "caller-supplied-stale-slug";
		input.submission.title = "Caller-supplied stale title";

		const result = await notifyParticipantAdded(db(), env, input);

		expect(result).toEqual({ delivery: "sent" });
		expect(await linkedUserId(participant.contactId)).toBe(accountId);
		expect(await resetsFor(accountId)).toEqual([]);
		const emails = await outboxFor(email);
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			to: email,
			dedupeKey: `participant-added:${participant.participantId}:portal:${accountId}`,
			status: "sent",
		});
		expect(emails[0]?.html).toContain(
			`https://conference.example/portals/${fixture.eventSlug}/${fixture.portalPublicId}`,
		);
		expect(emails[0]?.html).toContain(fixture.submissionTitle);
		expect(emails[0]?.html).not.toContain("caller-supplied-stale");
		expect(emails[0]?.html).not.toContain("/set-password/");
	});

	it("suppresses policy-disabled email only after provisioning access", async () => {
		const fixture = await seedSubmission({ notifyExistingContacts: false });
		const participant = await seedParticipant(fixture);

		const result = await notifyParticipantAdded(
			db(),
			env,
			notificationInput(fixture, participant, true),
		);

		expect(result).toEqual({ delivery: "suppressed" });
		const userId = await linkedUserId(participant.contactId);
		expect(userId).toBeTruthy();
		expect(await resetsFor(userId ?? "")).toHaveLength(1);
		expect(await outboxFor(participant.email)).toEqual([]);
	});

	for (const sourceFormState of ["missing", "cross-event"] as const) {
		it(`fails closed for a ${sourceFormState} source form after provisioning access`, async () => {
			const fixture = await seedSubmission();
			const participant = await seedParticipant(fixture);
			if (sourceFormState === "missing") {
				await db()
					.update(submissions)
					.set({ formId: null })
					.where(eq(submissions.id, fixture.submissionId));
			} else {
				const otherEventId = `other-event-${crypto.randomUUID()}`;
				const otherFormId = `other-form-${crypto.randomUUID()}`;
				await db().batch([
					db()
						.insert(events)
						.values({
							id: otherEventId,
							organizationId: fixture.organizationId,
							name: "Other event",
							slug: `other-event-${crypto.randomUUID()}`,
						}),
					db().insert(forms).values({
						id: otherFormId,
						eventId: otherEventId,
						internalName: "Other form",
						notifyExistingContacts: true,
					}),
					db()
						.update(submissions)
						.set({ formId: otherFormId })
						.where(eq(submissions.id, fixture.submissionId)),
				]);
			}

			const result = await notifyParticipantAdded(
				db(),
				env,
				notificationInput(fixture, participant, true),
			);

			expect(result.delivery).toBe("suppressed");
			expect(result.warning).toMatch(/source form/i);
			const userId = await linkedUserId(participant.contactId);
			expect(userId).toBeTruthy();
			expect(await resetsFor(userId ?? "")).toHaveLength(1);
			expect(await outboxFor(participant.email)).toEqual([]);
		});
	}

	it("notifies an existing contact for an explicitly validated admin-manual submission", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		await db()
			.update(submissions)
			.set({ formId: null })
			.where(eq(submissions.id, fixture.submissionId));
		const input = {
			...notificationInput(fixture, participant, true),
			notificationContext: "admin-manual-submission" as const,
		};

		const result = await notifyParticipantAdded(db(), env, input);

		expect(result).toEqual({ delivery: "sent" });
		expect(await outboxFor(participant.email)).toHaveLength(1);
	});

	it("rejects admin-manual notification context for a form-sourced submission", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		const input = {
			...notificationInput(fixture, participant, true),
			notificationContext: "admin-manual-submission" as const,
		};

		await expect(notifyParticipantAdded(db(), env, input)).rejects.toThrow(
			/admin-manual.*manual submission/i,
		);
		expect(await linkedUserId(participant.contactId)).toBeNull();
		expect(await outboxFor(participant.email)).toEqual([]);
	});

	it("rejects a stale linked user whose normalized email differs from the contact", async () => {
		const fixture = await seedSubmission();
		const staleUserId = `stale-user-${crypto.randomUUID()}`;
		await db()
			.insert(users)
			.values({
				id: staleUserId,
				email: `account-a-${crypto.randomUUID()}@example.com`,
				passwordHash: "invite-pending$stale-link",
				role: "speaker",
			});
		const participant = await seedParticipant(fixture, {
			email: `contact-b-${crypto.randomUUID()}@example.com`,
			userId: staleUserId,
		});

		await expect(
			notifyParticipantAdded(
				db(),
				env,
				notificationInput(fixture, participant, false),
			),
		).rejects.toThrow(/email identity/i);
		expect(await linkedUserId(participant.contactId)).toBe(staleUserId);
		expect(await resetsFor(staleUserId)).toEqual([]);
		expect(await outboxFor(participant.email)).toEqual([]);
	});

	it("suppresses a persisted self-participant without issuing another credential", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture, {
			email: fixture.submitterEmail,
			userId: fixture.submitterId,
		});
		const input = notificationInput(fixture, participant, false);
		input.added.isSelf = true;

		const result = await notifyParticipantAdded(db(), env, input);

		expect(result).toEqual({ delivery: "suppressed" });
		expect(await linkedUserId(participant.contactId)).toBe(fixture.submitterId);
		expect(await resetsFor(fixture.submitterId)).toEqual([]);
		expect(await outboxFor(participant.email)).toEqual([]);
	});

	for (const mismatch of ["submission", "role", "self"] as const) {
		it(`rejects a caller whose ${mismatch} does not match the persisted participant link`, async () => {
			const fixture = await seedSubmission();
			const participant = await seedParticipant(fixture);
			const input = notificationInput(fixture, participant, false);
			if (mismatch === "submission") {
				input.submission.id = `wrong-submission-${crypto.randomUUID()}`;
			} else if (mismatch === "role") {
				input.added.role = "moderator";
			} else {
				input.added.isSelf = true;
			}

			await expect(notifyParticipantAdded(db(), env, input)).rejects.toThrow(
				/participant relationship/i,
			);
			expect(await linkedUserId(participant.contactId)).toBeNull();
			expect(await outboxFor(participant.email)).toEqual([]);
		});
	}

	for (const origin of [
		"ftp://conference.example",
		"https://user:secret@conference.example",
		"https://conference.example/path",
		"https://conference.example?next=evil",
		"https://conference.example#fragment",
	]) {
		it(`rejects invalid bearer-link origin ${origin}`, async () => {
			const fixture = await seedSubmission();
			const participant = await seedParticipant(fixture);
			const input = notificationInput(fixture, participant, false);
			input.origin = origin;

			await expect(notifyParticipantAdded(db(), env, input)).rejects.toThrow(
				/origin/i,
			);
			expect(await linkedUserId(participant.contactId)).toBeNull();
			expect(await outboxFor(participant.email)).toEqual([]);
		});
	}

	it("reuses one active token and reports replay as deduped", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		const input = notificationInput(fixture, participant, false);

		const first = await notifyParticipantAdded(db(), env, input);
		const userId = await linkedUserId(participant.contactId);
		const [originalReset] = await resetsFor(userId ?? "");
		const replay = await notifyParticipantAdded(db(), env, input);

		expect(first).toEqual({ delivery: "sent" });
		expect(replay).toEqual({ delivery: "deduped" });
		const resets = await resetsFor(userId ?? "");
		expect(resets).toHaveLength(1);
		expect(resets[0]?.token).toBe(originalReset?.token);
		const emails = await outboxFor(participant.email);
		expect(emails).toHaveLength(1);
		expect(emails[0]?.dedupeKey).toBe(
			`participant-added:${participant.participantId}:${originalReset?.token}`,
		);
	});

	for (const invalidState of ["used", "expired"] as const) {
		it(`mints and delivers a new valid token after the prior token is ${invalidState}`, async () => {
			const fixture = await seedSubmission();
			const participant = await seedParticipant(fixture);
			const input = notificationInput(fixture, participant, false);
			await notifyParticipantAdded(db(), env, input);
			const userId = await linkedUserId(participant.contactId);
			const [prior] = await resetsFor(userId ?? "");
			await db()
				.update(passwordResets)
				.set(
					invalidState === "used"
						? { usedAt: new Date() }
						: { expiresAt: new Date(Date.now() - 60_000) },
				)
				.where(eq(passwordResets.id, prior?.id ?? ""));

			const recovery = await notifyParticipantAdded(db(), env, input);

			expect(recovery).toEqual({ delivery: "sent" });
			const resets = await resetsFor(userId ?? "");
			expect(resets).toHaveLength(2);
			const active = resets.filter(
				(reset) => !reset.usedAt && reset.expiresAt.getTime() > Date.now(),
			);
			expect(active).toHaveLength(1);
			expect(active[0]?.token).not.toBe(prior?.token);
			const emails = await outboxFor(participant.email);
			expect(emails).toHaveLength(2);
			expect(emails[1]?.html).toContain(`/set-password/${active[0]?.token}`);
		});
	}

	it("does not overwrite an authoritative user link that wins the contact CAS", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		const winnerUserId = `winner-${crypto.randomUUID()}`;
		await db()
			.insert(users)
			.values({
				id: winnerUserId,
				email: `winner-${crypto.randomUUID()}@example.com`,
				passwordHash: "pbkdf2$winner",
				role: "speaker",
			});
		const guardTable = `cas_guard_${crypto.randomUUID().replaceAll("-", "")}`;
		const triggerName = `cas_trigger_${crypto.randomUUID().replaceAll("-", "")}`;
		await env.DB.prepare(
			`CREATE TABLE ${guardTable} (armed INTEGER NOT NULL)`,
		).run();
		await env.DB.prepare(`INSERT INTO ${guardTable} (armed) VALUES (1)`).run();
		await env.DB.prepare(`
			CREATE TRIGGER ${triggerName}
			BEFORE UPDATE OF user_id ON contacts
			WHEN OLD.id = '${participant.contactId}'
				AND EXISTS (SELECT 1 FROM ${guardTable} WHERE armed = 1)
			BEGIN
				DELETE FROM ${guardTable};
				UPDATE contacts SET user_id = '${winnerUserId}' WHERE id = '${participant.contactId}';
				SELECT RAISE(IGNORE);
			END
		`).run();

		await expect(
			notifyParticipantAdded(
				db(),
				env,
				notificationInput(fixture, participant, false),
			),
		).rejects.toThrow(/email identity/i);
		expect(await linkedUserId(participant.contactId)).toBe(winnerUserId);
		expect(await outboxFor(participant.email)).toEqual([]);
		const resets = await db()
			.select({ id: passwordResets.id })
			.from(passwordResets);
		expect(resets).toEqual([]);
	});

	it("serializes concurrent replay to one active token and one delivered email", async () => {
		const fixture = await seedSubmission();
		const participant = await seedParticipant(fixture);
		const input = notificationInput(fixture, participant, false);

		const results = await Promise.all([
			notifyParticipantAdded(db(), env, input),
			notifyParticipantAdded(db(), env, input),
		]);

		expect(results.map((result) => result.delivery).sort()).toEqual([
			"deduped",
			"sent",
		]);
		const userId = await linkedUserId(participant.contactId);
		const activeResets = await db()
			.select({ token: passwordResets.token })
			.from(passwordResets)
			.where(
				and(
					eq(passwordResets.userId, userId ?? ""),
					isNull(passwordResets.organizationId),
					isNull(passwordResets.usedAt),
					gt(passwordResets.expiresAt, new Date()),
				),
			);
		expect(activeResets).toHaveLength(1);
		expect(await outboxFor(participant.email)).toHaveLength(1);
	});
});
