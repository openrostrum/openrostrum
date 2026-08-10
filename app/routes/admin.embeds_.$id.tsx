import { and, eq } from "drizzle-orm";
import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { embeds } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	TextLink,
} from "~/ui";
import { CopyFieldButton } from "~/widgets";
import {
	EMBED_HIDEABLE_FIELDS,
	EMBED_TYPE_LABELS,
	type EmbedConfig,
	type HideableField,
} from "~/lib/program-types";
import type { Route } from "./+types/admin.embeds_.$id";

const UpdateEmbed = z.object({
	name: z.string().min(1, "Name is required"),
	enabled: z.enum(["on", "off"]),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0E6C66")
		.or(z.literal(""))
		.nullable(),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

type AdminUser = Awaited<ReturnType<typeof requireAdmin>>;

async function findScopedEmbed(env: Env, user: AdminUser, id: string) {
	const event = await getActiveEvent(env, user);
	if (!event) throw data("No event configured", { status: 404 });
	const db = getDb(env);
	const embed = await db.query.embeds.findFirst({
		where: (e, { and: andOp, eq: eqOp }) =>
			andOp(eqOp(e.id, id), eqOp(e.eventId, event.id)),
	});
	if (!embed) throw data("Embed not found", { status: 404 });
	return { db, event, embed };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const timings = createTimings();
	const { db, event, embed } = await timings.time("db", () =>
		findScopedEmbed(env, user, params.id),
	);
	const [tracks, formats] = await timings.time("taxonomies", () =>
		Promise.all([
			db.query.tracks.findMany({
				where: (t, { eq: eqOp }) => eqOp(t.eventId, event.id),
				orderBy: (t, { asc }) => [asc(t.name)],
			}),
			db.query.formats.findMany({
				where: (f, { eq: eqOp }) => eqOp(f.eventId, event.id),
				orderBy: (f, { asc }) => [asc(f.position)],
			}),
		]),
	);
	return data(
		{
			embed: {
				id: embed.id,
				publicId: embed.publicId,
				name: embed.name,
				type: embed.type,
				enabled: embed.enabled,
				config: embed.config ?? {},
			},
			eventSlug: event.slug,
			tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
			formats: formats.map((f) => ({ id: f.id, name: f.name })),
			origin: new URL(request.url).origin,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, params, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const { db, event, embed } = await findScopedEmbed(env, user, params.id);
	const form = await request.formData();
	const parsed = UpdateEmbed.safeParse({
		name: form.get("name"),
		enabled: form.get("enabled"),
		accentColor: form.get("accentColor"),
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}
	// Only known ids/fields enter the config — junk in the POST is dropped.
	const [tracks, formats] = await Promise.all([
		db.query.tracks.findMany({
			where: (t, { eq: eqOp }) => eqOp(t.eventId, event.id),
		}),
		db.query.formats.findMany({
			where: (f, { eq: eqOp }) => eqOp(f.eventId, event.id),
		}),
	]);
	const trackIds = form
		.getAll("trackIds")
		.map(String)
		.filter((id) => tracks.some((t) => t.id === id));
	const formatIds = form
		.getAll("formatIds")
		.map(String)
		.filter((id) => formats.some((f) => f.id === id));
	const hiddenFields = form
		.getAll("hiddenFields")
		.map(String)
		.filter((f): f is HideableField =>
			(EMBED_HIDEABLE_FIELDS as readonly string[]).includes(f),
		);
	const config: EmbedConfig = {
		...(trackIds.length ? { trackIds } : {}),
		...(formatIds.length ? { formatIds } : {}),
		...(hiddenFields.length ? { hiddenFields } : {}),
		...(parsed.data.accentColor
			? { accentColor: parsed.data.accentColor }
			: {}),
	};
	try {
		await db
			.update(embeds)
			.set({
				name: parsed.data.name,
				enabled: parsed.data.enabled === "on",
				config,
			})
			.where(and(eq(embeds.id, embed.id), eq(embeds.eventId, event.id)));
	} catch (error) {
		track("embed.update_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the embed — please try again.",
		};
	}
	track("embed.updated", { eventId: event.id, type: embed.type });
	return redirect(`/admin/embeds/${embed.id}`);
}

function SnippetRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-end gap-2">
			<div className="min-w-0 flex-1">
				<Field label={label}>
					<Input
						readOnly
						value={value}
						onFocus={(e) => e.currentTarget.select()}
					/>
				</Field>
			</div>
			<CopyFieldButton value={value} />
		</div>
	);
}

export default function AdminEmbedEditor({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { embed, eventSlug, tracks, formats, origin } = loaderData;
	const config = embed.config;
	const shareUrl = `${origin}/embed/${embed.publicId}`;
	const feedKind =
		embed.type === "speakers" || embed.type === "gallery"
			? "speakers"
			: "sessions";
	const feedUrl = (suffix: string) =>
		`${origin}/feeds/${eventSlug}/${suffix}?embed=${embed.publicId}`;
	const scriptSnippet = `<script src="${origin}/feeds/${eventSlug}/widget.js?embed=${embed.publicId}" async></script>`;
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={embed.name}
				subtitle={
					<span className="inline-flex items-center gap-2">
						{EMBED_TYPE_LABELS[embed.type]} · the widget type is fixed — create
						a new embed for a different type
						<StatusBadge tone={embed.enabled ? "success" : "neutral"}>
							{embed.enabled ? "Enabled" : "Disabled"}
						</StatusBadge>
					</span>
				}
				actions={
					<span className="inline-flex items-center gap-2">
						<ButtonLink to={`/embed/${embed.publicId}`} variant="ghost">
							Preview
						</ButtonLink>
						<ButtonLink to="/admin/embeds" variant="ghost">
							All embeds
						</ButtonLink>
					</span>
				}
			/>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<Panel>
					<Form method="post" className="flex flex-col gap-4">
						<Field label="Name" error={actionData?.fieldErrors?.name?.[0]}>
							<Input
								name="name"
								defaultValue={embed.name}
								invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
							/>
						</Field>
						<Field label="Status">
							<Select
								name="enabled"
								defaultValue={embed.enabled ? "on" : "off"}
							>
								<option value="on">Enabled — serves live data</option>
								<option value="off">Disabled — share URL and feeds 404</option>
							</Select>
						</Field>
						<Field
							label="Brand color (optional)"
							error={actionData?.fieldErrors?.accentColor?.[0]}
						>
							<Input
								name="accentColor"
								placeholder="#0E6C66"
								defaultValue={config.accentColor ?? ""}
								invalid={Boolean(actionData?.fieldErrors?.accentColor?.[0])}
							/>
						</Field>

						<Field label="Filter by track (none selected = all)">
							<Select
								name="trackIds"
								multiple
								size={Math.min(Math.max(tracks.length, 2), 5)}
								defaultValue={config.trackIds ?? []}
							>
								{tracks.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</Select>
						</Field>

						<Field label="Filter by format (none selected = all)">
							<Select
								name="formatIds"
								multiple
								size={Math.min(Math.max(formats.length, 2), 5)}
								defaultValue={config.formatIds ?? []}
							>
								{formats.map((f) => (
									<option key={f.id} value={f.id}>
										{f.name}
									</option>
								))}
							</Select>
						</Field>

						<Field label="Hide card fields (title always shows)">
							<Select
								name="hiddenFields"
								multiple
								size={EMBED_HIDEABLE_FIELDS.length}
								defaultValue={config.hiddenFields ?? []}
							>
								{EMBED_HIDEABLE_FIELDS.map((field) => (
									<option key={field} value={field}>
										{field}
									</option>
								))}
							</Select>
						</Field>
						<p>Cmd/Ctrl-click to select multiple values or clear one.</p>

						<div className="flex items-center gap-3">
							<Button type="submit">Save embed</Button>
							{actionData?.formError && (
								<ErrorText>{actionData.formError}</ErrorText>
							)}
						</div>
					</Form>
				</Panel>

				<Panel>
					<div className="flex flex-col gap-4">
						<h2>Share &amp; embed</h2>
						<p>
							Filters and branding above apply to every output. Data is read
							live — organizer edits show up without regenerating anything.
						</p>
						<SnippetRow label="Share URL (styled page)" value={shareUrl} />
						<SnippetRow
							label="Styled HTML (script tag for your site)"
							value={scriptSnippet}
						/>
						<SnippetRow
							label="Basic HTML (unstyled, restyle it yourself)"
							value={feedUrl(`${feedKind}.html`)}
						/>
						<SnippetRow label="JSON feed" value={feedUrl(`${feedKind}.json`)} />
						<SnippetRow label="XML feed" value={feedUrl(`${feedKind}.xml`)} />
						{feedKind === "sessions" && (
							<SnippetRow
								label="iCal feed (approved, scheduled sessions)"
								value={feedUrl("agenda.ics")}
							/>
						)}
						<p>
							Formats stay in sync with the{" "}
							<TextLink to={`/sessions/${eventSlug}`}>public pages</TextLink> —
							one projection serves both.
						</p>
					</div>
				</Panel>
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Embed not found"
				tone="danger"
				subtitle="It may have been deleted, or it belongs to a different event."
			/>
		</div>
	);
}
