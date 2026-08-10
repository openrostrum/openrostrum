/** Render a timestamp in the EVENT's timezone (never the server's or the
 * viewer's) — the one way a date is shown anywhere emails surface it. */
export function formatInTimeZone(
	date: Date | null | undefined,
	timeZone: string,
): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}
