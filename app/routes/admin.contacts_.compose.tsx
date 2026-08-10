import { eq } from "drizzle-orm";
import { data, Form } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { portals } from "~/db/schema";
import {
	isContactStatus,
	type RecipientSelection,
	resolveRecipients,
} from "~/domain/contacts";
import { Textarea } from "~/features/contacts/textarea";
import { getActiveEvent, normalizeEmail, requireAdmin } from "~/lib/auth";
import {
	MERGE_TAGS,
	type MergeValues,
	renderEmailHtml,
	renderMergeFields,
	escapeHtml,
} from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { getEmailSender } from "~/ports/email";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.contacts_.compose";

/** Sessionboard caps manual sends at 100 recipients per batch — parity. */
const MAX_RECIPIENTS = 100;

const WELCOME_TEMPLATE = {
	subject: "Welcome to {{event_name}}, {{first_name}}!",
	body: [
		"Hi {{first_name}},",
		"",
		"We're delighted to have you as part of {{event_name}}. Your speaker portal has your profile, sessions, and onboarding tasks:",
		"",
		"{{portal_link}}",
		"",
		"If anything looks off, just reply to this email.",
	].join("\n"),
};

const Composition = z.object({
	subject: z.string().min(1, "Subject is required"),
	body: z.string().min(1, "Write a message body"),
});

