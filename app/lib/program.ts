import { asc, eq } from "drizzle-orm";
import type { Db } from "~/db";
import { events } from "~/db/schema";
import type {
	AgendaBlock,
	AgendaSurfaceData,
	EmbedConfig,
	ItineraryDay,
	ItinerarySurfaceData,
	ProgramEvent,
	ProgramFacets,
	ProgramFilters,
	PublicSession,
	PublicSpeaker,
	PublicSpeakerProfile,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "~/lib/program-types";

/**
 * The one projection layer behind every anonymous surface (pages, embeds,
 * feeds): only accepted + content-approved sessions exist publicly, hidden
 * speakers drop before serialization, contact emails/phones never enter the
 * payload — and reads hit D1 live, so edits appear without republishing.
 */

type EventRow = typeof events.$inferSelect;

export async function getEventBySlug(
	db: Db,
	slug: string,
): Promise<EventRow | null> {
	const [row] = await db
		.select()
		.from(events)
		.where(eq(events.slug, slug))
		.limit(1);
	return row ?? null;
}

/** The event bare public aliases (/sessions, /agenda, …) resolve to. */
export async function getDefaultEvent(db: Db): Promise<EventRow | null> {
	const [row] = await db
		.select()
		.from(events)
		.orderBy(asc(events.createdAt))
		.limit(1);
	return row ?? null;
}

/**
 * The per-session "Add to calendar" link, or null when the feed wouldn't
 * serve it: /feeds/:slug/agenda.ics 404s until the agenda is published, and
 * an unscheduled session has no times to export. The one place that knows
 * the feed's URL + query contract.
 */
export function sessionCalendarHref(
	event: EventRow,
	detail: PublicSession | null,
): string | null {
	return event.agendaPublishedAt && detail?.scheduled
		? `/feeds/${event.slug}/agenda.ics?ids=${detail.id}`
		: null;
}

/* ------------------------------------------------------- date formatting --- */

function zonedParts(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return {
		dayKey: `${get("year")}-${get("month")}-${get("day")}`,
		minutes: Number(get("hour")) * 60 + Number(get("minute")),
	};
}

function timeLabel(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function shortDayLabel(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(date);
}

function longDayLabel(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

function minutesToLabel(min: number): string {
	const h24 = Math.floor(min / 60) % 24;
	const m = min % 60;
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	const suffix = h24 < 12 ? "AM" : "PM";
	return m === 0
		? `${h12} ${suffix}`
		: `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Event start/end are date-only boundaries stored at UTC midnight — format
 * them in UTC so the range doesn't slip a day in western timezones. */
function eventDateRange(event: EventRow): string | null {
	if (!event.startsAt) return null;
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	if (!event.endsAt || event.endsAt.getTime() === event.startsAt.getTime()) {
		return fmt.format(event.startsAt);
	}
	return fmt.formatRange(event.startsAt, event.endsAt);
}

export function toProgramEvent(event: EventRow): ProgramEvent {
	return {
		id: event.id,
		name: event.name,
		slug: event.slug,
		timezone: event.timezone,
		location: event.location,
		dateRange: eventDateRange(event),
	};
}

/* --------------------------------------------------------- rich text strip --- */

/**
 * Submitter rich text → plain text: tags removed, entities decoded (&amp;
 * LAST, or "&amp;lt;" double-decodes). Output is arbitrary TEXT that may
 * contain angle brackets — markup safety lives at the sinks (React, the
 * feeds' esc()/escapeText, JSON.stringify), never here.
 */
export function stripHtml(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/* -------------------------------------------------------------- sessions --- */

const PUBLIC_ROLES = new Set(["speaker", "chairperson", "moderator"]);

export async function loadPublicSessions(
	db: Db,
	event: EventRow,
): Promise<PublicSession[]> {
	// Narrow columns: hauling full rows made this query's cost scale with
	// content size, and full contact rows would carry emails/phones into the
	// Worker — the projection below must stay the only shape that exists here.
	const rows = await db.query.submissions.findMany({
		columns: {
			id: true,
			title: true,
			description: true,
			formatId: true,
			language: true,
			roomId: true,
			startsAt: true,
			endsAt: true,
		},
		where: (s, { and: andOp, eq: eqOp, isNull }) =>
			andOp(
				eqOp(s.eventId, event.id),
				eqOp(s.status, "accepted"),
				eqOp(s.contentStatus, "approved"),
				isNull(s.parentId),
			),
		with: {
			format: { columns: { name: true } },
			level: { columns: { name: true } },
			room: { columns: { name: true, displayOrder: true } },
			submissionTracks: {
				columns: {},
				with: { track: { columns: { id: true, name: true, color: true } } },
			},
			participants: {
				columns: { contactId: true, role: true, position: true },
				with: {
					contact: {
						columns: {
							id: true,
							firstName: true,
							lastName: true,
							jobTitle: true,
							companyName: true,
							bio: true,
							publicVisible: true,
						},
					},
				},
			},
		},
	});

	const contactIds = new Set(
		rows.flatMap((r) => r.participants.map((p) => p.contactId)),
	);
	const photoByContact = await latestHeadshots(db, event.id, contactIds);

	const tz = event.timezone;
	const sessions = rows.map((r): PublicSession => {
		const scheduled = r.startsAt !== null && r.endsAt !== null;
		const start = r.startsAt;
		const end = r.endsAt;
		const startParts = start ? zonedParts(start, tz) : null;
		const endParts = end ? zonedParts(end, tz) : null;
		const speakers = r.participants
			.filter((p) => PUBLIC_ROLES.has(p.role) && p.contact.publicVisible)
			.sort((a, b) => a.position - b.position)
			.map((p): PublicSpeaker => projectSpeaker(p.contact, photoByContact));
		return {
			id: r.id,
			title: r.title,
			description: stripHtml(r.description),
			format: r.format?.name ?? null,
			formatId: r.formatId,
			level: r.level?.name ?? null,
			language: r.language,
			room: r.room?.name ?? null,
			roomId: r.roomId,
			roomOrder: r.room?.displayOrder ?? null,
			tracks: r.submissionTracks.map((st) => ({
				id: st.track.id,
				name: st.track.name,
				color: st.track.color,
			})),
			speakers,
			scheduled,
			dayKey: startParts?.dayKey ?? null,
			dayLabel: start ? shortDayLabel(start, tz) : null,
			dateLabel: start ? longDayLabel(start, tz) : null,
			startLabel: start ? timeLabel(start, tz) : null,
			timeRange:
				start && end ? `${timeLabel(start, tz)} – ${timeLabel(end, tz)}` : null,
			startMin: startParts?.minutes ?? null,
			endMin: endParts?.minutes ?? null,
			startsAtIso: start?.toISOString() ?? null,
			endsAtIso: end?.toISOString() ?? null,
		};
	});

	// Scheduled first in program order; unscheduled trail alphabetically.
	return sessions.sort((a, b) => {
		if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
		if (a.scheduled && b.scheduled) {
			const at = a.startsAtIso ?? "";
			const bt = b.startsAtIso ?? "";
			if (at !== bt) return at < bt ? -1 : 1;
		}
		return a.title.localeCompare(b.title);
	});
}

type ContactRow = {
	id: string;
	firstName: string;
	lastName: string;
	jobTitle: string | null;
	companyName: string | null;
	bio: string | null;
};

function projectSpeaker(
	contact: ContactRow,
	photoByContact: Map<string, string>,
): PublicSpeaker {
	return {
		id: contact.id,
		name: `${contact.firstName} ${contact.lastName}`.trim(),
		firstName: contact.firstName,
		lastName: contact.lastName,
		jobTitle: contact.jobTitle,
		companyName: contact.companyName,
		bio: contact.bio ? stripHtml(contact.bio) : null,
		photoUrl: photoByContact.get(contact.id) ?? null,
	};
}

/**
 * Filtered by event + kind (2 bound params), matched to contacts in JS — an
 * inArray over hundreds of speaker ids would blow D1's 100-parameter cap.
 */
async function latestHeadshots(
	db: Db,
	eventId: string,
	contactIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
	if (contactIds.size === 0) return new Map();
	const rows = await db.query.files.findMany({
		columns: { id: true, contactId: true },
		where: (f, { and: andOp, eq: eqOp }) =>
			andOp(eqOp(f.eventId, eventId), eqOp(f.kind, "headshot")),
		orderBy: (f, { desc }) => [desc(f.version), desc(f.createdAt)],
	});
	const map = new Map<string, string>();
	for (const f of rows) {
		if (f.contactId && contactIds.has(f.contactId) && !map.has(f.contactId)) {
			map.set(f.contactId, `/files/${f.id}`);
		}
	}
	return map;
}

/* -------------------------------------------------------------- speakers --- */

/**
 * The public speaker set is DERIVED from the public session set — someone
 * appears only through an approved, accepted session, so the two surfaces can
 * never disagree. Alphabetical by surname.
 */
export function speakersFromSessions(
	sessions: PublicSession[],
): PublicSpeakerProfile[] {
	const byId = new Map<string, PublicSpeakerProfile>();
	for (const session of sessions) {
		for (const speaker of session.speakers) {
			const existing = byId.get(speaker.id);
			const ref = {
				id: session.id,
				title: session.title,
				dateLabel: session.dateLabel,
				timeRange: session.timeRange,
				room: session.room,
			};
			if (existing) {
				existing.sessions.push(ref);
			} else {
				byId.set(speaker.id, { ...speaker, sessions: [ref] });
			}
		}
	}
	return [...byId.values()].sort(
		(a, b) =>
			a.lastName.localeCompare(b.lastName) ||
			a.firstName.localeCompare(b.firstName),
	);
}

/* ------------------------------------------------------- search + filters --- */

export function parseFilters(url: URL): ProgramFilters {
	return {
		q: (url.searchParams.get("q") ?? "").trim(),
		track: url.searchParams.get("track") ?? "",
		format: url.searchParams.get("format") ?? "",
		room: url.searchParams.get("room") ?? "",
	};
}

/** Search deliberately matches titles and speaker names only — never descriptions. */
export function filterSessions(
	sessions: PublicSession[],
	filters: ProgramFilters,
): PublicSession[] {
	const q = filters.q.toLowerCase();
	return sessions.filter((s) => {
		if (filters.track && !s.tracks.some((t) => t.id === filters.track))
			return false;
		if (filters.format && s.formatId !== filters.format) return false;
		if (filters.room && s.roomId !== filters.room) return false;
		if (!q) return true;
		return (
			s.title.toLowerCase().includes(q) ||
			s.speakers.some((sp) => sp.name.toLowerCase().includes(q))
		);
	});
}

export function facetsFrom(sessions: PublicSession[]): ProgramFacets {
	const tracks = new Map<string, string>();
	const formats = new Map<string, string>();
	const rooms = new Map<string, string>();
	for (const s of sessions) {
		for (const t of s.tracks) tracks.set(t.id, t.name);
		if (s.formatId && s.format) formats.set(s.formatId, s.format);
		if (s.roomId && s.room) rooms.set(s.roomId, s.room);
	}
	const toSorted = (m: Map<string, string>) =>
		[...m.entries()]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	return {
		tracks: toSorted(tracks),
		formats: toSorted(formats),
		rooms: toSorted(rooms),
	};
}

export function applyEmbedConfig(
	sessions: PublicSession[],
	config: EmbedConfig | null,
): PublicSession[] {
	if (!config) return sessions;
	return sessions.filter((s) => {
		if (
			config.trackIds?.length &&
			!s.tracks.some((t) => config.trackIds?.includes(t.id))
		)
			return false;
		if (
			config.formatIds?.length &&
			!(s.formatId && config.formatIds.includes(s.formatId))
		)
			return false;
		return true;
	});
}

/* -------------------------------------------------------- surface builders --- */

function paginate<T>(items: T[], url: URL, pageSize: number) {
	const pages = Math.max(1, Math.ceil(items.length / pageSize));
	const requested = Number(url.searchParams.get("page") ?? "1");
	const page = Math.min(
		Math.max(Number.isInteger(requested) ? requested : 1, 1),
		pages,
	);
	return {
		page,
		pages,
		slice: items.slice((page - 1) * pageSize, page * pageSize),
	};
}

const SESSIONS_PAGE_SIZE = 24;

export function buildSessionsData(
	all: PublicSession[],
	url: URL,
): SessionsSurfaceData {
	const filters = parseFilters(url);
	const filtered = filterSessions(all, filters);
	const { page, pages, slice } = paginate(filtered, url, SESSIONS_PAGE_SIZE);
	// Detail resolves against the FULL program (like the agenda's), so a shared
	// link keeps working even when the viewer's filters would exclude it.
	const detailId = url.searchParams.get("session");
	const detail = detailId ? (all.find((s) => s.id === detailId) ?? null) : null;
	return {
		sessions: slice,
		total: filtered.length,
		page,
		pages,
		pageSize: SESSIONS_PAGE_SIZE,
		facets: facetsFrom(all),
		filters,
		hasAnySessions: all.length > 0,
		detail,
	};
}

/** One builder serves both people surfaces; only the page size differs. */
export function buildSpeakerDirectory(
	all: PublicSession[],
	url: URL,
	pageSize: number,
): SpeakerDirectoryData {
	const q = (url.searchParams.get("q") ?? "").trim();
	const speakers = speakersFromSessions(all);
	const filtered = q
		? speakers.filter((sp) => sp.name.toLowerCase().includes(q.toLowerCase()))
		: speakers;
	const { page, pages, slice } = paginate(filtered, url, pageSize);
	const detailId = url.searchParams.get("speaker");
	const detail = detailId
		? (speakers.find((sp) => sp.id === detailId) ?? null)
		: null;
	return { speakers: slice, total: filtered.length, page, pages, q, detail };
}

function scheduledDays(sessions: PublicSession[]) {
	const byKey = new Map<string, string>();
	for (const s of sessions) {
		if (s.dayKey && s.dayLabel) byKey.set(s.dayKey, s.dayLabel);
	}
	return [...byKey.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, label]) => ({ key, label }));
}

export function buildAgendaData(
	all: PublicSession[],
	event: EventRow,
	url: URL,
): AgendaSurfaceData {
	const scheduled = all.filter((s) => s.scheduled);
	const days = scheduledDays(scheduled);
	const requested = url.searchParams.get("day");
	const activeDay =
		days.find((d) => d.key === requested)?.key ?? days[0]?.key ?? null;
	const daySessions = scheduled.filter((s) => s.dayKey === activeDay);

	// Window: the event's configured agenda day, widened if a session overflows.
	// The end widens to each block's DISPLAY extent so a floored short session
	// at the day's edge still renders inside the grid.
	let windowStartMin = event.agendaDayStartMin;
	let windowEndMin = event.agendaDayEndMin;
	for (const s of daySessions) {
		if (s.startMin !== null)
			windowStartMin = Math.min(
				windowStartMin,
				Math.floor(s.startMin / 60) * 60,
			);
		if (s.startMin !== null && s.endMin !== null)
			windowEndMin = Math.max(
				windowEndMin,
				Math.ceil(Math.max(s.endMin, s.startMin + MIN_BLOCK_MINUTES) / 60) * 60,
			);
	}

	const roomIds = new Map<string, { name: string; order: number }>();
	for (const s of daySessions) {
		if (s.roomId && s.room) {
			roomIds.set(s.roomId, { name: s.room, order: s.roomOrder ?? 0 });
		}
	}
	const rooms = [...roomIds.entries()]
		.sort(([, a], [, b]) => a.order - b.order || a.name.localeCompare(b.name))
		.map(([id, { name }]) => ({
			id,
			name,
			blocks: layoutLanes(
				daySessions
					.filter((s) => s.roomId === id)
					.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0)),
			),
		}));

	const hourMarks: Array<{ min: number; label: string }> = [];
	for (
		let min = Math.ceil(windowStartMin / 60) * 60;
		min <= windowEndMin;
		min += 60
	) {
		hourMarks.push({ min, label: minutesToLabel(min) });
	}

	const detailId = url.searchParams.get("session");
	const detail = detailId ? (all.find((s) => s.id === detailId) ?? null) : null;
	const active = days.find((d) => d.key === activeDay);
	const dateLabel = active ? (daySessions[0]?.dateLabel ?? active.label) : null;
	return {
		days,
		activeDay,
		dateLabel,
		rooms,
		windowStartMin,
		windowEndMin,
		hourMarks,
		detail,
	};
}

/** A block renders at least this many minutes tall. At the grid's 1.5 px/min
 * scale this is exactly the time line + one title line; below it the text
 * clips mid-line. If the view's scale changes, retune this with it. */
const MIN_BLOCK_MINUTES = 30;

/** Lanes use DISPLAY extents (endMin floored to MIN_BLOCK_MINUTES) so a
 * short session's legible-height box never sits on top of its lane
 * neighbor. laneCount is per overlap CLUSTER, not per day — one lightning
 * block must not shrink every other block in the room. */
function layoutLanes(sessions: PublicSession[]): AgendaBlock[] {
	const blocks: AgendaBlock[] = [];
	const laneEnds: number[] = [];
	let clusterStart = 0;
	let clusterEndMin = 0;
	const sealCluster = (upTo: number) => {
		for (let i = clusterStart; i < upTo; i++) {
			const block = blocks[i];
			if (block) block.laneCount = laneEnds.length || 1;
		}
	};
	for (const s of sessions) {
		const startMin = s.startMin;
		const endMin = s.endMin;
		if (startMin === null || endMin === null) continue;
		if (blocks.length > clusterStart && startMin >= clusterEndMin) {
			sealCluster(blocks.length);
			clusterStart = blocks.length;
			clusterEndMin = 0;
			laneEnds.length = 0;
		}
		const displayEndMin = Math.max(endMin, startMin + MIN_BLOCK_MINUTES);
		let lane = laneEnds.findIndex((end) => end <= startMin);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		laneEnds[lane] = displayEndMin;
		clusterEndMin = Math.max(clusterEndMin, displayEndMin);
		blocks.push({
			sessionId: s.id,
			title: s.title,
			timeRange: s.timeRange,
			track: s.tracks[0] ?? null,
			format: s.format,
			startMin,
			endMin,
			displayEndMin,
			lane,
			laneCount: 1,
		});
	}
	sealCluster(blocks.length);
	return blocks;
}

export function buildItineraryData(
	all: PublicSession[],
	url: URL,
): ItinerarySurfaceData {
	const filters = parseFilters(url);
	const view = url.searchParams.get("view") === "mine" ? "mine" : "day";
	const scheduled = all.filter((s) => s.scheduled);
	// "My schedule" filters client-side against starred ids, so it needs the
	// unfiltered program; the day view honors search + facet filters.
	const visible =
		view === "mine" ? scheduled : filterSessions(scheduled, filters);
	const dayEntries = scheduledDays(scheduled);
	const days: ItineraryDay[] = dayEntries.map(({ key, label }) => {
		const daySessions = visible
			.filter((s) => s.dayKey === key)
			.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
		const groups: ItineraryDay["groups"] = [];
		for (const s of daySessions) {
			const timeLabelValue = s.startLabel ?? "";
			const last = groups[groups.length - 1];
			if (last && last.timeLabel === timeLabelValue) {
				last.sessions.push(s);
			} else {
				groups.push({ timeLabel: timeLabelValue, sessions: [s] });
			}
		}
		return {
			key,
			label,
			dateLabel: daySessions[0]?.dateLabel ?? label,
			groups,
		};
	});
	const requested = url.searchParams.get("day");
	const activeDay =
		days.find((d) => d.key === requested)?.key ?? days[0]?.key ?? null;
	return { days, activeDay, filters, facets: facetsFrom(scheduled), view };
}
