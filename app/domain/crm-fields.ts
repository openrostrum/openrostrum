import { and, asc, count, eq, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/db";
import { contactAnswers, contacts, events, fields } from "~/db/schema";
import { normalizeEmail } from "~/lib/auth";

export const CRM_FIELD_TYPES = [
	"text",
	"textarea",
	"dropdown",
	"checkbox",
	"number",
	"email",
	"phone",
	"date",
] as const;

export type CrmFieldType = (typeof CRM_FIELD_TYPES)[number];
export const MAX_CRM_FIELDS = 100;

type DefinitionInput = {
	name: string;
	description: string | null;
	options: string[] | null;
};

export type CreateContactFieldInput = DefinitionInput & {
	id: string;
	type: CrmFieldType;
};

export type ContactFieldDefinition = {
	id: string;
	name: string;
	type: CrmFieldType;
	description: string | null;
	maxLength: number | null;
	options: string[] | null;
	answerCount: number;
};

export type ContactFieldValue = ContactFieldDefinition & {
	value: string | null;
};

type MutationResult = { ok: true } | { ok: false; reason: string };

const fieldScope = (orgId: string) =>
	and(
		eq(fields.organizationId, orgId),
		isNull(fields.eventId),
		eq(fields.recordType, "contact"),
	);

function isCrmFieldType(type: string): type is CrmFieldType {
	return CRM_FIELD_TYPES.some((candidate) => candidate === type);
}

export async function queryContactFieldDefinitions(
	db: Db,
	orgId: string,
): Promise<ContactFieldDefinition[]> {
	const rows = await db
		.select({
			id: fields.id,
			name: fields.name,
			type: fields.type,
			description: fields.description,
			maxLength: fields.maxLength,
			options: fields.options,
			answerCount: db.$count(
				contactAnswers,
				eq(contactAnswers.fieldId, fields.id),
			),
		})
		.from(fields)
		.where(fieldScope(orgId))
		.orderBy(asc(fields.name), asc(fields.id))
		.limit(MAX_CRM_FIELDS);
	return rows.flatMap((row) =>
		isCrmFieldType(row.type) ? [{ ...row, type: row.type }] : [],
	);
}

export async function createContactField(
	db: Db,
	orgId: string,
	input: CreateContactFieldInput,
): Promise<MutationResult> {
	const [existing] = await db
		.select({ id: fields.id })
		.from(fields)
		.where(and(eq(fields.id, input.id), fieldScope(orgId)))
		.limit(1);
	if (existing) return { ok: true };
	const [total] = await db
		.select({ n: count() })
		.from(fields)
		.where(fieldScope(orgId));
	if ((total?.n ?? 0) >= MAX_CRM_FIELDS) {
		return {
			ok: false,
			reason: `An organization can define up to ${MAX_CRM_FIELDS} person fields.`,
		};
	}
	const inserted = await db
		.insert(fields)
		.values({
			id: input.id,
			organizationId: orgId,
			eventId: null,
			recordType: "contact",
			name: input.name,
			type: input.type,
			description: input.description,
			options: input.type === "dropdown" ? input.options : null,
		})
		.onConflictDoNothing()
		.returning({ id: fields.id });
	if (inserted.length > 0) return { ok: true };
	const [raceWinner] = await db
		.select({ id: fields.id })
		.from(fields)
		.where(and(eq(fields.id, input.id), fieldScope(orgId)))
		.limit(1);
	return raceWinner
		? { ok: true }
		: { ok: false, reason: "Could not create this person field." };
}

export async function updateContactField(
	db: Db,
	orgId: string,
	id: string,
	input: DefinitionInput,
): Promise<MutationResult> {
	const [owned] = await db
		.select({ type: fields.type })
		.from(fields)
		.where(and(eq(fields.id, id), fieldScope(orgId)))
		.limit(1);
	if (!owned || !isCrmFieldType(owned.type)) {
		return { ok: false, reason: "That person field no longer exists." };
	}
	if (owned.type === "dropdown" && !input.options?.length) {
		return { ok: false, reason: "List at least one dropdown option." };
	}
	const updated = await db
		.update(fields)
		.set({
			name: input.name,
			description: input.description,
			options: owned.type === "dropdown" ? input.options : null,
		})
		.where(and(eq(fields.id, id), fieldScope(orgId)))
		.returning({ id: fields.id });
	return updated.length > 0
		? { ok: true }
		: { ok: false, reason: "That person field no longer exists." };
}

export async function deleteContactField(
	db: Db,
	orgId: string,
	id: string,
): Promise<MutationResult> {
	const deleted = await db
		.delete(fields)
		.where(
			and(
				eq(fields.id, id),
				fieldScope(orgId),
				notExists(
					db
						.select({ id: contactAnswers.id })
						.from(contactAnswers)
						.where(eq(contactAnswers.fieldId, id)),
				),
			),
		)
		.returning({ id: fields.id });
	if (deleted.length > 0) return { ok: true };
	const [owned] = await db
		.select({ id: fields.id })
		.from(fields)
		.where(and(eq(fields.id, id), fieldScope(orgId)))
		.limit(1);
	return owned
		? {
				ok: false,
				reason: "Clear this field's saved person values before deleting it.",
			}
		: { ok: false, reason: "That person field no longer exists." };
}

export async function queryContactFieldValues(
	db: Db,
	orgId: string,
	rawEmail: string,
): Promise<ContactFieldValue[]> {
	const email = normalizeEmail(rawEmail);
	const [definitions, answers] = await Promise.all([
		queryContactFieldDefinitions(db, orgId),
		db
			.select({ fieldId: contactAnswers.fieldId, value: contactAnswers.value })
			.from(contactAnswers)
			.where(
				and(
					eq(contactAnswers.organizationId, orgId),
					eq(contactAnswers.email, email),
				),
			),
	]);
	const values = new Map(
		answers.map((answer) => [answer.fieldId, answer.value]),
	);
	return definitions.map((definition) => ({
		...definition,
		value: values.get(definition.id) ?? null,
	}));
}

type NormalizedValue =
	| { ok: true; value: string | null }
	| { ok: false; reason: string };

function normalizeValue(
	field: {
		type: CrmFieldType;
		maxLength: number | null;
		options: string[] | null;
	},
	rawValue: string,
): NormalizedValue {
	const value = rawValue.trim();
	if (field.type !== "checkbox" && value === "") {
		return { ok: true, value: null };
	}
	if (field.maxLength != null && value.length > field.maxLength) {
		return {
			ok: false,
			reason: `Keep this value under ${field.maxLength} characters.`,
		};
	}
	if (field.type === "dropdown" && !field.options?.includes(value)) {
		return { ok: false, reason: "Pick one of this field's current options." };
	}
	if (field.type === "checkbox" && value !== "true" && value !== "false") {
		return { ok: false, reason: "Choose yes or no for this field." };
	}
	if (field.type === "number" && !Number.isFinite(Number(value))) {
		return { ok: false, reason: "Enter a valid number." };
	}
	if (field.type === "email" && !z.email().safeParse(value).success) {
		return { ok: false, reason: "Enter a valid email address." };
	}
	if (field.type === "date") {
		const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
		const parsed = new Date(`${value}T00:00:00.000Z`);
		if (!match || Number.isNaN(parsed.valueOf())) {
			return { ok: false, reason: "Enter a valid date." };
		}
		if (parsed.toISOString().slice(0, 10) !== value) {
			return { ok: false, reason: "Enter a valid date." };
		}
	}
	return { ok: true, value };
}

export async function saveContactFieldValue(
	db: Db,
	orgId: string,
	rawEmail: string,
	fieldId: string,
	rawValue: string,
): Promise<MutationResult> {
	const email = normalizeEmail(rawEmail);
	const [[field], [person]] = await Promise.all([
		db
			.select({
				type: fields.type,
				maxLength: fields.maxLength,
				options: fields.options,
			})
			.from(fields)
			.where(and(eq(fields.id, fieldId), fieldScope(orgId)))
			.limit(1),
		db
			.select({ id: contacts.id })
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(
				and(
					eq(events.organizationId, orgId),
					sql`lower(${contacts.email}) = ${email}`,
				),
			)
			.limit(1),
	]);
	if (!field || !isCrmFieldType(field.type) || !person) {
		return { ok: false, reason: "That person field is no longer available." };
	}
	const normalized = normalizeValue({ ...field, type: field.type }, rawValue);
	if (!normalized.ok) return normalized;
	if (normalized.value === null) {
		await db
			.delete(contactAnswers)
			.where(
				and(
					eq(contactAnswers.organizationId, orgId),
					eq(contactAnswers.email, email),
					eq(contactAnswers.fieldId, fieldId),
				),
			);
		return { ok: true };
	}
	await db
		.insert(contactAnswers)
		.values({ organizationId: orgId, email, fieldId, value: normalized.value })
		.onConflictDoUpdate({
			target: [
				contactAnswers.organizationId,
				contactAnswers.email,
				contactAnswers.fieldId,
			],
			set: { value: normalized.value, updatedAt: new Date() },
		});
	return { ok: true };
}
