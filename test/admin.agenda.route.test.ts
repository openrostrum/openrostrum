import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { detectConflicts, isSessionVisible } from "../app/agenda/lib";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	events,
	formats,
	organizationMembers,
	organizations,
	participants,
	rooms,
	submissions,
	users,
} from "../app/db/schema";
import { inviteRecipients } from "../app/domain/accept";
import { createSession, hashPassword } from "../app/lib/auth";
import { buildIcs, parseIcsAttachment } from "../app/lib/ics";
import { action, loader } from "../app/routes/admin.agenda";

// A 3-day event in America/Los_Angeles with named rooms/formats and one
// double-booked speaker. Expected UTC instants are hand-derived from the
// fixed PDT offset (UTC-7), not from the code under test.

const utc = (y: number, mo: number, d: number, h: number, min = 0): Date =>
	new Date(Date.UTC(y, mo - 1, d, h, min));

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedBaseline() {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	// Membership gates admin event resolution (event → org → member).
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "AI.Engineer Sandbox Event",
		slug: "sandbox",
		timezone: "America/Los_Angeles",
		// Oct 12 8:00 AM → Oct 14 6:00 PM PDT, as the settings form stores them.
		startsAt: utc(2026, 10, 12, 15),
		endsAt: utc(2026, 10, 15, 1),
	});
	await db.insert(rooms).values([
		{ id: "room_main", eventId: "e1", name: "Main Hall", displayOrder: 0 },
		{ id: "room_305", eventId: "e1", name: "Room 305", displayOrder: 1 },
	]);
	await db.insert(formats).values([
		{
			id: "fmt_keynote",
			eventId: "e1",
			name: "Featured Keynote",
			defaultDurationMins: 45,
		},
		{ id: "fmt_talk", eventId: "e1", name: "Talk", defaultDurationMins: 30 },
	]);
	await db.insert(contacts).values([
		{
			id: "c_marco",
			eventId: "e1",
			email: "marco@test.co",
			firstName: "Marco",
			lastName: "Silva",
		},
	]);
	await db.insert(submissions).values([
		{
			id: "s_keynote",
			eventId: "e1",
			title: "Closing Keynote: The Post-SaaS Stack",
			status: "accepted",
			formatId: "fmt_keynote",
		},
		{
			id: "s_live",
			eventId: "e1",
			title: "Live Demo: Agent Swarms in Production",
			status: "accepted",
			formatId: "fmt_talk",
		},
		{
			id: "s_office",
			eventId: "e1",
			title: "Office Hours: D1 Performance Clinic",
			status: "accepted",
			formatId: "fmt_talk",
		},
		{
			id: "s_pending",
			eventId: "e1",
			title: "SOC 2 for Startups: A War Story",
			status: "pending",
			formatId: "fmt_talk",
		},
		{
			id: "s_queue",
			eventId: "e1",
			title: "GPU Pricing Deep Dive",
			status: "accept_queue",
			formatId: "fmt_talk",
		},
	]);
	await db.insert(participants).values([
		{ id: "p1", submissionId: "s_live", contactId: "c_marco" },
		{ id: "p2", submissionId: "s_office", contactId: "c_marco" },
	]);
	return db;
}

async function adminRequest(body?: URLSearchParams): Promise<Request> {
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers();
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request("http://localhost/admin/agenda", {
		method: body ? "POST" : "GET",
		body,
		headers,
	});
}

type ActionData = {
	ok: boolean;
	formError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	placed?: number;
	unplaced?: number;
	updates?: {
		sent: number;
		deduped: number;
		failed: number;
		remaining: number;
	};
};

function unwrap<T>(result: unknown): T {
	const r = result as { data?: T };
	return (r && typeof r === "object" && "data" in r ? r.data : result) as T;
}

async function callAction(fields: Record<string, string>): Promise<ActionData> {
	const request = await adminRequest(new URLSearchParams(fields));
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	return unwrap<ActionData>(result);
}

type LoaderData = {
	event: {
		days: string[];
		schedulableStatuses: string[];
		dayStartMin: number;
		dayEndMin: number;
		publishedAt: number | null;
		hiddenFromPublic: number;
		staleSpeakers: number;
		scheduleScanTruncated: boolean;
	} | null;
	sessions: {
		id: string;
		title: string;
		status: string;
		schedulable: boolean;
		startsAt: number | null;
		endsAt: number | null;
		roomId: string | null;
		formatName: string | null;
		durationMins: number;
		tracks: { id: string; name: string; color: string }[];
		speakers: { contactId: string; name: string }[];
	}[];
	statusOptions: string[];
	rooms: { id: string; name: string; capacity: number | null }[];
};

async function callLoader(): Promise<LoaderData> {
	const request = await adminRequest();
	const result = await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
	return unwrap<LoaderData>(result);
}

