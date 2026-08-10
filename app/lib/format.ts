/**
 * Due dates are stored as UTC end-of-day instants; rendering them in any local
 * timezone could shift the calendar date, so they always render as UTC.
 */
export function formatDateUTC(date: Date): string {
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** Parse a `YYYY-MM-DD` form value as UTC end-of-day ("due by Oct 1" stays not-overdue during Oct 1). */
export function parseDueDate(value: string): Date {
	return new Date(`${value}T23:59:59Z`);
}
