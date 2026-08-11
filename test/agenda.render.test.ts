import { createElement, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { PublishAgendaDialog } from "../app/agenda/board";
import {
	buildConflictRows,
	type AgendaSession,
	type Conflict,
} from "../app/agenda/lib";
import Agenda from "../app/routes/admin.agenda";
import type {
	AgendaSurfaceData,
	ItinerarySurfaceData,
	PublicSession,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "../app/lib/program-types";
import {
	AgendaSurface,
	ItinerarySurface,
	SessionsSurface,
	SpeakersSurface,
} from "../app/widgets/surfaces";

const conflicts: Conflict[] = [
	{
		aId: "session-a",
		aTitle: "Opening Keynote",
		bId: "session-b",
		bTitle: "Platform Deep Dive",
		kind: "room",
		roomName: "Main Hall",
		overlapStartMs: Date.UTC(2026, 9, 12, 17, 15),
		overlapEndMs: Date.UTC(2026, 9, 12, 17, 30),
	},
	{
		aId: "session-c",
		aTitle: "Agent Office Hours",
		bId: "session-d",
		bTitle: "Live Agent Demo",
		kind: "speaker",
		personName: "Marco Silva",
		overlapStartMs: Date.UTC(2026, 9, 12, 18, 0),
		overlapEndMs: Date.UTC(2026, 9, 12, 18, 30),
	},
];

function renderDialog() {
	const logical = buildConflictRows(conflicts);
	return renderToString(
		createElement(PublishAgendaDialog, {
			conflicts: logical.rows,
			total: logical.total,
			timezone: "America/Los_Angeles",
			submitting: false,
			error: null,
			onCancel: () => undefined,
			onPublish: () => undefined,
		}),
	);
}

describe("agenda publish confirmation", () => {
	it("lists each unresolved logical conflict once before publish", () => {
		const html = renderDialog();

		expect(html).toContain('role="alertdialog"');
		expect(html).toContain('aria-modal="true"');
		expect((html.match(/role="listitem"/g) ?? []).length).toBe(2);
		for (const title of conflicts.flatMap((conflict) => [
			conflict.aTitle,
			conflict.bTitle,
		])) {
			expect(html).toContain(title);
		}
	});
});

const adminAgendaSessions: AgendaSession[] = [
	{
		id: "session-durable",
		title: "Durable Workflows",
		status: "accepted",
		schedulable: true,
		publiclyVisible: true,
		startsAt: null,
		endsAt: null,
		roomId: null,
		formatName: "Talk",
		durationMins: 30,
		tracks: [],
		speakers: [{ contactId: "speaker-ada", name: "Ada Zhang" }],
	},
	{
		id: "session-streaming",
		title: "Streaming Systems",
		status: "accepted",
		schedulable: true,
		publiclyVisible: true,
		startsAt: null,
		endsAt: null,
		roomId: null,
		formatName: "Talk",
		durationMins: 30,
		tracks: [],
		speakers: [{ contactId: "speaker-grace", name: "Grace Hopper" }],
	},
];

function renderAdminAgenda(entry = "/?view=list") {
	const AgendaRoute = Agenda as ElementType;
	const loaderData = {
		event: {
			id: "event-devflow",
			name: "DevFlow",
			slug: "devflow",
			timezone: "UTC",
			dayStartMin: 480,
			dayEndMin: 1080,
			schedulableStatuses: ["accepted"],
			publishedAt: null,
			days: ["2026-10-12"],
			hiddenFromPublic: 0,
			staleSpeakers: 0,
			scheduleScanTruncated: false,
		},
		rooms: [],
		tracks: [],
		formats: [],
		sessions: adminAgendaSessions,
		statusOptions: ["accepted", "draft"],
	};
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () =>
				createElement(AgendaRoute, { loaderData, actionData: undefined }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: [entry] }));
}

describe("organizer agenda navigation", () => {
	it("links list titles to the submission workspace", () => {
		const html = renderAdminAgenda();

		expect(html).toMatch(
			/href="\/admin\/submissions\/session-durable"[^>]*>Durable Workflows<\/a>/,
		);
	});

	it("restores search from the URL and filters the list on reload", () => {
		const html = renderAdminAgenda("/?view=list&q=durable");

		expect(html).toMatch(/aria-label="Search sessions"[^>]*value="durable"/);
		expect(html).toContain("Durable Workflows");
		expect(html).not.toContain("Streaming Systems");
	});
});

const track = {
	id: "track-devex",
	name: "Developer Experience",
	color: "#0E6C66",
};

const trackedSession: PublicSession = {
	id: "session-track",
	title: "A Complete Guide to Durable Agents",
	description: "Build reliable agents without hiding failure states.",
	format: "Talk",
	formatId: "format-talk",
	level: "Advanced",
	language: "English",
	room: "Main Hall",
	roomId: "room-main",
	roomOrder: 1,
	tracks: [track],
	speakers: [],
	scheduled: true,
	dayKey: "2026-10-12",
	dayLabel: "Mon, Oct 12",
	dateLabel: "Monday, October 12, 2026",
	startLabel: "9:30 AM",
	timeRange: "9:30 AM – 10:00 AM",
	startMin: 570,
	endMin: 600,
	startsAtIso: "2026-10-12T16:30:00.000Z",
	endsAtIso: "2026-10-12T17:00:00.000Z",
};

