import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildItineraryData,
	getEventBySlug,
	loadPublicSessions,
	toProgramEvent,
} from "~/lib/program";
import { createTimings } from "~/lib/track";
import {
	AgendaUnpublished,
	ItinerarySurface,
	ProgramErrorScreen,
	ProgramShell,
} from "~/widgets";
import type { Route } from "./+types/itinerary.$eventSlug";

// @public — anonymous day-by-day itinerary with a browser-local personal
// schedule (localStorage, no account). Gated on the agenda Publish action,
// like the grid.

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{
			title: loaderData ? `Itinerary — ${loaderData.event.name}` : "Itinerary",
		},
	];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const timings = createTimings();
	const event = await timings.time("event", () =>
		getEventBySlug(db, params.eventSlug),
	);
	if (!event) throw data("Event not found", { status: 404 });
	if (!event.agendaPublishedAt) {
		return data(
			{ event: toProgramEvent(event), surface: null },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const sessions = await timings.time("db", () =>
		loadPublicSessions(db, event),
	);
	return data(
		{
			event: toProgramEvent(event),
			surface: buildItineraryData(sessions, new URL(request.url)),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicItinerary({ loaderData }: Route.ComponentProps) {
	const { event, surface } = loaderData;
	return (
		<ProgramShell event={event} active="itinerary">
			{surface ? (
				<ItinerarySurface
					data={surface}
					base={`/itinerary/${event.slug}`}
					sessionsBase={`/sessions/${event.slug}`}
					eventId={event.id}
					icsBase={`/feeds/${event.slug}/agenda.ics`}
				/>
			) : (
				<AgendaUnpublished event={event} />
			)}
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
