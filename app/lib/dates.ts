/**
 * The one way an instant is rendered — admin, portal, public program, email,
 * CSV. The timezone is a required argument because the alternative is the
 * runtime's own: UTC in the worker, the viewer's on the client, so the same
 * row renders one time server-side and a different one after hydration.
 * Stored UTC calendar dates (task due dates) are the deliberate exception and
 * live in `format.ts` as `formatDateUTC`.
 */

/**
 * `date` — "Oct 12, 2026" · `time` — "10:00 AM"
 * `datetime` — "Oct 12, 2026, 10:00 AM" · `datetime-zone` adds "PDT", for
 * surfaces where the reader is deciding across zones (sync history, deadlines).
 */
export type TimeStyle = "date" | "time" | "datetime" | "datetime-zone";

export function formatInTimeZone(
	date: Date | null | undefined,
	timeZone: string,
	style: TimeStyle = "datetime",
): string {
	if (!date) return "—";
	const options: Intl.DateTimeFormatOptions = {
		...(style !== "time" && {
			month: "short",
			day: "numeric",
			year: "numeric",
		}),
		...(style !== "date" && { hour: "numeric", minute: "2-digit" }),
		...(style === "datetime-zone" && { timeZoneName: "short" }),
	};
	try {
		return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(
			date,
		);
	} catch {
		// A zone written by a non-form path (CSV import, Airtable edit) can be
		// unknown here; UTC is the same degrade `resolveTimezone` applies, and a
		// readable date beats taking the page down.
		return new Intl.DateTimeFormat("en-US", {
			...options,
			timeZone: "UTC",
		}).format(date);
	}
}

/** "Oct 12, 2026, 10:00 AM – 10:45 AM" — null when the session is unscheduled. */
export function formatScheduleRange(
	startsAt: Date | null,
	endsAt: Date | null,
	timeZone: string,
): string | null {
	if (!startsAt || !endsAt) return null;
	return `${formatInTimeZone(startsAt, timeZone)} – ${formatInTimeZone(endsAt, timeZone, "time")}`;
}
