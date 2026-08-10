import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { useState } from "react";
import { data, Form, isRouteErrorResponse, redirect } from "react-router";
import { z } from "zod";
import { type Db, getDb } from "~/db";
import { CONTACT_STATUS } from "~/db/constants";
import {
	contacts,
	emailOutbox,
	insertContactSchema,
	participants,
	passwordResets,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "~/db/schema";
import { RichTextEditor } from "~/components/rich-text";
import {
	getActiveEvent,
	hasSetPassword,
	mintSentinelHash,
	normalizeEmail,
	requireAdmin,
} from "~/lib/auth";
import { errorMessage, isUniqueViolation } from "~/lib/errors";
import { formatDateUTC, textLength } from "~/lib/format";
import { escapeHtml, sanitizeHtml } from "~/lib/html";
import { firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { TASK_STATUS_LABEL, TASK_STATUS_TONE } from "~/lib/task-status";
import { createTimings, track } from "~/lib/track";
import { getEmailSender } from "~/ports/email";
import {
	Avatar,
	Button,
	ButtonLink,
	ConfirmButton,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Table,
	TBody,
	Td,
	Textarea,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.contacts_.$id";

const UpdateContact = insertContactSchema
	.pick({
		firstName: true,
		lastName: true,
		email: true,
		jobTitle: true,
		companyName: true,
		mobilePhone: true,
		bio: true,
		linkedinUrl: true,
		twitterUrl: true,
		facebookUrl: true,
		websiteUrl: true,
		logisticsNotes: true,
		status: true,
	})
	.extend({
		firstName: z.string().min(1, "First name is required"),
		lastName: z.string().min(1, "Last name is required"),
		email: z.email("Enter a valid email address"),
		status: z.enum(CONTACT_STATUS),
	});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

async function getScopedContact(
	db: ReturnType<typeof getDb>,
	id: string,
	eventId: string,
) {
	const [contact] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.id, id), eq(contacts.eventId, eventId)))
		.limit(1);
	return contact ?? null;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw data("Contact not found", { status: 404 });
	const db = getDb(env);
	const timings = createTimings();

	const contact = await timings.time("db", () =>
		getScopedContact(db, params.id, event.id),
	);
	if (!contact) throw data("Contact not found", { status: 404 });

	const [sessions, assignments, emails] = await timings.time("relations", () =>
		Promise.all([
			db
				.select({
					id: submissions.id,
					title: submissions.title,
					status: submissions.status,
					role: participants.role,
				})
				.from(participants)
				.innerJoin(submissions, eq(participants.submissionId, submissions.id))
				.where(eq(participants.contactId, contact.id))
				.orderBy(desc(submissions.createdAt)),
			db
				.select({
					id: taskAssignments.id,
					name: tasks.name,
					status: taskAssignments.status,
					dueAt: taskAssignments.dueAt,
				})
				.from(taskAssignments)
				.innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
				.where(eq(taskAssignments.contactId, contact.id))
				.orderBy(desc(taskAssignments.createdAt)),
			db
				.select({
					id: emailOutbox.id,
					subject: emailOutbox.subject,
					status: emailOutbox.status,
					createdAt: emailOutbox.createdAt,
				})
				.from(emailOutbox)
				.where(
					and(
						eq(emailOutbox.to, normalizeEmail(contact.email)),
						eq(emailOutbox.eventId, event.id),
					),
				)
				.orderBy(desc(emailOutbox.createdAt))
				.limit(10),
		]),
	);

	// Portal access state + the on-screen copyable invite link (no inbox needed).
	let hasPassword = false;
	let inviteUrl: string | null = null;
	const origin = new URL(request.url).origin;
	if (contact.userId) {
		const [account] = await db
			.select({ passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.id, contact.userId))
			.limit(1);
		hasPassword = account ? hasSetPassword(account.passwordHash) : false;
		if (hasPassword) {
			const portalId = (await firstPortalsByEvent(db, event.id)).get(event.id);
			if (portalId) inviteUrl = portalUrl(origin, event.slug, portalId);
		} else {
			const [pending] = await db
				.select({ token: passwordResets.token })
				.from(passwordResets)
				.where(
					and(
						eq(passwordResets.userId, contact.userId),
						isNull(passwordResets.organizationId),
						isNull(passwordResets.usedAt),
						gt(passwordResets.expiresAt, new Date()),
					),
				)
				.orderBy(desc(passwordResets.createdAt))
				.limit(1);
			if (pending) inviteUrl = `${origin}/set-password/${pending.token}`;
		}
	}

	const url = new URL(request.url);
	return data(
		{
			contact,
			sessions,
			assignments,
			emails,
			hasAccount: contact.userId !== null,
			hasPassword,
			inviteUrl,
			inviteKey: crypto.randomUUID(),
			saved: url.searchParams.has("saved"),
			eventName: event.name,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw data("Contact not found", { status: 404 });
	const db = getDb(env);
	const contact = await getScopedContact(db, params.id, event.id);
	if (!contact) throw data("Contact not found", { status: 404 });

	const form = await request.formData();
	const intent = String(form.get("intent") ?? "update");

	if (intent === "delete") {
		await db
			.delete(contacts)
			.where(and(eq(contacts.id, contact.id), eq(contacts.eventId, event.id)));
		track("contact.deleted", { eventId: event.id, contactId: contact.id });
		return redirect("/admin/contacts");
	}

	if (intent === "invite") {
		const inviteKey = String(form.get("inviteKey") ?? crypto.randomUUID());
		const email = normalizeEmail(contact.email);
		const [existing] = await db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		let accountId = existing?.id;
		type BatchStatement = Parameters<Db["batch"]>[0][number];
		const statements: BatchStatement[] = [];
		if (!existing) {
			accountId = crypto.randomUUID();
			statements.push(
				db.insert(users).values({
					id: accountId,
					email,
					passwordHash: mintSentinelHash(),
					name: `${contact.firstName} ${contact.lastName}`.trim(),
					role: "speaker",
				}),
			);
		}
		if (contact.userId !== accountId && accountId) {
			statements.push(
				db
					.update(contacts)
					.set({ userId: accountId })
					.where(eq(contacts.id, contact.id)),
			);
		}

		const hasPassword = existing
			? hasSetPassword(existing.passwordHash)
			: false;
		let token: string | null = null;
		if (!hasPassword && accountId) {
			token = crypto.randomUUID();
			statements.push(
				db.insert(passwordResets).values({
					userId: accountId,
					organizationId: null, // speaker invite — must NEVER grant org membership
					token,
					expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
				}),
			);
		}

		const origin = new URL(request.url).origin;
		const portalId = (await firstPortalsByEvent(db, event.id)).get(event.id);
		const portalLink = portalId
			? portalUrl(origin, event.slug, portalId)
			: `${origin}/login`;
		const inviteUrl = token ? `${origin}/set-password/${token}` : portalLink;

		try {
			const [head, ...rest] = statements;
			if (head) await db.batch([head, ...rest]);
			await getEmailSender(env).send({
				to: email,
				subject: `Your speaker portal for ${event.name}`,
				html: [
					`<p>Hi ${escapeHtml(contact.firstName)},</p>`,
					`<p>You've been invited to the speaker portal for ${escapeHtml(event.name)}.</p>`,
					token
						? `<p>Set your password to get started: <a href="${inviteUrl}">${inviteUrl}</a></p>`
						: `<p>Open your portal: <a href="${portalLink}">${portalLink}</a></p>`,
				].join(""),
				kind: "transactional",
				dedupeKey: `portal_invite:${contact.id}:${inviteKey}`,
				eventId: event.id,
			});
		} catch (error) {
			track("contact.invite_failed", {
				eventId: event.id,
				contactId: contact.id,
				error: errorMessage(error),
			});
			return {
				fieldErrors: undefined,
				formError: "Could not send the invite — please try again.",
				invited: false,
			};
		}
		track("contact.invited", { eventId: event.id, contactId: contact.id });
		return { fieldErrors: undefined, formError: undefined, invited: true };
	}

	const parsed = UpdateContact.safeParse({
		firstName: form.get("firstName"),
		lastName: form.get("lastName"),
		email: normalizeEmail(String(form.get("email") ?? "")),
		jobTitle: form.get("jobTitle") || null,
		companyName: form.get("companyName") || null,
		mobilePhone: form.get("mobilePhone") || null,
		bio: form.get("bio") || null,
		linkedinUrl: form.get("linkedinUrl") || null,
		twitterUrl: form.get("twitterUrl") || null,
		facebookUrl: form.get("facebookUrl") || null,
		websiteUrl: form.get("websiteUrl") || null,
		logisticsNotes: form.get("logisticsNotes") || null,
		status: form.get("status"),
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
			invited: false,
		};
	}
	// Bio is rich text shared with the portal profile — sanitize on every
	// write path, and cap by TEXT length (an HTML-length cap would let markup
	// eat the allowance).
	const bio = parsed.data.bio ? await sanitizeHtml(parsed.data.bio) : null;
	if (bio && textLength(bio) > 5000) {
		return {
			fieldErrors: { bio: ["Keep the biography under 5,000 characters."] },
			formError: undefined,
			invited: false,
		};
	}
	const timings = createTimings();
	try {
		await timings.time("db", () =>
			db
				.update(contacts)
				.set({ ...parsed.data, bio: bio || null })
				.where(
					and(eq(contacts.id, contact.id), eq(contacts.eventId, event.id)),
				),
		);
	} catch (error) {
		if (isUniqueViolation(error)) {
			return {
				fieldErrors: {
					email: ["Another contact already uses this email for this event."],
				},
				formError: undefined,
				invited: false,
			};
		}
		track("contact.update_failed", {
			eventId: event.id,
			contactId: contact.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the changes — please try again.",
			invited: false,
		};
	}
	track("contact.updated", {
		eventId: event.id,
		contactId: contact.id,
		status: parsed.data.status,
	});
	return redirect(`/admin/contacts/${contact.id}?saved=1`, {
		headers: { "Server-Timing": timings.header() },
	});
}

function formatDate(value: Date | null): string {
	return value ? formatDateUTC(value) : "—";
}

export default function ContactRecord({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		contact,
		sessions,
		assignments,
		emails,
		hasAccount,
		hasPassword,
		inviteUrl,
		inviteKey,
		saved,
	} = loaderData;
	const name = `${contact.firstName} ${contact.lastName}`.trim();
	const [copied, setCopied] = useState(false);
	const fieldErrors = actionData?.fieldErrors;

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={name}
				subtitle={contact.email}
				actions={
					<>
						<ButtonLink
							to={`/admin/contacts/compose?ids=${contact.id}`}
							variant="ghost"
							icon="mail"
						>
							Email
						</ButtonLink>
						<Form method="post">
							<Input
								type="hidden"
								name="inviteKey"
								value={inviteKey}
								readOnly
							/>
							<Button
								type="submit"
								name="intent"
								value="invite"
								variant="ghost"
								icon="star"
							>
								Send portal invite
							</Button>
						</Form>
						<Form method="post">
							<ConfirmButton
								label="Delete"
								prompt={`Delete ${name}? Their session roles and task assignments go too; sessions are kept. This cannot be undone.`}
								confirmLabel="Delete contact"
								name="intent"
								value="delete"
							/>
						</Form>
					</>
				}
			/>

			<Panel>
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-3">
						<Avatar name={name} size={34} />
						<div className="flex flex-col">
							<strong>Portal access</strong>
							<span>
								{!hasAccount &&
									"No portal account yet — send an invite to give this speaker portal access."}
								{hasAccount &&
									!hasPassword &&
									"Invited — waiting for them to set a password. Share the link below directly if needed."}
								{hasAccount &&
									hasPassword &&
									"Has portal access — the portal link is below."}
							</span>
						</div>
					</div>
					{actionData?.invited && (
						<p>
							Invite sent to {contact.email} — logged in the email history
							below.
						</p>
					)}
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
					{inviteUrl && (
						<div className="flex items-end gap-2">
							<div className="min-w-0 flex-1">
								<Field
									label={hasPassword ? "Portal link" : "Invite link (copyable)"}
								>
									<Input
										value={inviteUrl}
										readOnly
										onFocus={(e) => e.currentTarget.select()}
									/>
								</Field>
							</div>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									void navigator.clipboard.writeText(inviteUrl);
									setCopied(true);
								}}
							>
								{copied ? "Copied" : "Copy link"}
							</Button>
						</div>
					)}
				</div>
			</Panel>

			<Panel>
				<Form method="post" className="flex flex-col gap-3">
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
						<Field label="First name" error={fieldErrors?.firstName?.[0]}>
							<Input
								name="firstName"
								defaultValue={contact.firstName}
								invalid={Boolean(fieldErrors?.firstName?.[0])}
							/>
						</Field>
						<Field label="Last name" error={fieldErrors?.lastName?.[0]}>
							<Input
								name="lastName"
								defaultValue={contact.lastName}
								invalid={Boolean(fieldErrors?.lastName?.[0])}
							/>
						</Field>
						<Field label="Email" error={fieldErrors?.email?.[0]}>
							<Input
								name="email"
								type="email"
								defaultValue={contact.email}
								invalid={Boolean(fieldErrors?.email?.[0])}
							/>
						</Field>
						<Field label="Job title">
							<Input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
						</Field>
						<Field label="Company">
							<Input
								name="companyName"
								defaultValue={contact.companyName ?? ""}
							/>
						</Field>
						<Field label="Mobile phone">
							<Input
								name="mobilePhone"
								defaultValue={contact.mobilePhone ?? ""}
							/>
						</Field>
						<Field label="Status" error={fieldErrors?.status?.[0]}>
							<Select name="status" defaultValue={contact.status}>
								{CONTACT_STATUS.map((s) => (
									<option key={s} value={s}>
										{s.charAt(0).toUpperCase() + s.slice(1)}
									</option>
								))}
							</Select>
						</Field>
						<Field label="LinkedIn URL">
							<Input
								name="linkedinUrl"
								defaultValue={contact.linkedinUrl ?? ""}
							/>
						</Field>
						<Field label="X (Twitter) URL">
							<Input
								name="twitterUrl"
								defaultValue={contact.twitterUrl ?? ""}
							/>
						</Field>
						<Field label="Facebook URL">
							<Input
								name="facebookUrl"
								defaultValue={contact.facebookUrl ?? ""}
							/>
						</Field>
						<Field label="Website URL">
							<Input
								name="websiteUrl"
								defaultValue={contact.websiteUrl ?? ""}
							/>
						</Field>
					</div>
					<RichTextEditor
						name="bio"
						label="Bio"
						defaultValue={contact.bio ?? ""}
						maxLength={5000}
						error={fieldErrors?.bio?.[0]}
					/>
					<Field label="Travel & logistics notes">
						<Textarea
							name="logisticsNotes"
							rows={3}
							defaultValue={contact.logisticsNotes ?? ""}
							placeholder="Arrival dates, seating, dietary needs…"
						/>
					</Field>
					<div className="flex items-center gap-3">
						<Button type="submit" name="intent" value="update">
							Save changes
						</Button>
						{saved && <span>Saved.</span>}
					</div>
				</Form>
			</Panel>

			<Table>
				<THead>
					<Th>Session</Th>
					<Th>Role</Th>
					<Th>Status</Th>
				</THead>
				<TBody>
					{sessions.map((s) => (
						<Tr key={s.id}>
							<Td kind="strong">{s.title}</Td>
							<Td>{s.role}</Td>
							<Td>
								<StatusBadge tone={SUBMISSION_STATUS_TONE[s.status]}>
									{s.status.replace("_", " ")}
								</StatusBadge>
							</Td>
						</Tr>
					))}
					{sessions.length === 0 && (
						<EmptyRow colSpan={3}>
							No sessions yet — this contact appears here once they are a
							participant on a submission.
						</EmptyRow>
					)}
				</TBody>
			</Table>

			<div className="grid gap-5 md:grid-cols-2">
				<Table>
					<THead>
						<Th>Task</Th>
						<Th>Due</Th>
						<Th>Status</Th>
					</THead>
					<TBody>
						{assignments.map((a) => (
							<Tr key={a.id}>
								<Td kind="strong">{a.name}</Td>
								<Td kind="mono">{formatDate(a.dueAt)}</Td>
								<Td>
									<StatusBadge tone={TASK_STATUS_TONE[a.status] ?? "neutral"}>
										{TASK_STATUS_LABEL[a.status] ?? a.status}
									</StatusBadge>
								</Td>
							</Tr>
						))}
						{assignments.length === 0 && (
							<EmptyRow colSpan={3}>
								No tasks assigned — onboarding tasks land here when their
								session is accepted.
							</EmptyRow>
						)}
					</TBody>
				</Table>

				<Table>
					<THead>
						<Th>Email</Th>
						<Th>Status</Th>
						<Th>Sent</Th>
					</THead>
					<TBody>
						{emails.map((e) => (
							<Tr key={e.id}>
								<Td kind="strong">{e.subject}</Td>
								<Td>
									<StatusBadge
										tone={e.status === "sent" ? "success" : "neutral"}
									>
										{e.status}
									</StatusBadge>
								</Td>
								<Td kind="mono">{formatDate(e.createdAt)}</Td>
							</Tr>
						))}
						{emails.length === 0 && (
							<EmptyRow colSpan={3}>
								No emails yet — invites and bulk sends to this contact are
								logged here.
							</EmptyRow>
						)}
					</TBody>
				</Table>
			</div>
		</div>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title={notFound ? "Contact not found" : "Failed to load this contact"}
				tone="danger"
				subtitle={
					notFound
						? "This contact doesn't exist in the current event — it may have been deleted."
						: "Something went wrong. Please refresh or try again."
				}
			/>
			<div className="mt-4">
				<ButtonLink to="/admin/contacts" variant="ghost">
					Back to speakers
				</ButtonLink>
			</div>
		</div>
	);
}
