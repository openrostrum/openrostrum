import { describe, expect, it } from "vitest";
import {
	type AgendaSession,
	autoPlace,
	buildConflictRows,
	type Conflict,
	conflictSentence,
	detectConflicts,
	eventDayList,
	layoutLanes,
	pickFreeRoom,
	resolveEventDays,
	utcToWall,
	wallToUtc,
} from "../app/agenda/lib";

// Expected instants are hand-derived from the event timezone's fixed UTC
// offsets (America/Los_Angeles: PDT=UTC-7 in Oct 2026, PST=UTC-8 after
// Nov 1 2026) — independent of the implementation under test.

const TZ = "America/Los_Angeles";
const utc = (y: number, mo: number, d: number, h: number, min = 0): number =>
	Date.UTC(y, mo - 1, d, h, min);

function session(over: Partial<AgendaSession> & { id: string }): AgendaSession {
	return {
		title: over.id,
		status: "accepted",
		schedulable: true,
		startsAt: null,
		endsAt: null,
		roomId: null,
		formatName: "Talk",
		durationMins: 30,
		tracks: [],
		speakers: [],
		...over,
	};
}

const ROOMS = [
	{ id: "room_main", name: "Main Hall", capacity: 500 },
	{ id: "room_305", name: "Room 305", capacity: 60 },
];

describe("wall-clock conversion", () => {
	it("converts event-TZ wall clock to UTC across the DST boundary", () => {
		// 9:30 AM PDT on Oct 12 = 16:30 UTC.
		expect(wallToUtc("2026-10-12", 570, TZ)).toBe(utc(2026, 10, 12, 16, 30));
		// After DST ends (Nov 1 2026) the same wall clock is 17:30 UTC.
		expect(wallToUtc("2026-11-02", 570, TZ)).toBe(utc(2026, 11, 2, 17, 30));
	});

	it("round-trips through utcToWall", () => {
		const ms = wallToUtc("2026-10-13", 840, TZ); // 2:00 PM PDT
		expect(utcToWall(ms, TZ)).toEqual({ day: "2026-10-13", minutes: 840 });
	});
});

describe("event day list", () => {
	it("a 3-day LA event renders exactly 3 days (judge repro: May 12–14 showed May 12–15)", () => {
		// Settings "May 12 09:00 → May 14 17:00" in LA store 16:00Z / next-day
		// 00:00Z (PDT = UTC-7); reading UTC dates leaked a phantom 4th day.
		expect(eventDayList(utc(2027, 5, 12, 16), utc(2027, 5, 15, 0), TZ)).toEqual(
			["2027-05-12", "2027-05-13", "2027-05-14"],
		);
	});

	it("an east-of-UTC event does not start a day early", () => {
		// May 12 00:00 → May 14 23:00 in Tokyo (UTC+9) = May 11 15:00Z → May 14
		// 14:00Z; the UTC read began the strip on May 11.
		expect(
			eventDayList(utc(2027, 5, 11, 15), utc(2027, 5, 14, 14), "Asia/Tokyo"),
		).toEqual(["2027-05-12", "2027-05-13", "2027-05-14"]);
	});

	it("spans the spring-forward DST transition without skipping or repeating a day", () => {
		// Mar 12 09:00 PST (UTC-8) → Mar 15 17:00 PDT (UTC-7), 2027; US DST
		// starts Mar 14 — the 23-hour day must still be one column.
		expect(eventDayList(utc(2027, 3, 12, 17), utc(2027, 3, 16, 0), TZ)).toEqual(
			["2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"],
		);
	});

	it("degrades an inverted range to one day and caps a runaway range", () => {
		expect(
			eventDayList(utc(2027, 5, 14, 16), utc(2027, 5, 12, 16), TZ),
		).toEqual(["2027-05-14"]);
		expect(
			eventDayList(utc(2027, 1, 1, 8), utc(2027, 12, 31, 8), TZ),
		).toHaveLength(30);
	});

	it("falls back to session days, then today, when the event has no dates", () => {
		const fromSessions = resolveEventDays(
			null,
			null,
			[utc(2026, 10, 13, 17, 0), utc(2026, 10, 12, 17, 0)],
			TZ,
		);
		expect(fromSessions).toEqual(["2026-10-12", "2026-10-13"]);
		expect(resolveEventDays(null, null, [], TZ)).toHaveLength(1);
	});
});