describe("agenda loader", () => {
	it("serves the event days and only schedulable (+draft) sessions at the accepted-only baseline", async () => {
		await seedBaseline();
		const data = await callLoader();
		// Exactly the 3 event-TZ calendar days — the stored end instant crosses
		// UTC midnight, and reading UTC dates rendered a phantom 4th column.
		expect(data.event?.days).toEqual([
			"2026-10-12",
			"2026-10-13",
			"2026-10-14",
		]);
		expect(data.event?.schedulableStatuses).toEqual(["accepted"]);
		const ids = data.sessions.map((s) => s.id).sort();
		// Negative fixtures: pending and accept-queue rows are absent entirely.
		expect(ids).toEqual(["s_keynote", "s_live", "s_office"]);
		expect(data.sessions.every((s) => s.schedulable)).toBe(true);
	});

	it("widening schedulable statuses makes the accept-queue fixture schedulable, never pending", async () => {
		const db = await seedBaseline();
		await db
			.update(events)
			.set({ schedulableStatuses: ["accepted", "accept_queue"] });
		const data = await callLoader();
		const queue = data.sessions.find((s) => s.id === "s_queue");
		expect(queue?.schedulable).toBe(true);
		expect(data.sessions.find((s) => s.id === "s_pending")).toBeUndefined();
	});
});

describe("schedule / move / unschedule", () => {
	it("derives the end time from the format default on first placement (45-min keynote at 9:30 AM)", async () => {
		const db = await seedBaseline();
		const result = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(result.ok).toBe(true);
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_keynote"),
		});
		expect(row?.startsAt).toEqual(utc(2026, 10, 12, 16, 30)); // 9:30 AM PDT
		expect(row?.endsAt).toEqual(utc(2026, 10, 12, 17, 15)); // +45 min from the FORMAT
		expect(row?.roomId).toBe("room_main");
	});

	it("preserves the existing duration on a move (2:00 PM next day → still 45 min)", async () => {
		const db = await seedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const result = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "840",
		});
		expect(result.ok).toBe(true);
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_keynote"),
		});
		expect(row?.startsAt).toEqual(utc(2026, 10, 13, 21, 0)); // 2:00 PM PDT
		expect(row?.endsAt).toEqual(utc(2026, 10, 13, 21, 45));
		expect(row?.roomId).toBe("room_305");
	});

	it("unschedule clears start, end AND room; re-scheduling re-derives from the format", async () => {
		const db = await seedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_live",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "600",
		});
		const cleared = await callAction({
			intent: "unschedule",
			submissionId: "s_live",
		});
		expect(cleared.ok).toBe(true);
		let row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_live"),
		});
		expect(row?.startsAt).toBeNull();
		expect(row?.endsAt).toBeNull();
		expect(row?.roomId).toBeNull();
		await callAction({
			intent: "schedule",
			submissionId: "s_live",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "600",
		});
		row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_live"),
		});
		expect(row?.endsAt).toEqual(utc(2026, 10, 12, 17, 30)); // Talk default 30 min
	});

	it("rejects scheduling a non-schedulable status and writes nothing", async () => {
		const db = await seedBaseline();
		const result = await callAction({
			intent: "schedule",
			submissionId: "s_pending",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(result.ok).toBe(false);
		expect(result.formError).toBeTruthy();
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_pending"),
		});
		expect(row?.startsAt).toBeNull();
		expect(row?.roomId).toBeNull();
	});

	it("rejects a forged unschedule for a retained non-schedulable placement", async () => {
		const db = await seedBaseline();
		const startsAt = utc(2026, 10, 12, 16, 30);
		const endsAt = utc(2026, 10, 12, 17);
		await db
			.update(submissions)
			.set({ startsAt, endsAt, roomId: "room_main" })
			.where(eq(submissions.id, "s_queue"));

		const result = await callAction({
			intent: "unschedule",
			submissionId: "s_queue",
		});
		const row = await db.query.submissions.findFirst({
			where: (submission, { eq: equals }) => equals(submission.id, "s_queue"),
		});

		expect(result.ok).toBe(false);
		expect(result.formError).toMatch(/not schedulable/i);
		expect(row).toMatchObject({ startsAt, endsAt, roomId: "room_main" });
	});

	it("rejects a room belonging to another event (tenancy) and times outside the day window", async () => {
		const db = await seedBaseline();
		await db.insert(events).values({
			id: "e2",
			organizationId: "org1",
			name: "Other",
			slug: "other",
		});
		await db
			.insert(rooms)
			.values({ id: "room_foreign", eventId: "e2", name: "Foreign" });
		const foreignRoom = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_foreign",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(foreignRoom.ok).toBe(false);
		const outsideWindow = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "360", // 6:00 AM < default 8:00 day start
		});
		expect(outsideWindow.ok).toBe(false);
		const outsideDays = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-20",
			startMinutes: "570",
		});
		expect(outsideDays.ok).toBe(false);
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_keynote"),
		});
		expect(row?.startsAt).toBeNull();
	});
});

describe("date-less events", () => {
	it("accepts a drop on a session-derived day when the event has no dates", async () => {
		const db = await seedBaseline();
		await db
			.update(events)
			.set({ startsAt: null, endsAt: null })
			.where(eq(events.id, "e1"));
		const result = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(result.ok).toBe(true);
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_keynote"),
		});
		expect(row?.startsAt).toEqual(utc(2026, 10, 12, 16, 30));
	});
});

