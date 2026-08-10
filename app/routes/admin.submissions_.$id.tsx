import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { useState } from "react";
import {
	data,
	Form,
	isRouteErrorResponse,
	redirect,
	useRouteError,
} from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { CONTENT_STATUS, DECISION_STATUS } from "~/db/constants";
import type { Submission } from "~/db/schema";
import {
	files,
	formats,
	languages,
	levels,
	sessionStatuses,
	submissionRevisions,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
	users,
} from "~/db/schema";
import { transitionSubmissions } from "~/domain/accept";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatInTimezone, formatScheduleRange } from "~/lib/format-date";
import { CONTENT_STATUS_TONE, humanStatus } from "~/lib/submission-list";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	Chip,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Table,
	TBody,
	Td,
	Textarea,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { BadgeTone } from "~/ui";
import type { Route } from "./+types/admin.submissions_.$id";

// Pins the client-safe tuple to the schema's enum — drift fails compilation.
const CONTENT_STATUS_OPTIONS =
	CONTENT_STATUS satisfies readonly Submission["contentStatus"][];

const ACCEPTANCE_TONE = {
	pending: "warning",
	accepted: "success",
	declined: "danger",
} as const satisfies Record<string, BadgeTone>;

const REVIEW_DECISION_TONE = {
	approve: "success",
	maybe: "warning",
	deny: "danger",
} as const satisfies Record<string, BadgeTone>;

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — single-fetch can run this loader alone via `?_routes=`.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw data("No event is configured yet.", { status: 404 });
	const db = getDb(env);
	const timings = createTimings();
	const tz = event.timezone;

	const payload = await timings.time("db", async () => {
		const row = await db.query.submissions.findFirst({
			// Scoped to the ACTIVE event: another org's (or event's) id is a 404,
			// indistinguishable from a missing record.
			where: (s, { and: andOp, eq: eqOp }) =>
				andOp(eqOp(s.id, params.id), eqOp(s.eventId, event.id)),
			with: {
				form: { columns: { internalName: true } },
				format: true,
				level: true,
				room: true,
				customStatus: true,
				submitter: { columns: { name: true, email: true } },
				participants: {
					with: { contact: true },
					orderBy: (p, { asc: ascOp, desc: descOp }) => [
						descOp(p.isPrimary),
						ascOp(p.position),
					],
				},
				submissionTracks: true,
				submissionTags: true,
				submissionAnswers: { with: { field: true } },
				reviews: {
					with: { reviewer: { columns: { name: true, email: true } } },
				},
			},
		});
		if (!row) return null;

		// Revisions order by INSERTION (rowid), not createdAt: two snapshots can
		// land in the same second and history must never shuffle.
		const revisionRows = await db
			.select({
				id: submissionRevisions.id,
				title: submissionRevisions.title,
				description: submissionRevisions.description,
				createdAt: submissionRevisions.createdAt,
				editorName: users.name,
				editorEmail: users.email,
			})
			.from(submissionRevisions)
			.leftJoin(users, eq(users.id, submissionRevisions.editedById))
			.where(eq(submissionRevisions.submissionId, row.id))
			.orderBy(desc(sql`${submissionRevisions}.rowid`));

		const [fileRows, withdrawnBy, library] = await Promise.all([
			db
				.select()
				.from(files)
				.where(eq(files.submissionId, row.id))
				.orderBy(desc(files.createdAt)),
			row.withdrawnById
				? db
						.select({ name: users.name, email: users.email })
						.from(users)
						.where(eq(users.id, row.withdrawnById))
						.then((r) => r[0] ?? null)
				: Promise.resolve(null),
			loadLibrary(db, event.id),
		]);

		const tally = { approve: 0, maybe: 0, deny: 0 };
		for (const r of row.reviews) tally[r.decision] += 1;

		return {
			eventName: event.name,
			submission: {
				id: row.id,
				title: row.title,
				description: row.description,
				type: row.type,
				status: row.status,
				contentStatus: row.contentStatus,
				language: row.language,
				formatId: row.formatId,
				levelId: row.levelId,
				customStatusId: row.customStatusId,
				customStatusName: row.customStatus?.name ?? null,
				trackIds: row.submissionTracks.map((t) => t.trackId),
				tagIds: row.submissionTags.map((t) => t.tagId),
				sourceName: row.form?.internalName ?? "Manual",
				submitterLabel: row.submitter
					? (row.submitter.name ?? row.submitter.email)
					: null,
				createdAt: formatInTimezone(row.createdAt, tz),
				updatedAt: formatInTimezone(row.updatedAt, tz),
				statusChangedAt: row.statusChangedAt
					? formatInTimezone(row.statusChangedAt, tz)
					: null,
				notifiedAt: row.notifiedAt
					? formatInTimezone(row.notifiedAt, tz)
					: null,
				schedule: formatScheduleRange(row.startsAt, row.endsAt, tz),
				roomName: row.room?.name ?? null,
				withdrawal: row.withdrawnAt
					? {
							by: withdrawnBy
								? (withdrawnBy.name ?? withdrawnBy.email)
								: "Unknown user",
							at: formatInTimezone(row.withdrawnAt, tz),
							reason: row.withdrawnReason ?? "",
						}
					: null,
			},
			participants: row.participants.map((p) => ({
				id: p.id,
				name: `${p.contact.firstName} ${p.contact.lastName}`,
				email: p.contact.email,
				role: p.role,
				isPrimary: p.isPrimary,
				acceptanceStatus: p.acceptanceStatus,
			})),
			answers: row.submissionAnswers.map((a) => ({
				id: a.id,
				label: a.field.name,
				value: a.value,
			})),
			revisions: revisionRows.map((r) => ({
				id: r.id,
				title: r.title,
				description: r.description,
				editor: r.editorName ?? r.editorEmail ?? "Unknown",
				at: formatInTimezone(r.createdAt, tz),
			})),
			files: fileRows.map((f) => ({
				id: f.id,
				fileName: f.fileName,
				kind: f.kind,
				version: f.version,
				reviewStatus: f.reviewStatus,
				size: formatBytes(f.sizeBytes),
				at: formatInTimezone(f.createdAt, tz),
			})),
			reviews: {
				tally,
				rows: row.reviews.map((r) => ({
					id: r.id,
					reviewer: r.reviewer.name ?? r.reviewer.email,
					decision: r.decision,
					comment: r.comment,
					at: formatInTimezone(r.updatedAt, tz),
				})),
			},
			library,
		};
	});
	if (!payload) throw data("Submission not found.", { status: 404 });
	return data(payload, { headers: { "Server-Timing": timings.header() } });
}

