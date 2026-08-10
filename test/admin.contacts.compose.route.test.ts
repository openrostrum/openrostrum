import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	emailSuppressions,
	events,
	organizationMembers,
	organizations,
	portals,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action } from "../app/routes/admin.contacts_.compose";

async function adminRequest(url: string, init?: RequestInit): Promise<Request> {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

async function seedRoster(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DevFlow Conf",
		slug: "devflow",
	});
	await db.insert(portals).values({
		id: "portal1",
		eventId: "e1",
		publicId: "portal-public",
		name: "Speaker Portal",
	});
	await db.insert(contacts).values([
		{
			id: "c_alice",
			eventId: "e1",
			email: "alice@example.com",
			firstName: "Alice",
			lastName: "Anders",
			status: "confirmed",
		},
		{
			id: "c_bob",
			eventId: "e1",
			email: "bob@example.com",
			firstName: "Bob",
			lastName: "Baker",
			status: "pending",
		},
		{
			id: "c_carol",
			eventId: "e1",
			email: "carol@example.com",
			firstName: "Carol",
			lastName: "Chen",
			status: "confirmed",
		},
	]);
}

const CONTEXT = { cloudflare: { env, ctx: {} } };

function run(request: Request) {
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function sendBody(overrides: Record<string, string> = {}): URLSearchParams {
	return new URLSearchParams({
		intent: "send",
		ids: "",
		q: "",
		status: "confirmed",
		sendKey: "send-key-1",
		subject: "Welcome to {{event_name}}, {{first_name}}!",
		body: "Hi {{first_name}},\n\nYour portal: {{portal_link}}",
		...overrides,
	});
}

describe("compose bulk email", () => {
	it("resolves recipients from the roster filter, personalizes per recipient, and skips the unsubscribed", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body: sendBody() },
		);
		await seedRoster();
		// Carol unsubscribed — a bulk announcement must never reach her.
		await db
			.insert(emailSuppressions)
			.values({ id: "sup1", email: "carol@example.com" });

		const result = (await run(request)) as {
			step: string;
			sent: number;
			suppressed: number;
			outcomes: Array<{ email: string; outcome: string }>;
		};

		expect(result.step).toBe("sent");
		expect(result.sent).toBe(1);
		expect(result.suppressed).toBe(1);
		const byEmail = new Map(result.outcomes.map((o) => [o.email, o.outcome]));
		expect(byEmail.get("alice@example.com")).toBe("sent");
		expect(byEmail.get("carol@example.com")).toBe("suppressed");
		expect(byEmail.has("bob@example.com")).toBe(false); // pending ≠ confirmed

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("alice@example.com");
		expect(outbox[0]?.subject).toBe("Welcome to DevFlow Conf, Alice!");
		expect(outbox[0]?.html).toContain("Hi Alice,");
		expect(outbox[0]?.html).toContain("/portals/devflow/portal-public");
		expect(outbox[0]?.html).not.toContain("{{");
		// The footer's "reply to this email" opt-out must reach the organizer.
		expect(outbox[0]?.replyTo).toBe("admin@test.co");
	});

	it("ignores a double submit: the same sendKey never delivers twice", async () => {
		const db = getDb(env);
		const first = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body: sendBody() },
		);
		await seedRoster();
		await run(first);

		const setCookie = await createSession(env, "u_admin");
		const second = new Request("http://localhost/admin/contacts/compose", {
			method: "POST",
			body: sendBody(),
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		const replay = (await run(second)) as {
			step: string;
			sent: number;
			duplicates: number;
		};

		expect(replay.step).toBe("sent");
		expect(replay.sent).toBe(0);
		expect(replay.duplicates).toBe(2);
		expect(await db.select().from(emailOutbox)).toHaveLength(2);
	});

	it("previews the resolved merge fields for one recipient without sending", async () => {
		const db = getDb(env);
		const body = sendBody({ intent: "preview", previewContact: "c_alice" });
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body },
		);
		await seedRoster();

		const result = (await run(request)) as {
			step: string;
			sendKey?: string;
			preview?: { subject: string; body: string; email: string };
		};

		expect(result.step).toBe("form");
		expect(result.preview?.email).toBe("alice@example.com");
		expect(result.preview?.subject).toBe("Welcome to DevFlow Conf, Alice!");
		expect(result.preview?.body).toContain("Hi Alice,");
		// The POSTed sendKey is echoed back so preview → send (and a retry after
		// a partial failure) keeps one dedupe scope and can never double-deliver.
		expect(result.sendKey).toBe("send-key-1");
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("rejects a blank subject or body with field errors and writes nothing", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body: sendBody({ subject: "", body: "" }) },
		);
		await seedRoster();

		const result = (await run(request)) as {
			step: string;
			fieldErrors?: { subject?: string[]; body?: string[] };
		};

		expect(result.step).toBe("form");
		expect(result.fieldErrors?.subject?.[0]).toBeTruthy();
		expect(result.fieldErrors?.body?.[0]).toBeTruthy();
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});
});
