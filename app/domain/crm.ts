import {
	and,
	type AnyColumn,
	count,
	desc,
	eq,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "~/db";
import { CONTACT_STATUS, PIPELINE_STAGE } from "~/db/constants";
import {
	contacts,
	crmNotes,
	events,
	organizationMembers,
	organizations,
	pipelineCards,
	pipelineStageChanges,
	users,
} from "~/db/schema";
import { getActiveEvent } from "~/lib/auth";
import { isUniqueViolation } from "~/lib/errors";

export type PipelineStage = (typeof PIPELINE_STAGE)[number];
export type CrmContactStatus = (typeof CONTACT_STATUS)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
	return (
		typeof value === "string" &&
		(PIPELINE_STAGE as readonly string[]).includes(value)
	);
}

export function isCrmContactStatus(value: unknown): value is CrmContactStatus {
	return (
		typeof value === "string" &&
		(CONTACT_STATUS as readonly string[]).includes(value)
	);
}

type Org = typeof organizations.$inferSelect;
type AppUser = typeof users.$inferSelect;

/**
 * The organization a CRM surface operates on: the active event's org when one
 * is set (getActiveEvent is the membership chokepoint — it only returns the
 * caller's orgs' events), else the user's first membership (an org can
 * predate its first event). Null = the user belongs to no organization.
 */
export async function resolveCrmOrg(
	env: Env,
	db: Db,
	user: AppUser,
): Promise<Org | null> {
	const event = await getActiveEvent(env, user);
	if (event) {
		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.id, event.organizationId))
			.limit(1);
		if (org) return org;
	}
	const [first] = await db
		.select({ org: organizations })
		.from(organizationMembers)
		.innerJoin(
			organizations,
			eq(organizations.id, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, user.id))
		.orderBy(organizationMembers.createdAt)
		.limit(1);
	return first?.org ?? null;
}

/* -------------------------------------------------------------- directory --- */

export interface DirectoryFilters {
	q?: string | null;
	company?: string | null;
	title?: string | null;
	eventId?: string | null;
	status?: CrmContactStatus | null;
}

export function hasDirectoryFilters(f: DirectoryFilters): boolean {
	return Boolean(f.q || f.company || f.title || f.eventId || f.status);
}

/** The person key: contacts are per-event, a directory person is the union of
 * the org's appearances sharing a lowercased email. */
const personEmail = sql<string>`lower(${contacts.email})`;
const personName = sql<string>`lower(trim(${contacts.firstName}) || ' ' || trim(${contacts.lastName}))`;

/** Escape LIKE wildcards so a user searching "100%" matches literally. */
function likeContains(column: AnyColumn | SQL, q: string): SQL {
	const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
	return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/**
 * Appearance-level predicate: a person matches when at least ONE of their
 * event appearances satisfies every criterion (single-appearance AND
 * semantics — "company=Acme, event=X" means they appeared at X as Acme).
 * Every consumer of the directory filters goes through this, so the list, the
 * counts, and segment membership can never diverge.
 */
function appearanceMatch(orgId: string, f: DirectoryFilters): SQL {
	const conditions: SQL[] = [eq(events.organizationId, orgId)];
	const needle = f.q?.trim();
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
	const company = f.company?.trim();
	if (company) conditions.push(likeContains(contacts.companyName, company));
	const title = f.title?.trim();
	if (title) conditions.push(likeContains(contacts.jobTitle, title));
	if (f.eventId) conditions.push(eq(contacts.eventId, f.eventId));
	if (f.status) conditions.push(eq(contacts.status, f.status));
	return and(...conditions) as SQL;
}

function matchingEmails(db: Db, orgId: string, f: DirectoryFilters) {
	return db
		.selectDistinct({ email: personEmail })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(appearanceMatch(orgId, f));
}

/** Distinct people matching the filters — pagination totals, segment counts,
 * and the dashboard KPI all share this. */
export async function countDirectory(
	db: Db,
	orgId: string,
	f: DirectoryFilters,
): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(matchingEmails(db, orgId, f).as("matches"));
	return row?.n ?? 0;
}

export interface DirectoryAppearance {
	contactId: string;
	eventId: string;
	eventName: string;
	status: CrmContactStatus;
	sessionCount: number;
}

export interface DirectoryPerson {
	email: string;
	firstName: string;
	lastName: string;
	jobTitle: string | null;
	companyName: string | null;
	appearances: DirectoryAppearance[];
	possibleDuplicate: boolean;
}

type AppearanceRow = {
	contactId: string;
	email: string;
	firstName: string;
	lastName: string;
	jobTitle: string | null;
	companyName: string | null;
	bio: string | null;
	status: CrmContactStatus;
	eventId: string;
	eventName: string;
	sessionCount: number;
};

