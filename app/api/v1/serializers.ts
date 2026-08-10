import type {
	contacts,
	events,
	fields,
	formats,
	languages,
	levels,
	participants,
	rooms,
	sessionStatuses,
	submissionAnswers,
	submissions,
	tags,
	tracks,
} from "~/db/schema";
import { maskEmail, maskPhone } from "./pii";

/**
 * Sessionboard-shape serializers for the /api/v1 compat surface. Field names
 * and nesting mirror docs/reference/sessionboard-openapi.yaml; the field SET
 * is the API column of the flows/09 exposure matrix — raw status enum
 * (queue values included), admin_url, per-speaker is_public, masked
 * emails/phones, and NO evaluation data, withdrawal metadata, or internal
 * contact fields (logistics notes). Hide-PII is hardcoded ON: every email and
 * phone passes through the masks, there is no unmasked variant.
 *
 * SEAM (public JSON feeds, ROUTE-MAP `feeds.*`): the feeds lane should build
 * its session/speaker payloads on these serializers and tighten the
 * projection (feeds drop emails/phones entirely and filter is_public), rather
 * than reserializing from rows.
 */

type EventRow = typeof events.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type TrackRow = typeof tracks.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type FormatRow = typeof formats.$inferSelect;
type LevelRow = typeof levels.$inferSelect;
type RoomRow = typeof rooms.$inferSelect;
type LanguageRow = typeof languages.$inferSelect;
type SessionStatusRow = typeof sessionStatuses.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;
type AnswerRow = typeof submissionAnswers.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;

export type ParticipantWithContact = ParticipantRow & { contact: ContactRow };

export type SubsessionWithRelations = SubmissionRow & {
	format: FormatRow | null;
	level: LevelRow | null;
	room: RoomRow | null;
	customStatus: SessionStatusRow | null;
	participants: ParticipantWithContact[];
	submissionTags: { tagId: string; tag: TagRow }[];
};

export type SessionWithRelations = SubsessionWithRelations & {
	submissionTracks: { trackId: string; track: TrackRow }[];
	submissionAnswers: (AnswerRow & { field: typeof fields.$inferSelect })[];
	subsessions: SubsessionWithRelations[];
};

/**
 * Their spec's documented envelope quirk: unassigned nested metadata is `{}`
 * on POST search responses and `null` on the CRUD proxy (`GET` list).
 * Reproduced per endpoint, never normalized.
 */
export type UnassignedStyle = "empty-object" | "null";

export type SerializeContext = {
	/** Deployment origin for `admin_url` deep links. */
	origin: string;
	unassigned: UnassignedStyle;
	/** The event's language picklist — resolves `submissions.language` text to a Language object. */
	eventLanguages: LanguageRow[];
	/** Sessions 2.0 `subsession_details` expand. */
	subsessionDetails?: boolean;
};

const iso = (d: Date | null | undefined): string | null =>
	d ? d.toISOString() : null;

function unassigned(style: UnassignedStyle): Record<string, never> | null {
	return style === "empty-object" ? {} : null;
}

/* ------------------------------------------------------------------ event --- */

export function serializeEvent(event: EventRow) {
	return {
		id: event.id,
		name: event.name,
		slug: event.slug,
		timezone: event.timezone,
		starts_at: iso(event.startsAt),
		ends_at: iso(event.endsAt),
		features: { translated_fields: false },
	};
}

/* ---------------------------------------------------------------- lookups --- */

export function serializeTrack(track: TrackRow) {
	return {
		id: track.id,
		name: track.name,
		color: track.color,
		order: 0,
		created_at: iso(track.createdAt),
		updated_at: null,
	};
}

export function serializeTag(tag: TagRow) {
	return {
		id: tag.id,
		name: tag.name,
		color: tag.color,
		created_at: iso(tag.createdAt),
		updated_at: null,
	};
}

export function serializeFormat(format: FormatRow) {
	return {
		id: format.id,
		name: format.name,
		default_duration_mins: format.defaultDurationMins,
		order: format.position,
		created_at: iso(format.createdAt),
		updated_at: null,
	};
}

