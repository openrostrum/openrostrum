import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	CONTENT_STATUS,
	events,
	rooms,
	SUBMISSION_STATUS,
	submissions,
} from "../app/db/schema";
import { isPubliclyVisible, loadPublicSessions } from "../app/lib/program";
import type {
	AgendaSurfaceData,
	ItinerarySurfaceData,
	ProgramEvent,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "../app/lib/program-types";
import { loader as galleryLoader } from "../app/routes/gallery.$eventSlug";
import { loader as itineraryLoader } from "../app/routes/itinerary.$eventSlug";
import { loader as scheduleLoader } from "../app/routes/schedule.$eventSlug";
import { loader as sessionsLoader } from "../app/routes/sessions.$eventSlug";
import { loader as speakersLoader } from "../app/routes/speakers.$eventSlug";
import { AgendaSurface, ProgramShell, SessionsSurface } from "../app/widgets";
import { CONTEXT, seedProgram, thrownStatus, unwrap } from "./program.fixtures";

// Oracles come from the data-exposure matrix (public = accepted + approved
// only; hidden speakers never surface; no emails/phones) and the public-widget
// spec (search matches titles AND speaker names; surname ordering; day
// structure; publish gate).

type SessionsData = { event: ProgramEvent; surface: SessionsSurfaceData };
type SpeakersData = { event: ProgramEvent; surface: SpeakerDirectoryData };
type AgendaData = { event: ProgramEvent; surface: AgendaSurfaceData | null };
type ItineraryData = {
	event: ProgramEvent;
	surface: ItinerarySurfaceData | null;
};

function call<T>(
	loader: (args: never) => Promise<T>,
	url: string,
	slug = "devflow",
) {
	return loader({
		context: CONTEXT,
		request: new Request(url),
		params: { eventSlug: slug },
	} as never);
}

describe("public sessions surface", () => {
	it("projects ONLY accepted + content-approved sessions and hides hidden speakers and PII", async () => {
		await seedProgram();
		const { data } = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow"),
		);
		const ids = data.surface.sessions.map((s) => s.id);
		expect(ids).toEqual(["s1", "s2", "s5"]); // scheduled in time order, unscheduled last
		expect(ids).not.toContain("s3"); // accepted but not approved
		expect(ids).not.toContain("s4"); // approved but not accepted

		const s1 = data.surface.sessions.find((s) => s.id === "s1");
		expect(s1?.speakers.map((sp) => sp.name)).toEqual(["Ada Zhang"]); // hidden speaker dropped
		// Card attribution carries the speaker's title + company (fixture
		// expectation: "Name — Title, Company" on every public speaker mention).
		expect(s1?.speakers[0]?.jobTitle).toBe("CTO");
		expect(s1?.speakers[0]?.companyName).toBe("DevFlow");
		expect(s1?.room).toBe("Main Hall");
		expect(s1?.timeRange).toBe("9:30 AM – 10:00 AM PDT");
		expect(s1?.startLabel).toBe("9:30 AM PDT");
		expect(s1?.description).toBe("Cut the queue."); // rich text stripped
		const s5 = data.surface.sessions.find((s) => s.id === "s5");
		// Entities decode once, &amp; last — double-escaped input stays text.
		expect(s5?.description).toBe("Escaped &lt;b&gt; stays text & sound");

		const serialized = JSON.stringify(data);
		expect(serialized).not.toMatch(/@px\.test/);
		expect(serialized).not.toMatch(/555-0001/);
		expect(serialized).not.toMatch(/mobilePhone|homePhone|passwordHash/);
	});

	it("falls back to UTC formatting when an imported event timezone is malformed", async () => {
		await seedProgram();
		await getDb(env).update(events).set({ timezone: "Not/AZone" });

		const { data } = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow"),
		);

		expect(data.event.timezone).toBe("Not/AZone");
		expect(data.event.dateRange).toBe("May 12 – 14, 2027");
		expect(
			data.surface.sessions.find((session) => session.id === "s1")?.timeRange,
		).toBe("4:30 PM – 5:00 PM UTC");
	});

	it("search matches titles AND speaker names; facets filter", async () => {
		await seedProgram();
		const byTitle = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow?q=Taming"),
		);
		expect(byTitle.data.surface.sessions.map((s) => s.id)).toEqual(["s1"]);
		expect(byTitle.data.surface.total).toBe(1);

		const bySpeaker = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow?q=Alvarez"),
		);
		expect(bySpeaker.data.surface.sessions.map((s) => s.id)).toEqual(["s2"]);

		const byTrack = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow?track=t1"),
		);
		expect(byTrack.data.surface.sessions.map((s) => s.id)).toEqual(["s1"]);

		const byRoom = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow?room=r2"),
		);
		expect(byRoom.data.surface.sessions.map((s) => s.id)).toEqual(["s2"]);

		const byFormat = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow?format=f2"),
		);
		expect(byFormat.data.surface.sessions.map((s) => s.id)).toEqual(["s2"]);
	});

	it("404s an unknown event slug", async () => {
		await seedProgram();
		await call(sessionsLoader, "http://localhost/sessions/nope", "nope").then(
			() => {
				throw new Error("expected a 404 throw");
			},
			(error) => expect(thrownStatus(error)).toBe(404),
		);
	});

	it("states the venue once on a multi-room sessions page", async () => {
		// Oracle: the venue is an event fact (header), not a room fact. A
		// per-row suffix is noise — every room is in the same building.
		const venue = "Yerba Buena Center for the Arts";
		const location = `${venue}, San Francisco, California`;
		await seedProgram();
		const db = getDb(env);
		await db.update(events).set({ location });
		await db.insert(rooms).values([
			{ id: "r3", eventId: "e1", name: "Room 305" },
			{ id: "r4", eventId: "e1", name: "Workshop Room B" },
			{ id: "r5", eventId: "e1", name: "Room A" },
		]);
		await db.insert(submissions).values([
			{
				id: "s_r3",
				eventId: "e1",
				title: "Talk in 305",
				status: "accepted",
				contentStatus: "approved",
				roomId: "r3",
				startsAt: new Date("2027-05-12T18:00:00Z"),
				endsAt: new Date("2027-05-12T18:30:00Z"),
			},
			{
				id: "s_r4",
				eventId: "e1",
				title: "Workshop in B",
				status: "accepted",
				contentStatus: "approved",
				roomId: "r4",
				startsAt: new Date("2027-05-12T19:00:00Z"),
				endsAt: new Date("2027-05-12T20:00:00Z"),
			},
			{
				id: "s_r5",
				eventId: "e1",
				title: "Talk in A",
				status: "accepted",
				contentStatus: "approved",
				roomId: "r5",
				startsAt: new Date("2027-05-13T16:00:00Z"),
				endsAt: new Date("2027-05-13T16:45:00Z"),
			},
		]);

		const { data } = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow"),
		);
		expect(data.event.location).toBe(location);
		expect(data.surface.facets.rooms.map((room) => room.name)).toEqual([
			"Main Hall",
			"Room 2",
			"Room 305",
			"Room A",
			"Workshop Room B",
		]);
		for (const session of data.surface.sessions) {
			expect(session.room ?? "").not.toContain(venue);
		}

		const RoutesStub = createRoutesStub([
			{
				id: "root",
				path: "/",
				Component: () =>
					createElement(ProgramShell, {
						event: data.event,
						active: "sessions",
						children: createElement(SessionsSurface, {
							data: data.surface,
							base: "/sessions/devflow",
							sessionsBase: "/sessions/devflow",
							speakersBase: "/speakers/devflow",
						}),
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);
		expect(html.split(venue).length - 1).toBe(1);
		expect(html).toContain(location);
		expect(html).toContain("Main Hall");
		expect(html).toContain("Room 305");
		expect(html).not.toContain(`Main Hall · ${venue}`);

		const schedule = unwrap<AgendaData>(
			await call(scheduleLoader, "http://localhost/schedule/devflow"),
		);
		expect(schedule.data.surface?.rooms.map((room) => room.name)).toEqual([
			"Main Hall",
			"Room 305",
			"Workshop Room B",
		]);

		const speakers = unwrap<SpeakersData>(
			await call(speakersLoader, "http://localhost/speakers/devflow"),
		);
		for (const speaker of speakers.data.surface.speakers) {
			for (const session of speaker.sessions) {
				expect(session.room ?? "").not.toContain(venue);
			}
		}
	});

	it("keeps a bare room name when the event has no location", async () => {
		await seedProgram();
		const { data } = unwrap<SessionsData>(
			await call(sessionsLoader, "http://localhost/sessions/devflow"),
		);
		expect(data.event.location).toBeNull();
		expect(data.surface.sessions.find((s) => s.id === "s1")?.room).toBe(
			"Main Hall",
		);
	});
});

describe("public speakers + gallery surfaces", () => {
	it("orders alphabetically by surname, drops hidden speakers, lists each speaker's sessions", async () => {
		await seedProgram();
		const { data } = unwrap<SpeakersData>(
			await call(speakersLoader, "http://localhost/speakers/devflow"),
		);
		expect(data.surface.speakers.map((sp) => sp.lastName)).toEqual([
			"Alvarez",
			"Zhang",
		]);
		expect(data.surface.speakers.some((sp) => sp.lastName === "Person")).toBe(
			false,
		);
		const ada = data.surface.speakers.find((sp) => sp.id === "c_ada");
		expect(ada?.jobTitle).toBe("CTO");
		expect(ada?.companyName).toBe("DevFlow");
		expect(ada?.sessions.map((s) => s.id).sort()).toEqual(["s1", "s5"]);
		const s1Ref = ada?.sessions.find((s) => s.id === "s1");
		expect(s1Ref?.room).toBe("Main Hall");
		expect(s1Ref?.timeRange).toBe("9:30 AM – 10:00 AM PDT");
	});

	it("name search narrows and ?speaker= opens the detail projection", async () => {
		await seedProgram();
		const searched = unwrap<SpeakersData>(
			await call(speakersLoader, "http://localhost/speakers/devflow?q=zhang"),
		);
		expect(searched.data.surface.speakers.map((sp) => sp.id)).toEqual([
			"c_ada",
		]);

		const detail = unwrap<SpeakersData>(
			await call(
				galleryLoader,
				"http://localhost/gallery/devflow?speaker=c_ada",
			),
		);
		expect(detail.data.surface.detail?.name).toBe("Ada Zhang");
		expect(detail.data.surface.detail?.bio).toBe("Ships CI pipelines.");
		expect(detail.data.surface.detail?.jobTitle).toBe("CTO");
		expect(detail.data.surface.detail?.companyName).toBe("DevFlow");
	});
});

describe("public sessions drill-down", () => {
	it("?session= opens the detail projection even when filters exclude it; unknown ids stay null", async () => {
		await seedProgram();
		// q=zzz matches nothing — the detail must still resolve so shared links work.
		const detail = unwrap<SessionsData>(
			await call(
				sessionsLoader,
				"http://localhost/sessions/devflow?session=s1&q=zzz",
			),
		);
		expect(detail.data.surface.detail?.id).toBe("s1");
		expect(detail.data.surface.detail?.speakers.map((sp) => sp.name)).toEqual([
			"Ada Zhang",
		]);
		expect(detail.data.surface.total).toBe(0); // list state rides along untouched

		const unknown = unwrap<SessionsData>(
			await call(
				sessionsLoader,
				"http://localhost/sessions/devflow?session=nope",
			),
		);
		expect(unknown.data.surface.detail).toBeNull();
	});
});

describe("public agenda + itinerary surfaces", () => {
	it("builds a day × room grid: days from scheduled sessions, blocks in the right room at the right minutes", async () => {
		await seedProgram();
		const day1 = unwrap<AgendaData>(
			await call(scheduleLoader, "http://localhost/schedule/devflow"),
		);
		const surface = day1.data.surface;
		expect(surface?.days.map((d) => d.key)).toEqual([
			"2027-05-12",
			"2027-05-13",
		]);
		expect(surface?.activeDay).toBe("2027-05-12");
		const mainHall = surface?.rooms.find((r) => r.name === "Main Hall");
		expect(mainHall?.blocks.map((b) => b.sessionId)).toEqual(["s1"]);
		expect(mainHall?.blocks[0]?.startMin).toBe(9 * 60 + 30); // 9:30 AM event TZ
		expect(mainHall?.blocks[0]?.endMin).toBe(10 * 60);
		// The unapproved s3 is scheduled in Main Hall that day and must not leak.
		expect(
			surface?.rooms.flatMap((r) => r.blocks.map((b) => b.sessionId)),
		).not.toContain("s3");

		const day2 = unwrap<AgendaData>(
			await call(
				scheduleLoader,
				"http://localhost/schedule/devflow?day=2027-05-13",
			),
		);
		expect(
			day2.data.surface?.rooms.flatMap((r) => r.blocks.map((b) => b.sessionId)),
		).toEqual(["s2"]);
	});

	it("floors short blocks to a legible height and lanes them so no block underlaps another", async () => {
		await seedProgram();
		// Boundary set: a 10-minute talk inside a 30-minute talk's slot in the
		// SAME room, two back-to-back 10-minute talks whose floored boxes would
		// collide if lanes ignored display extents, and a solo talk later that
		// must keep the full column width.
		await getDb(env)
			.insert(submissions)
			.values([
				{
					id: "s_short",
					eventId: "e1",
					title: "Lightning: Ten Minutes on Tokenizers",
					status: "accepted",
					contentStatus: "approved",
					roomId: "r1",
					startsAt: new Date("2027-05-12T16:35:00Z"), // 9:35 AM PDT
					endsAt: new Date("2027-05-12T16:45:00Z"),
				},
				{
					id: "s_seq1",
					eventId: "e1",
					title: "Lightning A",
					status: "accepted",
					contentStatus: "approved",
					roomId: "r1",
					startsAt: new Date("2027-05-12T17:10:00Z"), // 10:10 AM PDT
					endsAt: new Date("2027-05-12T17:20:00Z"),
				},
				{
					id: "s_seq2",
					eventId: "e1",
					title: "Lightning B",
					status: "accepted",
					contentStatus: "approved",
					roomId: "r1",
					startsAt: new Date("2027-05-12T17:20:00Z"), // 10:20 AM PDT
					endsAt: new Date("2027-05-12T17:30:00Z"),
				},
				{
					id: "s_solo",
					eventId: "e1",
					title: "Solo Talk After The Rush",
					status: "accepted",
					contentStatus: "approved",
					roomId: "r1",
					startsAt: new Date("2027-05-12T19:00:00Z"), // 12:00 PM PDT
					endsAt: new Date("2027-05-12T19:30:00Z"),
				},
			]);
		const { data } = unwrap<AgendaData>(
			await call(scheduleLoader, "http://localhost/schedule/devflow"),
		);
		const blocks =
			data.surface?.rooms.find((r) => r.name === "Main Hall")?.blocks ?? [];
		const byId = new Map(blocks.map((b) => [b.sessionId, b]));

		// Every block gets enough display height for time, title, and track.
		for (const b of blocks) {
			expect(b.displayEndMin - b.startMin).toBeGreaterThanOrEqual(45);
		}
		// Real times are untouched — the floor is display-only.
		expect(byId.get("s_short")?.endMin).toBe(9 * 60 + 45);
		expect(byId.get("s_short")?.displayEndMin).toBe(10 * 60 + 20);

		// The concurrent short talk shares the slot side-by-side, never behind.
		expect(byId.get("s_short")?.lane).not.toBe(byId.get("s1")?.lane);

		// Lane splits stay local to their overlap cluster: the solo talk keeps
		// the full column even though earlier talks split the slot.
		expect(byId.get("s_solo")?.laneCount).toBe(1);
		expect(byId.get("s1")?.laneCount).toBe(3);

		// No two same-lane boxes within a cluster overlap once heights are
		// floored (same lane index in different clusters may share a column —
		// clusters never overlap in time).
		const lanes = new Map<number, Array<{ start: number; end: number }>>();
		for (const b of blocks) {
			const rows = lanes.get(b.lane) ?? [];
			rows.push({ start: b.startMin, end: b.displayEndMin });
			lanes.set(b.lane, rows);
		}
		for (const rows of lanes.values()) {
			rows.sort((a, b) => a.start - b.start);
			for (let i = 1; i < rows.length; i++) {
				const prev = rows[i - 1];
				const current = rows[i];
				if (prev && current) {
					expect(current.start).toBeGreaterThanOrEqual(prev.end);
				}
			}
		}
	});

	it("a lightning block of six back-to-back 10-minute talks cycles five lanes, never more", async () => {
		await seedProgram();
		// 10-minute cadence with a 45-minute display floor -> at most
		// ceil(45/10) = 5 columns; talk 6 reuses talk 1's freed lane.
		const blockStart = Date.UTC(2027, 4, 12, 17, 0); // 10:00 AM PDT
		await getDb(env)
			.insert(submissions)
			.values(
				Array.from({ length: 6 }, (_, i) => ({
					id: `s_flash${i}`,
					eventId: "e1",
					title: `Flash Talk ${i + 1}`,
					status: "accepted" as const,
					contentStatus: "approved" as const,
					roomId: "r2",
					startsAt: new Date(blockStart + i * 10 * 60_000),
					endsAt: new Date(blockStart + (i + 1) * 10 * 60_000),
				})),
			);
		const { data } = unwrap<AgendaData>(
			await call(scheduleLoader, "http://localhost/schedule/devflow"),
		);
		const blocks =
			data.surface?.rooms.find((r) => r.name === "Room 2")?.blocks ?? [];
		expect(blocks).toHaveLength(6);
		// Contract, not the greedy's exact order: five columns, every lane
		// within them, freed lanes reused, and no same-lane boxes overlapping.
		expect(new Set(blocks.map((b) => b.laneCount))).toEqual(new Set([5]));
		for (const b of blocks) {
			expect(b.lane).toBeGreaterThanOrEqual(0);
			expect(b.lane).toBeLessThan(5);
		}
		const byLane = new Map<number, Array<{ start: number; end: number }>>();
		for (const b of blocks) {
			const rows = byLane.get(b.lane) ?? [];
			rows.push({ start: b.startMin, end: b.displayEndMin });
			byLane.set(b.lane, rows);
		}
		for (const rows of byLane.values()) {
			rows.sort((a, b) => a.start - b.start);
			for (let i = 1; i < rows.length; i++) {
				const prev = rows[i - 1];
				const current = rows[i];
				if (prev && current) {
					expect(current.start).toBeGreaterThanOrEqual(prev.end);
				}
			}
		}
	});

	it("agenda and itinerary serve NO session data before the organizer publishes", async () => {
		await seedProgram({ agendaPublished: false });
		const agenda = unwrap<AgendaData>(
			await call(scheduleLoader, "http://localhost/schedule/devflow"),
		);
		expect(agenda.data.surface).toBeNull();
		expect(JSON.stringify(agenda.data)).not.toMatch(/Taming/);

		const itinerary = unwrap<ItineraryData>(
			await call(itineraryLoader, "http://localhost/itinerary/devflow"),
		);
		expect(itinerary.data.surface).toBeNull();
	});

	it("itinerary groups chronologically per day; the mine view carries the unfiltered program", async () => {
		await seedProgram();
		const dayView = unwrap<ItineraryData>(
			await call(
				itineraryLoader,
				"http://localhost/itinerary/devflow?q=Taming",
			),
		);
		const day1 = dayView.data.surface?.days.find((d) => d.key === "2027-05-12");
		expect(day1?.groups.flatMap((g) => g.sessions.map((s) => s.id))).toEqual([
			"s1",
		]);
		expect(day1?.groups[0]?.timeLabel).toBe("9:30 AM PDT");

		const mine = unwrap<ItineraryData>(
			await call(
				itineraryLoader,
				"http://localhost/itinerary/devflow?view=mine&q=Taming",
			),
		);
		const allIds = mine.data.surface?.days.flatMap((d) =>
			d.groups.flatMap((g) => g.sessions.map((s) => s.id)),
		);
		expect(allIds?.sort()).toEqual(["s1", "s2"]); // search must not shrink the starred pool
	});

	it("logged-out agenda detail HTML names the session's track", async () => {
		await seedProgram();
		const { data } = unwrap<AgendaData>(
			await call(
				scheduleLoader,
				"http://localhost/schedule/devflow?session=s1",
			),
		);
		const sessions = unwrap<SessionsData>(
			await call(
				sessionsLoader,
				"http://localhost/sessions/devflow?session=s1",
			),
		);
		expect(data.surface?.detail?.tracks.map((track) => track.name)).toEqual([
			"Platform & Infra",
		]);
		expect(sessions.data.surface.detail?.tracks).toEqual(
			data.surface?.detail?.tracks,
		);
		const RoutesStub = createRoutesStub([
			{
				id: "root",
				path: "/",
				Component: () =>
					createElement(ProgramShell, {
						event: data.event,
						active: "schedule",
						children: createElement(AgendaSurface, {
							data: data.surface!,
							base: "/schedule/devflow",
							sessionsBase: "/sessions/devflow",
							speakersBase: "/speakers/devflow",
						}),
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);
		expect(html).toContain("Taming 40-Minute CI");
		expect(html).toContain("Platform &amp; Infra");
		expect(html).toContain(">Track</span>");
	});

	it("logged-out agenda detail does not invent a Track row when the session has none", async () => {
		await seedProgram();
		await getDb(env)
			.insert(submissions)
			.values({
				id: "s_no_track",
				eventId: "e1",
				title: "Caching Strategies for LLM APIs",
				description: "The fastest call is the one you never make.",
				status: "accepted",
				contentStatus: "approved",
				formatId: "f1",
				roomId: "r1",
				startsAt: new Date("2027-05-12T18:00:00Z"),
				endsAt: new Date("2027-05-12T18:30:00Z"),
			});
		const { data } = unwrap<AgendaData>(
			await call(
				scheduleLoader,
				"http://localhost/schedule/devflow?session=s_no_track",
			),
		);
		expect(data.surface?.detail?.id).toBe("s_no_track");
		expect(data.surface?.detail?.tracks).toEqual([]);

		const RoutesStub = createRoutesStub([
			{
				id: "root",
				path: "/",
				Component: () =>
					createElement(ProgramShell, {
						event: data.event,
						active: "schedule",
						children: createElement(AgendaSurface, {
							data: data.surface!,
							base: "/schedule/devflow",
							sessionsBase: "/sessions/devflow",
							speakersBase: "/speakers/devflow",
						}),
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);
		expect(html).toContain("Caching Strategies for LLM APIs");
		expect(html).toContain(">Format</span>");
		expect(html).not.toContain(">Track</span>");
	});
});

describe("public projection ↔ isPubliclyVisible predicate lockstep", () => {
	it("loadPublicSessions returns exactly the rows the predicate accepts, across the full status × contentStatus matrix", async () => {
		// The agenda's "hidden from the public schedule" count trusts the
		// predicate; if the SQL filter gains a condition the predicate lacks
		// (or vice versa), the affordance lies. Oracle: the data-exposure rule —
		// public = accepted + approved, nothing else.
		await seedProgram();
		const db = getDb(env);
		await db.delete(submissions);
		const matrix: { id: string; status: string; contentStatus: string }[] = [];
		for (const status of SUBMISSION_STATUS) {
			for (const contentStatus of CONTENT_STATUS) {
				matrix.push({
					id: `m_${status}_${contentStatus}`,
					status,
					contentStatus,
				});
			}
		}
		// Chunked: 21 rows in one insert exceeds D1's 100-bound-parameter cap.
		for (let i = 0; i < matrix.length; i += 5) {
			await db.insert(submissions).values(
				matrix.slice(i, i + 5).map((m) => ({
					id: m.id,
					eventId: "e1",
					title: m.id,
					status: m.status as (typeof SUBMISSION_STATUS)[number],
					contentStatus: m.contentStatus as (typeof CONTENT_STATUS)[number],
				})),
			);
		}
		const [event] = await db.select().from(events).limit(1);
		if (!event) throw new Error("seed lost the event");
		const publicIds = (await loadPublicSessions(db, event))
			.map((s) => s.id)
			.sort();
		const predicateIds = matrix
			.filter((m) => isPubliclyVisible(m))
			.map((m) => m.id)
			.sort();
		expect(publicIds).toEqual(predicateIds);
		expect(predicateIds).toEqual(["m_accepted_approved"]);
	});
});