async function loadLibrary(db: ReturnType<typeof getDb>, eventId: string) {
	const [trackRows, tagRows, formatRows, levelRows, languageRows, statusRows] =
		await Promise.all([
			db
				.select({ id: tracks.id, name: tracks.name, color: tracks.color })
				.from(tracks)
				.where(eq(tracks.eventId, eventId))
				.orderBy(asc(tracks.name)),
			db
				.select({ id: tags.id, name: tags.name, color: tags.color })
				.from(tags)
				.where(eq(tags.eventId, eventId))
				.orderBy(asc(tags.name)),
			db
				.select({ id: formats.id, name: formats.name })
				.from(formats)
				.where(eq(formats.eventId, eventId))
				.orderBy(asc(formats.position)),
			db
				.select({ id: levels.id, name: levels.name })
				.from(levels)
				.where(eq(levels.eventId, eventId))
				.orderBy(asc(levels.position)),
			db
				.select({ name: languages.name })
				.from(languages)
				.where(eq(languages.eventId, eventId))
				.orderBy(asc(languages.position)),
			db
				.select({ id: sessionStatuses.id, name: sessionStatuses.name })
				.from(sessionStatuses)
				.where(eq(sessionStatuses.eventId, eventId))
				.orderBy(asc(sessionStatuses.position)),
		]);
	return {
		tracks: trackRows,
		tags: tagRows,
		formats: formatRows,
		levels: levelRows,
		languages: languageRows.map((l) => l.name),
		customStatuses: statusRows,
	};
}

