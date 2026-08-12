import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { detectConflicts, isSessionVisible } from "../app/agenda/lib";
import { getDb } from "../app/db";
import {
	calendarInviteProcessedOutbox,
	calendarInviteRevisions,
	calendarInviteSequenceFrontiers,
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
import {
	computeScheduleChanges,
	normalizeCalendarInviteHistory,
	sendScheduleUpdates,
} from "../app/domain/schedule-update";
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
		inFlight: number;
		remaining: number;
	};
	normalization?: {
		processed: number;
		remaining: boolean;
	};
	blockedSessions?: number;
};

function unwrap<T>(result: unknown): T {
	const r = result as { data?: T };
	return (r && typeof r === "object" && "data" in r ? r.data : result) as T;
}

async function callAction(fields: Record<string, string>): Promise<ActionData> {
	const body = new URLSearchParams(fields);
	const request = await adminRequest(body);
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	return unwrap<ActionData>(result);
}

async function finishScheduleUpdateAction(): Promise<ActionData> {
	for (let request = 0; request < 100; request += 1) {
		const result = await callAction({ intent: "schedule-updates" });
		// Only an unfinished scan asks for another click. A finished one
		// reports what it checked AND sends in the same request, so keying on
		// the mere presence of `normalization` would click past the send.
		if (!result.normalization?.remaining) return result;
	}
	throw new Error("Schedule-update normalization did not converge");
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
		scheduleScanBlocked: boolean;
	} | null;
	sessions: {
		id: string;
		title: string;
		status: string;
		schedulable: boolean;
		publiclyVisible: boolean;
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
 *
 * `indexed: false` is the install that upgraded INTO the ledger: the same real
 * invite history, none of it indexed yet.
 */
async function invitedBaseline(options: { indexed?: boolean } = {}) {
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
	if (options.indexed !== false) await normalizeCalendarInviteHistory(db, "e1");
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
	title?: string;
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
					options.title ??
					"Closing Keynote: The Post-SaaS Stack — AI.Engineer Sandbox Event",
				location: options.location,
				sequence: options.sequence,
				status: "CONFIRMED",
			},
		],
	});
}

describe("calendar ledger lifecycle", () => {
	// A hard delete may leave no orphan behind. The ledger adds two
	// submission-keyed tables, so deleting a submission must take them with it —
	// while the processed marker, which belongs to the immutable outbox row and
	// not to the submission, must survive so history is never re-normalized.
	it("hard-deleting a submission takes its revisions and frontier, not the outbox marker", async () => {
		const db = await invitedBaseline();
		// Give the keynote a real slot and send the update, so the ledger holds
		// every row shape: two revision attempts, a marker per outbox row, and the
		// frontier the send allocated.
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(await callAction({ intent: "schedule-updates" })).toMatchObject({
			updates: { sent: 1, failed: 0 },
		});
		const forKeynote = eq(calendarInviteRevisions.submissionId, "s_keynote");
		expect(
			(await db.select().from(calendarInviteRevisions).where(forKeynote))
				.length,
		).toBeGreaterThan(0);
		expect(
			await db
				.select()
				.from(calendarInviteSequenceFrontiers)
				.where(eq(calendarInviteSequenceFrontiers.submissionId, "s_keynote")),
		).toHaveLength(1);

		// The exact statement deleteSubmission issues; cascades own the children.
		await db.delete(submissions).where(eq(submissions.id, "s_keynote"));

		expect(
			await db.select().from(calendarInviteRevisions).where(forKeynote),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(calendarInviteSequenceFrontiers)
				.where(eq(calendarInviteSequenceFrontiers.submissionId, "s_keynote")),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(calendarInviteProcessedOutbox)
				.where(
					eq(calendarInviteProcessedOutbox.outboxId, "accept-keynote-initial"),
				),
		).toHaveLength(1);
	});
});

