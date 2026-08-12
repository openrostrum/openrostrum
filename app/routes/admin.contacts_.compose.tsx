import { data, Form } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	isContactStatus,
	type RecipientSelection,
	resolveRecipients,
} from "~/domain/contacts";
import {
	resolveDirectoryRecipients,
	type DirectoryRecipient,
} from "~/domain/crm";
import {
	assertAnnouncementsConfigured,
	sendAnnouncement,
} from "~/lib/announcements";
import {
	getActiveEvent,
	normalizeEmail,
	requireAdmin,
	resolveActiveOrg,
} from "~/lib/auth";
import {
	CAMPAIGN_MERGE_TAGS,
	type MergeValues,
	renderEmailHtml,
	renderMergeFields,
	templateUsesTag,
} from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
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
	Textarea,
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

type ComposerSelection = RecipientSelection & {
	directoryEmails?: string[];
};

function selectionFromParams(params: URLSearchParams): ComposerSelection {
	const ids = (params.get("ids") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const statusParam = params.get("status");
	const directoryParam = params.get("directoryEmails");
	const directoryEmails =
		directoryParam === null
			? undefined
			: [
					...new Set(
						directoryParam.split(",").map(normalizeEmail).filter(Boolean),
					),
				].slice(0, MAX_RECIPIENTS);
	return {
		ids: ids.length > 0 ? ids : undefined,
		q: params.get("q"),
		status: isContactStatus(statusParam) ? statusParam : null,
		directoryEmails,
	};
}

function describeSelection(selection: ComposerSelection): string {
	if (selection.directoryEmails !== undefined) {
		return selection.directoryEmails.length === 1
			? "1 person selected from the organization directory"
			: `${selection.directoryEmails.length} people selected from the organization directory`;
	}
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

async function resolveComposerRecipients(
	db: ReturnType<typeof getDb>,
	eventId: string,
	orgId: string | null,
	selection: ComposerSelection,
): Promise<DirectoryRecipient[]> {
	if (selection.directoryEmails !== undefined) {
		return orgId
			? resolveDirectoryRecipients(db, orgId, selection.directoryEmails)
			: [];
	}
	return resolveRecipients(db, eventId, selection);
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
			selection: {} as ComposerSelection,
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
	const org =
		selection.directoryEmails !== undefined
			? await timings.time("org", () => resolveActiveOrg(env, user))
			: null;
	const recipients = await timings.time("db", () =>
		resolveComposerRecipients(db, event.id, org?.id ?? null, selection),
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
			sendKey: crypto.randomUUID(),
		};
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "send");
	const selection = selectionFromParams(
		new URLSearchParams({
			ids: String(form.get("ids") ?? ""),
			q: String(form.get("q") ?? ""),
			status: String(form.get("status") ?? ""),
			...(form.has("directoryEmails")
				? { directoryEmails: String(form.get("directoryEmails") ?? "") }
				: {}),
		}),
	);
	const org =
		selection.directoryEmails !== undefined
			? await resolveActiveOrg(env, user)
			: null;
	const recipients = await resolveComposerRecipients(
		db,
		event.id,
		org?.id ?? null,
		selection,
	);
	const echo = {
		subject: String(form.get("subject") ?? ""),
		body: String(form.get("body") ?? ""),
	};
	// Echoed through every re-render so a retry after a partial failure keeps
	// the SAME dedupe scope — already-delivered recipients are never re-sent.
	const postedSendKey = String(form.get("sendKey") ?? "").trim();
	const sendKey = postedSendKey || crypto.randomUUID();
	const formStep = (
		fields: Partial<{
			fieldErrors: Record<string, string[] | undefined>;
			formError: string;
			preview: {
				name: string;
				email: string;
				subject: string;
				body: string;
			};
		}>,
	) => ({
		step: "form" as const,
		fieldErrors: undefined,
		formError: undefined,
		preview: undefined,
		...fields,
		echo,
		sendKey,
	});

	const portalId = (await firstPortalsByEvent(db, event.id)).get(event.id);
	const origin = new URL(request.url).origin;
	const portalLink = portalId ? portalUrl(origin, event.slug, portalId) : null;

	if (intent === "preview") {
		const previewId = String(form.get("previewContact") ?? "");
		const target = recipients.find((c) => c.id === previewId) ?? recipients[0];
		if (!target) {
			return formStep({ formError: "No recipients to preview." });
		}
		const values = buildMergeValues(target, event.name, portalLink);
		return formStep({
			preview: {
				name: `${target.firstName} ${target.lastName}`.trim(),
				email: target.email,
				subject: renderMergeFields(echo.subject, values),
				body: renderMergeFields(echo.body, values),
			},
		});
	}

	const parsed = Composition.safeParse(echo);
	if (!parsed.success) {
		return formStep({ fieldErrors: z.flattenError(parsed.error).fieldErrors });
	}
	if (recipients.length === 0) {
		return formStep({ formError: "No recipients match this selection." });
	}
	if (recipients.length > MAX_RECIPIENTS) {
		return formStep({
			formError: `This selection has ${recipients.length} recipients — the limit is ${MAX_RECIPIENTS} per send. Narrow the filter and send in batches.`,
		});
	}
	if (
		!portalLink &&
		templateUsesTag(
			`${parsed.data.subject}\n${parsed.data.body}`,
			"portal_link",
		)
	) {
		return formStep({
			formError:
				"This event has no speaker portal yet, so {{portal_link}} would render blank — remove the tag or create the portal first.",
		});
	}

	try {
		assertAnnouncementsConfigured(env);
	} catch (error) {
		const reason = errorMessage(error);
		track("contacts.bulk_email_failed", { eventId: event.id, error: reason });
		// The assertion's message IS the operator-facing copy — one config
		// failure, one form error, never a per-recipient "failed" outcome.
		return formStep({ formError: reason });
	}

	const timings = createTimings();
	const outcomes: Array<{
		id: string;
		name: string;
		email: string;
		outcome: "sent" | "suppressed" | "duplicate" | "failed";
	}> = [];
	try {
		await timings.time("send", async () => {
			for (const contact of recipients) {
				const values = buildMergeValues(contact, event.name, portalLink);
				const name = `${contact.firstName} ${contact.lastName}`.trim();
				try {
					const result = await sendAnnouncement(env, origin, {
						to: normalizeEmail(contact.email),
						// Replies must reach the organizer who composed the blast, not
						// the sender address.
						replyTo: user.email,
						subject: renderMergeFields(parsed.data.subject, values),
						html: renderEmailHtml(parsed.data.body, values),
						dedupeKey: `bulk:${sendKey}:${contact.id}`,
						eventId: event.id,
					});
					outcomes.push({
						id: contact.id,
						name,
						email: contact.email,
						outcome: result.suppressed
							? "suppressed"
							: result.deduped
								? "duplicate"
								: "sent",
					});
				} catch (error) {
					// One undeliverable address must not block the recipients after
					// it — record the failure (the reason is on the outbox row) and
					// keep going.
					track("contacts.bulk_email_send_failed", {
						eventId: event.id,
						contactId: contact.id,
						error: errorMessage(error),
					});
					outcomes.push({
						id: contact.id,
						name,
						email: contact.email,
						outcome: "failed",
					});
				}
			}
		});
	} catch (error) {
		track("contacts.bulk_email_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		// The echoed sendKey makes this retry idempotent: recipients who already
		// got the email dedupe on `bulk:<sendKey>:<contactId>` and are skipped.
		return formStep({
			formError:
				"Sending stopped partway — retry to send only to the recipients who haven't received it yet.",
		});
	}
	const sent = outcomes.filter((o) => o.outcome === "sent").length;
	const suppressed = outcomes.filter((o) => o.outcome === "suppressed").length;
	const failed = outcomes.filter((o) => o.outcome === "failed").length;
	track("contacts.bulk_email_sent", {
		eventId: event.id,
		recipients: outcomes.length,
		sent,
		suppressed,
		failed,
	});
	if (failed > 0) {
		return formStep({
			formError: `${failed} ${failed === 1 ? "recipient" : "recipients"} failed. Retry to send only to recipients who have not received it yet.`,
		});
	}
	return {
		step: "sent" as const,
		sent,
		suppressed,
		failed,
		duplicates: outcomes.filter((o) => o.outcome === "duplicate").length,
		outcomes,
		subject: parsed.data.subject,
	};
}

const OUTCOME_COPY = {
	sent: { tone: "success", label: "sent" },
	suppressed: { tone: "neutral", label: "skipped — unsubscribed" },
	duplicate: { tone: "info", label: "already sent (duplicate submit)" },
	failed: { tone: "danger", label: "failed — see Email history" },
} as const;

export default function ComposeBulkEmail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const { recipients, selection, selectionLabel, template } = loaderData;
	const fromDirectory = selection.directoryEmails !== undefined;
	const backTo = fromDirectory ? "/admin/crm/directory" : "/admin/contacts";
	const backLabel = fromDirectory ? "Back to directory" : "Back to speakers";
	const recipientNoun = fromDirectory
		? recipients.length === 1
			? "person"
			: "people"
		: recipients.length === 1
			? "speaker"
			: "speakers";
	const state = actionData;
	// A re-render after preview/validation/partial-failure keeps the POSTed
	// sendKey (retry stays idempotent); a fresh visit mints a fresh one.
	const sendKey = state?.step === "form" ? state.sendKey : loaderData.sendKey;

	if (state?.step === "sent") {
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
				<PageHeader
					title="Email sent"
					count={`${state.sent} delivered`}
					subtitle={`"${state.subject}" — every send is logged to the email history.`}
					actions={
						<>
							<ButtonLink to="/admin/emails/history" variant="ghost">
								View Email history
							</ButtonLink>
							<ButtonLink to={backTo} variant="ghost">
								{backLabel}
							</ButtonLink>
						</>
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
						{state.failed > 0 && (
							<StatusBadge tone="danger">
								{state.failed} failed — see Email history
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
					<ButtonLink to={backTo} variant="ghost">
						{backLabel}
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
							<ButtonLink to={backTo} variant="ghost">
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
						<Form method="post" className="flex flex-col gap-[13px]">
							{/* Snapshot the RESOLVED set: "Send to N speakers" targets exactly
							    the names listed above, even if the roster changes mid-compose. */}
							{selection.directoryEmails !== undefined ? (
								<Input
									type="hidden"
									name="directoryEmails"
									value={recipients
										.map((recipient) => normalizeEmail(recipient.email))
										.join(",")}
									readOnly
								/>
							) : (
								<Input
									type="hidden"
									name="ids"
									value={recipients.map((recipient) => recipient.id).join(",")}
									readOnly
								/>
							)}
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
								{CAMPAIGN_MERGE_TAGS.map((t) => `{{${t}}}`).join("  ")}
							</p>
							{!echoBody && (
								<p>
									Starting from scratch?{" "}
									<ButtonLink
										to={`?${new URLSearchParams({
											...(selection.directoryEmails !== undefined
												? {
														directoryEmails:
															selection.directoryEmails.join(","),
													}
												: {}),
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
									disabled={busy}
									variant="ghost"
								>
									Preview for recipient
								</Button>
								<Button
									type="submit"
									name="intent"
									value="send"
									icon="mail"
									disabled={busy || !sendKey}
								>
									Send to {recipients.length} {recipientNoun}
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