describe("conflict detection (speaker + same-room only)", () => {
	// Live Demo 10:00–10:30 and Panel 10:15–11:15, both Main Hall (PDT).
	const liveDemo = session({
		id: "live",
		title: "Live Demo: Agent Swarms in Production",
		startsAt: utc(2026, 10, 12, 17, 0),
		endsAt: utc(2026, 10, 12, 17, 30),
		roomId: "room_main",
		speakers: [{ contactId: "c_marco", name: "Marco Silva" }],
	});
	const panel = session({
		id: "panel",
		title: "Panel: Is the CFP Dead?",
		startsAt: utc(2026, 10, 12, 17, 15),
		endsAt: utc(2026, 10, 12, 18, 15),
		roomId: "room_main",
		speakers: [{ contactId: "c_dana", name: "Dana Fields" }],
	});

	it("flags a same-room overlap as one reciprocal pair with the overlap window", () => {
		const conflicts = detectConflicts([liveDemo, panel], ROOMS);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]).toMatchObject({
			kind: "room",
			roomName: "Main Hall",
			overlapStartMs: utc(2026, 10, 12, 17, 15),
			overlapEndMs: utc(2026, 10, 12, 17, 30),
		});
	});

	it("flags a shared speaker ACROSS rooms and names the person", () => {
		// Office Hours 10:15–10:45 in Room 305, also Marco Silva.
		const officeHours = session({
			id: "office",
			title: "Office Hours: D1 Performance Clinic",
			startsAt: utc(2026, 10, 12, 17, 15),
			endsAt: utc(2026, 10, 12, 17, 45),
			roomId: "room_305",
			speakers: [{ contactId: "c_marco", name: "Marco Silva" }],
		});
		const conflicts = detectConflicts([liveDemo, officeHours], ROOMS);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.kind).toBe("speaker");
		expect(conflicts[0]?.personName).toBe("Marco Silva");
		const sentence = conflictSentence(
			conflicts[0] as NonNullable<(typeof conflicts)[0]>,
			"office",
			TZ,
		);
		expect(sentence).toContain("Marco Silva");
		expect(sentence).toContain("Live Demo: Agent Swarms in Production");
	});

	it("does NOT flag same track + same time in different rooms (no track collisions)", () => {
		const workshop = session({
			id: "ws",
			startsAt: utc(2026, 10, 12, 18, 30),
			endsAt: utc(2026, 10, 12, 20, 0),
			roomId: "room_305",
			tracks: [
				{ id: "t_devex", name: "Developer Experience", color: "#f59e0b" },
			],
			speakers: [{ contactId: "c_lena", name: "Lena Ortiz" }],
		});
		const panelSameTrack = session({
			id: "panel2",
			startsAt: utc(2026, 10, 12, 18, 30),
			endsAt: utc(2026, 10, 12, 19, 30),
			roomId: "room_main",
			tracks: [
				{ id: "t_devex", name: "Developer Experience", color: "#f59e0b" },
			],
			speakers: [{ contactId: "c_dana", name: "Dana Fields" }],
		});
		expect(detectConflicts([workshop, panelSameTrack], ROOMS)).toEqual([]);
	});

	it("treats touching blocks (end == next start) as NOT conflicting", () => {
		// Workshop until 13:00, Office Hours from 13:00 — same room AND same
		// speaker; strict inequality must hold for both conflict classes.
		const a = session({
			id: "a",
			startsAt: utc(2026, 10, 12, 18, 30),
			endsAt: utc(2026, 10, 12, 20, 0),
			roomId: "room_305",
			speakers: [{ contactId: "c_marco", name: "Marco Silva" }],
		});
		const b = session({
			id: "b",
			startsAt: utc(2026, 10, 12, 20, 0),
			endsAt: utc(2026, 10, 12, 20, 30),
			roomId: "room_305",
			speakers: [{ contactId: "c_marco", name: "Marco Silva" }],
		});
		expect(detectConflicts([a, b], ROOMS)).toEqual([]);
	});

	it("ignores non-schedulable rows even when their times overlap", () => {
		const ghost = session({
			id: "ghost",
			status: "withdrawn",
			schedulable: false,
			startsAt: utc(2026, 10, 12, 17, 0),
			endsAt: utc(2026, 10, 12, 18, 0),
			roomId: "room_main",
		});
		expect(detectConflicts([liveDemo, ghost], ROOMS)).toEqual([]);
	});
});

describe("free-room pick (week-view drops)", () => {
	const occupied = [
		{
			roomId: "room_main",
			startsAt: utc(2026, 10, 12, 17, 0),
			endsAt: utc(2026, 10, 12, 18, 0),
		},
	];
	it("skips a room that is busy over the window and falls back to the first room when all are", () => {
		const rooms = [{ id: "room_main" }, { id: "room_305" }];
		expect(
			pickFreeRoom(
				rooms,
				occupied,
				utc(2026, 10, 12, 17, 30),
				utc(2026, 10, 12, 18, 0),
			),
		).toBe("room_305");
		// Touching the busy interval is fine — strict overlap.
		expect(
			pickFreeRoom(
				rooms,
				occupied,
				utc(2026, 10, 12, 18, 0),
				utc(2026, 10, 12, 18, 30),
			),
		).toBe("room_main");
		expect(
			pickFreeRoom(
				[{ id: "room_main" }],
				occupied,
				utc(2026, 10, 12, 17, 30),
				utc(2026, 10, 12, 18, 0),
			),
		).toBe("room_main"); // all busy → first room; the conflict detector flags it
	});
});

