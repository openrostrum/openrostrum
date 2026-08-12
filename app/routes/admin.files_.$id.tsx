import { and, eq, inArray } from "drizzle-orm";
import { useState } from "react";
import {
	Form,
	data,
	isRouteErrorResponse,
	useFetcher,
	useRouteError,
} from "react-router";
import { getDb } from "~/db";
import {
	contacts,
	fileComments,
	files,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import {
	addFileComment,
	FILE_REVIEW_LABEL,
	FILE_REVIEW_TONE,
	getFileChain,
	REVIEW_NOTE_MAX,
	setFileReview,
} from "~/domain/files";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { resolveCommentDraft } from "~/lib/comment-draft";
import { errorMessage } from "~/lib/errors";
import { resolveTimezone } from "~/lib/event-time";
import { formatInTimeZone } from "~/lib/dates";
import { formatBytes } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	StatusBadge,
	Table,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.files_.$id";

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

type AdminUser = Awaited<ReturnType<typeof requireAdmin>>;

/** The chain + its context, scoped to the ACTIVE event — a foreign id 404s. */
async function loadChain(env: Env, user: AdminUser, fileId: string) {
	const event = await getActiveEvent(env, user);
	if (!event) throw data(null, { status: 404 });
	const db = getDb(env);
	const chain = await getFileChain(db, event.id, fileId);
	const latest = chain?.versions[0];
	if (!chain || !latest) throw data(null, { status: 404 });
	const reviewFile = chain.versions.find(
		(version) =>
			version.taskAssignmentId !== null && version.reviewStatus !== "none",
	);
	return {
		event,
		db,
		versions: chain.versions,
		members: chain.members,
		canonicalTaskAssignmentId: chain.canonicalTaskAssignmentId,
		canonicalSharedToPortal: chain.canonicalSharedToPortal,
		reviewFile: reviewFile ?? null,
		latest,
	};
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const timings = createTimings();
	const {
		event,
		db,
		versions,
		members,
		canonicalTaskAssignmentId,
		canonicalSharedToPortal,
		reviewFile,
		latest,
	} = await timings.time("db", () => loadChain(env, user, params.id));
	const timezone = resolveTimezone(event.timezone);

	const [submission] = latest.submissionId
		? await db
				.select({ id: submissions.id, title: submissions.title })
				.from(submissions)
				.where(eq(submissions.id, latest.submissionId))
				.limit(1)
		: [];
	const [assignment] = canonicalTaskAssignmentId
		? await db
				.select({
					id: taskAssignments.id,
					contactId: taskAssignments.contactId,
					taskName: tasks.name,
				})
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.where(eq(taskAssignments.id, canonicalTaskAssignmentId))
				.limit(1)
		: [];
	const contactId = latest.contactId ?? assignment?.contactId ?? null;
	const [contact] = contactId
		? await db
				.select({
					id: contacts.id,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					email: contacts.email,
				})
				.from(contacts)
				.where(eq(contacts.id, contactId))
				.limit(1)
		: [];

	// One thread per deliverable: comments across ALL versions, oldest first,
	// tagged with the version they were made on.
	const versionById = new Map(
		members.map((member) => [member.id, member.version]),
	);
	const comments: Array<typeof fileComments.$inferSelect> = [];
	for (let index = 0; index < members.length; index += 80) {
		comments.push(
			...(await db
				.select()
				.from(fileComments)
				.where(
					inArray(
						fileComments.fileId,
						members.slice(index, index + 80).map((member) => member.id),
					),
				)),
		);
	}
	comments.sort(
		(a, b) =>
			a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
	);

	return data(
		{
			commentKey: crypto.randomUUID(),
			latest,
			reviewFile: reviewFile
				? {
						id: reviewFile.id,
						version: reviewFile.version,
						reviewStatus: reviewFile.reviewStatus,
						reviewNote: reviewFile.reviewNote,
					}
				: null,
			canonicalSharedToPortal,
			versions: versions.map((v) => ({
				id: v.id,
				version: v.version,
				fileName: v.fileName,
				sizeBytes: v.sizeBytes,
				uploadedOn: formatInTimeZone(v.createdAt, timezone, "datetime-zone"),
				reviewStatus: v.reviewStatus,
			})),
			submission: submission ?? null,
			contact: contact ?? null,
			assignment: assignment
				? { id: assignment.id, taskName: assignment.taskName }
				: null,
			comments: comments.map((c) => ({
				id: c.id,
				author: c.authorName,
				body: c.body,
				on: formatInTimeZone(c.createdAt, timezone, "datetime-zone"),
				version: versionById.get(c.fileId) ?? null,
			})),
			eventName: event.name,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	intent?: string;
	ok?: boolean;
	commentKey?: string;
	commentFileId?: string;
	commentBody?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	notice?: string;
};

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const { event, db, latest, versions, members, reviewFile } = await loadChain(
		env,
		user,
		params.id,
	);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const submittedCommentKey = String(form.get("commentKey") ?? "");
	const submittedCommentBody = String(form.get("body") ?? "").trim();
	const timings = createTimings();
	const withTimings = (result: ActionResult) =>
		data(result, { headers: { "Server-Timing": timings.header() } });
	const commentFile =
		intent === "comment"
			? versions.find(
					(version) => version.id === String(form.get("fileId") ?? ""),
				)
			: null;
	if (intent === "comment" && !commentFile) throw data(null, { status: 404 });

	try {
		if (intent === "approve" || intent === "deny") {
			// Decisions target the current task-owned version.
			const assignmentId = reviewFile?.taskAssignmentId;
			if (!reviewFile || !assignmentId) {
				return withTimings({
					formError: "This upload isn't part of a review loop.",
				});
			}
			const reviewed = { id: reviewFile.id, taskAssignmentId: assignmentId };
			if (intent === "approve") {
				await timings.time("db", () => setFileReview(db, reviewed, "approved"));
				track("file.approved", {
					eventId: event.id,
					fileId: latest.id,
					assignmentId,
				});
				return withTimings({
					notice: "Upload approved — the speaker's task is complete.",
				});
			}
			const note = String(form.get("reviewNote") ?? "").trim();
			if (note.length > REVIEW_NOTE_MAX) {
				return withTimings({
					fieldErrors: {
						reviewNote: ["Keep the note under 2,000 characters."],
					},
				});
			}
			await timings.time("db", () =>
				setFileReview(db, reviewed, "denied", note),
			);
			track("file.denied", {
				eventId: event.id,
				fileId: latest.id,
				assignmentId,
			});
			return withTimings({
				notice:
					"Changes requested — the task reopened, and the speaker can upload a new version.",
			});
		}

		if (intent === "comment") {
			if (!commentFile) throw data(null, { status: 404 });
			const body = submittedCommentBody;
			if (!body || body.length > REVIEW_NOTE_MAX) {
				return withTimings({
					intent,
					commentKey: submittedCommentKey,
					commentFileId: commentFile.id,
					commentBody: body,
					fieldErrors: { body: ["Write a comment up to 2,000 characters."] },
				});
			}
			const { deduped } = await timings.time("db", () =>
				addFileComment(db, {
					key: submittedCommentKey,
					fileId: commentFile.id,
					authorId: user.id,
					authorName: user.name ?? user.email,
					body,
				}),
			);
			track("file.comment_added", {
				eventId: event.id,
				fileId: commentFile.id,
				deduped,
			});
			return withTimings({
				intent,
				ok: true,
				commentKey: crypto.randomUUID(),
				commentFileId: latest.id,
			});
		}

		if (intent === "share" || intent === "unshare") {
			const clear = (ids: string[]) =>
				db
					.update(files)
					.set({ sharedToPortal: false })
					.where(and(eq(files.eventId, event.id), inArray(files.id, ids)));
			const firstClear = clear(members.slice(0, 80).map((member) => member.id));
			const remainingClears: ReturnType<typeof clear>[] = [];
			for (let index = 80; index < members.length; index += 80) {
				remainingClears.push(
					clear(members.slice(index, index + 80).map((member) => member.id)),
				);
			}
			await timings.time("db", () =>
				intent === "share"
					? db.batch([
							firstClear,
							...remainingClears,
							db
								.update(files)
								.set({ sharedToPortal: true })
								.where(
									and(eq(files.id, latest.id), eq(files.eventId, event.id)),
								),
						])
					: db.batch([firstClear, ...remainingClears]),
			);
			track("file.share_toggled", {
				eventId: event.id,
				fileId: latest.id,
				shared: intent === "share",
			});
			return withTimings({
				notice:
					intent === "share"
						? "Shared — speakers can now download this file from their portal."
						: "No longer shared to the portal.",
			});
		}
	} catch (error) {
		track("file.action_failed", {
			eventId: event.id,
			fileId: latest.id,
			intent,
			error: errorMessage(error),
		});
		return withTimings({
			intent,
			commentKey: intent === "comment" ? submittedCommentKey : undefined,
			commentFileId: commentFile?.id,
			commentBody: intent === "comment" ? submittedCommentBody : undefined,
			formError: "Could not save that change — please try again.",
		});
	}

	return withTimings({ formError: "Unknown action." });
}

function CommentForm({
	fileId,
	initialCommentKey,
	actionData,
}: {
	fileId: string;
	initialCommentKey: string;
	actionData: ActionResult | undefined;
}) {
	const busy = useBusy();
	const fetcher = useFetcher<ActionResult>();
	const posting = fetcher.state !== "idle";
	const [draft, setDraft] = useState({
		key: initialCommentKey,
		fileId,
		body: "",
	});
	const routeResult = actionData?.intent === "comment" ? actionData : undefined;
	const result = fetcher.data ?? routeResult;
	const activeDraft = resolveCommentDraft(draft, result, fileId);
	return (
		<fetcher.Form
			key={activeDraft.key}
			method="post"
			className="flex flex-wrap items-end gap-3"
		>
			<Input type="hidden" name="intent" value="comment" />
			<Input type="hidden" name="fileId" value={activeDraft.fileId} />
			<Input type="hidden" name="commentKey" value={activeDraft.key} />
			<Field
				label="Reply to the speaker"
				error={result?.fieldErrors?.body?.[0]}
			>
				<Input
					name="body"
					value={activeDraft.body}
					onChange={(event) =>
						setDraft({ ...activeDraft, body: event.currentTarget.value })
					}
					placeholder="Write a comment…"
					maxLength={REVIEW_NOTE_MAX}
				/>
			</Field>
			<Button type="submit" disabled={busy}>
				{posting ? "Posting…" : "Post comment"}
			</Button>
			{result?.formError && <ErrorText>{result.formError}</ErrorText>}
		</fetcher.Form>
	);
}

export default function FileDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		latest,
		reviewFile,
		canonicalSharedToPortal,
		versions,
		submission,
		contact,
		assignment,
		comments,
		commentKey,
	} = loaderData;
	const busy = useBusy();
	const displayedReview = reviewFile ?? latest;
	const inReviewLoop = reviewFile !== null;
	const speakerName = contact
		? `${contact.firstName} ${contact.lastName}`
		: null;

	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={latest.fileName}
				count={`v${latest.version} latest`}
				subtitle={
					<span>
						{submission ? `Session: ${submission.title}` : "No session"}
						{speakerName ? ` · ${speakerName}` : ""}
						{contact ? ` (${contact.email})` : ""}
					</span>
				}
				actions={
					<ButtonLink to="/admin/files" variant="ghost">
						Back to files
					</ButtonLink>
				}
			/>

			{actionData?.notice && (
				<div className="flex">
					<StatusBadge tone="success">{actionData.notice}</StatusBadge>
				</div>
			)}
			{actionData?.intent !== "comment" && actionData?.formError && (
				<ErrorText>{actionData.formError}</ErrorText>
			)}

			<Table>
				<TBody>
					<Tr>
						<Td kind="strong">Review</Td>
						<Td>
							<div className="flex flex-wrap items-center gap-3">
								<StatusBadge
									tone={
										FILE_REVIEW_TONE[displayedReview.reviewStatus] ?? "neutral"
									}
								>
									{FILE_REVIEW_LABEL[displayedReview.reviewStatus] ??
										displayedReview.reviewStatus}
								</StatusBadge>
								{displayedReview.reviewNote && (
									<span>{displayedReview.reviewNote}</span>
								)}
							</div>
						</Td>
					</Tr>
					{assignment && (
						<Tr>
							<Td kind="strong">Task</Td>
							<Td>
								<TextLink to={`/admin/tasks/${assignment.id}`}>
									{assignment.taskName}
								</TextLink>
							</Td>
						</Tr>
					)}
					<Tr>
						<Td kind="strong">Portal downloads</Td>
						<Td>
							<Form method="post" className="flex items-center gap-3">
								<Input
									type="hidden"
									name="intent"
									value={canonicalSharedToPortal ? "unshare" : "share"}
								/>
								<span>
									{canonicalSharedToPortal
										? "Speakers can download this file from their portal."
										: "Not visible in the speaker portal."}
								</span>
								<Button type="submit" variant="ghost" disabled={busy}>
									{canonicalSharedToPortal
										? "Stop sharing"
										: "Share with speakers"}
								</Button>
							</Form>
						</Td>
					</Tr>
				</TBody>
			</Table>

			{inReviewLoop && (
				<Panel>
					<PageHeader
						title="Review this upload"
						subtitle="Approving completes the speaker's task; requesting changes reopens it so they can upload a new version. No email is sent either way — the speaker sees the outcome in their portal."
					/>
					<div className="mt-3 flex flex-wrap items-end gap-3">
						{displayedReview.reviewStatus !== "approved" && (
							<Form method="post">
								<Input type="hidden" name="intent" value="approve" />
								<Button type="submit" disabled={busy}>
									Approve v{displayedReview.version}
								</Button>
							</Form>
						)}
						<Form method="post" className="flex flex-wrap items-end gap-2">
							<Input type="hidden" name="intent" value="deny" />
							<Field
								label="Note to the speaker (optional)"
								error={actionData?.fieldErrors?.reviewNote?.[0]}
							>
								<Input
									name="reviewNote"
									placeholder="Why it needs a re-upload"
									maxLength={2000}
								/>
							</Field>
							<Button type="submit" variant="ghost" disabled={busy}>
								Request changes on v{displayedReview.version}
							</Button>
						</Form>
					</div>
				</Panel>
			)}

			<Panel>
				<PageHeader
					title="Version history"
					count={`${versions.length} version${versions.length === 1 ? "" : "s"}`}
					subtitle="Every upload is kept — older versions stay individually downloadable."
				/>
				<div className="mt-3">
					<Table>
						<THead>
							<Th>Version</Th>
							<Th>File</Th>
							<Th>Size</Th>
							<Th>Uploaded</Th>
							<Th>Review</Th>
							<Th> </Th>
						</THead>
						<TBody>
							{versions.map((v, i) => (
								<Tr key={v.id}>
									<Td kind="mono">
										<div className="flex items-center gap-2">
											v{v.version}
											{i === 0 && (
												<StatusBadge tone="success">Latest</StatusBadge>
											)}
										</div>
									</Td>
									<Td kind="strong">{v.fileName}</Td>
									<Td kind="mono">{formatBytes(v.sizeBytes)}</Td>
									<Td kind="mono">{v.uploadedOn}</Td>
									<Td>
										<StatusBadge
											tone={FILE_REVIEW_TONE[v.reviewStatus] ?? "neutral"}
										>
											{FILE_REVIEW_LABEL[v.reviewStatus] ?? v.reviewStatus}
										</StatusBadge>
									</Td>
									<Td>
										<TextLink to={`/files/${v.id}`}>Download</TextLink>
									</Td>
								</Tr>
							))}
						</TBody>
					</Table>
				</div>
			</Panel>

			<Panel>
				<PageHeader
					title="Comments"
					count={`${comments.length}`}
					subtitle="Shared with the speaker — they see this thread on the file in their portal. Comments send no notifications."
				/>
				<div className="mt-3 flex flex-col gap-3">
					{comments.map((c) => (
						<div key={c.id} className="flex flex-col gap-1">
							<span>
								{c.author} · {c.on}
								{c.version ? ` · on v${c.version}` : ""}
							</span>
							<p>{c.body}</p>
						</div>
					))}
					{comments.length === 0 && (
						<EmptyState
							icon="mail"
							title="No comments yet"
							body="Start the thread below — the speaker sees replies on this file in their portal."
						/>
					)}
					<CommentForm
						fileId={latest.id}
						initialCommentKey={commentKey}
						actionData={actionData ?? undefined}
					/>
				</div>
			</Panel>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	if (isRouteErrorResponse(error) && error.status === 404) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col gap-4 px-7 py-6">
				<PageHeader
					title="File not found"
					tone="danger"
					subtitle="It may belong to another event, or it was removed."
				/>
				<div className="flex">
					<ButtonLink to="/admin/files" variant="ghost">
						Back to files
					</ButtonLink>
				</div>
			</div>
		);
	}
	return (
		<div className="mx-auto max-w-4xl px-7 py-6">
			<PageHeader
				title="Failed to load this file"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
