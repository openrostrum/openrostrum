import { and, asc, count, eq, notExists } from "drizzle-orm";
import { useState } from "react";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import {
	PORTAL_FIELD_TYPE_LABELS,
	PORTAL_FIELD_TYPES,
	type PortalFieldType,
	PortalFormFields,
	type PortalFormFieldDef,
} from "~/components/portal-form-fields";
import { getDb } from "~/db";
import { PORTAL_FORM_TARGET, portalForms, tasks } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatDateUTC } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import { RichText } from "~/ui/rich-text-lazy";
import {
	Button,
	ButtonLink,
	Checkbox,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	Tab,
	Table,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.portal-forms";

const TARGET_LABELS: Record<(typeof PORTAL_FORM_TARGET)[number], string> = {
	contact: "Contacts",
	group: "Groups",
	submission: "Sessions",
};

const MAX_FIELDS = 50;

const FieldDef = z.object({
	name: z.string().trim().min(1).max(120),
	type: z.enum(PORTAL_FIELD_TYPES),
	required: z.boolean(),
	options: z.array(z.string().trim().min(1)).max(50).optional(),
});

const FormSave = z.object({
	name: z.string().trim().min(1, "Form name is required").max(120),
	title: z.string().trim().max(200),
	targetType: z.enum(PORTAL_FORM_TARGET),
	sendConfirmationEmail: z.boolean(),
	confirmationHtml: z
		.string()
		.trim()
		.max(5000, "Keep the confirmation message under 5,000 characters"),
});

/**
 * Answers are keyed by field NAME in `taskAssignments.response`, so blank or
 * duplicate names would silently merge or lose speakers' answers — both are
 * rejected here, not just deduped.
 */
function parseFields(
	raw: string,
): { fields: PortalFormFieldDef[] } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			error: "The field list could not be read — reload and try again.",
		};
	}
	const result = z.array(FieldDef).max(MAX_FIELDS).safeParse(parsed);
	if (!result.success) {
		const issue = result.error.issues[0];
		const index = typeof issue?.path[0] === "number" ? issue.path[0] + 1 : null;
		if (issue?.path[1] === "name") {
			return { error: `Field ${index}: every field needs a name.` };
		}
		return {
			error: index
				? `Field ${index}: ${issue?.message ?? "invalid field"}`
				: "The field list is invalid — reload and try again.",
		};
	}
	if (result.data.length === 0) {
		return {
			error: "Add at least one field — an empty form collects nothing.",
		};
	}
	const seen = new Set<string>();
	for (const field of result.data) {
		const key = field.name.toLowerCase();
		if (seen.has(key)) {
			return {
				error: `Two fields are named “${field.name}” — answers are stored by field name, so names must be unique.`,
			};
		}
		seen.add(key);
	}
	for (const field of result.data) {
		if (
			field.type === "dropdown" &&
			(!field.options || field.options.length === 0)
		) {
			return {
				error: `Dropdown “${field.name}” needs at least one option (comma-separated).`,
			};
		}
	}
	return {
		fields: result.data.map((f) => ({
			name: f.name,
			type: f.type,
			required: f.required,
			...(f.type === "dropdown" ? { options: f.options } : {}),
		})),
	};
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const editId = url.searchParams.get("edit");
	const createdId = url.searchParams.get("created");

	const empty = {
		eventName: null as string | null,
		forms: [] as Array<{
			id: string;
			name: string;
			title: string;
			targetType: (typeof PORTAL_FORM_TARGET)[number];
			schema: PortalFormFieldDef[];
			sendConfirmationEmail: boolean;
			confirmationHtml: string | null;
			usedByTasks: number;
			createdAt: Date;
		}>,
		editId,
		createdName: null as string | null,
	};
	if (!event) return empty;

	const db = getDb(env);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		db
			.select({
				id: portalForms.id,
				name: portalForms.name,
				title: portalForms.title,
				targetType: portalForms.targetType,
				schema: portalForms.schema,
				sendConfirmationEmail: portalForms.sendConfirmationEmail,
				confirmationHtml: portalForms.confirmationHtml,
				usedByTasks: count(tasks.id),
				createdAt: portalForms.createdAt,
			})
			.from(portalForms)
			.leftJoin(tasks, eq(tasks.portalFormId, portalForms.id))
			.where(eq(portalForms.eventId, event.id))
			.groupBy(portalForms.id)
			.orderBy(asc(portalForms.createdAt)),
	);
	return data(
		{
			...empty,
			eventName: event.name,
			forms: rows.map((r) => ({ ...r, schema: r.schema ?? [] })),
			createdName: rows.find((r) => r.id === createdId)?.name ?? null,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
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

	if (intent === "save-form") {
		const parsed = FormSave.safeParse({
			name: form.get("name") ?? "",
			title: form.get("title") ?? "",
			targetType: form.get("targetType") ?? "contact",
			sendConfirmationEmail: form.get("sendConfirmationEmail") === "yes",
			confirmationHtml: form.get("confirmationHtml") ?? "",
		});
		if (!parsed.success) {
			return {
				fieldErrors: z.flattenError(parsed.error)
					.fieldErrors as ActionResult["fieldErrors"],
			} satisfies ActionResult;
		}
		const fieldsResult = parseFields(String(form.get("fieldsJson") ?? "[]"));
		if ("error" in fieldsResult) {
			return {
				fieldErrors: { fields: [fieldsResult.error] },
			} satisfies ActionResult;
		}
		const d = parsed.data;
		const values = {
			name: d.name,
			title: d.title,
			targetType: d.targetType,
			schema: fieldsResult.fields,
			sendConfirmationEmail: d.sendConfirmationEmail,
			// The editor's empty document is markup (<p></p>) — treat text-empty
			// HTML as unset so the default thank-you copy applies.
			confirmationHtml:
				d.sendConfirmationEmail &&
				d.confirmationHtml.replace(/<[^>]*>/g, "").trim() !== ""
					? d.confirmationHtml
					: null,
		};
		const formId = String(form.get("formId") ?? "");
		try {
			if (formId === "") {
				const [row] = await timings.time("db", () =>
					db
						.insert(portalForms)
						.values({ ...values, eventId: event.id })
						.returning({ id: portalForms.id }),
				);
				track("portal_form.created", {
					eventId: event.id,
					formId: row?.id,
					fields: values.schema.length,
				});
				return redirect(`/admin/portal-forms?created=${row?.id ?? ""}`, {
					headers: { "Server-Timing": timings.header() },
				});
			}
			// Tenant guard IN the write: a forged id outside this event touches 0 rows.
			const touched = await timings.time("db", () =>
				db
					.update(portalForms)
					.set(values)
					.where(
						and(eq(portalForms.id, formId), eq(portalForms.eventId, event.id)),
					)
					.returning({ id: portalForms.id }),
			);
			if (touched.length === 0) {
				return {
					formError: "That portal form no longer exists.",
				} satisfies ActionResult;
			}
			track("portal_form.updated", { eventId: event.id, formId });
			return redirect("/admin/portal-forms", {
				headers: { "Server-Timing": timings.header() },
			});
		} catch (error) {
			track("portal_form.save_failed", {
				eventId: event.id,
				error: errorMessage(error),
			});
			return {
				formError: "Could not save the portal form — please try again.",
			} satisfies ActionResult;
		}
	}

	if (intent === "delete-form") {
		const formId = String(form.get("formId") ?? "");
		// The task FK is SET NULL — an unguarded delete would silently turn
		// "Fill in: <form>" tasks into bare mark-as-done tasks. The tenant guard
		// AND the no-references condition live IN the delete statement (D1 has
		// no transactions, so check-then-delete would race a concurrent attach);
		// the refusal copy is computed only after a zero-row delete.
		try {
			const gone = await timings.time("db", () =>
				db
					.delete(portalForms)
					.where(
						and(
							eq(portalForms.id, formId),
							eq(portalForms.eventId, event.id),
							notExists(
								db
									.select({ one: tasks.id })
									.from(tasks)
									.where(eq(tasks.portalFormId, formId)),
							),
						),
					)
					.returning({ id: portalForms.id }),
			);
			if (gone.length > 0) {
				track("portal_form.deleted", { eventId: event.id, formId });
				return redirect("/admin/portal-forms", {
					headers: { "Server-Timing": timings.header() },
				});
			}
		} catch (error) {
			track("portal_form.delete_failed", {
				eventId: event.id,
				formId,
				error: errorMessage(error),
			});
			return {
				formError: "Could not delete the portal form — please try again.",
			} satisfies ActionResult;
		}
		const [owned] = await db
			.select({ id: portalForms.id })
			.from(portalForms)
			.where(and(eq(portalForms.id, formId), eq(portalForms.eventId, event.id)))
			.limit(1);
		if (!owned) {
			return {
				formError: "That portal form no longer exists.",
			} satisfies ActionResult;
		}
		const [used] = await db
			.select({ n: count() })
			.from(tasks)
			.where(eq(tasks.portalFormId, formId));
		return {
			formError: `In use by ${used?.n ?? 0} task${used?.n === 1 ? "" : "s"} — point ${used?.n === 1 ? "it" : "them"} at another completion first (Tasks → definitions).`,
		} satisfies ActionResult;
	}

	return { formError: "Unknown action." } satisfies ActionResult;
}

type DraftField = {
	key: number;
	name: string;
	type: PortalFieldType;
	required: boolean;
	options: string;
};

function toDrafts(schema: PortalFormFieldDef[]): DraftField[] {
	return schema.map((f, i) => ({
		key: i,
		name: f.name,
		type: PORTAL_FIELD_TYPES.includes(f.type as PortalFieldType)
			? (f.type as PortalFieldType)
			: "text",
		required: f.required,
		options: (f.options ?? []).join(", "),
	}));
}

/** THE draft→field conversion — the save payload and the speaker preview must
 * come from the same function or the preview drifts from what gets saved. */
function draftToField(f: DraftField): PortalFormFieldDef {
	return {
		name: f.name.trim(),
		type: f.type,
		required: f.required,
		...(f.type === "dropdown"
			? {
					options: f.options
						.split(",")
						.map((o) => o.trim())
						.filter((o) => o !== ""),
				}
			: {}),
	};
}

function serializeDrafts(drafts: DraftField[]): string {
	return JSON.stringify(drafts.map(draftToField));
}

/** What the speaker will see, from the in-progress draft (nameless rows wait). */
function previewSchema(drafts: DraftField[]): PortalFormFieldDef[] {
	const seen = new Set<string>();
	const out: PortalFormFieldDef[] = [];
	for (const f of drafts.map(draftToField)) {
		if (f.name === "" || seen.has(f.name)) continue;
		seen.add(f.name);
		out.push(f);
	}
	return out;
}

function FormEditor({
	editing,
	errors,
	formError,
}: {
	editing: Route.ComponentProps["loaderData"]["forms"][number] | null;
	errors: Record<string, string[] | undefined> | undefined;
	formError: string | undefined;
}) {
	const [drafts, setDrafts] = useState<DraftField[]>(() =>
		editing
			? toDrafts(editing.schema)
			: [{ key: 0, name: "", type: "text", required: true, options: "" }],
	);
	const [nextKey, setNextKey] = useState(drafts.length);
	const [confirmEmail, setConfirmEmail] = useState(
		editing?.sendConfirmationEmail ?? false,
	);

	const patch = (key: number, changes: Partial<DraftField>) =>
		setDrafts((list) =>
			list.map((f) => (f.key === key ? { ...f, ...changes } : f)),
		);
	const move = (index: number, delta: -1 | 1) =>
		setDrafts((list) => {
			const target = index + delta;
			if (target < 0 || target >= list.length) return list;
			const next = [...list];
			const [row] = next.splice(index, 1);
			if (!row) return list;
			next.splice(target, 0, row);
			return next;
		});

	const preview = previewSchema(drafts);

	return (
		<Panel>
			<Form method="post" className="flex flex-col gap-4">
				<PageHeader
					title={editing ? `Edit “${editing.name}”` : "New portal form"}
					subtitle={
						editing && editing.usedByTasks > 0
							? `Used by ${editing.usedByTasks} task${editing.usedByTasks === 1 ? "" : "s"} — field changes apply to future submissions; answers already collected are kept.`
							: "Speakers fill these in from a task — hotel stay, flight reimbursement, AV needs."
					}
				/>
				<Input type="hidden" name="intent" value="save-form" />
				{editing && <Input type="hidden" name="formId" value={editing.id} />}
				<Input
					type="hidden"
					name="fieldsJson"
					value={serializeDrafts(drafts)}
				/>

				<div className="flex flex-wrap items-end gap-3">
					<Field label="Form name (internal)" error={errors?.name?.[0]}>
						<Input
							name="name"
							defaultValue={editing?.name ?? ""}
							placeholder="e.g. Hotel Stay"
							invalid={Boolean(errors?.name?.[0])}
						/>
					</Field>
					<Field label="Title shown to speakers" error={errors?.title?.[0]}>
						<Input
							name="title"
							defaultValue={editing?.title ?? ""}
							placeholder="e.g. Book your hotel"
						/>
					</Field>
					<Field label="Audience">
						<Select
							name="targetType"
							defaultValue={editing?.targetType ?? "contact"}
						>
							{PORTAL_FORM_TARGET.map((t) => (
								<option key={t} value={t}>
									{TARGET_LABELS[t]}
								</option>
							))}
						</Select>
					</Field>
				</div>

				<div className="flex flex-wrap gap-5">
					<div className="flex min-w-72 flex-1 flex-col gap-3">
						<strong>Fields</strong>
						{errors?.fields?.[0] && <ErrorText>{errors.fields[0]}</ErrorText>}
						{drafts.map((f, i) => (
							<div key={f.key} className="flex flex-wrap items-end gap-2">
								<Field label={`Field ${i + 1}`}>
									<Input
										value={f.name}
										placeholder="e.g. Check-in date"
										onChange={(e) =>
											patch(f.key, { name: e.currentTarget.value })
										}
									/>
								</Field>
								<Field label="Type">
									<Select
										value={f.type}
										onChange={(e) =>
											patch(f.key, {
												type: e.currentTarget.value as PortalFieldType,
											})
										}
									>
										{PORTAL_FIELD_TYPES.map((t) => (
											<option key={t} value={t}>
												{PORTAL_FIELD_TYPE_LABELS[t]}
											</option>
										))}
									</Select>
								</Field>
								{f.type === "dropdown" && (
									<Field label="Options (comma-separated)">
										<Input
											value={f.options}
											placeholder="Handheld, Lavalier, Podium"
											onChange={(e) =>
												patch(f.key, { options: e.currentTarget.value })
											}
										/>
									</Field>
								)}
								<div className="flex h-[34px] items-center">
									<Checkbox
										label="Required"
										checked={f.required}
										onChange={(e) =>
											patch(f.key, { required: e.currentTarget.checked })
										}
									/>
								</div>
								<div className="flex items-center gap-1">
									<Button
										type="button"
										variant="ghost"
										disabled={i === 0}
										aria-label={`Move field ${i + 1} up`}
										onClick={() => move(i, -1)}
									>
										↑
									</Button>
									<Button
										type="button"
										variant="ghost"
										disabled={i === drafts.length - 1}
										aria-label={`Move field ${i + 1} down`}
										onClick={() => move(i, 1)}
									>
										↓
									</Button>
									<Button
										type="button"
										variant="ghost"
										disabled={drafts.length === 1}
										aria-label={`Remove field ${i + 1}`}
										onClick={() =>
											setDrafts((list) => list.filter((x) => x.key !== f.key))
										}
									>
										Remove
									</Button>
								</div>
							</div>
						))}
						<div className="flex">
							<Button
								type="button"
								variant="ghost"
								icon="plus"
								disabled={drafts.length >= MAX_FIELDS}
								onClick={() => {
									setDrafts((list) => [
										...list,
										{
											key: nextKey,
											name: "",
											type: "text",
											required: false,
											options: "",
										},
									]);
									setNextKey((k) => k + 1);
								}}
							>
								Add field
							</Button>
						</div>
					</div>

					<div className="flex w-80 max-w-full flex-col gap-3">
						<strong>Speaker preview</strong>
						{preview.length > 0 ? (
							<Panel>
								<PortalFormFields schema={preview} />
							</Panel>
						) : (
							<Panel>
								<span>Name a field to see it here as the speaker will.</span>
							</Panel>
						)}
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<Checkbox
						label="Send the speaker a confirmation email on submission"
						name="sendConfirmationEmail"
						value="yes"
						checked={confirmEmail}
						onChange={(e) => setConfirmEmail(e.currentTarget.checked)}
					/>
					{confirmEmail && (
						<Field
							label="Confirmation message (optional — a default thank-you is sent if blank)"
							error={errors?.confirmationHtml?.[0]}
						>
							<RichText
								name="confirmationHtml"
								defaultValue={editing?.confirmationHtml ?? ""}
							/>
						</Field>
					)}
				</div>

				{formError && <ErrorText>{formError}</ErrorText>}
				<div className="flex items-center gap-3">
					<Button type="submit" icon={editing ? undefined : "plus"}>
						{editing ? "Save changes" : "Create portal form"}
					</Button>
					{editing && (
						<ButtonLink to="/admin/portal-forms" variant="ghost">
							Cancel
						</ButtonLink>
					)}
				</div>
			</Form>
		</Panel>
	);
}

export default function PortalFormsAdmin({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { eventName, forms, editId, createdName } = loaderData;
	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
	const editing = forms.find((f) => f.id === editId) ?? null;

	if (!eventName) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
				<PageHeader
					title="Portal forms"
					subtitle="Create an event first — portal forms belong to an event."
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Portal forms"
				count={String(forms.length)}
				subtitle="Structured forms speakers fill in from their portal tasks."
			/>

			<Tabs>
				<Tab to="/admin/portals">Portals</Tab>
				<Tab to="/admin/portal-forms">Portal forms</Tab>
			</Tabs>

			{createdName && !actionData?.fieldErrors && !actionData?.formError && (
				<div className="flex">
					<StatusBadge tone="success">
						Created &quot;{createdName}&quot; — attach it to a task from Tasks →
						definitions (Completion → &quot;Fill in: {createdName}&quot;).
					</StatusBadge>
				</div>
			)}

			<FormEditor
				key={editing ? `edit-${editing.id}` : "new"}
				editing={editing}
				errors={actionData?.fieldErrors}
				formError={actionData?.formError}
			/>

			<Table>
				<THead>
					<Th>Form</Th>
					<Th>Speaker title</Th>
					<Th>Audience</Th>
					<Th>Fields</Th>
					<Th>Used by tasks</Th>
					<Th>Created</Th>
					<Th />
				</THead>
				<TBody>
					{forms.map((f) => (
						<Tr key={f.id} selected={f.id === editId}>
							<Td kind="strong">{f.name}</Td>
							<Td>{f.title || "—"}</Td>
							<Td>{TARGET_LABELS[f.targetType]}</Td>
							<Td kind="mono">{f.schema.length}</Td>
							<Td kind="mono">
								{f.usedByTasks > 0 ? (
									<TextLink to="/admin/tasks?view=definitions">
										{f.usedByTasks}
									</TextLink>
								) : (
									"0"
								)}
							</Td>
							<Td kind="mono">{formatDateUTC(f.createdAt)}</Td>
							<Td>
								{confirmingDelete === f.id ? (
									<Form
										method="post"
										className="flex items-center gap-2"
										onSubmit={() => setConfirmingDelete(null)}
									>
										<Input type="hidden" name="intent" value="delete-form" />
										<Input type="hidden" name="formId" value={f.id} />
										<span>Delete this form?</span>
										<Button
											type="button"
											variant="ghost"
											onClick={() => setConfirmingDelete(null)}
										>
											Cancel
										</Button>
										<Button type="submit">Delete</Button>
									</Form>
								) : (
									<div className="flex items-center gap-3">
										<TextLink to={`/admin/portal-forms?edit=${f.id}`}>
											Edit
										</TextLink>
										<Button
											type="button"
											variant="ghost"
											onClick={() => setConfirmingDelete(f.id)}
										>
											Delete
										</Button>
									</div>
								)}
							</Td>
						</Tr>
					))}
					{forms.length === 0 && (
						<EmptyRow colSpan={7}>
							<EmptyState
								icon="clipboard"
								title="No portal forms yet"
								body="Create your first form above — hotel stay, flight reimbursement, AV needs — then attach it to a task so speakers can fill it in."
							/>
						</EmptyRow>
					)}
				</TBody>
			</Table>
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — the raw error can carry SQL/row values.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load portal forms"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
