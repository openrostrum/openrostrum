/**
 * Event-calendar day math. Every stored instant (`events.startsAt/endsAt`,
 * `forms.closeAt`, createdAt stamps) is a UTC epoch whose wall-clock meaning
 * lives in the EVENT's timezone — so day math and "today" always resolve to
 * event-local dates, never UTC's. Rendering helpers live in `format.ts`.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `events.timezone` can be written by future non-form paths (CSV import,
 * Airtable team edits); an unknown zone must degrade to UTC once at the
 * loader boundary, not crash every date on the page. Callers pass the
 * resolved zone to everything below and to `formatInTz`.
 */
export function resolveTimezone(timeZone: string): string {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return timeZone;
	} catch {
		return "UTC";
	}
}

/** The instant's calendar date in `timeZone`, as UTC-midnight epoch ms —
 * a common currency for whole-day arithmetic. Pass "UTC" to read a stored
 * UTC-midnight calendar date back out. */
export function zonedCalendarDate(instant: Date, timeZone: string): number {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const parts: Record<string, number> = {};
	for (const p of fmt.formatToParts(instant)) {
		if (p.type !== "literal") parts[p.type] = Number(p.value);
	}
	return Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1);
}

export function zonedHour(instant: Date, timeZone: string): number {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		hourCycle: "h23",
	});
	const hour = fmt.formatToParts(instant).find((p) => p.type === "hour")?.value;
	return Number(hour ?? 0);
}

export function greetingForHour(hour: number): string {
	if (hour >= 5 && hour < 12) return "Good morning";
	if (hour >= 12 && hour < 18) return "Good afternoon";
	return "Good evening";
}

export type EventCountdown =
	| { phase: "unset" }
	| { phase: "upcoming"; days: number }
	| { phase: "running"; day: number; ofDays: number }
	| { phase: "ended" };

/** Where today (event-local) sits relative to the event's calendar dates. */
export function eventCountdown(
	now: Date,
	timeZone: string,
	startsAt: Date | null,
	endsAt: Date | null,
): EventCountdown {
	if (!startsAt) return { phase: "unset" };
	const today = zonedCalendarDate(now, timeZone);
	const start = zonedCalendarDate(startsAt, timeZone);
	// A missing/inverted end date degrades to a one-day event, never a crash.
	const end = Math.max(
		start,
		endsAt ? zonedCalendarDate(endsAt, timeZone) : start,
	);
	if (today < start) {
		return { phase: "upcoming", days: Math.round((start - today) / DAY_MS) };
	}
	if (today > end) return { phase: "ended" };
	return {
		phase: "running",
		day: Math.round((today - start) / DAY_MS) + 1,
		ofDays: Math.round((end - start) / DAY_MS) + 1,
	};
}

/** Whole calendar days between two instants as seen in ONE zone (both
 * endpoints read in `timeZone`); negative = already past. */
export function calendarDaysUntil(
	now: Date,
	date: Date,
	timeZone: string,
): number {
	return Math.round(
		(zonedCalendarDate(date, timeZone) - zonedCalendarDate(now, timeZone)) /
			DAY_MS,
	);
}
