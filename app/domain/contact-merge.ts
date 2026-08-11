import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "~/db";
import type { ContactMergeAuditSummary } from "~/db/schema";
import { contacts, events } from "~/db/schema";

const MISSING_REASON = "Both contacts must exist in your organization.";

const PROFILE_FIELDS = [
	"salutation",
	"honorific",
	"pronouns",
	"gender",
	"jobTitle",
	"companyName",
	"mobilePhone",
	"homePhone",
	"zip",
	"bio",
	"headshotKey",
	"linkedinUrl",
	"twitterUrl",
	"facebookUrl",
	"websiteUrl",
	"logisticsNotes",
] as const;

type ContactRow = typeof contacts.$inferSelect & { eventName: string };

export type ContactMergeIdentity = {
	email: string;
	firstName: string;
	lastName: string;
	jobTitle: string | null;
	companyName: string | null;
	bio: string | null;
};

export type ContactMergeEventPreview = {
	eventId: string;
	eventName: string;
	sourceContactId: string;
	survivorContactId: string | null;
	createsSurvivor: boolean;
	profileFieldsFilled: string[];
};

export type ContactMergePreview = {
	source: ContactMergeIdentity;
	survivor: ContactMergeIdentity;
	events: ContactMergeEventPreview[];
	summary: ContactMergeAuditSummary;
};

export type ContactMergePreviewResult =
	| { ok: true; preview: ContactMergePreview }
	| { ok: false; code: "same" | "missing"; reason: string };

export function emptyContactMergeSummary(): ContactMergeAuditSummary {
	return {
		eventContactsCreated: 0,
		contactsRetired: 0,
		profileFieldsFilled: 0,
		participantLinksMoved: 0,
		participantLinksConsolidated: 0,
		taskAssignmentsMoved: 0,
		taskAssignmentsConsolidated: 0,
		filesMoved: 0,
		customValuesMoved: 0,
		customValuesConsolidated: 0,
		notesMoved: 0,
		pipelineCardsMoved: 0,
		pipelineCardsConsolidated: 0,
		pipelineHistoryMoved: 0,
		portalIdentitiesAliased: 0,
		submissionsReassigned: 0,
		airtableLinksMoved: 0,
		airtableLinksConsolidated: 0,
	};
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function identity(row: ContactRow, email: string): ContactMergeIdentity {
	return {
		email,
		firstName: row.firstName,
		lastName: row.lastName,
		jobTitle: row.jobTitle,
		companyName: row.companyName,
		bio: row.bio,
	};
}

function isBlank(value: string | null): boolean {
	return value === null || value.trim() === "";
}

async function loadPersonRows(
	db: Db,
	organizationId: string,
	email: string,
): Promise<ContactRow[]> {
	return db
		.select({ contact: contacts, eventName: events.name })
		.from(contacts)
		.innerJoin(events, eq(events.id, contacts.eventId))
		.where(
			and(
				eq(events.organizationId, organizationId),
				sql`lower(${contacts.email}) = ${email}`,
			),
		)
		.orderBy(asc(events.createdAt), asc(events.id), asc(contacts.id))
		.then((rows) =>
			rows.map((row) => ({ ...row.contact, eventName: row.eventName })),
		);
}

export async function buildContactMergePreview(
	db: Db,
	organizationId: string,
	rawSourceEmail: string,
	rawSurvivorEmail: string,
): Promise<ContactMergePreviewResult> {
	const sourceEmail = normalize(rawSourceEmail);
	const survivorEmail = normalize(rawSurvivorEmail);
	if (sourceEmail === survivorEmail) {
		return {
			ok: false,
			code: "same",
			reason: "Pick two different contacts to merge.",
		};
	}

	const [sourceRows, survivorRows] = await Promise.all([
		loadPersonRows(db, organizationId, sourceEmail),
		loadPersonRows(db, organizationId, survivorEmail),
	]);
	const source = sourceRows.at(-1);
	const survivor = survivorRows.at(-1);
	if (!source || !survivor) {
		return { ok: false, code: "missing", reason: MISSING_REASON };
	}

	const survivorByEvent = new Map(
		survivorRows.map((row) => [row.eventId, row]),
	);
	const eventsPreview = sourceRows.map((sourceRow) => {
		const survivorRow = survivorByEvent.get(sourceRow.eventId) ?? null;
		const profileFieldsFilled = survivorRow
			? PROFILE_FIELDS.filter(
					(field) => isBlank(survivorRow[field]) && !isBlank(sourceRow[field]),
				)
			: [];
		return {
			eventId: sourceRow.eventId,
			eventName: sourceRow.eventName,
			sourceContactId: sourceRow.id,
			survivorContactId: survivorRow?.id ?? null,
			createsSurvivor: survivorRow === null,
			profileFieldsFilled,
		};
	});
	const summary = emptyContactMergeSummary();
	summary.eventContactsCreated = eventsPreview.filter(
		(row) => row.createsSurvivor,
	).length;
	summary.contactsRetired = sourceRows.length;
	summary.profileFieldsFilled = eventsPreview.reduce(
		(total, row) => total + row.profileFieldsFilled.length,
		0,
	);

	return {
		ok: true,
		preview: {
			source: identity(source, sourceEmail),
			survivor: identity(survivor, survivorEmail),
			events: eventsPreview,
			summary,
		},
	};
}
