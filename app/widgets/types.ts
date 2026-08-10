/**
 * Client-safe shapes for the public program surfaces. These are PROJECTIONS,
 * not rows: the server serializes exactly these fields to anonymous visitors,
 * so contact emails/phones and internal statuses can never ride along. All
 * date/time strings are pre-formatted server-side in the EVENT's timezone —
 * components never call Intl, so SSR and hydration can't disagree.
 */

export type PublicTrack = { id: string; name: string; color: string };

export type PublicSpeaker = {
	id: string;
	name: string;
	firstName: string;
	lastName: string;
	jobTitle: string | null;
	companyName: string | null;
	bio: string | null;
	photoUrl: string | null;
};

export type PublicSession = {
	id: string;
	title: string;
	/** Plain text — submitter rich text is stripped server-side before it reaches any public surface. */
	description: string;
	format: string | null;
	formatId: string | null;
	level: string | null;
	language: string;
	room: string | null;
	roomId: string | null;
	tracks: PublicTrack[];
	speakers: PublicSpeaker[];
	scheduled: boolean;
	dayKey: string | null;
	dayLabel: string | null;
	dateLabel: string | null;
	startLabel: string | null;
	timeRange: string | null;
	startMin: number | null;
	endMin: number | null;
	startsAtIso: string | null;
	endsAtIso: string | null;
};

export type PublicSpeakerProfile = PublicSpeaker & {
	sessions: Array<{
		id: string;
		title: string;
		dateLabel: string | null;
		timeRange: string | null;
		room: string | null;
	}>;
};

export type ProgramEvent = {
	id: string;
	name: string;
	slug: string;
	timezone: string;
	location: string | null;
	dateRange: string | null;
	agendaPublished: boolean;
};

export type ProgramFacets = {
	tracks: Array<{ id: string; name: string }>;
	formats: Array<{ id: string; name: string }>;
	rooms: Array<{ id: string; name: string }>;
};

export type ProgramFilters = {
	q: string;
	track: string;
	format: string;
	room: string;
};

export type SessionsSurfaceData = {
	sessions: PublicSession[];
	total: number;
	page: number;
	pages: number;
	facets: ProgramFacets;
	filters: ProgramFilters;
	hasAnySessions: boolean;
};

export type SpeakersSurfaceData = {
	speakers: PublicSpeakerProfile[];
	total: number;
	page: number;
	pages: number;
	q: string;
	detail: PublicSpeakerProfile | null;
};

export type AgendaBlock = {
	sessionId: string;
	title: string;
	timeRange: string | null;
	track: PublicTrack | null;
	format: string | null;
	startMin: number;
	endMin: number;
	lane: number;
	laneCount: number;
};

export type AgendaSurfaceData = {
	days: Array<{ key: string; label: string }>;
	activeDay: string | null;
	dateLabel: string | null;
	rooms: Array<{ id: string; name: string; blocks: AgendaBlock[] }>;
	windowStartMin: number;
	windowEndMin: number;
	detail: PublicSession | null;
};

export type ItineraryDay = {
	key: string;
	label: string;
	dateLabel: string;
	groups: Array<{ timeLabel: string; sessions: PublicSession[] }>;
};

export type ItinerarySurfaceData = {
	days: ItineraryDay[];
	activeDay: string | null;
	filters: ProgramFilters;
	facets: ProgramFacets;
	view: "day" | "mine";
};

export type GallerySurfaceData = {
	speakers: PublicSpeakerProfile[];
	total: number;
	page: number;
	pages: number;
	q: string;
	detail: PublicSpeakerProfile | null;
};

export type EmbedConfig = {
	trackIds?: string[];
	formatIds?: string[];
	hiddenFields?: string[];
	accentColor?: string;
};

/** Card fields an embed may hide; title is always shown. */
export const EMBED_HIDEABLE_FIELDS = [
	"description",
	"speakers",
	"time",
	"room",
	"format",
	"track",
] as const;

export type HideableField = (typeof EMBED_HIDEABLE_FIELDS)[number];

export const EMBED_TYPE_LABELS = {
	sessions: "Session List",
	speakers: "Speaker List",
	agenda: "Agenda",
	itinerary: "Schedule Itinerary",
	gallery: "Speaker Gallery",
} as const;

export type EmbedType = keyof typeof EMBED_TYPE_LABELS;
