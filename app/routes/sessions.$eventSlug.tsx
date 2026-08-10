import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildSessionsData,
	getEventBySlug,
	loadPublicSessions,
	toProgramEvent,
} from "~/lib/program";
import { AddToCalendar } from "~/components/add-to-calendar";
import { createTimings } from "~/lib/track";
import { ProgramErrorScreen, ProgramShell, SessionsSurface } from "~/widgets";
import type { Route } from "./+types/sessions.$eventSlug";

// @public — anonymous session list. The loader serves a server-side
// projection: accepted + content-approved sessions, visible speakers only,
// no contact emails/phones.

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{
			title: loaderData ? `Sessions — ${loaderData.event.name}` : "Sessions",
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
	const sessions = await timings.time("db", () =>
		loadPublicSessions(db, event),
	);
	const surface = buildSessionsData(sessions, new URL(request.url));
	// Only offered when the .ics endpoint would actually serve it: the agenda
	// feed 404s until the organizer publishes, and an unscheduled session has
	// no times to put on a calendar.
	const calendarHref =
		event.agendaPublishedAt && surface.detail?.scheduled
			? `/feeds/${event.slug}/agenda.ics?ids=${surface.detail.id}`
			: null;
	return data(
		{ event: toProgramEvent(event), surface, calendarHref },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicSessions({ loaderData }: Route.ComponentProps) {
	return (
		<ProgramShell event={loaderData.event} active="sessions">
			<div className="flex flex-col gap-4">
				{loaderData.calendarHref && (
					<AddToCalendar href={loaderData.calendarHref} />
				)}
				<SessionsSurface
					data={loaderData.surface}
					base={`/sessions/${loaderData.event.slug}`}
				/>
			</div>
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