/** Every appearance for the given person emails, newest contact row first —
 * the first row per email is the identity the directory presents. */
function appearancesFor(db: Db, orgId: string, emails: string[]) {
	return db
		.select({
			contactId: contacts.id,
			email: personEmail,
			firstName: contacts.firstName,
			lastName: contacts.lastName,
			jobTitle: contacts.jobTitle,
			companyName: contacts.companyName,
			bio: contacts.bio,
			status: contacts.status,
			eventId: contacts.eventId,
			eventName: events.name,
			sessionCount: sql<number>`(
				SELECT COUNT(*) FROM participants
				WHERE participants.contact_id = ${contacts.id}
			)`,
		})
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(and(eq(events.organizationId, orgId), inArray(personEmail, emails)))
		.orderBy(desc(contacts.createdAt), desc(contacts.id));
}

function composePeople(
	rows: AppearanceRow[],
	orderedEmails: string[],
	duplicateNames: ReadonlySet<string>,
): DirectoryPerson[] {
	const byEmail = new Map<string, DirectoryPerson>();
	for (const row of rows) {
		let person = byEmail.get(row.email);
		if (!person) {
			person = {
				email: row.email,
				firstName: row.firstName,
				lastName: row.lastName,
				jobTitle: row.jobTitle,
				companyName: row.companyName,
				appearances: [],
				possibleDuplicate: duplicateNames.has(
					normalizedPersonName(row.firstName, row.lastName),
				),
			};
			byEmail.set(row.email, person);
		}
		person.appearances.push({
			contactId: row.contactId,
			eventId: row.eventId,
			eventName: row.eventName,
			status: row.status,
			sessionCount: row.sessionCount,
		});
	}
	return orderedEmails.flatMap((email) => byEmail.get(email) ?? []);
}

function normalizedPersonName(firstName: string, lastName: string): string {
	return `${firstName.trim()} ${lastName.trim()}`.toLowerCase();
}

/** Names (of the given normalized set) that more than one distinct email in
 * the org carries — the "possible duplicate" surface. */
async function duplicateNamesAmong(
	db: Db,
	orgId: string,
	names: string[],
): Promise<Set<string>> {
	if (names.length === 0) return new Set();
	const rows = await db
		.select({ name: personName })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(and(eq(events.organizationId, orgId), inArray(personName, names)))
		.groupBy(personName)
		.having(sql`count(distinct lower(${contacts.email})) > 1`);
	return new Set(rows.map((r) => r.name));
}

/** One page of directory people, ordered by surname. Callers pair this with
 * `countDirectory` (and clamp the page against it) — this never re-counts. */
export async function queryDirectoryPage(
	db: Db,
	orgId: string,
	f: DirectoryFilters,
	page: number,
	perPage: number,
): Promise<DirectoryPerson[]> {
	const pageRows = await db
		.select({ email: personEmail })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(
			and(
				eq(events.organizationId, orgId),
				inArray(personEmail, matchingEmails(db, orgId, f)),
			),
		)
		.groupBy(personEmail)
		.orderBy(
			sql`min(lower(${contacts.lastName}))`,
			sql`min(lower(${contacts.firstName}))`,
			personEmail,
		)
		.limit(perPage)
		.offset((page - 1) * perPage);
	const emails = pageRows.map((r) => r.email);
	if (emails.length === 0) return [];
	const rows = await appearancesFor(db, orgId, emails);
	const duplicates = await duplicateNamesAmong(db, orgId, [
		...new Set(rows.map((r) => normalizedPersonName(r.firstName, r.lastName))),
	]);
	return composePeople(rows, emails, duplicates);
}

export interface PersonProfile extends DirectoryPerson {
	bio: string | null;
	/** Other directory people carrying the same name — the duplicate surface. */
	sameNamePeople: Array<{ email: string; firstName: string; lastName: string }>;
}

export async function queryPerson(
	db: Db,
	orgId: string,
	email: string,
): Promise<PersonProfile | null> {
	const rows = await appearancesFor(db, orgId, [email]);
	const latest = rows[0];
	if (!latest) return null;
	const name = normalizedPersonName(latest.firstName, latest.lastName);
	const sameName = await db
		.select({
			email: personEmail,
			firstName: sql<string>`min(${contacts.firstName})`,
			lastName: sql<string>`min(${contacts.lastName})`,
		})
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(
			and(
				eq(events.organizationId, orgId),
				eq(personName, name),
				sql`${personEmail} <> ${email}`,
			),
		)
		.groupBy(personEmail)
		.limit(10);
	const [person] = composePeople(rows, [email], new Set());
	if (!person) return null;
	return {
		...person,
		bio: latest.bio,
		possibleDuplicate: sameName.length > 0,
		sameNamePeople: sameName,
	};
}

