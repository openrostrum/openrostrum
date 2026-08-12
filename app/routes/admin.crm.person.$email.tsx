import { and, asc, eq } from "drizzle-orm";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { PIPELINE_STAGE } from "~/db/constants";
import { events, pipelineCards } from "~/db/schema";
import { CONTACT_STATUS_TONE } from "~/components/contact-status";
import { IdentityPanel } from "~/components/crm-identity";
import { CrmNotesPanel } from "~/components/crm-notes";
import { RichHtml } from "~/components/rich-html";
import { SectionHeading } from "~/components/section-heading";
import {
	queryContactFieldValues,
	saveContactFieldValue,
} from "~/domain/crm-fields";
import {
	addCrmNote,
	addToEventNotice,
	enrollInPipeline,
	queryNotes,
	queryPerson,
} from "~/domain/crm";
import { queryContactMergeHistory } from "~/domain/contact-merge";
import {
	getActiveEvent,
	normalizeEmail,
	requireAdmin,
	resolveActiveOrg,
} from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { resolveTimezone } from "~/lib/event-time";
import { formatDateUTC, formatRole } from "~/lib/format";
import { PIPELINE_STAGE_LABEL, PIPELINE_STAGE_TONE } from "~/lib/pipeline";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Input,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	TextLink,
	Textarea,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm.person.$email";

const NOTES_SHOWN = 50;