describe("schedule-update emails (stale speaker calendars)", () => {
	it("calendar invite ledger preserves immutable outbox attempts and processed markers", async () => {
		const [
			revisionColumns,
			revisionIndexes,
			markerColumns,
			frontierColumns,
			outboxColumns,
			cursorTable,
		] = await Promise.all([
			env.DB.prepare(
				"SELECT name FROM pragma_table_info('calendar_invite_revisions')",
			).all<{ name: string }>(),
			env.DB.prepare(
				"SELECT name, \"unique\" AS is_unique FROM pragma_index_list('calendar_invite_revisions')",
			).all<{ name: string; is_unique: number }>(),
			env.DB.prepare(
				"SELECT name FROM pragma_table_info('calendar_invite_processed_outbox')",
			).all<{ name: string }>(),
			env.DB.prepare(
				"SELECT name FROM pragma_table_info('calendar_invite_sequence_frontiers')",
			).all<{ name: string }>(),
			env.DB.prepare("SELECT name FROM pragma_table_info('email_outbox')").all<{
				name: string;
			}>(),
			env.DB.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendar_invite_ledger_cursors'",
			).first<{ name: string }>(),
		]);

		expect(revisionColumns.results.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"submission_id",
				"sequence",
				"state_hash",
				"title",
				"outbox_id",
			]),
		);
		expect(revisionIndexes.results).toEqual(
			expect.arrayContaining([
				{
					name: "calendar_invite_revisions_outbox_submission_uq",
					is_unique: 1,
				},
				{
					name: "calendar_invite_revisions_submission_sequence_idx",
					is_unique: 0,
				},
			]),
		);
		expect(markerColumns.results.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"outbox_id",
				"event_id",
				"invalid",
				"processed_at",
			]),
		);
		expect(frontierColumns.results.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"submission_id",
				"sequence",
				"state_hash",
				"updated_at",
			]),
		);
		expect(outboxColumns.results.map((row) => row.name)).toEqual(
			expect.arrayContaining(["send_claim_id", "send_claim_expires_at"]),
		);
		expect(cursorTable).toBeNull();

		const revisionIndexColumns = await Promise.all(
			[
				"calendar_invite_revisions_outbox_submission_uq",
				"calendar_invite_revisions_submission_sequence_idx",
			].map((name) =>
				env.DB.prepare(
					`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`,
				).all<{
					name: string;
				}>(),
			),
		);
		expect(
			revisionIndexColumns.map((result) =>
				result.results.map((row) => row.name),
			),
		).toEqual([
			["outbox_id", "submission_id"],
			["submission_id", "sequence"],
		]);
	});

	it("loader fails closed without writing normalization state", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values({
			id: "accept-loader-read-only",
			eventId: "e1",
			dedupeKey: "decision:accept:loader-read-only:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "sent",
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));

		const result = await callLoader();

		expect(result.event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: true,
		});
		expect(
			await db
				.select({ id: calendarInviteRevisions.id })
				.from(calendarInviteRevisions),
		).toEqual([]);
		expect(
			await db
				.select({ outboxId: calendarInviteProcessedOutbox.outboxId })
				.from(calendarInviteProcessedOutbox),
		).toEqual([]);
	});

	it("finishes history normalization before the same request sends updates", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values({
			id: "accept-two-phase",
			eventId: "e1",
			dedupeKey: "decision:accept:two-phase:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "sent",
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(participants).values({
			id: "p_keynote_two_phase",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});

		const delivered = await callAction({ intent: "schedule-updates" });

		expect(delivered).toMatchObject({
			ok: true,
			normalization: { processed: 1, remaining: false },
		});
		expect(delivered.updates).toMatchObject({
			sent: 1,
			failed: 0,
			inFlight: 0,
		});
		// The send read the sequence frontier that the SAME request had just
		// indexed: anything below 1 would land under the historic invite the
		// speaker's client already holds and be dropped as stale.
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 1,
		});
	});

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
		const repeat = await finishScheduleUpdateAction();
		expect(repeat.updates).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
	});

	it("detects a title-only calendar change", async () => {
		const db = await invitedBaseline();
		await db
			.update(submissions)
			.set({ title: "Closing Keynote: Durable Agents" })
			.where(eq(submissions.id, "s_keynote"));

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 1,
			scheduleScanTruncated: false,
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			sequence: 1,
			title:
				"AI.Engineer Sandbox Event (save the date): Closing Keynote: Durable Agents",
		});
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
		const result = await finishScheduleUpdateAction();
		expect(result.ok).toBe(false);
		expect(result.formError).toMatch(/history/i);
		expect(
			await db
				.select({ invalid: calendarInviteProcessedOutbox.invalid })
				.from(calendarInviteProcessedOutbox)
				.where(
					eq(
						calendarInviteProcessedOutbox.outboxId,
						"accept-keynote-malformed",
					),
				),
		).toEqual([{ invalid: true }]);
		expect(
			await db
				.select({ invalid: calendarInviteRevisions.invalid })
				.from(calendarInviteRevisions)
				.where(
					eq(calendarInviteRevisions.outboxId, "accept-keynote-malformed"),
				),
		).toEqual([{ invalid: true }]);
		expect((await callLoader()).event).toMatchObject({
			scheduleScanTruncated: false,
			scheduleScanBlocked: true,
		});
	});

	it("quarantines sent history whose ICS only looks structurally complete", async () => {
		const db = await invitedBaseline();
		// Prefix-named property (UIDX, not UID) and a second VCALENDAR: a client
		// reading either differently than we do would leave the speaker holding a
		// state we cannot see, so this must never become a trusted baseline.
		for (const [id, icsAttachment] of [
			[
				"update-prefix-named-uid",
				[
					"BEGIN:VCALENDAR",
					"BEGIN:VEVENT",
					"UIDX:submission-s_keynote@openrostrum",
					"DTSTART:20261012T150000Z",
					"DTEND:20261012T160000Z",
					"SUMMARY:Closing Keynote",
					"SEQUENCE:1",
					"END:VEVENT",
					"END:VCALENDAR",
				].join("\r\n"),
			],
			[
				"update-duplicate-dtstart",
				[
					"BEGIN:VCALENDAR",
					"BEGIN:VEVENT",
					"UID:submission-s_keynote@openrostrum",
					"DTSTART:20261012T150000Z",
					"DTSTART:20261012T180000Z",
					"DTEND:20261012T160000Z",
					"SUMMARY:Closing Keynote",
					"SEQUENCE:1",
					"END:VEVENT",
					"END:VCALENDAR",
				].join("\r\n"),
			],
		] as const) {
			await db.insert(emailOutbox).values({
				id,
				eventId: "e1",
				dedupeKey: `schedule-update:${id}`,
				to: "marco@test.co",
				subject: "Schedule update",
				html: "<p>update</p>",
				icsAttachment,
				status: "sent",
				sentAt: new Date(),
			});
		}
		await normalizeCalendarInviteHistory(db, "e1");

		expect(
			await db
				.select({
					outboxId: calendarInviteProcessedOutbox.outboxId,
					invalid: calendarInviteProcessedOutbox.invalid,
				})
				.from(calendarInviteProcessedOutbox)
				.where(eq(calendarInviteProcessedOutbox.invalid, true))
				.orderBy(calendarInviteProcessedOutbox.outboxId),
		).toEqual([
			{ outboxId: "update-duplicate-dtstart", invalid: true },
			{ outboxId: "update-prefix-named-uid", invalid: true },
		]);
		expect((await callLoader()).event).toMatchObject({
			scheduleScanBlocked: true,
		});
		const result = await finishScheduleUpdateAction();
		expect(result.ok).toBe(false);
		expect(result.formError).toMatch(/history/i);
	});

	it("holds back only the speaker whose invite history is unreadable", async () => {
		const db = await invitedBaseline();
		// A second speaker with her own clean delivered invite. Marco's history
		// being unreadable says nothing about what Dana's calendar holds.
		await db.insert(contacts).values({
			id: "c_dana",
			eventId: "e1",
			email: "dana@test.co",
			firstName: "Dana",
			lastName: "Okafor",
		});
		await db.insert(submissions).values({
			id: "s_panel",
			eventId: "e1",
			title: "Panel: Shipping Agents",
			status: "accepted",
			formatId: "fmt_talk",
			notifiedAt: new Date(),
		});
		await db.insert(participants).values({
			id: "p_panel",
			submissionId: "s_panel",
			contactId: "c_dana",
		});
		await db.insert(emailOutbox).values({
			id: "accept-panel-initial",
			eventId: "e1",
			dedupeKey: "decision:accept:initial:s_panel",
			to: "dana@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: buildIcs({
				calendarName: "AI.Engineer Sandbox Event",
				method: "PUBLISH",
				events: [
					{
						uid: "submission-s_panel@openrostrum",
						start: utc(2026, 10, 12, 15),
						end: utc(2026, 10, 15, 1),
						title:
							"AI.Engineer Sandbox Event (save the date): Panel: Shipping Agents",
						sequence: 0,
						status: "CONFIRMED",
					},
				],
			}),
			status: "sent",
			createdAt: new Date("2026-08-10T20:00:00Z"),
			sentAt: new Date("2026-08-10T20:01:00Z"),
		});
		// An ICS with a repeated DTSTART: a client could read a different slot
		// than we do, so Marco's baseline is unusable and must not be trusted.
		await db.insert(emailOutbox).values({
			id: "update-keynote-ambiguous",
			eventId: "e1",
			dedupeKey: "schedule-update:keynote-ambiguous",
			to: "marco@test.co",
			subject: "Schedule update",
			html: "<p>update</p>",
			icsAttachment: [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:submission-s_keynote@openrostrum",
				"DTSTART:20261012T150000Z",
				"DTSTART:20261012T180000Z",
				"DTEND:20261012T160000Z",
				"SUMMARY:Closing Keynote",
				"SEQUENCE:1",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
			status: "sent",
			sentAt: new Date(),
		});
		// Both sessions now move, so both are stale on content alone.
		for (const submissionId of ["s_keynote", "s_panel"]) {
			await callAction({
				intent: "schedule",
				submissionId,
				roomId: submissionId === "s_keynote" ? "room_main" : "room_305",
				day: "2026-10-12",
				startMinutes: "570",
			});
		}

		const result = await finishScheduleUpdateAction();
		// Dana's update goes out; Marco's is held for review. One broken row
		// must not take a 300-speaker conference offline.
		expect(result).toMatchObject({ ok: true, blockedSessions: 1 });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0, inFlight: 0 });
		const updates = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updates.map((row) => row.to).sort()).toEqual([
			"dana@test.co",
			"marco@test.co",
		]);
		expect(
			updates.find((row) => row.id === "update-keynote-ambiguous"),
		).toBeDefined();
		const { row } = await latestUpdateInvite(db, "dana@test.co");
		expect(row?.to).toBe("dana@test.co");
		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanBlocked: true,
		});
	});

	it("does not let an orphaned historical invite block active submissions", async () => {
		const db = await invitedBaseline();
		await db.insert(emailOutbox).values({
			id: "update-deleted-submission",
			eventId: "e1",
			dedupeKey: "schedule-update:deleted-submission",
			to: "former@test.co",
			subject: "Schedule update",
			html: "<p>old update</p>",
			icsAttachment: buildIcs({
				calendarName: "AI.Engineer Sandbox Event",
				method: "PUBLISH",
				events: [
					{
						uid: "submission-s_deleted@openrostrum",
						start: utc(2026, 10, 12, 15),
						end: utc(2026, 10, 12, 16),
						title: "Deleted session",
						sequence: 4,
					},
				],
			}),
			status: "sent",
			sentAt: new Date(),
		});
		await normalizeCalendarInviteHistory(db, "e1");
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});

		const result = await callAction({ intent: "schedule-updates" });

		expect(result).toMatchObject({ ok: true });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		expect(
			await db
				.select({ invalid: calendarInviteProcessedOutbox.invalid })
				.from(calendarInviteProcessedOutbox)
				.where(
					eq(
						calendarInviteProcessedOutbox.outboxId,
						"update-deleted-submission",
					),
				),
		).toEqual([{ invalid: false }]);
	});

	it("fails closed when matching history names another event's submission", async () => {
		const db = await seedBaseline();
		await db.insert(events).values({
			id: "e2",
			organizationId: "org1",
			name: "Other event",
			slug: "other-event",
		});
		await db.insert(submissions).values({
			id: "s_other_event",
			eventId: "e2",
			title: "Other event session",
			status: "accepted",
		});
		// The unreadable record went to Priya. Whatever it really described, it is
		// HER calendar holding it — so her session is the one we cannot claim a
		// baseline for.
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "speaker@test.co",
			firstName: "Priya",
			lastName: "Raman",
		});
		await db.insert(participants).values({
			id: "p_live",
			submissionId: "s_live",
			contactId: "c_priya",
			isPrimary: true,
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_live"));
		await db.insert(emailOutbox).values({
			id: "update-cross-event-submission",
			eventId: "e1",
			dedupeKey: "schedule-update:cross-event-submission",
			to: "speaker@test.co",
			subject: "Schedule update",
			html: "<p>unsafe update</p>",
			icsAttachment: buildIcs({
				calendarName: "AI.Engineer Sandbox Event",
				method: "PUBLISH",
				events: [
					{
						uid: "submission-s_other_event@openrostrum",
						start: utc(2026, 10, 12, 15),
						end: utc(2026, 10, 12, 16),
						title: "Other event session",
						sequence: 3,
					},
				],
			}),
			status: "sent",
			sentAt: new Date(),
		});

		await normalizeCalendarInviteHistory(db, "e1");

		expect(
			await db
				.select({ invalid: calendarInviteProcessedOutbox.invalid })
				.from(calendarInviteProcessedOutbox)
				.where(
					eq(
						calendarInviteProcessedOutbox.outboxId,
						"update-cross-event-submission",
					),
				),
		).toEqual([{ invalid: true }]);
		// A UID from another event names nothing we can correct here, so the
		// session it reached stays held back rather than being sent an update at a
		// sequence we cannot prove is an advance.
		expect((await callLoader()).event).toMatchObject({
			scheduleScanTruncated: false,
			scheduleScanBlocked: true,
			scheduleBlockedSessions: ["Live Demo: Agent Swarms in Production"],
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result).toMatchObject({ ok: false });
		expect(result.formError).toMatch(/email history/i);
	});

	it("rejects a fractional schedule-update sequence as unsafe history", async () => {
		const db = await invitedBaseline();
		await db.insert(emailOutbox).values({
			id: "update-keynote-fractional",
			eventId: "e1",
			dedupeKey: "schedule-update:fractional",
			to: "marco@test.co",
			subject: "Schedule update",
			html: "<p>update</p>",
			icsAttachment: keynoteIcs({
				start: utc(2026, 10, 12, 15),
				end: utc(2026, 10, 15, 1),
				sequence: 1,
			}).replace("SEQUENCE:1", "SEQUENCE:1.5"),
			status: "sent",
		});

		expect((await callLoader()).event?.scheduleScanTruncated).toBe(true);
		const result = await finishScheduleUpdateAction();
		expect(result.ok).toBe(false);
		expect(
			await db
				.select({ invalid: calendarInviteProcessedOutbox.invalid })
				.from(calendarInviteProcessedOutbox)
				.where(
					eq(
						calendarInviteProcessedOutbox.outboxId,
						"update-keynote-fractional",
					),
				),
		).toEqual([{ invalid: true }]);
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
		await normalizeCalendarInviteHistory(db, "e1");
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
		expect((await finishScheduleUpdateAction()).updates).toMatchObject({
			sent: 0,
			deduped: 0,
			failed: 0,
		});
	});

	it("recovers calendar delivery from normalized queued and failed invite attempts", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values({
			id: "accept-keynote-recovery",
			eventId: "e1",
			dedupeKey: "decision:accept:recovery:s_keynote",
			to: "marco@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "queued",
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
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 1,
			scheduleScanTruncated: false,
		});
		await db
			.update(emailOutbox)
			.set({ status: "failed" })
			.where(eq(emailOutbox.id, "accept-keynote-recovery"));
		expect((await callLoader()).event?.staleSpeakers).toBe(1);

		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		expect((await latestUpdateInvite(db)).vevent?.sequence).toBe(0);
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
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 0,
		});
	});

	it("uses a corrected-recipient success after a bounced attempt at the same SEQUENCE", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values([
			{
				id: "accept-keynote-wrong-bounced",
				eventId: "e1",
				dedupeKey: "decision:accept:wrong:s_keynote",
				to: "wrong@test.co",
				subject: "Your session was accepted",
				html: "<p>you're in</p>",
				icsAttachment: HISTORIC_NPM_ICS_INVITE,
				status: "bounced" as const,
				createdAt: new Date("2026-08-10T20:00:00Z"),
				sentAt: new Date("2026-08-10T20:01:00Z"),
			},
			{
				id: "accept-keynote-corrected-sent",
				eventId: "e1",
				dedupeKey: "decision:accept:corrected:s_keynote",
				to: "marco@test.co",
				subject: "Your session was accepted",
				html: "<p>you're in</p>",
				icsAttachment: HISTORIC_NPM_ICS_INVITE,
				status: "sent" as const,
				createdAt: new Date("2026-08-10T20:02:00Z"),
				sentAt: new Date("2026-08-10T20:03:00Z"),
			},
		]);
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(participants).values({
			id: "p_keynote",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event?.staleSpeakers).toBe(0);
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		expect((await latestUpdateInvite(db)).vevent?.sequence).toBe(1);
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

	// Acceptance re-sends all mint SEQUENCE 0, so one session can carry several
	// equal-SEQUENCE deliveries describing different times. RFC 5545 gives no
	// rule for which one a client kept — an equal SEQUENCE is precisely the case
	// where a client MAY ignore the redelivery — so neither is a baseline we can
	// suppress an update on, however well one of them matches today's slot.
	it("re-notifies when equal-SEQUENCE re-sends disagree, even though the slot matches one of them", async () => {
		const db = await seedBaseline();
		await db.insert(participants).values({
			id: "p_keynote",
			submissionId: "s_keynote",
			contactId: "c_marco",
		});
		await db
			.update(submissions)
			.set({ notifiedAt: new Date() })
			.where(eq(submissions.id, "s_keynote"));
		await db.insert(emailOutbox).values([
			// Re-send #1 put 9:30 AM on the speaker's calendar…
			{
				id: "accept-keynote-resend-a",
				eventId: "e1",
				dedupeKey: "decision:accept:resend-a:s_keynote",
				to: "marco@test.co",
				subject: "Your session was accepted",
				html: "<p>you're in</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 12, 16, 30),
					end: utc(2026, 10, 12, 17, 15),
					location: "Main Hall",
					sequence: 0,
				}),
				status: "sent" as const,
				createdAt: new Date("2026-08-10T20:00:00Z"),
				sentAt: new Date("2026-08-10T20:01:00Z"),
			},
			// …then re-send #2 moved it to 2:00 PM, at the SAME sequence.
			{
				id: "accept-keynote-resend-b",
				eventId: "e1",
				dedupeKey: "decision:accept:resend-b:s_keynote",
				to: "marco@test.co",
				subject: "Your session was accepted",
				html: "<p>you're in</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 12, 21),
					end: utc(2026, 10, 12, 21, 45),
					location: "Main Hall",
					sequence: 0,
				}),
				status: "sent" as const,
				createdAt: new Date("2026-08-10T20:02:00Z"),
				sentAt: new Date("2026-08-10T20:03:00Z"),
			},
		]);
		// The slot is now back to 9:30 — re-send #1's content exactly.
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await normalizeCalendarInviteHistory(db, "e1");

		// Reading that match as "up to date" strands every speaker whose client
		// kept re-send #2 at 2:00 PM, with no way to correct it from the product.
		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		expect((await latestUpdateInvite(db)).vevent).toMatchObject({
			start: utc(2026, 10, 12, 16, 30),
			sequence: 1,
		});
		// SEQUENCE 1 stands alone, so the disagreement is settled and the banner
		// clears — the re-notification happens once, it does not loop.
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
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
			createdAt: new Date("2026-08-10T20:02:00Z"),
			sentAt: new Date("2026-08-10T20:03:00Z"),
		});
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event?.staleSpeakers).toBe(1);
		const equalSequenceAttempts = await db
			.select({
				outboxId: calendarInviteRevisions.outboxId,
				sequence: calendarInviteRevisions.sequence,
				stateHash: calendarInviteRevisions.stateHash,
			})
			.from(calendarInviteRevisions)
			.where(eq(calendarInviteRevisions.submissionId, "s_keynote"));
		expect(equalSequenceAttempts).toHaveLength(2);
		expect(
			new Set(equalSequenceAttempts.map((row) => row.stateHash)).size,
		).toBe(2);
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent?.sequence).toBe(1);
	});

	it("keeps a sent baseline when a later same-state attempt fails", async () => {
		const db = await invitedBaseline();
		await db.insert(emailOutbox).values({
			id: "update-keynote-failed-same-state",
			eventId: "e1",
			dedupeKey: "schedule-update:failed-same-state",
			to: "marco@test.co",
			subject: "Schedule update",
			html: "<p>failed update</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "failed",
			createdAt: new Date("2026-08-10T20:04:00Z"),
		});
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: false,
		});
		expect(
			await db
				.select({ outboxId: calendarInviteRevisions.outboxId })
				.from(calendarInviteRevisions)
				.where(eq(calendarInviteRevisions.submissionId, "s_keynote")),
		).toHaveLength(2);
	});

	it("treats an event timezone edit as re-labelling, not a calendar revision", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const [scheduled] = await db
			.select()
			.from(events)
			.where(eq(events.id, "e1"));
		if (!scheduled) throw new Error("event fixture missing");
		const changeSet = await computeScheduleChanges(db, scheduled);
		expect(changeSet.changes).toHaveLength(1);
		expect(
			await sendScheduleUpdates(db, env, scheduled, changeSet.changes),
		).toMatchObject({ sent: 1, deduped: 0 });

		// The organiser corrects the event's display timezone. DTSTART is a UTC
		// instant, so not one speaker's calendar entry moved — 9:30 AM PDT and
		// 12:30 PM EDT name the same moment.
		await db
			.update(events)
			.set({ timezone: "America/New_York" })
			.where(eq(events.id, "e1"));
		const [relabelled] = await db
			.select()
			.from(events)
			.where(eq(events.id, "e1"));
		if (!relabelled) throw new Error("event fixture missing");
		expect((await computeScheduleChanges(db, relabelled)).changes).toEqual([]);
		expect((await callLoader()).event?.staleSpeakers).toBe(0);

		// Replaying the same revision under the new label must land on the same
		// outbox row. Timezone is deliberately absent from the send identity: a
		// label edit between an attempt and its retry would otherwise mint a
		// second email for a calendar entry that never changed.
		expect(
			await sendScheduleUpdates(db, env, relabelled, changeSet.changes),
		).toMatchObject({ sent: 0, deduped: 1 });
		expect(
			(await db.select().from(emailOutbox)).filter((row) =>
				row.dedupeKey?.startsWith("schedule-update:"),
			),
		).toHaveLength(1);
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
		await normalizeCalendarInviteHistory(db, "e1");
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
		await normalizeCalendarInviteHistory(db, "e1");
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
		expect((await finishScheduleUpdateAction()).updates).toMatchObject({
			sent: 0,
			deduped: 0,
			failed: 0,
		});
	});

	// The history scan exists for invites that predate the ledger. A send that
	// leaves its OWN outbox row unindexed makes that scan permanent: every round
	// of updates re-arms it, and while it is armed the agenda cannot count stale
	// speakers at all — it only offers to go check history again.
	it("indexes the update it just sent, so the next move still counts stale speakers", async () => {
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
		).toMatchObject({ sent: 1, deduped: 0, failed: 0 });

		// No normalizeCalendarInviteHistory() here on purpose: the send owns its
		// own ledger entry, written in the same request that wrote the outbox row.
		const sent = await latestUpdateInvite(db);
		if (!sent.row) throw new Error("Expected a schedule update");
		expect(
			(
				await db
					.select()
					.from(calendarInviteProcessedOutbox)
					.where(eq(calendarInviteProcessedOutbox.outboxId, sent.row.id))
			).map((marker) => marker.invalid),
		).toEqual([false]);
		expect(
			(
				await db
					.select()
					.from(calendarInviteRevisions)
					.where(eq(calendarInviteRevisions.outboxId, sent.row.id))
			).map((revision) => [revision.submissionId, revision.sequence]),
		).toEqual([["s_keynote", 1]]);

		// Move it again: the agenda must be able to say "1 speaker is stale"
		// instead of hiding the count behind another history check.
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-12",
			startMinutes: "630",
		});
		const moved = await callLoader();
		expect(moved.event?.scheduleScanTruncated).toBe(false);
		expect(moved.event?.staleSpeakers).toBe(1);
	});

	// Deploy day on an install with real invite history: indexing it is this
	// request's job, not a separate errand the operator has to click through.
	it("indexes pre-ledger invite history and sends in the same request", async () => {
		await invitedBaseline({ indexed: false });
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		expect(
			(await callAction({ intent: "schedule-updates" })).updates,
		).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
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

	it("preserves A→B→A history and advances from the highest sequence", async () => {
		const db = await invitedBaseline();
		await db.insert(emailOutbox).values([
			{
				id: "history-keynote-b",
				eventId: "e1",
				dedupeKey: "schedule-update:s_keynote@1",
				to: "marco@test.co",
				subject: "Prior schedule update",
				html: "<p>scheduled</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 12, 16, 30),
					end: utc(2026, 10, 12, 17, 15),
					location: "Main Hall",
					sequence: 1,
				}),
				status: "sent",
				createdAt: new Date("2026-08-10T20:02:00Z"),
				sentAt: new Date("2026-08-10T20:03:00Z"),
			},
			{
				id: "history-keynote-a-again",
				eventId: "e1",
				dedupeKey: "schedule-update:s_keynote@2",
				to: "marco@test.co",
				subject: "Prior schedule update",
				html: "<p>save the date again</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 12, 15),
					end: utc(2026, 10, 15, 1),
					title:
						"AI.Engineer Sandbox Event (save the date): Closing Keynote: The Post-SaaS Stack",
					sequence: 2,
				}),
				status: "sent",
				createdAt: new Date("2026-08-10T20:04:00Z"),
				sentAt: new Date("2026-08-10T20:05:00Z"),
			},
		]);
		await normalizeCalendarInviteHistory(db, "e1");

		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: false,
		});
		const revisions = await db
			.select({
				sequence: calendarInviteRevisions.sequence,
				stateHash: calendarInviteRevisions.stateHash,
			})
			.from(calendarInviteRevisions)
			.where(eq(calendarInviteRevisions.submissionId, "s_keynote"));
		const ordered = revisions.sort(
			(a, b) => (a.sequence ?? -1) - (b.sequence ?? -1),
		);
		expect(ordered.map((revision) => revision.sequence)).toEqual([0, 1, 2]);
		expect(ordered[0]?.stateHash).toBe(ordered[2]?.stateHash);

		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "840",
		});
		const result = await callAction({ intent: "schedule-updates" });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		expect((await latestUpdateInvite(db)).vevent?.sequence).toBe(3);
	});

	it("concurrent normalizers converge on one attempt and marker per outbox", async () => {
		const db = await invitedBaseline();
		await db.insert(emailOutbox).values([
			{
				id: "concurrent-update-1",
				eventId: "e1",
				dedupeKey: "schedule-update:concurrent-1",
				to: "marco@test.co",
				subject: "Schedule update",
				html: "<p>one</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 12, 16, 30),
					end: utc(2026, 10, 12, 17, 15),
					sequence: 1,
				}),
				status: "sent" as const,
			},
			{
				id: "concurrent-update-2",
				eventId: "e1",
				dedupeKey: "schedule-update:concurrent-2",
				to: "marco@test.co",
				subject: "Schedule update",
				html: "<p>two</p>",
				icsAttachment: keynoteIcs({
					start: utc(2026, 10, 13, 16, 30),
					end: utc(2026, 10, 13, 17, 15),
					sequence: 2,
				}),
				status: "bounced" as const,
			},
		]);

		await Promise.all([
			normalizeCalendarInviteHistory(db, "e1"),
			normalizeCalendarInviteHistory(db, "e1"),
		]);

		expect(
			await db
				.select({ outboxId: calendarInviteRevisions.outboxId })
				.from(calendarInviteRevisions),
		).toHaveLength(3);
		expect(
			await db
				.select({ outboxId: calendarInviteProcessedOutbox.outboxId })
				.from(calendarInviteProcessedOutbox),
		).toHaveLength(3);
	});

	it("quarantines an impossible oversized attachment without blocking later history", async () => {
		const db = await seedBaseline();
		const oversized = buildIcs({
			calendarName: "AI.Engineer Sandbox Event",
			method: "PUBLISH",
			events: Array.from({ length: 4400 }, (_, index) => ({
				uid: `submission-deleted-${index}@openrostrum`,
				start: utc(2026, 10, 12, 15),
				end: utc(2026, 10, 12, 16),
				title: `Deleted session ${index}`,
				sequence: index,
			})),
		});
		await db.insert(emailOutbox).values([
			{
				id: "oversized-history",
				eventId: "e1",
				dedupeKey: "schedule-update:oversized-history",
				to: "speaker@test.co",
				subject: "Oversized history",
				html: "<p>oversized</p>",
				icsAttachment: oversized,
				status: "sent",
				createdAt: new Date("2026-08-11T17:00:00Z"),
			},
			{
				id: "history-after-oversized",
				eventId: "e1",
				dedupeKey: "decision:accept:after-oversized:s_keynote",
				to: "marco@test.co",
				subject: "Accepted",
				html: "<p>accepted</p>",
				icsAttachment: HISTORIC_NPM_ICS_INVITE,
				status: "sent",
				createdAt: new Date("2026-08-11T17:01:00Z"),
			},
		]);

		await normalizeCalendarInviteHistory(db, "e1");

		expect(
			await db
				.select({
					outboxId: calendarInviteProcessedOutbox.outboxId,
					invalid: calendarInviteProcessedOutbox.invalid,
				})
				.from(calendarInviteProcessedOutbox),
		).toEqual(
			expect.arrayContaining([
				{ outboxId: "oversized-history", invalid: true },
				{ outboxId: "history-after-oversized", invalid: false },
			]),
		);
	});

	it("ranks delivered revisions only within the current event", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		await db.insert(events).values({
			id: "e2",
			organizationId: "org1",
			name: "Other Event",
			slug: "other-event",
			timezone: "UTC",
			startsAt: utc(2027, 1, 1, 9),
			endsAt: utc(2027, 1, 1, 17),
		});
		await db.insert(emailOutbox).values({
			id: "cross-event-revision-outbox",
			eventId: "e2",
			dedupeKey: "schedule-update:cross-event",
			to: "marco@test.co",
			subject: "Other event update",
			html: "<p>other</p>",
			status: "sent",
			createdAt: new Date("2026-08-11T18:00:00Z"),
			sentAt: new Date("2026-08-11T18:01:00Z"),
		});
		await db.insert(calendarInviteRevisions).values({
			id: "cross-event-revision",
			submissionId: "s_keynote",
			sequence: 99,
			stateHash: "cross-event-state",
			recipient: "marco@test.co",
			startsAt: utc(2027, 1, 1, 9),
			endsAt: utc(2027, 1, 1, 10),
			location: "Elsewhere",
			title: "Other event",
			outboxId: "cross-event-revision-outbox",
			invalid: false,
			createdAt: new Date("2026-08-11T18:00:00Z"),
		});

		const result = await computeScheduleChanges(db, event);

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]?.nextSequence).toBe(1);
	});

	it("preflights attachment bytes before loading safe calendar bodies", async () => {
		await seedBaseline();
		await getDb(env)
			.insert(emailOutbox)
			.values([
				{
					id: "two-megabyte-history",
					eventId: "e1",
					dedupeKey: "schedule-update:two-megabyte-history",
					to: "speaker@test.co",
					subject: "Malformed large history",
					html: "<p>large</p>",
					icsAttachment: "X".repeat(2 * 1024 * 1024 - 1024),
					status: "sent",
					createdAt: new Date("2026-08-11T17:00:00Z"),
				},
				{
					id: "safe-history-after-large",
					eventId: "e1",
					dedupeKey: "decision:accept:after-large:s_keynote",
					to: "marco@test.co",
					subject: "Accepted",
					html: "<p>accepted</p>",
					icsAttachment: HISTORIC_NPM_ICS_INVITE,
					status: "sent",
					createdAt: new Date("2026-08-11T17:01:00Z"),
				},
			]);
		const prepared: Array<{ query: string; params: unknown[] }> = [];
		const observedDatabase = new Proxy(env.DB, {
			get(target, property) {
				if (property === "prepare") {
					return (query: string) => {
						const statement = target.prepare(query);
						return new Proxy(statement, {
							get(preparedStatement, statementProperty) {
								if (statementProperty === "bind") {
									return (
										...params: Parameters<D1PreparedStatement["bind"]>
									) => {
										prepared.push({ query, params });
										return preparedStatement.bind(...params);
									};
								}
								const value = Reflect.get(preparedStatement, statementProperty);
								return typeof value === "function"
									? value.bind(preparedStatement)
									: value;
							},
						});
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});

		await normalizeCalendarInviteHistory(
			getDb({ DB: observedDatabase } as Env),
			"e1",
		);

		const bodyReads = prepared.filter(
			({ query }) =>
				query.includes('"ics_attachment"') &&
				!query.toLowerCase().includes("length(cast"),
		);
		expect(bodyReads).toHaveLength(1);
		expect(bodyReads[0]?.params).toContain("safe-history-after-large");
		expect(bodyReads[0]?.params).not.toContain("two-megabyte-history");
	});

	it("defers a safe attachment when the aggregate body budget is exhausted", async () => {
		const db = await seedBaseline();
		const paddedInvite = (sequence: number) =>
			`${keynoteIcs({
				start: new Date("2026-10-12T18:00:00Z"),
				end: new Date("2026-10-12T19:00:00Z"),
				sequence,
			})}\r\n${"X".repeat(460 * 1024)}`;
		await db.insert(emailOutbox).values(
			Array.from({ length: 3 }, (_, index) => ({
				id: `aggregate-history-${index}`,
				eventId: "e1",
				dedupeKey: `schedule-update:aggregate-history-${index}`,
				to: "marco@test.co",
				subject: "Schedule update",
				html: "<p>update</p>",
				icsAttachment: paddedInvite(index),
				status: "sent" as const,
				createdAt: new Date(`2026-08-11T17:0${index}:00Z`),
			})),
		);

		const first = await normalizeCalendarInviteHistory(db, "e1");
		expect(first).toEqual({ processed: 2, remaining: true });
		const second = await normalizeCalendarInviteHistory(db, "e1");
		expect(second).toEqual({ processed: 1, remaining: false });
	});

	it("batches normalization ledger writes into D1 round trips", async () => {
		const db = await seedBaseline();
		await db.insert(emailOutbox).values({
			id: "history-for-batched-writes",
			eventId: "e1",
			dedupeKey: "decision:accept:batched:s_keynote",
			to: "marco@test.co",
			subject: "Accepted",
			html: "<p>accepted</p>",
			icsAttachment: HISTORIC_NPM_ICS_INVITE,
			status: "sent",
			createdAt: new Date("2026-08-11T17:00:00Z"),
		});
		const batch = vi.fn(env.DB.batch.bind(env.DB));
		const observedDatabase = new Proxy(env.DB, {
			get(target, property) {
				if (property === "batch") return batch;
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});

		const result = await normalizeCalendarInviteHistory(
			getDb({ DB: observedDatabase } as Env),
			"e1",
		);

		expect(result).toEqual({ processed: 1, remaining: false });
		expect(batch).toHaveBeenCalled();
	});

	it("normalizes 1,001 attempts within D1 query limits and advances above the true maximum", async () => {
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
SUMMARY:AI.Engineer Sandbox Event (save the date): Closing Keynote: The Post-SaaS Stack
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

		const result = await finishScheduleUpdateAction();
		expect(result).toMatchObject({ ok: true });
		expect(result.updates).toMatchObject({ sent: 1, failed: 0 });
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent?.sequence).toBe(5001);
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
	});

	it("bounds one normalization invocation and resumes the remaining history later", async () => {
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
				SELECT n + 1 FROM invite_history WHERE n < 5599
			)
			INSERT INTO email_outbox (
				id, event_id, dedupe_key, "to", subject, html, ics_attachment,
				status, created_at, sent_at
			)
			SELECT
				'bounded-history-' || n,
				'e1',
				'schedule-update:s_keynote@' || CASE WHEN n = 0 THEN 7000 ELSE n END,
				'marco@test.co',
				'Prior schedule update',
				'<p>prior update</p>',
				'BEGIN:VCALENDAR
BEGIN:VEVENT
UID:submission-s_keynote@openrostrum
DTSTART:20261012T150000Z
DTEND:20261015T010000Z
SUMMARY:AI.Engineer Sandbox Event (save the date): Closing Keynote: The Post-SaaS Stack
SEQUENCE:' || CASE WHEN n = 0 THEN 7000 ELSE n END || '
END:VEVENT
END:VCALENDAR
',
				'sent',
				1800000000 + n,
				1800000000 + n
			FROM invite_history
		`).run();
		expect(history.meta.changes).toBe(5600);

		const first = await callAction({ intent: "schedule-updates" });
		expect(first).toMatchObject({
			ok: true,
			normalization: { remaining: true },
		});
		expect((await callLoader()).event).toMatchObject({
			staleSpeakers: 0,
			scheduleScanTruncated: true,
		});
		const firstProcessed = await env.DB.prepare(
			"SELECT count(*) AS count FROM calendar_invite_processed_outbox WHERE outbox_id LIKE 'bounded-history-%'",
		).first<{ count: number }>();
		expect(firstProcessed?.count).toBeGreaterThan(1001);
		expect(firstProcessed?.count).toBeLessThan(5600);

		const resumed = await finishScheduleUpdateAction();
		expect(resumed).toMatchObject({ ok: true });
		expect(resumed.updates).toMatchObject({ sent: 1, failed: 0 });
		const completed = await env.DB.prepare(
			"SELECT count(*) AS count FROM calendar_invite_processed_outbox WHERE outbox_id LIKE 'bounded-history-%'",
		).first<{ count: number }>();
		expect(completed?.count).toBe(5600);
		expect((await latestUpdateInvite(db)).vevent?.sequence).toBe(7001);
		expect((await callLoader()).event?.staleSpeakers).toBe(0);
	});

	it("sends from a browser-native form without a JavaScript-minted key", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});

		const result = await callAction({ intent: "schedule-updates" });

		expect(result.updates).toMatchObject({ sent: 1, deduped: 0 });
		const updates = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updates).toHaveLength(1);
	});

	it("semantic state dedupes a concurrent replay, while a later schedule revision still sends", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const firstState = await computeScheduleChanges(db, event);
		const first = await callAction({ intent: "schedule-updates" });
		expect(first.updates).toMatchObject({ sent: 1, deduped: 0 });
		const replay = await sendScheduleUpdates(
			db,
			env,
			event,
			firstState.changes,
		);
		expect(replay).toMatchObject({ sent: 0, deduped: 1 });

		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "840",
		});
		const second = await finishScheduleUpdateAction();
		expect(second.updates).toMatchObject({ sent: 1, deduped: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(2);
		expect(new Set(updateRows.map((row) => row.dedupeKey)).size).toBe(2);
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 2,
			start: utc(2026, 10, 13, 21, 0),
			location: "Room 305",
		});
	});

	for (const priorStatus of ["queued", "failed"] as const) {
		it(`claims a new sequence after a ${priorStatus} schedule-update attempt`, async () => {
			const db = await invitedBaseline();
			await callAction({
				intent: "schedule",
				submissionId: "s_keynote",
				roomId: "room_main",
				day: "2026-10-12",
				startMinutes: "570",
			});
			const event = await db.query.events.findFirst({
				where: (row, { eq }) => eq(row.id, "e1"),
			});
			if (!event) throw new Error("Expected seeded event");
			const firstState = await computeScheduleChanges(db, event);
			expect(
				await sendScheduleUpdates(db, env, event, firstState.changes),
			).toMatchObject({ sent: 1, failed: 0 });
			const first = await latestUpdateInvite(db);
			if (!first.row) throw new Error("Expected first schedule update");
			await db
				.update(emailOutbox)
				.set({ status: priorStatus })
				.where(eq(emailOutbox.id, first.row.id));
			await normalizeCalendarInviteHistory(db, "e1");

			await callAction({
				intent: "schedule",
				submissionId: "s_keynote",
				roomId: "room_305",
				day: "2026-10-13",
				startMinutes: "840",
			});
			const secondState = await computeScheduleChanges(db, event);
			expect(
				await sendScheduleUpdates(db, env, event, secondState.changes),
			).toMatchObject({ sent: 1, failed: 0 });

			const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
				row.dedupeKey?.startsWith("schedule-update:"),
			);
			const sequences = updateRows
				.flatMap((row) => parseIcsAttachment(row.icsAttachment ?? ""))
				.map((invite) => invite.sequence)
				.sort((a, b) => a - b);
			expect(sequences).toEqual([1, 2]);
		});
	}

	it("drops a stale concurrent snapshot before it can overwrite the current schedule", async () => {
		const db = await invitedBaseline();
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");

		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const firstState = await computeScheduleChanges(db, event);
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_305",
			day: "2026-10-13",
			startMinutes: "840",
		});
		const secondState = await computeScheduleChanges(db, event);

		const outcomes = await Promise.all([
			sendScheduleUpdates(db, env, event, firstState.changes),
			sendScheduleUpdates(db, env, event, secondState.changes),
		]);

		expect(outcomes[0]).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
		expect(outcomes[1]).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(1);
		expect(parseIcsAttachment(updateRows[0]?.icsAttachment ?? "")).toEqual([
			expect.objectContaining({
				sequence: 1,
				start: utc(2026, 10, 13, 21, 0),
				location: "Room 305",
			}),
		]);
	});

	it("revalidates the schedule after claiming a sequence", async () => {
		const db = await invitedBaseline();
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");

		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const staleState = await computeScheduleChanges(db, event);
		const replacementStart = utc(2026, 10, 13, 21, 0);
		const replacementEnd = utc(2026, 10, 13, 21, 30);
		await env.DB.prepare(`
			CREATE TRIGGER replace_schedule_during_frontier_claim
			BEFORE INSERT ON calendar_invite_sequence_frontiers
			WHEN NEW.submission_id = 's_keynote'
			BEGIN
				UPDATE submissions
				SET room_id = 'room_305',
					starts_at = ${Math.floor(replacementStart.getTime() / 1000)},
					ends_at = ${Math.floor(replacementEnd.getTime() / 1000)}
				WHERE id = 's_keynote';
			END
		`).run();

		let outcome: Awaited<ReturnType<typeof sendScheduleUpdates>>;
		try {
			outcome = await sendScheduleUpdates(db, env, event, staleState.changes);
		} finally {
			await env.DB.prepare(
				"DROP TRIGGER replace_schedule_during_frontier_claim",
			).run();
		}

		expect(outcome).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(0);
	});

	it("revalidates each recipient immediately before provider delivery", async () => {
		const db = await invitedBaseline();
		await db
			.update(contacts)
			.set({ email: "a-first@test.co" })
			.where(eq(contacts.id, "c_marco"));
		await db.insert(contacts).values({
			id: "c_second",
			eventId: "e1",
			email: "z-second@test.co",
			firstName: "Second",
			lastName: "Speaker",
		});
		await db.insert(submissions).values({
			id: "s_second",
			eventId: "e1",
			title: "Second scheduled session",
			status: "accepted",
			formatId: "fmt_talk",
			notifiedAt: new Date(),
		});
		await db.insert(participants).values({
			id: "p_second",
			submissionId: "s_second",
			contactId: "c_second",
		});
		await db.insert(emailOutbox).values({
			id: "accept-second-initial",
			eventId: "e1",
			dedupeKey: "decision:accept:initial:s_second",
			to: "z-second@test.co",
			subject: "Your session was accepted",
			html: "<p>you're in</p>",
			icsAttachment: buildIcs({
				calendarName: "AI.Engineer Sandbox Event",
				method: "PUBLISH",
				events: [
					{
						uid: "submission-s_second@openrostrum",
						start: utc(2026, 10, 12, 15),
						end: utc(2026, 10, 15, 1),
						title:
							"AI.Engineer Sandbox Event (save the date): Second scheduled session",
						sequence: 0,
					},
				],
			}),
			status: "sent",
			createdAt: new Date("2026-08-10T20:02:00Z"),
			sentAt: new Date("2026-08-10T20:03:00Z"),
		});
		await normalizeCalendarInviteHistory(db, "e1");
		await db
			.update(submissions)
			.set({
				roomId: "room_main",
				startsAt: utc(2026, 10, 12, 16, 30),
				endsAt: utc(2026, 10, 12, 17),
			})
			.where(eq(submissions.id, "s_second"));
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const staleState = await computeScheduleChanges(db, event);
		const replacementStart = utc(2026, 10, 13, 21);
		const replacementEnd = utc(2026, 10, 13, 21, 30);
		await env.DB.prepare(`
			CREATE TRIGGER move_second_after_first_delivery
			AFTER INSERT ON email_outbox
			WHEN NEW.dedupe_key LIKE 'schedule-update:%'
			BEGIN
				UPDATE submissions
				SET room_id = 'room_305',
					starts_at = ${Math.floor(replacementStart.getTime() / 1000)},
					ends_at = ${Math.floor(replacementEnd.getTime() / 1000)}
				WHERE id = 's_second';
			END
		`).run();

		let outcome: Awaited<ReturnType<typeof sendScheduleUpdates>>;
		try {
			outcome = await sendScheduleUpdates(db, env, event, staleState.changes);
		} finally {
			await env.DB.prepare(
				"DROP TRIGGER move_second_after_first_delivery",
			).run();
		}

		expect(outcome).toMatchObject({ sent: 1, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(1);
		expect(updateRows[0]?.to).toBe("a-first@test.co");
		expect(
			parseIcsAttachment(updateRows[0]?.icsAttachment ?? "").map(
				(invite) => invite.uid,
			),
		).toEqual(["submission-s_keynote@openrostrum"]);
	});

	it("corrects a calendar left stale by a possibly-delivered failed attempt", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const scheduled = await computeScheduleChanges(db, event);
		expect(
			await sendScheduleUpdates(db, env, event, scheduled.changes),
		).toMatchObject({ sent: 1, failed: 0 });
		const delivered = await latestUpdateInvite(db);
		if (!delivered.row) throw new Error("Expected the scheduled update");
		// The provider took the message but recording the outcome lost: the speaker
		// may be holding this slot even though our row reads `failed`.
		await db
			.update(emailOutbox)
			.set({ status: "failed" })
			.where(eq(emailOutbox.id, delivered.row.id));

		// Pulling the session back off the agenda restores exactly the invite the
		// last CONFIRMED send carried, so only the failed attempt makes it stale.
		await callAction({ intent: "unschedule", submissionId: "s_keynote" });
		await normalizeCalendarInviteHistory(db, "e1");
		const reverted = await computeScheduleChanges(db, event);
		expect(reverted.changes).toHaveLength(1);
		expect(
			await sendScheduleUpdates(db, env, event, reverted.changes),
		).toMatchObject({ sent: 1, failed: 0 });

		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			uid: "submission-s_keynote@openrostrum",
			sequence: 2,
			start: utc(2026, 10, 12, 15),
			end: utc(2026, 10, 15, 1),
		});
	});

	it("keeps a failed attempt retryable when the schedule has not moved", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const scheduled = await computeScheduleChanges(db, event);
		expect(
			await sendScheduleUpdates(db, env, event, scheduled.changes),
		).toMatchObject({ sent: 1, failed: 0 });
		const delivered = await latestUpdateInvite(db);
		if (!delivered.row) throw new Error("Expected the scheduled update");
		await db
			.update(emailOutbox)
			.set({ status: "failed" })
			.where(eq(emailOutbox.id, delivered.row.id));

		await normalizeCalendarInviteHistory(db, "e1");

		const retry = await computeScheduleChanges(db, event);
		expect(retry.changes).toHaveLength(1);
		expect(
			await sendScheduleUpdates(db, env, event, retry.changes),
		).toMatchObject({ sent: 1, failed: 0 });
		// The retry carries the attempt's OWN sequence: a speaker who did receive
		// the first copy sees no revision, one who did not finally gets the slot.
		const { vevent } = await latestUpdateInvite(db);
		expect(vevent).toMatchObject({
			sequence: 1,
			start: utc(2026, 10, 12, 16, 30),
			location: "Main Hall",
		});
	});

	it("drops a claim whose event snapshot lost a concurrent rename", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		await db
			.update(events)
			.set({ name: "Renamed Once" })
			.where(eq(events.id, "e1"));
		const staleEvent = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!staleEvent) throw new Error("Expected seeded event");
		const staleState = await computeScheduleChanges(db, staleEvent);
		expect(staleState.changes).toHaveLength(1);

		// A newer request renames again and delivers that name to the speaker.
		await db
			.update(events)
			.set({ name: "Renamed Twice" })
			.where(eq(events.id, "e1"));
		const freshEvent = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!freshEvent) throw new Error("Expected seeded event");
		const freshState = await computeScheduleChanges(db, freshEvent);
		expect(
			await sendScheduleUpdates(db, env, freshEvent, freshState.changes),
		).toMatchObject({ sent: 1, failed: 0 });
		expect((await latestUpdateInvite(db)).vevent).toMatchObject({
			sequence: 1,
			title: "Closing Keynote: The Post-SaaS Stack — Renamed Twice",
		});

		expect(
			await sendScheduleUpdates(db, env, staleEvent, staleState.changes),
		).toMatchObject({ sent: 0, deduped: 0, failed: 0 });

		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(1);
		expect((await latestUpdateInvite(db)).vevent).toMatchObject({
			sequence: 1,
			title: "Closing Keynote: The Post-SaaS Stack — Renamed Twice",
		});
	});

	it("revalidates the event itself after claiming a sequence", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const staleState = await computeScheduleChanges(db, event);
		await env.DB.prepare(`
			CREATE TRIGGER rename_event_during_frontier_claim
			BEFORE INSERT ON calendar_invite_sequence_frontiers
			WHEN NEW.submission_id = 's_keynote'
			BEGIN
				UPDATE events SET name = 'Renamed Mid-Claim' WHERE id = 'e1';
			END
		`).run();

		let outcome: Awaited<ReturnType<typeof sendScheduleUpdates>>;
		try {
			outcome = await sendScheduleUpdates(db, env, event, staleState.changes);
		} finally {
			await env.DB.prepare(
				"DROP TRIGGER rename_event_during_frontier_claim",
			).run();
		}

		expect(outcome).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(0);
	});

	it("reports an active provider claim as in flight instead of failed", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const changes = (await computeScheduleChanges(db, event)).changes;
		let releaseProvider: (() => void) | undefined;
		let providerStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			providerStarted = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						releaseProvider = () =>
							resolve(
								new Response(JSON.stringify({ id: "resend-schedule" }), {
									status: 200,
								}),
							);
						providerStarted?.();
					}),
			),
		);
		const resendEnv = {
			...env,
			RESEND_API_KEY: "re_test",
			EMAIL_FROM: "OpenRostrum <noreply@test.example>",
		} as unknown as Env;
		try {
			const first = sendScheduleUpdates(db, resendEnv, event, changes);
			await started;
			const second = await sendScheduleUpdates(db, resendEnv, event, changes);
			expect(second).toMatchObject({
				sent: 0,
				deduped: 0,
				failed: 0,
				inFlight: 1,
			});
			releaseProvider?.();
			await expect(first).resolves.toMatchObject({ sent: 1, failed: 0 });
		} finally {
			releaseProvider?.();
			vi.unstubAllGlobals();
		}
	});

	it("propagates unexpected D1 delivery failures", async () => {
		const db = await invitedBaseline();
		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		const changes = (await computeScheduleChanges(db, event)).changes;
		await env.DB.prepare(`
			CREATE TRIGGER fail_schedule_outbox_insert
			BEFORE INSERT ON email_outbox
			WHEN NEW.dedupe_key LIKE 'schedule-update:%'
			BEGIN
				SELECT RAISE(ABORT, 'forced D1 failure');
			END
		`).run();

		try {
			await expect(
				sendScheduleUpdates(db, env, event, changes),
			).rejects.toThrow(/Failed query: insert into "email_outbox"/);
		} finally {
			await env.DB.prepare("DROP TRIGGER fail_schedule_outbox_insert").run();
		}
	});

	it("drops an ABA snapshot after a newer frontier claim", async () => {
		const db = await invitedBaseline();
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");

		await callAction({
			intent: "schedule",
			submissionId: "s_keynote",
			roomId: "room_main",
			day: "2026-10-12",
			startMinutes: "570",
		});
		const staleState = await computeScheduleChanges(db, event);
		const originalStart = utc(2026, 10, 12, 16, 30);
		const originalEnd = utc(2026, 10, 12, 17, 15);
		const replacementStart = utc(2026, 10, 13, 21, 0);
		const replacementEnd = utc(2026, 10, 13, 21, 30);
		await env.DB.prepare(`
			CREATE TRIGGER advance_frontier_during_aba
			AFTER INSERT ON calendar_invite_sequence_frontiers
			WHEN NEW.submission_id = 's_keynote'
			BEGIN
				UPDATE submissions
				SET room_id = 'room_305',
					starts_at = ${Math.floor(replacementStart.getTime() / 1000)},
					ends_at = ${Math.floor(replacementEnd.getTime() / 1000)}
				WHERE id = 's_keynote';
				UPDATE calendar_invite_sequence_frontiers
				SET sequence = NEW.sequence + 1,
					state_hash = 'newer-claim'
				WHERE submission_id = NEW.submission_id;
				UPDATE submissions
				SET room_id = 'room_main',
					starts_at = ${Math.floor(originalStart.getTime() / 1000)},
					ends_at = ${Math.floor(originalEnd.getTime() / 1000)}
				WHERE id = 's_keynote';
			END
		`).run();

		let outcome: Awaited<ReturnType<typeof sendScheduleUpdates>>;
		try {
			outcome = await sendScheduleUpdates(db, env, event, staleState.changes);
		} finally {
			await env.DB.prepare("DROP TRIGGER advance_frontier_during_aba").run();
		}

		expect(outcome).toMatchObject({ sent: 0, deduped: 0, failed: 0 });
		const updateRows = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(updateRows).toHaveLength(0);
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
		await normalizeCalendarInviteHistory(db, "e1");
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
		await normalizeCalendarInviteHistory(db, "e1");
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

	it("bounds candidate discovery before dependent history and recipient queries", async () => {
		const db = await seedBaseline();
		await env.DB.prepare(`
			WITH RECURSIVE scale(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM scale WHERE n < 401
			)
			INSERT INTO submissions (
				id, event_id, type, title, status, submitter_id, notified_at,
				starts_at, ends_at, created_at, updated_at
			)
			SELECT
				'bounded-' || n,
				'e1',
				'session',
				'Bounded session ' || n,
				'accepted',
				'u_admin',
				unixepoch(),
				unixepoch('2026-10-12T16:00:00Z'),
				unixepoch('2026-10-12T16:30:00Z'),
				unixepoch(),
				unixepoch()
			FROM scale
		`).run();
		await env.DB.prepare(`
			WITH RECURSIVE scale(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM scale WHERE n < 401
			)
			INSERT INTO email_outbox (
				id, event_id, dedupe_key, "to", subject, html, status,
				created_at, sent_at
			)
			SELECT
				'bounded-outbox-' || n,
				'e1',
				'legacy-bounded:' || n,
				'admin@test.co',
				'Accepted',
				'<p>accepted</p>',
				'sent',
				unixepoch(),
				unixepoch()
			FROM scale
		`).run();
		await env.DB.prepare(`
			WITH RECURSIVE scale(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM scale WHERE n < 401
			)
			INSERT INTO calendar_invite_revisions (
				id, submission_id, sequence, state_hash, recipient, starts_at,
				ends_at, location, title, outbox_id, invalid, created_at
			)
			SELECT
				'bounded-revision-' || n,
				'bounded-' || n,
				0,
				'old-state-' || n,
				'admin@test.co',
				unixepoch('2026-10-12T16:00:00Z'),
				unixepoch('2026-10-12T16:30:00Z'),
				NULL,
				case when n = 401
					then 'Old session 401'
					else 'Bounded session ' || n || ' — AI.Engineer Sandbox Event'
				end,
				'bounded-outbox-' || n,
				0,
				unixepoch()
			FROM scale
		`).run();
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");

		let statements = 0;
		const countedDatabase = new Proxy(env.DB, {
			get(target, property) {
				if (property === "prepare") {
					return (query: string) => {
						statements += 1;
						return target.prepare(query);
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const changes = await computeScheduleChanges(
			getDb({ DB: countedDatabase } as Env),
			event,
		);

		expect(changes.changes).toHaveLength(1);
		expect(changes.changes[0]?.submissionId).toBe("bounded-401");
		expect(statements).toBeLessThanOrEqual(8);
	});

	it("claims at most 200 submission revisions before sending a batch", async () => {
		const db = await seedBaseline();
		const inserted = await env.DB.prepare(`
			WITH RECURSIVE scale(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM scale WHERE n < 201
			)
			INSERT INTO submissions (
				id, event_id, type, title, status, submitter_id, notified_at,
				created_at, updated_at
			)
			SELECT
				'scale-' || n,
				'e1',
				'session',
				'Scale session ' || n,
				'accepted',
				'u_admin',
				unixepoch(),
				unixepoch(),
				unixepoch()
			FROM scale
		`).run();
		expect(inserted.meta.changes).toBe(201);
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		const eventStartsAt = event?.startsAt;
		const eventEndsAt = event?.endsAt;
		if (!event || !eventStartsAt || !eventEndsAt) {
			throw new Error("Expected seeded event dates");
		}
		const changes = Array.from({ length: 201 }, (_, index) => {
			const position = index + 1;
			return {
				submissionId: `scale-${position}`,
				submissionTitle: `Scale session ${position}`,
				scheduled: false,
				invite: {
					title: `${event.name} (save the date): Scale session ${position}`,
					start: eventStartsAt,
					end: eventEndsAt,
					location: event.location,
				},
				nextSequence: 0,
				to: "admin@test.co",
				retryAfterBounceId: null,
			};
		});

		const result = await sendScheduleUpdates(db, env, event, changes);

		expect(result).toMatchObject({
			sent: 1,
			failed: 0,
			remaining: 1,
		});
		const [update] = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(parseIcsAttachment(update?.icsAttachment ?? "")).toHaveLength(200);
		const frontierCount = await env.DB.prepare(
			"SELECT count(*) AS count FROM calendar_invite_sequence_frontiers WHERE submission_id LIKE 'scale-%'",
		).first<{ count: number }>();
		expect(frontierCount?.count).toBe(200);
	});

	it("reaches a deliverable speaker behind a full window of unreachable sessions", async () => {
		const db = await seedBaseline();
		const event = await db.query.events.findFirst({
			where: (row, { eq }) => eq(row.id, "e1"),
		});
		if (!event) throw new Error("Expected seeded event");
		// 201 accepted sessions whose speaker contact is gone — an import that
		// dropped emails, a bulk contact cleanup. They can never be delivered, and
		// they sort ahead of every reachable session.
		await env.DB.prepare(`
			WITH RECURSIVE orphan(n) AS (
				SELECT 1
				UNION ALL
				SELECT n + 1 FROM orphan WHERE n < 201
			)
			INSERT INTO submissions (
				id, event_id, type, title, status, notified_at,
				starts_at, ends_at, room_id, format_id, created_at, updated_at
			)
			SELECT
				'aaa-' || printf('%03d', n),
				'e1',
				'session',
				'Orphan session ' || n,
				'accepted',
				unixepoch(),
				unixepoch('2026-10-12 16:00:00'),
				unixepoch('2026-10-12 16:30:00'),
				'room_main',
				'fmt_talk',
				unixepoch(),
				unixepoch()
			FROM orphan
		`).run();
		await db.insert(submissions).values({
			id: "zzz-reachable",
			eventId: "e1",
			title: "Reachable session",
			status: "accepted",
			notifiedAt: new Date(),
			startsAt: utc(2026, 10, 12, 17),
			endsAt: utc(2026, 10, 12, 17, 30),
			roomId: "room_main",
			formatId: "fmt_talk",
		});
		await db.insert(participants).values({
			id: "p-reachable",
			submissionId: "zzz-reachable",
			contactId: "c_marco",
		});
		const delivered = [
			...Array.from({ length: 201 }, (_, index) => ({
				submissionId: `aaa-${String(index + 1).padStart(3, "0")}`,
				to: `orphan-${index + 1}@test.co`,
				title: `Orphan session ${index + 1}`,
			})),
			{
				submissionId: "zzz-reachable",
				to: "marco@test.co",
				title: "Reachable session",
			},
		];
		for (let offset = 0; offset < delivered.length; offset += 10) {
			await db.insert(emailOutbox).values(
				delivered.slice(offset, offset + 10).map((invite) => ({
					id: `accept-${invite.submissionId}`,
					eventId: "e1",
					dedupeKey: `decision:accept:initial:${invite.submissionId}`,
					to: invite.to,
					subject: "Your session was accepted",
					html: "<p>you're in</p>",
					icsAttachment: buildIcs({
						calendarName: "AI.Engineer Sandbox Event",
						events: [
							{
								uid: `submission-${invite.submissionId}@openrostrum`,
								start: utc(2026, 10, 11, 9),
								end: utc(2026, 10, 11, 10),
								title: invite.title,
								sequence: 0,
							},
						],
					}),
					status: "sent" as const,
				})),
			);
		}
		for (let pass = 0; pass < 10; pass += 1) {
			if (!(await normalizeCalendarInviteHistory(db, "e1")).remaining) break;
		}

		const changes = await computeScheduleChanges(db, event);
		const result = await sendScheduleUpdates(db, env, event, changes.changes);

		// The unreachable sessions are still reported — as many as the bounded
		// window holds — but they no longer consume all of it: one broken contact
		// set cannot silence every speaker in the event.
		expect(result).toMatchObject({ sent: 1, failed: 200 });
		const [update] = (await db.select().from(emailOutbox)).filter((row) =>
			row.dedupeKey?.startsWith("schedule-update:"),
		);
		expect(update?.to).toBe("marco@test.co");
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

		const result = await finishScheduleUpdateAction();
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