export function serializeLevel(level: LevelRow) {
	return {
		id: level.id,
		name: level.name,
		order: level.position,
		created_at: iso(level.createdAt),
		updated_at: null,
	};
}

export function serializeRoom(room: RoomRow) {
	return {
		id: room.id,
		name: room.name,
		order: room.displayOrder,
		capacity: room.capacity,
		created_at: iso(room.createdAt),
		updated_at: null,
	};
}

export function serializeLanguage(language: LanguageRow) {
	return {
		id: language.id,
		name: language.name,
		order: language.position,
		created_at: iso(language.createdAt),
		updated_at: null,
	};
}

/**
 * The decision pipeline the API serves raw. `draft` is deliberately absent:
 * drafts are hidden from the API (flows/09 §2.1), so the status catalog never
 * advertises a value no response can carry.
 */
export const CORE_STATUS_CATALOG = [
	{ slug: "pending", name: "Pending" },
	{ slug: "accept_queue", name: "Accept Queue" },
	{ slug: "accepted", name: "Accepted" },
	{ slug: "decline_queue", name: "Decline Queue" },
	{ slug: "declined", name: "Declined" },
	{ slug: "withdrawn", name: "Withdrawn" },
] as const;

export function serializeCoreStatus(
	entry: (typeof CORE_STATUS_CATALOG)[number],
	order: number,
) {
	return {
		id: entry.slug,
		name: entry.name,
		status: entry.slug,
		status_name: entry.name,
		color: null,
		order,
		is_custom: false,
		created_at: null,
	};
}

export function serializeCustomStatus(row: SessionStatusRow) {
	return {
		id: row.id,
		name: row.name,
		status: null,
		status_name: null,
		color: row.color,
		order: row.position,
		is_custom: true,
		created_at: iso(row.createdAt),
	};
}

/* --------------------------------------------------------------- contacts --- */

/**
 * Full Contact record (speakers/contacts endpoints). Email/phones masked;
 * internal fields (logistics notes, user linkage) never serialized;
 * speaker_score / speaker_fee do not exist here and must never appear.
 */
export function serializeContact(contact: ContactRow, origin: string) {
	return {
		id: contact.id,
		full_name: `${contact.firstName} ${contact.lastName}`.trim(),
		first_name: contact.firstName,
		last_name: contact.lastName,
		email: maskEmail(contact.email),
		created_at: iso(contact.createdAt),
		updated_at: null,
		photo_url: null,
		company_name: contact.companyName,
		title: contact.jobTitle,
		about: contact.bio,
		phone_home: maskPhone(contact.homePhone),
		phone_mobile: maskPhone(contact.mobilePhone),
		address_postal_code: contact.zip,
		website_url: contact.websiteUrl,
		linkedin_url: contact.linkedinUrl,
		twitter_url: contact.twitterUrl,
		facebook_url: contact.facebookUrl,
		honorific: contact.honorific,
		salutation: contact.salutation,
		pronouns: contact.pronouns,
		gender: contact.gender,
		status: contact.status,
		is_public: contact.publicVisible,
		custom_fields: [],
		translated_fields: [],
		admin_url: `${origin}/admin/contacts/${contact.id}`,
	};
}

const ROLE_LABEL = {
	speaker: { name: "Speaker", plural: "Speakers" },
	chairperson: { name: "Chairperson", plural: "Chairpersons" },
	moderator: { name: "Moderator", plural: "Moderators" },
} as const;

type ProgramRole = keyof typeof ROLE_LABEL;

/**
 * Program participants only: `secondary` contacts assist with tasks and
 * communication — they are not session participants and never appear on
 * session payloads.
 */
export function programParticipants(
	rows: ParticipantWithContact[],
): (ParticipantWithContact & { role: ProgramRole })[] {
	return rows
		.filter(
			(p): p is ParticipantWithContact & { role: ProgramRole } =>
				p.role in ROLE_LABEL,
		)
		.sort((a, b) => a.position - b.position);
}

