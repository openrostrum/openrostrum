import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { PublishAgendaDialog } from "../app/agenda/board";
import Agenda, {
	ScheduleHistoryNormalizationOutcome,
	ScheduleUpdateDeliveryOutcome,
} from "../app/routes/admin.agenda";
import { buildConflictRows, type Conflict } from "../app/agenda/lib";
import type {
	AgendaSurfaceData,
	PublicSession,
} from "../app/lib/program-types";
import { AgendaSurface } from "../app/widgets/surfaces";

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

function renderedText(html: string): string {
	return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

function renderAdminAgenda(loaderData: unknown): string {
	const RouteComponent = Agenda as unknown as ComponentType<{
		loaderData: unknown;
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(RouteComponent, { loaderData }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("agenda invite-history continuation", () => {
	it("renders normalization progress with an actionable continuation", () => {
		const html = renderToString(
			createElement(ScheduleHistoryNormalizationOutcome, {
				result: { processed: 2, remaining: true },
				continuation: createElement(
					"button",
					null,
					"Continue schedule updates",
				),
			}),
		);

		const text = renderedText(html);
		expect(text).toContain("2 invite-history records normalized");
		expect(text).toContain("More history remains");
		expect(text).toContain("Continue schedule updates");
	});

	it("renders active provider claims separately from failed delivery", () => {
		const RoutesStub = createRoutesStub([
			{
				path: "/",
				Component: () =>
					createElement(ScheduleUpdateDeliveryOutcome, {
						result: {
							sent: 0,
							deduped: 0,
							failed: 0,
							inFlight: 1,
							remaining: 0,
						},
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);

		const text = renderedText(html);
		expect(text).toContain("1 delivery still in progress");
		expect(text).not.toContain("failed");
	});

	it("offers a POST action when invite history still needs checking", () => {
		const html = renderAdminAgenda({
			event: {
				id: "event-1",
				name: "Scale Conference",
				slug: "scale",
				timezone: "UTC",
				dayStartMin: 540,
				dayEndMin: 1020,
				schedulableStatuses: ["accepted"],
				publishedAt: null,
				days: ["2026-10-12"],
				hiddenFromPublic: 0,
				staleSpeakers: 0,
				scheduleScanTruncated: true,
				scheduleScanBlocked: false,
			},
			rooms: [],
			tracks: [],
			formats: [],
			sessions: [],
			statusOptions: ["accepted"],
		});

		expect(html).toContain('method="post"');
		expect(html).toContain('name="intent"');
		expect(html).toContain('value="schedule-updates"');
	});

	it("links terminally invalid invite history to diagnosis without a retry form", () => {
		const html = renderAdminAgenda({
			event: {
				id: "event-1",
				name: "Scale Conference",
				slug: "scale",
				timezone: "UTC",
				dayStartMin: 540,
				dayEndMin: 1020,
				schedulableStatuses: ["accepted"],
				publishedAt: null,
				days: ["2026-10-12"],
				hiddenFromPublic: 0,
				staleSpeakers: 0,
				scheduleScanTruncated: false,
				scheduleScanBlocked: true,
			},
			rooms: [],
			tracks: [],
			formats: [],
			sessions: [],
			statusOptions: ["accepted"],
		});

		expect(html).toContain("/admin/emails/history");
		expect(html).not.toContain('value="schedule-updates"');
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
