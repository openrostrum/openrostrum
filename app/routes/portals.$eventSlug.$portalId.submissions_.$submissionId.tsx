import { and, asc, eq, ne } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";
import {
	type SubmissionDetailActionData,
	SubmissionDetailView,
} from "~/components/portal/submission-detail-view";
import { getDb, type Db } from "~/db";
import {
	PARTICIPANT_ROLE,
	PARTICIPANT_ROLE_LABELS,
	type ParticipantRole,
} from "~/db/constants";
import {
	contacts,
	formats,
	forms,
	insertContactSchema,
	insertSubmissionSchema,
	languages,
	levels,
	participants,
	rooms,
	submissionRevisions,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
} from "~/db/schema";
import { notifyParticipantAdded } from "~/domain/participant-notifications";
import {
	getEditWindow,
	getPortalContext,
	PARTICIPATION_PROJECTION,
	portalPath,
	portalStatus,
	requireOwnedSubmission,
} from "~/domain/portal";
import { normalizeEmail, requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatInTz, textLength } from "~/lib/format";
import { headshotUrl } from "~/lib/headshot";
import { sanitizeHtml } from "~/lib/html";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.submissions_.$submissionId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

type RoleLimit = { min: number; max: number | null };
type ParticipantRolePolicy = {
	allowedRoles: ParticipantRole[];
	limits: Record<ParticipantRole, RoleLimit>;
};

const DEFAULT_PARTICIPANT_ROLE_POLICY: ParticipantRolePolicy = {
	allowedRoles: ["speaker", "secondary"],
	limits: {
		speaker: { min: 1, max: null },
		chairperson: { min: 0, max: 0 },
		moderator: { min: 0, max: 0 },
		secondary: { min: 0, max: null },
	},
};

function safeMin(value: number): number {
	return Math.max(0, value);
}

function safeMax(value: number | null): number | null {
	return value === null ? null : Math.max(0, value);
}

async function getParticipantRolePolicy(
	db: Db,
	eventId: string,
	formId: string | null,
): Promise<ParticipantRolePolicy> {
	if (!formId) return DEFAULT_PARTICIPANT_ROLE_POLICY;
	const [sourceForm] = await db
		.select({
			allowChairperson: forms.allowChairperson,
			allowModerator: forms.allowModerator,
			roleSpeakerMin: forms.roleSpeakerMin,
			roleSpeakerMax: forms.roleSpeakerMax,
			roleChairpersonMin: forms.roleChairpersonMin,
			roleChairpersonMax: forms.roleChairpersonMax,
			roleModeratorMin: forms.roleModeratorMin,
			roleModeratorMax: forms.roleModeratorMax,
		})
		.from(forms)
		.where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
		.limit(1);
	if (!sourceForm) return DEFAULT_PARTICIPANT_ROLE_POLICY;

	return {
		allowedRoles: [
			"speaker",
			...(sourceForm.allowChairperson ? (["chairperson"] as const) : []),
			...(sourceForm.allowModerator ? (["moderator"] as const) : []),
			"secondary",
		],
		limits: {
			speaker: {
				min: safeMin(sourceForm.roleSpeakerMin),
				max: safeMax(sourceForm.roleSpeakerMax),
			},
			chairperson: sourceForm.allowChairperson
				? {
						min: safeMin(sourceForm.roleChairpersonMin),
						max: safeMax(sourceForm.roleChairpersonMax),
					}
				: { min: 0, max: 0 },
			moderator: sourceForm.allowModerator
				? {
						min: safeMin(sourceForm.roleModeratorMin),
						max: safeMax(sourceForm.roleModeratorMax),
					}
				: { min: 0, max: 0 },
			secondary: { min: 0, max: null },
		},
	};
}

function roleNoun(role: ParticipantRole, count: number): string {
	const noun = PARTICIPANT_ROLE_LABELS[role].toLowerCase();
	return count === 1 ? noun : `${noun}s`;
}

function minimumError(
	policy: ParticipantRolePolicy,
	role: ParticipantRole,
	resultingCount: number,
): string | null {
	const minimum = policy.limits[role].min;
	return resultingCount < minimum
		? `This submission needs at least ${minimum} ${roleNoun(role, minimum)}.`
		: null;
}

