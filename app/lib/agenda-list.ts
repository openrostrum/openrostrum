import type { AgendaSurfaceData, PublicTrack } from "./program-types";

export type AgendaListEntry = {
	sessionId: string;
	title: string;
	timeLabel: string;
	timeRange: string | null;
	startMin: number;
	room: string;
	roomId: string;
	track: PublicTrack | null;
	format: string | null;
};

export type AgendaListGroup = {
	timeLabel: string;
	startMin: number;
	entries: AgendaListEntry[];
};

/** Start comes from the server-formatted range so the client never calls Intl. */
function startTimeLabel(timeRange: string | null): string {
	if (!timeRange) return "";
	const sep = " – ";
	const at = timeRange.indexOf(sep);
	return at === -1 ? timeRange : timeRange.slice(0, at);
}

export function agendaListGroups(data: AgendaSurfaceData): AgendaListGroup[] {
	const entries = data.rooms.flatMap((room, roomIndex) =>
		room.blocks.map((block) => ({
			sessionId: block.sessionId,
			title: block.title,
			timeLabel: startTimeLabel(block.timeRange),
			timeRange: block.timeRange,
			startMin: block.startMin,
			room: room.name,
			roomId: room.id,
			track: block.track,
			format: block.format,
			roomIndex,
		})),
	);
	entries.sort((a, b) => a.startMin - b.startMin || a.roomIndex - b.roomIndex);

	const groups: AgendaListGroup[] = [];
	for (const entry of entries) {
		const item: AgendaListEntry = {
			sessionId: entry.sessionId,
			title: entry.title,
			timeLabel: entry.timeLabel,
			timeRange: entry.timeRange,
			startMin: entry.startMin,
			room: entry.room,
			roomId: entry.roomId,
			track: entry.track,
			format: entry.format,
		};
		const last = groups[groups.length - 1];
		if (last && last.startMin === entry.startMin) {
			last.entries.push(item);
		} else {
			groups.push({
				timeLabel: item.timeLabel,
				startMin: item.startMin,
				entries: [item],
			});
		}
	}
	return groups;
}