function selectionFromParams(params: URLSearchParams): RecipientSelection {
	const ids = (params.get("ids") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const statusParam = params.get("status");
	return {
		ids: ids.length > 0 ? ids : undefined,
		q: params.get("q"),
		status: isContactStatus(statusParam) ? statusParam : null,
	};
}

function describeSelection(selection: RecipientSelection): string {
	if (selection.ids?.length) {
		return selection.ids.length === 1
			? "Hand-picked contact"
			: `${selection.ids.length} hand-picked contacts`;
	}
	const parts: string[] = [];
	if (selection.status) parts.push(`status "${selection.status}"`);
	if (selection.q?.trim()) parts.push(`search "${selection.q.trim()}"`);
	return parts.length > 0
		? `Roster filter: ${parts.join(", ")}`
		: "Everyone on the roster";
}

function buildMergeValues(
	contact: {
		firstName: string;
		lastName: string;
		email: string;
		jobTitle: string | null;
		companyName: string | null;
	},
	eventName: string,
	portalUrl: string | null,
): MergeValues {
	return {
		first_name: contact.firstName,
		last_name: contact.lastName,
		full_name: `${contact.firstName} ${contact.lastName}`.trim(),
		email: contact.email,
		job_title: contact.jobTitle,
		company_name: contact.companyName,
		event_name: eventName,
		portal_link: portalUrl,
	};
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return data({
			recipients: [],
			selection: {} as RecipientSelection,
			selectionLabel: "No event is configured yet",
			template: null as typeof WELCOME_TEMPLATE | null,
			sendKey: crypto.randomUUID(),
			eventName: null as string | null,
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const url = new URL(request.url);
	const selection = selectionFromParams(url.searchParams);
	const recipients = await timings.time("db", () =>
		resolveRecipients(db, event.id, selection),
	);
	return data(
		{
			recipients: recipients.map((c) => ({
				id: c.id,
				name: `${c.firstName} ${c.lastName}`.trim(),
				email: c.email,
				status: c.status,
			})),
			selection,
			selectionLabel: describeSelection(selection),
			template:
				url.searchParams.get("template") === "welcome"
					? WELCOME_TEMPLATE
					: null,
			sendKey: crypto.randomUUID(),
			eventName: event.name,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return {
			step: "form" as const,
			fieldErrors: undefined,
			formError: "No event is configured yet.",
			echo: undefined,
			preview: undefined,
		};
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "send");
	const statusRaw = form.get("status");
	const ids = String(form.get("ids") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const selection: RecipientSelection = {
		ids: ids.length > 0 ? ids : undefined,
		q: String(form.get("q") ?? ""),
		status: isContactStatus(statusRaw) ? statusRaw : null,
	};
	const recipients = await resolveRecipients(db, event.id, selection);
	const echo = {
		subject: String(form.get("subject") ?? ""),
		body: String(form.get("body") ?? ""),
	};

	const [portal] = await db
		.select({ publicId: portals.publicId })
		.from(portals)
		.where(eq(portals.eventId, event.id))
		.limit(1);
	const origin = new URL(request.url).origin;
	const portalUrl = portal
		? `${origin}/portals/${event.slug}/${portal.publicId}`
		: null;

	if (intent === "preview") {
		const previewId = String(form.get("previewContact") ?? "");
		const target = recipients.find((c) => c.id === previewId) ?? recipients[0];
		if (!target) {
			return {
				step: "form" as const,
				fieldErrors: undefined,
				formError: "No recipients to preview.",
				echo,
				preview: undefined,
			};
		}
		const values = buildMergeValues(target, event.name, portalUrl);
		return {
			step: "form" as const,
			fieldErrors: undefined,
			formError: undefined,
			echo,
			preview: {
				name: `${target.firstName} ${target.lastName}`.trim(),
				email: target.email,
				subject: renderMergeFields(echo.subject, values),
				body: renderMergeFields(echo.body, values),
			},
		};
	}

	// intent === "send"
	const parsed = Composition.safeParse(echo);
	if (!parsed.success) {
		return {
			step: "form" as const,
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
			echo,
			preview: undefined,
		};
	}
	if (recipients.length === 0) {
		return {
			step: "form" as const,
			fieldErrors: undefined,
			formError: "No recipients match this selection.",
			echo,
			preview: undefined,
		};
	}
	if (recipients.length > MAX_RECIPIENTS) {
		return {
			step: "form" as const,
			fieldErrors: undefined,
			formError: `This selection has ${recipients.length} recipients — the limit is ${MAX_RECIPIENTS} per send. Narrow the filter and send in batches.`,
			echo,
			preview: undefined,
		};
	}

	const sendKey = String(form.get("sendKey") ?? crypto.randomUUID());
	const sender = getEmailSender(env);
	const timings = createTimings();
	const outcomes: Array<{
		id: string;
		name: string;
		email: string;
		outcome: "sent" | "suppressed" | "duplicate";
	}> = [];
	try {
		await timings.time("send", async () => {
			for (const contact of recipients) {
				const values = buildMergeValues(contact, event.name, portalUrl);
				const html =
					renderEmailHtml(parsed.data.body, values) +
					`<p>You're receiving this because you're a speaker contact for ${escapeHtml(event.name)}.</p>`;
				const result = await sender.send({
					to: normalizeEmail(contact.email),
					subject: renderMergeFields(parsed.data.subject, values),
					html,
					kind: "bulk",
					dedupeKey: `bulk:${sendKey}:${contact.id}`,
					eventId: event.id,
				});
				outcomes.push({
					id: contact.id,
					name: `${contact.firstName} ${contact.lastName}`.trim(),
					email: contact.email,
					outcome: result.suppressed
						? "suppressed"
						: result.deduped
							? "duplicate"
							: "sent",
				});
			}
		});
	} catch (error) {
		track("contacts.bulk_email_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return {
			step: "form" as const,
			fieldErrors: undefined,
			formError:
				"Sending stopped partway — check the email history for what went out, then retry.",
			echo,
			preview: undefined,
		};
	}
	const sent = outcomes.filter((o) => o.outcome === "sent").length;
	const suppressed = outcomes.filter((o) => o.outcome === "suppressed").length;
	track("contacts.bulk_email_sent", {
		eventId: event.id,
		recipients: outcomes.length,
		sent,
		suppressed,
	});
	return {
		step: "sent" as const,
		sent,
		suppressed,
		duplicates: outcomes.filter((o) => o.outcome === "duplicate").length,
		outcomes,
		subject: parsed.data.subject,
	};
}

const OUTCOME_COPY = {
	sent: { tone: "success", label: "sent" },
	suppressed: { tone: "neutral", label: "skipped — unsubscribed" },
	duplicate: { tone: "info", label: "already sent (duplicate submit)" },
} as const;

export default function ComposeBulkEmail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { recipients, selection, selectionLabel, template, sendKey } =
		loaderData;
	const state = actionData;

	if (state?.step === "sent") {
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
				<PageHeader
					title="Email sent"
					count={`${state.sent} delivered`}
					subtitle={`"${state.subject}" — every send is logged to the email history.`}
					actions={
						<ButtonLink to="/admin/contacts" variant="ghost">
							Back to speakers
						</ButtonLink>
					}
				/>
				<Panel>
					<div className="flex items-center gap-4">
						<StatusBadge tone="success">{state.sent} sent</StatusBadge>
						<StatusBadge tone="neutral">
							{state.suppressed} skipped (unsubscribed)
						</StatusBadge>
						{state.duplicates > 0 && (
							<StatusBadge tone="info">
								{state.duplicates} duplicate submits ignored
							</StatusBadge>
						)}
					</div>
				</Panel>
				<Table>
					<THead>
						<Th>Recipient</Th>
						<Th>Email</Th>
						<Th>Outcome</Th>
					</THead>
					<TBody>
						{state.outcomes.map((o) => (
							<Tr key={o.id}>
								<Td kind="strong">{o.name}</Td>
								<Td kind="mono">{o.email}</Td>
								<Td>
									<StatusBadge tone={OUTCOME_COPY[o.outcome].tone}>
										{OUTCOME_COPY[o.outcome].label}
									</StatusBadge>
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			</div>
		);
	}

	const echoSubject = state?.echo?.subject ?? template?.subject ?? "";
	const echoBody = state?.echo?.body ?? template?.body ?? "";

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Compose email"
				count={`${recipients.length} recipients`}
				subtitle={selectionLabel}
				actions={
					<ButtonLink to="/admin/contacts" variant="ghost">
						Back to speakers
					</ButtonLink>
				}
			/>

			{recipients.length === 0 ? (
				<Panel>
					<EmptyState
						icon="mail"
						title="No recipients match"
						body="Pick speakers from the roster (or widen the filter), then come back to compose."
						action={
							<ButtonLink to="/admin/contacts" variant="ghost">
								Open the roster
							</ButtonLink>
						}
					/>
				</Panel>
			) : (
				<>
					<Panel>
						<div className="flex flex-col gap-2">
							<strong>Recipients</strong>
							<p>
								{recipients
									.slice(0, 12)
									.map((r) => r.name)
									.join(", ")}
								{recipients.length > 12 &&
									` and ${recipients.length - 12} more`}
							</p>
							<p>
								Unsubscribed contacts are skipped automatically — announcements
								never override an unsubscribe.
							</p>
						</div>
					</Panel>

					<Panel>
						<Form method="post" className="flex flex-col gap-3">
							<Input
								type="hidden"
								name="ids"
								value={selection.ids?.join(",") ?? ""}
								readOnly
							/>
							<Input
								type="hidden"
								name="q"
								value={selection.q ?? ""}
								readOnly
							/>
							<Input
								type="hidden"
								name="status"
								value={selection.status ?? ""}
								readOnly
							/>
							<Input type="hidden" name="sendKey" value={sendKey} readOnly />
							<Field label="Subject" error={state?.fieldErrors?.subject?.[0]}>
								<Input
									name="subject"
									defaultValue={echoSubject}
									invalid={Boolean(state?.fieldErrors?.subject?.[0])}
								/>
							</Field>
							<Field label="Message" error={state?.fieldErrors?.body?.[0]}>
								<Textarea
									name="body"
									rows={10}
									defaultValue={echoBody}
									invalid={Boolean(state?.fieldErrors?.body?.[0])}
								/>
							</Field>
							<p>
								Merge fields resolve per recipient:{" "}
								{MERGE_TAGS.map((t) => `{{${t}}}`).join("  ")}
							</p>
							{!echoBody && (
								<p>
									Starting from scratch?{" "}
									<ButtonLink
										to={`?${new URLSearchParams({
											...(selection.ids?.length
												? { ids: selection.ids.join(",") }
												: {}),
											...(selection.q ? { q: selection.q } : {}),
											...(selection.status ? { status: selection.status } : {}),
											template: "welcome",
										}).toString()}`}
										variant="ghost"
									>
										Use the welcome template
									</ButtonLink>
								</p>
							)}
							<div className="flex flex-wrap items-end gap-3">
								<Field label="Preview as">
									<Select name="previewContact">
										{recipients.map((r) => (
											<option key={r.id} value={r.id}>
												{r.name} ({r.email})
											</option>
										))}
									</Select>
								</Field>
								<Button
									type="submit"
									name="intent"
									value="preview"
									variant="ghost"
								>
									Preview for recipient
								</Button>
								<Button type="submit" name="intent" value="send" icon="mail">
									Send to {recipients.length}{" "}
									{recipients.length === 1 ? "speaker" : "speakers"}
								</Button>
								{state?.formError && <ErrorText>{state.formError}</ErrorText>}
							</div>
						</Form>
					</Panel>

					{state?.preview && (
						<Panel>
							<div className="flex flex-col gap-2">
								<strong>
									Preview — {state.preview.name} ({state.preview.email})
								</strong>
								<p>
									<strong>Subject:</strong> {state.preview.subject}
								</p>
								<p className="whitespace-pre-wrap">{state.preview.body}</p>
							</div>
						</Panel>
					)}
				</>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load the compose screen"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
