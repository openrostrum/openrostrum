import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/db";
import { contacts, events } from "~/db/schema";
import {
	carriedProfile,
	contactStatus,
	probableContactDuplicateKey,
	splitFullName,
} from "~/domain/contacts";
import { normalizeEmail } from "~/lib/auth";
import {
	type ImportFieldKey,
	type ImportMapping,
	PARTIAL_FAILURE_ERROR,
	PROFILE_KEYS,
	type ProbableDuplicate,
	type RowResult,
} from "~/lib/contact-import";
import { errorMessage } from "~/lib/errors";
import { normalizeXUrl } from "~/lib/social";
import type { createTimings } from "~/lib/track";

/**
 * The import engine: one planner and one writer behind both CSV importers. The
 * roster matches within one event, the directory across the organization, and
 * that difference is entirely the `existing` set handed to the planner — a
 * person the directory knows gains an appearance, not a duplicate identity.
 */

type Contact = typeof contacts.$inferSelect;

export interface ImportWrite {
	/** Index into `ImportPlan.results` — how a failed batch reports itself. */
	rowIndex: number;
	insert?: typeof contacts.$inferInsert;
	update?: { id: string; changes: Partial<typeof contacts.$inferInsert> };
}

export interface ImportPlan {
	results: RowResult[];
	probableDuplicates: ProbableDuplicate[];
	writes: ImportWrite[];
}

/** Every contact on one event — the roster importer's matching scope. */
export function loadEventContacts(db: Db, eventId: string): Promise<Contact[]> {
	return db.select().from(contacts).where(eq(contacts.eventId, eventId));
}

/**
 * Every contact across the organization's events — the directory importer's
 * matching scope, and the reason an org import can recognize someone it has
 * only ever met on another event. Ordered oldest-first so the planner's
 * "newest appearance is the profile" rule reads off a stable sequence.
 */
export function loadOrgContacts(db: Db, orgId: string): Promise<Contact[]> {
	return db
		.select({ contact: contacts })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(eq(events.organizationId, orgId))
		.orderBy(asc(contacts.createdAt), asc(contacts.id))
		.then((rows) => rows.map((r) => r.contact));
}

/**
 * The chosen target event, resolved ONLY through the organization — the single
 * place a directory import decides where rows land, so a posted event id from
 * another tenant resolves to null rather than to a writable event.
 */
export async function resolveTargetEvent(
	db: Db,
	orgId: string,
	eventId: string,
): Promise<{ id: string; name: string } | null> {
	if (!eventId) return null;
	const [row] = await db
		.select({ id: events.id, name: events.name })
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
		.limit(1);
	return row ?? null;
}

// Same validator the add/edit forms use — a CSV row and the add-speaker form
// must never disagree on what counts as a valid email.
const EmailShape = z.email();

/**
 * A name+company identity index. Refcounted per contributing row, not a plain
 * set: at organization scope the same person can hold the same identity on
 * several events, and a merge that changes one appearance must not erase the
 * signal the others still carry.
 */
class IdentityIndex {
	private readonly byKey = new Map<string, Map<string, number>>();

	add(key: string | null, email: string): void {
		if (!key) return;
		const emails = this.byKey.get(key) ?? new Map<string, number>();
		emails.set(email, (emails.get(email) ?? 0) + 1);
		this.byKey.set(key, emails);
	}

	remove(key: string | null, email: string): void {
		if (!key) return;
		const emails = this.byKey.get(key);
		const count = emails?.get(email);
		if (!emails || count === undefined) return;
		if (count <= 1) emails.delete(email);
		else emails.set(email, count - 1);
		if (emails.size === 0) this.byKey.delete(key);
	}

	/** Any other email already holding this identity. */
	match(key: string | null, email: string): string | undefined {
		if (!key) return undefined;
		for (const [candidate] of this.byKey.get(key) ?? []) {
			if (candidate !== email) return candidate;
		}
		return undefined;
	}
}

