import { and, asc, count, desc, eq } from "drizzle-orm";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { PIPELINE_STAGE } from "~/db/constants";
import { events, pipelineCards, pipelineStageChanges } from "~/db/schema";
import { IdentityPanel } from "~/components/crm-identity";
import { CrmNotesPanel } from "~/components/crm-notes";
import { SectionHeading } from "~/components/section-heading";
import {
	addCrmNote,
	addToEventNotice,
	movePipelineCard,
	queryNotes,
} from "~/domain/crm";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { formatInTimeZone } from "~/lib/dates";
import { PIPELINE_STAGE_LABEL, PIPELINE_STAGE_TONE } from "~/lib/pipeline";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	ConfirmButton,
	EmptyRow,
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
import type { Route } from "./+types/admin.crm.pipeline_.$cardId";

const NOTES_SHOWN = 50;
const HISTORY_SHOWN = 100;

const Move = z.object({ stage: z.enum(PIPELINE_STAGE) });
const AssignToEvent = z.object({
	targetEventId: z.string().min(1, "Pick an event."),
});

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

async function findCard(
	db: ReturnType<typeof getDb>,
	orgId: string,
	cardId: string,
) {
	const [card] = await db
		.select()
		.from(pipelineCards)
		.where(
			and(
				eq(pipelineCards.id, cardId),
				eq(pipelineCards.organizationId, orgId),
			),
		)
		.limit(1);
	return card ?? null;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) throw redirect("/admin/crm");
	const card = await timings.time("card", () =>
		findCard(db, org.id, params.cardId),
	);
	if (!card) {
		throw data("Card not found in your pipeline", { status: 404 });
	}
	const [history, [historyCount], noteThread, orgEvents] = await timings.time(
		"db",
		() =>
			Promise.all([
				db
					.select({
						id: pipelineStageChanges.id,
						fromStage: pipelineStageChanges.fromStage,
						toStage: pipelineStageChanges.toStage,
						changedByName: pipelineStageChanges.changedByName,
						createdAt: pipelineStageChanges.createdAt,
					})
					.from(pipelineStageChanges)
					.where(eq(pipelineStageChanges.cardId, card.id))
					.orderBy(desc(pipelineStageChanges.createdAt))
					.limit(HISTORY_SHOWN),
				db
					.select({ n: count() })
					.from(pipelineStageChanges)
					.where(eq(pipelineStageChanges.cardId, card.id)),
				queryNotes(db, org.id, card.email, NOTES_SHOWN),
				db
					.select({ id: events.id, name: events.name })
					.from(events)
					.where(eq(events.organizationId, org.id))
					.orderBy(asc(events.createdAt)),
			]),
	);
	return data(
		{
			card,
			history,
			historyTotal: historyCount?.n ?? history.length,
			notes: noteThread.notes,
			noteCount: noteThread.total,
			events: orgEvents,
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
	const card = await findCard(db, org.id, params.cardId);
	if (!card) {
		return { formError: "That card is not in your pipeline." };
	}
	const actor = { id: user.id, name: user.name ?? user.email };
	const form = await request.formData();
	const intent = form.get("intent");
	const timings = createTimings();

	if (intent === "move") {
		const parsed = Move.safeParse({ stage: form.get("stage") });
		if (!parsed.success) {
			return { formError: parsed.error.issues[0]?.message ?? "Invalid stage." };
		}
		const result = await timings.time("db", () =>
			movePipelineCard(db, org.id, card.id, parsed.data.stage, actor),
		);
		if (!result.ok) return { formError: result.reason };
		track("crm.card_moved", {
			orgId: org.id,
			cardId: card.id,
			stage: parsed.data.stage,
		});
		return data(
			{ notice: `Moved to ${PIPELINE_STAGE_LABEL[parsed.data.stage]}.` },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (intent === "add-note") {
		let result: Awaited<ReturnType<typeof addCrmNote>>;
		try {
			result = await timings.time("db", () =>
				addCrmNote(
					db,
					org.id,
					card.email,
					actor,
					String(form.get("body") ?? ""),
				),
			);
		} catch (error) {
			track("crm.note_failed", { orgId: org.id, error: errorMessage(error) });
			return { noteError: "Could not save the note — please try again." };
		}
		if (!result.ok) return { noteError: result.reason };
		track("crm.note_added", { orgId: org.id, cardId: card.id });
		return data(
			{ notice: "Note saved." },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (intent === "assign-to-event") {
		const parsed = AssignToEvent.safeParse({
			targetEventId: form.get("targetEventId"),
		});
		if (!parsed.success) {
			return { formError: parsed.error.issues[0]?.message ?? "Pick an event." };
		}
		const { outcome, ...result } = await timings.time("db", () =>
			addToEventNotice(db, org.id, [card.email], parsed.data.targetEventId),
		);
		track("crm.added_to_event", {
			orgId: org.id,
			eventId: parsed.data.targetEventId,
			outcome,
		});
		return data(result, { headers: { "Server-Timing": timings.header() } });
	}

	if (intent === "remove") {
		await timings.time("db", () =>
			db.delete(pipelineCards).where(eq(pipelineCards.id, card.id)),
		);
		track("crm.card_removed", { orgId: org.id, cardId: card.id });
		return redirect("/admin/crm/pipeline", {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return { formError: "Unknown action." };
}

export default function CrmPipelineCard({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { card, history, historyTotal, notes, noteCount, events } = loaderData;
	const name = `${card.firstName} ${card.lastName}`.trim();
	const busy = useBusy();
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const noteError =
		actionData && "noteError" in actionData ? actionData.noteError : undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center gap-3">
				<ButtonLink to="/admin/crm/pipeline" variant="ghost">
					← Back to pipeline
				</ButtonLink>
				{notice && <p>{notice}</p>}
				{formError && <ErrorText>{formError}</ErrorText>}
			</div>

			<div className="grid items-start gap-5 lg:grid-cols-2">
				<IdentityPanel
					heading="Prospect"
					aside={
						<StatusBadge tone={PIPELINE_STAGE_TONE[card.stage]}>
							{PIPELINE_STAGE_LABEL[card.stage]}
						</StatusBadge>
					}
					name={name}
					email={card.email}
					lines={[
						...(card.companyName ? [card.companyName] : []),
						...(card.score != null ? [`Score ${card.score} / 100`] : []),
					]}
					paragraphs={card.rationale ? [card.rationale] : []}
				>
					<p>
						<TextLink
							to={`/admin/crm/person/${encodeURIComponent(card.email)}`}
						>
							Open directory profile
						</TextLink>
					</p>
				</IdentityPanel>

				<Panel>
					<div className="flex flex-col gap-3">
						<SectionHeading>Actions</SectionHeading>
						<Form method="post" className="flex flex-wrap items-end gap-3">
							<Field label="Move to stage">
								<Select name="stage" defaultValue={card.stage}>
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
								value="move"
								variant="ghost"
								disabled={busy}
							>
								Move
							</Button>
						</Form>
						<Form method="post" className="flex flex-wrap items-end gap-3">
							<Field label="Assign to event">
								<Select name="targetEventId" defaultValue="">
									<option value="" disabled>
										Pick an event…
									</option>
									{events.map((e) => (
										<option key={e.id} value={e.id}>
											{e.name}
										</option>
									))}
								</Select>
							</Field>
							<Button
								type="submit"
								name="intent"
								value="assign-to-event"
								icon="plus"
								disabled={busy}
							>
								Add to event
							</Button>
						</Form>
						<Form method="post">
							<ConfirmButton
								label="Remove from pipeline"
								prompt="Remove this card? Notes stay on the person's profile."
								confirmLabel="Remove card"
								name="intent"
								value="remove"
								disabled={busy}
							/>
						</Form>
					</div>
				</Panel>
			</div>

			<CrmNotesPanel notes={notes} total={noteCount} error={noteError} />

			<div className="flex flex-col gap-3">
				<Table>
					<THead>
						<Th>When</Th>
						<Th>Stage change</Th>
						<Th>By</Th>
					</THead>
					<TBody>
						{history.map((h) => (
							<Tr key={h.id}>
								<Td kind="mono">
									{formatInTimeZone(h.createdAt, "UTC", "datetime-zone")}
								</Td>
								<Td kind="strong">
									{h.fromStage
										? `${PIPELINE_STAGE_LABEL[h.fromStage]} → ${PIPELINE_STAGE_LABEL[h.toStage]}`
										: `Enrolled at ${PIPELINE_STAGE_LABEL[h.toStage]}`}
								</Td>
								<Td>{h.changedByName}</Td>
							</Tr>
						))}
						{historyTotal > history.length && (
							<EmptyRow colSpan={3}>
								Showing the {history.length} most recent of {historyTotal} stage
								changes.
							</EmptyRow>
						)}
						{history.length === 0 && (
							<EmptyRow colSpan={3}>
								No stage changes recorded yet — moves land here with a timestamp
								and who made them.
							</EmptyRow>
						)}
					</TBody>
				</Table>
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="clipboard"
				title="Card not found"
				body="This pipeline card doesn't exist in your organization — it may have been removed."
				action={
					<ButtonLink to="/admin/crm/pipeline" variant="ghost">
						Back to the pipeline
					</ButtonLink>
				}
			/>
		</Panel>
	);
}
