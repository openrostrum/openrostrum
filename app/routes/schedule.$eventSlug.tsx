import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildAgendaData,
	getEventBySlug,
	loadPublicSessions,
	sessionCalendarHref,
	toProgramEvent,
} from "~/lib/program";
import { CalendarDownloadSurface } from "~/components/add-to-calendar";
import { createTimings } from "~/lib/track";
import {
	AgendaSurface,
	AgendaUnpublished,
	ProgramErrorScreen,
	ProgramShell,
} from "~/widgets";
import type { Route } from "./+types/schedule.$eventSlug";

// @public — anonymous agenda grid (day × room × time). Gated on the
// organizer's Publish action: until agendaPublishedAt is set, the loader
// serves no session data at all.

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{ title: loaderData ? `Agenda — ${loaderData.event.name}` : "Agenda" },
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
			{ event: toProgramEvent(event), surface: null, calendarHref: null },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const sessions = await timings.time("db", () =>
		loadPublicSessions(db, event),
	);
	const surface = buildAgendaData(sessions, event, new URL(request.url));
	const calendarHref = sessionCalendarHref(event, surface.detail);
	return data(
		{ event: toProgramEvent(event), surface, calendarHref },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicSchedule({ loaderData }: Route.ComponentProps) {
	const { event, surface, calendarHref } = loaderData;
	return (
		<ProgramShell event={event} active="schedule">
			{surface ? (
				<CalendarDownloadSurface href={calendarHref}>
					<AgendaSurface
						data={surface}
						base={`/schedule/${event.slug}`}
						sessionsBase={`/sessions/${event.slug}`}
						speakersBase={`/speakers/${event.slug}`}
					/>
				</CalendarDownloadSurface>
			) : (
				<AgendaUnpublished event={event} />
			)}
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
