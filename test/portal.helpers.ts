import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizations,
	portals,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";

export const CONTEXT = { cloudflare: { env, ctx: {} } };

export const PORTAL_PARAMS = {
	eventSlug: "testconf",
	portalId: "portal-pub-1",
};
export const BASE = "http://localhost/portals/testconf/portal-pub-1";

/**
 * Two tenants: event e1 (slug testconf, portal portal-pub-1) and event e2
 * (slug otherconf, portal portal-pub-2) — the second exists so cross-tenant
 * probes have something real to fail against.
 */
export async function seedPortalWorld() {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org1", name: "Org One" },
		{ id: "org2", name: "Org Two" },
	]);
	await db.insert(events).values([
		{
			id: "e1",
			organizationId: "org1",
			name: "TestConf",
			slug: "testconf",
			timezone: "America/Los_Angeles",
		},
		{
			id: "e2",
			organizationId: "org2",
			name: "OtherConf",
			slug: "otherconf",
			timezone: "America/Los_Angeles",
		},
	]);
	await db.insert(portals).values([
		{ id: "portal1", eventId: "e1", publicId: "portal-pub-1" },
		{ id: "portal2", eventId: "e2", publicId: "portal-pub-2" },
	]);
}

export async function makeUser(
	id: string,
	email: string,
	role: "admin" | "speaker" | "reviewer" = "speaker",
) {
	const db = getDb(env);
	await db.insert(users).values({
		id,
		email,
		passwordHash: await hashPassword("pw"),
		role,
	});
}

export async function makeContact(
	id: string,
	eventId: string,
	email: string,
	userId: string | null,
	firstName = "Test",
	lastName = "Person",
) {
	const db = getDb(env);
	await db
		.insert(contacts)
		.values({ id, eventId, email, firstName, lastName, userId });
}

export async function authedRequest(
	userId: string,
	url: string,
	init?: RequestInit,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

export { unwrap } from "./route-data";
export { catchThrown, thrownStatus } from "./thrown";
