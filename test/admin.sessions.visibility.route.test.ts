import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loadPublicSessions } from "../app/lib/program";
import type { SubmissionListLoaded } from "../app/lib/submission-list";
import { action, loader } from "../app/routes/admin.sessions";
import { CONTEXT, seedProgram, unwrap } from "./program.fixtures";

// Sessionboard's per-speaker eye toggle (flows/09 rule j): hiding a speaker
// removes them from every public surface while admin views keep showing them
// flagged. The write is event-scoped — a foreign contact id must not write.

async function seedAdmin() {
	const db = getDb(env);
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	return db;
}

async function seedAll() {
	await seedProgram();
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	await seedAdmin();
	return db;
}

async function authedRequest(init?: RequestInit): Promise<Request> {
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request("http://localhost/admin/sessions", { ...init, headers });
}

function toggleBody(contactId: string, visible: "0" | "1") {
	return {
		method: "POST",
		body: new URLSearchParams({
			intent: "set-speaker-visibility",
			contactId,
			visible,
		}),
	};
}

async function runAction(request: Request) {
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	return unwrap<{ notice?: string; formError?: string }>(result).data;
}

async function runLoader() {
	const result = await loader({
		context: CONTEXT,
		request: await authedRequest(),
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
	return unwrap<SubmissionListLoaded>(result).data;
}

describe("sessions admin speaker visibility", () => {
	it("lists each session's speakers with their visibility state", async () => {
		await seedAll();
		const data = await runLoader();
		const s1 = data.rows.find((r) => r.id === "s1");
		expect(s1?.speakers).toEqual([
			{ contactId: "c_ada", name: "Ada Zhang", publicVisible: true },
			{ contactId: "c_hidden", name: "Hidden Person", publicVisible: false },
		]);
	});

	it("hides a speaker from the public program", async () => {
		const db = await seedAll();
		const result = await runAction(
			await authedRequest(toggleBody("c_ada", "0")),
		);
		expect(result.formError).toBeUndefined();
		// One click reaches every session, embed, and feed, so the confirmation
		// has to name that scope: the evaluator who could only see an eye flip
		// pressed it four more times and ended up back where it started.
		expect(result.notice).toContain("Ada Zhang");
		expect(result.notice).toMatch(/every session, embed, and feed/);

		const [row] = await db
			.select({ publicVisible: contacts.publicVisible })
			.from(contacts)
			.where(eq(contacts.id, "c_ada"));
		expect(row?.publicVisible).toBe(false);

		// Integration with the one public projection: the hidden speaker is gone
		// from every session, while the sessions themselves stay published.
		const [event] = await db.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("fixture event missing");
		const sessions = await loadPublicSessions(db, event);
		const speakerIds = sessions.flatMap((s) => s.speakers.map((sp) => sp.id));
		expect(speakerIds).not.toContain("c_ada");
		expect(sessions.map((s) => s.id)).toContain("s1");
	});

	it("shows a hidden speaker again", async () => {
		const db = await seedAll();
		const result = await runAction(
			await authedRequest(toggleBody("c_hidden", "1")),
		);
		expect(result.formError).toBeUndefined();
		expect(result.notice).toContain("back on the public program");
		const [row] = await db
			.select({ publicVisible: contacts.publicVisible })
			.from(contacts)
			.where(eq(contacts.id, "c_hidden"));
		expect(row?.publicVisible).toBe(true);
	});

	it("refuses a contact of another event AND writes nothing", async () => {
		const db = await seedAll();
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Event",
			slug: "other",
		});
		await db.insert(contacts).values({
			id: "c_foreign",
			eventId: "e2",
			email: "foreign@px.test",
			firstName: "Faye",
			lastName: "Foreign",
		});

		const result = await runAction(
			await authedRequest(toggleBody("c_foreign", "0")),
		);
		expect(result.formError).toBeTruthy();
		const [row] = await db
			.select({ publicVisible: contacts.publicVisible })
			.from(contacts)
			.where(eq(contacts.id, "c_foreign"));
		expect(row?.publicVisible).toBe(true);
	});
});