describe("end-to-end conflict surface", () => {
	it("two placements that overlap in one room show up as a room conflict on reload", async () => {
		await seedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_live",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "600", // 10:00–10:30 AM
		});
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "615", // 10:15–11:00 AM — same room, overlapping
		});
		const data = await callLoader();
		const conflicts = detectConflicts(data.sessions, data.rooms);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.kind).toBe("room");
		expect(conflicts[0]?.roomName).toBe("Main Hall");
	});
});

describe("auto-place", () => {
	it("places every unscheduled schedulable session with zero conflicts, inside the window", async () => {
		const db = await seedBaseline();
		const result = await callAction({ intent: "autoplace" });
		expect(result.ok).toBe(true);
		expect(result.placed).toBe(3);
		expect(result.unplaced).toBe(0);
		const data = await callLoader();
		expect(data.sessions.every((s) => s.startsAt != null)).toBe(true);
		expect(detectConflicts(data.sessions, data.rooms)).toEqual([]);
		// Negative fixtures stay untouched.
		const pending = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_pending"),
		});
		expect(pending?.startsAt).toBeNull();
	});

	it("auto-places a schedulable session whose stored placement is only partial", async () => {
		const db = await seedBaseline();
		await db
			.update(submissions)
			.set({ startsAt: utc(2026, 10, 12, 16, 30), endsAt: null })
			.where(eq(submissions.id, "s_live"));

		const result = await callAction({ intent: "autoplace" });
		const row = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_live"),
		});

		expect(result.placed).toBe(3);
		expect(row?.startsAt).toEqual(utc(2026, 10, 12, 15));
		expect(row?.endsAt).toEqual(utc(2026, 10, 12, 15, 30));
		expect(row?.roomId).toBe("room_305");
	});

	it("does not let a retained non-schedulable placement block auto-place occupancy", async () => {
		const db = await seedBaseline();
		await db
			.update(events)
			.set({
				startsAt: utc(2026, 10, 12, 15),
				endsAt: utc(2026, 10, 12, 15, 45),
				agendaDayStartMin: 480,
				agendaDayEndMin: 525,
			})
			.where(eq(events.id, "e1"));
		await db
			.update(rooms)
			.set({ visible: false })
			.where(eq(rooms.id, "room_305"));
		await db
			.update(submissions)
			.set({
				startsAt: utc(2026, 10, 12, 15),
				endsAt: utc(2026, 10, 12, 15, 45),
				roomId: "room_main",
			})
			.where(eq(submissions.id, "s_queue"));

		const result = await callAction({ intent: "autoplace" });
		const keynote = await db.query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "s_keynote"),
		});

		expect(result.placed).toBe(1);
		expect(result.unplaced).toBe(2);
		expect(keynote?.startsAt).toEqual(utc(2026, 10, 12, 15));
		expect(keynote?.endsAt).toEqual(utc(2026, 10, 12, 15, 45));
		expect(keynote?.roomId).toBe("room_main");
	});
});

describe("retained schedule visibility", () => {
	it("excludes incomplete removed-status placements", async () => {
		const db = await seedBaseline();
		const startsAt = utc(2026, 10, 12, 16, 30);
		const endsAt = utc(2026, 10, 12, 17);
		await db.insert(submissions).values([
			{
				id: "s_queue_start_only",
				eventId: "e1",
				title: "Incomplete Start-only Queue Session",
				status: "accept_queue",
				startsAt,
				roomId: "room_main",
				formatId: "fmt_talk",
			},
			{
				id: "s_queue_end_only",
				eventId: "e1",
				title: "Incomplete End-only Queue Session",
				status: "accept_queue",
				endsAt,
				roomId: "room_main",
				formatId: "fmt_talk",
			},
		]);

		const data = await callLoader();

		expect(
			data.sessions.filter((s) =>
				["s_queue_start_only", "s_queue_end_only"].includes(s.id),
			),
		).toEqual([]);
	});

	it("keeps complete removed-status placements visible, non-schedulable, and conflict-silent", async () => {
		const db = await seedBaseline();
		const startsAt = utc(2026, 10, 12, 16, 30);
		const endsAt = utc(2026, 10, 12, 17);
		await db
			.update(submissions)
			.set({ startsAt, endsAt, roomId: "room_main" })
			.where(eq(submissions.id, "s_queue"));
		await db
			.update(submissions)
			.set({ startsAt, endsAt, roomId: "room_main" })
			.where(eq(submissions.id, "s_live"));
		await db.insert(submissions).values({
			id: "s_queue_unscheduled",
			eventId: "e1",
			title: "Another Accept Queue Session",
			status: "accept_queue",
			formatId: "fmt_talk",
		});

		const data = await callLoader();
		const retained = data.sessions.find((s) => s.id === "s_queue");
		if (!retained) throw new Error("Expected retained queue session");

		expect(retained).toMatchObject({
			status: "accept_queue",
			schedulable: false,
			startsAt: startsAt.getTime(),
			endsAt: endsAt.getTime(),
			roomId: "room_main",
		});
		expect(isSessionVisible(retained, false)).toBe(true);
		expect(
			data.sessions.find((s) => s.id === "s_queue_unscheduled"),
		).toBeUndefined();
		expect(detectConflicts(data.sessions, data.rooms)).toEqual([]);
	});

	it("keeps placed drafts behind the Drafts toggle", async () => {
		const db = await seedBaseline();
		await db.insert(submissions).values({
			id: "s_draft_placed",
			eventId: "e1",
			title: "Placed Draft",
			status: "draft",
			startsAt: utc(2026, 10, 12, 16, 30),
			endsAt: utc(2026, 10, 12, 17),
			roomId: "room_main",
			formatId: "fmt_talk",
		});

		const data = await callLoader();
		const draft = data.sessions.find((s) => s.id === "s_draft_placed");
		if (!draft) throw new Error("Expected placed draft session");

		expect(draft.schedulable).toBe(false);
		expect(isSessionVisible(draft, false)).toBe(false);
		expect(isSessionVisible(draft, true)).toBe(true);
	});

	it("offers retained row statuses in the Status filter", async () => {
		const db = await seedBaseline();
		await db
			.update(submissions)
			.set({
				startsAt: utc(2026, 10, 12, 16, 30),
				endsAt: utc(2026, 10, 12, 17),
				roomId: "room_main",
			})
			.where(eq(submissions.id, "s_queue"));

		const data = await callLoader();

		expect(data.statusOptions).toEqual(
			expect.arrayContaining(["accepted", "accept_queue", "draft"]),
		);
	});
});

