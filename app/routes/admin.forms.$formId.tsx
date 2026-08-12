import { useEffect, useMemo, useState } from "react";
import {
	data,
	Form,
	isRouteErrorResponse,
	redirect,
	useFetcher,
	useNavigation,
} from "react-router";
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CopyButton } from "~/components/copy-button";
import { RichText as RichTextInput } from "~/ui/rich-text-lazy";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { getDb, type Db } from "~/db";
import {
	fields,
	formFields,
	forms,
	insertFormSchema,
	organizationMembers,
	submissions,
	users,
	type QuestionRule,
} from "~/db/schema";
import { adminFormPath, submitPath } from "~/domain/forms";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
	BUILTIN_META,
	BUILTIN_ORDER,
	type BuiltinRef,
	defaultBuiltinPlacements,
	FORM_STATUS_TONE,
	type FormSectionId,
	placementMissingOptions,
	questionRuleValueAvailable,
	ruleApplyDisabled,
	RULE_TRIGGER_FIELD_TYPES,
	utcToZonedInputs,
	zonedTimeToUtc,
} from "~/lib/forms";
import { loadRuleOptions, sanitizeRichText } from "~/lib/forms.server";
import { likeContains } from "~/lib/like";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { PaginationBar } from "./admin.forms";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Icon,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Tab,
	Table,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
	EmptyRow,
} from "~/ui";
import type { Route } from "./+types/admin.forms.$formId";

// Local alias — the shared contract lives in ~/lib/forms.
type SectionId = FormSectionId;

const FIELD_TYPE_LABEL: Record<string, string> = {
	text: "Text",
	textarea: "Text area",
	wysiwyg: "Rich text",
	dropdown: "Dropdown",
	checkbox: "Checkbox",
	number: "Number",
	email: "Email",
	phone: "Phone",
	date: "Date",
	section_header: "Section header",
	divider: "Divider",
};

// Types offered by "Create new field" (layout elements have their own tab).
const CREATE_FIELD_TYPES = [
	"text",
	"textarea",
	"wysiwyg",
	"dropdown",
	"checkbox",
	"number",
	"email",
	"phone",
	"date",
] as const satisfies ReadonlyArray<(typeof fields.$inferSelect)["type"]>;

// D1 caps a statement at 100 bound parameters — bulk placement inserts
// (~10 columns/row) must stay under it or the whole batch throws.
function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

const boolish = z.enum(["true", "false"]).transform((v) => v === "true");

// FormData drops inputs that aren't rendered (conditionally shown panels), so
// an ABSENT key must parse exactly like a blank one — otherwise the action
// rejects payloads the UI legitimately sends.
const Blank = z.union([z.null(), z.undefined(), z.string().trim().length(0)]);
const blankToNull = (v: unknown) => (Blank.safeParse(v).success ? null : v);

const optionalInt = (min: number, max: number) =>
	z.preprocess(
		blankToNull,
		z.coerce.number().int().min(min).max(max).nullable(),
	);

// Derived from the drizzle-zod schema (the golden-path SSOT); the extends
// exist because FormData is all strings — Selects post "true"/"false", numbers
// arrive as text — and because the text columns carry no length caps.
const SaveForm = insertFormSchema
	.pick({
		type: true,
		participantsStep: true,
		internalName: true,
		externalTitle: true,
		pageHeading: true,
		welcomeHtml: true,
		showWelcome: true,
		sessionSectionTitle: true,
		sessionSectionHtml: true,
		participantSectionTitle: true,
		participantSectionHtml: true,
		notifyExistingContacts: true,
		roleSpeakerMin: true,
		roleSpeakerMax: true,
		allowChairperson: true,
		roleChairpersonMin: true,
		roleChairpersonMax: true,
		allowModerator: true,
		roleModeratorMin: true,
		roleModeratorMax: true,
		sendReminders: true,
		submissionLimit: true,
		allowMultipleDrafts: true,
		autoRedirect: true,
		successHtml: true,
		sendConfirmationEmail: true,
	})
	.extend({
		participantsStep: boolish,
		internalName: z
			.string()
			.trim()
			.min(1, "Internal form name is required")
			.max(255),
		externalTitle: z.string().trim().max(255),
		pageHeading: z
			.string()
			.trim()
			.max(15, "Page heading is limited to 15 characters"),
		welcomeHtml: z.string().max(20000),
		showWelcome: boolish,
		sessionSectionTitle: z.string().trim().max(255),
		sessionSectionHtml: z.string().max(20000),
		participantSectionTitle: z.string().trim().max(255),
		participantSectionHtml: z.string().max(20000),
		notifyExistingContacts: boolish,
		roleSpeakerMin: z.coerce.number().int().min(0).max(50),
		roleSpeakerMax: optionalInt(1, 50),
		allowChairperson: boolish,
		roleChairpersonMin: z.coerce.number().int().min(0).max(50),
		roleChairpersonMax: optionalInt(1, 50),
		allowModerator: boolish,
		roleModeratorMin: z.coerce.number().int().min(0).max(50),
		roleModeratorMax: optionalInt(1, 50),
		// Not columns: the close instant is entered as date + time in the EVENT
		// timezone. Past dates are deliberately legal — backdating closes a form.
		closeDate: z.preprocess(
			blankToNull,
			z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
				.nullable(),
		),
		closeTime: z.preprocess(
			blankToNull,
			z
				.string()
				.regex(/^\d{2}:\d{2}$/, "Enter a valid time")
				.nullable(),
		),
		sendReminders: boolish,
		submissionLimit: optionalInt(1, 1000),
		allowMultipleDrafts: boolish,
		autoRedirect: boolish,
		successHtml: z.string().max(20000),
		sendConfirmationEmail: boolish,
	})
	.superRefine((d, ctx) => {
		const pairs: Array<[string, number, number | null]> = [
			["roleSpeakerMin", d.roleSpeakerMin, d.roleSpeakerMax],
			["roleChairpersonMin", d.roleChairpersonMin, d.roleChairpersonMax],
			["roleModeratorMin", d.roleModeratorMin, d.roleModeratorMax],
		];
		for (const [path, min, max] of pairs) {
			if (max !== null && min > max) {
				ctx.addIssue({
					code: "custom",
					message: "Minimum cannot exceed maximum",
					path: [path],
				});
			}
		}
	});

const CreateField = createInsertSchema(fields)
	.pick({ name: true, type: true, description: true, maxLength: true })
	.extend({
		name: z.string().trim().min(1, "Name is required").max(255),
		// Narrower than the column enum: layout elements have their own tab.
		type: z.enum(CREATE_FIELD_TYPES),
		description: z.string().trim().max(1000),
		// maxLength/options inputs only render for the types they apply to —
		// the schema must accept their ABSENCE, not just a blank value.
		maxLength: optionalInt(1, 5000),
		options: z.string().trim().max(5000).default(""),
		scope: z.enum(["event", "org"]),
		section: z.enum(["session", "participant"]),
		required: boolish,
	});

type ActionResult = {
	ok?: string;
	created?: string;
	fieldErrors?: Record<string, string[]>;
	formError?: string;
};

function zodErrors(error: z.ZodError): ActionResult {
	return { fieldErrors: z.flattenError(error).fieldErrors };
}

// Without this export, RR7 drops loader/action headers from DOCUMENT
// responses — Server-Timing would silently vanish on full page loads.
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

function fieldScopePredicate(eventId: string, organizationId: string) {
	// Event fields of THIS event, plus org-wide fields of THIS org — never
	// another tenant's library.
	return and(
		eq(fields.recordType, "session"),
		or(
			eq(fields.eventId, eventId),
			and(eq(fields.organizationId, organizationId), isNull(fields.eventId)),
		),
	);
}

async function loadPlacements(db: Db, formId: string) {
	const placements = await db.query.formFields.findMany({
		where: eq(formFields.formId, formId),
		with: {
			field: {
				columns: {
					id: true,
					organizationId: true,
					name: true,
					recordType: true,
					type: true,
					maxLength: true,
					options: true,
				},
			},
		},
		orderBy: [asc(formFields.position), asc(formFields.createdAt)],
	});
	return placements.filter(
		(placement) =>
			placement.field === null || placement.field.recordType === "session",
	);
}

