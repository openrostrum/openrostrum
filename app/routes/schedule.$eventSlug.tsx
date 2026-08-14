import { data } from "react-router";
import { CalendarDownloadSurface } from "~/components/add-to-calendar";
import { CopyButton } from "~/components/copy-button";
import { getDb } from "~/db";
import { getUser, userCanAccessEvent } from "~/lib/auth";
import {
	buildAgendaData,
	getEventBySlug,
	loadPublicSessions,
	sessionCalendarHref,
	toProgramEvent,
} from "~/lib/program";
import { createTimings } from "~/lib/track";
import { ButtonLink } from "~/ui";
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
	const env = context.cloudflare.env;
	const db = getDb(env);
	const timings = createTimings();
	const event = await timings.time("event", () =>
		getEventBySlug(db, params.eventSlug),
	);
	if (!event) throw data("Event not found", { status: 404 });
	const viewer = await getUser(env, request);
	const canManage = viewer
		? await userCanAccessEvent(env, viewer.id, event.id)
		: false;
	if (!event.agendaPublishedAt) {
		return data(
			{
				event: toProgramEvent(event),
				surface: null,
				calendarHref: null,
				canManage,
				publicUrl: request.url,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const sessions = await timings.time("db", () =>
		loadPublicSessions(db, event),
	);
	const surface = buildAgendaData(sessions, event, new URL(request.url));
	const calendarHref = sessionCalendarHref(event, surface.detail);
	return data(
		{
			event: toProgramEvent(event),
			surface,
			calendarHref,
			canManage,
			publicUrl: request.url,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicSchedule({ loaderData }: Route.ComponentProps) {
	const { event, surface, calendarHref, canManage, publicUrl } = loaderData;
	return (
		<ProgramShell event={event} active="schedule">
			{canManage && (
				<div className="mb-5 flex flex-wrap items-center gap-3">
					<CopyButton value={publicUrl} label="Copy link" />
					<ButtonLink to="/admin" variant="ghost">
						Go to admin
					</ButtonLink>
				</div>
			)}
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
