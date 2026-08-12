/**
 * The CSV importer's shared vocabulary — field list, header guessing, mapping
 * validation, and the step machine both import screens render.
 *
 * Client-safe on purpose (the wizard component imports it): every query lives
 * in ~/domain/contact-import. One definition of "what a contact CSV column
 * means" serves the event roster and the organization directory — a second
 * spelling would let the two importers disagree about the same file.
 */

import { parseCsv } from "~/lib/csv";

export const MAX_ROWS = 1000;
export const MAX_BYTES = 1_000_000;

export const IMPORT_FIELDS = [
	{ key: "email", label: "Email", required: true },
	{
		key: "fullName",
		label: "Full name (split into first + last)",
		required: false,
	},
	{ key: "firstName", label: "First name", required: false },
	{ key: "lastName", label: "Last name", required: false },
	{ key: "jobTitle", label: "Job title", required: false },
	{ key: "companyName", label: "Company", required: false },
	{ key: "mobilePhone", label: "Mobile phone", required: false },
	{ key: "bio", label: "Bio", required: false },
	{ key: "logisticsNotes", label: "Travel / logistics notes", required: false },
	{ key: "status", label: "Status", required: false },
	{ key: "linkedinUrl", label: "LinkedIn URL", required: false },
	{ key: "twitterUrl", label: "X (Twitter) URL", required: false },
	{ key: "websiteUrl", label: "Website URL", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

/** Explicit overwrite whitelist; names and status have separate merge rules. */
export const PROFILE_KEYS = [
	"jobTitle",
	"companyName",
	"mobilePhone",
	"bio",
	"logisticsNotes",
	"linkedinUrl",
	"twitterUrl",
	"websiteUrl",
] as const satisfies readonly ImportFieldKey[];

export type ImportMapping = Record<ImportFieldKey, number | null>;

const HEADER_GUESSES: Record<ImportFieldKey, string[]> = {
	email: ["email", "emailaddress", "mail"],
	fullName: ["name", "fullname", "speakername", "displayname", "contactname"],
	firstName: ["firstname", "first", "givenname", "forename"],
	lastName: ["lastname", "last", "surname", "familyname"],
	jobTitle: ["jobtitle", "title", "role", "position"],
	companyName: [
		"company",
		"companyname",
		"organization",
		"organisation",
		"employer",
	],
	mobilePhone: ["phone", "mobilephone", "mobile", "phonenumber", "cell"],
	bio: ["bio", "biography", "about"],
	logisticsNotes: [
		"logistics",
		"logisticsnotes",
		"travel",
		"travelnotes",
		"notes",
	],
	status: ["status", "workflowstatus"],
	linkedinUrl: ["linkedin", "linkedinurl"],
	twitterUrl: ["twitter", "x", "twitterurl", "xurl"],
	websiteUrl: ["website", "websiteurl", "url", "site"],
};

function guessColumn(headers: string[], key: ImportFieldKey): number | null {
	const normalized = headers.map((h) =>
		h.toLowerCase().replace(/[^a-z0-9]/g, ""),
	);
	for (const candidate of HEADER_GUESSES[key]) {
		const idx = normalized.indexOf(candidate);
		if (idx !== -1) return idx;
	}
	return null;
}

export function guessMapping(headers: string[]): ImportMapping {
	const guesses = Object.fromEntries(
		IMPORT_FIELDS.map((f) => [f.key, guessColumn(headers, f.key)]),
	) as ImportMapping;
	// Split columns win over a bare "name" column: guessing both would trip
	// the full-name/split-name exclusivity check on untouched defaults.
	if (guesses.firstName !== null || guesses.lastName !== null) {
		guesses.fullName = null;
	}
	return guesses;
}

/** Read the posted column mapping, discarding indexes outside the file. */
export function readMapping(
	form: FormData,
	headerCount: number,
): ImportMapping {
	const mapping = {} as ImportMapping;
	for (const field of IMPORT_FIELDS) {
		const raw = String(form.get(`map_${field.key}`) ?? "");
		const idx = raw === "" ? null : Number(raw);
		mapping[field.key] =
			idx !== null && Number.isInteger(idx) && idx >= 0 && idx < headerCount
				? idx
				: null;
	}
	return mapping;
}

/** Why this mapping can't be imported, or null when it's usable. */
export function mappingError(mapping: ImportMapping): string | null {
	if (mapping.email === null)
		return "Map the Email column — it's how duplicates are detected.";
	const hasSplitName = mapping.firstName !== null || mapping.lastName !== null;
	if (mapping.fullName !== null && hasSplitName)
		return "Map either the full-name column or the separate first/last columns — not both.";
	if (mapping.fullName === null && !hasSplitName)
		return "Map a name column — first name, last name, or a single full-name column.";
	return null;
}

/**
 * Step 1 for both importers: validate the posted file and hand back the
 * column-mapping screen. Every refusal an organizer can hit on upload is
 * phrased here once, so the two screens can't disagree about what a bad file
 * is or what the caps are.
 */
export async function readUpload(
	file: FormDataEntryValue | null,
): Promise<UploadStep | MapStep> {
	if (!(file instanceof File) || file.size === 0) {
		return { step: "upload", formError: "Choose a CSV file to upload." };
	}
	if (file.size > MAX_BYTES) {
		return {
			step: "upload",
			formError: "That file is over 1 MB — split it and import in parts.",
		};
	}
	const text = await file.text();
	const table = parseCsv(text);
	if (table.headers.length === 0 || table.rows.length === 0) {
		return {
			step: "upload",
			formError:
				"Couldn't find any data — the first row must be column headers, followed by one contact per row.",
		};
	}
	if (table.rows.length > MAX_ROWS) {
		return {
			step: "upload",
			formError: `That file has ${table.rows.length} rows — the limit is ${MAX_ROWS} per import. Split it and import in parts.`,
		};
	}
	return {
		step: "map",
		headers: table.headers,
		preview: table.rows.slice(0, 3),
		rowCount: table.rows.length,
		csvB64: base64Utf8(text),
		guesses: guessMapping(table.headers),
	};
}

/**
 * Step 2+ for both importers: rehydrate the carried CSV and read the posted
 * column mapping, returning the screen to re-render when either is unusable.
 */
export function readMappedCsv(
	form: FormData,
):
	| { ok: true; rows: string[][]; csvB64: string; mapping: ImportMapping }
	| { ok: false; step: UploadStep | MapStep } {
	const csvB64 = String(form.get("csvB64") ?? "");
	if (!csvB64) {
		return {
			ok: false,
			step: { step: "upload", formError: "Upload a CSV file first." },
		};
	}
	const table = parseCsv(utf8FromBase64(csvB64));
	if (table.rows.length > MAX_ROWS) {
		return {
			ok: false,
			step: {
				step: "upload",
				formError: `The limit is ${MAX_ROWS} rows per import.`,
			},
		};
	}
	const mapping = readMapping(form, table.headers.length);
	const error = mappingError(mapping);
	if (error) {
		return {
			ok: false,
			step: {
				step: "map",
				headers: table.headers,
				preview: table.rows.slice(0, 3),
				rowCount: table.rows.length,
				csvB64,
				guesses: mapping,
				formError: error,
			},
		};
	}
	return { ok: true, rows: table.rows, csvB64, mapping };
}

export function base64Utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export function utf8FromBase64(value: string): string {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

/**
 * `linked` only ever happens on an organization-wide import: the email already
 * belongs to someone in the directory, so the row joins them to the target
 * event instead of inventing a second person.
 */
export type RowOutcome = "added" | "linked" | "merged" | "skipped";

export interface RowResult {
	row: number;
	name: string;
	email: string;
	outcome: RowOutcome;
	reason: string;
}

export interface ProbableDuplicate {
	row: number;
	name: string;
	email: string;
	existingEmail: string;
}

export const OUTCOME_TONE = {
	added: "success",
	linked: "info",
	merged: "info",
	skipped: "caution",
} as const;

export const PARTIAL_FAILURE_ERROR =
	"The import stopped partway on a database error — the rows below show exactly what was and wasn't written.";

/** The four screens of the importer, and the state each one needs. */
export interface UploadStep {
	step: "upload";
	formError?: string;
}

export interface MapStep {
	step: "map";
	headers: string[];
	preview: string[][];
	rowCount: number;
	csvB64: string;
	guesses: ImportMapping;
	formError?: string;
}

export interface ReviewStep {
	step: "review";
	csvB64: string;
	mapping: ImportMapping;
	probableDuplicates: ProbableDuplicate[];
}

export interface DoneStep {
	step: "done";
	added: number;
	linked: number;
	merged: number;
	skipped: number;
	results: RowResult[];
	formError?: string;
}

export type ImportStep = UploadStep | MapStep | ReviewStep | DoneStep;

export function countOutcomes(results: readonly RowResult[]) {
	const of = (outcome: RowOutcome) =>
		results.filter((r) => r.outcome === outcome).length;
	return {
		added: of("added"),
		linked: of("linked"),
		merged: of("merged"),
		skipped: of("skipped"),
	};
}