const VIEW_PAGE_SIZE = 50;

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	if (params.formId === "new") throw redirect("/admin/forms");
	const event = await getActiveEvent(env, user);
	if (!event) throw redirect("/admin/forms");
	const db = getDb(env);
	const timings = createTimings();

	const [form] = await timings.time("db", () =>
		db
			.select({
				id: forms.id,
				publicId: forms.publicId,
				type: forms.type,
				status: forms.status,
				internalName: forms.internalName,
				externalTitle: forms.externalTitle,
				pageHeading: forms.pageHeading,
				welcomeHtml: forms.welcomeHtml,
				showWelcome: forms.showWelcome,
				participantsStep: forms.participantsStep,
				sessionSectionTitle: forms.sessionSectionTitle,
				sessionSectionHtml: forms.sessionSectionHtml,
				participantSectionTitle: forms.participantSectionTitle,
				participantSectionHtml: forms.participantSectionHtml,
				notifyExistingContacts: forms.notifyExistingContacts,
				roleSpeakerMin: forms.roleSpeakerMin,
				roleSpeakerMax: forms.roleSpeakerMax,
				allowChairperson: forms.allowChairperson,
				roleChairpersonMin: forms.roleChairpersonMin,
				roleChairpersonMax: forms.roleChairpersonMax,
				allowModerator: forms.allowModerator,
				roleModeratorMin: forms.roleModeratorMin,
				roleModeratorMax: forms.roleModeratorMax,
				closeAt: forms.closeAt,
				sendReminders: forms.sendReminders,
				submissionLimit: forms.submissionLimit,
				allowMultipleDrafts: forms.allowMultipleDrafts,
				autoRedirect: forms.autoRedirect,
				successHtml: forms.successHtml,
				sendConfirmationEmail: forms.sendConfirmationEmail,
				config: forms.config,
			})
			.from(forms)
			.where(and(eq(forms.id, params.formId), eq(forms.eventId, event.id)))
			.limit(1),
	);
	if (!form) throw data({ message: "Form not found" }, { status: 404 });

	const placements = await timings.time("placements", () =>
		loadPlacements(db, form.id),
	);
	// Forms minted before the builder existed (e.g. seed rows) have no built-in
	// placements. The loader stays read-only: the builder surfaces an explicit
	// one-click "initialize-builtins" action instead of writing on GET.
	const needsBuiltins = !placements.some((p) => p.builtinRef !== null);

	const url = new URL(request.url);
	const pickerQ = url.searchParams.get("pickerQ")?.trim() ?? "";
	const viewParam = url.searchParams.get("view");
	const view =
		viewParam === "results" || viewParam === "drafts" ? viewParam : null;

	const libraryRows = await timings.time("library", () =>
		db
			.select()
			.from(fields)
			.where(
				and(
					fieldScopePredicate(event.id, event.organizationId),
					ne(fields.type, "section_header"),
					ne(fields.type, "divider"),
					pickerQ ? likeContains(fields.name, pickerQ) : undefined,
				),
			)
			.orderBy(asc(fields.name))
			.limit(50),
	);

	const [ruleOptions, members] = await timings.time("options", () =>
		Promise.all([
			loadRuleOptions(db, event.id),
			// The notify pickers list the event's ORG MEMBERS — never a global
			// `users.role = 'admin'` query, which would leak other tenants' admins.
			db
				.select({ id: users.id, name: users.name, email: users.email })
				.from(organizationMembers)
				.innerJoin(users, eq(users.id, organizationMembers.userId))
				.where(eq(organizationMembers.organizationId, event.organizationId))
				.orderBy(asc(users.name)),
		]),
	);

	const [subCounts] = await timings.time("counts", () =>
		db
			.select({
				total: sql<number>`count(*)`,
				drafts: sql<number>`coalesce(sum(case when ${submissions.status} = 'draft' then 1 else 0 end), 0)`,
			})
			.from(submissions)
			.where(eq(submissions.formId, form.id)),
	);

	const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
		timeZone: event.timezone,
		dateStyle: "medium",
		timeStyle: "short",
	});
	const counts = {
		submissions: (subCounts?.total ?? 0) - (subCounts?.drafts ?? 0),
		drafts: subCounts?.drafts ?? 0,
	};

	let viewRows: Array<{
		id: string;
		title: string;
		status: (typeof submissions.$inferSelect)["status"];
		createdLabel: string;
	}> | null = null;
	const viewTotal = view === "drafts" ? counts.drafts : counts.submissions;
	const viewPages = Math.max(1, Math.ceil(viewTotal / VIEW_PAGE_SIZE));
	const viewPage = Math.min(
		viewPages,
		Math.max(1, Number(url.searchParams.get("page")) || 1),
	);
	if (view) {
		const subs = await timings.time("view", () =>
			db
				.select({
					id: submissions.id,
					title: submissions.title,
					status: submissions.status,
					createdAt: submissions.createdAt,
				})
				.from(submissions)
				.where(
					and(
						eq(submissions.formId, form.id),
						view === "drafts"
							? eq(submissions.status, "draft")
							: ne(submissions.status, "draft"),
					),
				)
				.orderBy(desc(submissions.createdAt))
				.limit(VIEW_PAGE_SIZE)
				.offset((viewPage - 1) * VIEW_PAGE_SIZE),
		);
		viewRows = subs.map((s) => ({
			id: s.id,
			title: s.title,
			status: s.status,
			createdLabel: dateTimeFmt.format(s.createdAt),
		}));
	}

	const closeInputs = form.closeAt
		? utcToZonedInputs(form.closeAt, event.timezone)
		: { date: "", time: "" };
	const config = (form.config ?? {}) as {
		notify?: { newSubmission?: string[]; updatedSubmission?: string[] };
	};
	// A recipient can leave the org after being picked — a stale id would
	// render as an unremovable hidden selection that bricks every save.
	const memberIds = new Set(members.map((m) => m.id));
	const notify = {
		newSubmission: (config.notify?.newSubmission ?? []).filter((id) =>
			memberIds.has(id),
		),
		updatedSubmission: (config.notify?.updatedSubmission ?? []).filter((id) =>
			memberIds.has(id),
		),
	};

	return data(
		{
			form: {
				id: form.id,
				publicId: form.publicId,
				type: form.type,
				status: form.status,
				internalName: form.internalName,
				externalTitle: form.externalTitle,
				pageHeading: form.pageHeading,
				welcomeHtml: form.welcomeHtml ?? "",
				showWelcome: form.showWelcome,
				participantsStep: form.participantsStep,
				sessionSectionTitle: form.sessionSectionTitle ?? "",
				sessionSectionHtml: form.sessionSectionHtml ?? "",
				participantSectionTitle: form.participantSectionTitle ?? "",
				participantSectionHtml: form.participantSectionHtml ?? "",
				notifyExistingContacts: form.notifyExistingContacts,
				roleSpeakerMin: form.roleSpeakerMin,
				roleSpeakerMax: form.roleSpeakerMax,
				allowChairperson: form.allowChairperson,
				roleChairpersonMin: form.roleChairpersonMin,
				roleChairpersonMax: form.roleChairpersonMax,
				allowModerator: form.allowModerator,
				roleModeratorMin: form.roleModeratorMin,
				roleModeratorMax: form.roleModeratorMax,
				sendReminders: form.sendReminders,
				submissionLimit: form.submissionLimit,
				allowMultipleDrafts: form.allowMultipleDrafts,
				autoRedirect: form.autoRedirect,
				successHtml: form.successHtml ?? "",
				sendConfirmationEmail: form.sendConfirmationEmail,
			},
			closeDate: closeInputs.date,
			closeTime: closeInputs.time,
			timezone: event.timezone,
			publicUrl: `${url.origin}${submitPath(event.slug, form.publicId)}`,
			placements: placements.map((p) => ({
				id: p.id,
				section: p.section,
				position: p.position,
				required: p.required,
				locked: p.locked,
				builtinRef: p.builtinRef,
				fieldId: p.fieldId,
				questionRule: p.questionRule,
				field: p.field
					? {
							id: p.field.id,
							name: p.field.name,
							type: p.field.type,
							maxLength: p.field.maxLength,
							options: p.field.options,
							scope: (p.field.organizationId ? "org" : "event") as
								| "org"
								| "event",
						}
					: null,
			})),
			libraryFields: libraryRows.map((f) => ({
				id: f.id,
				name: f.name,
				type: f.type,
				maxLength: f.maxLength,
				scope: (f.organizationId ? "org" : "event") as "org" | "event",
			})),
			ruleOptions,
			members,
			notify,
			counts,
			needsBuiltins,
			view,
			viewRows,
			viewPage,
			viewPages,
			viewTotal,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

async function nextPosition(
	db: Db,
	formId: string,
	section: SectionId,
): Promise<number> {
	const [row] = await db
		.select({ max: sql<number | null>`max(${formFields.position})` })
		.from(formFields)
		.where(and(eq(formFields.formId, formId), eq(formFields.section, section)));
	return (row?.max ?? -1) + 1;
}

type FormRowFull = typeof forms.$inferSelect;

async function handleSaveForm(
	db: Db,
	form: FormRowFull,
	event: { id: string; organizationId: string; timezone: string },
	fd: FormData,
): Promise<ActionResult> {
	const parsed = SaveForm.safeParse(Object.fromEntries(fd));
	if (!parsed.success) return zodErrors(parsed.error);
	const d = parsed.data;

	const notifyNew = [...new Set(fd.getAll("notifyNew").map(String))];
	const notifyUpdated = [...new Set(fd.getAll("notifyUpdated").map(String))];
	if (notifyNew.length || notifyUpdated.length) {
		const memberRows = await db
			.select({ userId: organizationMembers.userId })
			.from(organizationMembers)
			.where(eq(organizationMembers.organizationId, event.organizationId));
		const memberIds = new Set(memberRows.map((m) => m.userId));
		const stranger = [...notifyNew, ...notifyUpdated].find(
			(id) => !memberIds.has(id),
		);
		if (stranger) {
			return {
				formError:
					"Notification recipients must be members of this organization.",
			};
		}
	}

	const closeAt = d.closeDate
		? zonedTimeToUtc(d.closeDate, d.closeTime ?? "23:59", event.timezone)
		: null;

	// Sanitized at the WRITE boundary: the editor constrains well-behaved
	// browsers only — a forged POST must not store markup public pages render.
	const [welcomeHtml, sessionSectionHtml, participantSectionHtml, successHtml] =
		await Promise.all([
			sanitizeRichText(d.welcomeHtml),
			sanitizeRichText(d.sessionSectionHtml),
			sanitizeRichText(d.participantSectionHtml),
			sanitizeRichText(d.successHtml),
		]);

	await db
		.update(forms)
		.set({
			type: d.type,
			participantsStep: d.participantsStep,
			internalName: d.internalName,
			externalTitle: d.externalTitle,
			pageHeading: d.pageHeading,
			welcomeHtml: welcomeHtml || null,
			showWelcome: d.showWelcome,
			sessionSectionTitle: d.sessionSectionTitle || null,
			sessionSectionHtml: sessionSectionHtml || null,
			participantSectionTitle: d.participantSectionTitle || null,
			participantSectionHtml: participantSectionHtml || null,
			notifyExistingContacts: d.notifyExistingContacts,
			roleSpeakerMin: d.roleSpeakerMin,
			roleSpeakerMax: d.roleSpeakerMax,
			allowChairperson: d.allowChairperson,
			roleChairpersonMin: d.roleChairpersonMin,
			roleChairpersonMax: d.roleChairpersonMax,
			allowModerator: d.allowModerator,
			roleModeratorMin: d.roleModeratorMin,
			roleModeratorMax: d.roleModeratorMax,
			closeAt,
			sendReminders: d.sendReminders,
			submissionLimit: d.submissionLimit,
			allowMultipleDrafts: d.allowMultipleDrafts,
			autoRedirect: d.autoRedirect,
			successHtml: successHtml || null,
			sendConfirmationEmail: d.sendConfirmationEmail,
			config: {
				...(form.config ?? {}),
				notify: { newSubmission: notifyNew, updatedSubmission: notifyUpdated },
			},
			updatedAt: new Date(),
		})
		.where(eq(forms.id, form.id));
	track("form.saved", { formId: form.id, eventId: event.id });
	return { ok: "save-form" };
}

async function handleSetRule(
	db: Db,
	form: FormRowFull,
	event: { id: string },
	fd: FormData,
): Promise<ActionResult> {
	const parsed = z
		.object({
			formFieldId: z.string().min(1),
			trigger: z.string().min(1, "Pick a trigger question"),
			operator: z.enum(["equals", "not_equals", "gt", "lt"]),
			value: z.string().trim().min(1, "Pick a value"),
		})
		.safeParse(Object.fromEntries(fd));
	if (!parsed.success) return zodErrors(parsed.error);
	const { formFieldId, trigger, operator, value } = parsed.data;

	const siblings = await db.query.formFields.findMany({
		where: eq(formFields.formId, form.id),
		with: { field: true },
	});
	const target = siblings.find((s) => s.id === formFieldId);
	if (!target) return { formError: "Question not found." };
	if (target.locked) return { formError: "Locked questions are always shown." };

	// Resolve the trigger into one shape, then run a single validation block —
	// the builtin/field branches must never drift apart.
	let resolved: {
		placement: (typeof siblings)[number] | undefined;
		self: boolean;
		valueKind: "options" | "number";
		validValues: string[];
		json: NonNullable<QuestionRule>["trigger"];
	};
	if (trigger.startsWith("builtin:")) {
		const ref = trigger.slice("builtin:".length) as BuiltinRef;
		if (!BUILTIN_META[ref]?.trigger)
			return { formError: "That question can’t drive a rule." };
		// Same options the builder's value picker offered — one source of truth.
		const options = await loadRuleOptions(db, event.id);
		resolved = {
			placement: siblings.find((s) => s.builtinRef === ref),
			self: target.builtinRef === ref,
			valueKind: "options",
			validValues: (options[ref] ?? []).map((o) => o.value),
			json: { kind: "builtin", ref },
		};
	} else if (trigger.startsWith("field:")) {
		const fieldId = trigger.slice("field:".length);
		const placement = siblings.find((s) => s.fieldId === fieldId);
		const type = placement?.field?.type;
		if (placement && !RULE_TRIGGER_FIELD_TYPES.some((t) => t === type))
			return {
				formError:
					"Rules can trigger on dropdown, checkbox or number questions.",
			};
		resolved = {
			placement,
			self: target.fieldId === fieldId,
			valueKind: type === "number" ? "number" : "options",
			validValues:
				type === "dropdown"
					? (placement?.field?.options ?? [])
					: type === "checkbox"
						? ["true", "false"]
						: [],
			json: { kind: "field", fieldId },
		};
	} else {
		return { formError: "Pick a trigger question." };
	}

	if (!resolved.placement)
		return { formError: "The trigger question must be on this form." };
	if (resolved.self) return { formError: "A question can’t depend on itself." };
	if (resolved.placement.section !== target.section)
		return {
			formError: "Rules can only depend on questions in the same step.",
		};
	if (resolved.valueKind === "number") {
		if (!questionRuleValueAvailable("number", [], value))
			return { formError: "Enter a number to compare against." };
	} else {
		if (operator !== "equals" && operator !== "not_equals")
			return { formError: "This trigger supports is / is not only." };
		if (!resolved.validValues.includes(value))
			return { formError: "Pick a value from the trigger’s options." };
	}
	const rule: QuestionRule = { trigger: resolved.json, operator, value };

	await db
		.update(formFields)
		.set({ questionRule: rule })
		.where(eq(formFields.id, target.id));
	track("form.rule_set", { formId: form.id, formFieldId: target.id });
	return { ok: "set-rule" };
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run parent loaders.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	// Widened to ActionResult so useFetcher<typeof action> sees ONE data shape.
	if (!event)
		return { formError: "No event is configured yet." } as ActionResult;
	const db = getDb(env);
	const fd = await request.formData();
	const intent = String(fd.get("intent") ?? "");

	if (params.formId === "new") {
		if (intent !== "create")
			throw data({ message: "Form not found" }, { status: 404 });
		const id = crypto.randomUUID();
		await db.batch([
			db.insert(forms).values({
				id,
				eventId: event.id,
				internalName: "Untitled form",
			}),
			...chunk(defaultBuiltinPlacements(id), 8).map((rows) =>
				db.insert(formFields).values(rows),
			),
		]);
		track("form.created", { formId: id, eventId: event.id });
		throw redirect(adminFormPath(id));
	}

	// Row-level tenancy: the form must belong to the ACTIVE event.
	const [form] = await db
		.select()
		.from(forms)
		.where(and(eq(forms.id, params.formId), eq(forms.eventId, event.id)))
		.limit(1);
	if (!form) throw data({ message: "Form not found" }, { status: 404 });

	const timings = createTimings();
	try {
		const result = await timings.time("db", async (): Promise<ActionResult> => {
			switch (intent) {
				case "save-form":
					return await handleSaveForm(db, form, event, fd);

				case "publish": {
					await db
						.update(forms)
						.set({ status: "open" })
						.where(eq(forms.id, form.id));
					track("form.published", { formId: form.id, eventId: event.id });
					return { ok: "publish" } satisfies ActionResult;
				}

				// One-click upgrade for forms minted before the builder (seed rows):
				// places the default built-ins and shifts existing custom questions
				// after them. Deterministic positions keep it idempotent.
				case "initialize-builtins": {
					const placements = await db
						.select()
						.from(formFields)
						.where(eq(formFields.formId, form.id))
						.orderBy(asc(formFields.position));
					if (placements.some((p) => p.builtinRef !== null))
						return { ok: "initialize-builtins" } satisfies ActionResult;
					const defaults = defaultBuiltinPlacements(form.id);
					const offsets: Record<SectionId, number> = {
						session: defaults.filter((d) => d.section === "session").length,
						participant: defaults.filter((d) => d.section === "participant")
							.length,
					};
					const shifts = (["session", "participant"] as const).flatMap(
						(section) =>
							placements
								.filter((p) => p.section === section)
								.map((p, i) =>
									db
										.update(formFields)
										.set({ position: offsets[section] + i })
										.where(eq(formFields.id, p.id)),
								),
					);
					const [firstChunk, ...restChunks] = chunk(defaults, 8).map((rows) =>
						db.insert(formFields).values(rows).onConflictDoNothing(),
					);
					if (firstChunk)
						await db.batch([firstChunk, ...restChunks, ...shifts]);
					track("form.builtins_initialized", { formId: form.id });
					return { ok: "initialize-builtins" } satisfies ActionResult;
				}

				case "duplicate": {
					const placements = await db.query.formFields.findMany({
						where: eq(formFields.formId, form.id),
						with: { field: true },
						orderBy: [asc(formFields.position)],
					});
					const copyId = crypto.randomUUID();
					// Layout rows (section headers/dividers) are per-use `fields` rows —
					// the copy mints FRESH ones; sharing them would make removing a
					// divider from either form silently delete it from the other.
					const layoutClones = placements.flatMap((p) =>
						p.field &&
						(p.field.type === "section_header" || p.field.type === "divider")
							? [
									{
										placementId: p.id,
										source: p.field,
										id: crypto.randomUUID(),
									},
								]
							: [],
					);
					const layoutIdByPlacement = new Map(
						layoutClones.map((c) => [c.placementId, c.id]),
					);
					// Spread the row so columns added later are copied automatically;
					// only identity/lifecycle columns are overridden (publicId omitted →
					// a fresh one is minted).
					const {
						id: _id,
						publicId: _publicId,
						status: _status,
						internalName,
						createdAt: _createdAt,
						updatedAt: _updatedAt,
						...carried
					} = form;
					await db.batch([
						db.insert(forms).values({
							...carried,
							id: copyId,
							status: "draft",
							internalName: `Copy of ${internalName}`,
						}),
						...chunk(layoutClones, 8).map((rows) =>
							db.insert(fields).values(
								rows.map((c) => ({
									id: c.id,
									eventId: c.source.eventId,
									organizationId: c.source.organizationId,
									name: c.source.name,
									type: c.source.type,
								})),
							),
						),
						...chunk(placements, 8).map((rows) =>
							db.insert(formFields).values(
								rows.map((p) => ({
									formId: copyId,
									fieldId: layoutIdByPlacement.get(p.id) ?? p.fieldId,
									builtinRef: p.builtinRef,
									section: p.section,
									position: p.position,
									required: p.required,
									locked: p.locked,
									questionRule: p.questionRule,
								})),
							),
						),
					]);
					track("form.duplicated", { formId: form.id, copyId });
					throw redirect("/admin/forms");
				}

				case "delete": {
					// Placements cascade; submissions keep their rows (form_id nulls
					// out). Layout rows are per-use `fields` rows — deleted with the
					// form or they'd pile up invisibly (the picker filters them out).
					const layoutRows = await db
						.select({ id: fields.id })
						.from(formFields)
						.innerJoin(fields, eq(fields.id, formFields.fieldId))
						.where(
							and(
								eq(formFields.formId, form.id),
								or(
									eq(fields.type, "section_header"),
									eq(fields.type, "divider"),
								),
							),
						);
					await db.batch([
						db.delete(forms).where(eq(forms.id, form.id)),
						...chunk(layoutRows, 40).map((rows) =>
							db.delete(fields).where(
								inArray(
									fields.id,
									rows.map((r) => r.id),
								),
							),
						),
					]);
					track("form.deleted", { formId: form.id, eventId: event.id });
					throw redirect("/admin/forms");
				}

				case "add-builtin": {
					const ref = String(fd.get("ref") ?? "") as BuiltinRef;
					const meta = BUILTIN_META[ref];
					if (!meta)
						return {
							formError: "Unknown built-in question.",
						} satisfies ActionResult;
					// Explicit duplicate check — a catch-all around the insert would
					// report transient DB failures as "already on this form".
					const [placed] = await db
						.select({ id: formFields.id })
						.from(formFields)
						.where(
							and(
								eq(formFields.formId, form.id),
								eq(formFields.builtinRef, ref),
							),
						)
						.limit(1);
					if (placed)
						return {
							formError: "That question is already on this form.",
						} satisfies ActionResult;
					const position = await nextPosition(db, form.id, meta.section);
					await db.insert(formFields).values({
						formId: form.id,
						builtinRef: ref,
						section: meta.section,
						position,
						required: meta.defaultRequired,
						locked: meta.locked,
					});
					track("form.question_added", { formId: form.id, builtin: ref });
					return { ok: "add-builtin" } satisfies ActionResult;
				}

				case "add-library": {
					const fieldId = String(fd.get("fieldId") ?? "");
					const section =
						fd.get("section") === "participant" ? "participant" : "session";
					// The picked id must pass the SAME scope predicate the picker uses —
					// never trust the client with a raw fields.id.
					const [field] = await db
						.select()
						.from(fields)
						.where(
							and(
								eq(fields.id, fieldId),
								fieldScopePredicate(event.id, event.organizationId),
							),
						)
						.limit(1);
					if (!field)
						return { formError: "Unknown field." } satisfies ActionResult;
					if (field.type === "section_header" || field.type === "divider")
						return {
							formError: "Layout elements are added from the Layout tab.",
						} satisfies ActionResult;
					const [placed] = await db
						.select({ id: formFields.id })
						.from(formFields)
						.where(
							and(
								eq(formFields.formId, form.id),
								eq(formFields.fieldId, fieldId),
							),
						)
						.limit(1);
					if (placed)
						return {
							formError: "That field is already on this form.",
						} satisfies ActionResult;
					const position = await nextPosition(db, form.id, section);
					await db.insert(formFields).values({
						formId: form.id,
						fieldId,
						section,
						position,
					});
					track("form.question_added", { formId: form.id, fieldId });
					return { ok: "add-library" } satisfies ActionResult;
				}

				case "create-field": {
					const parsed = CreateField.safeParse(Object.fromEntries(fd));
					if (!parsed.success) return zodErrors(parsed.error);
					const d = parsed.data;
					const options =
						d.type === "dropdown"
							? d.options
									.split(",")
									.map((o) => o.trim())
									.filter(Boolean)
							: null;
					if (d.type === "dropdown" && (options?.length ?? 0) === 0) {
						return {
							fieldErrors: {
								options: ["Add at least one option (comma-separated)"],
							},
						} satisfies ActionResult;
					}
					const hasLength =
						d.type === "text" || d.type === "textarea" || d.type === "wysiwyg";
					// Scope XOR: an event field sets eventId (organizationId NULL); an
					// org-wide field sets organizationId (eventId NULL). Never both.
					const scopeCols =
						d.scope === "event"
							? { eventId: event.id, organizationId: null }
							: { eventId: null, organizationId: event.organizationId };
					const fieldId = crypto.randomUUID();
					const position = await nextPosition(db, form.id, d.section);
					await db.batch([
						db.insert(fields).values({
							id: fieldId,
							...scopeCols,
							name: d.name,
							type: d.type,
							description: d.description || null,
							maxLength: hasLength ? d.maxLength : null,
							options,
						}),
						db.insert(formFields).values({
							formId: form.id,
							fieldId,
							section: d.section,
							position,
							required: d.required,
						}),
					]);
					track("form.field_created", {
						formId: form.id,
						fieldId,
						scope: d.scope,
						type: d.type,
					});
					return {
						ok: "create-field",
						created: fieldId,
					} satisfies ActionResult;
				}

				case "add-layout": {
					const kind = String(fd.get("kind") ?? "");
					if (kind !== "section_header" && kind !== "divider")
						return {
							formError: "Unknown layout element.",
						} satisfies ActionResult;
					const section =
						fd.get("section") === "participant" ? "participant" : "session";
					const label = String(fd.get("label") ?? "").trim();
					if (kind === "section_header" && !label)
						return {
							fieldErrors: { label: ["Give the section header a label"] },
						} satisfies ActionResult;
					if (label.length > 255)
						return {
							fieldErrors: { label: ["Keep the label under 255 characters"] },
						} satisfies ActionResult;
					const fieldId = crypto.randomUUID();
					const position = await nextPosition(db, form.id, section);
					await db.batch([
						db.insert(fields).values({
							id: fieldId,
							eventId: event.id,
							organizationId: null,
							name: kind === "divider" ? "Divider" : label,
							type: kind,
						}),
						db.insert(formFields).values({
							formId: form.id,
							fieldId,
							section,
							position,
						}),
					]);
					track("form.layout_added", { formId: form.id, kind });
					return { ok: "add-layout", created: fieldId } satisfies ActionResult;
				}

				case "remove-field": {
					const id = String(fd.get("formFieldId") ?? "");
					const siblings = await db.query.formFields.findMany({
						where: eq(formFields.formId, form.id),
						with: { field: true },
					});
					const row = siblings.find((s) => s.id === id);
					if (!row)
						return { formError: "Question not found." } satisfies ActionResult;
					if (row.locked)
						return {
							formError: "This question is locked and can’t be removed.",
						} satisfies ActionResult;
					// Rules that trigger on the removed question would silently never
					// fire — clear them in the same batch.
					const dependents = siblings.filter((s) => {
						const r = s.questionRule;
						if (!r) return false;
						return (
							(r.trigger.kind === "field" &&
								row.fieldId !== null &&
								r.trigger.fieldId === row.fieldId) ||
							(r.trigger.kind === "builtin" &&
								row.builtinRef !== null &&
								r.trigger.ref === row.builtinRef)
						);
					});
					const isLayout =
						row.field?.type === "section_header" ||
						row.field?.type === "divider";
					// Layout rows are per-use: deleting the placement also deletes the
					// backing fields row (cascade removes the placement).
					const first = isLayout
						? db.delete(fields).where(eq(fields.id, row.field?.id ?? ""))
						: db.delete(formFields).where(eq(formFields.id, row.id));
					await db.batch([
						first,
						...dependents.map((s) =>
							db
								.update(formFields)
								.set({ questionRule: null })
								.where(eq(formFields.id, s.id)),
						),
					]);
					track("form.question_removed", { formId: form.id, formFieldId: id });
					return { ok: "remove-field" } satisfies ActionResult;
				}

				case "set-required": {
					const id = String(fd.get("formFieldId") ?? "");
					const required = fd.get("required") === "true";
					const [row] = await db
						.select()
						.from(formFields)
						.where(and(eq(formFields.id, id), eq(formFields.formId, form.id)))
						.limit(1);
					if (!row)
						return { formError: "Question not found." } satisfies ActionResult;
					if (
						!required &&
						row.builtinRef &&
						BUILTIN_META[row.builtinRef].requiredLocked
					) {
						return {
							formError: "This question is always required.",
						} satisfies ActionResult;
					}
					await db
						.update(formFields)
						.set({ required })
						.where(eq(formFields.id, row.id));
					track("form.required_toggled", {
						formId: form.id,
						formFieldId: row.id,
						required,
					});
					return { ok: "set-required" } satisfies ActionResult;
				}

				case "reorder": {
					const section =
						fd.get("section") === "participant" ? "participant" : "session";
					const order = String(fd.get("order") ?? "")
						.split(",")
						.filter(Boolean);
					const rows = await db
						.select({ id: formFields.id })
						.from(formFields)
						.where(
							and(
								eq(formFields.formId, form.id),
								eq(formFields.section, section),
							),
						);
					const known = new Set(rows.map((r) => r.id));
					if (
						order.length !== rows.length ||
						order.some((id) => !known.has(id))
					) {
						return {
							formError: "The order didn’t match this form — reload and retry.",
						} satisfies ActionResult;
					}
					const [head, ...tail] = order.map((id, i) =>
						db
							.update(formFields)
							.set({ position: i })
							.where(eq(formFields.id, id)),
					);
					if (head) await db.batch([head, ...tail]);
					track("form.reordered", { formId: form.id, section });
					return { ok: "reorder" } satisfies ActionResult;
				}

				case "set-rule":
					return await handleSetRule(db, form, event, fd);

				case "clear-rule": {
					const id = String(fd.get("formFieldId") ?? "");
					const [row] = await db
						.select()
						.from(formFields)
						.where(and(eq(formFields.id, id), eq(formFields.formId, form.id)))
						.limit(1);
					if (!row)
						return { formError: "Question not found." } satisfies ActionResult;
					await db
						.update(formFields)
						.set({ questionRule: null })
						.where(eq(formFields.id, row.id));
					track("form.rule_cleared", { formId: form.id, formFieldId: id });
					return { ok: "clear-rule" } satisfies ActionResult;
				}

				default:
					return { formError: "Unknown action." } satisfies ActionResult;
			}
		});
		return data(result, {
			headers: { "Server-Timing": timings.header() },
		});
	} catch (error) {
		if (error instanceof Response) throw error;
		track("form.action_failed", {
			formId: form.id,
			intent,
			error: errorMessage(error),
		});
		return {
			formError: "Could not save that change — please try again.",
		} satisfies ActionResult;
	}
}

type LoaderData = Route.ComponentProps["loaderData"];
type Placement = LoaderData["placements"][number];
type RuleOptions = LoaderData["ruleOptions"];

type StepId =
	| "setup"
	| "welcome"
	| "session"
	| "participant"
	| "settings"
	| "notifications";

const FIELD_STEP: Record<string, StepId> = {
	type: "setup",
	participantsStep: "setup",
	internalName: "welcome",
	externalTitle: "welcome",
	pageHeading: "welcome",
	welcomeHtml: "welcome",
	sessionSectionTitle: "session",
	sessionSectionHtml: "session",
	participantSectionTitle: "participant",
	participantSectionHtml: "participant",
	notifyExistingContacts: "participant",
	roleSpeakerMin: "participant",
	roleSpeakerMax: "participant",
	roleChairpersonMin: "participant",
	roleChairpersonMax: "participant",
	roleModeratorMin: "participant",
	roleModeratorMax: "participant",
	closeDate: "settings",
	closeTime: "settings",
	submissionLimit: "settings",
};

const OPERATOR_LABEL: Record<string, string> = {
	equals: "is",
	not_equals: "is not",
	gt: "is greater than",
	lt: "is less than",
};

function placementView(p: Placement): {
	name: string;
	caption: string;
	kind: "builtin" | "field" | "layout";
	requiredLocked: boolean;
	scope: "org" | "event" | null;
} {
	if (p.builtinRef) {
		const meta = BUILTIN_META[p.builtinRef as BuiltinRef];
		return {
			name: meta.label,
			caption: meta.caption,
			kind: "builtin",
			requiredLocked: meta.requiredLocked,
			scope: null,
		};
	}
	const f = p.field;
	if (!f) {
		return {
			name: "Unknown question",
			caption: "",
			kind: "field",
			requiredLocked: false,
			scope: null,
		};
	}
	if (f.type === "section_header" || f.type === "divider") {
		return {
			name: f.type === "divider" ? "Divider" : f.name,
			caption: f.type === "divider" ? "Layout divider" : "Section header",
			kind: "layout",
			requiredLocked: false,
			scope: null,
		};
	}
	const bits = [FIELD_TYPE_LABEL[f.type] ?? f.type];
	if (f.maxLength) bits.push(`max ${f.maxLength.toLocaleString("en-US")}`);
	if (f.type === "dropdown") bits.push(`${(f.options ?? []).length} options`);
	return {
		name: f.name,
		caption: bits.join(" · "),
		kind: "field",
		requiredLocked: false,
		scope: f.scope,
	};
}

type TriggerChoice = {
	key: string;
	label: string;
	valueKind: "options" | "number";
	valueOptions: Array<{ value: string; label: string }>;
};

function triggerChoicesFor(
	target: Placement,
	siblings: Placement[],
	ruleOptions: RuleOptions,
): TriggerChoice[] {
	const out: TriggerChoice[] = [];
	for (const s of siblings) {
		if (s.id === target.id || s.section !== target.section) continue;
		if (s.builtinRef) {
			const meta = BUILTIN_META[s.builtinRef as BuiltinRef];
			if (!meta.trigger) continue;
			out.push({
				key: `builtin:${s.builtinRef}`,
				label: meta.label,
				valueKind: "options",
				valueOptions: ruleOptions[s.builtinRef] ?? [],
			});
		} else if (s.field) {
			if (s.field.type === "dropdown") {
				out.push({
					key: `field:${s.field.id}`,
					label: s.field.name,
					valueKind: "options",
					valueOptions: (s.field.options ?? []).map((o) => ({
						value: o,
						label: o,
					})),
				});
			} else if (s.field.type === "checkbox") {
				out.push({
					key: `field:${s.field.id}`,
					label: s.field.name,
					valueKind: "options",
					valueOptions: [
						{ value: "true", label: "Checked" },
						{ value: "false", label: "Unchecked" },
					],
				});
			} else if (s.field.type === "number") {
				out.push({
					key: `field:${s.field.id}`,
					label: s.field.name,
					valueKind: "number",
					valueOptions: [],
				});
			}
		}
	}
	return out;
}

function ruleSummary(
	rule: Placement["questionRule"],
	siblings: Placement[],
	ruleOptions: RuleOptions,
): string | null {
	if (!rule) return null;
	let label: string;
	let valueLabel = rule.value;
	if (rule.trigger.kind === "builtin") {
		label =
			BUILTIN_META[rule.trigger.ref as BuiltinRef]?.label ?? rule.trigger.ref;
		const opt = (ruleOptions[rule.trigger.ref] ?? []).find(
			(o) => o.value === rule.value,
		);
		if (opt) valueLabel = opt.label;
	} else {
		const fieldId = rule.trigger.fieldId;
		const s = siblings.find((x) => x.fieldId === fieldId);
		label = s?.field?.name ?? "a removed question";
		if (s?.field?.type === "checkbox")
			valueLabel = rule.value === "true" ? "checked" : "unchecked";
	}
	return `${label} ${OPERATOR_LABEL[rule.operator] ?? rule.operator} “${valueLabel}”`;
}

function FormTabs({
	formId,
	active,
	counts,
}: {
	formId: string;
	active: "builder" | "results" | "drafts";
	counts: { submissions: number; drafts: number };
}) {
	return (
		<Tabs>
			<Tab to={adminFormPath(formId)} active={active === "builder"}>
				Builder
			</Tab>
			<Tab
				to={`${adminFormPath(formId)}?view=results`}
				active={active === "results"}
				count={counts.submissions}
			>
				Results
			</Tab>
			<Tab
				to={`${adminFormPath(formId)}?view=drafts`}
				active={active === "drafts"}
				count={counts.drafts}
			>
				Draft submissions
			</Tab>
		</Tabs>
	);
}

// Builder rich-text fields render OUTSIDE the <form id="builder-form"> —
// the canonical editor's hidden input reattaches via the `form` attribute.
function RichText({
	label,
	name,
	defaultValue,
}: {
	label: string;
	name: string;
	defaultValue: string;
}) {
	return (
		<Field label={label} composite>
			<RichTextInput
				name={name}
				form="builder-form"
				defaultValue={defaultValue}
				ariaLabel={label}
			/>
		</Field>
	);
}

function OnOffSelect({
	label,
	name,
	defaultOn,
}: {
	label: string;
	name: string;
	defaultOn: boolean;
}) {
	const busy = useBusy();
	return (
		<Field label={label}>
			<Select
				name={name}
				defaultValue={defaultOn ? "true" : "false"}
				disabled={busy}
				form="builder-form"
			>
				<option value="true">On</option>
				<option value="false">Off</option>
			</Select>
		</Field>
	);
}

function MemberPicker({
	label,
	name,
	members,
	initial,
}: {
	label: string;
	name: string;
	members: LoaderData["members"];
	initial: string[];
}) {
	const [selected, setSelected] = useState<string[]>(initial);
	const busy = useBusy();
	return (
		<div className="flex flex-col gap-[5px]">
			<Field label={label}>
				<span>
					{selected.length === 0
						? "No one is notified."
						: `${selected.length} ${selected.length === 1 ? "recipient" : "recipients"} selected.`}
				</span>
			</Field>
			<div className="flex flex-wrap gap-2">
				{members.map((m) => {
					const on = selected.includes(m.id);
					return (
						<Button
							key={m.id}
							type="button"
							variant={on ? "primary" : "ghost"}
							aria-pressed={on}
							disabled={busy}
							onClick={() =>
								setSelected((prev) =>
									on ? prev.filter((id) => id !== m.id) : [...prev, m.id],
								)
							}
						>
							{m.name ?? m.email}
						</Button>
					);
				})}
			</div>
			{selected.map((id) => (
				<Input
					key={id}
					type="hidden"
					name={name}
					value={id}
					readOnly
					form="builder-form"
				/>
			))}
		</div>
	);
}

function FieldRow({
	placement,
	siblings,
	ruleOptions,
	isRuleOpen,
	onToggleRule,
}: {
	placement: Placement;
	siblings: Placement[];
	ruleOptions: RuleOptions;
	isRuleOpen: boolean;
	onToggleRule: () => void;
}) {
	const view = placementView(placement);
	const fetcher = useFetcher<typeof action>();
	const busy = useBusy();
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id: placement.id, disabled: busy });
	// Drag GEOMETRY only (transform/transition) — dnd-kit cannot move the row
	// without it. Visual drag styling (dim/elevate) is a skin decision a route
	// must not make.
	const rowRef = (node: HTMLDivElement | null) => {
		setNodeRef(node);
		if (node) {
			node.style.transform = CSS.Transform.toString(transform) ?? "";
			node.style.transition = transition ?? "";
		}
	};
	// Optimistic toggle: the same `boolish` the action parses it with, so the
	// row can never show a state the server would have rejected.
	const pendingRequired = fetcher.formData?.get("required");
	const required =
		boolish.safeParse(pendingRequired).data ?? placement.required;
	const summary = ruleSummary(placement.questionRule, siblings, ruleOptions);
	const missingOptions = placementMissingOptions(placement, ruleOptions);
	return (
		<div ref={rowRef} className="flex flex-col gap-2 py-[7px]">
			<div className="flex flex-wrap items-center gap-3">
				<span
					{...attributes}
					{...listeners}
					aria-label={`Drag to reorder ${view.name}`}
					className="flex h-[34px] w-[22px] shrink-0 cursor-grab items-center justify-center"
				>
					<Icon name="sort" size={14} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<strong>{view.name}</strong>
						{placement.locked && <StatusBadge tone="faint">Locked</StatusBadge>}
						{view.scope === "org" && (
							<StatusBadge tone="info">Org-wide</StatusBadge>
						)}
						{missingOptions && (
							<StatusBadge tone="warning">No options yet</StatusBadge>
						)}
					</div>
					<p>
						{view.caption}
						{summary ? ` · Shown when ${summary}` : ""}
						{missingOptions
							? " · Hidden from the public form until options are added in Settings → Library"
							: ""}
					</p>
				</div>
				{view.kind !== "layout" && (
					<Select
						aria-label={`Required: ${view.name}`}
						value={required ? "true" : "false"}
						disabled={view.requiredLocked || busy}
						onChange={(e) =>
							fetcher.submit(
								{
									intent: "set-required",
									formFieldId: placement.id,
									required: e.target.value,
								},
								{ method: "post" },
							)
						}
					>
						<option value="false">Optional</option>
						<option value="true">Required</option>
					</Select>
				)}
				{view.kind !== "layout" && !placement.locked && (
					<Button type="button" variant="ghost" onClick={onToggleRule}>
						{placement.questionRule ? "Edit rule" : "Rules"}
					</Button>
				)}
				{!placement.locked && (
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={() =>
							fetcher.submit(
								{ intent: "remove-field", formFieldId: placement.id },
								{ method: "post" },
							)
						}
					>
						Remove
					</Button>
				)}
			</div>
			{fetcher.data?.formError && (
				<ErrorText>{fetcher.data.formError}</ErrorText>
			)}
			{isRuleOpen && (
				<RuleEditor
					placement={placement}
					siblings={siblings}
					ruleOptions={ruleOptions}
					onClose={onToggleRule}
				/>
			)}
		</div>
	);
}

