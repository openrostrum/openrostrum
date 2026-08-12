import { z } from "zod";
import { SUBMISSION_STATUS } from "~/db/constants";
import type {
	Contact,
	Submission,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import { TASK_STATUS } from "~/db/schema";
import type { AirtableFields, AirtableFieldValue } from "~/ports/airtable";

/**
 * The ONE declaration of what syncs and how (docs/airtable-sync-design.md,
 * Decision 2): app-owned = inbound edits corrected back · descriptive =
 * three-way merged, Airtable wins conflicts · workflow = transition request
 * through the domain path. Anything NOT declared here is team-private —
 * never read from the base, never written, never snapshotted.
 */
export type FieldClass = "app-owned" | "descriptive" | "workflow";

export const SYNCED_TABLES = [
	"submissions",
	"contacts",
	"task_assignments",
] as const;
export type SyncedTableName = (typeof SYNCED_TABLES)[number];

/** What an inbound cell must be for the D1 column behind it to hold it. */
export type InboundKind = "required-text" | "optional-text" | "date";

export interface SyncFieldSpec {
	class: FieldClass;
	/**
	 * Date-valued fields: Airtable re-serializes datetimes, so the raw remote
	 * string must be canonicalized before any equality check or a stored value
	 * would read as a remote edit on every tick.
	 */
	normalizeRemote?: (value: AirtableFieldValue) => AirtableFieldValue;
	/**
	 * Descriptive fields declare their D1 landing spot here, so a
	 * team-editable field without an inbound mapping is unrepresentable.
	 * `nullAs` substitutes a cleared cell's value for NOT NULL columns.
	 */
	inbound?: {
		column: string;
		kind: InboundKind;
		nullAs?: string;
	};
}

export interface TableMap {
	table: SyncedTableName;
	airtableTable: string;
	/** Airtable field name → class. The merge key ("Record ID") is implicit. */
	fields: Record<string, SyncFieldSpec>;
}

function isoOrNull(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

/** A remote cell that isn't a datetime string carries no date at all; one that
 * is gets canonicalized, so re-serialization alone never reads as an edit. */
const RemoteDate = z
	.string()
	.min(1)
	.transform((text) => {
		const parsed = new Date(text);
		return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
	});

/** The `normalizeRemote` every date-valued field uses — exported so tests
 * exercise the shipped normalizer instead of a copy that can drift. */
export function normalizeRemoteDate(
	value: AirtableFieldValue,
): AirtableFieldValue {
	return RemoteDate.safeParse(value).data ?? null;
}

type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
type TaskStatus = (typeof TASK_STATUS)[number];

/** Enum value → the human label pushed to the base ("accept_queue" → "Accept Queue"). */
export function statusLabel(status: string): string {
	return status
		.split("_")
		.map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
		.join(" ");
}

// A status arrives as whatever the team typed into a select: label-cased,
// space-separated, any case. Undo statusLabel, then it must BE a status.
const enumLabel = z
	.string()
	.transform((v) => v.trim().toLowerCase().replaceAll(" ", "_"));
const submissionStatusLabel = enumLabel.pipe(z.enum(SUBMISSION_STATUS));
const taskStatusLabel = enumLabel.pipe(z.enum(TASK_STATUS));

/** "Accept Queue" / "accept_queue" (case-insensitive) → the enum value, else null. */
export function parseSubmissionStatus(
	value: AirtableFieldValue,
): SubmissionStatus | null {
	return submissionStatusLabel.safeParse(value).data ?? null;
}
export function parseTaskStatus(value: AirtableFieldValue): TaskStatus | null {
	return taskStatusLabel.safeParse(value).data ?? null;
}

export interface SubmissionSyncRow {
	submission: Submission;
	speakers: Array<Pick<Contact, "firstName" | "lastName" | "email">>;
	trackNames: string[];
	formatName: string | null;
	roomName: string | null;
}

function personLabel(p: {
	firstName: string;
	lastName: string;
	email: string;
}): string {
	return `${p.firstName} ${p.lastName} <${p.email}>`;
}

export function projectSubmission(row: SubmissionSyncRow): AirtableFields {
	const s = row.submission;
	return {
		Title: s.title,
		Description: s.description,
		Status: statusLabel(s.status),
		Language: s.language,
		Format: row.formatName,
		Tracks: row.trackNames.join(", ") || null,
		Speakers: row.speakers.map(personLabel).join("; ") || null,
		Room: row.roomName,
		"Starts At": isoOrNull(s.startsAt),
		"Ends At": isoOrNull(s.endsAt),
		"Withdrawn Reason": s.withdrawnReason,
	};
}

export function projectContact(contact: Contact): AirtableFields {
	return {
		Email: contact.email,
		"First Name": contact.firstName,
		"Last Name": contact.lastName,
		"Job Title": contact.jobTitle,
		Company: contact.companyName,
		Bio: contact.bio,
		Status: statusLabel(contact.status),
	};
}

export interface TaskAssignmentSyncRow {
	assignment: typeof taskAssignments.$inferSelect;
	task: Pick<typeof tasks.$inferSelect, "name">;
	contact: Pick<Contact, "firstName" | "lastName" | "email"> | null;
	submission: Pick<typeof submissions.$inferSelect, "title"> | null;
}

export function projectTaskAssignment(
	row: TaskAssignmentSyncRow,
): AirtableFields {
	return {
		Task: row.task.name,
		Contact: row.contact ? personLabel(row.contact) : null,
		Submission: row.submission?.title ?? null,
		Status: statusLabel(row.assignment.status),
		"Due At": isoOrNull(row.assignment.dueAt),
		"Completed At": isoOrNull(row.assignment.completedAt),
	};
}

export const SUBMISSIONS_MAP: TableMap = {
	table: "submissions",
	airtableTable: "Sessions",
	fields: {
		Title: {
			class: "descriptive",
			inbound: { column: "title", kind: "required-text" },
		},
		Description: {
			class: "descriptive",
			inbound: { column: "description", kind: "optional-text", nullAs: "" },
		},
		Status: { class: "workflow" },
		Language: {
			class: "descriptive",
			inbound: { column: "language", kind: "required-text" },
		},
		Format: { class: "app-owned" },
		Tracks: { class: "app-owned" },
		Speakers: { class: "app-owned" },
		Room: { class: "app-owned" },
		"Starts At": { class: "app-owned", normalizeRemote: normalizeRemoteDate },
		"Ends At": { class: "app-owned", normalizeRemote: normalizeRemoteDate },
		"Withdrawn Reason": { class: "app-owned" },
	},
};

export const CONTACTS_MAP: TableMap = {
	table: "contacts",
	airtableTable: "Contacts",
	fields: {
		// Email is the app's identity key (unique per event) — locked, like
		// Sessionboard's locked contact core.
		Email: { class: "app-owned" },
		"First Name": {
			class: "descriptive",
			inbound: { column: "firstName", kind: "required-text" },
		},
		"Last Name": {
			class: "descriptive",
			inbound: { column: "lastName", kind: "required-text" },
		},
		"Job Title": {
			class: "descriptive",
			inbound: { column: "jobTitle", kind: "optional-text" },
		},
		Company: {
			class: "descriptive",
			inbound: { column: "companyName", kind: "optional-text" },
		},
		Bio: {
			class: "descriptive",
			inbound: { column: "bio", kind: "optional-text" },
		},
		Status: { class: "app-owned" },
	},
};

export const TASK_ASSIGNMENTS_MAP: TableMap = {
	table: "task_assignments",
	airtableTable: "Task Assignments",
	fields: {
		Task: { class: "app-owned" },
		Contact: { class: "app-owned" },
		Submission: { class: "app-owned" },
		Status: { class: "workflow" },
		"Due At": {
			class: "descriptive",
			normalizeRemote: normalizeRemoteDate,
			inbound: { column: "dueAt", kind: "date" },
		},
		"Completed At": {
			class: "app-owned",
			normalizeRemote: normalizeRemoteDate,
		},
	},
};

export const TABLE_MAPS: Record<SyncedTableName, TableMap> = {
	submissions: SUBMISSIONS_MAP,
	contacts: CONTACTS_MAP,
	task_assignments: TASK_ASSIGNMENTS_MAP,
};

export type PullOutcome =
	| { ok: true; set: Record<string, unknown> }
	| { ok: false; reason: string };

/**
 * The declared kind IS the parse. `required-text` keeps Airtable's own text
 * verbatim — it refuses a blank cell without trimming the one it accepts, so
 * a pull can never silently reformat what the team typed.
 */
const INBOUND_VALUE: Record<
	InboundKind,
	{ schema: z.ZodType<string | Date, AirtableFieldValue>; must: string }
> = {
	"required-text": {
		schema: z.string().refine((text) => text.trim() !== ""),
		must: "must be non-empty text",
	},
	"optional-text": { schema: z.string(), must: "must be text" },
	date: { schema: z.string().pipe(z.coerce.date()), must: "must be a date" },
};

/**
 * Validate an inbound edit of a DESCRIPTIVE field against its declared
 * inbound shape and translate it to a D1 column patch. A value the column
 * can't hold is rejected (and the app's value is written back by the
 * engine), never coerced into a broken row.
 */
export function applyDescriptivePull(
	table: SyncedTableName,
	field: string,
	value: AirtableFieldValue,
): PullOutcome {
	const spec = TABLE_MAPS[table].fields[field];
	const inbound = spec?.class === "descriptive" ? spec.inbound : undefined;
	if (!inbound) {
		return { ok: false, reason: `No inbound mapping for ${table}.${field}` };
	}
	// A cleared cell is a value, not a bad value — except where the column is
	// required, which is the one case with nothing to fall back to.
	if (value === null && inbound.kind !== "required-text") {
		const cleared = inbound.kind === "date" ? null : (inbound.nullAs ?? null);
		return { ok: true, set: { [inbound.column]: cleared } };
	}
	const { schema, must } = INBOUND_VALUE[inbound.kind];
	const parsed = schema.safeParse(value);
	return parsed.success
		? { ok: true, set: { [inbound.column]: parsed.data } }
		: { ok: false, reason: `${field} ${must}` };
}