const AddToEvent = z.object({
	targetEventId: z.string().min(1, "Pick an event."),
});
const Enroll = z.object({ stage: z.enum(PIPELINE_STAGE) });

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) throw redirect("/admin/crm");
	const email = normalizeEmail(params.email);
	// Notes are written against the event's working day, not the worker's UTC.
	const activeEvent = await getActiveEvent(env, user);
	const [person, customFields, noteThread, card, orgEvents, mergeHistory] =
		await timings.time("db", () =>
			Promise.all([
				queryPerson(db, org.id, email),
				queryContactFieldValues(db, org.id, email),
				queryNotes(db, org.id, email, NOTES_SHOWN),
				db
					.select({
						id: pipelineCards.id,
						stage: pipelineCards.stage,
						score: pipelineCards.score,
					})
					.from(pipelineCards)
					.where(
						and(
							eq(pipelineCards.organizationId, org.id),
							eq(pipelineCards.email, email),
						),
					)
					.limit(1)
					.then((rows) => rows[0] ?? null),
				db
					.select({ id: events.id, name: events.name })
					.from(events)
					.where(eq(events.organizationId, org.id))
					.orderBy(asc(events.createdAt)),
				queryContactMergeHistory(db, org.id, email, 20),
			]),
		);
	if (!person) {
		throw data("No such person in this organization's directory", {
			status: 404,
		});
	}
	const appearedEventIds = new Set(person.appearances.map((a) => a.eventId));
	return data(
		{
			person,
			customFields,
			email,
			notes: noteThread.notes,
			noteCount: noteThread.total,
			card,
			mergeHistory,
			justMerged: new URL(request.url).searchParams.get("merged") === "1",
			addableEvents: orgEvents.filter((e) => !appearedEventIds.has(e.id)),
			timeZone: activeEvent ? resolveTimezone(activeEvent.timezone) : "UTC",
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveActiveOrg(env, user);
	if (!org) return { formError: "No organization is configured yet." };
	const email = normalizeEmail(params.email);
	const actor = { id: user.id, name: user.name ?? user.email };
	const form = await request.formData();
	const intent = form.get("intent");
	const timings = createTimings();

	if (intent === "save-custom-field") {
		const fieldId = String(form.get("fieldId") ?? "");
		const rawValues = form.getAll("value");
		const value = String(rawValues.at(-1) ?? "");
		try {
			const result = await timings.time("db", () =>
				saveContactFieldValue(db, org.id, email, fieldId, value),
			);
			if (!result.ok) return { customFieldError: result.reason };
			track("crm.field_value_saved", { orgId: org.id, fieldId });
			return data(
				{ notice: "Organization field saved." },
				{ headers: { "Server-Timing": timings.header() } },
			);
		} catch (error) {
			track("crm.field_value_failed", {
				orgId: org.id,
				fieldId,
				error: errorMessage(error),
			});
			return {
				customFieldError: "Could not save the field — please try again.",
			};
		}
	}

	if (intent === "add-note") {
		let result: Awaited<ReturnType<typeof addCrmNote>>;
		try {
			result = await timings.time("db", () =>
				addCrmNote(db, org.id, email, actor, String(form.get("body") ?? "")),
			);
		} catch (error) {
			track("crm.note_failed", { orgId: org.id, error: errorMessage(error) });
			return { noteError: "Could not save the note — please try again." };
		}
		if (!result.ok) return { noteError: result.reason };
		track("crm.note_added", { orgId: org.id });
		return data(
			{ notice: "Note saved." },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (intent === "add-to-event") {
		const parsed = AddToEvent.safeParse({
			targetEventId: form.get("targetEventId"),
		});
		if (!parsed.success) {
			return { formError: parsed.error.issues[0]?.message ?? "Pick an event." };
		}
		const { outcome, ...result } = await timings.time("db", () =>
			addToEventNotice(db, org.id, [email], parsed.data.targetEventId),
		);
		track("crm.added_to_event", {
			orgId: org.id,
			eventId: parsed.data.targetEventId,
			outcome,
		});
		return data(result, { headers: { "Server-Timing": timings.header() } });
	}

	if (intent === "enroll") {
		const parsed = Enroll.safeParse({ stage: form.get("stage") });
		if (!parsed.success) {
			return { formError: parsed.error.issues[0]?.message ?? "Pick a stage." };
		}
		const result = await timings.time("db", () =>
			enrollInPipeline(db, org.id, {
				email,
				stage: parsed.data.stage,
				score: null,
				rationale: null,
				actor,
			}),
		);
		if (!result.ok) return { formError: result.reason };
		track("crm.enrolled", { orgId: org.id, cardId: result.cardId });
		return redirect(`/admin/crm/pipeline/${result.cardId}`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return { formError: "Unknown action." };
}

function CustomFieldControl({
	field,
}: {
	field: {
		type:
			| "text"
			| "textarea"
			| "dropdown"
			| "checkbox"
			| "number"
			| "email"
			| "phone"
			| "date";
		value: string | null;
		options: string[] | null;
	};
}) {
	if (field.type === "textarea") {
		return <Textarea name="value" rows={3} defaultValue={field.value ?? ""} />;
	}
	if (field.type === "dropdown") {
		return (
			<Select name="value" defaultValue={field.value ?? ""}>
				<option value="">Not set</option>
				{field.options?.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</Select>
		);
	}
	if (field.type === "checkbox") {
		return (
			<Select name="value" defaultValue={field.value ?? "false"}>
				<option value="false">No</option>
				<option value="true">Yes</option>
			</Select>
		);
	}
	const type =
		field.type === "number"
			? "number"
			: field.type === "email"
				? "email"
				: field.type === "phone"
					? "tel"
					: field.type === "date"
						? "date"
						: "text";
	return <Input name="value" type={type} defaultValue={field.value ?? ""} />;
}

export default function CrmPerson({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		person,
		customFields,
		email,
		notes,
		noteCount,
		card,
		mergeHistory,
		justMerged,
		addableEvents,
		timeZone,
	} = loaderData;
	const name = `${person.firstName} ${person.lastName}`.trim();
	const busy = useBusy();
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const noteError =
		actionData && "noteError" in actionData ? actionData.noteError : undefined;
	const customFieldError =
		actionData && "customFieldError" in actionData
			? actionData.customFieldError
			: undefined;
	const notice =
		actionData && "notice" in actionData
			? actionData.notice
			: justMerged
				? "Contacts merged. This profile now carries the combined history."
				: undefined;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center gap-3">
				<ButtonLink to="/admin/crm/directory" variant="ghost">
					← Back to directory
				</ButtonLink>
				{notice && <p>{notice}</p>}
				{formError && <ErrorText>{formError}</ErrorText>}
			</div>

			{person.sameNamePeople.length > 0 && (
				<Panel>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge tone="caution">possible duplicate</StatusBadge>
						<span>
							Another directory entry shares this name under a different email:
						</span>
						{person.sameNamePeople.map((p) => (
							<span key={p.email} className="flex items-center gap-2">
								<TextLink
									to={`/admin/crm/person/${encodeURIComponent(p.email)}`}
								>
									{p.email}
								</TextLink>
								<ButtonLink
									to={`/admin/crm/merge?source=${encodeURIComponent(p.email)}&survivor=${encodeURIComponent(email)}`}
									variant="ghost"
								>
									Review merge
								</ButtonLink>
							</span>
						))}
						{person.sameNameTotal > person.sameNamePeople.length && (
							<span>
								+{person.sameNameTotal - person.sameNamePeople.length} more in
								the directory
							</span>
						)}
					</div>
				</Panel>
			)}

			<div className="grid items-start gap-5 lg:grid-cols-2">
				<IdentityPanel
					heading="Profile"
					name={name}
					email={email}
					lines={[formatRole(person) || "No title or company on record"]}
				>
					{person.bio && <RichHtml html={person.bio} />}
				</IdentityPanel>

				<Panel>
					<div className="flex flex-col gap-3">
						<SectionHeading
							aside={
								card && (
									<StatusBadge tone={PIPELINE_STAGE_TONE[card.stage]}>
										{PIPELINE_STAGE_LABEL[card.stage]}
									</StatusBadge>
								)
							}
						>
							Sourcing
						</SectionHeading>
						{card ? (
							<p>
								In the pipeline
								{card.score != null ? ` with score ${card.score}` : ""} —{" "}
								<TextLink to={`/admin/crm/pipeline/${card.id}`}>
									open the card
								</TextLink>{" "}
								for stage history and moves.
							</p>
						) : (
							<Form method="post" className="flex flex-wrap items-end gap-3">
								<Field label="Enroll in the pipeline at">
									<Select name="stage" defaultValue="identified">
										{PIPELINE_STAGE.map((s) => (
											<option key={s} value={s}>
												{PIPELINE_STAGE_LABEL[s]}
											</option>
										))}
									</Select>
								</Field>
								<Button
									type="submit"
									name="intent"
									value="enroll"
									icon="plus"
									disabled={busy}
								>
									Enroll
								</Button>
							</Form>
						)}
						{addableEvents.length > 0 ? (
							<Form method="post" className="flex flex-wrap items-end gap-3">
								<Field label="Add to an event they're not in yet">
									<Select name="targetEventId" defaultValue="">
										<option value="" disabled>
											Pick an event…
										</option>
										{addableEvents.map((e) => (
											<option key={e.id} value={e.id}>
												{e.name}
											</option>
										))}
									</Select>
								</Field>
								<Button
									type="submit"
									name="intent"
									value="add-to-event"
									icon="plus"
									disabled={busy}
								>
									Add to event
								</Button>
							</Form>
						) : (
							<p>Already a contact in every one of your events.</p>
						)}
					</div>
				</Panel>
			</div>

			<Panel>
				<div className="flex flex-col gap-3">
					<SectionHeading>Organization fields</SectionHeading>
					{customFieldError && <ErrorText>{customFieldError}</ErrorText>}
					{customFields.length === 0 ? (
						<EmptyState
							icon="clipboard"
							title="No person fields defined"
							body="Create organization-wide fields, then set their values on every directory profile."
							action={
								<ButtonLink to="/admin/crm/fields" variant="ghost">
									Manage person fields
								</ButtonLink>
							}
						/>
					) : (
						customFields.map((field) => (
							<Form
								key={field.id}
								method="post"
								className="flex flex-wrap items-end gap-3"
							>
								<Input type="hidden" name="fieldId" value={field.id} readOnly />
								<Field label={field.name}>
									<CustomFieldControl field={field} />
								</Field>
								{field.description && <p>{field.description}</p>}
								<Button
									type="submit"
									name="intent"
									value="save-custom-field"
									disabled={busy}
								>
									Save field
								</Button>
							</Form>
						))
					)}
				</div>
			</Panel>

			<div className="flex flex-col gap-3">
				<Table>
					<THead>
						<Th>Event</Th>
						<Th>Status</Th>
						<Th>Sessions</Th>
					</THead>
					<TBody>
						{person.appearances.map((a) => (
							<Tr key={a.contactId}>
								<Td kind="strong">{a.eventName}</Td>
								<Td>
									<StatusBadge tone={CONTACT_STATUS_TONE[a.status]}>
										{a.status}
									</StatusBadge>
								</Td>
								<Td kind="mono">{a.sessionCount}</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			</div>

			<div className="flex flex-col gap-3">
				<SectionHeading
					aside={
						mergeHistory.merges.length > 0 && (
							<StatusBadge tone="neutral">
								{mergeHistory.total} completed
							</StatusBadge>
						)
					}
				>
					Merge history
				</SectionHeading>
				{mergeHistory.merges.length > 0 ? (
					<>
						<Table>
							<THead>
								<Th>Retired identity</Th>
								<Th>Completed</Th>
								<Th>By</Th>
								<Th>Movements recorded</Th>
							</THead>
							<TBody>
								{mergeHistory.merges.map((merge) => (
									<Tr key={merge.id}>
										<Td kind="mono">{merge.sourceEmail}</Td>
										<Td kind="mono">{formatDateUTC(merge.createdAt)}</Td>
										<Td>{merge.actorName}</Td>
										<Td kind="mono">
											{Object.values(merge.summary).reduce(
												(total, value) => total + value,
												0,
											)}
										</Td>
									</Tr>
								))}
							</TBody>
						</Table>
						{mergeHistory.total > mergeHistory.merges.length && (
							<p>
								+{mergeHistory.total - mergeHistory.merges.length} older merges
								not shown
							</p>
						)}
					</>
				) : (
					<Panel>
						<EmptyState
							icon="users"
							title="No completed merges"
							body="This person has not absorbed another contact yet. Review possible duplicates in the directory before combining records."
							action={
								<ButtonLink to="/admin/crm/directory" variant="ghost">
									Review possible duplicates
								</ButtonLink>
							}
						/>
					</Panel>
				)}
			</div>

			<CrmNotesPanel
				notes={notes}
				total={noteCount}
				timeZone={timeZone}
				error={noteError}
			/>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="users"
				title="Person not found"
				body="Nobody with this email exists in your organization's directory."
				action={
					<ButtonLink to="/admin/crm/directory" variant="ghost">
						Back to the directory
					</ButtonLink>
				}
			/>
		</Panel>
	);
}