describe("published-but-hidden affordance", () => {
	it("counts scheduled rows the public schedule withholds, per the public projection rule", async () => {
		const db = await seedBaseline();
		await db
			.update(events)
			.set({ schedulableStatuses: ["accepted", "accept_queue"] });
		await db.insert(submissions).values({
			id: "s_accepted_start_only",
			eventId: "e1",
			title: "Incomplete Accepted Session",
			status: "accepted",
			startsAt: utc(2026, 10, 12, 18),
			roomId: "room_main",
			formatId: "fmt_talk",
		});
		// s_keynote: accepted but content unapproved; s_queue: content approved
		// later but status never accepted — both must stay off the public page.
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await callAction({
			intent: "schedule",
			submissionId: "s_queue",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "570",
		});
		let data = await callLoader();
		expect(data.event?.hiddenFromPublic).toBe(2);
		await db
			.update(submissions)
			.set({ contentStatus: "approved" })
			.where(eq(submissions.id, "s_keynote"));
		await db
			.update(submissions)
			.set({ contentStatus: "approved" })
			.where(eq(submissions.id, "s_queue"));
		data = await callLoader();
		// Approval clears the accepted row; the accept-queue row stays hidden on
		// status alone.
		expect(data.event?.hiddenFromPublic).toBe(1);
	});
});

/**
 * Captured VERBATIM from the npm-ics payload the accept spine attached before
 * this serializer replaced it — what prod outbox rows actually hold (note the
 * tab-folded SUMMARY). A save-the-date hold spanning the event, SEQUENCE 0.
 */
const HISTORIC_NPM_ICS_INVITE =
	"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nCALSCALE:GREGORIAN\r\nPRODID:adamgibbons/ics\r\nMETHOD:PUBLISH\r\nX-PUBLISHED-TTL:PT1H\r\nBEGIN:VEVENT\r\nUID:submission-s_keynote@openrostrum\r\nSUMMARY:AI.Engineer Sandbox Event (save the date): Closing Keynote: The Pos\r\n\tt-SaaS Stack\r\nDTSTAMP:20260810T205445Z\r\nDTSTART:20261012T150000Z\r\nDTEND:20261015T010000Z\r\nSEQUENCE:0\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

/**
 * On top of seedBaseline: the keynote was ACCEPTED AND NOTIFIED before any
 * slot existed — the outbox ledger holds the historic npm-ics save-the-date
 * invite (prod rows are in that format), and Marco is its speaker so the
 * update email has a recipient.
 */
async function invitedBaseline() {
	const db = await seedBaseline();
	await db.insert(emailOutbox).values({
		id: "accept-keynote-initial",
		eventId: "e1",
		dedupeKey: "decision:accept:initial:s_keynote",
		to: "marco@test.co",
		subject: "Your session was accepted",
		html: "<p>you're in</p>",
		icsAttachment: HISTORIC_NPM_ICS_INVITE,
		status: "sent",
		createdAt: new Date("2026-08-10T20:00:00Z"),
		sentAt: new Date("2026-08-10T20:01:00Z"),
	});
	await db
		.update(submissions)
		.set({ notifiedAt: new Date() })
		.where(eq(submissions.id, "s_keynote"));
	await db.insert(participants).values({
		id: "p_keynote",
		submissionId: "s_keynote",
		contactId: "c_marco",
	});
	return db;
}

