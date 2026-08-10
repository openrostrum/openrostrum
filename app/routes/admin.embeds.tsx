import { and, eq } from "drizzle-orm";
import { useState } from "react";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { EMBED_TYPE, embeds } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	EmptyRow,
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
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import { CopyFieldButton, HiddenField } from "~/widgets";
import { EMBED_TYPE_LABELS, type EmbedType } from "~/widgets/types";
import type { Route } from "./+types/admin.embeds";

// Type-parity guard: the DB enum and the client-safe label map must cover the
// same widget types, or a new type would silently miss its admin label.
const EMBED_TYPES = EMBED_TYPE satisfies readonly EmbedType[];

const NewEmbed = z.object({
	name: z.string().min(1, "Name is required"),
	type: z.enum(EMBED_TYPES),
});

const RowIntent = z.object({
	id: z.string().min(1),
	intent: z.enum(["toggle", "delete"]),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { embeds: [], eventName: null, origin: new URL(request.url).origin };
	}
	const db = getDb(env);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		db.query.embeds.findMany({
			where: (e, { eq }) => eq(e.eventId, event.id),
			orderBy: (e, { desc }) => [desc(e.createdAt)],
		}),
	);
	return data(
		{
			embeds: rows.map((e) => ({
				id: e.id,
				publicId: e.publicId,
				name: e.name,
				type: e.type,
				enabled: e.enabled,
			})),
			eventName: event.name,
			origin: new URL(request.url).origin,
		},
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

	try {
		if (intent === "create") {
			const parsed = NewEmbed.safeParse({
				name: form.get("name"),
				type: form.get("type"),
			});
			if (!parsed.success) {
				return {
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
					formError: undefined,
				};
			}
			const id = crypto.randomUUID();
			await db.insert(embeds).values({
				id,
				eventId: event.id, // server-derived — never from the client
				name: parsed.data.name,
				type: parsed.data.type,
				config: {},
			});
			track("embed.created", { eventId: event.id, type: parsed.data.type });
			return redirect(`/admin/embeds/${id}`);
		}

		const parsed = RowIntent.safeParse({ id: form.get("id"), intent });
		if (!parsed.success) {
			return { fieldErrors: undefined, formError: "Unknown action." };
		}
		const row = await db.query.embeds.findFirst({
			where: (e, { and: andOp, eq: eqOp }) =>
				andOp(eqOp(e.id, parsed.data.id), eqOp(e.eventId, event.id)),
		});
		if (!row) {
			return { fieldErrors: undefined, formError: "Embed not found." };
		}
		if (parsed.data.intent === "toggle") {
			await db
				.update(embeds)
				.set({ enabled: !row.enabled })
				.where(and(eq(embeds.id, row.id), eq(embeds.eventId, event.id)));
			track("embed.toggled", { eventId: event.id, enabled: !row.enabled });
		} else {
			await db
				.delete(embeds)
				.where(and(eq(embeds.id, row.id), eq(embeds.eventId, event.id)));
			track("embed.deleted", { eventId: event.id, type: row.type });
		}
		return redirect("/admin/embeds");
	} catch (error) {
		track("embed.action_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the change — please try again.",
		};
	}
}

function DeleteButton({ id, name }: { id: string; name: string }) {
	const [armed, setArmed] = useState(false);
	if (!armed) {
		return (
			<Button type="button" variant="ghost" onClick={() => setArmed(true)}>
				Delete
			</Button>
		);
	}
	return (
		<span className="inline-flex items-center gap-2">
			<Form method="post">
				<HiddenField name="intent" value="delete" />
				<HiddenField name="id" value={id} />
				<Button type="submit" aria-label={`Confirm deleting ${name}`}>
					Confirm delete
				</Button>
			</Form>
			<Button type="button" variant="ghost" onClick={() => setArmed(false)}>
				Cancel
			</Button>
		</span>
	);
}

export default function AdminEmbeds({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { embeds: rows, origin } = loaderData;
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Embeds"
				count={`${rows.length} total`}
				subtitle="Publish live widgets of your program — paste a snippet or share a URL, and organizer edits appear without republishing."
			/>

			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<HiddenField name="intent" value="create" />
					<Field label="Name" error={actionData?.fieldErrors?.name?.[0]}>
						<Input
							name="name"
							placeholder="e.g. Website session list"
							invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
						/>
					</Field>
					<Field label="Widget type">
						<Select name="type">
							{Object.entries(EMBED_TYPE_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit" icon="plus">
						Add embed
					</Button>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>

			<Table>
				<THead>
					<Th>Name</Th>
					<Th>Type</Th>
					<Th>Status</Th>
					<Th>Share URL</Th>
					<Th>Actions</Th>
				</THead>
				<TBody>
					{rows.map((row) => {
						const shareUrl = `${origin}/embed/${row.publicId}`;
						return (
							<Tr key={row.id}>
								<Td kind="strong">
									<TextLink to={`/admin/embeds/${row.id}`}>{row.name}</TextLink>
								</Td>
								<Td>{EMBED_TYPE_LABELS[row.type]}</Td>
								<Td>
									<StatusBadge tone={row.enabled ? "success" : "neutral"}>
										{row.enabled ? "Enabled" : "Disabled"}
									</StatusBadge>
								</Td>
								<Td kind="mono">
									<span className="inline-flex items-center gap-2">
										{`/embed/${row.publicId.slice(0, 8)}…`}
										<CopyFieldButton value={shareUrl} />
									</span>
								</Td>
								<Td>
									<span className="inline-flex items-center gap-2">
										<Form method="post">
											<HiddenField name="intent" value="toggle" />
											<HiddenField name="id" value={row.id} />
											<Button type="submit" variant="ghost">
												{row.enabled ? "Disable" : "Enable"}
											</Button>
										</Form>
										<DeleteButton id={row.id} name={row.name} />
									</span>
								</Td>
							</Tr>
						);
					})}
					{rows.length === 0 && (
						<EmptyRow colSpan={5}>
							No embeds yet — add one above to get a snippet and share URL for
							your website.
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<p>
				The five public pages — <TextLink to="/sessions">Sessions</TextLink>,{" "}
				<TextLink to="/speakers">Speakers</TextLink>,{" "}
				<TextLink to="/schedule">Agenda</TextLink>,{" "}
				<TextLink to="/itinerary">Itinerary</TextLink> and{" "}
				<TextLink to="/gallery">Gallery</TextLink> — are always live; embeds are
				configured, filterable instances of the same widgets.
			</p>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load embeds"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
