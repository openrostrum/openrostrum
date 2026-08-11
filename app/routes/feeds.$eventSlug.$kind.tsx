import { getDb } from "~/db";
import {
	applyEmbedConfig,
	getEventBySlug,
	loadPublicSessions,
	speakersFromSessions,
	toProgramEvent,
} from "~/lib/program";
import {
	agendaToIcs,
	sessionsToBasicHtml,
	sessionsToJson,
	sessionsToXml,
	speakersToBasicHtml,
	speakersToJson,
	speakersToXml,
	widgetLoaderScript,
} from "~/lib/program-feeds";
import type { EmbedConfig } from "~/lib/program-types";
import type { Route } from "./+types/feeds.$eventSlug.$kind";

// @public — machine-readable program feeds (JSON / XML / iCal / basic HTML)
// plus the embed loader script. Resource route: responses are served as-is.
// Same projection as the pages, so feeds can never leak more than the UI.

const FEED_HEADERS = {
	"Cache-Control": "public, max-age=60",
	"Access-Control-Allow-Origin": "*",
};

function notFound(message: string): Response {
	return new Response(message, {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const url = new URL(request.url);
	// The path segment carries the extension: /feeds/:slug/sessions.json.
	const dot = params.kind.lastIndexOf(".");
	if (dot <= 0) return notFound("Unknown feed");
	const kind = params.kind.slice(0, dot);
	const format = params.kind.slice(dot + 1);

	const event = await getEventBySlug(db, params.eventSlug);
	if (!event) return notFound("Event not found");

	// An embed id narrows the feed to that embed's configured filters.
	let config: EmbedConfig | null = null;
	let embedType: string | null = null;
	const embedPublicId = url.searchParams.get("embed");
	if (embedPublicId) {
		const embed = await db.query.embeds.findFirst({
			where: (e, { and: andOp, eq: eqOp }) =>
				andOp(eqOp(e.publicId, embedPublicId), eqOp(e.eventId, event.id)),
		});
		if (!embed || !embed.enabled) return notFound("Embed not found");
		config = embed.config ?? null;
		embedType = embed.type;
	}
	if (kind === "widget") {
		if (format !== "js") return notFound("Unknown feed format");
		return new Response(widgetLoaderScript(url.origin), {
			headers: {
				...FEED_HEADERS,
				"Content-Type": "text/javascript; charset=utf-8",
			},
		});
	}

	if (
		(embedType === "agenda" || embedType === "itinerary") &&
		!event.agendaPublishedAt
	) {
		return notFound("Agenda not published");
	}

	const programEvent = toProgramEvent(event);
	const sessions = applyEmbedConfig(
		await loadPublicSessions(db, event),
		config,
	);

	if (kind === "sessions") {
		if (format === "json") {
			return new Response(sessionsToJson(programEvent, sessions), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "application/json; charset=utf-8",
				},
			});
		}
		if (format === "xml") {
			return new Response(sessionsToXml(programEvent, sessions), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "application/xml; charset=utf-8",
				},
			});
		}
		if (format === "html") {
			return new Response(sessionsToBasicHtml(programEvent, sessions), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "text/html; charset=utf-8",
				},
			});
		}
		return notFound("Unknown feed format");
	}

	if (kind === "speakers") {
		const speakers = speakersFromSessions(sessions);
		if (format === "json") {
			return new Response(speakersToJson(programEvent, speakers), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "application/json; charset=utf-8",
				},
			});
		}
		if (format === "xml") {
			return new Response(speakersToXml(programEvent, speakers), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "application/xml; charset=utf-8",
				},
			});
		}
		if (format === "html") {
			return new Response(speakersToBasicHtml(programEvent, speakers), {
				headers: {
					...FEED_HEADERS,
					"Content-Type": "text/html; charset=utf-8",
				},
			});
		}
		return notFound("Unknown feed format");
	}

	if (kind === "agenda" && format === "ics") {
		if (!event.agendaPublishedAt) return notFound("Agenda not published");
		const idsParam = url.searchParams.get("ids");
		const ids = idsParam ? new Set(idsParam.split(",").filter(Boolean)) : null;
		const selected = ids ? sessions.filter((s) => ids.has(s.id)) : sessions;
		return new Response(agendaToIcs(programEvent, selected), {
			headers: {
				...FEED_HEADERS,
				"Content-Type": "text/calendar; charset=utf-8",
				"Content-Disposition": 'attachment; filename="agenda.ics"',
			},
		});
	}

	return notFound("Unknown feed");
}
