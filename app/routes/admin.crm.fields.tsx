import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	createContactField,
	CRM_FIELD_TYPES,
	deleteContactField,
	queryContactFieldDefinitions,
	updateContactField,
} from "~/domain/crm-fields";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	EmptyState,
	ErrorText,
	Field,
	Input,
	Panel,
	Select,
	StatusBadge,
	Textarea,
} from "~/ui";
import type { Route } from "./+types/admin.crm.fields";

const Name = z.string().trim().min(1, "Name is required").max(120);
const Description = z
	.string()
	.trim()
	.max(1000, "Keep the description under 1,000 characters")
	.transform((value) => value || null);

function optionsFrom(value: FormDataEntryValue | null): string[] | null {
	const options = String(value ?? "")
		.split(",")
		.map((option) => option.trim())
		.filter(Boolean);
	return options.length > 0 ? [...new Set(options)] : null;
}

const CreateDefinition = z
	.object({
		createKey: z.uuid(),
		name: Name,
		type: z.enum(CRM_FIELD_TYPES),
		description: Description,
		options: z.array(z.string()).nullable(),
	})
	.check((ctx) => {
		if (ctx.value.type === "dropdown" && !ctx.value.options?.length) {
			ctx.issues.push({
				code: "custom",
				message: "List at least one option, separated by commas",
				path: ["options"],
				input: ctx.value.options,
			});
		}
	});

const UpdateDefinition = z.object({
	id: z.string().min(1),
	name: Name,
	description: Description,
	options: z.array(z.string()).nullable(),
});

const FIELD_TYPE_LABEL: Record<(typeof CRM_FIELD_TYPES)[number], string> = {
	text: "Text",
	textarea: "Text area",
	dropdown: "Dropdown",
	checkbox: "Checkbox",
	number: "Number",
	email: "Email",
	phone: "Phone",
	date: "Date",
};

type ActionResult = {
	notice?: string;
	formError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
};

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) throw redirect("/admin/crm");
	const fieldRows = await timings.time("db", () =>
		queryContactFieldDefinitions(db, org.id),
	);
	return data(
		{ fields: fieldRows, createKey: crypto.randomUUID() },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveActiveOrg(env, user);
	if (!org) return { formError: "No organization is configured yet." };
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const timings = createTimings();
	try {
		if (intent === "create") {
			const parsed = CreateDefinition.safeParse({
				createKey: form.get("createKey"),
				name: form.get("name"),
				type: form.get("type"),
				description: form.get("description") ?? "",
				options: optionsFrom(form.get("options")),
			});
			if (!parsed.success) {
				return data<ActionResult>(
					{ fieldErrors: z.flattenError(parsed.error).fieldErrors },
					{ headers: { "Server-Timing": timings.header() } },
				);
			}
			const { createKey, ...definition } = parsed.data;
			const result = await timings.time("db", () =>
				createContactField(db, org.id, { id: createKey, ...definition }),
			);
			if (!result.ok) return { formError: result.reason };
			track("crm.field_created", { orgId: org.id, type: definition.type });
			return data<ActionResult>(
				{ notice: "Person field created." },
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
		if (intent === "update") {
			const parsed = UpdateDefinition.safeParse({
				id: form.get("id"),
				name: form.get("name"),
				description: form.get("description") ?? "",
				options: optionsFrom(form.get("options")),
			});
			if (!parsed.success) {
				return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
			}
			const { id, ...input } = parsed.data;
			const result = await timings.time("db", () =>
				updateContactField(db, org.id, id, input),
			);
			if (!result.ok) return { formError: result.reason };
			track("crm.field_updated", { orgId: org.id, fieldId: id });
			return data<ActionResult>(
				{ notice: "Person field updated." },
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
		if (intent === "delete") {
			const id = String(form.get("id") ?? "");
			const result = await timings.time("db", () =>
				deleteContactField(db, org.id, id),
			);
			if (!result.ok) return { formError: result.reason };
			track("crm.field_deleted", { orgId: org.id, fieldId: id });
			return data<ActionResult>(
				{ notice: "Person field deleted." },
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
		return { formError: "Unknown action." };
	} catch (error) {
		track("crm.field_write_failed", {
			orgId: org.id,
			intent,
			error: errorMessage(error),
		});
		return { formError: "Could not save the person field — please try again." };
	}
}

export default function CrmFields({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const fieldErrors =
		actionData && "fieldErrors" in actionData
			? (actionData.fieldErrors as Record<string, string[] | undefined>)
			: undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	return (
		<div className="flex flex-col gap-5">
			<Panel>
				<Form method="post" className="flex flex-col gap-3">
					<Input
						type="hidden"
						name="createKey"
						value={loaderData.createKey}
						readOnly
					/>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<Field label="Field name" error={fieldErrors?.name?.[0]}>
							<Input name="name" invalid={Boolean(fieldErrors?.name?.[0])} />
						</Field>
						<Field label="Type" error={fieldErrors?.type?.[0]}>
							<Select name="type" defaultValue="text">
								{CRM_FIELD_TYPES.map((type) => (
									<option key={type} value={type}>
										{FIELD_TYPE_LABEL[type]}
									</option>
								))}
							</Select>
						</Field>
						<Field label="Description" error={fieldErrors?.description?.[0]}>
							<Input name="description" />
						</Field>
						<Field
							label="Dropdown options (comma-separated)"
							error={fieldErrors?.options?.[0]}
						>
							<Input
								name="options"
								invalid={Boolean(fieldErrors?.options?.[0])}
							/>
						</Field>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="submit"
							name="intent"
							value="create"
							icon="plus"
							disabled={busy}
						>
							Create person field
						</Button>
						{notice && <p>{notice}</p>}
						{formError && <ErrorText>{formError}</ErrorText>}
					</div>
				</Form>
			</Panel>

			{loaderData.fields.length === 0 ? (
				<Panel>
					<EmptyState
						icon="clipboard"
						title="No person fields yet"
						body="Create organization-wide metadata here, then set a value on any directory profile."
					/>
				</Panel>
			) : (
				<div className="flex flex-col gap-3">
					{loaderData.fields.map((field) => (
						<Panel key={field.id}>
							<Form method="post" className="flex flex-col gap-3">
								<Input type="hidden" name="id" value={field.id} readOnly />
								<div className="flex flex-wrap items-center gap-2">
									<StatusBadge tone="info">
										{FIELD_TYPE_LABEL[field.type]}
									</StatusBadge>
									<StatusBadge tone="neutral">
										{field.answerCount} saved
									</StatusBadge>
								</div>
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
									<Field label="Field name">
										<Input name="name" defaultValue={field.name} />
									</Field>
									<Field label="Description">
										<Textarea
											name="description"
											rows={2}
											defaultValue={field.description ?? ""}
										/>
									</Field>
									{field.type === "dropdown" && (
										<Field label="Options (comma-separated)">
											<Input
												name="options"
												defaultValue={field.options?.join(", ") ?? ""}
											/>
										</Field>
									)}
								</div>
								<div className="flex flex-wrap items-center gap-3">
									<Button
										type="submit"
										name="intent"
										value="update"
										disabled={busy}
									>
										Save definition
									</Button>
									<Button
										type="submit"
										name="intent"
										value="delete"
										variant="ghost"
										disabled={busy || field.answerCount > 0}
									>
										Delete unused field
									</Button>
									{field.answerCount > 0 && (
										<p>Clear saved profile values before deleting.</p>
									)}
								</div>
							</Form>
						</Panel>
					))}
				</div>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="clipboard"
				title="Failed to load person fields"
				body="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
