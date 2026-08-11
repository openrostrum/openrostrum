import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildSpeakerDirectory,
	getEventBySlug,
	loadPublicSessions,
	toProgramEvent,
} from "~/lib/program";
import { createTimings } from "~/lib/track";
import { ProgramErrorScreen, ProgramShell, SpeakersSurface } from "~/widgets";
import type { Route } from "./+types/speakers.$eventSlug";

// @public — anonymous speaker directory, derived from the same projection as
// the session list: only people on accepted + approved sessions, hidden
// speakers dropped, no contact emails/phones.

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{
			title: loaderData ? `Speakers — ${loaderData.event.name}` : "Speakers",
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
	return data(
		{
			event: toProgramEvent(event),
			surface: buildSpeakerDirectory(sessions, new URL(request.url), 30),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicSpeakers({ loaderData }: Route.ComponentProps) {
	return (
		<ProgramShell event={loaderData.event} active="speakers">
			<SpeakersSurface
				data={loaderData.surface}
				base={`/speakers/${loaderData.event.slug}`}
				sessionsBase={`/sessions/${loaderData.event.slug}`}
			/>
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
