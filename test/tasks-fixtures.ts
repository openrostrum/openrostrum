import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizations,
	participants,
	portalForms,
	portals,
	submissions,
	tasks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";

export const CONTEXT = { cloudflare: { env, ctx: {} } };

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One event, three contacts (Priya/Bob/Carol), the hotel portal form, the
 * three onboarding task definitions, and accepted submissions for Priya +
 * Bob (Carol's is still pending).
 */
export async function seedTasksBaseline() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DemoConf",
		slug: "democonf",
	});
	await db.insert(portals).values({
		id: "portal1",
		eventId: "e1",
		publicId: "portal-public-1",
		name: "Speaker Portal",
	});
	await db.insert(contacts).values([
		{
			id: "c_priya",
			eventId: "e1",
			email: "priya.sharma@example.com",
			firstName: "Priya",
			lastName: "Sharma",
			status: "confirmed",
		},
		{
			id: "c_bob",
			eventId: "e1",
			email: "bob@example.com",
			firstName: "Bob",
			lastName: "Jones",
		},
		{
			id: "c_carol",
			eventId: "e1",
			email: "carol@example.com",
			firstName: "Carol",
			lastName: "King",
		},
	]);
	await db.insert(portalForms).values({
		id: "pf_hotel",
		eventId: "e1",
		name: "Hotel Stay",
		title: "Book your hotel",
		targetType: "contact",
		schema: [
			{ name: "Hotel name", type: "text", required: true },
			{ name: "Check-in date", type: "date", required: true },
		],
	});
	await db.insert(tasks).values([
		{
			id: "t_hotel",
			eventId: "e1",
			name: "Hotel Stay Requirements",
			type: "contact",
			portalFormId: "pf_hotel",
			dueInDays: 14,
			isOnboardingDefault: true,
		},
		{
			id: "t_flight",
			eventId: "e1",
			name: "Flight Reimbursement",
			type: "contact",
		},
		{
			id: "t_slides",
			eventId: "e1",
			name: "Presentation Upload",
			type: "submission",
			isFileRequest: true,
		},
	]);
	await db.insert(submissions).values([
		{ id: "s1", eventId: "e1", title: "Talk A", status: "accepted" },
		{ id: "s2", eventId: "e1", title: "Talk B", status: "accepted" },
		{ id: "s3", eventId: "e1", title: "Pending talk", status: "pending" },
	]);
	await db.insert(participants).values([
		{
			id: "p1",
			submissionId: "s1",
			contactId: "c_priya",
			role: "speaker",
			isPrimary: true,
		},
		{
			id: "p2",
			submissionId: "s2",
			contactId: "c_bob",
			role: "speaker",
			isPrimary: true,
		},
		{
			id: "p3",
			submissionId: "s3",
			contactId: "c_carol",
			role: "speaker",
			isPrimary: true,
		},
	]);
	return db;
}

/** Build an authenticated Request for the given role (creates the user + session). */
export async function authedRequest(
	url: string,
	opts: {
		role?: "admin" | "speaker" | "reviewer";
		activeEventId?: string | null;
	} = {},
	init?: RequestInit,
): Promise<Request> {
	const db = getDb(env);
	const id = `u_${opts.role ?? "admin"}_${crypto.randomUUID().slice(0, 8)}`;
	await db.insert(users).values({
		id,
		email: `${id}@test.co`,
		passwordHash: await hashPassword("pw"),
		role: opts.role ?? "admin",
		activeEventId: opts.activeEventId === undefined ? "e1" : opts.activeEventId,
	});
	const setCookie = await createSession(env, id);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

export function postForm(
	url: string,
	fields: Record<string, string>,
): RequestInit {
	const body = new URLSearchParams(fields);
	return {
		method: "POST",
		body,
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	};
}