function renderAgenda(data: AgendaSurfaceData) {
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () =>
				createElement(AgendaSurface, {
					data,
					base: "/schedule/devflow",
					sessionsBase: "/sessions/devflow",
					speakersBase: "/speakers/devflow",
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

const agendaBase: AgendaSurfaceData = {
	days: [{ key: "2026-10-12", label: "Mon, Oct 12" }],
	activeDay: "2026-10-12",
	dateLabel: "Monday, October 12, 2026",
	rooms: [],
	windowStartMin: 540,
	windowEndMin: 660,
	hourMarks: [
		{ min: 540, label: "9 AM" },
		{ min: 600, label: "10 AM" },
	],
	detail: null,
};

describe("public agenda track and overlap rendering", () => {
	it("surfaces the configured track in session-detail metadata", () => {
		const html = renderAgenda({ ...agendaBase, detail: trackedSession });

		expect(html).toContain(track.name);
	});

	it("keeps a short card's title and track visible at a readable overlap width", () => {
		const html = renderAgenda({
			...agendaBase,
			rooms: [
				{
					id: "room-main",
					name: "Main Hall",
					blocks: [
						{
							sessionId: trackedSession.id,
							title: trackedSession.title,
							timeRange: trackedSession.timeRange,
							track,
							format: trackedSession.format,
							startMin: 570,
							endMin: 600,
							displayEndMin: 615,
							lane: 0,
							laneCount: 2,
						},
						{
							sessionId: "session-overlap",
							title: "Overlapping Session With A Long Title",
							timeRange: "9:45 AM – 10:15 AM",
							track,
							format: "Talk",
							startMin: 585,
							endMin: 615,
							displayEndMin: 630,
							lane: 1,
							laneCount: 2,
						},
					],
				},
			],
		});

		expect(html).toContain(`title="${trackedSession.title}"`);
		expect(html).toContain(trackedSession.timeRange);
		expect(html).toContain("Developer Experience");
		const roomWidth = html.match(
			/aria-label="Main Hall"[^>]*style="min-width:(\d+)px"/,
		)?.[1];
		expect(Number(roomWidth)).toBeGreaterThanOrEqual(280);
	});
});

const speakerDirectoryDetail: SpeakerDirectoryData = {
	speakers: [],
	total: 1,
	page: 1,
	pages: 1,
	q: "",
	detail: {
		id: "speaker-ada",
		name: "Ada Zhang",
		firstName: "Ada",
		lastName: "Zhang",
		jobTitle: "CTO",
		companyName: "DevFlow",
		bio: "Ships reliable systems.",
		photoUrl: null,
		sessions: [
			{
				id: trackedSession.id,
				title: trackedSession.title,
				dateLabel: trackedSession.dateLabel,
				timeRange: trackedSession.timeRange,
				room: trackedSession.room,
				roomId: trackedSession.roomId,
			},
		],
	},
};

function renderSpeakerDetail() {
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () =>
				createElement(SpeakersSurface as ElementType, {
					data: speakerDirectoryDetail,
					base: "/speakers/devflow",
					sessionsBase: "/sessions/devflow",
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

const sessionSpeaker = {
	id: "speaker-ada",
	name: "Ada Zhang",
	firstName: "Ada",
	lastName: "Zhang",
	jobTitle: "CTO",
	companyName: "DevFlow",
	bio: "Ships reliable systems.",
	photoUrl: null,
};

const sessionDetailData: SessionsSurfaceData = {
	sessions: [],
	total: 1,
	page: 1,
	pages: 1,
	pageSize: 24,
	facets: { tracks: [], formats: [], rooms: [] },
	filters: { q: "", track: "", format: "", room: "" },
	hasAnySessions: true,
	detail: { ...trackedSession, speakers: [sessionSpeaker] },
};

function renderSessionDetail() {
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () =>
				createElement(SessionsSurface as ElementType, {
					data: sessionDetailData,
					base: "/sessions/devflow",
					sessionsBase: "/sessions/devflow",
					speakersBase: "/speakers/devflow",
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("public program cross-links", () => {
	it("links a speaker's related session to its standalone session detail", () => {
		const html = renderSpeakerDetail();

		expect(html).toContain(
			`href="/sessions/devflow?session=${trackedSession.id}"`,
		);
	});

	it("links a speaker's related session room to the standalone room filter", () => {
		const html = renderSpeakerDetail();

		expect(html).toContain(
			`href="/sessions/devflow?room=${trackedSession.roomId}"`,
		);
	});

	it("links a session's speaker to the standalone speaker detail", () => {
		const html = renderSessionDetail();

		expect(html).toContain(
			`href="/speakers/devflow?speaker=${sessionSpeaker.id}"`,
		);
	});

	it("links a session's room to the standalone room filter", () => {
		const html = renderSessionDetail();

		expect(html).toContain(
			`href="/sessions/devflow?room=${trackedSession.roomId}"`,
		);
	});
});

const itineraryData: ItinerarySurfaceData = {
	days: [
		{
			key: "2026-10-12",
			label: "Mon, Oct 12",
			dateLabel: "Monday, October 12, 2026",
			groups: [{ timeLabel: "9:30 AM", sessions: [trackedSession] }],
		},
	],
	activeDay: "2026-10-12",
	filters: { q: "durable", track: track.id, format: "", room: "" },
	facets: { tracks: [track], formats: [], rooms: [] },
	view: "day",
};

function renderItinerary() {
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () =>
				createElement(ItinerarySurface as ElementType, {
					data: itineraryData,
					base: "/itinerary/devflow",
					sessionsBase: "/sessions/devflow",
					eventId: "event-devflow",
					icsBase: "/feeds/devflow/agenda.ics",
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("public itinerary navigation", () => {
	it("preserves the selected day and filters when opening My Schedule", () => {
		expect(renderItinerary()).toContain(
			'href="/itinerary/devflow?day=2026-10-12&amp;q=durable&amp;track=track-devex&amp;view=mine"',
		);
	});

	it("links itinerary cards to standalone session details", () => {
		expect(renderItinerary()).toContain(
			`href="/sessions/devflow?session=${trackedSession.id}"`,
		);
	});
});
