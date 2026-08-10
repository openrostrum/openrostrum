import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailTemplates,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.events.new";

const CONTEXT = { cloudflare: { env, ctx: {} } };

/** The template set every event must be born with (drizzle/seed.sql +
 * provisionEventDefaults) — a missing key means an email that never sends. */
const DEFAULT_TEMPLATE_KEYS = [
	"accept",
	"decline",
	"reminder_1day",
	"reminder_5day",
	"submission_confirmation",
];

// AE-S2.3's canonical event (docs/scenarios/01-auth-event-setup.yaml).
const VALID_FORM = {
	name: "DevOps Days Lyon 2027",
	slug: "devops-days-lyon-2027",
	type: "Conference",
	websiteUrl: "https://devopsdays-lyon.example.com",
	location: "Lyon, France",
	timezone: "Europe/Paris",
	theme: "Two days of DevOps war stories for platform teams.",
	startsAt: "2027-06-10T09:00",
	endsAt: "2027-06-11T18:00",
	submissionLimit: "",
};

async function seed(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(users).values({
		id: "u1",
		email: "a@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	// Member of BOTH orgs (org_b membership is older) — only the ACTIVE
	// event's org may win the inheritance below.
	await db.insert(organizationMembers).values([
		{
			id: "om_b",
			organizationId: "org_b",
			userId: "u1",
			createdAt: new Date(Date.now() - 60_000),
		},
		{ id: "om_a", organizationId: "org_a", userId: "u1" },
	]);
	await db.insert(events).values([
		{ id: "e_a1", organizationId: "org_a", name: "A1", slug: "a1" },
		{ id: "e_b1", organizationId: "org_b", name: "B1", slug: "b1" },
	]);
	await db
		.update(users)
		.set({ activeEventId: "e_a1" })
		.where(eq(users.id, "u1"));
}

async function cookieFor(userId: string): Promise<string> {
	const setCookie = await createSession(env, userId);
	return setCookie.split(";")[0] ?? "";
}

async function post(
	fields: Record<string, string>,
	userId?: string,
): Promise<unknown> {
	const headers = new Headers();
	if (userId) headers.set("Cookie", await cookieFor(userId));
	const request = new Request("http://localhost/admin/events/new", {
		method: "POST",
		headers,
		body: new URLSearchParams(fields),
	});
	try {
		return await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0]);
	} catch (thrown) {
		if (thrown instanceof Response) return thrown;
		throw thrown;
	}
}

describe("admin.events.new", () => {
	it("creates the event in the ACTIVE event's organization with templates, atomically, and activates it", async () => {
		await seed();
		const response = (await post(VALID_FORM, "u1")) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin");

		const db = getDb(env);
		const created = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.slug, "devops-days-lyon-2027"),
		});
		// The binding rule: inherit the ACTIVE event's org — NOT the oldest
		// membership (org_b) of this multi-org member.
		expect(created?.organizationId).toBe("org_a");
		expect(created?.name).toBe("DevOps Days Lyon 2027");
		expect(created?.timezone).toBe("Europe/Paris");
		expect(created?.location).toBe("Lyon, France");
		// 09:00 wall-clock in Europe/Paris (CEST, +02:00) = 07:00 UTC.
		expect(created?.startsAt?.getTime()).toBe(
			Date.parse("2027-06-10T07:00:00.000Z"),
		);
		expect(created?.endsAt?.getTime()).toBe(
			Date.parse("2027-06-11T16:00:00.000Z"),
		);

		const templates = await db.query.emailTemplates.findMany({
			where: (t, { eq }) => eq(t.eventId, created?.id ?? ""),
		});
		expect(templates.map((t) => t.key).sort()).toEqual(DEFAULT_TEMPLATE_KEYS);

		const creator = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, "u1"),
		});
		expect(creator?.activeEventId).toBe(created?.id);
	});

	it("rejects a blank name inline, echoes the other typed values, and creates nothing", async () => {
		await seed();
		const result = (await post({ ...VALID_FORM, name: "" }, "u1")) as {
			fieldErrors?: { name?: string[] };
			values?: { location?: string };
		};
		expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
		expect(result.values?.location).toBe("Lyon, France");

		const db = getDb(env);
		expect(await db.select().from(events)).toHaveLength(2);
		expect(await db.select().from(emailTemplates)).toHaveLength(0);
	});

	it("a taken slug returns a field error with NO partial rows and an unchanged active event", async () => {
		await seed();
		const result = (await post({ ...VALID_FORM, slug: "b1" }, "u1")) as {
			fieldErrors?: { slug?: string[] };
		};
		expect(result.fieldErrors?.slug?.[0]).toMatch(/taken/i);

		const db = getDb(env);
		// Atomicity: no event row AND no orphaned templates from the batch.
		expect(await db.select().from(events)).toHaveLength(2);
		expect(await db.select().from(emailTemplates)).toHaveLength(0);
		const creator = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, "u1"),
		});
		expect(creator?.activeEventId).toBe("e_a1");
	});

	it("falls back to the user's membership org when they have no event yet", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_c", name: "Org C" });
		await db.insert(users).values({
			id: "u2",
			email: "c@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db
			.insert(organizationMembers)
			.values({ organizationId: "org_c", userId: "u2" });

		const response = (await post(VALID_FORM, "u2")) as Response;
		expect(response.status).toBe(302);
		const created = await db.query.events.findFirst({
			where: (e, { eq }) => eq(e.slug, "devops-days-lyon-2027"),
		});
		expect(created?.organizationId).toBe("org_c");
	});

	it("sends a membership-less admin to /onboarding instead of failing", async () => {
		const db = getDb(env);
		await db.insert(users).values({
			id: "u3",
			email: "new@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		const headers = new Headers({ Cookie: await cookieFor("u3") });
		const thrown = await loader({
			context: CONTEXT,
			request: new Request("http://localhost/admin/events/new", { headers }),
			params: {},
		} as unknown as Parameters<typeof loader>[0]).catch((r: unknown) => r);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toBe("/onboarding");

		const posted = (await post(VALID_FORM, "u3")) as Response;
		expect(posted.headers.get("Location")).toBe("/onboarding");
		expect(await db.select().from(events)).toHaveLength(0);
	});

	it("denies a non-admin role and writes nothing", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_spk",
			email: "s@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const response = (await post(VALID_FORM, "u_spk")) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/403");
		expect(await db.select().from(events)).toHaveLength(2);
	});
});
