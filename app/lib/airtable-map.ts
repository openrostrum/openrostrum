import { SUBMISSION_STATUS } from "~/db/constants";
import type {
	Contact,
	Submission,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import { CONTACT_STATUS, TASK_STATUS } from "~/db/schema";
import type { AirtableFields, AirtableFieldValue } from "~/ports/airtable";

/**
 * The per-table field-class map — the ONE declaration of what syncs and how
 * (docs/airtable-sync-design.md, Decision 2). Anything not declared here is
 * team-private: never read from the base, never written, never snapshotted —
 * which is what makes the team's own columns safe to add.
 *
 *   app-owned    pushed; an inbound edit is corrected back on the next tick
 *   descriptive  three-way merged; a true conflict → Airtable wins
 *   workflow     an inbound edit is a TRANSITION REQUEST through the domain
 *                path; illegal transitions are rejected and written back
 */
export type FieldClass = "app-owned" | "descriptive" | "workflow";

export const SYNCED_TABLES = [
	"submissions",
	"contacts",
	"task_assignments",
] as const;
export type SyncedTableName = (typeof SYNCED_TABLES)[number];

export interface SyncFieldSpec {
	class: FieldClass;
	/**
	 * Date-valued fields: Airtable re-serializes datetimes, so the raw remote
	 * string must be canonicalized before any equality check or a stored value
	 * would read as a remote edit on every tick.
	 */
	normalizeRemote?: (value: AirtableFieldValue) => AirtableFieldValue;
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

function normalizeRemoteDate(value: AirtableFieldValue): AirtableFieldValue {
	if (typeof value !== "string" || value === "") return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/* ------------------------------------------------------------ status labels --- */

type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
type TaskStatus = (typeof TASK_STATUS)[number];
type ContactStatus = (typeof CONTACT_STATUS)[number];

function titleCase(value: string): string {
	return value
		.split("_")
		.map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
		.join(" ");
}

export function submissionStatusLabel(status: SubmissionStatus): string {
	return titleCase(status);
}
export function taskStatusLabel(status: TaskStatus): string {
	return titleCase(status);
}
export function contactStatusLabel(status: ContactStatus): string {
	return titleCase(status);
}

function parseLabel<T extends string>(
	value: AirtableFieldValue,
	statuses: readonly T[],
): T | null {
	if (typeof value !== "string") return null;
	const needle = value.trim().toLowerCase().replaceAll(" ", "_");
	return statuses.find((s) => s === needle) ?? null;
}

/** "Accept Queue" / "accept_queue" (case-insensitive) → the enum value, else null. */
export function parseSubmissionStatus(
	value: AirtableFieldValue,
): SubmissionStatus | null {
	return parseLabel(value, SUBMISSION_STATUS);
}
export function parseTaskStatus(value: AirtableFieldValue): TaskStatus | null {
	return parseLabel(value, TASK_STATUS);
}

/* ------------------------------------------------------------- projections --- */

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
		Status: submissionStatusLabel(s.status),
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
		Status: contactStatusLabel(contact.status),
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
		Status: taskStatusLabel(row.assignment.status),
		"Due At": isoOrNull(row.assignment.dueAt),
		"Completed At": isoOrNull(row.assignment.completedAt),
	};
}

/* ------------------------------------------------------------------- maps --- */

export const SUBMISSIONS_MAP: TableMap = {
	table: "submissions",
	airtableTable: "Sessions",
	fields: {
		Title: { class: "descriptive" },
		Description: { class: "descriptive" },
		Status: { class: "workflow" },
		Language: { class: "descriptive" },
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
		"First Name": { class: "descriptive" },
		"Last Name": { class: "descriptive" },
		"Job Title": { class: "descriptive" },
		Company: { class: "descriptive" },
		Bio: { class: "descriptive" },
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
		"Due At": { class: "descriptive", normalizeRemote: normalizeRemoteDate },
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

/* ---------------------------------------------------------- pull validation --- */

export type PullOutcome =
	| { ok: true; set: Record<string, unknown> }
	| { ok: false; reason: string };

function requireText(value: AirtableFieldValue): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalText(value: AirtableFieldValue): {
	ok: boolean;
	text: string | null;
} {
	if (value === null) return { ok: true, text: null };
	return typeof value === "string"
		? { ok: true, text: value }
		: { ok: false, text: null };
}

/**
 * Validate an inbound edit of a DESCRIPTIVE field and translate it to a D1
 * column patch. A value the column can't hold is rejected (and the app's
 * value is written back by the engine), never coerced into a broken row.
 */
export function applyDescriptivePull(
	table: SyncedTableName,
	field: string,
	value: AirtableFieldValue,
): PullOutcome {
	if (table === "submissions") {
		if (field === "Title") {
			const text = requireText(value);
			return text
				? { ok: true, set: { title: text } }
				: { ok: false, reason: "Title cannot be empty" };
		}
		if (field === "Description") {
			const { ok, text } = optionalText(value);
			return ok
				? { ok: true, set: { description: text ?? "" } }
				: { ok: false, reason: "Description must be text" };
		}
		if (field === "Language") {
			const text = requireText(value);
			return text
				? { ok: true, set: { language: text } }
				: { ok: false, reason: "Language cannot be empty" };
		}
	}
	if (table === "contacts") {
		if (field === "First Name" || field === "Last Name") {
			const text = requireText(value);
			return text
				? {
						ok: true,
						set:
							field === "First Name" ? { firstName: text } : { lastName: text },
					}
				: { ok: false, reason: `${field} cannot be empty` };
		}
		const column = {
			"Job Title": "jobTitle",
			Company: "companyName",
			Bio: "bio",
		}[field];
		if (column) {
			const { ok, text } = optionalText(value);
			return ok
				? { ok: true, set: { [column]: text } }
				: { ok: false, reason: `${field} must be text` };
		}
	}
	if (table === "task_assignments" && field === "Due At") {
		if (value === null) return { ok: true, set: { dueAt: null } };
		if (typeof value === "string") {
			const parsed = new Date(value);
			if (!Number.isNaN(parsed.getTime()))
				return { ok: true, set: { dueAt: parsed } };
		}
		return { ok: false, reason: "Due At must be a date" };
	}
	return { ok: false, reason: `No inbound mapping for ${table}.${field}` };
}
