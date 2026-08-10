import { and, asc, eq } from "drizzle-orm";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { PIPELINE_STAGE } from "~/db/constants";
import { crmNotes, events, pipelineCards } from "~/db/schema";
import { CONTACT_STATUS_TONE } from "~/components/contact-status";
import { IdentityPanel } from "~/components/crm-identity";
import { CrmNotesPanel } from "~/components/crm-notes";
import { RichHtml } from "~/components/rich-html";
import { SectionHeading } from "~/components/section-heading";
import {
	addPersonToEvent,
	enrollInPipeline,
	findOrgEvent,
	queryNotes,
	queryPerson,
	resolveCrmOrg,
} from "~/domain/crm";
import { normalizeEmail, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { PIPELINE_STAGE_LABEL, PIPELINE_STAGE_TONE } from "~/lib/pipeline";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm.person.$email";

const NOTES_SHOWN = 50;

const AddNote = z.object({
	body: z
		.string()
		.trim()
		.min(1, "Write the note before saving.")
		.max(4000, "Keep notes under 4,000 characters."),
});
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
	const org = await timings.time("org", () => resolveCrmOrg(env, db, user));
	if (!org) throw redirect("/admin/crm");
	const email = normalizeEmail(params.email);
	const [person, noteThread, card, orgEvents] = await timings.time("db", () =>
		Promise.all([
			queryPerson(db, org.id, email),
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
			email,
			notes: noteThread.notes,
			noteCount: noteThread.total,
			card,
			addableEvents: orgEvents.filter((e) => !appearedEventIds.has(e.id)),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveCrmOrg(env, db, user);
	if (!org) return { formError: "No organization is configured yet." };
	const email = normalizeEmail(params.email);
	const actor = { id: user.id, name: user.name ?? user.email };
	const form = await request.formData();
	const intent = form.get("intent");
	const timings = createTimings();

	if (intent === "add-note") {
		const parsed = AddNote.safeParse({ body: form.get("body") });
		if (!parsed.success) {
			return { noteError: parsed.error.issues[0]?.message ?? "Invalid note." };
		}
		try {
			await timings.time("db", () =>
				db.insert(crmNotes).values({
					organizationId: org.id,
					email,
					authorId: actor.id,
					authorName: actor.name,
					body: parsed.data.body,
				}),
			);
		} catch (error) {
			track("crm.note_failed", { orgId: org.id, error: errorMessage(error) });
			return { noteError: "Could not save the note — please try again." };
		}
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
		const result = await timings.time("db", async () => {
			// Name lookup doubles as the org check; addPersonToEvent re-verifies
			// internally, so a forged event id can never be written into.
			const target = await findOrgEvent(db, org.id, parsed.data.targetEventId);
			if (!target) {
				return {
					formError: "That event does not belong to your organization.",
				};
			}
			const outcome = await addPersonToEvent(db, org.id, email, target.id);
			track("crm.added_to_event", {
				orgId: org.id,
				eventId: target.id,
				outcome,
			});
			if (outcome === "missing" || outcome === "foreign") {
				return { formError: "This person is no longer in the directory." };
			}
			return {
				notice:
					outcome === "added"
						? `Added to ${target.name} — profile fields carried over, workflow status starts at pending.`
						: `Already a contact in ${target.name}.`,
			};
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

export default function CrmPerson({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { person, email, notes, noteCount, card, addableEvents } = loaderData;
	const name = `${person.firstName} ${person.lastName}`.trim();
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const noteError =
		actionData && "noteError" in actionData ? actionData.noteError : undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;

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
							<TextLink
								key={p.email}
								to={`/admin/crm/person/${encodeURIComponent(p.email)}`}
							>
								{p.email}
							</TextLink>
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
					lines={[
						[person.jobTitle, person.companyName].filter(Boolean).join(" · ") ||
							"No title or company on record",
					]}
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
								<Button type="submit" name="intent" value="enroll" icon="plus">
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

			<CrmNotesPanel notes={notes} total={noteCount} error={noteError} />
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