describe("lane layout", () => {
	it("splits overlapping blocks into side-by-side lanes and keeps disjoint blocks full width", () => {
		const lanes = layoutLanes([
			{ id: "a", start: 600, end: 660 },
			{ id: "b", start: 630, end: 690 },
			{ id: "c", start: 700, end: 730 },
		]);
		expect(lanes.get("a")).toEqual({ lane: 0, laneCount: 2 });
		expect(lanes.get("b")).toEqual({ lane: 1, laneCount: 2 });
		expect(lanes.get("c")).toEqual({ lane: 0, laneCount: 1 });
	});
});

describe("auto-place", () => {
	const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14"];
	const base = {
		days: DAYS,
		timezone: TZ,
		dayStartMin: 480,
		dayEndMin: 1080,
		rooms: [{ id: "room_main" }, { id: "room_305" }],
	};

	it("places every session conflict-free, inside the day window and event days", () => {
		const result = autoPlace({
			...base,
			scheduled: [
				{
					id: "existing",
					startsAt: utc(2026, 10, 12, 15, 0),
					endsAt: utc(2026, 10, 12, 15, 45),
					roomId: "room_main",
					speakerIds: ["c_noor"],
				},
			],
			unscheduled: [
				{ id: "u1", durationMins: 45, speakerIds: ["c_noor"] },
				{ id: "u2", durationMins: 30, speakerIds: ["c_marco"] },
				{ id: "u3", durationMins: 30, speakerIds: ["c_marco"] },
				{ id: "u4", durationMins: 90, speakerIds: [] },
			],
		});
		expect(result.unplacedIds).toEqual([]);
		expect(result.placements).toHaveLength(4);
		const asSessions: AgendaSession[] = [
			session({
				id: "existing",
				startsAt: utc(2026, 10, 12, 15, 0),
				endsAt: utc(2026, 10, 12, 15, 45),
				roomId: "room_main",
				speakers: [{ contactId: "c_noor", name: "Noor Haddad" }],
			}),
			...result.placements.map((p) => {
				const speakers =
					p.id === "u1"
						? [{ contactId: "c_noor", name: "Noor Haddad" }]
						: p.id === "u2" || p.id === "u3"
							? [{ contactId: "c_marco", name: "Marco Silva" }]
							: [];
				return session({
					id: p.id,
					startsAt: p.startsAtMs,
					endsAt: p.endsAtMs,
					roomId: p.roomId,
					speakers,
				});
			}),
		];
		expect(detectConflicts(asSessions, ROOMS)).toEqual([]);
		for (const p of result.placements) {
			const start = utcToWall(p.startsAtMs, TZ);
			const end = utcToWall(p.endsAtMs, TZ);
			expect(DAYS).toContain(start.day);
			expect(start.minutes).toBeGreaterThanOrEqual(480);
			expect(end.minutes).toBeLessThanOrEqual(1080);
		}
	});

	it("reports sessions that cannot fit instead of placing them in conflict", () => {
		const result = autoPlace({
			...base,
			dayStartMin: 480,
			dayEndMin: 540, // one 60-min window, one room
			days: ["2026-10-12"],
			rooms: [{ id: "room_main" }],
			scheduled: [],
			unscheduled: [
				{ id: "u1", durationMins: 60, speakerIds: [] },
				{ id: "u2", durationMins: 60, speakerIds: [] },
			],
		});
		expect(result.placements).toHaveLength(1);
		expect(result.unplacedIds).toHaveLength(1);
	});
});

describe("conflicts-tab rows stay bounded", () => {
	// Stacked overlapping placements grow conflict pairs quadratically; the tab
	// once rendered 2 unbounded rows per conflict and exceeded the Worker CPU
	// budget in production (HTTP 1102) — the table must stay capped with an
	// honest total.
	const conflict = (i: number, startMin: number): Conflict => ({
		aId: `a${i}`,
		aTitle: `Session A${i}`,
		bId: `b${i}`,
		bTitle: `Session B${i}`,
		kind: "room",
		roomName: "Main Hall",
		overlapStartMs: utc(2026, 10, 12, 17, 0) + startMin * 60_000,
		overlapEndMs: utc(2026, 10, 12, 17, 30) + startMin * 60_000,
	});

	it("caps rendered rows at 100 while reporting the true total", () => {
		const conflicts = Array.from({ length: 120 }, (_, i) => conflict(i, i));
		const { rows, total } = buildConflictRows(conflicts);
		expect(total).toBe(240); // two sides per conflict
		expect(rows).toHaveLength(100);
		// earliest overlaps first — the cap keeps the most urgent rows visible
		expect(rows[0]?.conflict.overlapStartMs).toBeLessThanOrEqual(
			rows[99]?.conflict.overlapStartMs ?? 0,
		);
	});

	it("returns every row when under the cap", () => {
		const conflicts = [conflict(1, 0), conflict(2, 5)];
		const { rows, total } = buildConflictRows(conflicts);
		expect(total).toBe(4);
		expect(rows.map((r) => r.sideId)).toEqual(["a1", "b1", "a2", "b2"]);
	});
});