/* ------------------------------------------------------------------ notes --- */

export interface CrmNote {
	id: string;
	authorName: string;
	body: string;
	createdAt: Date;
}

/** The person's internal-note thread (newest first, capped) + its true total. */
export async function queryNotes(
	db: Db,
	orgId: string,
	email: string,
	limit: number,
): Promise<{ notes: CrmNote[]; total: number }> {
	const where = and(
		eq(crmNotes.organizationId, orgId),
		eq(crmNotes.email, email),
	);
	const [notes, [totalRow]] = await Promise.all([
		db
			.select({
				id: crmNotes.id,
				authorName: crmNotes.authorName,
				body: crmNotes.body,
				createdAt: crmNotes.createdAt,
			})
			.from(crmNotes)
			.where(where)
			.orderBy(desc(crmNotes.createdAt))
			.limit(limit),
		db.select({ n: count() }).from(crmNotes).where(where),
	]);
	return { notes, total: totalRow?.n ?? 0 };
}

/* ----------------------------------------------------------- add to event --- */

export type AddToEventResult = "added" | "already" | "missing";

/**
 * Push a directory person into an event as a contact: copies the latest
 * appearance's profile fields; idempotent — an existing contact with that
 * email is reported, never duplicated. The caller MUST have verified the
 * target event belongs to the org.
 */
export async function addPersonToEvent(
	db: Db,
	orgId: string,
	email: string,
	targetEventId: string,
): Promise<AddToEventResult> {
	const [src] = await db
		.select({ contact: contacts })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(and(eq(events.organizationId, orgId), eq(personEmail, email)))
		.orderBy(desc(contacts.createdAt), desc(contacts.id))
		.limit(1);
	if (!src) return "missing";
	const [existing] = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(and(eq(contacts.eventId, targetEventId), eq(personEmail, email)))
		.limit(1);
	if (existing) return "already";
	const c = src.contact;
	try {
		await db.insert(contacts).values({
			eventId: targetEventId,
			userId: c.userId,
			email,
			firstName: c.firstName,
			lastName: c.lastName,
			salutation: c.salutation,
			honorific: c.honorific,
			pronouns: c.pronouns,
			gender: c.gender,
			jobTitle: c.jobTitle,
			companyName: c.companyName,
			mobilePhone: c.mobilePhone,
			homePhone: c.homePhone,
			zip: c.zip,
			bio: c.bio,
			// Headshot objects are content-addressed-ish (a new upload mints a new
			// key, nothing deletes old ones) so sharing the key across events is safe.
			headshotKey: c.headshotKey,
			linkedinUrl: c.linkedinUrl,
			twitterUrl: c.twitterUrl,
			facebookUrl: c.facebookUrl,
			websiteUrl: c.websiteUrl,
			// Workflow state and travel notes are per-event — never carried over.
			status: "pending",
		});
	} catch (error) {
		if (isUniqueViolation(error)) return "already";
		throw error;
	}
	return "added";
}

/* --------------------------------------------------------------- pipeline --- */

export type PipelineActionResult =
	| { ok: true; cardId: string }
	| { ok: false; reason: string };

export async function enrollInPipeline(
	db: Db,
	orgId: string,
	input: {
		email: string;
		stage: PipelineStage;
		score: number | null;
		rationale: string | null;
		actor: { id: string; name: string };
	},
): Promise<PipelineActionResult> {
	const [src] = await db
		.select({
			firstName: contacts.firstName,
			lastName: contacts.lastName,
			companyName: contacts.companyName,
		})
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(and(eq(events.organizationId, orgId), eq(personEmail, input.email)))
		.orderBy(desc(contacts.createdAt), desc(contacts.id))
		.limit(1);
	if (!src) {
		return {
			ok: false,
			reason:
				"No contact with this email exists in your organization — add them to an event first.",
		};
	}
	const cardId = crypto.randomUUID();
	try {
		await db.batch([
			db.insert(pipelineCards).values({
				id: cardId,
				organizationId: orgId,
				email: input.email,
				firstName: src.firstName,
				lastName: src.lastName,
				companyName: src.companyName,
				stage: input.stage,
				score: input.score,
				rationale: input.rationale,
			}),
			db.insert(pipelineStageChanges).values({
				cardId,
				fromStage: null,
				toStage: input.stage,
				changedById: input.actor.id,
				changedByName: input.actor.name,
			}),
		]);
	} catch (error) {
		if (isUniqueViolation(error)) {
			return { ok: false, reason: "Already in the pipeline." };
		}
		throw error;
	}
	return { ok: true, cardId };
}

/** Move a card to another stage, appending the transition to its history.
 * Cards outside the caller's org never resolve, so they can't be moved. */
