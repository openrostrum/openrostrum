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
import { PIPELINE_STAGE } from "~/db/constants";
import {
	contacts,
	crmNotes,
	events,
	participants,
	pipelineCards,
	pipelineStageChanges,
} from "~/db/schema";
import type { CrmContactStatus, DirectoryFilters } from "~/lib/crm-filters";
import { isUniqueViolation } from "~/lib/errors";
import type { PipelineStage } from "~/lib/pipeline";

/* -------------------------------------------------------------- directory --- */
// The DirectoryFilters shape + its URL/segment-JSON codec live client-safe in
// ~/lib/crm-filters (route components build links from them); this module owns
// the queries.

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
	status: CrmContactStatus;
	eventId: string;
	eventName: string;
};

/** Every appearance for the given person emails, newest contact row first —
 * the first row per email is the identity the directory presents. Content-
 * sized columns (bio) and per-row aggregates (session counts) stay OUT: the
 * directory fetches up to 50 people's appearances per load, and only the
 * one-person profile renders those — it fetches them itself. */
function appearancesFor(db: Db, orgId: string, emails: string[]) {
	return db
		.select({
			contactId: contacts.id,
			email: personEmail,
			firstName: contacts.firstName,
			lastName: contacts.lastName,
			jobTitle: contacts.jobTitle,
			companyName: contacts.companyName,
			status: contacts.status,
			eventId: contacts.eventId,
			eventName: events.name,
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

const SAME_NAME_SHOWN = 10;

export interface PersonAppearance extends DirectoryAppearance {
	sessionCount: number;
}

export interface PersonProfile extends Omit<DirectoryPerson, "appearances"> {
	appearances: PersonAppearance[];
	bio: string | null;
	/** Other directory people carrying the same name — the duplicate surface. */
	sameNamePeople: Array<{ email: string; firstName: string; lastName: string }>;
	/** True count behind the capped list, so the surface is never silently clipped. */
	sameNameTotal: number;
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
	const sameNameWhere = and(
		eq(events.organizationId, orgId),
		eq(personName, name),
		sql`${personEmail} <> ${email}`,
	);
	const [sameName, [sameNameCount], [bioRow], sessionCounts] =
		await Promise.all([
			db
				.select({
					email: personEmail,
					firstName: sql<string>`min(${contacts.firstName})`,
					lastName: sql<string>`min(${contacts.lastName})`,
				})
				.from(contacts)
				.innerJoin(events, eq(events.id, contacts.eventId))
				.where(sameNameWhere)
				.groupBy(personEmail)
				.limit(SAME_NAME_SHOWN),
			db
				.select({ n: sql<number>`count(distinct ${personEmail})` })
				.from(contacts)
				.innerJoin(events, eq(events.id, contacts.eventId))
				.where(sameNameWhere),
			// Bio + session counts fetched here alone — the shared appearance
			// projection excludes them, and only this profile renders them.
			db
				.select({ bio: contacts.bio })
				.from(contacts)
				.where(eq(contacts.id, latest.contactId))
				.limit(1),
			db
				.select({ contactId: participants.contactId, n: count() })
				.from(participants)
				.where(
					inArray(
						participants.contactId,
						rows.map((r) => r.contactId),
					),
				)
				.groupBy(participants.contactId),
		]);
	const [person] = composePeople(rows, [email], new Set());
	if (!person) return null;
	const countByContact = new Map(sessionCounts.map((r) => [r.contactId, r.n]));
	return {
		...person,
		appearances: person.appearances.map((a) => ({
			...a,
			sessionCount: countByContact.get(a.contactId) ?? 0,
		})),
		bio: bioRow?.bio ?? null,
		possibleDuplicate: sameName.length > 0,
		sameNamePeople: sameName,
		sameNameTotal: sameNameCount?.n ?? sameName.length,
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

export type AddNoteResult = { ok: true } | { ok: false; reason: string };

/** The one person-note write — both the profile and the card composer post
 * here, so validation and shape can never drift between the two surfaces. */
export async function addCrmNote(
	db: Db,
	orgId: string,
	email: string,
	actor: { id: string; name: string },
	rawBody: string,
): Promise<AddNoteResult> {
	const body = rawBody.trim();
	if (body.length === 0) {
		return { ok: false, reason: "Write the note before saving." };
	}
	if (body.length > 4000) {
		return { ok: false, reason: "Keep notes under 4,000 characters." };
	}
	await db.insert(crmNotes).values({
		organizationId: orgId,
		email,
		authorId: actor.id,
		authorName: actor.name,
		body,
	});
	return { ok: true };
}

/* ----------------------------------------------------------- add to event --- */

const FOREIGN_EVENT_ERROR = "That event does not belong to your organization.";

export interface AddPeopleResult {
	eventName: string;
	added: number;
	already: number;
	missing: number;
}

/**
 * Push directory people into an event as contacts: copies each latest
 * appearance's profile fields; idempotent — an existing contact with that
 * email is counted, never duplicated. The target event is verified to belong
 * to the org ONCE here, so a cross-tenant insert is impossible by
 * construction no matter what a caller passes (null = refused), and the
 * per-request work is bounded by the caller's capped, deduped email set.
 */
export async function addPeopleToEvent(
	db: Db,
	orgId: string,
	emails: string[],
	targetEventId: string,
): Promise<AddPeopleResult | null> {
	const [target] = await db
		.select({ id: events.id, name: events.name })
		.from(events)
		.where(and(eq(events.id, targetEventId), eq(events.organizationId, orgId)))
		.limit(1);
	if (!target) return null;
	const result: AddPeopleResult = {
		eventName: target.name,
		added: 0,
		already: 0,
		missing: 0,
	};
	for (const email of new Set(emails)) {
		const outcome = await copyPersonIntoEvent(db, orgId, email, target.id);
		result[outcome] += 1;
	}
	return result;
}

async function copyPersonIntoEvent(
	db: Db,
	orgId: string,
	email: string,
	targetEventId: string,
): Promise<"added" | "already" | "missing"> {
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

type AddToEventActionResult = {
	notice?: string;
	formError?: string;
	outcome: string;
};

/**
 * The one outcome→message owner for BOTH add-to-event shapes: one email gets
 * singular copy (profile, pipeline card), several get the aggregate summary
 * (directory bulk) — so no surface can drift on wording or the org refusal.
 */
export async function addToEventNotice(
	db: Db,
	orgId: string,
	emails: string[],
	targetEventId: string,
): Promise<AddToEventActionResult> {
	const result = await addPeopleToEvent(db, orgId, emails, targetEventId);
	if (result === null) {
		return { formError: FOREIGN_EVENT_ERROR, outcome: "foreign" };
	}
	if (emails.length === 1) {
		if (result.missing > 0) {
			return {
				formError: "This person is no longer in the directory.",
				outcome: "missing",
			};
		}
		return {
			notice:
				result.added > 0
					? `Added to ${result.eventName} — profile fields carried over; workflow status starts at pending.`
					: `Already a contact in ${result.eventName}.`,
			outcome: result.added > 0 ? "added" : "already",
		};
	}
	const parts = [
		`${result.added} added to ${result.eventName}`,
		result.already ? `${result.already} already there` : null,
		result.missing ? `${result.missing} not found in the directory` : null,
	].filter(Boolean);
	return { notice: parts.join(" · "), outcome: "bulk" };
}

/* --------------------------------------------------------------- pipeline --- */

export type PipelineActionResult =
	| { ok: true; cardId: string }
	| { ok: false; code: "missing" | "duplicate" | "foreign"; reason: string };

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
			code: "missing",
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
			return {
				ok: false,
				code: "duplicate",
				reason: "Already in the pipeline.",
			};
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
		return {
			ok: false,
			code: "foreign",
			reason: "That card is not in your pipeline.",
		};
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
