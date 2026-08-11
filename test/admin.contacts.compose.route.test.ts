import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { verifyUnsubscribeToken } from "../app/lib/unsubscribe";
import { action, loader } from "../app/routes/admin.contacts_.compose";

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

function run(request: Request, actionEnv: Env = env) {
	return action({
		context: { cloudflare: { env: actionEnv, ctx: {} } },
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function runLoader(request: Request) {
	return loader({
		context: { cloudflare: { env, ctx: {} } },
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
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

afterEach(() => vi.restoreAllMocks());

describe("compose bulk email", () => {
	it("resolves selected directory people once across event appearances", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose?directoryEmails=alice%40example.com%2Cbob%40example.com",
		);
		await seedRoster();
		await db.insert(events).values({
			id: "e2",
			organizationId: "org1",
			name: "Second Event",
			slug: "second-event",
		});
		await db.insert(contacts).values({
			id: "c_alice_e2",
			eventId: "e2",
			email: "Alice@Example.com",
			firstName: "Alice",
			lastName: "Anders",
			status: "pending",
			createdAt: new Date("2030-02-01T00:00:00Z"),
		});

		const result = (await runLoader(request)) as {
			data: { recipients: Array<{ id: string; email: string }> };
		};
		expect(result.data.recipients.map((recipient) => recipient.email)).toEqual([
			"Alice@Example.com",
			"bob@example.com",
		]);
		expect(
			result.data.recipients.filter(
				(recipient) => recipient.email.toLowerCase() === "alice@example.com",
			),
		).toHaveLength(1);
	});

	it("previews and sends only the selected directory subset", async () => {
		const db = getDb(env);
		const previewRequest = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{
				method: "POST",
				body: sendBody({
					intent: "preview",
					ids: "",
					status: "",
					directoryEmails: "alice@example.com,bob@example.com",
					previewContact: "c_bob",
				}),
			},
		);
		await seedRoster();
		const preview = (await run(previewRequest)) as {
			step: string;
			preview?: { email: string; subject: string };
		};
		expect(preview.preview).toMatchObject({
			email: "bob@example.com",
			subject: "Welcome to DevFlow Conf, Bob!",
		});
		expect(await db.select().from(emailOutbox)).toHaveLength(0);

		const cookie = await createSession(env, "u_admin");
		const sendRequest = new Request("http://localhost/admin/contacts/compose", {
			method: "POST",
			headers: { Cookie: cookie.split(";")[0] ?? "" },
			body: sendBody({
				ids: "",
				status: "",
				directoryEmails: "alice@example.com,bob@example.com",
			}),
		});
		const sent = (await run(sendRequest)) as { step: string; sent: number };
		expect(sent).toMatchObject({ step: "sent", sent: 2 });
		expect(
			(await db.select().from(emailOutbox)).map((row) => row.to).sort(),
		).toEqual(["alice@example.com", "bob@example.com"]);
	});

	it("drops cross-organization directory emails without leaking them", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{
				method: "POST",
				body: sendBody({
					ids: "",
					status: "",
					directoryEmails: "alice@example.com,mallory@rival.example",
				}),
			},
		);
		await seedRoster();
		await db.insert(organizations).values({ id: "org2", name: "Rival" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Rival Event",
			slug: "rival-event",
		});
		await db.insert(contacts).values({
			id: "c_mallory",
			eventId: "e2",
			email: "mallory@rival.example",
			firstName: "Mallory",
			lastName: "Rival",
		});

		const sent = (await run(request)) as { step: string; sent: number };
		expect(sent).toMatchObject({ step: "sent", sent: 1 });
		expect((await db.select().from(emailOutbox)).map((row) => row.to)).toEqual([
			"alice@example.com",
		]);
	});

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
		// Replies must reach the organizer who composed the blast.
		expect(outbox[0]?.replyTo).toBe("admin@test.co");
		// The blast goes through sendAnnouncement: every delivered copy carries a
		// signed unsubscribe link that verifies for ITS recipient — footer links
		// must work from a cold, logged-out session.
		const unsubUrl = outbox[0]?.html.match(
			/href="([^"]*\/unsubscribe\/[^"]+)"/,
		)?.[1];
		expect(unsubUrl).toContain("http://localhost/unsubscribe/");
		const token = unsubUrl?.split("/unsubscribe/")[1] ?? "";
		expect(await verifyUnsubscribeToken(env, token)).toBe("alice@example.com");
	});

	it("sends classic triple-brace dotted aliases through the same parser as templates", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{
				method: "POST",
				body: sendBody({
					ids: "c_alice",
					status: "",
					subject: "Welcome {{{ EVENT.NAME }}}, {{{ Recipient.First_Name }}}!",
					body: "Hi {{ recipient.last_name }},\n\nPortal: {{{ portal_link }}}",
				}),
			},
		);
		await seedRoster();

		const result = (await run(request)) as { step: string; sent: number };
		expect(result).toMatchObject({ step: "sent", sent: 1 });
		const [mail] = await db.select().from(emailOutbox);
		expect(mail?.subject).toBe("Welcome DevFlow Conf, Alice!");
		expect(mail?.html).toContain("<p>Hi Anders,</p>");
		expect(mail?.html).toContain(
			"<p>Portal: http://localhost/portals/devflow/portal-public</p>",
		);
		expect(mail?.subject).not.toContain("{");
		expect(mail?.html).not.toContain("{");
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

	it("returns the same send key after a partial provider failure, then retries only the failed recipient", async () => {
		const db = getDb(env);
		const sendKey = "partial-provider-send";
		const first = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body: sendBody({ sendKey }) },
		);
		await seedRoster();

		let carolAttempts = 0;
		const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { to: string[] };
			if (body.to[0] === "carol@example.com" && carolAttempts++ === 0) {
				return new Response(JSON.stringify({ message: "temporary outage" }), {
					status: 503,
				});
			}
			return new Response(
				JSON.stringify({ id: `provider-${body.to[0]}-${carolAttempts}` }),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", providerFetch);
		const providerEnv = {
			...env,
			RESEND_API_KEY: "re_test",
			EMAIL_FROM: "OpenRostrum <noreply@test.example>",
			UNSUBSCRIBE_SECRET: "test-unsubscribe-secret",
		} as unknown as Env;

		const partial = (await run(first, providerEnv)) as {
			step: string;
			sendKey?: string;
			formError?: string;
		};
		expect(partial).toMatchObject({ step: "form", sendKey });
		expect(partial.formError).toMatch(/1 recipient failed.*retry/i);

		const setCookie = await createSession(env, "u_admin");
		const retryRequest = new Request(
			"http://localhost/admin/contacts/compose",
			{
				method: "POST",
				body: sendBody({ sendKey }),
				headers: { Cookie: setCookie.split(";")[0] ?? "" },
			},
		);
		const retry = (await run(retryRequest, providerEnv)) as {
			step: string;
			sent: number;
			duplicates: number;
			failed: number;
		};
		expect(retry).toMatchObject({
			step: "sent",
			sent: 1,
			duplicates: 1,
			failed: 0,
		});

		const providerRecipients = providerFetch.mock.calls.map(([, init]) => {
			const body = JSON.parse(String(init?.body)) as { to: string[] };
			return body.to[0];
		});
		expect(
			providerRecipients.filter((to) => to === "alice@example.com"),
		).toHaveLength(1);
		expect(
			providerRecipients.filter((to) => to === "carol@example.com"),
		).toHaveLength(2);
		const rows = await db.select().from(emailOutbox);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.status === "sent")).toBe(true);
		expect(rows.map((row) => row.dedupeKey).sort()).toEqual([
			`bulk:${sendKey}:c_alice`,
			`bulk:${sendKey}:c_carol`,
		]);
	});

	it("replaces a whitespace send key with a nonblank server key", async () => {
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{
				method: "POST",
				body: sendBody({
					intent: "preview",
					previewContact: "c_alice",
					sendKey: "  \t  ",
				}),
			},
		);
		await seedRoster();

		const result = (await run(request)) as { step: string; sendKey?: string };
		expect(result.step).toBe("form");
		expect(result.sendKey?.trim()).not.toBe("");
		expect(result.sendKey).not.toBe("  \t  ");
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

	it("a deployment without UNSUBSCRIBE_SECRET fails the blast as ONE form error, zero sends", async () => {
		// Production-shaped env, no secret: the unsubscribe footer would be
		// forgeable, so the announcement path must refuse up front — not report
		// a per-recipient "failed" pointing at an empty email history.
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/compose",
			{ method: "POST", body: sendBody() },
		);
		await seedRoster();
		const prodLike = {
			cloudflare: { env: { ...env, APP_ENV: "production" }, ctx: {} },
		};
		const result = (await action({
			context: prodLike,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as {
			step: string;
			formError?: string;
		};
		expect(result.step).toBe("form");
		expect(result.formError).toMatch(/UNSUBSCRIBE_SECRET/);
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
