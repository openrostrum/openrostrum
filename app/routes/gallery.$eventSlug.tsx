import { data } from "react-router";
import { getDb } from "~/db";
import {
	buildSpeakerDirectory,
	getEventBySlug,
	loadPublicSessions,
	toProgramEvent,
} from "~/lib/program";
import { createTimings } from "~/lib/track";
import { GallerySurface, ProgramErrorScreen, ProgramShell } from "~/widgets";
import type { Route } from "./+types/gallery.$eventSlug";

// @public — anonymous speaker photo gallery, same projection as the
// directory (accepted + approved sessions only, hidden speakers dropped).

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{
			title: loaderData
				? `Speaker Gallery — ${loaderData.event.name}`
				: "Speaker Gallery",
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
			surface: buildSpeakerDirectory(sessions, new URL(request.url), 36),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PublicGallery({ loaderData }: Route.ComponentProps) {
	return (
		<ProgramShell event={loaderData.event} active="gallery">
			<GallerySurface
				data={loaderData.surface}
				base={`/gallery/${loaderData.event.slug}`}
			/>
		</ProgramShell>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ProgramErrorScreen error={error} />;
}
