import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildSessionsData,
	getEventBySlug,
	loadPublicSessions,
	sessionCalendarHref,
	toProgramEvent,
} from "~/lib/program";
import { CalendarDownloadSurface } from "~/components/add-to-calendar";
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
	const calendarHref = sessionCalendarHref(event, surface.detail);
	return data(
		{ event: toProgramEvent(event), surface, calendarHref },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicSessions({ loaderData }: Route.ComponentProps) {
	return (
		<ProgramShell event={loaderData.event} active="sessions">
			<CalendarDownloadSurface href={loaderData.calendarHref}>
				<SessionsSurface
					data={loaderData.surface}
					base={`/sessions/${loaderData.event.slug}`}
					sessionsBase={`/sessions/${loaderData.event.slug}`}
					speakersBase={`/speakers/${loaderData.event.slug}`}
				/>
			</CalendarDownloadSurface>
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
