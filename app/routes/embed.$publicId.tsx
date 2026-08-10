import { data } from "react-router";
import { getDb } from "~/db";
import {
	applyEmbedConfig,
	buildAgendaData,
	buildItineraryData,
	buildSessionsData,
	buildSpeakerDirectory,
	loadPublicSessions,
	toProgramEvent,
} from "~/lib/program";
import { createTimings } from "~/lib/track";
import {
	AccentScope,
	AgendaSurface,
	AgendaUnpublished,
	EmbedShell,
	GallerySurface,
	ItinerarySurface,
	ProgramErrorScreen,
	SessionsSurface,
	SpeakersSurface,
} from "~/widgets";
import type {
	AgendaSurfaceData,
	HideableField,
	ItinerarySurfaceData,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "~/lib/program-types";
import type { Route } from "./+types/embed.$publicId";

// @public — the snippet target: renders one configured embed standalone (and
// inside third-party iframes — no frame-blocking headers). Published snippets
// live on sites we don't control, so this URL contract must stay stable.

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{ title: loaderData ? `${loaderData.event.name} — Program` : "Program" },
	];
}

type Surface =
	| { type: "sessions"; data: SessionsSurfaceData }
	| { type: "speakers"; data: SpeakerDirectoryData }
	| { type: "gallery"; data: SpeakerDirectoryData }
	| { type: "agenda"; data: AgendaSurfaceData | null }
	| { type: "itinerary"; data: ItinerarySurfaceData | null };

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const timings = createTimings();
	const embed = await timings.time("embed", () =>
		db.query.embeds.findFirst({
			where: (e, { eq: eqOp }) => eqOp(e.publicId, params.publicId),
			with: { event: true },
		}),
	);
	if (!embed || !embed.enabled) {
		throw data("Embed not found", { status: 404 });
	}
	const event = embed.event;
	const url = new URL(request.url);
	const config = embed.config ?? {};

	const agendaGated =
		(embed.type === "agenda" || embed.type === "itinerary") &&
		!event.agendaPublishedAt;
	const sessions = agendaGated
		? []
		: applyEmbedConfig(
				await timings.time("db", () => loadPublicSessions(db, event)),
				config,
			);

	let surface: Surface;
	switch (embed.type) {
		case "sessions":
			surface = { type: "sessions", data: buildSessionsData(sessions, url) };
			break;
		case "speakers":
			surface = {
				type: "speakers",
				data: buildSpeakerDirectory(sessions, url, 30),
			};
			break;
		case "gallery":
			surface = {
				type: "gallery",
				data: buildSpeakerDirectory(sessions, url, 36),
			};
			break;
		case "agenda":
			surface = {
				type: "agenda",
				data: agendaGated ? null : buildAgendaData(sessions, event, url),
			};
			break;
		case "itinerary":
			surface = {
				type: "itinerary",
				data: agendaGated ? null : buildItineraryData(sessions, url),
			};
			break;
	}

	return data(
		{
			event: toProgramEvent(event),
			surface,
			hiddenFields: config.hiddenFields ?? [],
			accentColor: config.accentColor ?? null,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function EmbedPage({
	loaderData,
	params,
}: Route.ComponentProps) {
	const { event, surface, hiddenFields, accentColor } = loaderData;
	const base = `/embed/${params.publicId}`;
	const hidden = new Set(hiddenFields as HideableField[]);
	return (
		<AccentScope color={accentColor}>
			<EmbedShell event={event}>
				{surface.type === "sessions" && (
					<SessionsSurface data={surface.data} base={base} hidden={hidden} />
				)}
				{surface.type === "speakers" && (
					<SpeakersSurface data={surface.data} base={base} />
				)}
				{surface.type === "gallery" && (
					<GallerySurface data={surface.data} base={base} />
				)}
				{surface.type === "agenda" &&
					(surface.data ? (
						<AgendaSurface data={surface.data} base={base} hidden={hidden} />
					) : (
						<AgendaUnpublished event={event} />
					))}
				{surface.type === "itinerary" &&
					(surface.data ? (
						<ItinerarySurface
							data={surface.data}
							base={base}
							eventId={event.id}
							icsBase={`/feeds/${event.slug}/agenda.ics`}
							hidden={hidden}
						/>
					) : (
						<AgendaUnpublished event={event} />
					))}
			</EmbedShell>
		</AccentScope>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