function RuleEditor({
	placement,
	siblings,
	ruleOptions,
	onClose,
}: {
	placement: Placement;
	siblings: Placement[];
	ruleOptions: RuleOptions;
	onClose: () => void;
}) {
	const fetcher = useFetcher<typeof action>();
	const busy = useBusy();
	const rule = placement.questionRule;
	const [trigger, setTrigger] = useState(
		rule
			? rule.trigger.kind === "builtin"
				? `builtin:${rule.trigger.ref}`
				: `field:${rule.trigger.fieldId}`
			: "",
	);
	const [operator, setOperator] = useState<string>(rule?.operator ?? "equals");
	const [value, setValue] = useState(rule?.value ?? "");
	const choices = triggerChoicesFor(placement, siblings, ruleOptions);
	const chosen = choices.find((c) => c.key === trigger);
	const operators =
		chosen?.valueKind === "number"
			? ["equals", "not_equals", "gt", "lt"]
			: ["equals", "not_equals"];
	const valuesMissing =
		chosen?.valueKind === "options" && chosen.valueOptions.length === 0;
	const valueAvailable = chosen
		? questionRuleValueAvailable(chosen.valueKind, chosen.valueOptions, value)
		: false;
	if (choices.length === 0) {
		return (
			<Panel>
				<p>
					No eligible trigger questions on this step yet — rules can trigger on
					dropdown, checkbox or number questions.
				</p>
				<Button type="button" variant="ghost" onClick={onClose}>
					Close
				</Button>
			</Panel>
		);
	}
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<strong>Show “{placementView(placement).name}” only when…</strong>
				<div className="flex flex-wrap items-end gap-3">
					<Field label="Trigger question">
						<Select
							value={trigger}
							disabled={busy}
							onChange={(e) => {
								setTrigger(e.target.value);
								setValue("");
								setOperator("equals");
							}}
						>
							<option value="">Choose a question…</option>
							{choices.map((c) => (
								<option key={c.key} value={c.key}>
									{c.label}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Condition">
						<Select
							value={operator}
							disabled={busy}
							onChange={(e) => setOperator(e.target.value)}
						>
							{operators.map((op) => (
								<option key={op} value={op}>
									{OPERATOR_LABEL[op]}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Value">
						{chosen?.valueKind === "number" ? (
							<Input
								type="number"
								value={value}
								onChange={(e) => setValue(e.target.value)}
							/>
						) : (
							<Select
								value={value}
								disabled={busy || !chosen || valuesMissing}
								onChange={(e) => setValue(e.target.value)}
							>
								<option value="">
									{valuesMissing ? "No values yet" : "Choose a value…"}
								</option>
								{(chosen?.valueOptions ?? []).map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</Select>
						)}
					</Field>
					<Button
						type="button"
						disabled={ruleApplyDisabled(busy, trigger, valueAvailable)}
						onClick={() =>
							fetcher.submit(
								{
									intent: "set-rule",
									formFieldId: placement.id,
									trigger,
									operator,
									value,
								},
								{ method: "post" },
							)
						}
					>
						Apply rule
					</Button>
					{rule && (
						<Button
							type="button"
							variant="ghost"
							disabled={busy}
							onClick={() =>
								fetcher.submit(
									{ intent: "clear-rule", formFieldId: placement.id },
									{ method: "post" },
								)
							}
						>
							Remove rule
						</Button>
					)}
					<Button type="button" variant="ghost" onClick={onClose}>
						Close
					</Button>
				</div>
				{valuesMissing && chosen && (
					<p>
						“{chosen.label}” has no options yet — add them in the{" "}
						<TextLink to="/admin/settings/library">Library</TextLink> to build a
						rule on it.
					</p>
				)}
				{fetcher.data?.formError && (
					<ErrorText>{fetcher.data.formError}</ErrorText>
				)}
				{fetcher.data?.fieldErrors &&
					Object.values(fetcher.data.fieldErrors)
						.flat()
						.slice(0, 1)
						.map((msg) => <ErrorText key={msg}>{msg}</ErrorText>)}
			</div>
		</Panel>
	);
}

function FieldList({
	section,
	placements,
	ruleOptions,
}: {
	section: SectionId;
	placements: Placement[];
	ruleOptions: RuleOptions;
}) {
	const rows = placements.filter((p) => p.section === section);
	const [openRule, setOpenRule] = useState<string | null>(null);
	const reorderFetcher = useFetcher<typeof action>();
	const busy = useBusy();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	// Optimistic order derives from the in-flight submission (like FieldRow's
	// required toggle) — no state to reconcile once the loader catches up.
	const pendingOrder = z
		.string()
		.safeParse(reorderFetcher.formData?.get("order")).data;
	const ordered = useMemo(() => {
		if (pendingOrder === undefined) return rows;
		const byId = new Map(rows.map((r) => [r.id, r]));
		const kept = pendingOrder
			.split(",")
			.flatMap((id) => byId.get(id) ?? [])
			.map((r) => r as Placement);
		const known = new Set(pendingOrder.split(","));
		return [...kept, ...rows.filter((r) => !known.has(r.id))];
	}, [rows, pendingOrder]);

	return (
		<Panel>
			<DndContext
				// Stable id: the default is a module-level counter that drifts
				// between SSR requests → aria-describedby hydration mismatches.
				id={`dnd-${section}`}
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={({ active, over }) => {
					if (busy || !over || active.id === over.id) return;
					const ids = ordered.map((r) => r.id);
					const next = arrayMove(
						ids,
						ids.indexOf(String(active.id)),
						ids.indexOf(String(over.id)),
					);
					reorderFetcher.submit(
						{ intent: "reorder", section, order: next.join(",") },
						{ method: "post" },
					);
				}}
			>
				<SortableContext
					items={ordered.map((r) => r.id)}
					strategy={verticalListSortingStrategy}
				>
					<div className="flex flex-col">
						{ordered.map((p) => (
							<FieldRow
								key={p.id}
								placement={p}
								siblings={ordered}
								ruleOptions={ruleOptions}
								isRuleOpen={openRule === p.id}
								onToggleRule={() =>
									setOpenRule((cur) => (cur === p.id ? null : p.id))
								}
							/>
						))}
						{ordered.length === 0 && (
							<EmptyState
								icon="sliders"
								title="No questions yet"
								body="Add questions below — from the field library, a brand-new field, or a built-in question."
							/>
						)}
					</div>
				</SortableContext>
			</DndContext>
			{reorderFetcher.data?.formError && (
				<ErrorText>{reorderFetcher.data.formError}</ErrorText>
			)}
		</Panel>
	);
}

function LibraryPicker({
	section,
	formPath,
	initial,
	placedFieldIds,
}: {
	section: SectionId;
	formPath: string;
	initial: LoaderData["libraryFields"];
	placedFieldIds: Set<string>;
}) {
	const search = useFetcher<typeof loader>();
	const add = useFetcher<typeof action>();
	const busy = useBusy();
	const [q, setQ] = useState("");
	useEffect(() => {
		if (!q.trim()) return;
		const t = setTimeout(() => {
			search.load(`${formPath}?pickerQ=${encodeURIComponent(q.trim())}`);
		}, 250);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `search` is a stable fetcher; depending on it would re-arm the timer after every load
	}, [q, formPath]);
	const results = q.trim() ? (search.data?.libraryFields ?? []) : initial;
	return (
		<div className="flex flex-col gap-2">
			<SearchInput
				placeholder="Search the field library…"
				value={q}
				onChange={(e) => setQ(e.target.value)}
				aria-label="Search the field library"
			/>
			{results.length === 0 ? (
				<EmptyState
					icon="search"
					title={q.trim() ? "No fields match" : "The field library is empty"}
					body={
						q.trim()
							? `Nothing named “${q.trim()}” — try another search, or create a new field.`
							: "Create a new field instead — it lands in the library for reuse across forms."
					}
				/>
			) : (
				results.map((f) => {
					const placed = placedFieldIds.has(f.id);
					return (
						<div key={f.id} className="flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<strong>{f.name}</strong>{" "}
								<span>
									· {FIELD_TYPE_LABEL[f.type] ?? f.type}
									{f.scope === "org" ? " · Org-wide" : ""}
								</span>
							</div>
							<Button
								type="button"
								variant="ghost"
								disabled={placed || busy}
								onClick={() =>
									add.submit(
										{ intent: "add-library", fieldId: f.id, section },
										{ method: "post", action: formPath },
									)
								}
							>
								{placed ? "Added" : "Add"}
							</Button>
						</div>
					);
				})
			)}
			{add.data?.formError && <ErrorText>{add.data.formError}</ErrorText>}
		</div>
	);
}

function CreateFieldPanel({
	section,
	formPath,
}: {
	section: SectionId;
	formPath: string;
}) {
	const fetcher = useFetcher<typeof action>();
	const busy = useBusy();
	const [type, setType] = useState<string>("text");
	const errors = fetcher.data?.fieldErrors;
	const hasLength =
		type === "text" || type === "textarea" || type === "wysiwyg";
	// Inline slots exist only for the inputs the CURRENT type renders. Any
	// other rejection (schema drift, hidden inputs) must still surface —
	// a 200 whose errors nobody renders is a silent no-op.
	const slottedKeys = new Set([
		"name",
		"description",
		...(hasLength ? ["maxLength"] : []),
		...(type === "dropdown" ? ["options"] : []),
	]);
	const strayErrors = Object.entries(errors ?? {}).flatMap(([key, messages]) =>
		!slottedKeys.has(key) && messages?.[0] ? [`${key}: ${messages[0]}`] : [],
	);
	return (
		<fetcher.Form
			key={fetcher.data?.created ?? "new"}
			method="post"
			action={formPath}
			className="flex flex-wrap items-end gap-3"
		>
			<Input type="hidden" name="intent" value="create-field" readOnly />
			<Input type="hidden" name="section" value={section} readOnly />
			<Field label="Name" error={errors?.name?.[0]}>
				<Input name="name" invalid={Boolean(errors?.name?.[0])} />
			</Field>
			<Field label="Type">
				<Select
					name="type"
					value={type}
					disabled={busy}
					onChange={(e) => setType(e.target.value)}
				>
					{CREATE_FIELD_TYPES.map((t) => (
						<option key={t} value={t}>
							{FIELD_TYPE_LABEL[t]}
						</option>
					))}
				</Select>
			</Field>
			{hasLength && (
				<Field label="Maximum length" error={errors?.maxLength?.[0]}>
					<Input name="maxLength" type="number" min={1} max={5000} />
				</Field>
			)}
			{type === "dropdown" && (
				<Field label="Options (comma-separated)" error={errors?.options?.[0]}>
					<Input
						name="options"
						placeholder="Beginner, Intermediate, Advanced"
						invalid={Boolean(errors?.options?.[0])}
					/>
				</Field>
			)}
			<Field label="Internal description" error={errors?.description?.[0]}>
				<Input name="description" />
			</Field>
			<Field label="Scope">
				<Select name="scope" defaultValue="event" disabled={busy}>
					<option value="event">This event only</option>
					<option value="org">Organization-wide</option>
				</Select>
			</Field>
			<Field label="Required">
				<Select name="required" defaultValue="false" disabled={busy}>
					<option value="false">Optional</option>
					<option value="true">Required</option>
				</Select>
			</Field>
			<Button type="submit" disabled={busy}>
				Add field
			</Button>
			{fetcher.data?.formError && (
				<ErrorText>{fetcher.data.formError}</ErrorText>
			)}
			{strayErrors.length > 0 && (
				<ErrorText>Couldn’t add the field — {strayErrors.join("; ")}</ErrorText>
			)}
		</fetcher.Form>
	);
}

function AddQuestion({
	section,
	formPath,
	placements,
	initialLibrary,
}: {
	section: SectionId;
	formPath: string;
	placements: Placement[];
	initialLibrary: LoaderData["libraryFields"];
}) {
	const [mode, setMode] = useState<
		"library" | "create" | "builtin" | "layout" | null
	>(null);
	const builtinFetcher = useFetcher<typeof action>();
	const layoutFetcher = useFetcher<typeof action>();
	const busy = useBusy();
	const placedRefs = new Set(
		placements.filter((p) => p.builtinRef).map((p) => p.builtinRef),
	);
	const placedFieldIds = new Set(
		placements.flatMap((p) => (p.fieldId ? [p.fieldId] : [])),
	);
	const unusedBuiltins = BUILTIN_ORDER.filter(
		(ref) => BUILTIN_META[ref].section === section && !placedRefs.has(ref),
	);
	const toggle = (m: typeof mode) => setMode((cur) => (cur === m ? null : m));
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<strong>Add a question</strong>
					<Button
						type="button"
						variant={mode === "library" ? "primary" : "ghost"}
						icon="search"
						onClick={() => toggle("library")}
					>
						From field library
					</Button>
					<Button
						type="button"
						variant={mode === "create" ? "primary" : "ghost"}
						icon="plus"
						onClick={() => toggle("create")}
					>
						Create new field
					</Button>
					<Button
						type="button"
						variant={mode === "builtin" ? "primary" : "ghost"}
						onClick={() => toggle("builtin")}
					>
						Built-in question
					</Button>
					<Button
						type="button"
						variant={mode === "layout" ? "primary" : "ghost"}
						onClick={() => toggle("layout")}
					>
						Section header / divider
					</Button>
				</div>
				{mode === "library" && (
					<LibraryPicker
						section={section}
						formPath={formPath}
						initial={initialLibrary}
						placedFieldIds={placedFieldIds}
					/>
				)}
				{mode === "create" && (
					<CreateFieldPanel section={section} formPath={formPath} />
				)}
				{mode === "builtin" &&
					(unusedBuiltins.length === 0 ? (
						<p>Every built-in question for this step is already placed.</p>
					) : (
						<builtinFetcher.Form
							method="post"
							action={formPath}
							className="flex flex-wrap items-end gap-3"
						>
							<Input type="hidden" name="intent" value="add-builtin" readOnly />
							<Field label="Built-in question">
								<Select name="ref" disabled={busy}>
									{unusedBuiltins.map((ref) => (
										<option key={ref} value={ref}>
											{BUILTIN_META[ref].label}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit" disabled={busy}>
								Add question
							</Button>
							{builtinFetcher.data?.formError && (
								<ErrorText>{builtinFetcher.data.formError}</ErrorText>
							)}
						</builtinFetcher.Form>
					))}
				{mode === "layout" && (
					<layoutFetcher.Form
						key={layoutFetcher.data?.created ?? "new"}
						method="post"
						action={formPath}
						className="flex flex-wrap items-end gap-3"
					>
						<Input type="hidden" name="intent" value="add-layout" readOnly />
						<Input type="hidden" name="section" value={section} readOnly />
						<Field
							label="Section header label"
							error={layoutFetcher.data?.fieldErrors?.label?.[0]}
						>
							<Input name="label" />
						</Field>
						<Button
							type="submit"
							name="kind"
							value="section_header"
							disabled={busy}
						>
							Add section header
						</Button>
						<Button
							type="submit"
							name="kind"
							value="divider"
							variant="ghost"
							disabled={busy}
						>
							Add divider
						</Button>
						{layoutFetcher.data?.formError && (
							<ErrorText>{layoutFetcher.data.formError}</ErrorText>
						)}
					</layoutFetcher.Form>
				)}
			</div>
		</Panel>
	);
}

function RoleConfig({
	form,
	errors,
}: {
	form: LoaderData["form"];
	errors: Record<string, string[]> | undefined;
}) {
	const roles = [
		{
			label: "Speaker",
			minName: "roleSpeakerMin",
			maxName: "roleSpeakerMax",
			allowName: null,
			allowOn: true,
			min: form.roleSpeakerMin,
			max: form.roleSpeakerMax,
		},
		{
			label: "Chairperson",
			minName: "roleChairpersonMin",
			maxName: "roleChairpersonMax",
			allowName: "allowChairperson",
			allowOn: form.allowChairperson,
			min: form.roleChairpersonMin,
			max: form.roleChairpersonMax,
		},
		{
			label: "Moderator",
			minName: "roleModeratorMin",
			maxName: "roleModeratorMax",
			allowName: "allowModerator",
			allowOn: form.allowModerator,
			min: form.roleModeratorMin,
			max: form.roleModeratorMax,
		},
	];
	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<strong>Participant roles</strong>
				<p>
					How many people can be added per submission. Speakers default to a
					minimum of 1 — raise it only if every session truly needs more.
				</p>
				{roles.map((role) => (
					<div key={role.label} className="flex flex-wrap items-end gap-3">
						{role.allowName && (
							<OnOffSelect
								label={`${role.label} role`}
								name={role.allowName}
								defaultOn={role.allowOn}
							/>
						)}
						<Field
							label={`${role.label} minimum`}
							error={errors?.[role.minName]?.[0]}
						>
							<Input
								name={role.minName}
								type="number"
								min={0}
								max={50}
								defaultValue={role.min}
								form="builder-form"
								invalid={Boolean(errors?.[role.minName]?.[0])}
							/>
						</Field>
						<Field
							label={`${role.label} maximum`}
							error={errors?.[role.maxName]?.[0]}
						>
							<Input
								name={role.maxName}
								type="number"
								min={1}
								max={50}
								defaultValue={role.max ?? ""}
								placeholder="No limit"
								form="builder-form"
							/>
						</Field>
					</div>
				))}
			</div>
		</Panel>
	);
}

function SubmissionsView({ data: d }: { data: LoaderData }) {
	const rows = d.viewRows ?? [];
	const drafts = d.view === "drafts";
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<div>
				<TextLink to="/admin/forms">← Back to forms</TextLink>
			</div>
			<PageHeader
				title={d.form.internalName}
				count={`${d.viewTotal} ${drafts ? "drafts" : "results"}`}
				subtitle={
					drafts
						? "Draft submissions saved against this form but not yet submitted."
						: "Submissions received through this form."
				}
			/>
			<FormTabs
				formId={d.form.id}
				active={drafts ? "drafts" : "results"}
				counts={d.counts}
			/>
			<Table>
				<THead>
					<Th>Title</Th>
					<Th>Status</Th>
					<Th>Submitted</Th>
				</THead>
				<TBody>
					{rows.map((s) => (
						<Tr key={s.id}>
							<Td kind="strong">{s.title}</Td>
							<Td>
								<StatusBadge tone={SUBMISSION_STATUS_TONE[s.status]}>
									{s.status.replace("_", " ")}
								</StatusBadge>
							</Td>
							<Td kind="mono">{s.createdLabel}</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={3}>
							{drafts
								? "No draft submissions — drafts appear here when submitters save without finishing."
								: "No submissions yet — share the public link and results will land here."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<PaginationBar
				page={d.viewPage}
				pages={d.viewPages}
				total={d.viewTotal}
				hrefFor={(p) => `${adminFormPath(d.form.id)}?view=${d.view}&page=${p}`}
			/>
		</div>
	);
}

export default function FormEditor({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	if (loaderData.view) return <SubmissionsView data={loaderData} />;
	return (
		<Builder
			key={loaderData.form.id}
			data={loaderData}
			actionData={actionData}
		/>
	);
}

function Builder({
	data: d,
	actionData,
}: {
	data: LoaderData;
	actionData: ActionResult | undefined;
}) {
	const [step, setStep] = useState<StepId>("setup");
	const [formType, setFormType] = useState(d.form.type);
	const navigation = useNavigation();
	const busy = useBusy();
	const savingForm =
		navigation.state !== "idle" &&
		navigation.formData?.get("intent") === "save-form";
	const errors = actionData?.fieldErrors;

	// Jump to the step carrying the first validation error (adjust-during-render
	// pattern — reacting to new actionData, not an external system).
	const [seenErrors, setSeenErrors] = useState(errors);
	if (errors !== seenErrors) {
		setSeenErrors(errors);
		const firstKey = errors
			? Object.keys(errors).find((k) => FIELD_STEP[k])
			: undefined;
		const target = firstKey ? FIELD_STEP[firstKey] : undefined;
		if (target) setStep(target);
	}

	const formPath = adminFormPath(d.form.id);
	const steps: Array<{ id: StepId; label: string }> = [
		{ id: "setup", label: "Submission Setup" },
		{ id: "welcome", label: "Welcome Screen" },
		{
			id: "session",
			label:
				formType === "abstract"
					? "Abstract Information"
					: "Session Information",
		},
		{ id: "participant", label: "Participant Information" },
		{ id: "settings", label: "Form Settings" },
		{ id: "notifications", label: "Notifications" },
	];
	const stepIndex = steps.findIndex((s) => s.id === step);

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<div>
				<TextLink to="/admin/forms">← Back to forms</TextLink>
			</div>
			<PageHeader
				title={d.form.internalName}
				subtitle={
					d.form.status === "open"
						? "This form is live — the public link accepts visitors."
						: d.form.status === "draft"
							? "Draft — publish to make the public link live."
							: "Closed — visitors see a closed message at the public link."
				}
				actions={
					<>
						<StatusBadge tone={FORM_STATUS_TONE[d.form.status] ?? "neutral"}>
							{d.form.status}
						</StatusBadge>
						{d.form.status !== "open" && (
							<Form method="post">
								<Input type="hidden" name="intent" value="publish" readOnly />
								<Button type="submit" variant="ghost" disabled={busy}>
									Publish
								</Button>
							</Form>
						)}
						{actionData?.ok === "save-form" && !savingForm && (
							<span aria-live="polite">Saved</span>
						)}
						<Button form="builder-form" type="submit" disabled={busy}>
							{savingForm ? "Saving…" : "Save"}
						</Button>
					</>
				}
			/>

			<Panel>
				<div className="flex flex-wrap items-end gap-3">
					<div className="min-w-0 flex-1">
						<Field label="Public link">
							<Input
								readOnly
								value={d.publicUrl}
								aria-label="Public form link"
							/>
						</Field>
					</div>
					<CopyButton
						value={d.publicUrl}
						label="Copy link"
						failedLabel="Copy failed — select the link"
					/>
					<ButtonLink variant="ghost" to={d.publicUrl}>
						View form
					</ButtonLink>
				</div>
			</Panel>

			<FormTabs formId={d.form.id} active="builder" counts={d.counts} />

			<Form method="post" id="builder-form">
				<Input type="hidden" name="intent" value="save-form" readOnly />
				<Input type="hidden" name="type" value={formType} readOnly />
			</Form>
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}

			{d.needsBuiltins && (
				<Panel>
					<div className="flex flex-wrap items-center gap-4">
						<div className="min-w-0 flex-1">
							<strong>Set up the built-in questions</strong>
							<p>
								This form predates the builder, so Title, Description, the
								session dropdowns and the participant identity fields aren’t
								configurable yet. One click places them — existing custom
								questions keep their order right after.
							</p>
						</div>
						<Form method="post">
							<Input
								type="hidden"
								name="intent"
								value="initialize-builtins"
								readOnly
							/>
							<Button type="submit" disabled={busy}>
								Set up built-in questions
							</Button>
						</Form>
					</div>
				</Panel>
			)}

			<div className="flex flex-col gap-6 md:flex-row">
				<nav
					aria-label="Builder steps"
					className="flex w-full shrink-0 flex-row flex-wrap gap-2 md:w-64 md:flex-col"
				>
					{steps.map((s, i) => (
						<Button
							key={s.id}
							type="button"
							variant={step === s.id ? "primary" : "ghost"}
							aria-current={step === s.id ? "step" : undefined}
							onClick={() => setStep(s.id)}
						>
							{i + 1}. {s.label}
						</Button>
					))}
				</nav>

				<div className="min-w-0 flex-1">
					<div hidden={step !== "setup"}>
						<div className="flex flex-col gap-4">
							<Panel>
								<div className="flex flex-col gap-3">
									<strong>
										What kind of submissions do you want to collect?
									</strong>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant={formType === "abstract" ? "primary" : "ghost"}
											aria-pressed={formType === "abstract"}
											disabled={busy}
											onClick={() => setFormType("abstract")}
										>
											Abstracts
										</Button>
										<Button
											type="button"
											variant={formType === "session" ? "primary" : "ghost"}
											aria-pressed={formType === "session"}
											disabled={busy}
											onClick={() => setFormType("session")}
										>
											Sessions
										</Button>
									</div>
									<p>
										{formType === "abstract"
											? "Collect abstract submissions for review before sessions are finalized."
											: "Collect full session proposals with details for your program."}
									</p>
									<OnOffSelect
										label="Participants step (collect speaker contact information)"
										name="participantsStep"
										defaultOn={d.form.participantsStep}
									/>
									<p>You can adjust these choices later.</p>
								</div>
							</Panel>
						</div>
					</div>

					<div hidden={step !== "welcome"}>
						<div className="flex flex-col gap-4">
							<Panel>
								<div className="flex flex-col gap-4">
									<div className="flex flex-wrap items-end gap-3">
										<Field
											label="Internal form name"
											error={errors?.internalName?.[0]}
										>
											<Input
												name="internalName"
												defaultValue={d.form.internalName}
												maxLength={255}
												form="builder-form"
												invalid={Boolean(errors?.internalName?.[0])}
											/>
										</Field>
										<Field
											label="External form title"
											error={errors?.externalTitle?.[0]}
										>
											<Input
												name="externalTitle"
												defaultValue={d.form.externalTitle}
												maxLength={255}
												form="builder-form"
											/>
										</Field>
										<Field
											label="Page heading (15 characters max)"
											error={errors?.pageHeading?.[0]}
										>
											<Input
												name="pageHeading"
												defaultValue={d.form.pageHeading}
												maxLength={15}
												form="builder-form"
												invalid={Boolean(errors?.pageHeading?.[0])}
											/>
										</Field>
										<OnOffSelect
											label="Show welcome message"
											name="showWelcome"
											defaultOn={d.form.showWelcome}
										/>
									</div>
									<RichText
										label="Welcome message"
										name="welcomeHtml"
										defaultValue={d.form.welcomeHtml}
									/>
								</div>
							</Panel>
						</div>
					</div>

					<div hidden={step !== "session"}>
						<div className="flex flex-col gap-4">
							<Panel>
								<div className="flex flex-col gap-4">
									<Field
										label="Section title"
										error={errors?.sessionSectionTitle?.[0]}
									>
										<Input
											name="sessionSectionTitle"
											defaultValue={d.form.sessionSectionTitle}
											maxLength={255}
											form="builder-form"
										/>
									</Field>
									<RichText
										label="Description & instructions"
										name="sessionSectionHtml"
										defaultValue={d.form.sessionSectionHtml}
									/>
								</div>
							</Panel>
							<FieldList
								section="session"
								placements={d.placements}
								ruleOptions={d.ruleOptions}
							/>
							<AddQuestion
								section="session"
								formPath={formPath}
								placements={d.placements}
								initialLibrary={d.libraryFields}
							/>
						</div>
					</div>

					<div hidden={step !== "participant"}>
						<div className="flex flex-col gap-4">
							{!d.form.participantsStep && (
								<Panel>
									<p>
										The participants step is currently OFF (Submission Setup) —
										submitters skip this page. The configuration below is kept
										for when you turn it back on.
									</p>
								</Panel>
							)}
							<Panel>
								<div className="flex flex-col gap-4">
									<Field
										label="Section title"
										error={errors?.participantSectionTitle?.[0]}
									>
										<Input
											name="participantSectionTitle"
											defaultValue={d.form.participantSectionTitle}
											maxLength={255}
											form="builder-form"
										/>
									</Field>
									<RichText
										label="Description & instructions"
										name="participantSectionHtml"
										defaultValue={d.form.participantSectionHtml}
									/>
								</div>
							</Panel>
							<FieldList
								section="participant"
								placements={d.placements}
								ruleOptions={d.ruleOptions}
							/>
							<AddQuestion
								section="participant"
								formPath={formPath}
								placements={d.placements}
								initialLibrary={d.libraryFields}
							/>
							<RoleConfig form={d.form} errors={errors} />
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>Unique contact settings</strong>
									<OnOffSelect
										label="Notify existing contacts when they are added to a submission."
										name="notifyExistingContacts"
										defaultOn={d.form.notifyExistingContacts}
									/>
								</div>
							</Panel>
						</div>
					</div>

					<div hidden={step !== "settings"}>
						<div className="flex flex-col gap-4">
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>Deadlines</strong>
									<div className="flex flex-wrap items-end gap-3">
										<Field
											label={`Close date (${d.timezone})`}
											error={errors?.closeDate?.[0]}
										>
											<Input
												name="closeDate"
												type="date"
												defaultValue={d.closeDate}
												form="builder-form"
											/>
										</Field>
										<Field label="Close time" error={errors?.closeTime?.[0]}>
											<Input
												name="closeTime"
												type="time"
												defaultValue={d.closeTime}
												form="builder-form"
											/>
										</Field>
										<OnOffSelect
											label="Reminder emails (5 days & 1 day before close)"
											name="sendReminders"
											defaultOn={d.form.sendReminders}
										/>
									</div>
									<p>
										Submissions stop at the close date. Clear the date to keep
										the form open indefinitely.
									</p>
								</div>
							</Panel>
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>Submission capacity</strong>
									<div className="flex flex-wrap items-end gap-3">
										<Field
											label="Submission limit per user"
											error={errors?.submissionLimit?.[0]}
										>
											<Input
												name="submissionLimit"
												type="number"
												min={1}
												max={1000}
												defaultValue={d.form.submissionLimit ?? ""}
												placeholder="No limit"
												form="builder-form"
											/>
										</Field>
										<OnOffSelect
											label="Allow multiple draft submissions"
											name="allowMultipleDrafts"
											defaultOn={d.form.allowMultipleDrafts}
										/>
									</div>
								</div>
							</Panel>
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>After submission</strong>
									<OnOffSelect
										label="Auto-redirect to the speaker portal (~10 seconds after success)"
										name="autoRedirect"
										defaultOn={d.form.autoRedirect}
									/>
									<RichText
										label="Success page message"
										name="successHtml"
										defaultValue={d.form.successHtml}
									/>
								</div>
							</Panel>
						</div>
					</div>

					<div hidden={step !== "notifications"}>
						<div className="flex flex-col gap-4">
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>Submitter notifications</strong>
									<OnOffSelect
										label="Send a submission confirmation email to the submitter"
										name="sendConfirmationEmail"
										defaultOn={d.form.sendConfirmationEmail}
									/>
								</div>
							</Panel>
							<Panel>
								<div className="flex flex-col gap-4">
									<strong>Admin notifications</strong>
									<MemberPicker
										label="Notify when a NEW submission is received"
										name="notifyNew"
										members={d.members}
										initial={d.notify.newSubmission}
									/>
									<MemberPicker
										label="Notify when an existing submission is UPDATED"
										name="notifyUpdated"
										members={d.members}
										initial={d.notify.updatedSubmission}
									/>
								</div>
							</Panel>
						</div>
					</div>

					<div className="mt-5 flex items-center gap-2">
						{stepIndex > 0 && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									const prev = steps[stepIndex - 1];
									if (prev) setStep(prev.id);
								}}
							>
								← Back
							</Button>
						)}
						{stepIndex < steps.length - 1 && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									const next = steps[stepIndex + 1];
									if (next) setStep(next.id);
								}}
							>
								Next →
							</Button>
						)}
						<div className="ml-auto">
							<Button form="builder-form" type="submit" disabled={busy}>
								{savingForm ? "Saving…" : "Save"}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4 px-7 py-6">
			<PageHeader
				title={notFound ? "Form not found" : "Failed to load this form"}
				tone="danger"
				subtitle={
					notFound
						? "This form doesn’t exist on the current event — it may have been deleted."
						: "Something went wrong. Please refresh or try again."
				}
			/>
			<div>
				<TextLink to="/admin/forms">← Back to forms</TextLink>
			</div>
		</div>
	);
}