function formatBytes(size: number | null): string {
	if (size == null) return "—";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type ActionData = {
	notice?: string;
	formError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
};

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run parent loaders.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) return { formError: "No event is configured yet." };
	const db = getDb(env);
	const form = await request.formData();

	// Every intent operates on THIS event's row only — a foreign id is a 404.
	const [row] = await db
		.select()
		.from(submissions)
		.where(
			and(eq(submissions.id, params.id), eq(submissions.eventId, event.id)),
		);
	if (!row) throw data("Submission not found.", { status: 404 });

	const intent = form.get("intent");
	const timings = createTimings();
	try {
		const result = await timings.time(
			"db",
			(): Promise<ActionData | "deleted"> => {
				switch (intent) {
					case "set-status":
						return setStatus(db, row, form);
					case "set-custom-status":
						return setCustomStatus(db, row, event.id, form);
					case "save-content":
						return saveContent(db, row, user.id, form);
					case "restore-revision":
						return restoreRevision(db, row, user.id, form);
					case "set-content-status":
						return setContentStatus(db, row, form);
					case "save-taxonomy":
						return saveTaxonomy(db, row, event.id, form);
					case "delete":
						return deleteSubmission(db, row);
					default:
						return Promise.resolve({ formError: "Unknown action." });
				}
			},
		);
		if (result === "deleted") {
			track("submission.deleted", {
				submissionId: row.id,
				eventId: event.id,
				status: row.status,
				type: row.type,
			});
			return redirect(
				row.type === "abstract" ? "/admin/abstracts" : "/admin/sessions",
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
		return data(result, { headers: { "Server-Timing": timings.header() } });
	} catch (error) {
		// Log the detail server-side; never leak SQL/row values into the UI.
		track("submission.detail_action_failed", {
			submissionId: row.id,
			eventId: event.id,
			intent: typeof intent === "string" ? intent : "unknown",
			error: errorMessage(error),
		});
		return data(
			{ formError: "That change could not be saved — please try again." },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
}

async function setStatus(
	db: ReturnType<typeof getDb>,
	row: Submission,
	form: FormData,
): Promise<ActionData> {
	const parsed = z.enum(DECISION_STATUS).safeParse(form.get("status"));
	if (!parsed.success) return { formError: "Pick a valid status." };
	// THE spine — the one code path for every decision transition.
	const [transition] = await transitionSubmissions(db, [row], parsed.data);
	if (transition && !transition.ok) return { formError: transition.reason };
	return {
		notice: `Status set to ${humanStatus(parsed.data)}. Status changes never email speakers — send decision emails from the submissions list.`,
	};
}

async function setCustomStatus(
	db: ReturnType<typeof getDb>,
	row: Submission,
	eventId: string,
	form: FormData,
): Promise<ActionData> {
	const value = String(form.get("customStatusId") ?? "");
	if (!value) {
		await db
			.update(submissions)
			.set({ customStatusId: null })
			.where(eq(submissions.id, row.id));
		track("submission.custom_status_set", {
			submissionId: row.id,
			eventId,
			customStatusId: null,
		});
		return { notice: "Custom status cleared." };
	}
	const [status] = await db
		.select()
		.from(sessionStatuses)
		.where(
			and(eq(sessionStatuses.id, value), eq(sessionStatuses.eventId, eventId)),
		);
	if (!status) {
		return { formError: "That custom status does not belong to this event." };
	}
	await db
		.update(submissions)
		.set({ customStatusId: status.id })
		.where(eq(submissions.id, row.id));
	track("submission.custom_status_set", {
		submissionId: row.id,
		eventId,
		customStatusId: status.id,
	});
	return { notice: `Custom status set to "${status.name}".` };
}

const SaveContent = z.object({
	title: z.string().min(1, "Title is required"),
	description: z.string(),
});

async function saveContent(
	db: ReturnType<typeof getDb>,
	row: Submission,
	editorId: string,
	form: FormData,
): Promise<ActionData> {
	const parsed = SaveContent.safeParse({
		title: form.get("title"),
		description: form.get("description") ?? "",
	});
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
	}
	const { title, description } = parsed.data;
	if (title === row.title && description === row.description) {
		return { notice: "No changes to save." };
	}
	const [revisionCount] = await db
		.select({ n: count() })
		.from(submissionRevisions)
		.where(eq(submissionRevisions.submissionId, row.id));
	// Content save + its history snapshot commit together (D1: one batch). The
	// FIRST save also snapshots the pre-edit content (attributed to the
	// submitter, stamped with its last write time) so the original text is
	// never lost to history.
	await db.batch([
		db
			.update(submissions)
			.set({ title, description })
			.where(eq(submissions.id, row.id)),
		...((revisionCount?.n ?? 0) === 0
			? [
					db.insert(submissionRevisions).values({
						submissionId: row.id,
						title: row.title,
						description: row.description,
						editedById: row.submitterId,
						createdAt: row.updatedAt,
					}),
				]
			: []),
		db.insert(submissionRevisions).values({
			submissionId: row.id,
			title,
			description,
			editedById: editorId,
		}),
	]);
	track("submission.content_saved", {
		submissionId: row.id,
		eventId: row.eventId,
	});
	return { notice: "Content saved — a new revision was recorded." };
}

async function restoreRevision(
	db: ReturnType<typeof getDb>,
	row: Submission,
	editorId: string,
	form: FormData,
): Promise<ActionData> {
	const revisionId = String(form.get("revisionId") ?? "");
	if (!revisionId) return { formError: "Pick a revision to restore." };
	const [revision] = await db
		.select()
		.from(submissionRevisions)
		.where(
			and(
				eq(submissionRevisions.id, revisionId),
				eq(submissionRevisions.submissionId, row.id),
			),
		);
	if (!revision) {
		return { formError: "That revision does not belong to this submission." };
	}
	if (
		revision.title === row.title &&
		revision.description === row.description
	) {
		return { notice: "The submission already matches that revision." };
	}
	// History is append-only: a restore writes the old content back AND records
	// itself as a new revision — nothing is ever rewritten or deleted.
	await db.batch([
		db
			.update(submissions)
			.set({ title: revision.title, description: revision.description })
			.where(eq(submissions.id, row.id)),
		db.insert(submissionRevisions).values({
			submissionId: row.id,
			title: revision.title,
			description: revision.description,
			editedById: editorId,
		}),
	]);
	track("submission.revision_restored", {
		submissionId: row.id,
		eventId: row.eventId,
		revisionId,
	});
	return {
		notice: "Revision restored — the restore was recorded as a new revision.",
	};
}

async function setContentStatus(
	db: ReturnType<typeof getDb>,
	row: Submission,
	form: FormData,
): Promise<ActionData> {
	const parsed = z
		.enum(CONTENT_STATUS_OPTIONS)
		.safeParse(form.get("contentStatus"));
	if (!parsed.success) return { formError: "Pick a valid content status." };
	if (parsed.data === row.contentStatus) {
		return { notice: "Content status is unchanged." };
	}
	await db
		.update(submissions)
		.set({ contentStatus: parsed.data })
		.where(eq(submissions.id, row.id));
	track("submission.content_status_changed", {
		submissionId: row.id,
		eventId: row.eventId,
		from: row.contentStatus,
		to: parsed.data,
	});
	return {
		notice:
			parsed.data === "approved"
				? "Content approved — it can now appear on public pages."
				: `Content status set to ${humanStatus(parsed.data)} — it stays off public pages until approved.`,
	};
}

const SaveTaxonomy = z.object({
	formatId: z.string().optional(),
	levelId: z.string().optional(),
	language: z.string().min(1, "Language is required"),
	trackIds: z.array(z.string().min(1)),
	tagIds: z.array(z.string().min(1)),
});

async function saveTaxonomy(
	db: ReturnType<typeof getDb>,
	row: Submission,
	eventId: string,
	form: FormData,
): Promise<ActionData> {
	const parsed = SaveTaxonomy.safeParse({
		formatId: form.get("formatId") || undefined,
		levelId: form.get("levelId") || undefined,
		language: form.get("language") || "English",
		trackIds: form.getAll("trackIds").map(String),
		tagIds: form.getAll("tagIds").map(String),
	});
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
	}
	const { formatId, levelId, language, trackIds, tagIds } = parsed.data;

	// Every referenced id must belong to THIS event — a forged foreign id is
	// refused, never written.
	const [formatRows, levelRows, trackRows, tagRows] = await Promise.all([
		formatId
			? db
					.select({ id: formats.id })
					.from(formats)
					.where(and(eq(formats.id, formatId), eq(formats.eventId, eventId)))
			: Promise.resolve([]),
		levelId
			? db
					.select({ id: levels.id })
					.from(levels)
					.where(and(eq(levels.id, levelId), eq(levels.eventId, eventId)))
			: Promise.resolve([]),
		trackIds.length
			? db
					.select({ id: tracks.id })
					.from(tracks)
					.where(and(inArray(tracks.id, trackIds), eq(tracks.eventId, eventId)))
			: Promise.resolve([]),
		tagIds.length
			? db
					.select({ id: tags.id })
					.from(tags)
					.where(and(inArray(tags.id, tagIds), eq(tags.eventId, eventId)))
			: Promise.resolve([]),
	]);
	if (
		(formatId && formatRows.length === 0) ||
		(levelId && levelRows.length === 0) ||
		trackRows.length !== trackIds.length ||
		tagRows.length !== tagIds.length
	) {
		return {
			formError: "Some selected options do not belong to this event.",
		};
	}

	await db.batch([
		db
			.update(submissions)
			.set({
				formatId: formatId ?? null,
				levelId: levelId ?? null,
				language,
			})
			.where(eq(submissions.id, row.id)),
		db
			.delete(submissionTracks)
			.where(eq(submissionTracks.submissionId, row.id)),
		...(trackIds.length
			? [
					db
						.insert(submissionTracks)
						.values(
							trackIds.map((trackId) => ({ submissionId: row.id, trackId })),
						),
				]
			: []),
		db.delete(submissionTags).where(eq(submissionTags.submissionId, row.id)),
		...(tagIds.length
			? [
					db
						.insert(submissionTags)
						.values(tagIds.map((tagId) => ({ submissionId: row.id, tagId }))),
				]
			: []),
	]);
	track("submission.taxonomy_saved", {
		submissionId: row.id,
		eventId,
		tracks: trackIds.length,
		tags: tagIds.length,
	});
	return { notice: "Taxonomy saved." };
}

async function deleteSubmission(
	db: ReturnType<typeof getDb>,
	row: Submission,
): Promise<"deleted"> {
	// Schema cascades own the children (participants, answers, revisions,
	// reviews, track/tag links, task assignments); file records survive with
	// submissionId nulled so the files library keeps its history.
	await db.delete(submissions).where(eq(submissions.id, row.id));
	return "deleted";
}

export default function SubmissionDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		submission: s,
		participants,
		answers,
		revisions,
		files: fileRows,
		reviews,
		library,
	} = loaderData;
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const feedback = (actionData ?? undefined) as ActionData | undefined;
	const languageOptions = library.languages.includes(s.language)
		? library.languages
		: [s.language, ...library.languages];
	const backHref =
		s.type === "abstract" ? "/admin/abstracts" : "/admin/sessions";

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<div>
				<TextLink to={backHref}>
					← Back to {s.type === "abstract" ? "abstracts" : "sessions"}
				</TextLink>
			</div>
			<PageHeader
				title={s.title}
				count={s.type}
				subtitle={`Source: ${s.sourceName}${s.submitterLabel ? ` · Submitted by ${s.submitterLabel}` : ""} · Created ${s.createdAt}`}
				actions={
					<StatusBadge tone={SUBMISSION_STATUS_TONE[s.status]}>
						{humanStatus(s.status)}
					</StatusBadge>
				}
			/>

			{feedback?.notice && <p>{feedback.notice}</p>}
			{feedback?.formError && <ErrorText>{feedback.formError}</ErrorText>}

			<div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[3fr_2fr]">
				<div className="flex flex-col gap-5">
					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input
								type="hidden"
								name="intent"
								value="save-content"
								readOnly
							/>
							<Field label="Title" error={feedback?.fieldErrors?.title?.[0]}>
								<Input
									name="title"
									defaultValue={s.title}
									invalid={Boolean(feedback?.fieldErrors?.title?.[0])}
								/>
							</Field>
							<Field label="Description / abstract">
								<Textarea
									name="description"
									defaultValue={s.description}
									rows={8}
								/>
							</Field>
							<div className="flex items-center gap-3">
								<Button type="submit">Save content</Button>
								<p>Every save records a revision below.</p>
							</div>
						</Form>
					</Panel>

					<Table>
						<THead>
							<Th>Revision history</Th>
							<Th>Editor</Th>
							<Th>Title at that point</Th>
							<Th> </Th>
						</THead>
						<TBody>
							{revisions.map((r, i) => (
								<Tr key={r.id}>
									<Td kind="mono">{r.at}</Td>
									<Td>{r.editor}</Td>
									<Td kind="strong">{r.title}</Td>
									<Td>
										{i === 0 ? (
											"Current"
										) : (
											<Form method="post">
												<Input
													type="hidden"
													name="intent"
													value="restore-revision"
													readOnly
												/>
												<Input
													type="hidden"
													name="revisionId"
													value={r.id}
													readOnly
												/>
												<Button type="submit" variant="ghost">
													Restore
												</Button>
											</Form>
										)}
									</Td>
								</Tr>
							))}
							{revisions.length === 0 && (
								<EmptyRow colSpan={4}>
									No revisions yet — saving the content above records the first
									one.
								</EmptyRow>
							)}
						</TBody>
					</Table>

					<Table>
						<THead>
							<Th>Participant</Th>
							<Th>Email</Th>
							<Th>Role</Th>
							<Th>Acceptance</Th>
						</THead>
						<TBody>
							{participants.map((p) => (
								<Tr key={p.id}>
									<Td kind="strong">
										{p.name}
										{p.isPrimary ? " · primary" : ""}
									</Td>
									<Td>{p.email}</Td>
									<Td>{p.role}</Td>
									<Td>
										<StatusBadge tone={ACCEPTANCE_TONE[p.acceptanceStatus]}>
											{p.acceptanceStatus}
										</StatusBadge>
									</Td>
								</Tr>
							))}
							{participants.length === 0 && (
								<EmptyRow colSpan={4}>
									No participants on this submission yet.
								</EmptyRow>
							)}
						</TBody>
					</Table>

					<Panel>
						<div className="flex flex-col gap-2">
							<h2>Form answers</h2>
							{answers.map((a) => (
								<div key={a.id} className="flex flex-wrap gap-2">
									<span>{a.label}:</span>
									<span>{a.value ?? "—"}</span>
								</div>
							))}
							{answers.length === 0 && (
								<p>No custom form answers on this submission.</p>
							)}
						</div>
					</Panel>

					<Table>
						<THead>
							<Th>File</Th>
							<Th>Kind</Th>
							<Th>Version</Th>
							<Th>Review</Th>
							<Th>Size</Th>
							<Th>Uploaded</Th>
						</THead>
						<TBody>
							{fileRows.map((f) => (
								<Tr key={f.id}>
									<Td kind="strong">{f.fileName}</Td>
									<Td>{f.kind}</Td>
									<Td kind="mono">v{f.version}</Td>
									<Td>{f.reviewStatus === "none" ? "—" : f.reviewStatus}</Td>
									<Td kind="mono">{f.size}</Td>
									<Td kind="mono">{f.at}</Td>
								</Tr>
							))}
							{fileRows.length === 0 && (
								<EmptyRow colSpan={6}>
									No files yet — speaker uploads and admin attachments will be
									listed here.
								</EmptyRow>
							)}
						</TBody>
					</Table>

					<Panel>
						<div className="flex flex-col gap-3">
							<h2>
								Reviews — {reviews.tally.approve} approve ·{" "}
								{reviews.tally.maybe} maybe · {reviews.tally.deny} deny
							</h2>
							{reviews.rows.map((r) => (
								<div key={r.id} className="flex flex-wrap items-center gap-2">
									<StatusBadge tone={REVIEW_DECISION_TONE[r.decision]}>
										{r.decision}
									</StatusBadge>
									<span>{r.reviewer}</span>
									{r.comment && <span>— {r.comment}</span>}
								</div>
							))}
							{reviews.rows.length === 0 && <p>No reviewer decisions yet.</p>}
						</div>
					</Panel>
				</div>

				<div className="flex flex-col gap-5">
					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input type="hidden" name="intent" value="set-status" readOnly />
							<Field label="Decision status">
								<Select key={s.status} name="status" defaultValue={s.status}>
									{s.status === "withdrawn" && (
										<option value="withdrawn" disabled>
											withdrawn
										</option>
									)}
									{s.status === "draft" && (
										<option value="draft" disabled>
											draft
										</option>
									)}
									{DECISION_STATUS.map((st) => (
										<option key={st} value={st}>
											{humanStatus(st)}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit" variant="ghost">
								Update status
							</Button>
							<p>
								Status changes never email speakers — decision emails are sent
								explicitly from the submissions list.
							</p>
							{s.statusChangedAt && <p>Last change: {s.statusChangedAt}</p>}
							<p>
								{s.notifiedAt
									? `Decision email sent ${s.notifiedAt}.`
									: "No decision email has been sent yet."}
							</p>
						</Form>
					</Panel>

					{s.withdrawal && (
						<Panel>
							<div className="flex flex-col gap-2">
								<h2>Withdrawn</h2>
								<p>By {s.withdrawal.by}</p>
								<p>On {s.withdrawal.at}</p>
								<p>Reason: {s.withdrawal.reason || "—"}</p>
								<p>
									Set a new status above to undo the withdrawal, or decline it
									to keep the record final.
								</p>
							</div>
						</Panel>
					)}

					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input
								type="hidden"
								name="intent"
								value="set-content-status"
								readOnly
							/>
							<div className="flex items-center gap-2">
								<h2>Content approval</h2>
								<StatusBadge tone={CONTENT_STATUS_TONE[s.contentStatus]}>
									{s.contentStatus === "approved"
										? "approved — public"
										: s.contentStatus === "in_review"
											? "in review — not public yet"
											: "draft — not public yet"}
								</StatusBadge>
							</div>
							<Field label="Set content status">
								<Select
									key={s.contentStatus}
									name="contentStatus"
									defaultValue={s.contentStatus}
								>
									{CONTENT_STATUS_OPTIONS.map((cs) => (
										<option key={cs} value={cs}>
											{humanStatus(cs)}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit" variant="ghost">
								Update content status
							</Button>
							<p>
								Only approved content appears on public pages — acceptance alone
								does not publish a session.
							</p>
						</Form>
					</Panel>

					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input
								type="hidden"
								name="intent"
								value="set-custom-status"
								readOnly
							/>
							<Field label="Custom status (organizer-defined)">
								<Select
									key={s.customStatusId ?? "none"}
									name="customStatusId"
									defaultValue={s.customStatusId ?? ""}
								>
									<option value="">None</option>
									{library.customStatuses.map((cs) => (
										<option key={cs.id} value={cs.id}>
											{cs.name}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit" variant="ghost">
								Update custom status
							</Button>
							{library.customStatuses.length === 0 && (
								<p>
									No custom statuses defined for this event yet — they layer on
									top of the decision pipeline (e.g. &quot;Offered&quot;,
									&quot;Pending Contract&quot;).
								</p>
							)}
						</Form>
					</Panel>

					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input
								type="hidden"
								name="intent"
								value="save-taxonomy"
								readOnly
							/>
							<Field label="Format">
								<Select
									key={s.formatId ?? "none"}
									name="formatId"
									defaultValue={s.formatId ?? ""}
								>
									<option value="">None</option>
									{library.formats.map((f) => (
										<option key={f.id} value={f.id}>
											{f.name}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Level">
								<Select
									key={s.levelId ?? "none"}
									name="levelId"
									defaultValue={s.levelId ?? ""}
								>
									<option value="">None</option>
									{library.levels.map((l) => (
										<option key={l.id} value={l.id}>
											{l.name}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Language">
								<Select
									key={s.language}
									name="language"
									defaultValue={s.language}
								>
									{languageOptions.map((l) => (
										<option key={l} value={l}>
											{l}
										</option>
									))}
								</Select>
							</Field>
							<h2>Tracks</h2>
							<div className="flex flex-col gap-1">
								{library.tracks.map((t) => (
									<label key={t.id} className="flex items-center gap-2">
										<Input
											type="checkbox"
											name="trackIds"
											value={t.id}
											defaultChecked={s.trackIds.includes(t.id)}
										/>
										<Chip color={t.color}>{t.name}</Chip>
									</label>
								))}
								{library.tracks.length === 0 && (
									<p>No tracks defined for this event yet.</p>
								)}
							</div>
							<h2>Tags</h2>
							<div className="flex flex-col gap-1">
								{library.tags.map((t) => (
									<label key={t.id} className="flex items-center gap-2">
										<Input
											type="checkbox"
											name="tagIds"
											value={t.id}
											defaultChecked={s.tagIds.includes(t.id)}
										/>
										<Chip color={t.color}>{t.name}</Chip>
									</label>
								))}
								{library.tags.length === 0 && (
									<p>No tags defined for this event yet.</p>
								)}
							</div>
							<Button type="submit" variant="ghost">
								Save taxonomy
							</Button>
						</Form>
					</Panel>

					<Panel>
						<div className="flex flex-col gap-2">
							<h2>Schedule</h2>
							{s.schedule ? (
								<p>
									{s.schedule}
									{s.roomName ? ` · ${s.roomName}` : ""}
								</p>
							) : (
								<p>Not scheduled yet — place it from the Agenda.</p>
							)}
						</div>
					</Panel>

					<Panel>
						<div className="flex flex-col gap-3">
							<h2>Danger zone</h2>
							{!confirmingDelete ? (
								<div>
									<Button
										variant="ghost"
										onClick={() => setConfirmingDelete(true)}
									>
										Delete submission…
									</Button>
								</div>
							) : (
								<div className="flex flex-col gap-3">
									<ErrorText>
										This permanently deletes &quot;{s.title}&quot; with its
										answers, revisions, reviews and participant links. Uploaded
										files stay in the files library. This cannot be undone.
									</ErrorText>
									<Form method="post" className="flex gap-2">
										<Input
											type="hidden"
											name="intent"
											value="delete"
											readOnly
										/>
										<Button type="submit">Yes, delete it</Button>
										<Button
											type="button"
											variant="ghost"
											onClick={() => setConfirmingDelete(false)}
										>
											Cancel
										</Button>
									</Form>
								</div>
							)}
						</div>
					</Panel>
				</div>
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	// Generic copy only — raw errors can carry SQL/row values.
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4 px-7 py-6">
			<PageHeader
				title={notFound ? "Submission not found" : "Failed to load submission"}
				tone="danger"
				subtitle={
					notFound
						? "It may belong to another event, or it was deleted. Switch events or head back to the list."
						: "Something went wrong. Please refresh or try again."
				}
			/>
			<div>
				<TextLink to="/admin/submissions">Back to submissions</TextLink>
			</div>
		</div>
	);
}
