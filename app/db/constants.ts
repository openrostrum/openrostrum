/**
 * CLIENT-FACING enum tuples — pure data, NO drizzle imports, so a route
 * COMPONENT can read an enum without pulling schema.ts (and its drizzle
 * runtime) into the client bundle. A new client-visible enum is defined HERE;
 * schema.ts imports it, or keeps a copy a lockstep test pins equal.
 */
export const SUBMISSION_STATUS = [
	"draft",
	"pending",
	"accept_queue",
	"accepted",
	"decline_queue",
	"declined",
	"withdrawn",
] as const;

export const SUBMISSION_TYPE = ["abstract", "session"] as const;

/**
 * The statuses an admin decision can TARGET (the inline pill dropdown + bulk
 * edit). `draft` is pre-submission and `withdrawn` is set only by the withdraw
 * flow (which requires who/why metadata) — neither is a decision target.
 */
export const DECISION_STATUS = [
	"pending",
	"accept_queue",
	"accepted",
	"decline_queue",
	"declined",
] as const;

/**
 * Content approval — SEPARATE from the decision pipeline: public surfaces
 * render only `approved` content. Same lockstep contract as CONTACT_STATUS:
 * schema.ts keeps its own integration-owned copy, and a test pins the two
 * equal, because `satisfies` at the comparison site would let it widen.
 */
export const CONTENT_STATUS = ["draft", "in_review", "approved"] as const;

/**
 * Contact workflow statuses. The integration-owned schema.ts column enum is a
 * separate tuple; a lockstep test fails the build if the two ever diverge.
 */
export const CONTACT_STATUS = [
	"pending",
	"invited",
	"confirmed",
	"declined",
] as const;

/**
 * Participant roles on a submission. Same lockstep contract as CONTACT_STATUS:
 * schema.ts keeps its own integration-owned tuple; a test pins the two equal.
 */
export const PARTICIPANT_ROLE = [
	"speaker",
	"chairperson",
	"moderator",
	"secondary",
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLE)[number];
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
	speaker: "Speaker",
	chairperson: "Chairperson",
	moderator: "Moderator",
	secondary: "Secondary contact",
};

/** Sessionboard's eight system pipeline stages, verbatim. */
export const PIPELINE_STAGE = [
	"researching",
	"identified",
	"approved",
	"contacted",
	"interested",
	"confirmed",
	"future_fit",
	"declined",
] as const;