function serializeParticipantRole(role: ProgramRole) {
	return {
		id: role,
		slug: role,
		name: ROLE_LABEL[role].name,
		name_plural: ROLE_LABEL[role].plural,
		core_role: role,
	};
}

/**
 * Contact embedded on a session. Hidden speakers stay in the payload flagged
 * `is_public: false` (flows/09 rule j) — the API is a truth surface; only the
 * public embeds/feeds drop them.
 */
export function serializeSessionSpeaker(
	participant: ParticipantWithContact & { role: ProgramRole },
) {
	const contact = participant.contact;
	return {
		id: contact.id,
		participant_role: serializeParticipantRole(participant.role),
		full_name: `${contact.firstName} ${contact.lastName}`.trim(),
		first_name: contact.firstName,
		last_name: contact.lastName,
		email: maskEmail(contact.email),
		created_at: iso(contact.createdAt),
		updated_at: null,
		photo_url: null,
		company_name: contact.companyName,
		title: contact.jobTitle,
		about: contact.bio,
		phone_home: maskPhone(contact.homePhone),
		phone_mobile: maskPhone(contact.mobilePhone),
		website_url: contact.websiteUrl,
		linkedin_url: contact.linkedinUrl,
		twitter_url: contact.twitterUrl,
		facebook_url: contact.facebookUrl,
		is_public: contact.publicVisible,
	};
}

function serializeSessionParticipant(
	participant: ParticipantWithContact & { role: ProgramRole },
) {
	return {
		session_participant_id: participant.id,
		is_primary: participant.isPrimary,
		...serializeSessionSpeaker(participant),
	};
}

/* --------------------------------------------------------------- sessions --- */

/** Every session is standalone — composition (merge/link) is not modeled. */
const STANDALONE_COMPOSITION = {
	role: "standalone",
	is_linked: false,
	is_read_only: false,
	source_count: 0,
	target: null,
} as const;

function nestedTrack(track: TrackRow | undefined, ctx: SerializeContext) {
	if (!track) return unassigned(ctx.unassigned);
	return {
		id: track.id,
		event_id: track.eventId,
		name: track.name,
		color: track.color,
		order: 0,
		created_at: iso(track.createdAt),
		updated_at: null,
	};
}

function nestedLanguage(name: string, ctx: SerializeContext) {
	const match = ctx.eventLanguages.find((l) => l.name === name);
	if (!match) return unassigned(ctx.unassigned);
	return {
		id: match.id,
		event_id: match.eventId,
		name: match.name,
		order: match.position,
		created_at: iso(match.createdAt),
		updated_at: null,
	};
}

function nestedLevel(level: LevelRow | null, ctx: SerializeContext) {
	if (!level) return unassigned(ctx.unassigned);
	return {
		id: level.id,
		name: level.name,
		order: level.position,
		created_at: iso(level.createdAt),
		updated_at: null,
	};
}

function nestedFormat(format: FormatRow | null, ctx: SerializeContext) {
	if (!format) return unassigned(ctx.unassigned);
	return { id: format.id, name: format.name };
}

function nestedRoom(room: RoomRow | null, ctx: SerializeContext) {
	if (!room) return unassigned(ctx.unassigned);
	return {
		id: room.id,
		name: room.name,
		order: room.displayOrder,
		capacity: room.capacity,
		created_at: iso(room.createdAt),
		updated_at: null,
	};
}

function customStatusRef(row: SessionStatusRow | null) {
	return row ? { id: row.id, name: row.name } : null;
}

/**
 * Shared field core of every session-shaped payload. Deliberately absent, per
 * the exposure matrix: withdrawal metadata (who/why), evaluation data, drafts
 * of any kind, submitter identity beyond the participant list.
 */
