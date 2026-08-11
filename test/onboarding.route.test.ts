import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	authSessions,
	emailTemplates,
	events,
	languages,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { action, loader } from "../app/routes/onboarding";

const CONTEXT = { cloudflare: { env, ctx: {} } };

/** Seeded template keys — the set every new event must be born with
 * (drizzle/seed.sql), or its lifecycle emails silently never send. */
const DEFAULT_TEMPLATE_KEYS = [
	"accept",
	"decline",
	"reminder_1day",
	"reminder_5day",
	"submission_confirmation",
];

async function seedSessionUser(opts?: {
	withOrg?: boolean;
}): Promise<{ cookie: string; userId: string }> {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u1",
		email: "founder@example.com",
		passwordHash: "sentinel",
		role: "admin",
	});
	await db.insert(authSessions).values({
		id: "sess1",
		userId: "u1",
		expiresAt: new Date(Date.now() + 60_000),
	});
	if (opts?.withOrg) {
		await db.insert(organizations).values({ id: "org1", name: "Existing Org" });
		await db
			.insert(organizationMembers)
			.values({ organizationId: "org1", userId: "u1" });
	}
	return { cookie: "__session=sess1", userId: "u1" };
}

const VALID_FORM = {
	organizationName: "Devcon Collective",
	eventName: "Devcon 2027",
	slug: "devcon-2027",
	startsAt: "2027-06-10",
	endsAt: "2027-06-12",
	timezone: "Europe/Paris",
};

function act(body: Record<string, string>, cookie?: string) {
	return action({
		context: CONTEXT,
		request: new Request("http://localhost/onboarding", {
			method: "POST",
			body: new URLSearchParams(body),
			headers: cookie ? { Cookie: cookie } : {},
		}),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function load(cookie?: string) {
	return loader({
		context: CONTEXT,
		request: new Request("http://localhost/onboarding", {
			headers: cookie ? { Cookie: cookie } : {},
		}),
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
}

describe("onboarding route", () => {
	it("creates org + membership + first event + default templates and activates the event", async () => {
		const { cookie, userId } = await seedSessionUser();
		const res = (await act(VALID_FORM, cookie)) as Response;

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/admin");

		const db = getDb(env);
		const orgs = await db.select().from(organizations);
		expect(orgs).toHaveLength(1);
		expect(orgs[0]?.name).toBe("Devcon Collective");

		const members = await db.select().from(organizationMembers);
		expect(members).toHaveLength(1);
		expect(members[0]?.organizationId).toBe(orgs[0]?.id);
		expect(members[0]?.userId).toBe(userId);

		const [event] = await db.select().from(events);
		expect(event?.organizationId).toBe(orgs[0]?.id);
		expect(event?.name).toBe("Devcon 2027");
		expect(event?.slug).toBe("devcon-2027");
		expect(event?.timezone).toBe("Europe/Paris");
		// Date-only starts use local midnight; ends use local 23:59 so the
		// selected final calendar day remains part of the event.
		expect(event?.startsAt?.getTime()).toBe(
			Date.parse("2027-06-10T00:00:00+02:00"),
		);
		expect(event?.endsAt?.getTime()).toBe(
			Date.parse("2027-06-12T23:59:00+02:00"),
		);

		const templates = await db.select().from(emailTemplates);
		expect(templates.map((t) => t.key).sort()).toEqual(DEFAULT_TEMPLATE_KEYS);
		expect(templates.every((t) => t.eventId === event?.id)).toBe(true);

		// A fresh event must be submittable out of the box: the built-in Language
		// dropdown needs at least one option or the public CFP renders it
		// unanswerable.
		const langs = await db.select().from(languages);
		expect(langs.map((l) => ({ eventId: l.eventId, name: l.name }))).toEqual([
			{ eventId: event?.id, name: "English" },
		]);

		const [founder] = await db.select().from(users);
		expect(founder?.activeEventId).toBe(event?.id);
	});

	it("a taken slug returns a field error and rolls back everything (no partial org)", async () => {
		const { cookie } = await seedSessionUser();
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_other", name: "Other" });
		await db.insert(events).values({
			id: "e_other",
			organizationId: "org_other",
			name: "Other Event",
			slug: "devcon-2027",
		});

		const result = await act(VALID_FORM, cookie);

		expect(result).toHaveProperty("fieldErrors");
		expect(
			(result as { fieldErrors?: { slug?: string[] } }).fieldErrors?.slug?.[0],
		).toMatch(/taken/i);

		// Atomicity: the failed batch left NO new org, membership, or templates.
		expect(await db.select().from(organizations)).toHaveLength(1);
		expect(await db.select().from(organizationMembers)).toHaveLength(0);
		expect(await db.select().from(emailTemplates)).toHaveLength(0);
	});

	it("rejects an end date before the start date and creates nothing", async () => {
		const { cookie } = await seedSessionUser();
		const result = await act(
			{ ...VALID_FORM, startsAt: "2027-06-12", endsAt: "2027-06-10" },
			cookie,
		);

		expect(
			(result as { fieldErrors?: { endsAt?: string[] } }).fieldErrors
				?.endsAt?.[0],
		).toBeTruthy();
		expect(await getDb(env).select().from(organizations)).toHaveLength(0);
	});

	it("redirects a user who already has an organization to /admin (loader and action)", async () => {
		const { cookie } = await seedSessionUser({ withOrg: true });

		const thrownFromLoader = await load(cookie).catch((r: unknown) => r);
		expect(thrownFromLoader).toBeInstanceOf(Response);
		expect((thrownFromLoader as Response).headers.get("Location")).toBe(
			"/admin",
		);

		// A replayed POST (double submit) must not mint a second organization.
		const thrownFromAction = await act(VALID_FORM, cookie).catch(
			(r: unknown) => r,
		);
		expect(thrownFromAction).toBeInstanceOf(Response);
		expect((thrownFromAction as Response).headers.get("Location")).toBe(
			"/admin",
		);
		expect(await getDb(env).select().from(organizations)).toHaveLength(1);
	});

	it("redirects anonymous visitors to /signup", async () => {
		const thrown = await load().catch((r: unknown) => r);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toBe("/signup");
	});
});
