import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { authSessions, contacts, users } from "../app/db/schema";
import { action } from "../app/routes/submit.$eventSlug.$formId.step.account";
import {
	BASE_URL,
	CONTEXT,
	contextWith,
	createSpeaker,
	FIX,
	formRequest,
	seedCfp,
	seedContact,
} from "./cfp-helpers";

const PARAMS = { eventSlug: FIX.eventSlug, formId: FIX.formPublicId };
const URL_ = `${BASE_URL}/step/account`;

type DataResult = {
	data: { branch?: string; email?: string; error?: string };
	init?: { status?: number };
};

function call(body: Record<string, string>, context: unknown = CONTEXT) {
	return action({
		context,
		request: formRequest(URL_, body),
		params: PARAMS,
	} as unknown as Parameters<typeof action>[0]);
}

const SIGNUP = {
	intent: "signup",
	email: "priya@example.com",
	firstName: "Priya",
	lastName: "Raman",
	password: "Priya!Speaks2026",
	terms: "on",
};

describe("account step — lookup", () => {
	it("branches to signup for a new email and to login for an existing one", async () => {
		await seedCfp();
		await createSpeaker("u_marcus", "marcus.chen@example.com", "Marcus Chen");

		const fresh = (await call({
			intent: "lookup",
			email: "priya@example.com",
		})) as { branch: string };
		expect(fresh.branch).toBe("signup");

		const known = (await call({
			intent: "lookup",
			email: "Marcus.Chen@example.com", // case-insensitive match
		})) as { branch: string };
		expect(known.branch).toBe("login");
	});
});

describe("account step — signup", () => {
	it("creates the user (speaker role) AND its event contact, then signs in", async () => {
		await seedCfp();
		const db = getDb(env);

		const response = (await call(SIGNUP)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(
			`/submit/${FIX.eventSlug}/${FIX.formPublicId}/step/session`,
		);
		expect(response.headers.get("Set-Cookie")).toContain("__session=");

		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, "priya@example.com"));
		expect(user?.role).toBe("speaker");
		expect(user?.name).toBe("Priya Raman");

		const [contact] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "priya@example.com"));
		expect(contact?.eventId).toBe(FIX.eventId);
		expect(contact?.userId).toBe(user?.id);
		expect(contact?.firstName).toBe("Priya");
	});

	it("claims the roster contact the organizer already added (link by normalized email)", async () => {
		await seedCfp();
		await seedContact("c_roster", "priya@example.com", "Priya", "Raman");
		const db = getDb(env);

		const response = (await call(SIGNUP)) as Response;
		expect(response.status).toBe(302);

		const rows = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "priya@example.com"));
		expect(rows).toHaveLength(1); // linked, not duplicated
		expect(rows[0]?.id).toBe("c_roster");
		expect(rows[0]?.userId).toBeTruthy();
	});

	it("rejects a weak password with a field error and creates nothing", async () => {
		await seedCfp();
		const db = getDb(env);
		const result = (await call({
			...SIGNUP,
			password: "alllowercase",
		})) as unknown as {
			data: { fieldErrors?: Record<string, string> };
			init?: { status?: number };
		};
		expect(result.init?.status).toBe(400);
		expect(result.data.fieldErrors?.password).toBeTruthy();
		expect(await db.select().from(users)).toHaveLength(0);
	});

	it("sends an existing email to the login branch instead of minting a duplicate", async () => {
		await seedCfp();
		await createSpeaker("u_p", "priya@example.com", "Priya Raman");
		const db = getDb(env);

		const result = (await call(SIGNUP)) as { branch: string; error: string };
		expect(result.branch).toBe("login");
		expect(result.error).toContain("already have an account");
		expect(await db.select().from(users)).toHaveLength(1);
	});
});

describe("account step — login", () => {
	it("rejects a wrong password with an inline error, preserves the email, and issues NO session", async () => {
		await seedCfp();
		await createSpeaker("u_marcus", "marcus.chen@example.com", "Marcus Chen");
		const db = getDb(env);
		const priorSessions = (await db.select().from(authSessions)).length;

		const result = (await call({
			intent: "login",
			email: "marcus.chen@example.com",
			password: "definitely-wrong-1A!",
		})) as unknown as DataResult;

		expect(result.init?.status).toBe(400);
		expect(result.data.error).toBe("Incorrect email or password.");
		expect(result.data.email).toBe("marcus.chen@example.com");
		expect(await db.select().from(authSessions)).toHaveLength(priorSessions);
	});

	it("logs in with the correct password and links roster contacts to the user", async () => {
		await seedCfp();
		const marcus = await createSpeaker(
			"u_marcus",
			"marcus.chen@example.com",
			"Marcus Chen",
		);
		await seedContact("c_m", "marcus.chen@example.com", "Marcus", "Chen");
		const db = getDb(env);

		const response = (await call({
			intent: "login",
			email: "marcus.chen@example.com",
			password: "Priya!Speaks2026",
		})) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Set-Cookie")).toContain("__session=");

		const [contact] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_m"));
		expect(contact?.userId).toBe(marcus.id);
	});
});

describe("account step — Turnstile", () => {
	// Oracle: Cloudflare's siteverify contract — a `success: false` verdict (or
	// a missing token, which siteverify also rejects) must block account
	// creation. fetch (the process boundary) is the only thing mocked.
	afterEach(() => vi.restoreAllMocks());

	function stubSiteverify(success: boolean) {
		const stub = vi.fn(
			async () => new Response(JSON.stringify({ success }), { status: 200 }),
		);
		vi.stubGlobal("fetch", stub);
		return stub;
	}

	it("rejects signup when siteverify says no — no user, no contact created", async () => {
		await seedCfp();
		const db = getDb(env);
		const stub = stubSiteverify(false);

		const result = (await call(
			{ ...SIGNUP, email: "bot.check@example.com" },
			contextWith({ TURNSTILE_SECRET: "test-secret" }),
		)) as unknown as DataResult;

		expect(result.init?.status).toBe(400);
		expect(result.data.error).toContain("verify");
		expect(await db.select().from(users)).toHaveLength(0);
		expect(await db.select().from(contacts)).toHaveLength(0);

		const [url, init] = stub.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		);
		expect(init.method).toBe("POST");
	});

	it("verifies the token with Cloudflare and lets a human through", async () => {
		await seedCfp();
		stubSiteverify(true);

		const response = (await call(
			{ ...SIGNUP, "cf-turnstile-response": "token123" },
			contextWith({ TURNSTILE_SECRET: "test-secret" }),
		)) as Response;
		expect(response.status).toBe(302);
	});

	it("keeps the pass-through when NO keys are configured (judged deploys ship keyless)", async () => {
		await seedCfp();
		const response = (await call(SIGNUP)) as Response;
		expect(response.status).toBe(302);
	});
});
