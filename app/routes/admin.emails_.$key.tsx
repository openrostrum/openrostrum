import { and, asc, eq, isNotNull } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { useState } from "react";
import { data, useFetcher } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { emailTemplates, forms, portals } from "~/db/schema";
import { RichText } from "~/ui/rich-text";
import { TemplatePreview } from "~/emails/template-preview";
import { Hint } from "~/emails/text";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { formatInTimeZone } from "~/lib/dates";
import type { MergeContext } from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	TextLink,
} from "~/ui";
import type { Route } from "./+types/admin.emails_.$key";

const EditTemplate = createInsertSchema(emailTemplates)
	.pick({ name: true, subject: true, bodyHtml: true, replyTo: true })
	.extend({
		name: z.string().min(1, "Name is required").max(255),
		// drizzle-zod maps the notNull-with-default column to a z.string() that
		// accepts "" — without the refine, a blank subject silently saves.
		subject: z.string().min(1, "Subject is required").max(500),
		bodyHtml: z.string().max(100_000),
		replyTo: z
			.string()
			.email("Enter a valid email address")
			.optional()
			.or(z.literal("")),
	});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
	const db = getDb(env);
	const timings = createTimings();

	const template = await timings.time("db", () =>
		db.query.emailTemplates.findFirst({
			where: (t, { and: a, eq: e }) =>
				a(e(t.eventId, event.id), e(t.key, params.key)),
		}),
	);
	if (!template) throw new Response("Not found", { status: 404 });

	// Sample record for the merge-field preview: prefer a real accepted
	// submission + speaker from this event so the preview shows live data.
	const sample = await timings.time("db-sample", async () => {
		const submission = await db.query.submissions.findFirst({
			where: (s, { and: a, eq: e }) =>
				a(e(s.eventId, event.id), e(s.status, "accepted")),
			with: {
				participants: { with: { contact: true }, limit: 1 },
				room: true,
			},
			orderBy: (s, { desc }) => [desc(s.createdAt)],
		});
		const contact =
			submission?.participants[0]?.contact ??
			(await db.query.contacts.findFirst({
				where: (c, { eq: e }) => e(c.eventId, event.id),
			}));
		const [portal] = await db
			.select({ publicId: portals.publicId })
			.from(portals)
			.where(eq(portals.eventId, event.id))
			.limit(1);
		const [form] = await db
			.select({ externalTitle: forms.externalTitle, closeAt: forms.closeAt })
			.from(forms)
			.where(and(eq(forms.eventId, event.id), isNotNull(forms.closeAt)))
			.orderBy(asc(forms.createdAt))
			.limit(1);
		return { submission, contact, portal, form };
	});

	const origin = new URL(request.url).origin;
	const tz = event.timezone;
	const firstName = sample.contact?.firstName ?? "Alex";
	const lastName = sample.contact?.lastName ?? "Rivera";
	const sampleCtx: MergeContext = {
		first_name: firstName,
		last_name: lastName,
		full_name: `${firstName} ${lastName}`.trim(),
		email: sample.contact?.email ?? "alex@example.com",
		event_name: event.name,
		session_title: sample.submission?.title ?? "Sample session title",
		session_date_time: sample.submission?.startsAt
			? formatInTimeZone(sample.submission.startsAt, tz)
			: null,
		session_room: sample.submission?.room?.name ?? null,
		portal_link: sample.portal
			? `${origin}/portals/${event.slug}/${sample.portal.publicId}`
			: null,
		form_title: sample.form?.externalTitle ?? null,
		form_close_date: sample.form?.closeAt
			? formatInTimeZone(sample.form.closeAt, tz)
			: null,
	};

	return data(
		{ template, sampleCtx, eventName: event.name },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });
	const db = getDb(env);

	const [template] = await db
		.select({ id: emailTemplates.id, name: emailTemplates.name })
		.from(emailTemplates)
		.where(
			and(
				eq(emailTemplates.eventId, event.id),
				eq(emailTemplates.key, params.key),
			),
		)
		.limit(1);
	if (!template) throw new Response("Not found", { status: 404 });

	const form = await request.formData();
	const parsed = EditTemplate.safeParse({
		name: form.get("name") ?? template.name,
		subject: form.get("subject"),
		bodyHtml: form.get("bodyHtml"),
		replyTo: form.get("replyTo"),
	});
	// Parse failure returns BEFORE any UPDATE — the stored template is untouched.
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
			ok: false as const,
		};
	}
	const timings = createTimings();
	try {
		await timings.time("db", () =>
			db
				.update(emailTemplates)
				.set({
					name: parsed.data.name,
					subject: parsed.data.subject,
					bodyHtml: parsed.data.bodyHtml,
					replyTo: parsed.data.replyTo || null,
				})
				.where(eq(emailTemplates.id, template.id)),
		);
	} catch (error) {
		track("email_template.update_failed", {
			eventId: event.id,
			templateId: template.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the template — please try again.",
			ok: false as const,
		};
	}
	track("email_template.updated", {
		eventId: event.id,
		templateId: template.id,
		key: params.key,
	});
	return data(
		{ fieldErrors: undefined, formError: undefined, ok: true as const },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function EmailTemplateEditor({
	loaderData,
}: Route.ComponentProps) {
	const { template, sampleCtx } = loaderData;
	const fetcher = useFetcher<typeof action>();
	const [subject, setSubject] = useState(template.subject);
	const [body, setBody] = useState(template.bodyHtml);
	const fieldErrors = fetcher.data?.fieldErrors;
	const saved = fetcher.state === "idle" && fetcher.data?.ok === true;

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={template.name}
				subtitle={
					<>
						<TextLink to="/admin/emails">← All templates</TextLink>{" "}
						{template.category === "lifecycle"
							? " · Lifecycle template — sent automatically or from the review flow."
							: " · Custom template — reusable in announcements."}
					</>
				}
			/>

			<div className="flex flex-wrap items-start gap-5">
				<Panel>
					<fetcher.Form
						method="post"
						className="flex w-[440px] max-w-full flex-col gap-[13px]"
					>
						{template.category === "custom" && (
							<Field label="Name" error={fieldErrors?.name?.[0]}>
								<Input
									name="name"
									defaultValue={template.name}
									invalid={Boolean(fieldErrors?.name?.[0])}
								/>
							</Field>
						)}
						<Field label="Subject" error={fieldErrors?.subject?.[0]}>
							<Input
								name="subject"
								value={subject}
								onChange={(e) => setSubject(e.target.value)}
								invalid={Boolean(fieldErrors?.subject?.[0])}
							/>
						</Field>
						<Field
							label="Reply-to (speaker replies land here)"
							error={fieldErrors?.replyTo?.[0]}
						>
							<Input
								name="replyTo"
								type="email"
								placeholder="organizers@yourevent.com"
								defaultValue={template.replyTo ?? ""}
								invalid={Boolean(fieldErrors?.replyTo?.[0])}
							/>
						</Field>
						<Field label="Body" error={fieldErrors?.bodyHtml?.[0]}>
							<RichText
								name="bodyHtml"
								size="lg"
								defaultValue={template.bodyHtml}
								invalid={Boolean(fieldErrors?.bodyHtml?.[0])}
								onChange={setBody}
							/>
						</Field>
						<div className="flex items-center gap-3">
							<Button type="submit" disabled={fetcher.state !== "idle"}>
								{fetcher.state !== "idle" ? "Saving…" : "Save template"}
							</Button>
							{saved && <Hint>Saved.</Hint>}
							{fetcher.data?.formError && (
								<ErrorText>{fetcher.data.formError}</ErrorText>
							)}
						</div>
					</fetcher.Form>
				</Panel>

				<div className="min-w-[320px] flex-1">
					<TemplatePreview subject={subject} bodyHtml={body} ctx={sampleCtx} />
				</div>
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Template not found"
				tone="danger"
				subtitle={
					<TextLink to="/admin/emails">← Back to email templates</TextLink>
				}
			/>
		</div>
	);
}
