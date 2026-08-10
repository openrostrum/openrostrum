import { and, asc, eq, inArray } from "drizzle-orm";
import {
	Form,
	data,
	isRouteErrorResponse,
	redirect,
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
	FILE_REVIEW_LABEL,
	FILE_REVIEW_TONE,
	getFileChain,
	setFileReview,
} from "~/domain/files";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatBytes, formatDateUTC } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
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
	if (!chain) throw data(null, { status: 404 });
	return { event, db, ...chain };
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const timings = createTimings();
	const { event, db, file, versions } = await timings.time("db", () =>
		loadChain(env, user, params.id),
	);
	const latest = versions[0] ?? file;

	const [submission] = latest.submissionId
		? await db
				.select({ id: submissions.id, title: submissions.title })
				.from(submissions)
				.where(eq(submissions.id, latest.submissionId))
				.limit(1)
		: [];
	const [contact] = latest.contactId
		? await db
				.select({
					id: contacts.id,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					email: contacts.email,
				})
				.from(contacts)
				.where(eq(contacts.id, latest.contactId))
				.limit(1)
		: [];
	const [assignment] = latest.taskAssignmentId
		? await db
				.select({ id: taskAssignments.id, taskName: tasks.name })
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.where(eq(taskAssignments.id, latest.taskAssignmentId))
				.limit(1)
		: [];

	// One thread per deliverable: comments across ALL versions, oldest first,
	// tagged with the version they were made on.
	const versionById = new Map(versions.map((v) => [v.id, v.version]));
	const comments =
		versions.length > 0
			? await db
					.select()
					.from(fileComments)
					.where(
						inArray(
							fileComments.fileId,
							versions.map((v) => v.id),
						),
					)
					.orderBy(asc(fileComments.createdAt), asc(fileComments.id))
			: [];

	return data(
		{
			latest,
			versions,
			submission: submission ?? null,
			contact: contact ?? null,
			assignment: assignment ?? null,
			comments: comments.map((c) => ({
				id: c.id,
				author: c.authorName,
				body: c.body,
				on: formatDateUTC(c.createdAt),
				version: versionById.get(c.fileId) ?? null,
			})),
			eventName: event.name,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	notice?: string;
};

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const { event, db, versions } = await loadChain(env, user, params.id);
	const latest = versions[0];
	if (!latest) throw data(null, { status: 404 });
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const timings = createTimings();
	const withTimings = (result: ActionResult) =>
		data(result, { headers: { "Server-Timing": timings.header() } });

	try {
		if (intent === "approve" || intent === "deny") {
			// Decisions always target the LATEST version — the one under review.
			if (intent === "approve") {
				await timings.time("db", () => setFileReview(db, latest, "approved"));
				track("file.approved", {
					eventId: event.id,
					fileId: latest.id,
					assignmentId: latest.taskAssignmentId,
				});
				return withTimings({
					notice: latest.taskAssignmentId
						? "Upload approved — the speaker's task is complete."
						: "Upload approved.",
				});
			}
			const note = String(form.get("reviewNote") ?? "").trim();
			await timings.time("db", () => setFileReview(db, latest, "denied", note));
			track("file.denied", {
				eventId: event.id,
				fileId: latest.id,
				assignmentId: latest.taskAssignmentId,
			});
			return withTimings({
				notice: latest.taskAssignmentId
					? "Changes requested — the task reopened, and the speaker can upload a new version."
					: "Changes requested on this upload.",
			});
		}

		if (intent === "comment") {
			const body = String(form.get("body") ?? "").trim();
			if (!body || body.length > 2000) {
				return withTimings({
					fieldErrors: { body: ["Write a comment up to 2,000 characters."] },
				});
			}
			await timings.time("db", () =>
				db.insert(fileComments).values({
					fileId: latest.id,
					authorId: user.id,
					authorName: user.name ?? user.email,
					body,
				}),
			);
			track("file.comment_added", { eventId: event.id, fileId: latest.id });
			return redirect(`/admin/files/${params.id}`, {
				headers: { "Server-Timing": timings.header() },
			});
		}

		if (intent === "share" || intent === "unshare") {
			await timings.time("db", () =>
				db
					.update(files)
					.set({ sharedToPortal: intent === "share" })
					.where(and(eq(files.id, latest.id), eq(files.eventId, event.id))),
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
			formError: "Could not save that change — please try again.",
		});
	}

	return withTimings({ formError: "Unknown action." });
}

export default function FileDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { latest, versions, submission, contact, assignment, comments } =
		loaderData;
	const inReviewLoop = latest.taskAssignmentId !== null;
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
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}

			<Table>
				<TBody>
					<Tr>
						<Td kind="strong">Review</Td>
						<Td>
							<div className="flex flex-wrap items-center gap-3">
								<StatusBadge
									tone={FILE_REVIEW_TONE[latest.reviewStatus] ?? "neutral"}
								>
									{FILE_REVIEW_LABEL[latest.reviewStatus] ??
										latest.reviewStatus}
								</StatusBadge>
								{latest.reviewNote && <span>{latest.reviewNote}</span>}
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
									value={latest.sharedToPortal ? "unshare" : "share"}
								/>
								<span>
									{latest.sharedToPortal
										? "Speakers can download this file from their portal."
										: "Not visible in the speaker portal."}
								</span>
								<Button type="submit" variant="ghost">
									{latest.sharedToPortal
										? "Stop sharing"
										: "Share with speakers"}
								</Button>
							</Form>
						</Td>
					</Tr>
				</TBody>
			</Table>

			{(inReviewLoop || latest.reviewStatus !== "none") && (
				<Panel>
					<PageHeader
						title="Review this upload"
						subtitle={
							inReviewLoop
								? "Approving completes the speaker's task; requesting changes reopens it so they can upload a new version. No email is sent either way — the speaker sees the outcome in their portal."
								: "Record a review outcome on this upload."
						}
					/>
					<div className="mt-3 flex flex-wrap items-end gap-3">
						{latest.reviewStatus !== "approved" && (
							<Form method="post">
								<Input type="hidden" name="intent" value="approve" />
								<Button type="submit">Approve v{latest.version}</Button>
							</Form>
						)}
						<Form method="post" className="flex flex-wrap items-end gap-2">
							<Input type="hidden" name="intent" value="deny" />
							<Field label="Note to the speaker (optional)">
								<Input
									name="reviewNote"
									placeholder="Why it needs a re-upload"
								/>
							</Field>
							<Button type="submit" variant="ghost">
								Request changes on v{latest.version}
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
								<Tr key={v.id} selected={i === 0}>
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
									<Td kind="mono">{formatDateUTC(v.createdAt)}</Td>
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
							<div className="flex items-center gap-2">
								<span>
									<strong>{c.author}</strong>
								</span>
								<span>
									{c.on}
									{c.version ? ` · on v${c.version}` : ""}
								</span>
							</div>
							<p>{c.body}</p>
						</div>
					))}
					{comments.length === 0 && (
						<p>No comments yet — start the thread below.</p>
					)}
					<Form method="post" className="flex flex-wrap items-end gap-3">
						<Input type="hidden" name="intent" value="comment" />
						<Field
							label="Reply to the speaker"
							error={actionData?.fieldErrors?.body?.[0]}
						>
							<Input
								name="body"
								placeholder="Write a comment…"
								maxLength={2000}
							/>
						</Field>
						<Button type="submit">Post comment</Button>
					</Form>
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
