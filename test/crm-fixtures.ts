import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";

export const CONTEXT = { cloudflare: { env, ctx: {} } };

/**
 * Two isolated organizations:
 *
 * org1 (admin u_admin1) — events e1 "DevFlow 2026", e2 "AI Summit 2026"
 *   - Priya Raman  priya@example.com     in e1 (confirmed, Latticework) AND e2
 *     (mixed-case email) → ONE directory person with two appearances,
 *     the returning speaker.
 *   - Marcus Okafor marcus@example.com   in e1 only (BuildScale, CTO).
 *   - Priya Raman  priya.alt@example.com in e2 → same name, different email:
 *     the possible-duplicate pair inside org1.
 *
 * org2 (admin u_admin2) — event e3 "Rival Conf"
 *   - Priya Raman  priya@example.com     — SAME email as org1's person; must
 *     never merge or leak across the org boundary.
 *   - Marcus Okafor marcus.other@rival.com — same NAME as org1's Marcus;
 *     must not trip org1's duplicate flag.
 *   - Zara Ito     zara@rival.com        — exists only in org2.
 */
export async function seedCrmBaseline() {
	const db = getDb(env);
	await db.insert(users).values([
		{
			id: "u_admin1",
			email: "admin1@test.co",
			passwordHash: await hashPassword("pw"),
			name: "Org One Admin",
			role: "admin",
		},
		{
			id: "u_admin2",
			email: "admin2@test.co",
			passwordHash: await hashPassword("pw"),
			name: "Org Two Admin",
			role: "admin",
		},
	]);
	await db.insert(organizations).values([
		{ id: "org1", name: "Acme Conf Co" },
		{ id: "org2", name: "Rival Org" },
	]);
	await db.insert(organizationMembers).values([
		{ id: "om1", organizationId: "org1", userId: "u_admin1" },
		{ id: "om2", organizationId: "org2", userId: "u_admin2" },
	]);
	await db.insert(events).values([
		{ id: "e1", organizationId: "org1", name: "DevFlow 2026", slug: "devflow" },
		{
			id: "e2",
			organizationId: "org1",
			name: "AI Summit 2026",
			slug: "aisummit",
		},
		{ id: "e3", organizationId: "org2", name: "Rival Conf", slug: "rival" },
	]);
	await db.insert(contacts).values([
		{
			id: "c_priya_e1",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			jobTitle: "Principal Engineer",
			companyName: "Latticework Systems",
			bio: "<p>Distributed builds.</p>",
			status: "confirmed",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			// Mixed-case stored email: the union joins on lower(email).
			id: "c_priya_e2",
			eventId: "e2",
			email: "Priya@Example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
			status: "pending",
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
		{
			id: "c_marcus_e1",
			eventId: "e1",
			email: "marcus@example.com",
			firstName: "Marcus",
			lastName: "Okafor",
			jobTitle: "CTO",
			companyName: "BuildScale",
			bio: "<p>Platform engineering.</p>",
			status: "pending",
			createdAt: new Date("2026-01-05T00:00:00Z"),
		},
		{
			id: "c_priya_alt_e2",
			eventId: "e2",
			email: "priya.alt@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Freelance",
			status: "pending",
			createdAt: new Date("2026-03-01T00:00:00Z"),
		},
		{
			id: "c_priya_org2",
			eventId: "e3",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Rival Co",
			status: "invited",
			createdAt: new Date("2026-01-10T00:00:00Z"),
		},
		{
			id: "c_marcus_org2",
			eventId: "e3",
			email: "marcus.other@rival.com",
			firstName: "Marcus",
			lastName: "Okafor",
			status: "pending",
			createdAt: new Date("2026-01-11T00:00:00Z"),
		},
		{
			id: "c_zara_org2",
			eventId: "e3",
			email: "zara@rival.com",
			firstName: "Zara",
			lastName: "Ito",
			companyName: "Rival Co",
			status: "pending",
			createdAt: new Date("2026-01-12T00:00:00Z"),
		},
	]);
}

/** A logged-in request for the given seeded user. */
export async function requestAs(
	userId: string,
	url: string,
	init?: RequestInit,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}
