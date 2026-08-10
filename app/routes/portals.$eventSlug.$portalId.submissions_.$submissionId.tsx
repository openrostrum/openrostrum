import { and, eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";
import {
	type SubmissionDetailActionData,
	SubmissionDetailView,
} from "~/components/portal/submission-detail-view";
import { getDb } from "~/db";
import {
	contacts,
	formats,
	forms,
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
import { sanitizeHtml } from "~/lib/html";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.submissions_.$submissionId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const timings = createTimings();
	const { submission, myParticipant } = await timings.time("db", () =>
		requireOwnedSubmission(env, ctx, user.id, params.submissionId),
	);
	const db = getDb(env);

	const [
		editWindow,
		people,
		subTracks,
		subTags,
		eventFormats,
		eventLevels,
		room,
	] = await timings.time("db2", () =>
		Promise.all([
			getEditWindow(env, submission),
			db
				.select({
					id: participants.id,
					role: participants.role,
					acceptance: participants.acceptanceStatus,
					position: participants.position,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					contactUserId: contacts.userId,
				})
				.from(participants)
				.innerJoin(contacts, eq(contacts.id, participants.contactId))
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
			participants: sortedPeople.map((p) => ({
				id: p.id,
				name: `${p.firstName} ${p.lastName}`,
				role: p.role,
				isMe: p.contactUserId === user.id,
				acceptance:
					isAccepted && p.role !== "secondary"
						? PARTICIPATION_PROJECTION[p.acceptance]
						: null,
				removable: p.contactUserId !== user.id,
			})),
			myParticipation: myParticipant
				? {
						id: myParticipant.id,
						status: PARTICIPATION_PROJECTION[myParticipant.acceptanceStatus],
						raw: myParticipant.acceptanceStatus,
						confirmable: isAccepted,
					}
				: null,
			editWindow: {
				editable: editWindow.editable,
				reason: editWindow.reason,
				closesLabel: editWindow.closesAt
					? formatInTz(editWindow.closesAt, tz)
					: null,
			},
			canWithdrawSubmission:
				submission.submitterId === user.id &&
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

const UpdateSchema = z.object({
	title: z
		.string()
		.min(1, "Title is required")
		.max(255, "Keep the title under 255 characters"),
	description: z.string().max(60000, "Description is too long"),
	formatId: z.string().optional(),
	levelId: z.string().optional(),
	language: z.string().max(100).optional(),
});

const AddParticipantSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(100),
	lastName: z.string().min(1, "Last name is required").max(100),
	email: z.string().email("Enter a valid email address"),
	role: z.enum(["speaker", "secondary"]),
});

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const { submission, myParticipant } = await requireOwnedSubmission(
		env,
		ctx,
		user.id,
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

	if (
		intent === "confirm-participation" ||
		intent === "withdraw-participation"
	) {
		const participantId = String(form.get("participantId") ?? "");
		// She can only ever act on HER OWN row — id match + contact match.
		if (!myParticipant || myParticipant.id !== participantId)
			throw data(null, { status: 404 });
		if (submission.status !== "accepted") {
			return fail({
				formError: "Confirmation is only available on accepted sessions.",
			});
		}
		const acceptance =
			intent === "confirm-participation" ? "accepted" : "declined";
		await db
			.update(participants)
			.set({ acceptanceStatus: acceptance })
			.where(eq(participants.id, myParticipant.id));
		track("portal.participation_changed", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			participantId: myParticipant.id,
			acceptance,
		});
		return { intent, ok: true };
	}

	if (intent === "withdraw-submission") {
		if (submission.submitterId !== user.id) throw data(null, { status: 404 });
		if (["withdrawn", "declined", "draft"].includes(submission.status)) {
			return fail({ formError: "This submission can no longer be withdrawn." });
		}
		const reason = String(form.get("reason") ?? "").trim();
		await db
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
			.where(eq(submissions.id, submission.id));
		track("portal.submission_withdrawn", {
			eventId: ctx.event.id,
			submissionId: submission.id,
		});
		return redirect(here);
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
		// Taxonomy ids must belong to THIS event — never trust client ids.
		const [eventFormats, eventLevels, eventTracks, eventTags] =
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
			await db.batch([
				db
					.update(submissions)
					.set({
						title: parsed.data.title,
						description,
						formatId,
						levelId,
						language: parsed.data.language || submission.language,
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
			]);
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
		return redirect(`${here}?saved=content`);
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

		if (parsed.data.role === "speaker" && submission.formId) {
			const [sourceForm] = await db
				.select({ max: forms.roleSpeakerMax })
				.from(forms)
				.where(eq(forms.id, submission.formId))
				.limit(1);
			if (sourceForm?.max) {
				const current = await db
					.select({ id: participants.id })
					.from(participants)
					.where(
						and(
							eq(participants.submissionId, submission.id),
							eq(participants.role, "speaker"),
						),
					);
				if (current.length >= sourceForm.max) {
					return fail({
						formError: `This form allows at most ${sourceForm.max} speakers.`,
					});
				}
			}
		}

		const email = normalizeEmail(parsed.data.email);
		let [contact] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.eventId, ctx.event.id), eq(contacts.email, email)))
			.limit(1);
		if (!contact) {
			[contact] = await db
				.insert(contacts)
				.values({
					eventId: ctx.event.id,
					email,
					firstName: parsed.data.firstName,
					lastName: parsed.data.lastName,
				})
				.returning({ id: contacts.id });
		}
		if (!contact) {
			return fail({
				formError: "Could not add this person — please try again.",
			});
		}
		const existing = await db
			.select({ id: participants.id })
			.from(participants)
			.where(eq(participants.submissionId, submission.id));
		try {
			await db.insert(participants).values({
				submissionId: submission.id,
				contactId: contact.id,
				role: parsed.data.role,
				position: existing.length,
			});
		} catch (error) {
			// Drizzle wraps the SQLite detail in `cause` — read both layers so
			// only the (submission, contact) uniqueness gets the "already on it"
			// copy; any other failure must not masquerade as a duplicate.
			const cause = (error as { cause?: unknown }).cause;
			const detail = `${errorMessage(error)} ${cause ? errorMessage(cause) : ""}`;
			track("portal.participant_add_failed", {
				eventId: ctx.event.id,
				submissionId: submission.id,
				error: detail,
			});
			return fail({
				formError: /unique|constraint/i.test(detail)
					? "This person is already on this submission."
					: "Could not add this person — please try again.",
			});
		}
		track("portal.participant_added", {
			eventId: ctx.event.id,
			submissionId: submission.id,
			role: parsed.data.role,
		});
		return redirect(`${here}?saved=participant`);
	}

	if (intent === "remove-participant") {
		const participantId = String(form.get("participantId") ?? "");
		const [row] = await db
			.select({
				id: participants.id,
				role: participants.role,
				contactUserId: contacts.userId,
			})
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId))
			.where(
				and(
					eq(participants.id, participantId),
					eq(participants.submissionId, submission.id),
				),
			)
			.limit(1);
		if (!row) throw data(null, { status: 404 });
		if (row.contactUserId === user.id) {
			return fail({
				formError:
					"To step back yourself, use your participation controls instead.",
			});
		}
		if (row.role === "speaker") {
			let minSpeakers = 1;
			if (submission.formId) {
				const [sourceForm] = await db
					.select({ min: forms.roleSpeakerMin })
					.from(forms)
					.where(eq(forms.id, submission.formId))
					.limit(1);
				minSpeakers = Math.max(1, sourceForm?.min ?? 1);
			}
			const speakers = await db
				.select({ id: participants.id })
				.from(participants)
				.where(
					and(
						eq(participants.submissionId, submission.id),
						eq(participants.role, "speaker"),
					),
				);
			if (speakers.length - 1 < minSpeakers) {
				return fail({
					formError: `This submission needs at least ${minSpeakers} speaker${minSpeakers > 1 ? "s" : ""}.`,
				});
			}
		}
		await db.delete(participants).where(eq(participants.id, row.id));
		track("portal.participant_removed", {
			eventId: ctx.event.id,
			submissionId: submission.id,
		});
		return redirect(`${here}?saved=removed`);
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
