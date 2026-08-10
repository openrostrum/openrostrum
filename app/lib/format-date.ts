/**
 * Timestamps are stored as UTC epochs; every admin/public surface renders them
 * in the EVENT's IANA timezone (never the server's or viewer's locale zone).
 */
export function formatInTimezone(
	d: Date,
	timeZone: string,
	style: "datetime" | "date" | "time" = "datetime",
): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone,
			...(style === "datetime" && {
				dateStyle: "medium" as const,
				timeStyle: "short" as const,
			}),
			...(style === "date" && { dateStyle: "medium" as const }),
			...(style === "time" && { timeStyle: "short" as const }),
		}).format(d);
	} catch {
		return d.toISOString();
	}
}

/** "Oct 12, 2026, 10:00 AM – 10:45 AM" — null when the session is unscheduled. */
export function formatScheduleRange(
	startsAt: Date | null,
	endsAt: Date | null,
	timeZone: string,
): string | null {
	if (!startsAt || !endsAt) return null;
	return `${formatInTimezone(startsAt, timeZone)} – ${formatInTimezone(endsAt, timeZone, "time")}`;
}
