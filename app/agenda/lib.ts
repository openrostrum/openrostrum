/**
 * Pure agenda logic — timezone math, conflict detection, lane layout, and
 * greedy auto-placement. Shared verbatim by the server action/loader and the
 * client board so optimistic UI and persisted writes can never disagree.
 */

export const SLOT_MINS = 15;

export const DEFAULT_DURATION_MINS = 30;

export type AgendaSession = {
	id: string;
	title: string;
	status: string;
	/** status ∈ the event's schedulable set — gates dragging and admin conflicts. */
	schedulable: boolean;
	/** Accepted and content-approved — the attendee-facing agenda projection. */
	publiclyVisible: boolean;
	startsAt: number | null; // epoch ms
	endsAt: number | null;
	roomId: string | null;
	formatName: string | null;
	/** Format default duration — used when placing a session with no times yet. */
	durationMins: number;
	tracks: { id: string; name: string; color: string }[];
	speakers: { contactId: string; name: string }[];
};

export type AgendaRoom = { id: string; name: string; capacity: number | null };

/**
 * THE duration rule, in one place: a session that already has a time span
 * keeps it (a move never resizes a block); a first placement takes the
 * format's default. Server writes, optimistic UI, and drop previews all call
 * this.
 */
export function sessionDurationMins(
	s: Pick<AgendaSession, "startsAt" | "endsAt" | "durationMins">,
): number {
	if (s.startsAt != null && s.endsAt != null) {
		return Math.round((s.endsAt - s.startsAt) / 60_000);
	}
	return s.durationMins;
}