async function latestUpdateInvite(db: ReturnType<typeof getDb>, to?: string) {
	const rows = await db.select().from(emailOutbox);
	const updates = rows
		.filter(
			(row) =>
				row.status === "sent" &&
				row.dedupeKey?.startsWith("schedule-update:") &&
				(to === undefined || row.to === to),
		)
		.map((row) => ({
			row,
			vevents: parseIcsAttachment(row.icsAttachment ?? ""),
		}))
		.sort((a, b) => {
			const aSequence = Math.max(
				-1,
				...a.vevents.map((event) => event.sequence),
			);
			const bSequence = Math.max(
				-1,
				...b.vevents.map((event) => event.sequence),
			);
			if (aSequence !== bSequence) return bSequence - aSequence;
			return b.row.createdAt.getTime() - a.row.createdAt.getTime();
		});
	const latest = updates[0];
	return { row: latest?.row, vevent: latest?.vevents[0] };
}

function keynoteIcs(options: {
	start: Date;
	end: Date;
	location?: string;
	sequence: number;
}): string {
	return buildIcs({
		calendarName: "AI.Engineer Sandbox Event",
		method: "PUBLISH",
		events: [
			{
				uid: "submission-s_keynote@openrostrum",
				start: options.start,
				end: options.end,
				title:
					"Closing Keynote: The Post-SaaS Stack — AI.Engineer Sandbox Event",
				location: options.location,
				sequence: options.sequence,
				status: "CONFIRMED",
			},
		],
	});
}

