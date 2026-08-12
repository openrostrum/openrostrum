import { formatRole } from "~/lib/format";
import { buildIcs } from "~/lib/ics";
import type {
	ProgramEvent,
	PublicSession,
	PublicSpeakerProfile,
} from "~/lib/program-types";

/**
 * Machine-readable projections of the public program. Same inputs as the
 * pages (loadPublicSessions → PublicSession), so a session can never differ
 * between a page, a feed, and an embed.
 */

export function sessionsToJson(
	event: ProgramEvent,
	sessions: PublicSession[],
): string {
	return JSON.stringify(
		{
			event: {
				name: event.name,
				slug: event.slug,
				timezone: event.timezone,
				location: event.location,
			},
			generatedAt: new Date().toISOString(),
			sessions: sessions.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description,
				startsAt: s.startsAtIso,
				endsAt: s.endsAtIso,
				room: s.room,
				format: s.format,
				level: s.level,
				language: s.language,
				tracks: s.tracks.map((t) => ({ id: t.id, name: t.name })),
				speakers: s.speakers.map(speakerJson),
			})),
		},
		null,
		2,
	);
}

export function speakersToJson(
	event: ProgramEvent,
	speakers: PublicSpeakerProfile[],
): string {
	return JSON.stringify(
		{
			event: { name: event.name, slug: event.slug, timezone: event.timezone },
			generatedAt: new Date().toISOString(),
			speakers: speakers.map((sp) => ({
				...speakerJson(sp),
				bio: sp.bio,
				photoUrl: sp.photoUrl,
				sessions: sp.sessions.map((s) => ({
					id: s.id,
					title: s.title,
					date: s.dateLabel,
					time: s.timeRange,
					room: s.room,
				})),
			})),
		},
		null,
		2,
	);
}

function speakerJson(sp: {
	id: string;
	name: string;
	jobTitle: string | null;
	companyName: string | null;
}) {
	return {
		id: sp.id,
		name: sp.name,
		jobTitle: sp.jobTitle,
		company: sp.companyName,
	};
}

/* -------------------------------------------------------------------- XML --- */

function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function tag(name: string, value: string | null): string {
	return value === null || value === ""
		? `<${name}/>`
		: `<${name}>${esc(value)}</${name}>`;
}

export function sessionsToXml(
	event: ProgramEvent,
	sessions: PublicSession[],
): string {
	const body = sessions
		.map(
			(s) =>
				`<session id="${esc(s.id)}">` +
				tag("title", s.title) +
				tag("description", s.description) +
				tag("startsAt", s.startsAtIso) +
				tag("endsAt", s.endsAtIso) +
				tag("room", s.room) +
				tag("format", s.format) +
				tag("level", s.level) +
				tag("language", s.language) +
				`<tracks>${s.tracks.map((t) => `<track id="${esc(t.id)}">${esc(t.name)}</track>`).join("")}</tracks>` +
				`<speakers>${s.speakers
					.map(
						(sp) =>
							`<speaker id="${esc(sp.id)}">` +
							tag("name", sp.name) +
							tag("jobTitle", sp.jobTitle) +
							tag("company", sp.companyName) +
							`</speaker>`,
					)
					.join("")}</speakers>` +
				`</session>`,
		)
		.join("");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<program event="${esc(event.name)}" slug="${esc(event.slug)}" timezone="${esc(event.timezone)}">` +
		`<sessions>${body}</sessions></program>`
	);
}

export function speakersToXml(
	event: ProgramEvent,
	speakers: PublicSpeakerProfile[],
): string {
	const body = speakers
		.map(
			(sp) =>
				`<speaker id="${esc(sp.id)}">` +
				tag("name", sp.name) +
				tag("jobTitle", sp.jobTitle) +
				tag("company", sp.companyName) +
				tag("bio", sp.bio) +
				`<sessions>${sp.sessions
					.map(
						(s) =>
							`<session id="${esc(s.id)}">` +
							tag("title", s.title) +
							tag("date", s.dateLabel) +
							tag("time", s.timeRange) +
							tag("room", s.room) +
							`</session>`,
					)
					.join("")}</sessions>` +
				`</speaker>`,
		)
		.join("");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<program event="${esc(event.name)}" slug="${esc(event.slug)}">` +
		`<speakers>${body}</speakers></program>`
	);
}

/* -------------------------------------------------------------------- iCal --- */