function sessionCore(row: SubsessionWithRelations, ctx: SerializeContext) {
	const program = programParticipants(row.participants);
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		status: row.status,
		custom_status_id: row.customStatusId,
		custom_status: customStatusRef(row.customStatus),
		starts_at: iso(row.startsAt),
		ends_at: iso(row.endsAt),
		is_public: row.contentStatus === "approved",
		is_abstract: row.type === "abstract",
		composition_status: STANDALONE_COMPOSITION,
		client_session_id: row.clientSessionId,
		created_at: iso(row.createdAt),
		updated_at: iso(row.updatedAt),
		ceu_credits: row.ceuCredits,
		capacity: row.capacity,
		speakers: program
			.filter((p) => p.role === "speaker")
			.map(serializeSessionSpeaker),
		chairpersons: program
			.filter((p) => p.role === "chairperson")
			.map(serializeSessionSpeaker),
		moderators: program
			.filter((p) => p.role === "moderator")
			.map(serializeSessionSpeaker),
		participants: program.map(serializeSessionParticipant),
		tags: row.submissionTags.map((st) => serializeTag(st.tag)),
		language: nestedLanguage(row.language, ctx),
		level: nestedLevel(row.level, ctx),
		format: nestedFormat(row.format, ctx),
		room: nestedRoom(row.room, ctx),
	};
}

function serializeSubsession(
	row: SubsessionWithRelations,
	ctx: SerializeContext,
) {
	if (ctx.subsessionDetails) return sessionCore(row, ctx);
	const program = programParticipants(row.participants);
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		starts_at: iso(row.startsAt),
		ends_at: iso(row.endsAt),
		created_at: iso(row.createdAt),
		updated_at: iso(row.updatedAt),
		is_abstract: row.type === "abstract",
		composition_status: STANDALONE_COMPOSITION,
		format: nestedFormat(row.format, ctx),
		speakers: program
			.filter((p) => p.role === "speaker")
			.map(serializeSessionSpeaker),
		participants: program.map(serializeSessionParticipant),
		content: [],
	};
}

export function serializeSession(
	row: SessionWithRelations,
	ctx: SerializeContext,
) {
	const [firstTrack, ...restTracks] = row.submissionTracks;
	return {
		...sessionCore(row, ctx),
		custom_fields: row.submissionAnswers.map((a) => ({
			id: a.fieldId,
			name: a.field.name,
			value: a.value,
			type: a.field.type,
		})),
		track: nestedTrack(firstTrack?.track, ctx),
		// Extension beyond the Sessionboard shape: tracks are many-to-many here
		// (confirmed requirement); `track` above keeps single-track parity.
		tracks:
			firstTrack === undefined
				? []
				: [firstTrack, ...restTracks].map((st) => serializeTrack(st.track)),
		subsessions: row.subsessions.map((s) => serializeSubsession(s, ctx)),
		content: [],
		admin_url: `${ctx.origin}/admin/submissions/${row.id}`,
	};
}

/** Lightweight row for POST /sessions/status. Nothing soft-deletes here, so `deleted_at` is always null. */
export function serializeSessionStatusRow(
	row: SubmissionRow & {
		customStatus: SessionStatusRow | null;
		subsessions?: (SubmissionRow & { customStatus: SessionStatusRow | null })[];
	},
) {
	return {
		id: row.id,
		status: row.status,
		custom_status_id: row.customStatusId,
		custom_status: row.customStatus
			? serializeCustomStatus(row.customStatus)
			: null,
		is_abstract: row.type === "abstract",
		composition_status: STANDALONE_COMPOSITION,
		deleted_at: null,
		created_at: iso(row.createdAt),
		updated_at: iso(row.updatedAt),
		subsessions: (row.subsessions ?? []).map((s) => ({
			id: s.id,
			status: s.status,
			custom_status_id: s.customStatusId,
			custom_status: s.customStatus
				? serializeCustomStatus(s.customStatus)
				: null,
			is_abstract: s.type === "abstract",
			composition_status: STANDALONE_COMPOSITION,
			deleted_at: null,
			created_at: iso(s.createdAt),
			updated_at: iso(s.updatedAt),
			subsessions: [],
		})),
	};
}
