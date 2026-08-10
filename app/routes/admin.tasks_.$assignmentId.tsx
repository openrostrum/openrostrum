import { and, desc, eq } from "drizzle-orm";
import { Form, data, isRouteErrorResponse, useRouteError } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	contacts,
	files,
	portalForms,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatDateUTC, parseDueDate } from "~/lib/format";
import {
	isOverdue,
	TASK_STATUS_LABEL,
	TASK_STATUS_TONE,
} from "~/lib/task-status";
import { createTimings, track } from "~/lib/track";
import {
	type BadgeTone,
	Button,
	ButtonLink,
	EmptyRow,
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
import type { Route } from "./+types/admin.tasks_.$assignmentId";

const FILE_STATUS_TONE: Record<string, BadgeTone> = {
	pending: "info",
	approved: "success",
	denied: "danger",
	none: "neutral",
};

const DueForm = z.object({
	dueDate: z.union([
		z.literal(""),
		z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"),
	]),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * Resolves the assignment ONLY within the admin's active event (the task join
 * carries the event scope) — an id from another event 404s without leaking
 * whether it exists.
 */
async function findAssignment(
	db: ReturnType<typeof getDb>,
	eventId: string,
	assignmentId: string,
) {
	const [row] = await db
		.select({
			assignment: taskAssignments,
			task: tasks,
			portalForm: portalForms,
			contact: contacts,
			submission: submissions,
		})
		.from(taskAssignments)
		.innerJoin(
			tasks,
			and(eq(tasks.id, taskAssignments.taskId), eq(tasks.eventId, eventId)),
		)
		.leftJoin(portalForms, eq(portalForms.id, tasks.portalFormId))
		.leftJoin(contacts, eq(contacts.id, taskAssignments.contactId))
		.leftJoin(submissions, eq(submissions.id, taskAssignments.submissionId))
		.where(eq(taskAssignments.id, assignmentId))
		.limit(1);
	if (!row) throw new Response("Not found", { status: 404 });
	return row;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader (single-fetch
	// can run this loader alone via `?_routes=`).
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
	const db = getDb(env);
	const timings = createTimings();
	const { row, uploads } = await timings.time("db", async () => {
		const found = await findAssignment(db, event.id, params.assignmentId);
		const fileRows = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, found.assignment.id))
			.orderBy(desc(files.version));
		return { row: found, uploads: fileRows };
	});
	const overdue = isOverdue(
		row.assignment.dueAt,
		row.assignment.status,
		new Date(),
	);
	return data(
		{
			assignment: row.assignment,
			task: row.task,
			portalForm: row.portalForm,
			contact: row.contact,
			submission: row.submission,
			uploads,
			overdue,
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
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
	const db = getDb(env);
	const row = await findAssignment(db, event.id, params.assignmentId);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const now = new Date();

	try {
		if (intent === "set-due") {
			const parsed = DueForm.safeParse({ dueDate: form.get("dueDate") ?? "" });
			if (!parsed.success) {
				return {
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
				} satisfies ActionResult;
			}
			const dueAt = parsed.data.dueDate
				? parseDueDate(parsed.data.dueDate)
				: null;
			// Changing the due date re-arms the automated reminder: the cron only
			// skips assignments whose reminderSentAt stamp is set.
			await db
				.update(taskAssignments)
				.set({ dueAt, reminderSentAt: null })
				.where(eq(taskAssignments.id, row.assignment.id));
			track("task.due_changed", {
				eventId: event.id,
				assignmentId: row.assignment.id,
				dueAt: dueAt ? dueAt.toISOString() : null,
			});
			return {
				notice: dueAt
					? `Due date set to ${formatDateUTC(dueAt)} — the automated reminder is re-armed.`
					: "Due date cleared.",
			} satisfies ActionResult;
		}

		if (intent === "set-status") {
			const status = String(form.get("status") ?? "");
			if (status !== "complete" && status !== "incomplete") {
				return { formError: "Unknown status." } satisfies ActionResult;
			}
			await db
				.update(taskAssignments)
				.set({
					status,
					completedAt: status === "complete" ? now : null,
				})
				.where(eq(taskAssignments.id, row.assignment.id));
			track("task.status_overridden", {
				eventId: event.id,
				assignmentId: row.assignment.id,
				status,
			});
			return {
				notice:
					status === "complete"
						? "Marked complete on the speaker's behalf."
						: "Reopened — the speaker sees it as incomplete again.",
			} satisfies ActionResult;
		}

		if (intent === "approve-file" || intent === "deny-file") {
			const fileId = String(form.get("fileId") ?? "");
			const [file] = await db
				.select({ id: files.id })
				.from(files)
				.where(
					and(
						eq(files.id, fileId),
						// Ownership: the file must belong to THIS assignment.
						eq(files.taskAssignmentId, row.assignment.id),
					),
				)
				.limit(1);
			if (!file) {
				return {
					formError: "That upload no longer exists.",
				} satisfies ActionResult;
			}
			if (intent === "approve-file") {
				await db.batch([
					db
						.update(files)
						.set({ reviewStatus: "approved", reviewNote: null })
						.where(eq(files.id, file.id)),
					db
						.update(taskAssignments)
						.set({ status: "complete", completedAt: now })
						.where(eq(taskAssignments.id, row.assignment.id)),
				]);
				track("task.file_approved", {
					eventId: event.id,
					assignmentId: row.assignment.id,
					fileId: file.id,
				});
				return {
					notice: "Upload approved — the task is complete.",
				} satisfies ActionResult;
			}
			const note = String(form.get("reviewNote") ?? "").trim();
			await db.batch([
				db
					.update(files)
					.set({ reviewStatus: "denied", reviewNote: note || null })
					.where(eq(files.id, file.id)),
				db
					.update(taskAssignments)
					.set({ status: "incomplete", completedAt: null })
					.where(eq(taskAssignments.id, row.assignment.id)),
			]);
			track("task.file_denied", {
				eventId: event.id,
				assignmentId: row.assignment.id,
				fileId: file.id,
			});
			return {
				notice: "Upload denied — the speaker can submit a new version.",
			} satisfies ActionResult;
		}
	} catch (error) {
		track("task.assignment_action_failed", {
			eventId: event.id,
			assignmentId: row.assignment.id,
			intent,
			error: errorMessage(error),
		});
		return {
			formError: "Could not save that change — please try again.",
		} satisfies ActionResult;
	}

	return { formError: "Unknown action." } satisfies ActionResult;
}

function formatBytes(size: number | null): string {
	if (size == null) return "—";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function answerText(value: unknown): string {
	if (value == null || value === "") return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export default function TaskAssignmentDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		assignment,
		task,
		portalForm,
		contact,
		submission,
		uploads,
		overdue,
	} = loaderData;
	const schemaFields = portalForm?.schema ?? [];
	const response = (assignment.response ?? {}) as Record<string, unknown>;
	const extraAnswers = Object.entries(response).filter(
		([key]) => !schemaFields.some((f) => f.name === key),
	);
	const dueDefault = assignment.dueAt
		? assignment.dueAt.toISOString().slice(0, 10)
		: "";

	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={task.name}
				subtitle={
					contact
						? `${contact.firstName} ${contact.lastName} · ${contact.email}${submission ? ` · ${submission.title}` : ""}`
						: (submission?.title ?? "Unassigned contact")
				}
				actions={
					<ButtonLink to="/admin/tasks" variant="ghost">
						Back to tasks
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
						<Td kind="strong">Status</Td>
						<Td>
							<div className="flex flex-wrap items-center gap-3">
								<StatusBadge
									tone={TASK_STATUS_TONE[assignment.status] ?? "neutral"}
								>
									{TASK_STATUS_LABEL[assignment.status] ?? assignment.status}
								</StatusBadge>
								{overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
								<Form method="post">
									<Input type="hidden" name="intent" value="set-status" />
									<Input
										type="hidden"
										name="status"
										value={
											assignment.status === "complete"
												? "incomplete"
												: "complete"
										}
									/>
									<Button type="submit" variant="ghost">
										{assignment.status === "complete"
											? "Reopen"
											: "Mark complete on speaker's behalf"}
									</Button>
								</Form>
							</div>
						</Td>
					</Tr>
					<Tr>
						<Td kind="strong">Due</Td>
						<Td>
							<Form method="post" className="flex flex-wrap items-end gap-3">
								<Input type="hidden" name="intent" value="set-due" />
								<Field
									label="Due date"
									error={actionData?.fieldErrors?.dueDate?.[0]}
								>
									<Input type="date" name="dueDate" defaultValue={dueDefault} />
								</Field>
								<Button type="submit" variant="ghost">
									Save due date
								</Button>
							</Form>
						</Td>
					</Tr>
					<Tr>
						<Td kind="strong">Reminder</Td>
						<Td>
							{assignment.reminderSentAt
								? `Automated reminder sent ${formatDateUTC(assignment.reminderSentAt)} — editing the due date re-arms it`
								: "Not sent yet — goes out automatically as the due date approaches"}
						</Td>
					</Tr>
					<Tr>
						<Td kind="strong">Completed</Td>
						<Td kind="mono">
							{assignment.completedAt
								? formatDateUTC(assignment.completedAt)
								: "—"}
						</Td>
					</Tr>
					{task.description && (
						<Tr>
							<Td kind="strong">Description</Td>
							<Td>{task.description}</Td>
						</Tr>
					)}
				</TBody>
			</Table>

			{portalForm && (
				<Panel>
					<PageHeader
						title={`Response — ${portalForm.name}`}
						count={assignment.response ? "submitted" : "not submitted"}
					/>
					<div className="mt-3">
						<Table>
							<THead>
								<Th>Question</Th>
								<Th>Answer</Th>
							</THead>
							<TBody>
								{schemaFields.map((f) => (
									<Tr key={f.name}>
										<Td kind="strong">{f.name}</Td>
										<Td>{answerText(response[f.name])}</Td>
									</Tr>
								))}
								{extraAnswers.map(([key, value]) => (
									<Tr key={key}>
										<Td kind="strong">{key}</Td>
										<Td>{answerText(value)}</Td>
									</Tr>
								))}
								{schemaFields.length === 0 && extraAnswers.length === 0 && (
									<EmptyRow colSpan={2}>
										This form has no questions defined.
									</EmptyRow>
								)}
							</TBody>
						</Table>
					</div>
				</Panel>
			)}

			{(task.isFileRequest || uploads.length > 0) && (
				<Panel>
					<PageHeader
						title="Uploads"
						count={`${uploads.length} version${uploads.length === 1 ? "" : "s"}`}
					/>
					{uploads[0] && uploads[0].reviewStatus !== "approved" && (
						<div className="mt-3 flex flex-wrap items-end gap-3">
							<Form method="post">
								<Input type="hidden" name="intent" value="approve-file" />
								<Input type="hidden" name="fileId" value={uploads[0].id} />
								<Button type="submit">Approve v{uploads[0].version}</Button>
							</Form>
							<Form method="post" className="flex flex-wrap items-end gap-2">
								<Input type="hidden" name="intent" value="deny-file" />
								<Input type="hidden" name="fileId" value={uploads[0].id} />
								<Field label="Note (optional)">
									<Input
										name="reviewNote"
										placeholder="Why it needs a re-upload"
									/>
								</Field>
								<Button type="submit" variant="ghost">
									Deny v{uploads[0].version}
								</Button>
							</Form>
						</div>
					)}
					<div className="mt-3">
						<Table>
							<THead>
								<Th>Version</Th>
								<Th>File</Th>
								<Th>Size</Th>
								<Th>Uploaded</Th>
								<Th>Review</Th>
							</THead>
							<TBody>
								{uploads.map((f) => (
									<Tr key={f.id}>
										<Td kind="mono">v{f.version}</Td>
										<Td kind="strong">
											<TextLink to={`/files/${f.id}`}>{f.fileName}</TextLink>
										</Td>
										<Td kind="mono">{formatBytes(f.sizeBytes)}</Td>
										<Td kind="mono">{formatDateUTC(f.createdAt)}</Td>
										<Td>
											<div className="flex flex-wrap items-center gap-2">
												<StatusBadge
													tone={FILE_STATUS_TONE[f.reviewStatus] ?? "neutral"}
												>
													{f.reviewStatus}
												</StatusBadge>
												{f.reviewNote && <span>{f.reviewNote}</span>}
											</div>
										</Td>
									</Tr>
								))}
								{uploads.length === 0 && (
									<EmptyRow colSpan={5}>
										Nothing uploaded yet — the speaker uploads from their
										portal, and versions appear here for review.
									</EmptyRow>
								)}
							</TBody>
						</Table>
					</div>
				</Panel>
			)}

			{!portalForm &&
				!task.isFileRequest &&
				uploads.length === 0 &&
				!assignment.response && (
					<Panel>
						<PageHeader
							title="Completion"
							subtitle="This is a mark-as-done task — the speaker completes it from their portal, and its status updates here."
						/>
					</Panel>
				)}
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	if (isRouteErrorResponse(error) && error.status === 404) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col gap-4 px-7 py-6">
				<PageHeader
					title="Task assignment not found"
					tone="danger"
					subtitle="It may belong to another event, or it was removed."
				/>
				<div className="flex">
					<ButtonLink to="/admin/tasks" variant="ghost">
						Back to tasks
					</ButtonLink>
				</div>
			</div>
		);
	}
	// Generic message only — never render the raw error.
	return (
		<div className="mx-auto max-w-4xl px-7 py-6">
			<PageHeader
				title="Failed to load this task assignment"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