export function planContactImport(input: {
	rows: string[][];
	mapping: ImportMapping;
	targetEventId: string;
	targetEventName: string;
	existing: readonly Contact[];
	duplicatePolicy: "skip" | "create" | null;
}): ImportPlan {
	const { mapping, targetEventId, duplicatePolicy } = input;
	const cell = (row: string[], key: ImportFieldKey): string => {
		const idx = mapping[key];
		return idx === null ? "" : (row[idx] ?? "").trim();
	};

	// On the target event a row is a merge target; anywhere else in the scope it
	// is a directory identity to link to, newest appearance winning (the same
	// rule the person profile uses to decide which appearance is "the profile").
	const onTarget = new Map<string, Contact>();
	const elsewhere = new Map<string, Contact>();
	const identities = new IdentityIndex();
	for (const contact of input.existing) {
		const email = normalizeEmail(contact.email);
		if (contact.eventId === targetEventId) onTarget.set(email, contact);
		else elsewhere.set(email, contact);
		identities.add(probableContactDuplicateKey(contact), email);
	}

	const results: RowResult[] = [];
	const probableDuplicates: ProbableDuplicate[] = [];
	const writes: ImportWrite[] = [];
	const seen = new Map<string, number>();

	for (let i = 0; i < input.rows.length; i += 1) {
		const row = input.rows[i] ?? [];
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
		const status = contactStatus.safeParse(statusRaw).data ?? null;
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

		const match = onTarget.get(email);
		if (match) {
			// Re-imports skip no-op updates; names merge only as split halves.
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
			const previousProbableKey = probableContactDuplicateKey(match);
			const nextProbableKey = probableContactDuplicateKey({
				firstName: changes.firstName ?? match.firstName,
				lastName: changes.lastName ?? match.lastName,
				companyName:
					changes.companyName !== undefined
						? changes.companyName
						: match.companyName,
			});
			if (previousProbableKey !== nextProbableKey) {
				identities.remove(previousProbableKey, email);
				identities.add(nextProbableKey, email);
			}
			if (hasChanges) {
				writes.push({
					rowIndex: results.length,
					update: { id: match.id, changes },
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

		const known = elsewhere.get(email);
		if (known) {
			// Same person, new appearance: carry their profile, let the file
			// overwrite what it maps, and start this event's workflow fresh.
			const carried = carriedProfile(known);
			const insert = {
				...carried,
				...values,
				eventId: targetEventId,
				email,
				firstName: firstName || known.firstName,
				lastName: lastName || known.lastName,
				status: status ?? "pending",
			};
			identities.add(
				probableContactDuplicateKey({
					firstName: insert.firstName,
					lastName: insert.lastName,
					companyName: insert.companyName,
				}),
				email,
			);
			writes.push({ rowIndex: results.length, insert });
			results.push({
				...base,
				name: name || `${known.firstName} ${known.lastName}`.trim(),
				outcome: "linked",
				reason: `Already in your directory — added to ${input.targetEventName} from their existing profile${statusNote}`,
			});
			// A second row for the same person in this file must merge, not stack.
			onTarget.set(email, { ...known, ...insert, id: `pending:${email}` });
			continue;
		}

		if (!firstName && !lastName) {
			results.push({ ...base, outcome: "skipped", reason: "Missing a name" });
			continue;
		}

		const probableKey = probableContactDuplicateKey({
			firstName,
			lastName,
			companyName: values.companyName,
		});
		const probableMatch = identities.match(probableKey, email);
		if (probableMatch) {
			probableDuplicates.push({ ...base, email, existingEmail: probableMatch });
			if (duplicatePolicy === "skip") {
				results.push({
					...base,
					outcome: "skipped",
					reason: `Probable duplicate — same normalized name and company as ${probableMatch}`,
				});
				continue;
			}
			if (duplicatePolicy === null) continue;
		}
		identities.add(probableKey, email);

		writes.push({
			rowIndex: results.length,
			insert: {
				...values,
				eventId: targetEventId,
				email,
				firstName,
				lastName,
				status: status ?? "pending",
			},
		});
		results.push({
			...base,
			outcome: "added",
			reason: probableMatch
				? `Created after duplicate warning${statusNote}`
				: `New contact${statusNote}`,
		});
	}

	return { results, probableDuplicates, writes };
}

const CHUNK = 50;

/**
 * Write the plan in bounded batches. A batch is a transaction, so a failure
 * loses that batch and everything after it — those rows are rewritten as
 * skipped so the summary never claims a row landed when it didn't. Returns the
 * underlying error message for tracking, or null on success.
 */
export async function executeImportWrites(
	db: Db,
	plan: ImportPlan,
	timings: ReturnType<typeof createTimings>,
): Promise<string | null> {
	type BatchStatement = Parameters<Db["batch"]>[0][number];
	const statement = (write: ImportWrite): BatchStatement => {
		if (write.update) {
			return db
				.update(contacts)
				.set(write.update.changes)
				.where(eq(contacts.id, write.update.id));
		}
		if (!write.insert) throw new Error("Import write has nothing to write.");
		return db.insert(contacts).values(write.insert);
	};

	for (let i = 0; i < plan.writes.length; i += CHUNK) {
		const chunk = plan.writes.slice(i, i + CHUNK);
		try {
			const [head, ...rest] = chunk.map(statement);
			if (head)
				await timings.time(`write${i / CHUNK}`, () =>
					db.batch([head, ...rest]),
				);
		} catch (error) {
			// Nothing silent: every row past the failure point is reported as not written.
			for (const write of plan.writes.slice(i)) {
				const result = plan.results[write.rowIndex];
				if (result) {
					result.outcome = "skipped";
					result.reason =
						"Not written — the import stopped on a database error";
				}
			}
			return errorMessage(error);
		}
	}
	return null;
}

export { PARTIAL_FAILURE_ERROR };
