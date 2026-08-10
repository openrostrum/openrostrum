/** Pure formatting helpers — safe on client and server. */

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

/** Render a real instant (session times, upload stamps) in the EVENT's timezone. */
export function formatInTz(
	date: Date,
	timeZone: string,
	style: "date" | "datetime" = "datetime",
): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		month: "short",
		day: "numeric",
		year: "numeric",
		...(style === "datetime"
			? { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
			: {}),
	}).format(date);
}

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Visible-character count of rich HTML (what the 0/5,000 counter measures). */
export function textLength(html: string): number {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-z#0-9]+;/gi, "x")
		.trim().length;
}
