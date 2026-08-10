/**
 * Event-calendar time. `events.startsAt`/`endsAt` (and the seed's form close
 * dates) hold CALENDAR DATES encoded as UTC midnight — the onboarding-form
 * convention — while "today" is whatever date it currently is in the EVENT's
 * timezone. Day math therefore compares the stored UTC calendar date against
 * the event-local today; mixing in the server's local zone would shift the
 * countdown by a day around midnight.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `events.timezone` is user-influenced — an unknown zone falls back to UTC
 * rather than crashing the dashboard. */
function zonedFormatter(
	timeZone: string,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	try {
		return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
	} catch {
		return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
	}
}

/** The instant's calendar date in `timeZone`, as UTC-midnight epoch ms —
 * a common currency for whole-day arithmetic. */
export function zonedCalendarDate(instant: Date, timeZone: string): number {
	const fmt = zonedFormatter(timeZone, {
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

/** The instant's UTC calendar date as UTC-midnight epoch ms. */
export function utcCalendarDate(instant: Date): number {
	return Date.UTC(
		instant.getUTCFullYear(),
		instant.getUTCMonth(),
		instant.getUTCDate(),
	);
}

/** Hour-of-day (0–23) in `timeZone`. */
export function zonedHour(instant: Date, timeZone: string): number {
	const fmt = zonedFormatter(timeZone, { hour: "numeric", hourCycle: "h23" });
	const hour = fmt.formatToParts(instant).find((p) => p.type === "hour")?.value;
	return Number(hour ?? 0);
}

export function greetingForHour(hour: number): string {
	if (hour >= 5 && hour < 12) return "Good morning";
	if (hour >= 12 && hour < 18) return "Good afternoon";
	return "Good evening";
}

/** "Sunday, August 10, 2026" in the event's timezone. */
export function zonedDateLine(instant: Date, timeZone: string): string {
	return zonedFormatter(timeZone, {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(instant);
}

/** "Oct 12, 2026" for a UTC-midnight calendar date (event/close dates). */
export function formatCalendarDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** "Aug 10, 2026" for a real instant (e.g. createdAt), in the event's zone. */
export function zonedShortDate(instant: Date, timeZone: string): string {
	return zonedFormatter(timeZone, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(instant);
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
	const start = utcCalendarDate(startsAt);
	// A missing/inverted end date degrades to a one-day event, never a crash.
	const end = Math.max(start, endsAt ? utcCalendarDate(endsAt) : start);
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

/** Whole calendar days from event-local today until `date`'s UTC calendar
 * date; negative = already past. */
export function calendarDaysUntil(
	now: Date,
	date: Date,
	timeZone: string,
): number {
	return Math.round(
		(utcCalendarDate(date) - zonedCalendarDate(now, timeZone)) / DAY_MS,
	);
}
