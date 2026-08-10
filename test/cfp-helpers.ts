import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	contacts,
	emailTemplates,
	events,
	fields,
	formats,
	formFields,
	forms,
	languages,
	levels,
	organizations,
	portals,
	tags,
	tracks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";

/**
 * Shared CFP wizard fixture: one open session form on a seeded event with
 * taxonomies, a portal, the confirmation template, and one conditional
 * library-field pair (notes shown only when experience = "Experienced").
 */
export const FIX = {
	eventSlug: "test-event",
	formPublicId: "form-uuid-1",
	formId: "f1",
	eventId: "e1",
	portalPublicId: "portal-uuid-1",
	formatId: "fmt1",
	tagId: "tag1",
	trackId: "tr1",
	levelId: "lvl1",
	expFieldId: "fld_exp",
	notesFieldId: "fld_notes",
} as const;

export const BASE = `/submit/${FIX.eventSlug}/${FIX.formPublicId}`;
export const BASE_URL = `http://localhost${BASE}`;

export async function seedCfp(
	formOverrides: Partial<typeof forms.$inferInsert> = {},
): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values({
		id: FIX.eventId,
		organizationId: "org1",
		name: "Test Conf",
		slug: FIX.eventSlug,
		timezone: "America/Los_Angeles",
	});
	await db.insert(portals).values({
		id: "portal1",
		eventId: FIX.eventId,
		publicId: FIX.portalPublicId,
		name: "Speaker Portal",
	});
	await db.insert(forms).values({
		id: FIX.formId,
		eventId: FIX.eventId,
		publicId: FIX.formPublicId,
		type: "session",
		status: "open",
		internalName: "Session CFP",
		externalTitle: "Call for Sessions",
		closeAt: new Date("2027-09-15T23:59:00Z"),
		...formOverrides,
	});
	await db.insert(formats).values({
		id: FIX.formatId,
		eventId: FIX.eventId,
		name: "Featured Keynote",
	});
	await db.insert(tags).values({
		id: FIX.tagId,
		eventId: FIX.eventId,
		name: "Tag A",
	});
	await db.insert(tracks).values({
		id: FIX.trackId,
		eventId: FIX.eventId,
		name: "Topic A",
	});
	await db.insert(levels).values({
		id: FIX.levelId,
		eventId: FIX.eventId,
		name: "Introductory",
	});
	await db.insert(languages).values({
		id: "lang1",
		eventId: FIX.eventId,
		name: "English",
	});
	await db.insert(fields).values([
		{
			id: FIX.expFieldId,
			eventId: FIX.eventId,
			name: "Prior speaking experience",
			type: "dropdown",
			options: ["First time", "Experienced"],
		},
		{
			id: FIX.notesFieldId,
			eventId: FIX.eventId,
			name: "Anything else to share?",
			type: "textarea",
		},
	]);
	await db.insert(formFields).values([
		{
			id: "ff_exp",
			formId: FIX.formId,
			fieldId: FIX.expFieldId,
			section: "session",
			position: 0,
			required: true,
		},
		{
			id: "ff_notes",
			formId: FIX.formId,
			fieldId: FIX.notesFieldId,
			section: "session",
			position: 1,
			required: true,
			questionRule: {
				trigger: { kind: "field", fieldId: FIX.expFieldId },
				operator: "equals",
				value: "Experienced",
			},
		},
	]);
	await db.insert(emailTemplates).values({
		id: "et1",
		eventId: FIX.eventId,
		key: "submission_confirmation",
		name: "Submission Confirmation",
		subject: "We received your submission",
		bodyHtml: "<p>Thanks {{first_name}} for submitting to {{event_name}}!</p>",
	});
}

export async function createSpeaker(
	id = "u_speaker1",
	email = "priya@example.com",
	name = "Priya Raman",
): Promise<{ id: string; email: string; cookie: string }> {
	const db = getDb(env);
	await db.insert(users).values({
		id,
		email,
		passwordHash: await hashPassword("Priya!Speaks2026"),
		name,
		role: "speaker",
	});
	const setCookie = await createSession(env, id);
	return { id, email, cookie: setCookie.split(";")[0] ?? "" };
}

export async function seedContact(
	id: string,
	email: string,
	firstName: string,
	lastName: string,
	userId: string | null = null,
): Promise<void> {
	await getDb(env).insert(contacts).values({
		id,
		eventId: FIX.eventId,
		userId,
		email,
		firstName,
		lastName,
	});
}

export function jsonRequest(
	url: string,
	cookie: string,
	body: unknown,
): Request {
	return new Request(url, {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			Cookie: cookie,
		},
	});
}

export function formRequest(
	url: string,
	body: Record<string, string>,
	cookie?: string,
): Request {
	const params = new URLSearchParams(body);
	const headers = new Headers();
	if (cookie) headers.set("Cookie", cookie);
	return new Request(url, { method: "POST", body: params, headers });
}

export function validValues(): Record<string, string> {
	return {
		b_title: "Evals in Production: Lessons from 40 Deployments",
		b_description: "<p>Two sentences. <strong>offline evals lie</strong>.</p>",
		b_format: FIX.formatId,
		b_tags: FIX.tagId,
		b_track: FIX.trackId,
		b_level: FIX.levelId,
		b_language: "English",
		f_fld_exp: "First time",
	};
}

export function selfRow(email = "", firstName = "Priya", lastName = "Raman") {
	return {
		key: "self",
		role: "speaker" as const,
		firstName,
		lastName,
		email,
		mobilePhone: "+1 415 555 0142",
		bio: "<p>Infra engineer.</p>",
		self: true,
	};
}

export function speakerRow(
	key: string,
	firstName: string,
	lastName: string,
	email: string,
) {
	return {
		key,
		role: "speaker" as const,
		firstName,
		lastName,
		email,
		mobilePhone: "",
		bio: "",
	};
}

export const CONTEXT = { cloudflare: { env, ctx: {} } };

export function contextWith(extraEnv: Record<string, string>) {
	return { cloudflare: { env: { ...env, ...extraEnv }, ctx: {} } };
}
