import { describe, expect, it } from "vitest";
import {
	calendarDaysUntil,
	eventCountdown,
	greetingForHour,
	zonedCalendarDate,
	zonedHour,
} from "../app/lib/event-time";

// Oracles are hand-computed calendar arithmetic (e.g. Aug 10 → Oct 12 =
// 21 + 30 + 12 = 63 days), never derived by the functions under test.

const LA = "America/Los_Angeles";

describe("zonedCalendarDate", () => {
	it("resolves the calendar date in the given zone, not UTC", () => {
		// 01:00 UTC on Aug 11 is still Aug 10 in Los Angeles (UTC-7 in August).
		const instant = new Date("2026-08-11T01:00:00Z");
		expect(zonedCalendarDate(instant, LA)).toBe(Date.UTC(2026, 7, 10));
		expect(zonedCalendarDate(instant, "UTC")).toBe(Date.UTC(2026, 7, 11));
	});

	it("falls back to UTC on an unknown timezone instead of throwing", () => {
		const instant = new Date("2026-08-11T01:00:00Z");
		expect(zonedCalendarDate(instant, "Not/AZone")).toBe(Date.UTC(2026, 7, 11));
		expect(zonedHour(instant, "Not/AZone")).toBe(1);
	});
});

describe("eventCountdown", () => {
	// Seed convention: startsAt/endsAt are calendar dates stored as UTC midnight.
	const start = new Date("2026-10-12T00:00:00Z");
	const end = new Date("2026-10-14T00:00:00Z");

	it("counts calendar days in the EVENT's timezone", () => {
		// Aug 10 → Oct 12 is 63 days (21 left in Aug + 30 in Sep + 12 in Oct).
		expect(
			eventCountdown(new Date("2026-08-10T12:00:00Z"), LA, start, end),
		).toEqual({ phase: "upcoming", days: 63 });
	});

	it("flips at midnight in the event zone, not at UTC midnight", () => {
		// 06:59 UTC on Aug 10 is 23:59 Aug 9 in LA — still 64 days out;
		// two minutes later it is Aug 10 in LA — 63.
		expect(
			eventCountdown(new Date("2026-08-10T06:59:00Z"), LA, start, end),
		).toEqual({ phase: "upcoming", days: 64 });
		expect(
			eventCountdown(new Date("2026-08-10T07:01:00Z"), LA, start, end),
		).toEqual({ phase: "upcoming", days: 63 });
	});

	it("reports day-of-event while the event runs, inclusive of both ends", () => {
		expect(
			eventCountdown(new Date("2026-10-12T20:00:00Z"), LA, start, end),
		).toEqual({ phase: "running", day: 1, ofDays: 3 });
		expect(
			eventCountdown(new Date("2026-10-14T20:00:00Z"), LA, start, end),
		).toEqual({ phase: "running", day: 3, ofDays: 3 });
	});

	it("is ended the event-local day after the end date", () => {
		expect(
			eventCountdown(new Date("2026-10-15T20:00:00Z"), LA, start, end),
		).toEqual({ phase: "ended" });
	});

	it("treats a missing or inverted end date as a one-day event", () => {
		expect(
			eventCountdown(new Date("2026-10-12T20:00:00Z"), LA, start, null),
		).toEqual({ phase: "running", day: 1, ofDays: 1 });
		expect(
			eventCountdown(new Date("2026-10-13T20:00:00Z"), LA, start, null),
		).toEqual({ phase: "ended" });
		expect(
			eventCountdown(
				new Date("2026-10-12T20:00:00Z"),
				LA,
				start,
				new Date("2026-10-01T00:00:00Z"),
			),
		).toEqual({ phase: "running", day: 1, ofDays: 1 });
	});

	it("is unset without a start date", () => {
		expect(eventCountdown(new Date(), LA, null, end)).toEqual({
			phase: "unset",
		});
	});
});

describe("calendarDaysUntil", () => {
	it("measures from the event-local today", () => {
		// 01:00 UTC Aug 11 = Aug 10 in LA → 8 days to Aug 18; from UTC's Aug 11 → 7.
		const now = new Date("2026-08-11T01:00:00Z");
		const target = new Date("2026-08-18T00:00:00Z");
		expect(calendarDaysUntil(now, target, LA)).toBe(8);
		expect(calendarDaysUntil(now, target, "UTC")).toBe(7);
	});
});

describe("greetingForHour", () => {
	it("splits the day at 5 / 12 / 18", () => {
		expect(greetingForHour(4)).toBe("Good evening");
		expect(greetingForHour(5)).toBe("Good morning");
		expect(greetingForHour(11)).toBe("Good morning");
		expect(greetingForHour(12)).toBe("Good afternoon");
		expect(greetingForHour(17)).toBe("Good afternoon");
		expect(greetingForHour(18)).toBe("Good evening");
	});
});