export async function movePipelineCard(
	db: Db,
	orgId: string,
	cardId: string,
	toStage: PipelineStage,
	actor: { id: string; name: string },
): Promise<PipelineActionResult> {
	const [card] = await db
		.select({ id: pipelineCards.id, stage: pipelineCards.stage })
		.from(pipelineCards)
		.where(
			and(
				eq(pipelineCards.id, cardId),
				eq(pipelineCards.organizationId, orgId),
			),
		)
		.limit(1);
	if (!card) {
		return { ok: false, reason: "That card is not in your pipeline." };
	}
	if (card.stage === toStage) return { ok: true, cardId };
	await db.batch([
		db
			.update(pipelineCards)
			.set({ stage: toStage })
			.where(eq(pipelineCards.id, cardId)),
		db.insert(pipelineStageChanges).values({
			cardId,
			fromStage: card.stage,
			toStage,
			changedById: actor.id,
			changedByName: actor.name,
		}),
	]);
	return { ok: true, cardId };
}

/* -------------------------------------------------------------- dashboard --- */

export interface CrmDashboard {
	people: number;
	eventCount: number;
	returningSpeakers: number;
	inPipeline: number;
	byStage: Array<{ stage: PipelineStage; n: number }>;
	topEvents: Array<{ eventId: string; name: string; contacts: number }>;
	topCompanies: Array<{ companyName: string; people: number }>;
	recentPeople: Array<{
		email: string;
		firstName: string;
		lastName: string;
		firstSeenAt: Date;
	}>;
}

export async function queryCrmDashboard(
	db: Db,
	orgId: string,
): Promise<CrmDashboard> {
	const orgContacts = () =>
		db
			.select({ email: personEmail })
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(eq(events.organizationId, orgId));

	const [
		people,
		[eventCountRow],
		[returningRow],
		stageRows,
		topEvents,
		topCompanies,
		recentEmails,
	] = await Promise.all([
		countDirectory(db, orgId, {}),
		db
			.select({ n: count() })
			.from(events)
			.where(eq(events.organizationId, orgId)),
		db
			.select({ n: count() })
			.from(
				orgContacts()
					.groupBy(personEmail)
					.having(sql`count(distinct ${contacts.eventId}) >= 2`)
					.as("returning_people"),
			),
		db
			.select({ stage: pipelineCards.stage, n: count() })
			.from(pipelineCards)
			.where(eq(pipelineCards.organizationId, orgId))
			.groupBy(pipelineCards.stage),
		db
			.select({
				eventId: events.id,
				name: events.name,
				contacts: count(contacts.id),
			})
			.from(events)
			.innerJoin(contacts, eq(contacts.eventId, events.id))
			.where(eq(events.organizationId, orgId))
			.groupBy(events.id)
			.orderBy(desc(count(contacts.id)))
			.limit(5),
		db
			.select({
				// The where clause excludes null/blank companies, so the projection
				// is non-null; sql<string> carries that into the type.
				companyName: sql<string>`${contacts.companyName}`,
				people: sql<number>`count(distinct ${personEmail})`,
			})
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(
				and(
					eq(events.organizationId, orgId),
					sql`coalesce(trim(${contacts.companyName}), '') <> ''`,
				),
			)
			.groupBy(contacts.companyName)
			.orderBy(desc(sql`count(distinct ${personEmail})`))
			.limit(5),
		db
			.select({
				email: personEmail,
				firstSeenAt: sql<number>`min(${contacts.createdAt})`,
			})
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(eq(events.organizationId, orgId))
			.groupBy(personEmail)
			.orderBy(desc(sql`min(${contacts.createdAt})`))
			.limit(5),
	]);

	const stageCount = new Map(stageRows.map((r) => [r.stage, r.n]));
	const byStage = PIPELINE_STAGE.map((stage) => ({
		stage,
		n: stageCount.get(stage) ?? 0,
	}));

	let recentPeople: CrmDashboard["recentPeople"] = [];
	if (recentEmails.length > 0) {
		const identityRows = await appearancesFor(
			db,
			orgId,
			recentEmails.map((r) => r.email),
		);
		const identity = new Map<string, AppearanceRow>();
		for (const row of identityRows) {
			if (!identity.has(row.email)) identity.set(row.email, row);
		}
		recentPeople = recentEmails.flatMap((r) => {
			const row = identity.get(r.email);
			return row
				? {
						email: r.email,
						firstName: row.firstName,
						lastName: row.lastName,
						firstSeenAt: new Date(r.firstSeenAt * 1000),
					}
				: [];
		});
	}

	return {
		people,
		eventCount: eventCountRow?.n ?? 0,
		returningSpeakers: returningRow?.n ?? 0,
		inPipeline: byStage.reduce((sum, s) => sum + s.n, 0),
		byStage,
		topEvents,
		topCompanies,
		recentPeople,
	};
}