function maximumError(
	policy: ParticipantRolePolicy,
	role: ParticipantRole,
	resultingCount: number,
): string | null {
	const maximum = policy.limits[role].max;
	return maximum !== null && resultingCount > maximum
		? `This form allows at most ${maximum} ${roleNoun(role, maximum)}.`
		: null;
}

type ParticipantRoleRow = {
	id: string;
	contactId: string;
	role: ParticipantRole;
	isPrimary: boolean;
	position: number;
};

async function getParticipantRoleRows(
	db: Db,
	submissionId: string,
): Promise<ParticipantRoleRow[]> {
	return db
		.select({
			id: participants.id,
			contactId: participants.contactId,
			role: participants.role,
			isPrimary: participants.isPrimary,
			position: participants.position,
		})
		.from(participants)
		.where(eq(participants.submissionId, submissionId))
		.orderBy(
			asc(participants.position),
			asc(participants.createdAt),
			asc(participants.id),
		);
}

function participantRoleCounts(
	rows: ParticipantRoleRow[],
): Record<ParticipantRole, number> {
	const counts: Record<ParticipantRole, number> = {
		speaker: 0,
		chairperson: 0,
		moderator: 0,
		secondary: 0,
	};
	for (const row of rows) counts[row.role] += 1;
	return counts;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const timings = createTimings();
	const { submission } = await timings.time("db", () =>
		requireOwnedSubmission(env, ctx, params.submissionId),
	);
	const db = getDb(env);

	const [
		editWindow,
		rolePolicy,
		people,
		subTracks,
		subTags,
		eventFormats,
		eventLevels,
		room,
	] = await timings.time("db2", () =>
		Promise.all([
			getEditWindow(env, submission),
			getParticipantRolePolicy(db, ctx.event.id, submission.formId),
			db
				.select({
					id: participants.id,
					contactId: participants.contactId,
					role: participants.role,
					acceptance: participants.acceptanceStatus,
					position: participants.position,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					contactUserId: contacts.userId,
					headshotKey: contacts.headshotKey,
				})
				.from(participants)
				.innerJoin(
					contacts,
					and(
						eq(contacts.id, participants.contactId),
						eq(contacts.eventId, ctx.event.id),
					),
				)
				.where(eq(participants.submissionId, submission.id)),
			db
				.select({ id: tracks.id, name: tracks.name, color: tracks.color })
				.from(submissionTracks)
				.innerJoin(tracks, eq(tracks.id, submissionTracks.trackId))
				.where(eq(submissionTracks.submissionId, submission.id)),
			db
				.select({ id: tags.id, name: tags.name, color: tags.color })
				.from(submissionTags)
				.innerJoin(tags, eq(tags.id, submissionTags.tagId))
				.where(eq(submissionTags.submissionId, submission.id)),
			db
				.select({ id: formats.id, name: formats.name })
				.from(formats)
				.where(eq(formats.eventId, ctx.event.id)),
			db
				.select({ id: levels.id, name: levels.name })
				.from(levels)
				.where(eq(levels.eventId, ctx.event.id)),
			submission.roomId
				? db
						.select({ name: rooms.name })
						.from(rooms)
						.where(eq(rooms.id, submission.roomId))
						.limit(1)
				: Promise.resolve([]),
		]),
	);

	// Edit-form option lists exist only while the edit window is open.
	const [eventLanguages, eventTracks, eventTags] = editWindow.editable
		? await timings.time("db3", () =>
				Promise.all([
					db
						.select({ name: languages.name })
						.from(languages)
						.where(eq(languages.eventId, ctx.event.id)),
					db
						.select({ id: tracks.id, name: tracks.name })
						.from(tracks)
						.where(eq(tracks.eventId, ctx.event.id)),
					db
						.select({ id: tags.id, name: tags.name })
						.from(tags)
						.where(eq(tags.eventId, ctx.event.id)),
				]),
			)
		: [[], [], []];

	const tz = ctx.event.timezone;
	const isAccepted = submission.status === "accepted";
	const sortedPeople = [...people].sort((a, b) => a.position - b.position);
	const isMine = (person: (typeof sortedPeople)[number]) =>
		(ctx.contact !== null && person.contactId === ctx.contact.id) ||
		(ctx.subjectUserId !== null && person.contactUserId === ctx.subjectUserId);

	return data(
		{
			base: portalPath(ctx),
			id: submission.id,
			title: submission.title,
			descriptionHtml: submission.description,
			status: portalStatus(submission.status),
			isDraft: submission.status === "draft",
			isWithdrawn: submission.status === "withdrawn",
			withdrawnReason:
				submission.status === "withdrawn" ? submission.withdrawnReason : null,
			schedule:
				submission.startsAt && submission.endsAt
					? `${formatInTz(submission.startsAt, tz)} – ${formatInTz(submission.endsAt, tz)}`
					: null,
			room: room[0]?.name ?? null,
			meta: {
				format:
					eventFormats.find((f) => f.id === submission.formatId)?.name ?? null,
				level:
					eventLevels.find((l) => l.id === submission.levelId)?.name ?? null,
				language: submission.language,
				tracks: subTracks.map((t) => ({ name: t.name, color: t.color })),
				tags: subTags.map((t) => ({ name: t.name, color: t.color })),
			},
			allowedParticipantRoles: rolePolicy.allowedRoles,
			participants: sortedPeople.map((p) => {
				const mine = isMine(p);
				return {
					id: p.id,
					name: `${p.firstName} ${p.lastName}`,
					photoUrl: headshotUrl(
						portalPath(ctx, `/headshot?contact=${p.contactId}`),
						p.headshotKey,
					),
					role: p.role,
					roleLabel: PARTICIPANT_ROLE_LABELS[p.role],
					isMe: mine,
					acceptance:
						isAccepted && p.role !== "secondary"
							? PARTICIPATION_PROJECTION[p.acceptance]
							: null,
					removable: !mine,
				};
			}),
			myParticipations: sortedPeople
				.filter((person) => isMine(person) && person.role !== "secondary")
				.map((person) => ({
					id: person.id,
					status: PARTICIPATION_PROJECTION[person.acceptance],
					raw: person.acceptance,
					confirmable: isAccepted,
					roleLabel: PARTICIPANT_ROLE_LABELS[person.role],
				})),
			editWindow: {
				editable: editWindow.editable,
				reason: editWindow.reason,
				closesLabel: editWindow.closesAt
					? formatInTz(editWindow.closesAt, tz)
					: null,
			},
			canWithdrawSubmission:
				ctx.subjectUserId !== null &&
				submission.submitterId === ctx.subjectUserId &&
				!["withdrawn", "declined", "draft"].includes(submission.status),
			saved: new URL(request.url).searchParams.get("saved"),
			edit: editWindow.editable
				? {
						formatId: submission.formatId,
						levelId: submission.levelId,
						language: submission.language,
						trackIds: subTracks.map((t) => t.id),
						tagIds: subTags.map((t) => t.id),
						options: {
							formats: eventFormats,
							levels: eventLevels,
							languages: eventLanguages.map((l) => l.name),
							tracks: eventTracks,
							tags: eventTags,
						},
					}
				: null,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

// Derived from the DB schema (single source of truth) with form refinements —
// a renamed column breaks these picks at compile time.
const UpdateSchema = insertSubmissionSchema
	.pick({
		title: true,
		description: true,
		formatId: true,
		levelId: true,
		language: true,
	})
	.extend({
		title: z
			.string()
			.min(1, "Title is required")
			.max(255, "Keep the title under 255 characters"),
		description: z.string().max(60000, "Description is too long"),
		formatId: z.string().optional(),
		levelId: z.string().optional(),
		language: z.string().max(100).optional(),
	});

const AddParticipantSchema = insertContactSchema
	.pick({ firstName: true, lastName: true, email: true })
	.extend({
		firstName: z.string().min(1, "First name is required").max(100),
		lastName: z.string().min(1, "Last name is required").max(100),
		email: z.string().email("Enter a valid email address"),
		role: z.enum(PARTICIPANT_ROLE),
	});

const SetParticipantRoleSchema = z.object({
	participantId: z.string().min(1),
	role: z.enum(PARTICIPANT_ROLE),
});

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const { submission } = await requireOwnedSubmission(
		env,
		ctx,
		params.submissionId,
	);
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const fail = (body: Omit<SubmissionDetailActionData, "intent">) => ({
		intent,
		...body,
	});
	const here = portalPath(ctx, `/submissions/${submission.id}`);
	const timings = createTimings();

	if (
		intent === "confirm-participation" ||
		intent === "withdraw-participation"
	) {
		const participantId = String(form.get("participantId") ?? "");
		if (!ctx.contact) throw data(null, { status: 404 });
		const [ownedParticipant] = await db
			.select({ id: participants.id })
			.from(participants)
			.where(
				and(
					eq(participants.id, participantId),
					eq(participants.submissionId, submission.id),
					eq(participants.contactId, ctx.contact.id),
					ne(participants.role, "secondary"),
				),
			)
			.limit(1);
		if (!ownedParticipant) throw data(null, { status: 404 });
		if (submission.status !== "accepted") {
			return fail({
				formError: "Confirmation is only available on accepted sessions.",
			});
		}
		const contactId = ctx.contact.id;
		const acceptance =
			intent === "confirm-participation" ? "accepted" : "declined";
		const participantUpdate = db
			.update(participants)
			.set({ acceptanceStatus: acceptance })
			.where(
				and(
					eq(participants.id, participantId),
					eq(participants.submissionId, submission.id),
					eq(participants.contactId, contactId),
					ne(participants.role, "secondary"),
				),
			);
		try {
			if (acceptance === "accepted") {
				await timings.time("db", () =>
					db.batch([
						participantUpdate,
						db
							.update(contacts)
							.set({ status: "confirmed" })
							.where(
								and(
									eq(contacts.id, contactId),
									eq(contacts.eventId, ctx.event.id),
								),
							),
					]),
				);
			} else {
				await timings.time("db", () => db.batch([participantUpdate]));
			}
		} catch (error) {
			track("portal.participation_change_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not update your participation — please try again.",
			});
		}
		if (acceptance === "accepted" && ctx.contact.status !== "confirmed") {
			track("contact.status_changed", {
				contactId,
				eventId: ctx.event.id,
				from: ctx.contact.status,
				to: "confirmed",
			});
		}
		track("portal.participation_changed", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			participantId,
			acceptance,
		});
		return data(
			{ intent, ok: true },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (intent === "withdraw-submission") {
		if (submission.submitterId !== user.id) throw data(null, { status: 404 });
		if (["withdrawn", "declined", "draft"].includes(submission.status)) {
			return fail({ formError: "This submission can no longer be withdrawn." });
		}
		const reason = String(form.get("reason") ?? "").trim();
		try {
			await timings.time("db", () =>
				db
					.update(submissions)
					.set({
						status: "withdrawn",
						statusChangedAt: new Date(),
						withdrawnAt: new Date(),
						withdrawnById: user.id,
						withdrawnReason: reason || null,
						// A withdrawn session must not linger on the agenda grid.
						startsAt: null,
						endsAt: null,
						roomId: null,
					})
					.where(eq(submissions.id, submission.id)),
			);
		} catch (error) {
			track("portal.submission_withdraw_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not withdraw the submission — please try again.",
			});
		}
		track("portal.submission_withdrawn", {
			eventId: ctx.event.id,
			submissionId: submission.id,
		});
		return redirect(here, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	// Everything below edits the submission — gated by the form's close date.
	const editWindow = await getEditWindow(env, submission);
	if (!editWindow.editable) {
		return fail({
			formError:
				editWindow.reason ??
				"Editing is no longer available for this submission.",
		});
	}

	if (intent === "update") {
		const parsed = UpdateSchema.safeParse({
			title: form.get("title"),
			description: form.get("description") ?? "",
			formatId: form.get("formatId") || undefined,
			levelId: form.get("levelId") || undefined,
			language: form.get("language") || undefined,
		});
		if (!parsed.success)
			return fail({ fieldErrors: z.flattenError(parsed.error).fieldErrors });
		const description = await sanitizeHtml(parsed.data.description);
		if (textLength(description) > 5000) {
			return fail({
				fieldErrors: {
					description: ["Keep the description under 5,000 characters."],
				},
			});
		}
		// Taxonomy values must belong to THIS event — never trust client input.
		const [eventFormats, eventLevels, eventTracks, eventTags, eventLanguages] =
			await Promise.all([
				db
					.select({ id: formats.id })
					.from(formats)
					.where(eq(formats.eventId, ctx.event.id)),
				db
					.select({ id: levels.id })
					.from(levels)
					.where(eq(levels.eventId, ctx.event.id)),
				db
					.select({ id: tracks.id })
					.from(tracks)
					.where(eq(tracks.eventId, ctx.event.id)),
				db
					.select({ id: tags.id })
					.from(tags)
					.where(eq(tags.eventId, ctx.event.id)),
				db
					.select({ name: languages.name })
					.from(languages)
					.where(eq(languages.eventId, ctx.event.id)),
			]);
		const formatId =
			parsed.data.formatId &&
			eventFormats.some((f) => f.id === parsed.data.formatId)
				? parsed.data.formatId
				: null;
		const levelId =
			parsed.data.levelId &&
			eventLevels.some((l) => l.id === parsed.data.levelId)
				? parsed.data.levelId
				: null;
		const trackIds = form
			.getAll("trackIds")
			.map(String)
			.filter((id) => eventTracks.some((t) => t.id === id));
		const tagIds = form
			.getAll("tagIds")
			.map(String)
			.filter((id) => eventTags.some((t) => t.id === id));

		try {
			await timings.time("db", () =>
				db.batch([
					db
						.update(submissions)
						.set({
							title: parsed.data.title,
							description,
							formatId,
							levelId,
							language:
								parsed.data.language &&
								eventLanguages.some((l) => l.name === parsed.data.language)
									? parsed.data.language
									: submission.language,
						})
						.where(eq(submissions.id, submission.id)),
					db
						.delete(submissionTracks)
						.where(eq(submissionTracks.submissionId, submission.id)),
					db
						.delete(submissionTags)
						.where(eq(submissionTags.submissionId, submission.id)),
					...(trackIds.length
						? [
								db.insert(submissionTracks).values(
									trackIds.map((trackId) => ({
										submissionId: submission.id,
										trackId,
									})),
								),
							]
						: []),
					...(tagIds.length
						? [
								db.insert(submissionTags).values(
									tagIds.map((tagId) => ({
										submissionId: submission.id,
										tagId,
									})),
								),
							]
						: []),
					// Editor-attributed snapshot AFTER the save — history is append-only.
					db.insert(submissionRevisions).values({
						submissionId: submission.id,
						title: parsed.data.title,
						description,
						editedById: user.id,
					}),
				]),
			);
		} catch (error) {
			track("portal.submission_update_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not save your changes — please try again.",
			});
		}
		track("portal.submission_updated", {
			eventId: ctx.event.id,
			submissionId: submission.id,
		});
		return redirect(`${here}?saved=content`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "add-participant") {
		const parsed = AddParticipantSchema.safeParse({
			firstName: form.get("firstName"),
			lastName: form.get("lastName"),
			email: form.get("email"),
			role: form.get("role") ?? "speaker",
		});
		if (!parsed.success)
			return fail({ fieldErrors: z.flattenError(parsed.error).fieldErrors });

		const rolePolicy = await getParticipantRolePolicy(
			db,
			ctx.event.id,
			submission.formId,
		);
		if (!rolePolicy.allowedRoles.includes(parsed.data.role)) {
			return fail({
				formError: `${PARTICIPANT_ROLE_LABELS[parsed.data.role]} is not enabled on the source form.`,
			});
		}
		const existing = await getParticipantRoleRows(db, submission.id);
		const counts = participantRoleCounts(existing);
		const maxError = maximumError(
			rolePolicy,
			parsed.data.role,
			counts[parsed.data.role] + 1,
		);
		if (maxError) return fail({ formError: maxError });

		const email = normalizeEmail(parsed.data.email);
		let [contact] = await db
			.select({ id: contacts.id, userId: contacts.userId })
			.from(contacts)
			.where(and(eq(contacts.eventId, ctx.event.id), eq(contacts.email, email)))
			.limit(1);
		let wasExistingContact = Boolean(contact);
		if (!contact) {
			[contact] = await db
				.insert(contacts)
				.values({
					eventId: ctx.event.id,
					email,
					firstName: parsed.data.firstName,
					lastName: parsed.data.lastName,
				})
				.onConflictDoNothing({ target: [contacts.eventId, contacts.email] })
				.returning({ id: contacts.id, userId: contacts.userId });
			if (!contact) {
				[contact] = await db
					.select({ id: contacts.id, userId: contacts.userId })
					.from(contacts)
					.where(
						and(eq(contacts.eventId, ctx.event.id), eq(contacts.email, email)),
					)
					.limit(1);
				wasExistingContact = true;
			}
		}
		if (!contact) {
			return fail({
				formError: "Could not add this person — please try again.",
			});
		}
		if (
			existing.some(
				(row) => row.contactId === contact.id && row.role === parsed.data.role,
			)
		) {
			return fail({
				formError: "This person is already listed with this role.",
			});
		}

		const participantId = crypto.randomUUID();
		const position =
			existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
		const primaryId =
			existing.find((row) => row.role === "speaker" && row.isPrimary)?.id ??
			existing.find((row) => row.role === "speaker")?.id ??
			(parsed.data.role === "speaker" ? participantId : null);
		const insertion = db
			.insert(participants)
			.values({
				id: participantId,
				submissionId: submission.id,
				contactId: contact.id,
				role: parsed.data.role,
				isPrimary: participantId === primaryId,
				position,
			})
			.onConflictDoNothing({
				target: [
					participants.submissionId,
					participants.contactId,
					participants.role,
				],
			})
			.returning({ id: participants.id });
		const primaryUpdates = existing
			.filter((row) => row.isPrimary !== (row.id === primaryId))
			.map((row) =>
				db
					.update(participants)
					.set({ isPrimary: row.id === primaryId })
					.where(
						and(
							eq(participants.id, row.id),
							eq(participants.submissionId, submission.id),
						),
					),
			);
		let inserted: { id: string } | undefined;
		try {
			const [insertResult] = await timings.time("db", () =>
				db.batch([insertion, ...primaryUpdates]),
			);
			[inserted] = insertResult;
		} catch (error) {
			track("portal.participant_add_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not add this person — please try again.",
			});
		}
		if (!inserted) {
			const [exact] = await db
				.select({ id: participants.id })
				.from(participants)
				.where(
					and(
						eq(participants.submissionId, submission.id),
						eq(participants.contactId, contact.id),
						eq(participants.role, parsed.data.role),
					),
				)
				.limit(1);
			if (exact) {
				return fail({
					formError: "This person is already listed with this role.",
				});
			}
			return fail({
				formError: "Could not add this person — please try again.",
			});
		}

		track("portal.participant_added", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			participantId,
			role: parsed.data.role,
		});
		let warning: string | undefined;
		try {
			const notification = await notifyParticipantAdded(db, env, {
				added: {
					participantId,
					contactId: contact.id,
					wasExistingContact,
					isSelf: contact.userId === user.id,
					role: parsed.data.role,
				},
				event: {
					id: ctx.event.id,
					name: ctx.event.name,
					slug: ctx.event.slug,
				},
				submission: {
					id: submission.id,
					title: submission.title,
					formId: submission.formId,
					submitterId: submission.submitterId,
				},
				origin: new URL(request.url).origin,
			});
			warning = notification.warning;
		} catch (error) {
			track("portal.participant_notification_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				participantId,
				error: errorMessage(error),
			});
			warning =
				"Participant added, but the invitation failed. The participant remains linked to this submission.";
		}
		if (warning) {
			return data(
				{ intent, ok: true, warning },
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
		return redirect(`${here}?saved=participant`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "set-participant-role") {
		const parsed = SetParticipantRoleSchema.safeParse({
			participantId: form.get("participantId"),
			role: form.get("role"),
		});
		if (!parsed.success) {
			return fail({ formError: "Choose a valid participant role." });
		}
		const rolePolicy = await getParticipantRolePolicy(
			db,
			ctx.event.id,
			submission.formId,
		);
		if (!rolePolicy.allowedRoles.includes(parsed.data.role)) {
			return fail({
				formError: `${PARTICIPANT_ROLE_LABELS[parsed.data.role]} is not enabled on the source form.`,
			});
		}
		const rows = await getParticipantRoleRows(db, submission.id);
		const row = rows.find(
			(candidate) => candidate.id === parsed.data.participantId,
		);
		if (!row) throw data(null, { status: 404 });
		if (row.role === parsed.data.role) {
			return redirect(`${here}?saved=role`, {
				headers: { "Server-Timing": timings.header() },
			});
		}
		if (
			rows.some(
				(candidate) =>
					candidate.id !== row.id &&
					candidate.contactId === row.contactId &&
					candidate.role === parsed.data.role,
			)
		) {
			return fail({
				formError: "This person is already listed with the selected role.",
			});
		}
		const counts = participantRoleCounts(rows);
		const minError = minimumError(rolePolicy, row.role, counts[row.role] - 1);
		if (minError) return fail({ formError: minError });
		const maxError = maximumError(
			rolePolicy,
			parsed.data.role,
			counts[parsed.data.role] + 1,
		);
		if (maxError) return fail({ formError: maxError });

		const resultingSpeakers = rows.filter((candidate) =>
			candidate.id === row.id
				? parsed.data.role === "speaker"
				: candidate.role === "speaker",
		);
		const existingPrimary = resultingSpeakers.find((candidate) =>
			candidate.id === row.id ? row.isPrimary : candidate.isPrimary,
		);
		const primaryId = existingPrimary?.id ?? resultingSpeakers[0]?.id ?? null;
		const roleUpdate = db
			.update(participants)
			.set({
				role: parsed.data.role,
				isPrimary: row.id === primaryId,
			})
			.where(
				and(
					eq(participants.id, row.id),
					eq(participants.submissionId, submission.id),
				),
			);
		const primaryUpdates = rows
			.filter(
				(candidate) =>
					candidate.id !== row.id &&
					candidate.isPrimary !== (candidate.id === primaryId),
			)
			.map((candidate) =>
				db
					.update(participants)
					.set({ isPrimary: candidate.id === primaryId })
					.where(
						and(
							eq(participants.id, candidate.id),
							eq(participants.submissionId, submission.id),
						),
					),
			);
		try {
			await timings.time("db", () => db.batch([roleUpdate, ...primaryUpdates]));
		} catch (error) {
			track("portal.participant_role_change_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				participantId: row.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not change this role — please try again.",
			});
		}
		track("portal.participant_role_changed", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			participantId: row.id,
			fromRole: row.role,
			toRole: parsed.data.role,
		});
		return redirect(`${here}?saved=role`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "remove-participant") {
		const participantId = String(form.get("participantId") ?? "");
		const rows = await getParticipantRoleRows(db, submission.id);
		const row = rows.find((candidate) => candidate.id === participantId);
		if (!row) throw data(null, { status: 404 });
		if (ctx.contact?.id === row.contactId) {
			return fail({
				formError:
					"To step back yourself, use your participation controls instead.",
			});
		}
		const rolePolicy = await getParticipantRolePolicy(
			db,
			ctx.event.id,
			submission.formId,
		);
		const counts = participantRoleCounts(rows);
		const minError = minimumError(rolePolicy, row.role, counts[row.role] - 1);
		if (minError) return fail({ formError: minError });

		const remaining = rows.filter((candidate) => candidate.id !== row.id);
		const remainingSpeakers = remaining.filter(
			(candidate) => candidate.role === "speaker",
		);
		const primaryId =
			remainingSpeakers.find((candidate) => candidate.isPrimary)?.id ??
			remainingSpeakers[0]?.id ??
			null;
		const removal = db
			.delete(participants)
			.where(
				and(
					eq(participants.id, row.id),
					eq(participants.submissionId, submission.id),
				),
			);
		const primaryUpdates = remaining
			.filter(
				(candidate) => candidate.isPrimary !== (candidate.id === primaryId),
			)
			.map((candidate) =>
				db
					.update(participants)
					.set({ isPrimary: candidate.id === primaryId })
					.where(
						and(
							eq(participants.id, candidate.id),
							eq(participants.submissionId, submission.id),
						),
					),
			);
		try {
			await timings.time("db", () => db.batch([removal, ...primaryUpdates]));
		} catch (error) {
			track("portal.participant_remove_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				participantId: row.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not remove this person — please try again.",
			});
		}
		track("portal.participant_removed", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			participantId: row.id,
			role: row.role,
		});
		return redirect(`${here}?saved=removed`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return fail({ formError: "Unknown action." });
}

export default function PortalSubmissionDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return (
		<SubmissionDetailView
			data={loaderData}
			actionData={actionData ?? undefined}
		/>
	);
}
