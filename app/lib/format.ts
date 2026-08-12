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

/** "Sunday, August 10, 2026" — the dashboard greeting's date line, in the event's timezone. */
export function formatDateLine(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

/**
 * "Job title · company" — the one way OpenRostrum writes a person's role. With
 * neither part the caller picks the fallback, because that copy is the
 * surface's. `transform` maps each part before joining: the HTML feeds must
 * escape the parts but not the separator.
 */
export function formatRole(
	person: { jobTitle?: string | null; companyName?: string | null },
	transform?: (part: string) => string,
): string {
	const parts = [person.jobTitle, person.companyName].filter(
		(part): part is string => Boolean(part),
	);
	return (transform ? parts.map(transform) : parts).join(" · ");
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
