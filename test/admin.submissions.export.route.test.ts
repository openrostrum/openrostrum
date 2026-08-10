import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizationMembers,
	organizations,
	participants,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/admin.submissions.export[.csv]";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seed() {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org1", name: "Org One" },
		{ id: "org2", name: "Org Two" },
	]);
	await db.insert(events).values([
		{ id: "e1", organizationId: "org1", name: "Mine", slug: "mine" },
		{ id: "e2", organizationId: "org2", name: "Theirs", slug: "theirs" },
	]);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	await db
		.insert(organizationMembers)
		.values({ organizationId: "org1", userId: "u_admin" });
	await db.insert(submissions).values([
		{
			id: "ab1",
			eventId: "e1",
			title: "Abstract pending",
			type: "abstract",
			status: "pending",
		},
		{
			id: "se1",
			eventId: "e1",
			// Comma AND quote: the cell must round-trip with standard CSV escaping.
			title: 'Sessions, "at scale"',
			type: "session",
			status: "accepted",
		},
		{
			id: "foreign",
			eventId: "e2",
			title: "Another tenant's talk",
			type: "session",
			status: "accepted",
		},
	]);
	await db.insert(contacts).values({
		id: "c1",
		eventId: "e1",
		email: "ada@x.co",
		firstName: "Ada",
		lastName: "One",
	});
	await db.insert(participants).values({
		submissionId: "se1",
		contactId: "c1",
		role: "speaker",
		isPrimary: true,
	});
	return db;
}

async function runExport(qs: string): Promise<Response> {
	const setCookie = await createSession(env, "u_admin");
	const request = new Request(
		`http://localhost/admin/submissions/export.csv${qs}`,
		{ headers: { Cookie: setCookie.split(";")[0] ?? "" } },
	);
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as Response;
}

describe("submissions CSV export", () => {
	it("exports the active event's rows with speakers, never another tenant's", async () => {
		await seed();
		const res = await runExport("");
		expect(res.headers.get("Content-Type")).toContain("text/csv");
		expect(res.headers.get("Content-Disposition")).toContain(
			'filename="submissions.csv"',
		);
		const csv = await res.text();
		const lines = csv.split("\r\n");
		expect(lines[0]).toContain("Title,Type,Status");
		// header + the event's 2 rows; the foreign event's row never leaks
		expect(lines).toHaveLength(3);
		expect(csv).not.toContain("Another tenant's talk");
		expect(csv).toContain("Ada One");
		expect(csv).toContain("ada@x.co");
	});

	it("honors the same type/status filters as the list view", async () => {
		await seed();
		const res = await runExport("?type=session&status=accepted");
		const csv = await res.text();
		const lines = csv.split("\r\n");
		expect(lines).toHaveLength(2); // header + the one matching row
		expect(csv).not.toContain("Abstract pending");
		expect(res.headers.get("Content-Disposition")).toContain(
			'filename="submissions-session-accepted.csv"',
		);
	});

	it("escapes commas and quotes per RFC 4180", async () => {
		await seed();
		const res = await runExport("?type=session");
		const csv = await res.text();
		expect(csv).toContain('"Sessions, ""at scale"""');
	});

	it("404s when no event is configured for the admin", async () => {
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_admin",
			email: "admin@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await expect(runExport("")).rejects.toSatisfy(
			(r: unknown) => r instanceof Response && r.status === 404,
		);
	});
});
