import { and, asc, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { useState } from "react";
import { Form, data, redirect, useSearchParams } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { emailTemplates } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { templateKindLabel } from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
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
import type { Route } from "./+types/admin.emails";

// DB-derived schema (SSOT), refined: drizzle-zod maps a notNull text column to
// a z.string() that accepts "" — .min(1) is required for required strings.
const NewTemplate = createInsertSchema(emailTemplates)
	.pick({ name: true })
	.extend({ name: z.string().min(1, "Name is required").max(255) });

/** When each automatic template fires — shown so organizers know what "auto"
 * means without reading docs. Manual templates are sent by an organizer. */
const AUTO_TRIGGER_LABELS: Record<string, string> = {
	submission_confirmation: "when a submission is completed",
	reminder_5day: "5 days before a form closes",
	reminder_1day: "1 day before a form closes",
};

const CATEGORIES = ["all", "lifecycle", "custom"] as const;
type Category = (typeof CATEGORIES)[number];

/** Drizzle wraps the D1 error — the "UNIQUE constraint failed" text lives on
 * the cause chain, not the top-level message. */
function isUniqueViolation(error: unknown): boolean {
	for (let e = error; e instanceof Error; e = e.cause) {
		if (/UNIQUE constraint failed/i.test(e.message)) return true;
	}
	return false;
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) return { templates: [] };
	const db = getDb(env);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		db
			.select({
				id: emailTemplates.id,
				key: emailTemplates.key,
				name: emailTemplates.name,
				subject: emailTemplates.subject,
				replyTo: emailTemplates.replyTo,
				category: emailTemplates.category,
				trigger: emailTemplates.trigger,
			})
			.from(emailTemplates)
			.where(eq(emailTemplates.eventId, event.id))
			.orderBy(asc(emailTemplates.name)),
	);
	const templates = rows.map((r) => ({
		...r,
		type: templateKindLabel(r.category),
		triggerLabel:
			r.trigger === "auto"
				? `Auto — ${AUTO_TRIGGER_LABELS[r.key] ?? "automatic"}`
				: "Manual — sent by an organizer",
	}));
	return data(
		{ templates },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { fieldErrors: undefined, formError: "No event is configured yet." };
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = form.get("intent");

	if (typeof intent === "string" && intent.startsWith("delete:")) {
		const id = intent.slice("delete:".length);
		const [tpl] = await db
			.select({ id: emailTemplates.id, category: emailTemplates.category })
			.from(emailTemplates)
			.where(
				and(eq(emailTemplates.id, id), eq(emailTemplates.eventId, event.id)),
			)
			.limit(1);
		if (!tpl) {
			return { fieldErrors: undefined, formError: "Template not found." };
		}
		if (tpl.category !== "custom") {
			return {
				fieldErrors: undefined,
				formError:
					"Lifecycle templates can't be deleted — automated sends depend on them.",
			};
		}
		await db.delete(emailTemplates).where(eq(emailTemplates.id, tpl.id));
		track("email_template.deleted", { eventId: event.id, templateId: tpl.id });
		return redirect("/admin/emails?category=custom");
	}

	const parsed = NewTemplate.safeParse({ name: form.get("name") });
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}
	const key = parsed.data.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!key) {
		return {
			fieldErrors: { name: ["Name must contain letters or numbers."] },
			formError: undefined,
		};
	}
	// "history" is a static sibling route under /admin/emails — a template with
	// that key would have an unreachable editor URL.
	if (key === "history") {
		return {
			fieldErrors: { name: ["That name is reserved — pick another."] },
			formError: undefined,
		};
	}
	const timings = createTimings();
	try {
		await timings.time("db", () =>
			db.insert(emailTemplates).values({
				eventId: event.id,
				key,
				name: parsed.data.name,
				category: "custom",
				trigger: "manual",
			}),
		);
	} catch (error) {
		track("email_template.create_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		if (isUniqueViolation(error)) {
			return {
				fieldErrors: {
					name: ["A template with a similar name already exists."],
				},
				formError: undefined,
			};
		}
		return {
			fieldErrors: undefined,
			formError: "Could not create the template — please try again.",
		};
	}
	track("email_template.created", { eventId: event.id, key });
	return redirect(`/admin/emails/${key}`, {
		headers: { "Server-Timing": timings.header() },
	});
}

export default function EmailTemplates({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { templates } = loaderData;
	// Derived at render time — every row is already in the payload.
	const counts = {
		all: templates.length,
		lifecycle: templates.filter((t) => t.category === "lifecycle").length,
		custom: templates.filter((t) => t.category === "custom").length,
	};
	const [searchParams] = useSearchParams();
	const raw = searchParams.get("category");
	const category: Category = CATEGORIES.includes(raw as Category)
		? (raw as Category)
		: "all";
	const visible =
		category === "all"
			? templates
			: templates.filter((t) => t.category === category);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Email templates"
				count={`${counts.all} total`}
				subtitle="Subject, body, and reply-to for every email this event sends."
				actions={
					<ButtonLink to="/admin/emails/history" variant="ghost">
						View history
					</ButtonLink>
				}
			/>

			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Field
						label="New template name"
						error={actionData?.fieldErrors?.name?.[0]}
					>
						<Input
							name="name"
							placeholder="e.g. Speaker announcement"
							invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
						/>
					</Field>
					<Button type="submit" icon="plus">
						Add template
					</Button>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>

			<Tabs>
				<Tab to="/admin/emails" count={counts.all} active={category === "all"}>
					All
				</Tab>
				<Tab
					to="/admin/emails?category=lifecycle"
					count={counts.lifecycle}
					active={category === "lifecycle"}
				>
					Lifecycle
				</Tab>
				<Tab
					to="/admin/emails?category=custom"
					count={counts.custom}
					active={category === "custom"}
				>
					Custom
				</Tab>
			</Tabs>

			<Table>
				<THead>
					<Th>Name</Th>
					<Th>Subject</Th>
					<Th>Category</Th>
					<Th>Type</Th>
					<Th>Trigger</Th>
					<Th> </Th>
				</THead>
				<TBody>
					{visible.map((t) => (
						<Tr key={t.id}>
							<Td kind="strong">
								<TextLink to={`/admin/emails/${t.key}`}>{t.name}</TextLink>
							</Td>
							<Td>{t.subject || "—"}</Td>
							<Td>{t.category === "lifecycle" ? "Lifecycle" : "Custom"}</Td>
							<Td>{t.type}</Td>
							<Td>{t.triggerLabel}</Td>
							<Td>
								{t.category === "custom" &&
									(confirmingId === t.id ? (
										<Form
											method="post"
											className="inline-flex items-center gap-2"
										>
											<Button
												type="submit"
												variant="ghost"
												name="intent"
												value={`delete:${t.id}`}
											>
												Confirm delete
											</Button>
											<Button
												type="button"
												variant="ghost"
												onClick={() => setConfirmingId(null)}
											>
												Cancel
											</Button>
										</Form>
									) : (
										<Button
											type="button"
											variant="ghost"
											onClick={() => setConfirmingId(t.id)}
										>
											Delete
										</Button>
									))}
							</Td>
						</Tr>
					))}
					{visible.length === 0 && (
						<EmptyRow colSpan={6}>
							{category === "custom"
								? "No custom templates yet — add one above to reuse in announcements."
								: "No templates yet — add one above, or switch events."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load email templates"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
