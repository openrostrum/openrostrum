import { describe, expect, it } from "vitest";
import { loader as scheduleLoader } from "../app/routes/schedule.$eventSlug";
import { loader as sessionsLoader } from "../app/routes/sessions.$eventSlug";
import { CONTEXT, seedProgram, unwrap } from "./program.fixtures";

// The public "Add to calendar" affordance must only offer links the .ics
// endpoint will actually serve: /feeds/:slug/agenda.ics 404s until the agenda
// is published, and an unscheduled session has no times to export.

type Loaded = { calendarHref: string | null };

async function runSessions(url: string) {
	const result = await sessionsLoader({
		context: CONTEXT,
		request: new Request(url),
		params: { eventSlug: "devflow" },
	} as unknown as Parameters<typeof sessionsLoader>[0]);
	return unwrap<Loaded>(result).data;
}

async function runSchedule(url: string) {
	const result = await scheduleLoader({
		context: CONTEXT,
		request: new Request(url),
		params: { eventSlug: "devflow" },
	} as unknown as Parameters<typeof scheduleLoader>[0]);
	return unwrap<Loaded>(result).data;
}

describe("public per-session add-to-calendar", () => {
	it("links the session-scoped .ics from an open session detail", async () => {
		await seedProgram();
		const sessions = await runSessions(
			"http://localhost/sessions/devflow?session=s1",
		);
		expect(sessions.calendarHref).toBe("/feeds/devflow/agenda.ics?ids=s1");
		const schedule = await runSchedule(
			"http://localhost/schedule/devflow?session=s1",
		);
		expect(schedule.calendarHref).toBe("/feeds/devflow/agenda.ics?ids=s1");
	});

	it("offers nothing on the list view", async () => {
		await seedProgram();
		const data = await runSessions("http://localhost/sessions/devflow");
		expect(data.calendarHref).toBeNull();
	});

	it("offers nothing for an unscheduled session (no times to export)", async () => {
		await seedProgram();
		const data = await runSessions(
			"http://localhost/sessions/devflow?session=s5",
		);
		expect(data.calendarHref).toBeNull();
	});

	it("offers nothing while the agenda is unpublished (the feed would 404)", async () => {
		await seedProgram({ agendaPublished: false });
		const data = await runSessions(
			"http://localhost/sessions/devflow?session=s1",
		);
		expect(data.calendarHref).toBeNull();
	});
});