describe("schedule-update emails (stale speaker calendars)", () => {
	it("resolves recipients beyond D1's 100-bound-parameter limit", async () => {
		const db = await seedBaseline();
		const inserted = await env.DB.prepare(`
			WITH RECURSIVE candidate(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM candidate WHERE n < 101
			)
			INSERT INTO submissions (
				id, event_id, type, title, status, submitter_id, created_at, updated_at
			)
			SELECT
				'bulk-' || n,
				'e1',
				'session',
				'Bulk candidate ' || n,
				'accepted',
				'u_admin',
				unixepoch(),
				unixepoch()
			FROM candidate
		`).run();
		expect(inserted.meta.changes).toBe(101);
		const ids = Array.from({ length: 101 }, (_, index) => `bulk-${index + 1}`);

		const recipients = await inviteRecipients(db, ids);

		expect(recipients.size).toBe(101);
		expect(new Set(recipients.values())).toEqual(new Set(["admin@test.co"]));
	});

	it("accept-then-schedule-later: flags the change, sends the same UID with a higher SEQUENCE, then goes quiet", async () => {
		const db = await invitedBaseline();
		// The save-the-date hold still matches the event dates — nothing stale.
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.ok).toBe(true);
		expect(result.updates).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
		const { row, vevent } = await latestUpdateInvite(db);
		expect(row?.to).toBe("marco@test.co");
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			start: utc(2026, 10, 12, 16, 30), // 9:30 AM PDT
			end: utc(2026, 10, 12, 17, 15),
			location: "Main Hall",
			sequence: 1, // higher than the invite's 0 → clients replace in place
		});
		// The ledger advanced: nothing is flagged and a repeat click sends nothing.
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
		const repeat = await callAction({ intent: "schedule-updates" });
		expect(repeat.updates).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
	});

	it("surfaces malformed matching history instead of inferring an unsafe baseline", async () => {
		const db = await seedBaseline();
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(participants).values({
			id: "p_keynote",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});
		await db.insert(emailOutbox).values({
			id: "accept-keynote-malformed",
			eventId: "e1",
			dedupeKey: "decision:accept:malformed:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:wrong",
			status: "sent",
		});

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: true,
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.ok).toBe(false);
		expect(result.formError).toMatch(/history/i);
	});

	it("sends the first calendar invite at SEQUENCE 0 after an acceptance had no event dates", async () => {
		const db = await seedBaseline();
		await db
			.update(events)
			.set({ startsAt: null, endsAt: null })
			.where(eq(events.id, "e1"));
		await db.insert(emailOutbox).values({
			id: "accept-keynote-without-calendar",
			eventId: "e1",
			dedupeKey: "decision:accept:no-dates:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: null,
			status: "sent",
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(participants).values({
			id: "p_keynote",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});
		await db
			.update(events)
			.set({
				startsAt: utc(2026, 10, 12, 15),
				endsAt: utc(2026, 10, 15, 1),
			})
			.where(eq(events.id, "e1"));

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 1,
			scheduleScanTruncated: false,
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 0,
			start: utc(2026, 10, 12, 15),
			end: utc(2026, 10, 15, 1),
		});
		expect(
			(await callAction({ intent: "schedule-updates" })).updates,
		).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
	});

	it("sends a bounced acceptance invite as a first delivered SEQUENCE 0", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values({
			id: "accept-keynote-bounced",
			eventId: "e1",
			dedupeKey: "decision:accept:bounced:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "bounced",
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(participants).values({
			id: "p_keynote",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 0,
		});
	});

	it("ignores generic notifiedAt rows that have no structured acceptance history", async () => {
		await invitedBaseline();
		await getDb(env)
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_live"));
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 1,
			scheduleScanTruncated: false,
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
	});

	it("keeps the earliest delivered snapshot at an equal SEQUENCE and updates at SEQUENCE 1", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await db.insert(emailOutbox).values({
			id: "accept-keynote-resend",
			eventId: "e1",
			dedupeKey: "decision:accept:resend:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're still in</p>",
			icsAttachment: keynoteIcs({
				start: utc(2026, 10, 12, 16, 30),
				end: utc(2026, 10, 12, 17, 15),
				location: "Main Hall",
				sequence: 0,
			}),
			status: "sent",
			createdAt: new Date("2026-08-10T19:59:00Z"),
			sentAt: new Date("2026-08-10T20:03:00Z"),
		});

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent?.sequence).toBe(1);
	});

	it("flags a recipient change and delivers the current invite at the next SEQUENCE", async () => {
		const db = await invitedBaseline();
		await db
			.update(contacts)
			.set({ email: "marco.new@test.co" })
			.where(eq(contacts.id, "c_marco"));

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		const { row, vevent } = await latestUpdateInvite(db, "marco.new@test.co");
		expect(row?.to).toBe("marco.new@test.co");
		expect(vevent?.sequence).toBe(1);
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
	});

	it("reuses the last delivered SEQUENCE and sends after a bounced recipient changes", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await db.insert(emailOutbox).values({
			id: "bounced-keynote-update",
			eventId: "e1",
			dedupeKey: "schedule-update:s_keynote@1",
			to: "marco@test.co",
			subject: "Schedule update",
			html: "<p>update</p>",
			icsAttachment: keynoteIcs({
				start: utc(2026, 10, 12, 16, 30),
				end: utc(2026, 10, 12, 17, 15),
				location: "Main Hall",
				sequence: 1,
			}),
			status: "bounced",
			createdAt: new Date("2026-08-10T20:02:00Z"),
			sentAt: new Date("2026-08-10T20:03:00Z"),
		});
		await db
			.update(contacts)
			.set({ email: "marco.new@test.co" })
			.where(eq(contacts.id, "c_marco"));

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const { row, vevent } = await latestUpdateInvite(db, "marco.new@test.co");
		expect(row?.to).toBe("marco.new@test.co");
		expect(vevent?.sequence).toBe(1);
	});

	it("retries the same recovered address after a schedule update bounces", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(
			(await callAction({ intent: "schedule-updates" })).updates,
		).toMatchObject({ sent: 1, deduped: 0 });
		const first = await latestUpdateInvite(db);
		if (!first.row) throw new Error("Expected first schedule update");
		await db
			.update(emailOutbox)
			.set({ status: "bounced" })
			.where(eq(emailOutbox.id, first.row.id));

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const retry = await callAction({ intent: "schedule-updates" });
		expect(retry.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(2);
		expect(new Set(updateRows.map((row) => row.dedupeKey)).size).toBe(2);
		expect(updateRows.map((row) => row.status).sort()).toEqual([
			"bounced",
			"sent",
		]);
		expect(
			(await callAction({ intent: "schedule-updates" })).updates,
		).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
	});

	it("finds an affected session's old invite behind 1001 newer unrelated invites", async () => {
		const db = await invitedBaseline();
		const scheduled = await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(scheduled.ok).toBe(true);

		const unrelated = await env.DB.prepare(`
			WITH RECURSIVE invite_noise(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM invite_noise WHERE n < 1001
			)
			INSERT INTO email_outbox (
				id, event_id, "to", subject, html, ics_attachment,
				status, created_at, sent_at
			)
			SELECT
				'noise-' || n,
				'e1',
				'noise@test.co',
				'Unrelated invite',
				'<p>unrelated</p>',
				'BEGIN:VCALENDAR
BEGIN:VEVENT
UID:submission-unrelated-' || n || '@openrostrum
DTSTART:20261012T150000Z
DTEND:20261012T160000Z
SEQUENCE:0
END:VEVENT
END:VCALENDAR
',
				'sent',
				CAST(strftime('%s', 'now') AS INTEGER) + n,
				CAST(strftime('%s', 'now') AS INTEGER) + n
			FROM invite_noise
		`).run();
		expect(unrelated.meta.changes).toBe(1001);

		const data = await callLoader();
		expect(data.event).toMatchObject({
			staleSpeakers: 1,
			scheduleScanTruncated: false,
		});

		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
		const { row, vevent } = await latestUpdateInvite(db);
		expect(row?.to).toBe("marco@test.co");
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 1,
			start: utc(2026, 10, 12, 16, 30),
			end: utc(2026, 10, 12, 17, 15),
			location: "Main Hall",
		});
	});

	it("does not infer or send a lower SEQUENCE when matching history exceeds the scan cap", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});

		const history = await env.DB.prepare(`
			WITH RECURSIVE invite_history(n) AS (
				SELECT 0
				UNION ALL
				SELECT n + 1 FROM invite_history WHERE n < 1000
			)
			INSERT INTO email_outbox (
				id, event_id, dedupe_key, "to", subject, html, ics_attachment,
				status, created_at, sent_at
			)
			SELECT
				'history-' || n,
				'e1',
				'schedule-update:s_keynote@' || CASE WHEN n = 0 THEN 5000 ELSE n END,
				'marco@test.co',
				'Prior schedule update',
				'<p>prior update</p>',
				'BEGIN:VCALENDAR
BEGIN:VEVENT
UID:submission-s_keynote@openrostrum
DTSTART:20261012T150000Z
DTEND:20261015T010000Z
SEQUENCE:' || CASE WHEN n = 0 THEN 5000 ELSE n END || '
END:VEVENT
END:VCALENDAR
',
				'sent',
				1800000000 + n,
				1800000000 + n
			FROM invite_history
		`).run();
		expect(history.meta.changes).toBe(1001);

		const data = await callLoader();
		expect(data.event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: true,
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.ok).toBe(false);
		expect(result.formError).toMatch(/history/i);
		const [unsafeSend] = await db
			.select({ id: emailOutbox.id })
			.from(emailOutbox)
			.where(eq(emailOutbox.dedupeKey, "schedule-update:s_keynote@1001"))
			.limit(1);
		expect(unsafeSend).toBeUndefined();
	});

	it("SEQUENCE increases monotonically across successive moves", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await callAction({ intent: "schedule-updates" });
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "840",
		});
		const second = await callAction({ intent: "schedule-updates" });
		expect(second.updates?.sent).toBe(1);
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 2,
			start: utc(2026, 10, 13, 21, 0), // 2:00 PM PDT next day
			location: "Room 305",
		});
	});

	it("unscheduling an invited session reverts the calendar to the save-the-date hold", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await callAction({ intent: "schedule-updates" });
		await callAction({ intent: "unschedule", submissionId: "s_keynote" });
		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates?.sent).toBe(1);
		const { vevent } = await latestUpdateInvite(db);
		// Same UID, still a higher revision — back to the event-wide hold.
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 2,
			start: utc(2026, 10, 12, 15, 0),
			end: utc(2026, 10, 15, 1, 0),
		});
	});

	it("groups a speaker's changed sessions into ONE email whose .ics carries one VEVENT per session", async () => {
		// An afternoon of drag-and-drop must not fire an email per session —
		// Marco speaks on both changed sessions and gets one message.
		const db = await invitedBaseline();
		await db
			.update(contacts)
			.set({ email: "Marco@Test.co" })
			.where(eq(contacts.id, "c_marco"));
		await db.insert(contacts).values({
			id: "c_marco_case_variant",
			eventId: "e1",
			email: "MARCO@test.co",
			firstName: "Marco",
			lastName: "Silva",
		});
		await db
			.update(participants)
			.set({ contactId: "c_marco_case_variant" })
			.where(eq(participants.id, "p1"));
		await db.insert(emailOutbox).values({
			eventId: "e1",
			dedupeKey: "decision:accept:initial:s_live",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: buildIcs({
				calendarName: "AI.Engineer Sandbox Event",
				method: "PUBLISH",
				events: [
					{
						uid: "submission-s_live@openrostrum",
						start: utc(2026, 10, 12, 15, 0),
						end: utc(2026, 10, 15, 1, 0),
						title:
							"AI.Engineer Sandbox Event (save the date): Live Demo: Agent Swarms in Production",
						sequence: 0,
						status: "CONFIRMED",
					},
				],
			}),
			status: "sent",
			sentAt: new Date(),
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_live"));
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await callAction({
			intent: "schedule",
			submissionId: "s_live",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "600",
		});
		// Two changed sessions, ONE stale speaker.
		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
		const { row } = await latestUpdateInvite(db);
		expect(row?.to).toBe("Marco@Test.co");
		const vevents = parseIcsAttachment(row?.icsAttachment ?? "");
		expect(vevents).toHaveLength(2);
		expect(vevents.map((v) => [v.uid, v.sequence])).toEqual([
			["submission-s_keynote@openrostrum", 1],
			["submission-s_live@openrostrum", 1],
		]);
	});

	it("uses one fixed-length opaque key for seven UUID-shaped submission revisions", async () => {
		const db = await seedBaseline();
		const ids = Array.from(
			{ length: 7 },
			(_, index) =>
				`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
		);
		for (let offset = 0; offset < ids.length; offset += 3) {
			await db.insert(submissions).values(
				ids.slice(offset, offset + 3).map((id, chunkIndex) => {
					const index = offset + chunkIndex;
					return {
						id,
						eventId: "e1",
						title: `Long identity session ${index + 1}`,
						status: "accepted" as const,
						notifiedAt: new Date(),
						startsAt: new Date(
							utc(2026, 10, 12, 16).getTime() + index * 3_600_000,
						),
						endsAt: new Date(
							utc(2026, 10, 12, 16, 30).getTime() + index * 3_600_000,
						),
						roomId: "room_main",
						formatId: "fmt_talk",
					};
				}),
			);
		}
		await db.insert(participants).values(
			ids.map((submissionId, index) => ({
				id: `p-long-${index}`,
				submissionId,
				contactId: "c_marco",
			})),
		);
		await db.insert(emailOutbox).values(
			ids.map((submissionId, index) => ({
				id: `accept-long-${index}`,
				eventId: "e1",
				dedupeKey: `decision:accept:initial:${submissionId}`,
				to: "marco@test.co",
				subject: "Your session was accepted",
				html: "<p>you're in</p>",
				icsAttachment: buildIcs({
					calendarName: "AI.Engineer Sandbox Event",
					events: [
						{
							uid: `submission-${submissionId}@openrostrum`,
							start: utc(2026, 10, 12, 15),
							end: utc(2026, 10, 15, 1),
							title: `Long identity session ${index + 1}`,
							sequence: 0,
						},
					],
				}),
				status: "sent" as const,
			})),
		);

		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(1);
		expect(updateRows[0]?.dedupeKey).toMatch(/^schedule-update:[0-9a-f]{64}$/);
		expect(updateRows[0]?.dedupeKey?.length).toBeLessThanOrEqual(256);
		expect(parseIcsAttachment(updateRows[0]?.icsAttachment ?? "")).toHaveLength(
			7,
		);
	});

	it("sessions that never received an invite are not flagged — their decision email will carry the slot", async () => {
		await seedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_live",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "600",
		});
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 0, failed: 0 });
	});
});

describe("publish + settings", () => {
	it("publish stamps agendaPublishedAt; unpublish clears it", async () => {
		const db = await seedBaseline();
		const before = Date.now();
		const published = await callAction({ intent: "publish" });
		expect(published.ok).toBe(true);
		let event = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.id, "e1"),
		});
		expect(event?.agendaPublishedAt?.getTime()).toBeGreaterThanOrEqual(
			Math.floor(before / 1000) * 1000,
		);
		const unpublished = await callAction({ intent: "unpublish" });
		expect(unpublished.ok).toBe(true);
		event = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.id, "e1"),
		});
		expect(event?.agendaPublishedAt).toBeNull();
	});

	it("settings update the day window, schedulable statuses, and format durations", async () => {
		const db = await seedBaseline();
		const body = new URLSearchParams({
			intent: "settings",
			dayStartMin: "420",
			dayEndMin: "1320",
			duration_fmt_keynote: "60",
			duration_fmt_talk: "30",
		});
		body.append("schedulableStatuses", "accepted");
		body.append("schedulableStatuses", "accept_queue");
		const request = await adminRequest(body);
		const result = unwrap<ActionData>(
			await action({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as Parameters<typeof action>[0]),
		);
		expect(result.ok).toBe(true);
		const event = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.id, "e1"),
		});
		expect(event?.agendaDayStartMin).toBe(420);
		expect(event?.agendaDayEndMin).toBe(1320);
		expect(event?.schedulableStatuses).toEqual(["accepted", "accept_queue"]);
		const keynote = await db.query.formats.findFirst({
			where: (f, { eq }) => eq(f.id, "fmt_keynote"),
		});
		expect(keynote?.defaultDurationMins).toBe(60);
	});

	it("applies room visibility only when the form carries the field", async () => {
		const db = await seedBaseline();
		const body = new URLSearchParams({
			intent: "settings",
			dayStartMin: "480",
			dayEndMin: "1080",
			visibleRooms_present: "1",
			visibleRooms: "room_main", // room_305 unchecked → hidden
		});
		body.append("schedulableStatuses", "accepted");
		const request = await adminRequest(body);
		const result = unwrap<ActionData>(
			await action({
				context: CONTEXT,
				request,
				params: {},
			} as unknown as Parameters<typeof action>[0]),
		);
		expect(result.ok).toBe(true);
		let room305 = await db.query.rooms.findFirst({
			where: (r, { eq: eqW }) => eqW(r.id, "room_305"),
		});
		expect(room305?.visible).toBe(false);
		const mainHall = await db.query.rooms.findFirst({
			where: (r, { eq: eqW }) => eqW(r.id, "room_main"),
		});
		expect(mainHall?.visible).toBe(true);
		// A POST without the presence marker must NOT hide every room.
		const withoutField = await callAction({
			intent: "settings",
			dayStartMin: "480",
			dayEndMin: "1080",
			schedulableStatuses: "accepted",
		});
		expect(withoutField.ok).toBe(true);
		room305 = await db.query.rooms.findFirst({
			where: (r, { eq: eqW }) => eqW(r.id, "room_305"),
		});
		expect(room305?.visible).toBe(false); // unchanged, not re-hidden/shown
	});

	it("rejects an inverted day window and an empty status set without writing", async () => {
		const db = await seedBaseline();
		const inverted = await callAction({
			intent: "settings",
			dayStartMin: "1080",
			dayEndMin: "480",
		});
		expect(inverted.ok).toBe(false);
		expect(inverted.fieldErrors?.dayEndMin?.[0]).toBeTruthy();
		const noStatuses = await callAction({
			intent: "settings",
			dayStartMin: "480",
			dayEndMin: "1080",
		});
		expect(noStatuses.ok).toBe(false);
		expect(noStatuses.formError).toBeTruthy();
		const event = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.id, "e1"),
		});
		expect(event?.agendaDayStartMin).toBe(480);
		expect(event?.agendaDayEndMin).toBe(1080);
		expect(event?.schedulableStatuses).toEqual(["accepted"]);
	});
});
