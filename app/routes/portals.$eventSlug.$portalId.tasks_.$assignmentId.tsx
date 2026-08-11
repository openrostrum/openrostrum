import { and, desc, eq, inArray } from "drizzle-orm";
import { data, redirect } from "react-router";
import {
	type TaskDetailActionData,
	TaskDetailView,
} from "~/components/portal/task-detail-view";
import { getDb } from "~/db";
import {
	fileComments,
	files,
	portalForms,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import {
	addFileComment,
	checkUpload,
	insertTaskUpload,
	UPLOAD_CONSTRAINTS,
} from "~/domain/files";
import {
	FILE_REVIEW_PROJECTION,
	getPortalContext,
	type PortalContext,
	type PortalStatus,
	portalPath,
	TASK_STATUS_PROJECTION,
} from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { resolveTimezone } from "~/lib/event-time";
import { formatBytes, formatDateUTC, formatInTz } from "~/lib/format";
import { isOverdue } from "~/lib/task-status";
import { getEmailSender } from "~/ports/email";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.tasks_.$assignmentId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** My assignment or 404 — ownership is the contact chain, never a param. */
async function requireMyAssignment(
	env: Env,
	ctx: PortalContext,
	assignmentId: string,
) {
	if (!ctx.contact) throw data(null, { status: 404 });
	const db = getDb(env);
	const [row] = await db
		.select({ assignment: taskAssignments, task: tasks })
		.from(taskAssignments)
		.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
		.where(
			and(
				eq(taskAssignments.id, assignmentId),
				eq(taskAssignments.contactId, ctx.contact.id),
				eq(tasks.eventId, ctx.event.id),
			),
		)
		.limit(1);
	if (!row) throw data(null, { status: 404 });
	return row;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const timings = createTimings();
	const { assignment, task } = await timings.time("db", () =>
		requireMyAssignment(env, ctx, params.assignmentId),
	);
	const db = getDb(env);
	const tz = resolveTimezone(ctx.event.timezone);
	const now = new Date();

	const kind: "file" | "form" | "simple" = task.isFileRequest
		? "file"
		: task.portalFormId
			? "form"
			: "simple";

	let form: null | {
		title: string;
		schema: Array<{
			name: string;
			type: string;
			required: boolean;
			options?: string[];
		}>;
		submitted: boolean;
		answers: Record<string, unknown>;
	} = null;
	if (kind === "form" && task.portalFormId) {
		const [pf] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.id, task.portalFormId))
			.limit(1);
		if (pf) {
			form = {
				title: pf.title || pf.name,
				schema: pf.schema ?? [],
				submitted: assignment.response !== null,
				answers: assignment.response ?? {},
			};
		}
	}

	let fileRequest: null | {
		canUpload: boolean;
		files: Array<{
			id: string;
			commentKey: string;
			version: number;
			fileName: string;
			size: string;
			uploadedOn: string;
			review: PortalStatus;
			reviewNote: string | null;
			latest: boolean;
			comments: Array<{
				id: string;
				author: string;
				isYou: boolean;
				body: string;
				on: string;
			}>;
		}>;
	} = null;
	if (kind === "file") {
		const uploads = await db
			.select()
			.from(files)
			.where(eq(files.taskAssignmentId, assignment.id))
			.orderBy(desc(files.version));
		const commentsByFile = new Map<
			string,
			(typeof fileComments.$inferSelect)[]
		>();
		if (uploads.length > 0) {
			const allComments = await db
				.select()
				.from(fileComments)
				.where(
					inArray(
						fileComments.fileId,
						uploads.map((u) => u.id),
					),
				);
			for (const c of allComments) {
				const list = commentsByFile.get(c.fileId) ?? [];
				list.push(c);
				commentsByFile.set(c.fileId, list);
			}
		}
		fileRequest = {
			canUpload: assignment.status !== "complete",
			files: uploads.map((f, i) => ({
				id: f.id,
				commentKey: crypto.randomUUID(),
				version: f.version,
				fileName: f.fileName,
				size: formatBytes(f.sizeBytes),
				uploadedOn: formatInTz(f.createdAt, tz),
				review: FILE_REVIEW_PROJECTION[f.reviewStatus],
				reviewNote: f.reviewStatus === "denied" ? f.reviewNote : null,
				latest: i === 0,
				comments: (commentsByFile.get(f.id) ?? [])
					.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
					.map((c) => ({
						id: c.id,
						author: c.authorName,
						isYou: c.authorId === user.id,
						body: c.body,
						on: formatInTz(c.createdAt, tz),
					})),
			})),
		};
	}

	let submissionTitle: string | null = null;
	if (assignment.submissionId) {
		const [sub] = await db
			.select({ title: submissions.title })
			.from(submissions)
			.where(eq(submissions.id, assignment.submissionId))
			.limit(1);
		submissionTitle = sub?.title ?? null;
	}

	return data(
		{
			base: portalPath(ctx),
			id: assignment.id,
			name: task.name,
			description: task.description,
			linkUrl: task.linkUrl,
			required: task.required,
			due: assignment.dueAt ? formatDateUTC(assignment.dueAt) : null,
			overdue: isOverdue(assignment.dueAt, assignment.status, now),
			status: TASK_STATUS_PROJECTION[assignment.status],
			isComplete: assignment.status === "complete",
			completedOn: assignment.completedAt
				? formatInTz(assignment.completedAt, tz, "date")
				: null,
			submissionTitle,
			saved: new URL(request.url).searchParams.get("saved"),
			kind,
			uploadConstraints: UPLOAD_CONSTRAINTS,
			form,
			fileRequest,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const { assignment, task } = await requireMyAssignment(
		env,
		ctx,
		params.assignmentId,
	);
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const fail = (body: Omit<TaskDetailActionData, "intent">) => ({
		intent,
		...body,
	});
	const here = portalPath(ctx, `/tasks/${assignment.id}`);
	const timings = createTimings();
	const isSimple = !task.isFileRequest && !task.portalFormId;

	if (intent === "complete" || intent === "uncomplete") {
		if (!isSimple) {
			return fail({
				formError:
					task.portalFormId !== null
						? "Complete this task by submitting its form."
						: "Complete this task by uploading the requested file.",
			});
		}
		try {
			await timings.time("db", () =>
				db
					.update(taskAssignments)
					.set(
						intent === "complete"
							? { status: "complete", completedAt: new Date() }
							: { status: "incomplete", completedAt: null },
					)
					.where(eq(taskAssignments.id, assignment.id)),
			);
		} catch (error) {
			track("portal.task_status_change_failed", {
				eventId: ctx.event.id,
				assignmentId: assignment.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not update the task — please try again.",
			});
		}
		track("portal.task_status_changed", {
			eventId: ctx.event.id,
			assignmentId: assignment.id,
			status: intent === "complete" ? "complete" : "incomplete",
		});
		const headers = { "Server-Timing": timings.header() };
		return intent === "complete"
			? redirect(`${here}?saved=completed`, { headers })
			: redirect(here, { headers });
	}

	if (intent === "submit-form") {
		if (!task.portalFormId)
			return fail({ formError: "This task has no form." });
		if (assignment.response !== null) {
			return fail({
				formError:
					"This form was already submitted — contact the event team to change your answers.",
			});
		}
		const [pf] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.id, task.portalFormId))
			.limit(1);
		if (!pf) return fail({ formError: "This task has no form." });
		const schema = pf.schema ?? [];
		const answers: Record<string, unknown> = {};
		const fieldErrors: Record<string, string[]> = {};
		for (const field of schema) {
			const value = String(form.get(`answer:${field.name}`) ?? "").trim();
			if (field.required && !value) {
				fieldErrors[field.name] = ["This field is required."];
				continue;
			}
			if (
				field.type === "dropdown" &&
				value &&
				!(field.options ?? []).includes(value)
			) {
				fieldErrors[field.name] = ["Pick one of the listed options."];
				continue;
			}
			if (value) answers[field.name] = value;
		}
		// Validation failures persist NOTHING — the row is untouched.
		if (Object.keys(fieldErrors).length > 0) return fail({ fieldErrors });

		try {
			await timings.time("db", () =>
				db
					.update(taskAssignments)
					.set({
						status: "complete",
						completedAt: new Date(),
						response: answers,
					})
					.where(eq(taskAssignments.id, assignment.id)),
			);
		} catch (error) {
			track("portal.task_form_submit_failed", {
				eventId: ctx.event.id,
				assignmentId: assignment.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not submit the form — please try again.",
			});
		}
		if (pf.sendConfirmationEmail && ctx.contact) {
			// The form is saved either way — a failed email must not read as a
			// failed submission; it only loses the courtesy copy.
			try {
				await getEmailSender(env).send({
					to: ctx.contact.email,
					subject: `We received “${task.name}”`,
					html:
						pf.confirmationHtml ??
						`<p>Thanks — your “${task.name}” form was received by the event team.</p>`,
					dedupeKey: `portal_form:${assignment.id}`,
					eventId: ctx.event.id,
				});
			} catch (error) {
				track("email.send_failed", {
					eventId: ctx.event.id,
					assignmentId: assignment.id,
					error: errorMessage(error),
				});
			}
		}
		track("portal.task_form_submitted", {
			eventId: ctx.event.id,
			assignmentId: assignment.id,
			formId: pf.id,
		});
		return redirect(`${here}?saved=submitted`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "upload") {
		if (!task.isFileRequest)
			return fail({ formError: "This task doesn't take a file." });
		if (assignment.status === "complete") {
			return fail({
				formError:
					"This request is complete — the event team approved your file.",
			});
		}
		const file = form.get("file");
		if (!(file instanceof File) || file.size === 0) {
			return fail({ fieldErrors: { file: ["Choose a file first."] } });
		}
		// Server-side enforcement of the stated constraints — accept= is a hint.
		const check = checkUpload(file);
		if (!check.ok) {
			return fail({ fieldErrors: { file: [check.error] } });
		}
		const r2Key = `task-files/${ctx.event.id}/${assignment.id}/${crypto.randomUUID()}`;
		let version: number;
		try {
			const bytes = await file.arrayBuffer();
			await timings.time("r2", () =>
				env.BLOBS.put(r2Key, bytes, {
					httpMetadata: {
						contentType: file.type || "application/octet-stream",
					},
				}),
			);
			// Lands in the review queue (not "complete") and reopens as
			// pending_feedback — the organizer approves or denies from admin.
			const inserted = await timings.time("db", () =>
				insertTaskUpload(db, {
					eventId: ctx.event.id,
					contactId: ctx.contact?.id ?? null,
					submissionId: assignment.submissionId,
					taskAssignmentId: assignment.id,
					r2Key,
					fileName: file.name,
					kind: check.kind,
					contentType: file.type || "application/octet-stream",
					sizeBytes: file.size,
				}),
			);
			version = inserted.version;
		} catch (error) {
			track("portal.file_upload_failed", {
				eventId: ctx.event.id,
				assignmentId: assignment.id,
				error: errorMessage(error),
			});
			return fail({
				fieldErrors: { file: ["The upload failed — please try again."] },
			});
		}
		track("portal.file_uploaded", {
			eventId: ctx.event.id,
			assignmentId: assignment.id,
			version,
			sizeBytes: file.size,
		});
		return redirect(`${here}?saved=uploaded`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "comment") {
		const fileId = String(form.get("fileId") ?? "");
		const commentKey = String(form.get("commentKey") ?? "");
		const body = String(form.get("body") ?? "").trim();
		if (!body || body.length > 2000) {
			return fail({
				commentKey,
				commentFileId: fileId,
				commentBody: body,
				formError: "Write a comment up to 2,000 characters.",
			});
		}
		const [file] = await db
			.select({ id: files.id })
			.from(files)
			.where(
				and(eq(files.id, fileId), eq(files.taskAssignmentId, assignment.id)),
			)
			.limit(1);
		if (!file) throw data(null, { status: 404 });
		let deduped: boolean;
		try {
			({ deduped } = await timings.time("db", () =>
				addFileComment(db, {
					key: commentKey,
					fileId: file.id,
					authorId: user.id,
					authorName: ctx.contact
						? `${ctx.contact.firstName} ${ctx.contact.lastName}`
						: (user.name ?? user.email),
					body,
				}),
			));
		} catch (error) {
			track("portal.file_comment_failed", {
				eventId: ctx.event.id,
				fileId: file.id,
				error: errorMessage(error),
			});
			return fail({
				commentKey,
				commentFileId: file.id,
				commentBody: body,
				formError: "Could not post your comment — please try again.",
			});
		}
		track("portal.file_comment_added", {
			eventId: ctx.event.id,
			fileId: file.id,
			deduped,
		});
		return data(
			{
				intent,
				ok: true,
				commentKey: crypto.randomUUID(),
				commentFileId: file.id,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	return fail({ formError: "Unknown action." });
}

export default function PortalTaskDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return (
		<TaskDetailView data={loaderData} actionData={actionData ?? undefined} />
	);
}