/**
 * Whole-agenda (or starred-subset) calendar. UIDs are stable per session so a
 * re-imported feed updates entries in place instead of duplicating them.
 */
export function agendaToIcs(
	event: ProgramEvent,
	sessions: PublicSession[],
): string {
	const scheduled = sessions.filter(
		(s) => s.scheduled && s.startsAtIso && s.endsAtIso,
	);
	return buildIcs({
		calendarName: event.name,
		events: scheduled.map((s) => ({
			uid: `or-session-${s.id}@openrostrum`,
			start: new Date(s.startsAtIso as string),
			end: new Date(s.endsAtIso as string),
			title: s.title,
			location: s.room ?? undefined,
			description: icsDescription(s),
		})),
	});
}

function icsDescription(s: PublicSession): string {
	const parts: string[] = [];
	if (s.speakers.length > 0)
		parts.push(`Speakers: ${s.speakers.map((sp) => sp.name).join(", ")}`);
	if (s.description) parts.push(s.description);
	return parts.join("\n\n");
}

/* -------------------------------------------------------------- basic HTML --- */

/**
 * The "basic HTML" embed format: semantic, deliberately unstyled markup a web
 * team restyles with their own CSS. Everything is escaped — descriptions are
 * already plain text by the time they reach here.
 */
export function sessionsToBasicHtml(
	event: ProgramEvent,
	sessions: PublicSession[],
): string {
	const items = sessions
		.map(
			(s) => `<article class="or-session" id="session-${esc(s.id)}">
  <h2>${esc(s.title)}</h2>
  ${s.timeRange ? `<p class="or-time"><time>${esc(`${s.dayLabel ?? ""} ${s.timeRange}`.trim())}</time>${s.room ? ` · ${esc(s.room)}` : ""}</p>` : ""}
  ${
		s.format || s.tracks.length
			? `<p class="or-tags">${[s.format, ...s.tracks.map((t) => t.name)]
					.filter(Boolean)
					.map((v) => esc(String(v)))
					.join(" · ")}</p>`
			: ""
	}
  ${s.description ? `<p class="or-description">${esc(s.description)}</p>` : ""}
  ${
		s.speakers.length
			? `<ul class="or-speakers">${s.speakers
					.map((sp) => {
						const role = formatRole(sp, esc);
						return `<li>${esc(sp.name)}${role ? ` — ${role}` : ""}</li>`;
					})
					.join("")}</ul>`
			: ""
	}
</article>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(event.name)} — Sessions</title></head>
<body class="or-embed">
<h1>${esc(event.name)}</h1>
${items || "<p>No published sessions yet.</p>"}
</body>
</html>`;
}

export function speakersToBasicHtml(
	event: ProgramEvent,
	speakers: PublicSpeakerProfile[],
): string {
	const items = speakers
		.map((sp) => {
			const role = formatRole(sp, esc);
			return `<article class="or-speaker" id="speaker-${esc(sp.id)}">
  <h2>${esc(sp.name)}</h2>
  ${role ? `<p class="or-role">${role}</p>` : ""}
  ${sp.bio ? `<p class="or-bio">${esc(sp.bio)}</p>` : ""}
  <ul class="or-sessions">${sp.sessions.map((s) => `<li>${esc(s.title)}${s.timeRange ? ` — ${esc(`${s.dateLabel ?? ""} ${s.timeRange}`.trim())}` : ""}${s.room ? `, ${esc(s.room)}` : ""}</li>`).join("")}</ul>
</article>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(event.name)} — Speakers</title></head>
<body class="or-embed">
<h1>${esc(event.name)}</h1>
${items || "<p>No published speakers yet.</p>"}
</body>
</html>`;
}

/* ------------------------------------------------------------ embed loader --- */

/**
 * The one-line "styled HTML" snippet target: injects a responsive iframe of
 * /embed/:publicId next to the script tag. Published snippets live on
 * third-party sites, so this contract must stay stable.
 */
export function widgetLoaderScript(origin: string): string {
	return `(function () {
  var script = document.currentScript;
  if (!script) return;
  var embedId = new URL(script.src).searchParams.get("embed");
  if (!embedId) return;
  var frame = document.createElement("iframe");
  frame.src = ${JSON.stringify(origin)} + "/embed/" + encodeURIComponent(embedId);
  frame.title = "Event program";
  frame.loading = "lazy";
  frame.style.cssText = "width:100%;min-height:920px;border:0;display:block";
  script.parentNode.insertBefore(frame, script.nextSibling);
})();
`;
}
