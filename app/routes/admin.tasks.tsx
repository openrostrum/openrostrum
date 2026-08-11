import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	exists,
	gte,
	inArray,
	lt,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { useState } from "react";
import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	CONTACT_STATUS,
	contacts,
	insertTaskSchema,
	participants,
	portalForms,
	submissions,
	TASK_TYPE,
	taskAssignments,
	tasks,
} from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatDateUTC, parseDueDate } from "~/lib/format";
import { likeContains } from "~/lib/like";
import { escapeHtml } from "~/lib/html";
import { firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import {
	isOverdue,
	TASK_STATUS_LABEL,
	TASK_STATUS_TONE,
} from "~/lib/task-status";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { getEmailSender } from "~/ports/email";
import {
	Button,
	ButtonLink,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	Tab,
	Table,
	TableFooter,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.tasks";

const PAGE_SIZE = 25;

// Server-side only (references schema enums); the component receives it via
// loader data so drizzle + the schema never reach the client bundle.
const ASSIGN_TARGETS = [
	{ value: "accepted", label: "Speakers on accepted submissions" },
	{ value: "all", label: "All contacts" },
	...CONTACT_STATUS.map((s) => ({
		value: `status:${s}`,
		label: `Contacts with status "${s}"`,
	})),
];

// Validate with the DB-derived schema (SSOT), refined: drizzle-zod maps notNull
// text to z.string() which accepts "" — required strings need .min(1).
const TaskForm = insertTaskSchema.pick({ type: true }).extend({
	name: z.string().trim().min(1, "Task name is required"),
	description: z
		.string()
		.trim()
		.max(2000, "Keep the description under 2,000 characters"),
	linkUrl: z.union([
		z.literal(""),
		z
			.string()
			.trim()
			.regex(/^https?:\/\//, "Link must include the http(s):// prefix"),
	]),
	completion: z.union([
		z.literal(""),
		z.literal("file"),
		z.string().regex(/^form:.+$/),
	]),
	dueInDays: z.union([
		z.literal(""),
		z.coerce
			.number()
			.int("Enter whole days")
			.min(0, "Days can't be negative")
			.max(365, "Keep it within a year"),
	]),
	required: z.enum(["yes", "no"]),
	autoAssign: z.enum(["yes", "no"]),
});

/**
 * The type decides what an assignment is anchored to: session tasks carry the
 * submission id, so portal uploads attach to that session in the files
 * library; speaker tasks never can. Raw enum words hid that consequence.
 */
const TASK_TYPE_META: Record<
	(typeof TASK_TYPE)[number],
	{ label: string; hint: string | null }
> = {
	contact: { label: "Speaker", hint: "one per person" },
	submission: {
		label: "Session",
		hint: "one per accepted session; uploads attach to it",
	},
	group: { label: "Group", hint: null },
};

const taskTypeLabel = (type: string) =>
	(TASK_TYPE_META as Record<string, { label: string }>)[type]?.label ?? type;

const taskTypeOption = (type: (typeof TASK_TYPE)[number]) => {
	const { label, hint } = TASK_TYPE_META[type];
	return hint ? `${label} — ${hint}` : label;
};

const AssignForm = z.object({
	taskId: z.string().min(1, "Pick a task to assign"),
	target: z.enum([
		"accepted",
		"all",
		...CONTACT_STATUS.map((s) => `status:${s}` as const),
	]),
	dueDate: z.union([
		z.literal(""),
		z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"),
	]),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** Stable fingerprint of one speaker's outstanding set (ids + due dates). */
async function outstandingFingerprint(
	rows: Array<{ assignmentId: string; dueAt: Date | null }>,
): Promise<string> {
	const canonical = rows
		.map(
			(r) =>
				`${r.assignmentId}:${r.dueAt ? Math.floor(r.dueAt.getTime() / 1000) : 0}`,
		)
		.sort()
		.join(",");
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical),
	);
	return [...new Uint8Array(hash)]
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader (single-fetch
	// can run this loader alone via `?_routes=`).
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const viewParam = url.searchParams.get("view");
	const view: "outstanding" | "assignments" | "definitions" =
		viewParam === "assignments" || viewParam === "definitions"
			? viewParam
			: "outstanding";
	const q = (url.searchParams.get("q") ?? "").trim();
	const taskId = url.searchParams.get("taskId") ?? "";
	const statusParam = url.searchParams.get("status");
	const status:
		| "outstanding"
		| "incomplete"
		| "pending_feedback"
		| "complete"
		| "all" =
		statusParam === "incomplete" ||
		statusParam === "pending_feedback" ||
		statusParam === "complete" ||
		statusParam === "all"
			? statusParam
			: "outstanding";
	const dueParam = url.searchParams.get("due");
	const due: "all" | "overdue" | "soon" =
		dueParam === "overdue" || dueParam === "soon" ? dueParam : "all";
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	);
	const editId = url.searchParams.get("edit");
	const createdId = url.searchParams.get("created");

	const empty = {
		eventName: null as string | null,
		view,
		filters: { q, taskId, status, due, page },
		stats: {
			speakersOutstanding: 0,
			totalOutstanding: 0,
			overdue: 0,
			totalAssignments: 0,
			remindableSpeakers: 0,
		},
		taskOptions: [] as Array<{ id: string; name: string; type: string }>,
		taskTypes: TASK_TYPE,
		speakers: [] as Array<{
			contactId: string;
			firstName: string;
			lastName: string;
			email: string;
			outstanding: number;
			earliestDue: Date | null;
			items: Array<{
				assignmentId: string;
				taskName: string;
				status: string;
				dueAt: Date | null;
				overdue: boolean;
			}>;
		}>,
		speakersTotal: 0,
		assignments: [] as Array<{
			id: string;
			taskName: string;
			status: string;
			dueAt: Date | null;
			overdue: boolean;
			completedAt: Date | null;
			firstName: string;
			lastName: string;
			email: string;
			submissionTitle: string | null;
		}>,
		assignmentsTotal: 0,
		definitions: [] as Array<{
			id: string;
			name: string;
			type: string;
			description: string | null;
			linkUrl: string | null;
			portalFormId: string | null;
			formName: string | null;
			isFileRequest: boolean;
			required: boolean;
			dueInDays: number | null;
			isOnboardingDefault: boolean;
			assigned: number;
			outstanding: number;
		}>,
		portalFormOptions: [] as Array<{ id: string; name: string }>,
		assignTargets: ASSIGN_TARGETS,
		editId,
		createdId,
		createdName: null as string | null,
	};
	if (!event) return empty;

	const db = getDb(env);
	const timings = createTimings();
	const now = new Date();

	const likePattern = likeContains(q);
	const eventScope = eq(tasks.eventId, event.id);
	const outstandingScope = and(
		eventScope,
		ne(taskAssignments.status, "complete"),
	);
	const taskFilter = taskId ? eq(tasks.id, taskId) : undefined;
	const contactSearch = q
		? or(
				sql`${contacts.firstName} LIKE ${likePattern} ESCAPE '\\'`,
				sql`${contacts.lastName} LIKE ${likePattern} ESCAPE '\\'`,
				sql`${contacts.email} LIKE ${likePattern} ESCAPE '\\'`,
				sql`${contacts.firstName} || ' ' || ${contacts.lastName} LIKE ${likePattern} ESCAPE '\\'`,
			)
		: undefined;
	const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
	const dueFilter =
		due === "overdue"
			? and(
					lt(taskAssignments.dueAt, now),
					ne(taskAssignments.status, "complete"),
				)
			: due === "soon"
				? and(
						gte(taskAssignments.dueAt, now),
						lte(taskAssignments.dueAt, weekOut),
						ne(taskAssignments.status, "complete"),
					)
				: undefined;

	const result = await timings.time("db", async () => {
		const [agg] = await db
			.select({
				speakers: countDistinct(taskAssignments.contactId),
				total: count(),
			})
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.where(outstandingScope);
		const [over] = await db
			.select({ n: count() })
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.where(and(outstandingScope, lt(taskAssignments.dueAt, now)));
		const [allAssignments] = await db
			.select({ n: count() })
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.where(eventScope);
		const [remindable] = await db
			.select({ n: countDistinct(taskAssignments.contactId) })
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.where(
				and(eventScope, eq(taskAssignments.status, "incomplete"), taskFilter),
			);
		const taskOptions = await db
			.select({ id: tasks.id, name: tasks.name, type: tasks.type })
			.from(tasks)
			.where(eventScope)
			.orderBy(asc(tasks.name));

		const stats = {
			speakersOutstanding: agg?.speakers ?? 0,
			totalOutstanding: agg?.total ?? 0,
			overdue: over?.n ?? 0,
			totalAssignments: allAssignments?.n ?? 0,
			remindableSpeakers: remindable?.n ?? 0,
		};

		if (view === "outstanding") {
			const where = and(outstandingScope, taskFilter, contactSearch, dueFilter);
			const pageRows = await db
				.select({
					contactId: contacts.id,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					email: contacts.email,
					outstanding: count(),
					earliestDue: sql<number | null>`min(${taskAssignments.dueAt})`,
				})
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
				.where(where)
				.groupBy(contacts.id)
				.orderBy(desc(count()), asc(contacts.lastName), asc(contacts.firstName))
				.limit(PAGE_SIZE)
				.offset((page - 1) * PAGE_SIZE);
			const [total] = await db
				.select({ n: countDistinct(contacts.id) })
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
				.where(where);
			const ids = pageRows.map((r) => r.contactId);
			const items = ids.length
				? await db
						.select({
							assignmentId: taskAssignments.id,
							contactId: taskAssignments.contactId,
							taskName: tasks.name,
							status: taskAssignments.status,
							dueAt: taskAssignments.dueAt,
						})
						.from(taskAssignments)
						.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
						.where(
							and(
								outstandingScope,
								taskFilter,
								dueFilter,
								inArray(taskAssignments.contactId, ids),
							),
						)
						.orderBy(
							sql`${taskAssignments.dueAt} is null`,
							asc(taskAssignments.dueAt),
						)
				: [];
			const speakers = pageRows.map((r) => ({
				contactId: r.contactId,
				firstName: r.firstName,
				lastName: r.lastName,
				email: r.email,
				outstanding: r.outstanding,
				earliestDue:
					r.earliestDue == null ? null : new Date(r.earliestDue * 1000),
				items: items
					.filter((i) => i.contactId === r.contactId)
					.map((i) => ({
						assignmentId: i.assignmentId,
						taskName: i.taskName,
						status: i.status,
						dueAt: i.dueAt,
						overdue: isOverdue(i.dueAt, i.status, now),
					})),
			}));
			return {
				...empty,
				stats,
				taskOptions,
				speakers,
				speakersTotal: total?.n ?? 0,
			};
		}

		if (view === "assignments") {
			const statusFilter =
				status === "outstanding"
					? ne(taskAssignments.status, "complete")
					: status === "all"
						? undefined
						: eq(taskAssignments.status, status);
			const where = and(
				eventScope,
				statusFilter,
				taskFilter,
				contactSearch,
				dueFilter,
			);
			const rows = await db
				.select({
					id: taskAssignments.id,
					status: taskAssignments.status,
					dueAt: taskAssignments.dueAt,
					completedAt: taskAssignments.completedAt,
					taskName: tasks.name,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					email: contacts.email,
					submissionTitle: submissions.title,
				})
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
				.leftJoin(submissions, eq(submissions.id, taskAssignments.submissionId))
				.where(where)
				.orderBy(
					sql`${taskAssignments.dueAt} is null`,
					asc(taskAssignments.dueAt),
					desc(taskAssignments.createdAt),
				)
				.limit(PAGE_SIZE)
				.offset((page - 1) * PAGE_SIZE);
			const [total] = await db
				.select({ n: count() })
				.from(taskAssignments)
				.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
				.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
				.where(where);
			return {
				...empty,
				stats,
				taskOptions,
				assignments: rows.map((r) => ({
					...r,
					overdue: isOverdue(r.dueAt, r.status, now),
				})),
				assignmentsTotal: total?.n ?? 0,
			};
		}

		const definitions = await db
			.select({
				id: tasks.id,
				name: tasks.name,
				type: tasks.type,
				description: tasks.description,
				linkUrl: tasks.linkUrl,
				portalFormId: tasks.portalFormId,
				formName: portalForms.name,
				isFileRequest: tasks.isFileRequest,
				required: tasks.required,
				dueInDays: tasks.dueInDays,
				isOnboardingDefault: tasks.isOnboardingDefault,
				assigned: count(taskAssignments.id),
				outstanding: sql<number>`coalesce(sum(case when ${taskAssignments.status} <> 'complete' then 1 else 0 end), 0)`,
			})
			.from(tasks)
			.leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
			.leftJoin(portalForms, eq(portalForms.id, tasks.portalFormId))
			.where(eventScope)
			.groupBy(tasks.id)
			.orderBy(asc(tasks.createdAt));
		const portalFormOptions = await db
			.select({ id: portalForms.id, name: portalForms.name })
			.from(portalForms)
			.where(eq(portalForms.eventId, event.id))
			.orderBy(asc(portalForms.name));
		return {
			...empty,
			stats,
			taskOptions,
			definitions,
			portalFormOptions,
			createdName: definitions.find((d) => d.id === createdId)?.name ?? null,
		};
	});

	return data(
		{ ...result, eventName: event.name },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	notice?: string;
};

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { formError: "No event is configured yet." } satisfies ActionResult;
	}
	const db = getDb(env);
	const timings = createTimings();
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	if (intent === "create-task" || intent === "update-task") {
		const parsed = TaskForm.safeParse({
			name: form.get("name") ?? "",
			type: form.get("type") ?? "contact",
			description: form.get("description") ?? "",
			linkUrl: form.get("linkUrl") ?? "",
			completion: form.get("completion") ?? "",
			dueInDays: form.get("dueInDays") ?? "",
			required: form.get("required") ?? "yes",
			autoAssign: form.get("autoAssign") ?? "no",
		});
		if (!parsed.success) {
			return {
				fieldErrors: z.flattenError(parsed.error)
					.fieldErrors as ActionResult["fieldErrors"],
			} satisfies ActionResult;
		}
		const d = parsed.data;
		let portalFormId: string | null = null;
		if (d.completion.startsWith("form:")) {
			// Ownership check: a forged POST must not attach another event's form.
			const [pf] = await db
				.select({ id: portalForms.id })
				.from(portalForms)
				.where(
					and(
						eq(portalForms.id, d.completion.slice(5)),
						eq(portalForms.eventId, event.id),
					),
				)
				.limit(1);
			if (!pf) {
				return {
					fieldErrors: {
						completion: ["Pick a portal form from this event."],
					} as ActionResult["fieldErrors"],
				} satisfies ActionResult;
			}
			portalFormId = pf.id;
		}
		const values = {
			name: d.name,
			type: d.type,
			description: d.description || null,
			linkUrl: d.linkUrl || null,
			portalFormId,
			isFileRequest: d.completion === "file",
			required: d.required === "yes",
			dueInDays: d.dueInDays === "" ? null : d.dueInDays,
			isOnboardingDefault: d.autoAssign === "yes",
		};
		let createdId: string | undefined;
		try {
			if (intent === "create-task") {
				const [row] = await timings.time("db", () =>
					db
						.insert(tasks)
						.values({ ...values, eventId: event.id })
						.returning({ id: tasks.id }),
				);
				createdId = row?.id;
				track("task.created", {
					eventId: event.id,
					taskId: row?.id,
					type: d.type,
				});
			} else {
				const taskId = String(form.get("taskId") ?? "");
				const [existing] = await db
					.select({ id: tasks.id })
					.from(tasks)
					.where(and(eq(tasks.id, taskId), eq(tasks.eventId, event.id)))
					.limit(1);
				if (!existing) {
					return {
						formError: "That task no longer exists.",
					} satisfies ActionResult;
				}
				await timings.time("db", () =>
					db.update(tasks).set(values).where(eq(tasks.id, existing.id)),
				);
				track("task.updated", { eventId: event.id, taskId: existing.id });
			}
		} catch (error) {
			track("task.save_failed", {
				eventId: event.id,
				error: errorMessage(error),
			});
			return {
				formError: "Could not save the task — please try again.",
			} satisfies ActionResult;
		}
		// `created` remounts the definitions form client-side so the next
		// definition starts blank instead of inheriting this one's values.
		return redirect(
			createdId
				? `/admin/tasks?view=definitions&created=${createdId}`
				: "/admin/tasks?view=definitions",
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (intent === "delete-task") {
		const taskId = String(form.get("taskId") ?? "");
		const [existing] = await db
			.select({ id: tasks.id, name: tasks.name })
			.from(tasks)
			.where(and(eq(tasks.id, taskId), eq(tasks.eventId, event.id)))
			.limit(1);
		if (!existing) {
			return {
				formError: "That task no longer exists.",
			} satisfies ActionResult;
		}
		try {
			await timings.time("db", () =>
				db.delete(tasks).where(eq(tasks.id, existing.id)),
			);
		} catch (error) {
			track("task.delete_failed", {
				eventId: event.id,
				taskId: existing.id,
				error: errorMessage(error),
			});
			return {
				formError: "Could not delete the task — please try again.",
			} satisfies ActionResult;
		}
		track("task.deleted", { eventId: event.id, taskId: existing.id });
		return redirect("/admin/tasks?view=definitions", {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "assign-task") {
		const parsed = AssignForm.safeParse({
			taskId: form.get("taskId") ?? "",
			target: form.get("target") ?? "accepted",
			dueDate: form.get("dueDate") ?? "",
		});
		if (!parsed.success) {
			return {
				fieldErrors: z.flattenError(parsed.error)
					.fieldErrors as ActionResult["fieldErrors"],
			} satisfies ActionResult;
		}
		const [task] = await db
			.select()
			.from(tasks)
			.where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.eventId, event.id)))
			.limit(1);
		if (!task) {
			return {
				formError: "That task no longer exists.",
			} satisfies ActionResult;
		}
		const now = new Date();
		const dueAt = parsed.data.dueDate
			? parseDueDate(parsed.data.dueDate)
			: task.dueInDays != null
				? new Date(now.getTime() + task.dueInDays * 24 * 60 * 60 * 1000)
				: null;

		let candidates: Array<{ contactId: string; submissionId: string | null }>;
		if (task.type === "submission") {
			// Submission tasks target each accepted submission's primary speaker;
			// contactId is ALWAYS set so the per-speaker dashboard sees the row.
			candidates = await db
				.select({
					contactId: participants.contactId,
					submissionId: participants.submissionId,
				})
				.from(participants)
				.innerJoin(submissions, eq(submissions.id, participants.submissionId))
				.where(
					and(
						eq(submissions.eventId, event.id),
						eq(submissions.status, "accepted"),
						eq(participants.role, "speaker"),
						eq(participants.isPrimary, true),
					),
				);
		} else {
			const target = parsed.data.target;
			const acceptedOnly = exists(
				db
					.select({ one: sql`1` })
					.from(participants)
					.innerJoin(submissions, eq(submissions.id, participants.submissionId))
					.where(
						and(
							eq(participants.contactId, contacts.id),
							eq(submissions.status, "accepted"),
						),
					),
			);
			const rows = await db
				.select({ contactId: contacts.id })
				.from(contacts)
				.where(
					and(
						eq(contacts.eventId, event.id),
						target === "accepted"
							? acceptedOnly
							: target === "all"
								? undefined
								: eq(
										contacts.status,
										target.slice(
											"status:".length,
										) as (typeof CONTACT_STATUS)[number],
									),
					),
				);
			candidates = rows.map((r) => ({
				contactId: r.contactId,
				submissionId: null,
			}));
		}
		// One assignment per idempotency scope — (task, contact) for contact
		// tasks, (task, contact, submission) for submission tasks, so a
		// multi-talk speaker gets one row per accepted talk. Dedupe candidates,
		// then let the partial unique indexes absorb replays (idempotent
		// re-assign).
		const seen = new Set<string>();
		const unique = candidates.filter((c) => {
			const key = `${c.contactId}:${c.submissionId ?? ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		if (unique.length === 0) {
			return {
				notice: "No speakers matched that audience — nothing was assigned.",
			} satisfies ActionResult;
		}
		let added = 0;
		try {
			await timings.time("db", async () => {
				for (let i = 0; i < unique.length; i += 50) {
					const inserted = await db
						.insert(taskAssignments)
						.values(
							unique.slice(i, i + 50).map((c) => ({
								taskId: task.id,
								contactId: c.contactId,
								submissionId: c.submissionId,
								status: "incomplete" as const,
								dueAt,
							})),
						)
						// Targetless: the conflict may land on either partial unique
						// index (contact scope or submission scope), and SQLite's ON
						// CONFLICT target cannot address a partial index without
						// repeating its WHERE clause.
						.onConflictDoNothing()
						.returning({ id: taskAssignments.id });
					added += inserted.length;
				}
			});
		} catch (error) {
			track("task.assign_failed", {
				eventId: event.id,
				taskId: task.id,
				error: errorMessage(error),
			});
			return {
				formError: "Could not assign the task — please try again.",
			} satisfies ActionResult;
		}
		const skipped = unique.length - added;
		track("task.assigned", {
			eventId: event.id,
			taskId: task.id,
			added,
			skipped,
		});
		const assignResult: ActionResult = {
			notice: `Assigned "${task.name}" to ${added} speaker${added === 1 ? "" : "s"}${
				skipped > 0 ? ` — ${skipped} already had it` : ""
			}.`,
		};
		return data(assignResult, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "remind-outstanding") {
		const taskId = String(form.get("taskId") ?? "");
		// Incomplete only: a pending_feedback upload is waiting on the ORGANIZER,
		// so reminding that speaker would be wrong.
		const rows = await db
			.select({
				assignmentId: taskAssignments.id,
				taskName: tasks.name,
				dueAt: taskAssignments.dueAt,
				contactId: contacts.id,
				firstName: contacts.firstName,
				email: contacts.email,
			})
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.innerJoin(contacts, eq(contacts.id, taskAssignments.contactId))
			.where(
				and(
					eq(tasks.eventId, event.id),
					eq(taskAssignments.status, "incomplete"),
					taskId ? eq(tasks.id, taskId) : undefined,
				),
			)
			.orderBy(
				sql`${taskAssignments.dueAt} is null`,
				asc(taskAssignments.dueAt),
			);
		if (rows.length === 0) {
			return {
				notice: "Nothing outstanding — no reminders to send.",
			} satisfies ActionResult;
		}
		const byContact = new Map<string, typeof rows>();
		for (const row of rows) {
			const list = byContact.get(row.contactId) ?? [];
			list.push(row);
			byContact.set(row.contactId, list);
		}
		const portalPublicId = (await firstPortalsByEvent(db, event.id)).get(
			event.id,
		);
		const origin = new URL(request.url).origin;
		const portalHref = portalPublicId
			? portalUrl(origin, event.slug, portalPublicId)
			: null;
		const sender = getEmailSender(env);
		const now = new Date();
		const day = now.toISOString().slice(0, 10);
		let sent = 0;
		let alreadySent = 0;
		try {
			for (const [contactId, list] of byContact) {
				const first = list[0];
				if (!first) continue;
				const items = list
					.map((r) => {
						const due = r.dueAt
							? ` — due ${formatDateUTC(r.dueAt)}${r.dueAt.getTime() < now.getTime() ? " (overdue)" : ""}`
							: "";
						return `<li><strong>${escapeHtml(r.taskName)}</strong>${due}</li>`;
					})
					.join("");
				const portalLine = portalHref
					? `<p><a href="${portalHref}">Open your speaker portal</a> to complete them.</p>`
					: `<p>Log in to your speaker portal to complete them.</p>`;
				const result = await sender.send({
					to: first.email,
					subject: `Reminder: ${list.length} outstanding speaker task${list.length === 1 ? "" : "s"} for ${event.name}`,
					html: `<p>Hi ${escapeHtml(first.firstName)},</p><p>You still have ${list.length} task${list.length === 1 ? "" : "s"} to complete for ${escapeHtml(event.name)}:</p><ul>${items}</ul>${portalLine}`,
					// Task reminders are a consequence of the speaker's own
					// participation — they always deliver, even to unsubscribed addresses.
					kind: "transactional",
					// The occurrence is this speaker's exact outstanding set today:
					// double-submits and retries after a partial failure dedupe, while
					// a changed set (or a new day) legitimately re-sends.
					dedupeKey: `task-remind:${contactId}:${day}:${await outstandingFingerprint(list)}`,
					eventId: event.id,
				});
				if (result.deduped) alreadySent += 1;
				else sent += 1;
			}
		} catch (error) {
			track("task.reminder_bulk_failed", {
				eventId: event.id,
				error: errorMessage(error),
			});
			return {
				formError: "Some reminders could not be sent — please try again.",
			} satisfies ActionResult;
		}
		track("task.reminder_bulk_sent", {
			eventId: event.id,
			speakers: sent,
			assignments: rows.length,
			deduped: alreadySent,
		});
		const remindResult: ActionResult = {
			notice:
				sent === 0
					? "These reminders were already sent."
					: `Sent ${sent} reminder${sent === 1 ? "" : "s"} covering ${rows.length} outstanding task${rows.length === 1 ? "" : "s"}.`,
		};
		return data(remindResult, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return { formError: "Unknown action." } satisfies ActionResult;
}

function buildHref(
	params: Record<string, string | number | undefined>,
): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "" && value !== null) {
			search.set(key, String(value));
		}
	}
	const s = search.toString();
	return s ? `/admin/tasks?${s}` : "/admin/tasks";
}

export default function TasksDashboard({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const {
		view,
		filters,
		stats,
		taskOptions,
		speakers,
		speakersTotal,
		assignments,
		assignmentsTotal,
		definitions,
		portalFormOptions,
		assignTargets,
		editId,
		createdId,
		createdName,
	} = loaderData;
	const [confirmingRemind, setConfirmingRemind] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
	const [assignTaskId, setAssignTaskId] = useState<string | null>(null);
	const editTask = definitions.find((d) => d.id === editId) ?? null;
	const assignTaskType = taskOptions.find(
		(t) => t.id === (assignTaskId ?? taskOptions[0]?.id),
	)?.type;

	const filterParams = {
		view,
		q: filters.q,
		taskId: filters.taskId,
		status: view === "assignments" ? filters.status : undefined,
		due: filters.due === "all" ? undefined : filters.due,
	};

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Tasks"
				count={`${stats.totalOutstanding} outstanding`}
				subtitle={`${stats.speakersOutstanding} speaker${stats.speakersOutstanding === 1 ? "" : "s"} still owe${stats.speakersOutstanding === 1 ? "s" : ""} work · ${stats.overdue} overdue`}
				actions={
					view !== "definitions" ? (
						confirmingRemind ? (
							<Form
								method="post"
								className="flex items-center gap-2"
								onSubmit={() => setConfirmingRemind(false)}
							>
								<Input type="hidden" name="intent" value="remind-outstanding" />
								<Input type="hidden" name="taskId" value={filters.taskId} />
								<Button
									type="button"
									variant="ghost"
									onClick={() => setConfirmingRemind(false)}
								>
									Cancel
								</Button>
								<Button type="submit" icon="mail" disabled={busy}>
									Email {stats.remindableSpeakers} speaker
									{stats.remindableSpeakers === 1 ? "" : "s"}
								</Button>
							</Form>
						) : (
							<Button
								type="button"
								variant="ghost"
								icon="mail"
								disabled={stats.remindableSpeakers === 0}
								onClick={() => setConfirmingRemind(true)}
							>
								Remind outstanding
							</Button>
						)
					) : undefined
				}
			/>

			{actionData?.notice && (
				<div className="flex">
					<StatusBadge tone="success">{actionData.notice}</StatusBadge>
				</div>
			)}
			{createdName && !actionData?.fieldErrors && !actionData?.formError && (
				<div className="flex">
					<StatusBadge tone="success">
						Added &quot;{createdName}&quot; — the form below is ready for the
						next task.
					</StatusBadge>
				</div>
			)}
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}

			<Tabs>
				<Tab
					to="/admin/tasks"
					active={view === "outstanding"}
					count={stats.speakersOutstanding}
				>
					Outstanding
				</Tab>
				<Tab
					to="/admin/tasks?view=assignments"
					active={view === "assignments"}
					count={stats.totalAssignments}
				>
					All assignments
				</Tab>
				<Tab
					to="/admin/tasks?view=definitions"
					active={view === "definitions"}
					count={taskOptions.length}
				>
					Task definitions
				</Tab>
			</Tabs>

			{view !== "definitions" && (
				<Form method="get" className="flex flex-wrap items-end gap-3">
					<Input type="hidden" name="view" value={view} />
					<SearchInput
						name="q"
						placeholder="Search speakers by name or email…"
						defaultValue={filters.q}
					/>
					<Field label="Task">
						<Select
							name="taskId"
							defaultValue={filters.taskId}
							onChange={(e) => e.currentTarget.form?.requestSubmit()}
						>
							<option value="">All tasks</option>
							{taskOptions.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</Select>
					</Field>
					{view === "assignments" && (
						<Field label="Status">
							<Select
								name="status"
								defaultValue={filters.status}
								onChange={(e) => e.currentTarget.form?.requestSubmit()}
							>
								<option value="outstanding">Outstanding</option>
								<option value="incomplete">Incomplete</option>
								<option value="pending_feedback">Pending feedback</option>
								<option value="complete">Complete</option>
								<option value="all">All</option>
							</Select>
						</Field>
					)}
					<Field label="Due">
						<Select
							name="due"
							defaultValue={filters.due}
							onChange={(e) => e.currentTarget.form?.requestSubmit()}
						>
							<option value="all">Any due date</option>
							<option value="overdue">Overdue</option>
							<option value="soon">Due within 7 days</option>
						</Select>
					</Field>
					<Button type="submit" variant="ghost" icon="filter">
						Filter
					</Button>
				</Form>
			)}

			{view === "outstanding" && (
				<>
					<Table>
						<THead>
							<Th>Speaker</Th>
							<Th>Email</Th>
							<Th>Outstanding</Th>
							<Th>Tasks</Th>
							<Th>Next due</Th>
						</THead>
						<TBody>
							{speakers.map((s) => (
								<Tr key={s.contactId}>
									<Td kind="strong">
										{s.firstName} {s.lastName}
									</Td>
									<Td kind="mono">{s.email}</Td>
									<Td kind="mono">{s.outstanding}</Td>
									<Td>
										<div className="flex flex-wrap items-center gap-3">
											{s.items.map((i) => (
												<span
													key={i.assignmentId}
													className="inline-flex items-center gap-1"
												>
													<TextLink to={`/admin/tasks/${i.assignmentId}`}>
														{i.taskName}
													</TextLink>
													{i.status === "pending_feedback" && (
														<StatusBadge tone="info">
															Pending feedback
														</StatusBadge>
													)}
													{i.overdue && (
														<StatusBadge tone="danger">Overdue</StatusBadge>
													)}
												</span>
											))}
										</div>
									</Td>
									<Td kind="mono">
										{s.earliestDue ? formatDateUTC(s.earliestDue) : "—"}
									</Td>
								</Tr>
							))}
							{speakers.length === 0 &&
								(stats.totalAssignments === 0 ? (
									<EmptyRow colSpan={5}>
										<EmptyState
											icon="star"
											title="No tasks assigned yet"
											body="Assign an onboarding task — hotel form, flight reimbursement, slides upload — and the speakers who still owe work will show up here."
											action={
												<ButtonLink
													to="/admin/tasks?view=definitions"
													variant="ghost"
												>
													Go to task definitions
												</ButtonLink>
											}
										/>
									</EmptyRow>
								) : filters.q || filters.taskId || filters.due !== "all" ? (
									<EmptyRow colSpan={5}>
										No speakers match these filters.
									</EmptyRow>
								) : (
									<EmptyRow colSpan={5}>
										<EmptyState
											icon="star"
											title="All caught up"
											body="Every assigned task is complete — no speaker owes anything right now."
										/>
									</EmptyRow>
								))}
						</TBody>
					</Table>
					<Pagination
						page={filters.page}
						total={speakersTotal}
						params={filterParams}
					/>
				</>
			)}

			{view === "assignments" && (
				<>
					<Table>
						<THead>
							<Th>Task</Th>
							<Th>Speaker</Th>
							<Th>Status</Th>
							<Th>Due</Th>
							<Th>Submission</Th>
							<Th>Completed</Th>
							<Th />
						</THead>
						<TBody>
							{assignments.map((a) => (
								<Tr key={a.id}>
									<Td kind="strong">{a.taskName}</Td>
									<Td>
										{a.firstName} {a.lastName}
									</Td>
									<Td>
										<StatusBadge tone={TASK_STATUS_TONE[a.status] ?? "neutral"}>
											{TASK_STATUS_LABEL[a.status] ?? a.status}
										</StatusBadge>
									</Td>
									<Td kind="mono">
										<span className="inline-flex items-center gap-2">
											{a.dueAt ? formatDateUTC(a.dueAt) : "—"}
											{a.overdue && (
												<StatusBadge tone="danger">Overdue</StatusBadge>
											)}
										</span>
									</Td>
									<Td>{a.submissionTitle ?? "—"}</Td>
									<Td kind="mono">
										{a.completedAt ? formatDateUTC(a.completedAt) : "—"}
									</Td>
									<Td>
										<TextLink to={`/admin/tasks/${a.id}`}>View</TextLink>
									</Td>
								</Tr>
							))}
							{assignments.length === 0 && (
								<EmptyRow colSpan={7}>
									{stats.totalAssignments === 0
										? "No assignments yet — assign a task from the Task definitions tab."
										: "No assignments match these filters."}
								</EmptyRow>
							)}
						</TBody>
					</Table>
					<Pagination
						page={filters.page}
						total={assignmentsTotal}
						params={filterParams}
					/>
				</>
			)}

			{view === "definitions" && (
				<>
					<Panel>
						<Form
							method="post"
							// Remount (and thereby clear) the uncontrolled inputs when
							// entering/leaving edit mode AND after every successful create —
							// otherwise the next definition silently inherits this one's
							// values.
							key={editTask ? `edit-${editTask.id}` : `new-${createdId ?? ""}`}
							className="flex flex-wrap items-end gap-3"
						>
							<Input
								type="hidden"
								name="intent"
								value={editTask ? "update-task" : "create-task"}
							/>
							{editTask && (
								<Input type="hidden" name="taskId" value={editTask.id} />
							)}
							<Field label="Name" error={actionData?.fieldErrors?.name?.[0]}>
								<Input
									name="name"
									defaultValue={editTask?.name ?? ""}
									invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
									placeholder="e.g. Hotel & Travel Reservations"
								/>
							</Field>
							<Field label="Type">
								<Select name="type" defaultValue={editTask?.type ?? "contact"}>
									{loaderData.taskTypes.map((t) => (
										<option key={t} value={t}>
											{taskTypeOption(t)}
										</option>
									))}
								</Select>
							</Field>
							<Field
								label="Completion"
								error={actionData?.fieldErrors?.completion?.[0]}
							>
								<Select
									name="completion"
									defaultValue={
										editTask?.portalFormId
											? `form:${editTask.portalFormId}`
											: editTask?.isFileRequest
												? "file"
												: ""
									}
								>
									<option value="">Mark as done</option>
									<option value="file">Upload a file</option>
									{portalFormOptions.map((f) => (
										<option key={f.id} value={`form:${f.id}`}>
											Fill in: {f.name}
										</option>
									))}
								</Select>
							</Field>
							<Field
								label="Description"
								error={actionData?.fieldErrors?.description?.[0]}
							>
								<Input
									name="description"
									defaultValue={editTask?.description ?? ""}
									placeholder="What the speaker needs to do"
								/>
							</Field>
							<Field
								label="Link URL"
								error={actionData?.fieldErrors?.linkUrl?.[0]}
							>
								<Input
									name="linkUrl"
									defaultValue={editTask?.linkUrl ?? ""}
									placeholder="https://…"
									invalid={Boolean(actionData?.fieldErrors?.linkUrl?.[0])}
								/>
							</Field>
							<Field
								label="Due (days after assignment)"
								error={actionData?.fieldErrors?.dueInDays?.[0]}
							>
								<Input
									name="dueInDays"
									type="number"
									min={0}
									max={365}
									defaultValue={editTask?.dueInDays ?? ""}
									placeholder="e.g. 14"
								/>
							</Field>
							<Field label="Required">
								<Select
									name="required"
									defaultValue={
										editTask ? (editTask.required ? "yes" : "no") : "yes"
									}
								>
									<option value="yes">Yes</option>
									<option value="no">No</option>
								</Select>
							</Field>
							<Field label="Auto-assign on accept">
								<Select
									name="autoAssign"
									defaultValue={
										editTask
											? editTask.isOnboardingDefault
												? "yes"
												: "no"
											: "no"
									}
								>
									<option value="yes">Yes</option>
									<option value="no">No</option>
								</Select>
							</Field>
							<Button
								type="submit"
								icon={editTask ? undefined : "plus"}
								disabled={busy}
							>
								{editTask ? "Save changes" : "Add task"}
							</Button>
							{editTask && (
								<ButtonLink to="/admin/tasks?view=definitions" variant="ghost">
									Cancel
								</ButtonLink>
							)}
						</Form>
					</Panel>

					<Panel>
						<Form method="post" className="flex flex-wrap items-end gap-3">
							<Input type="hidden" name="intent" value="assign-task" />
							<Field
								label="Assign"
								error={actionData?.fieldErrors?.taskId?.[0]}
							>
								<Select
									name="taskId"
									onChange={(e) => setAssignTaskId(e.currentTarget.value)}
								>
									{taskOptions.map((t) => (
										<option key={t.id} value={t.id}>
											{t.name}
										</option>
									))}
								</Select>
							</Field>
							<Field label="To">
								{assignTaskType === "submission" ? (
									<Select name="target" disabled>
										<option>Accepted submissions&apos; primary speakers</option>
									</Select>
								) : (
									<Select name="target" defaultValue="accepted">
										{assignTargets.map((t) => (
											<option key={t.value} value={t.value}>
												{t.label}
											</option>
										))}
									</Select>
								)}
							</Field>
							<Field
								label="Due date (optional)"
								error={actionData?.fieldErrors?.dueDate?.[0]}
							>
								<Input type="date" name="dueDate" />
							</Field>
							<Button
								type="submit"
								variant="ghost"
								disabled={busy || taskOptions.length === 0}
							>
								Assign
							</Button>
						</Form>
					</Panel>

					<Table>
						<THead>
							<Th>Task</Th>
							<Th>Type</Th>
							<Th>Completion</Th>
							<Th>Due in</Th>
							<Th>On accept</Th>
							<Th>Assigned</Th>
							<Th>Outstanding</Th>
							<Th />
						</THead>
						<TBody>
							{definitions.map((t) => (
								<Tr key={t.id} selected={t.id === editId}>
									<Td kind="strong">{t.name}</Td>
									<Td>{taskTypeLabel(t.type)}</Td>
									<Td>
										{t.formName
											? `Portal form: ${t.formName}`
											: t.isFileRequest
												? "File upload"
												: "Mark as done"}
									</Td>
									<Td kind="mono">
										{t.dueInDays != null ? `${t.dueInDays} days` : "—"}
									</Td>
									<Td>
										{t.isOnboardingDefault ? (
											<StatusBadge tone="info">Auto-assigned</StatusBadge>
										) : (
											"—"
										)}
									</Td>
									<Td kind="mono">
										{t.assigned > 0 ? (
											<TextLink
												to={buildHref({
													view: "assignments",
													taskId: t.id,
													status: "all",
												})}
											>
												{t.assigned}
											</TextLink>
										) : (
											"0"
										)}
									</Td>
									<Td kind="mono">{t.outstanding}</Td>
									<Td>
										{confirmingDelete === t.id ? (
											<Form
												method="post"
												className="flex items-center gap-2"
												onSubmit={() => setConfirmingDelete(null)}
											>
												<Input
													type="hidden"
													name="intent"
													value="delete-task"
												/>
												<Input type="hidden" name="taskId" value={t.id} />
												<span>
													Delete this task
													{t.assigned > 0
														? ` and its ${t.assigned} assignment${t.assigned === 1 ? "" : "s"}`
														: ""}
													?
												</span>
												<Button
													type="button"
													variant="ghost"
													onClick={() => setConfirmingDelete(null)}
												>
													Cancel
												</Button>
												<Button type="submit" disabled={busy}>
													Delete
												</Button>
											</Form>
										) : (
											<div className="flex items-center gap-3">
												<TextLink
													to={buildHref({ view: "definitions", edit: t.id })}
												>
													Edit
												</TextLink>
												<Button
													type="button"
													variant="ghost"
													onClick={() => setConfirmingDelete(t.id)}
												>
													Delete
												</Button>
											</div>
										)}
									</Td>
								</Tr>
							))}
							{definitions.length === 0 && (
								<EmptyRow colSpan={8}>
									<EmptyState
										icon="star"
										title="No tasks yet"
										body="Create your first onboarding task above — hotel form, flight reimbursement, slides upload — then assign it to speakers."
									/>
								</EmptyRow>
							)}
						</TBody>
					</Table>
				</>
			)}
		</div>
	);
}

function Pagination({
	page,
	total,
	params,
}: {
	page: number;
	total: number;
	params: Record<string, string | number | undefined>;
}) {
	if (total === 0) return null;
	const start = (page - 1) * PAGE_SIZE + 1;
	const end = Math.min(page * PAGE_SIZE, total);
	const lastPage = Math.ceil(total / PAGE_SIZE);
	return (
		<TableFooter>
			<span>
				{start}–{end} of {total}
			</span>
			<span className="ml-auto flex items-center gap-3">
				{page > 1 && (
					<TextLink to={buildHref({ ...params, page: page - 1 })}>
						Previous
					</TextLink>
				)}
				{page < lastPage && (
					<TextLink to={buildHref({ ...params, page: page + 1 })}>
						Next
					</TextLink>
				)}
			</span>
		</TableFooter>
	);
}

export function ErrorBoundary() {
	// Generic message only — the raw error can carry SQL/row values; the detail
	// is in the server logs.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load tasks"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
