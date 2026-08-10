/**
 * CLIENT-FACING enum tuples — pure data, NO drizzle imports. A route COMPONENT
 * imports enums from here so it never pulls app/db/schema.ts (and with it the
 * whole drizzle-orm runtime + every table definition) into the CLIENT bundle.
 * schema.ts imports these for its column `{ enum }` unions and re-exports them
 * for server code. When a feature needs an enum on the client, define it HERE,
 * not in schema.ts.
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
 * render only `approved` content. schema.ts currently carries its own copy
 * (integration-owned); the compiler flags any drift at the comparison sites.
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