/** Strict overlap — touching intervals (end == start) do not overlap. */
export function intervalsOverlap(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/**
 * First room free over [startMs, endMs) — the week-view drop rule for
 * sessions that don't have a room yet. Falls back to the first room so a
 * drop always lands somewhere (the conflict detector then flags it).
 */
export function pickFreeRoom(
	rooms: readonly { id: string }[],
	occupied: readonly {
		roomId: string | null;
		startsAt: number;
		endsAt: number;
	}[],
	startMs: number,
	endMs: number,
): string | null {
	const free = rooms.find(
		(room) =>
			!occupied.some(
				(o) =>
					o.roomId === room.id &&
					intervalsOverlap(o.startsAt, o.endsAt, startMs, endMs),
			),
	);
	return (free ?? rooms[0])?.id ?? null;
}

export type SessionFilters = {
	q: string;
	trackId: string;
	roomId: string;
	status: string;
	showDrafts: boolean;
};

type PlacementTimes = {
	startsAt: unknown | null;
	endsAt: unknown | null;
};

/** A scheduled block is valid only when both ends of its interval exist. */
export function hasCompletePlacement(s: PlacementTimes): boolean {
	return s.startsAt != null && s.endsAt != null;
}

type CompleteAgendaSession = AgendaSession & {
	startsAt: number;
	endsAt: number;
};

function isSchedulablePlacement(s: AgendaSession): s is CompleteAgendaSession {
	return s.schedulable && hasCompletePlacement(s);
}

export type AgendaSessionClassification = {
	scheduled: CompleteAgendaSession[];
	unscheduled: AgendaSession[];
	needsSlot: AgendaSession[];
	schedulablePlaced: CompleteAgendaSession[];
	schedulableUnplaced: AgendaSession[];
};

/**
 * Visibility, placement completeness, and scheduling permission are separate:
 * retained placements stay visible, but only schedulable rows occupy or move.
 */
export function classifyAgendaSessions(
	sessions: readonly AgendaSession[],
	showDrafts: boolean,
): AgendaSessionClassification {
	const complete = (s: AgendaSession): s is CompleteAgendaSession =>
		hasCompletePlacement(s);
	const visible = sessions.filter((s) => isSessionVisible(s, showDrafts));
	return {
		scheduled: visible.filter(complete),
		unscheduled: visible.filter(
			(s) => s.schedulable && !hasCompletePlacement(s),
		),
		needsSlot: sessions.filter(
			(s) => s.status === "accepted" && !hasCompletePlacement(s),
		),
		schedulablePlaced: sessions.filter(isSchedulablePlacement),
		schedulableUnplaced: sessions.filter(
			(s) => s.schedulable && !hasCompletePlacement(s),
		),
	};
}

/**
 * Drafts always obey their display toggle. Other complete placements remain
 * visible after status-policy changes, without becoming schedulable again.
 */
export function isSessionVisible(
	s: Pick<AgendaSession, "schedulable" | "status" | "startsAt" | "endsAt">,
	showDrafts: boolean,
): boolean {
	if (s.status === "draft") return showDrafts;
	return s.schedulable || hasCompletePlacement(s);
}

/**
 * The one filter predicate — board dimming, the tray, and the List view all
 * share it. The room filter only constrains sessions that HAVE a room:
 * unscheduled cards stay visible so there is still something to place.
 */
export function matchesSessionFilters(
	s: AgendaSession,
	f: SessionFilters,
): boolean {
	if (f.trackId && !s.tracks.some((t) => t.id === f.trackId)) return false;
	if (f.roomId && s.roomId && s.roomId !== f.roomId) return false;
	if (f.status && s.status !== f.status) return false;
	if (f.q) {
		const q = f.q.toLowerCase();
		const inTitle = s.title.toLowerCase().includes(q);
		const inSpeaker = s.speakers.some((sp) =>
			sp.name.toLowerCase().includes(q),
		);
		if (!inTitle && !inSpeaker) return false;
	}
	return true;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function tzFormatter(timeZone: string): Intl.DateTimeFormat {
	let fmt = fmtCache.get(timeZone);
	if (!fmt) {
		try {
			fmt = new Intl.DateTimeFormat("en-US", {
				timeZone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		} catch {
			// A malformed stored timezone must not take the whole agenda down.
			fmt = tzFormatter("UTC");
		}
		fmtCache.set(timeZone, fmt);
	}
	return fmt;
}

/** Epoch ms → the event-TZ calendar day ("YYYY-MM-DD") + minute-of-day. */
export function utcToWall(
	ms: number,
	timeZone: string,
): { day: string; minutes: number } {
	const parts = tzFormatter(timeZone).formatToParts(new Date(ms));
	const get = (type: string) =>
		parts.find((p) => p.type === type)?.value ?? "00";
	const hour = Number(get("hour")) % 24;
	return {
		day: `${get("year")}-${get("month")}-${get("day")}`,
		minutes: hour * 60 + Number(get("minute")),
	};
}

/**
 * Event-TZ wall clock → epoch ms. Iterative because a zone's UTC offset is a
 * function of the instant being sought (DST); two passes converge for every
 * real zone, a third guards pathological rules.
 */
export function wallToUtc(
	day: string,
	minutes: number,
	timeZone: string,
): number {
	const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
	const desired = Date.UTC(y, m - 1, d) + minutes * 60_000;
	let ms = desired;
	for (let i = 0; i < 3; i += 1) {
		const wall = utcToWall(ms, timeZone);
		const [wy = 0, wm = 1, wd = 1] = wall.day.split("-").map(Number);
		const rendered = Date.UTC(wy, wm - 1, wd) + wall.minutes * 60_000;
		if (rendered === desired) return ms;
		ms += desired - rendered;
	}
	return ms;
}

/** Next "YYYY-MM-DD" — pure calendar arithmetic on the day string, so DST
 * (23/25-hour days) can never skip or duplicate a column. */
function nextDay(day: string): string {
	const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d) + 86_400_000)
		.toISOString()
		.slice(0, 10);
}

/**
 * The event's calendar days, inclusive of both bounds' EVENT-TZ dates. Start
 * and end are real instants, so a 3-day event must yield 3 columns in its own
 * timezone — reading UTC dates here shifted the strip by a day. Capped so a bad
 * date range can't render an unbounded strip.
 */
export function eventDayList(
	startMs: number | null,
	endMs: number | null,
	timeZone: string,
	cap = 30,
): string[] {
	if (startMs == null) return [];
	const first = utcToWall(startMs, timeZone).day;
	const last =
		endMs != null && endMs >= startMs ? utcToWall(endMs, timeZone).day : first;
	const days: string[] = [];
	let cursor = first;
	for (let i = 0; i < cap; i += 1) {
		days.push(cursor);
		if (cursor >= last) break;
		cursor = nextDay(cursor);
	}
	return days;
}

/**
 * The day strip the builder schedules across: the event's date range, falling
 * back to days that already hold sessions, then to today — the grid must
 * always have at least one day even on a half-configured event.
 */
export function resolveEventDays(
	startMs: number | null,
	endMs: number | null,
	scheduledStartsMs: readonly number[],
	timezone: string,
): string[] {
	const fromEvent = eventDayList(startMs, endMs, timezone);
	if (fromEvent.length > 0) return fromEvent;
	const fromSessions = [
		...new Set(scheduledStartsMs.map((ms) => utcToWall(ms, timezone).day)),
	].sort();
	if (fromSessions.length > 0) return fromSessions;
	return [utcToWall(Date.now(), timezone).day];
}

export function formatMinutes(minutes: number): string {
	const h24 = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	const suffix = h24 < 12 ? "AM" : "PM";
	return mins === 0
		? `${h12} ${suffix}`
		: `${h12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function formatRangeMs(
	startMs: number,
	endMs: number,
	timeZone: string,
): string {
	const start = utcToWall(startMs, timeZone);
	const end = utcToWall(endMs, timeZone);
	const suffix = end.day === start.day ? "" : " (+1d)";
	return `${formatMinutes(start.minutes)} – ${formatMinutes(end.minutes)}${suffix}`;
}

export function formatDayLabel(day: string): string {
	const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export type Conflict = {
	aId: string;
	aTitle: string;
	bId: string;
	bTitle: string;
	kind: "room" | "speaker";
	roomName?: string;
	personName?: string;
	overlapStartMs: number;
	overlapEndMs: number;
};

export type ConflictScope = "schedulable" | "public";

/**
 * The two Sessionboard conflict classes, nothing more: same-room overlap and a
 * person double-booked (any rooms); track collisions are deliberately not
 * detected. Overlap is STRICT — back-to-back is not a conflict. Admin detection
 * reads schedulable rows, publish detection only attendee-visible ones.
 */
export function detectConflicts(
	sessions: readonly AgendaSession[],
	rooms: readonly AgendaRoom[],
	scope: ConflictScope = "schedulable",
): Conflict[] {
	const roomName = new Map(rooms.map((r) => [r.id, r.name]));
	const rows = sessions
		.filter(
			(s): s is CompleteAgendaSession =>
				hasCompletePlacement(s) &&
				(scope === "public" ? s.publiclyVisible : s.schedulable),
		)
		.sort((a, b) => a.startsAt - b.startsAt);
	const out: Conflict[] = [];
	for (let i = 0; i < rows.length; i += 1) {
		const a = rows[i];
		if (!a) continue;
		for (let j = i + 1; j < rows.length; j += 1) {
			const b = rows[j];
			if (!b) continue;
			if (b.startsAt >= a.endsAt) break; // sorted sweep — no later row overlaps a
			const base = {
				aId: a.id,
				aTitle: a.title,
				bId: b.id,
				bTitle: b.title,
				overlapStartMs: Math.max(a.startsAt, b.startsAt),
				overlapEndMs: Math.min(a.endsAt, b.endsAt),
			};
			if (a.roomId && b.roomId && a.roomId === b.roomId) {
				out.push({
					...base,
					kind: "room",
					roomName: roomName.get(a.roomId) ?? "the same room",
				});
			}
			const bSpeakerIds = new Set(
				b.speakers.map((speaker) => speaker.contactId),
			);
			const seenSpeakerIds = new Set<string>();
			for (const person of a.speakers) {
				if (
					bSpeakerIds.has(person.contactId) &&
					!seenSpeakerIds.has(person.contactId)
				) {
					seenSpeakerIds.add(person.contactId);
					out.push({ ...base, kind: "speaker", personName: person.name });
				}
			}
		}
	}
	return out;
}

export type ConflictReason =
	| { kind: "room"; roomName: string }
	| { kind: "speaker"; personName: string };

export type LogicalConflict = {
	aId: string;
	aTitle: string;
	bId: string;
	bTitle: string;
	overlapStartMs: number;
	overlapEndMs: number;
	reasons: ConflictReason[];
};

export const MAX_CONFLICT_ROWS = 100;

/**
 * One row per session pair, earliest overlap first — CAPPED. Room and speaker
 * reasons are retained on the pair while duplicate participant roles collapse.
 */
export function buildConflictRows(conflicts: readonly Conflict[]): {
	rows: LogicalConflict[];
	total: number;
} {
	const byPair = new Map<string, LogicalConflict>();
	for (const conflict of conflicts) {
		const forward = conflict.aId.localeCompare(conflict.bId) <= 0;
		const aId = forward ? conflict.aId : conflict.bId;
		const bId = forward ? conflict.bId : conflict.aId;
		const key = JSON.stringify([aId, bId]);
		let logical = byPair.get(key);
		if (!logical) {
			logical = {
				aId,
				aTitle: forward ? conflict.aTitle : conflict.bTitle,
				bId,
				bTitle: forward ? conflict.bTitle : conflict.aTitle,
				overlapStartMs: conflict.overlapStartMs,
				overlapEndMs: conflict.overlapEndMs,
				reasons: [],
			};
			byPair.set(key, logical);
		}
		const reason: ConflictReason =
			conflict.kind === "room"
				? { kind: "room", roomName: conflict.roomName ?? "the same room" }
				: {
						kind: "speaker",
						personName: conflict.personName ?? "The same person",
					};
		const reasonKey =
			reason.kind === "room"
				? `room:${reason.roomName}`
				: `speaker:${reason.personName}`;
		if (
			!logical.reasons.some((current) => {
				const currentKey =
					current.kind === "room"
						? `room:${current.roomName}`
						: `speaker:${current.personName}`;
				return currentKey === reasonKey;
			})
		) {
			logical.reasons.push(reason);
		}
	}

	const all = [...byPair.values()];
	for (const conflict of all) {
		conflict.reasons.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "room" ? -1 : 1;
			const aLabel = a.kind === "room" ? a.roomName : a.personName;
			const bLabel = b.kind === "room" ? b.roomName : b.personName;
			return aLabel.localeCompare(bLabel);
		});
	}
	all.sort(
		(a, b) =>
			a.overlapStartMs - b.overlapStartMs ||
			a.aTitle.localeCompare(b.aTitle) ||
			a.bTitle.localeCompare(b.bTitle),
	);
	return { rows: all.slice(0, MAX_CONFLICT_ROWS), total: all.length };
}

/** Session id → conflicts touching it (drives the red-clock markers). */
export function conflictsById(
	conflicts: readonly Conflict[],
): Map<string, Conflict[]> {
	const map = new Map<string, Conflict[]>();
	for (const c of conflicts) {
		for (const id of [c.aId, c.bId]) {
			const list = map.get(id) ?? [];
			list.push(c);
			map.set(id, list);
		}
	}
	return map;
}

/** Human sentence for one side of a conflict pair, as the Conflicts tab shows it. */
export function conflictSentence(
	conflict: Conflict,
	sideId: string,
	timeZone: string,
): string {
	const other = sideId === conflict.aId ? conflict.bTitle : conflict.aTitle;
	const range = formatRangeMs(
		conflict.overlapStartMs,
		conflict.overlapEndMs,
		timeZone,
	);
	return conflict.kind === "speaker"
		? `${conflict.personName} is also scheduled in “${other}” during this time (${range}).`
		: `Shares ${conflict.roomName} with “${other}” (overlapping ${range}).`;
}

/**
 * Interval partitioning for blocks sharing a column: overlapping blocks split
 * the column into side-by-side lanes so nothing renders on top of anything.
 */
export function layoutLanes(
	items: readonly { id: string; start: number; end: number }[],
): Map<string, { lane: number; laneCount: number }> {
	const sorted = [...items].sort(
		(a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
	);
	const result = new Map<string, { lane: number; laneCount: number }>();
	let cluster: { id: string; end: number; lane: number }[] = [];
	let clusterIds: string[] = [];
	let clusterMax = 0;

	const flush = () => {
		for (const id of clusterIds) {
			const entry = result.get(id);
			if (entry) entry.laneCount = clusterMax;
		}
		cluster = [];
		clusterIds = [];
		clusterMax = 0;
	};

	for (const item of sorted) {
		cluster = cluster.filter((c) => c.end > item.start);
		if (cluster.length === 0 && clusterIds.length > 0) flush();
		const used = new Set(cluster.map((c) => c.lane));
		let lane = 0;
		while (used.has(lane)) lane += 1;
		cluster.push({ id: item.id, end: item.end, lane });
		clusterIds.push(item.id);
		clusterMax = Math.max(clusterMax, lane + 1);
		result.set(item.id, { lane, laneCount: 1 });
	}
	flush();
	return result;
}

export type AutoPlaceInput = {
	days: readonly string[];
	timezone: string;
	dayStartMin: number;
	dayEndMin: number;
	rooms: readonly { id: string }[];
	scheduled: readonly {
		id: string;
		startsAt: number;
		endsAt: number;
		roomId: string | null;
		speakerIds: readonly string[];
	}[];
	unscheduled: readonly {
		id: string;
		durationMins: number;
		speakerIds: readonly string[];
	}[];
};

export type Placement = {
	id: string;
	roomId: string;
	startsAtMs: number;
	endsAtMs: number;
};

type Interval = { start: number; end: number };

function overlapsAny(list: readonly Interval[], start: number, end: number) {
	return list.some((i) => intervalsOverlap(i.start, i.end, start, end));
}

/**
 * Greedy first-fit: earliest day, earliest 15-min slot, first room that is
 * free — skipping any slot where one of the session's speakers is already
 * booked. Conflict-free by construction (same strict-overlap rule as the
 * detector). Longest sessions place first so they still find room-sized gaps.
 */
export function autoPlace(input: AutoPlaceInput): {
	placements: Placement[];
	unplacedIds: string[];
} {
	const roomBusy = new Map<string, Interval[]>();
	const speakerBusy = new Map<string, Interval[]>();
	const push = (map: Map<string, Interval[]>, key: string, i: Interval) => {
		const list = map.get(key) ?? [];
		list.push(i);
		map.set(key, list);
	};
	for (const s of input.scheduled) {
		const interval = { start: s.startsAt, end: s.endsAt };
		if (s.roomId) push(roomBusy, s.roomId, interval);
		for (const sp of s.speakerIds) push(speakerBusy, sp, interval);
	}

	const wallCache = new Map<string, number>();
	const toUtc = (day: string, minutes: number) => {
		const key = `${day}:${minutes}`;
		let ms = wallCache.get(key);
		if (ms === undefined) {
			ms = wallToUtc(day, minutes, input.timezone);
			wallCache.set(key, ms);
		}
		return ms;
	};

	const queue = [...input.unscheduled].sort(
		(a, b) => b.durationMins - a.durationMins || a.id.localeCompare(b.id),
	);
	const placements: Placement[] = [];
	const unplacedIds: string[] = [];

	for (const session of queue) {
		let placed: Placement | null = null;
		for (const day of input.days) {
			for (
				let minute = input.dayStartMin;
				minute + session.durationMins <= input.dayEndMin;
				minute += SLOT_MINS
			) {
				const start = toUtc(day, minute);
				const end = toUtc(day, minute + session.durationMins);
				if (
					session.speakerIds.some((sp) =>
						overlapsAny(speakerBusy.get(sp) ?? [], start, end),
					)
				) {
					continue;
				}
				const room = input.rooms.find(
					(r) => !overlapsAny(roomBusy.get(r.id) ?? [], start, end),
				);
				if (room) {
					placed = {
						id: session.id,
						roomId: room.id,
						startsAtMs: start,
						endsAtMs: end,
					};
					break;
				}
			}
			if (placed) break;
		}
		if (placed) {
			placements.push(placed);
			push(roomBusy, placed.roomId, {
				start: placed.startsAtMs,
				end: placed.endsAtMs,
			});
			for (const sp of session.speakerIds) {
				push(speakerBusy, sp, {
					start: placed.startsAtMs,
					end: placed.endsAtMs,
				});
			}
		} else {
			unplacedIds.push(session.id);
		}
	}
	return { placements, unplacedIds };
}
