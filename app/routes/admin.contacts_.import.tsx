import { eq } from "drizzle-orm";
import { data, Form } from "react-router";
import { z } from "zod";
import { type Db, getDb } from "~/db";
import { contacts } from "~/db/schema";
import { isContactStatus, splitFullName } from "~/domain/contacts";
import { getActiveEvent, normalizeEmail, requireAdmin } from "~/lib/auth";
import { parseCsv } from "~/lib/csv";
import { errorMessage } from "~/lib/errors";
import { normalizeXUrl } from "~/lib/social";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.contacts_.import";

const MAX_ROWS = 1000;
const MAX_BYTES = 1_000_000;

const IMPORT_FIELDS = [
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

type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

/** The mapped columns that copy straight onto contact profile fields.
 * Email (the dedupe key), status (enum-checked), and the name columns
 * (split-derived per row so a full-name column never lands whole in
 * first_name) are handled explicitly instead. */
const PROFILE_KEYS = [
	"jobTitle",
	"companyName",
	"mobilePhone",
	"bio",
	"logisticsNotes",
	"linkedinUrl",
	"twitterUrl",
	"websiteUrl",
] as const satisfies readonly ImportFieldKey[];

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

function base64Utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function utf8FromBase64(value: string): string {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

// Same validator the add/edit forms use — a CSV row and the add-speaker form
// must never disagree on what counts as a valid email.
const EmailShape = z.email();

type RowOutcome = "added" | "merged" | "skipped";
interface RowResult {
	row: number;
	name: string;
	email: string;
	outcome: RowOutcome;
	reason: string;
}

type ActionResult =
	| { step: "upload"; formError: string }
	| {
			step: "map";
			headers: string[];
			preview: string[][];
			rowCount: number;
			csvB64: string;
			guesses: Record<ImportFieldKey, number | null>;
			formError?: string;
	  }
	| {
			step: "done";
			added: number;
			merged: number;
			skipped: number;
			results: RowResult[];
			formError?: string;
	  };

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	return { eventName: event?.name ?? null };
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<
	ActionResult | ReturnType<typeof data<ActionResult>>
> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event)
		return { step: "upload", formError: "No event is configured yet." };
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "upload");

	if (intent === "upload") {
		const file = form.get("file");
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
		const guesses = Object.fromEntries(
			IMPORT_FIELDS.map((f) => [f.key, guessColumn(table.headers, f.key)]),
		) as Record<ImportFieldKey, number | null>;
		// Split columns win over a bare "name" column: guessing both would trip
		// the full-name/split-name exclusivity check on untouched defaults.
		if (guesses.firstName !== null || guesses.lastName !== null) {
			guesses.fullName = null;
		}
		return {
			step: "map",
			headers: table.headers,
			preview: table.rows.slice(0, 3),
			rowCount: table.rows.length,
			csvB64: base64Utf8(text),
			guesses,
		};
	}

	const csvB64 = String(form.get("csvB64") ?? "");
	if (!csvB64) return { step: "upload", formError: "Upload a CSV file first." };
	const table = parseCsv(utf8FromBase64(csvB64));
	if (table.rows.length > MAX_ROWS) {
		return {
			step: "upload",
			formError: `The limit is ${MAX_ROWS} rows per import.`,
		};
	}
	const mapping = {} as Record<ImportFieldKey, number | null>;
	for (const field of IMPORT_FIELDS) {
		const raw = String(form.get(`map_${field.key}`) ?? "");
		const idx = raw === "" ? null : Number(raw);
		mapping[field.key] =
			idx !== null &&
			Number.isInteger(idx) &&
			idx >= 0 &&
			idx < table.headers.length
				? idx
				: null;
	}
	const remap = (formError: string): ActionResult => ({
		step: "map",
		headers: table.headers,
		preview: table.rows.slice(0, 3),
		rowCount: table.rows.length,
		csvB64,
		guesses: mapping,
		formError,
	});
	if (mapping.email === null)
		return remap("Map the Email column — it's how duplicates are detected.");
	const hasSplitName = mapping.firstName !== null || mapping.lastName !== null;
	if (mapping.fullName !== null && hasSplitName) {
		return remap(
			"Map either the full-name column or the separate first/last columns — not both.",
		);
	}
	if (mapping.fullName === null && !hasSplitName) {
		return remap(
			"Map a name column — first name, last name, or a single full-name column.",
		);
	}

	const cell = (row: string[], key: ImportFieldKey): string => {
		const idx = mapping[key];
		return idx === null ? "" : (row[idx] ?? "").trim();
	};

	const timings = createTimings();
	const existing = await timings.time("db", () =>
		db.select().from(contacts).where(eq(contacts.eventId, event.id)),
	);
	const byEmail = new Map(existing.map((c) => [normalizeEmail(c.email), c]));

	const results: RowResult[] = [];
	const seen = new Map<string, number>();
	type BatchStatement = Parameters<Db["batch"]>[0][number];
	const writes: Array<{ rowIndex: number; statement: BatchStatement }> = [];

	for (let i = 0; i < table.rows.length; i += 1) {
		const row = table.rows[i] ?? [];
		const rowNum = i + 2; // header is row 1
		const rawEmail = cell(row, "email");
		const fullName = cell(row, "fullName");
		const split = fullName ? splitFullName(fullName) : null;
		const firstName = split ? split.firstName : cell(row, "firstName");
		const lastName = split ? split.lastName : cell(row, "lastName");
		const name = `${firstName} ${lastName}`.trim();
		const base = { row: rowNum, name, email: rawEmail };

		if (!rawEmail) {
			results.push({ ...base, outcome: "skipped", reason: "No email address" });
			continue;
		}
		const email = normalizeEmail(rawEmail);
		if (!EmailShape.safeParse(email).success) {
			results.push({
				...base,
				outcome: "skipped",
				reason: "Invalid email address",
			});
			continue;
		}
		const dupOf = seen.get(email);
		if (dupOf !== undefined) {
			results.push({
				...base,
				outcome: "skipped",
				reason: `Duplicate of row ${dupOf} in this file (same email)`,
			});
			continue;
		}
		seen.set(email, rowNum);

		const statusRaw = cell(row, "status").toLowerCase();
		const status = isContactStatus(statusRaw) ? statusRaw : null;
		const statusNote =
			statusRaw && !status ? ` (unknown status "${statusRaw}" ignored)` : "";

		const values: Partial<Record<(typeof PROFILE_KEYS)[number], string>> = {};
		for (const key of PROFILE_KEYS) {
			const v = cell(row, key);
			if (!v) continue;
			// CSVs usually carry @handles in the X column — canonicalize like
			// every other write path; keep unrecognizable values verbatim.
			values[key] = key === "twitterUrl" ? (normalizeXUrl(v) ?? v) : v;
		}

		const match = byEmail.get(email);
		if (match) {
			// Only genuine differences count as changes, so "the file had nothing
			// new" stays true for a re-import of the same file. Names always merge
			// as the SPLIT halves — a full-name cell must never land whole in
			// first_name on top of an existing contact.
			const changes: Partial<typeof contacts.$inferInsert> = {};
			for (const key of PROFILE_KEYS) {
				const v = values[key];
				if (v !== undefined && v !== match[key]) changes[key] = v;
			}
			if (firstName && firstName !== match.firstName)
				changes.firstName = firstName;
			if (lastName && lastName !== match.lastName) changes.lastName = lastName;
			if (status && status !== match.status) changes.status = status;
			const hasChanges = Object.keys(changes).length > 0;
			if (hasChanges) {
				writes.push({
					rowIndex: results.length,
					statement: db
						.update(contacts)
						.set(changes)
						.where(eq(contacts.id, match.id)),
				});
			}
			results.push({
				...base,
				name: name || `${match.firstName} ${match.lastName}`.trim(),
				outcome: "merged",
				reason: hasChanges
					? `Merged into the existing contact with this email${statusNote}`
					: `Already exists with this email — the file had nothing new${statusNote}`,
			});
			continue;
		}
		if (!firstName && !lastName) {
			results.push({ ...base, outcome: "skipped", reason: "Missing a name" });
			continue;
		}
		writes.push({
			rowIndex: results.length,
			statement: db.insert(contacts).values({
				...values,
				eventId: event.id,
				email,
				firstName,
				lastName,
				status: status ?? "pending",
			}),
		});
		results.push({
			...base,
			outcome: "added",
			reason: `New contact${statusNote}`,
		});
	}

	let formError: string | undefined;
	const CHUNK = 50;
	for (let i = 0; i < writes.length; i += CHUNK) {
		const chunk = writes.slice(i, i + CHUNK);
		try {
			const [head, ...rest] = chunk.map((w) => w.statement);
			if (head)
				await timings.time(`write${i / CHUNK}`, () =>
					db.batch([head, ...rest]),
				);
		} catch (error) {
			// Nothing silent: every row past the failure point is reported as not written.
			for (const w of writes.slice(i)) {
				const r = results[w.rowIndex];
				if (r) {
					r.outcome = "skipped";
					r.reason = "Not written — the import stopped on a database error";
				}
			}
			formError =
				"The import stopped partway on a database error — the rows below show exactly what was and wasn't written.";
			track("contacts.import_failed", {
				eventId: event.id,
				error: errorMessage(error),
			});
			break;
		}
	}

	const added = results.filter((r) => r.outcome === "added").length;
	const merged = results.filter((r) => r.outcome === "merged").length;
	const skipped = results.filter((r) => r.outcome === "skipped").length;
	track("contacts.imported", { eventId: event.id, added, merged, skipped });
	return data<ActionResult>(
		{ step: "done", added, merged, skipped, results, formError },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

const OUTCOME_TONE = {
	added: "success",
	merged: "info",
	skipped: "caution",
} as const;

export default function ImportContacts({ actionData }: Route.ComponentProps) {
	const state = actionData;
	// One import can write hundreds of rows — a double-click must never run it
	// twice, so both step buttons disable while the submission is in flight.
	const busy = useBusy();

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Import speakers from CSV"
				subtitle="The migration path off Sessionboard: upload an export, map its columns, and every row is accounted for — added, merged, or skipped with a reason."
				actions={
					<ButtonLink to="/admin/contacts" variant="ghost">
						Back to speakers
					</ButtonLink>
				}
			/>

			{(!state || state.step === "upload") && (
				<Panel>
					<Form
						method="post"
						encType="multipart/form-data"
						className="flex flex-col gap-3"
					>
						<Field label="CSV file">
							<Input type="file" name="file" accept=".csv,text/csv" />
						</Field>
						<p>
							Up to {MAX_ROWS} rows and 1 MB per import. The first row must be
							column headers (name, email, company…) — you will map them to
							contact fields next, so any column order works.
						</p>
						<div className="flex items-center gap-3">
							<Button
								type="submit"
								name="intent"
								value="upload"
								icon="export"
								disabled={busy}
							>
								{busy ? "Uploading…" : "Upload and map columns"}
							</Button>
							{state?.formError && (
								<div role="alert">
									<ErrorText>{state.formError}</ErrorText>
								</div>
							)}
						</div>
					</Form>
				</Panel>
			)}

			{state?.step === "map" && (
				<Form method="post" className="flex flex-col gap-5">
					<Input type="hidden" name="csvB64" value={state.csvB64} readOnly />
					<Panel>
						<div className="flex flex-col gap-3">
							<strong>Map columns — {state.rowCount} data rows detected</strong>
							<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
								{IMPORT_FIELDS.map((f) => (
									<Field
										key={f.key}
										label={f.required ? `${f.label} (required)` : f.label}
									>
										<Select
											name={`map_${f.key}`}
											defaultValue={
												state.guesses[f.key] === null
													? ""
													: String(state.guesses[f.key])
											}
										>
											<option value="">— skip —</option>
											{state.headers.map((h, idx) => (
												<option key={`${idx}-${h}`} value={idx}>
													{h || `Column ${idx + 1}`}
												</option>
											))}
										</Select>
									</Field>
								))}
							</div>
							<div className="flex items-center gap-3">
								<Button
									type="submit"
									name="intent"
									value="import"
									disabled={busy}
								>
									{busy ? "Importing…" : `Import ${state.rowCount} rows`}
								</Button>
								<ButtonLink to="/admin/contacts/import" variant="ghost">
									Start over
								</ButtonLink>
								{state.formError && (
									<div role="alert">
										<ErrorText>{state.formError}</ErrorText>
									</div>
								)}
							</div>
						</div>
					</Panel>

					<Table>
						<THead>
							{state.headers.map((h, idx) => (
								<Th key={`${idx}-${h}`}>{h || `Column ${idx + 1}`}</Th>
							))}
						</THead>
						<TBody>
							{state.preview.map((row, i) => (
								<Tr key={`preview-${i + 1}`}>
									{row.map((value, j) => (
										<Td key={`cell-${i + 1}-${j + 1}`}>
											{value.length > 40 ? `${value.slice(0, 40)}…` : value}
										</Td>
									))}
								</Tr>
							))}
						</TBody>
					</Table>
				</Form>
			)}

			{state?.step === "done" && (
				<>
					<Panel>
						<div className="flex flex-col gap-2">
							<strong>Import complete</strong>
							<div className="flex items-center gap-4">
								<StatusBadge tone="success">{state.added} added</StatusBadge>
								<StatusBadge tone="info">
									{state.merged} merged by email
								</StatusBadge>
								<StatusBadge tone="caution">
									{state.skipped} skipped
								</StatusBadge>
							</div>
							{state.formError && (
								<div role="alert">
									<ErrorText>{state.formError}</ErrorText>
								</div>
							)}
							<div className="flex items-center gap-2">
								<ButtonLink to="/admin/contacts">View the roster</ButtonLink>
								<ButtonLink to="/admin/contacts/import" variant="ghost">
									Import another file
								</ButtonLink>
							</div>
						</div>
					</Panel>

					<Table>
						<THead>
							<Th>Row</Th>
							<Th>Name</Th>
							<Th>Email</Th>
							<Th>Outcome</Th>
							<Th>Reason</Th>
						</THead>
						<TBody>
							{state.results.map((r) => (
								<Tr key={r.row}>
									<Td kind="mono">{r.row}</Td>
									<Td kind="strong">{r.name || "—"}</Td>
									<Td kind="mono">{r.email || "—"}</Td>
									<Td>
										<StatusBadge tone={OUTCOME_TONE[r.outcome]}>
											{r.outcome}
										</StatusBadge>
									</Td>
									<Td>{r.reason}</Td>
								</Tr>
							))}
							{state.results.length === 0 && (
								<EmptyRow colSpan={5}>The file had no data rows.</EmptyRow>
							)}
						</TBody>
					</Table>
				</>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Import failed"
				tone="danger"
				subtitle="Something went wrong reading that file. Please try again."
			/>
			<div className="mt-4">
				<ButtonLink to="/admin/contacts/import" variant="ghost">
					Try again
				</ButtonLink>
			</div>
		</div>
	);
}
