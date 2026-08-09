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
