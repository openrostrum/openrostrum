import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { submissions } from "../app/db/schema";
import { loader as galleryLoader } from "../app/routes/gallery.$eventSlug";
import { loader as itineraryLoader } from "../app/routes/itinerary.$eventSlug";
import { loader as scheduleLoader } from "../app/routes/schedule.$eventSlug";
import { loader as sessionsLoader } from "../app/routes/sessions.$eventSlug";
import { loader as speakersLoader } from "../app/routes/speakers.$eventSlug";
import type {
	AgendaSurfaceData,
	ItinerarySurfaceData,
	ProgramEvent,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "../app/lib/program-types";
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
		expect(s1?.timeRange).toBe("9:30 AM – 10:00 AM"); // event TZ, not UTC
		expect(s1?.description).toBe("Cut the queue."); // rich text stripped
		const s5 = data.surface.sessions.find((s) => s.id === "s5");
		// Entities decode once, &amp; last — double-escaped input stays text.
		expect(s5?.description).toBe("Escaped &lt;b&gt; stays text & sound");

		const serialized = JSON.stringify(data);
		expect(serialized).not.toMatch(/@px\.test/);
		expect(serialized).not.toMatch(/555-0001/);
		expect(serialized).not.toMatch(/mobilePhone|homePhone|passwordHash/);
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
		expect(s1Ref?.timeRange).toBe("9:30 AM – 10:00 AM");
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

		// Every block gets at least the minimum legible box (time + title line).
		for (const b of blocks) {
			expect(b.displayEndMin - b.startMin).toBeGreaterThanOrEqual(30);
		}
		// Real times are untouched — the floor is display-only.
		expect(byId.get("s_short")?.endMin).toBe(9 * 60 + 45);
		expect(byId.get("s_short")?.displayEndMin).toBe(10 * 60 + 5);

		// The concurrent short talk shares the slot side-by-side, never behind.
		expect(byId.get("s_short")?.lane).not.toBe(byId.get("s1")?.lane);

		// Lane splits stay local to their overlap cluster: the solo talk keeps
		// the full column even though earlier talks split the slot.
		expect(byId.get("s_solo")?.laneCount).toBe(1);
		expect(byId.get("s1")?.laneCount).toBe(2);

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

	it("a lightning block of six back-to-back 10-minute talks cycles three lanes, never more", async () => {
		await seedProgram();
		// 10-minute cadence with a 30-minute display floor -> at most
		// ceil(30/10) = 3 columns; talk 4 must reuse talk 1's freed lane.
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
		// Contract, not the greedy's exact order: three columns, every lane
		// within them, freed lanes reused, and no same-lane boxes overlapping.
		expect(new Set(blocks.map((b) => b.laneCount))).toEqual(new Set([3]));
		for (const b of blocks) {
			expect(b.lane).toBeGreaterThanOrEqual(0);
			expect(b.lane).toBeLessThan(3);
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
		expect(day1?.groups[0]?.timeLabel).toBe("9:30 AM");

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
});
