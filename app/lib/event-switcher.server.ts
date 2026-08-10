import type { SwitcherEvent } from "~/components/event-switcher";
import type { events, users } from "~/db/schema";
import { getActiveEvent, listMyEvents } from "~/lib/auth";
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

/**
 * The admin shell's switcher data: the resolved current event plus every event
 * the user may operate on (their orgs' only). `activeEvent` is null exactly
 * when the user has no org with an event — the sidebar then shows the
 * no-event indicator with the create link.
 */
export async function getSwitcherData(
	env: Env,
	user: typeof users.$inferSelect,
): Promise<{
	activeEvent: { id: string; name: string } | null;
	events: SwitcherEvent[];
}> {
	const active = await getActiveEvent(env, user);
	const mine = await listMyEvents(env, user.id);
	return {
		activeEvent: active ? { id: active.id, name: active.name } : null,
		events: toSwitcherEvents(mine, active?.id ?? null),
	};
}
