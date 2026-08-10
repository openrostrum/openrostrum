import type { SwitcherEvent } from "~/components/event-switcher";
import type { events } from "~/db/schema";
import { formatDateUTC } from "~/lib/format";

type EventRow = typeof events.$inferSelect;

/** Event dates render as UTC calendar dates (the dashboard's convention) —
 * rendering in any local zone could shift the calendar date. */
function eventDatesLabel(row: EventRow): string | null {
	const start = row.startsAt ? formatDateUTC(row.startsAt) : null;
	const end = row.endsAt ? formatDateUTC(row.endsAt) : null;
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
