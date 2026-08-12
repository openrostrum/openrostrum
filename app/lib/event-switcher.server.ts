import type { SwitcherEvent } from "~/components/event-switcher";
import type { events } from "~/db/schema";
import { resolveTimezone } from "~/lib/event-time";
import { formatInTimeZone } from "~/lib/dates";

type EventRow = typeof events.$inferSelect;

/** Event dates render as calendar dates in EACH event's own timezone (the
 * dashboard's convention) — any other zone could shift the calendar date. */
function eventDatesLabel(row: EventRow): string | null {
	const tz = resolveTimezone(row.timezone);
	const start = row.startsAt
		? formatInTimeZone(row.startsAt, tz, "date")
		: null;
	const end = row.endsAt ? formatInTimeZone(row.endsAt, tz, "date") : null;
	if (start && end && start !== end) return `${start} – ${end}`;
	return start ?? end;
}

/** View model for the event switcher: shape `listMyEvents` rows, marking the
 * event resolved by `getActiveEvent` — always pair those two helpers so the
 * listing and the current mark share one membership predicate. */
export function toSwitcherEvents(
	rows: EventRow[],
	currentEventId: string | null,
): SwitcherEvent[] {
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		dates: eventDatesLabel(row),
		isCurrent: row.id === currentEventId,
	}));
}
