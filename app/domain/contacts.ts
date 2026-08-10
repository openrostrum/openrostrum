import {
	and,
	type AnyColumn,
	asc,
	eq,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "~/db";
import { CONTACT_STATUS } from "~/db/constants";
import { contacts } from "~/db/schema";

export type ContactStatus = (typeof CONTACT_STATUS)[number];

export function isContactStatus(value: unknown): value is ContactStatus {
	return (
		typeof value === "string" &&
		(CONTACT_STATUS as readonly string[]).includes(value)
	);
}

/** Escape LIKE wildcards so a user searching "100%" matches literally. */
function likeContains(column: AnyColumn | SQL, q: string): SQL {
	const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
	return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/**
 * The one roster predicate — list, tab counts, and compose recipient
 * resolution all filter through this so "who matches" can never diverge
 * between the roster a user sees and the recipients a bulk send targets.
 */
export function contactFilter(
	eventId: string,
	{ q, status }: { q?: string | null; status?: ContactStatus | null },
): SQL {
	const conditions: SQL[] = [eq(contacts.eventId, eventId)];
	if (status) conditions.push(eq(contacts.status, status));
	const needle = q?.trim();
	if (needle) {
		const match = or(
			likeContains(contacts.firstName, needle),
			likeContains(contacts.lastName, needle),
			likeContains(contacts.email, needle),
			likeContains(contacts.companyName, needle),
			likeContains(contacts.jobTitle, needle),
			likeContains(
				sql`(${contacts.firstName} || ' ' || ${contacts.lastName})`,
				needle,
			),
		);
		if (match) conditions.push(match);
	}
	return and(...conditions) as SQL;
}

export interface RecipientSelection {
	ids?: string[];
	q?: string | null;
	status?: ContactStatus | null;
}

/** Resolve a compose target set (explicit ids, or the roster filter), scoped to the event. */
export async function resolveRecipients(
	db: Db,
	eventId: string,
	selection: RecipientSelection,
): Promise<Array<typeof contacts.$inferSelect>> {
	const where =
		selection.ids && selection.ids.length > 0
			? and(eq(contacts.eventId, eventId), inArray(contacts.id, selection.ids))
			: contactFilter(eventId, selection);
	return db
		.select()
		.from(contacts)
		.where(where)
		.orderBy(asc(contacts.lastName), asc(contacts.firstName));
}
