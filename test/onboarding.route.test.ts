import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { eq } from "drizzle-orm";
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
import { deriveGettingStarted } from "../app/domain/getting-started";
import { eventSlugBase } from "../app/settings/event-form";
import {
	action as datesAction,
	loader as datesLoader,
} from "../app/routes/onboarding.dates";
import {
	action as placeAction,
	loader as placeLoader,
} from "../app/routes/onboarding.place";
import OnboardingLayout from "../app/routes/onboarding";
import OnboardingStart, {
	action as startAction,
	loader as startLoader,
} from "../app/routes/onboarding._index";

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

const SETUP_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SETUP_EVENT_ID = "22222222-2222-4222-8222-222222222222";

const NAME_FORM = {
	setupOrganizationId: SETUP_ORGANIZATION_ID,
	setupEventId: SETUP_EVENT_ID,
	conferenceName: "Devcon 2027",
	slug: "devcon-2027",
};

type Handler = (args: never) => unknown;

function call<H extends Handler>(
	handler: H,
	path: string,
	init: RequestInit,
	cookie?: string,
) {
	const headers = new Headers(init.headers);
	if (cookie) headers.set("Cookie", cookie);
	return handler({
		context: CONTEXT,
		request: new Request(`http://localhost${path}`, { ...init, headers }),
		params: {},
	} as unknown as never) as ReturnType<H>;
}

function post<H extends Handler>(
	handler: H,
	path: string,
	body: Record<string, string>,
	cookie?: string,
) {
	return call(
		handler,
		path,
		{ method: "POST", body: new URLSearchParams(body) },
		cookie,
	);
}

/** Every step redirects rather than returning data on success, and the gates
 * throw redirects — one helper so both read the same at the call site. */
async function settled(promise: unknown): Promise<unknown> {
	return await Promise.resolve(promise).catch((thrown: unknown) => thrown);
}

function locationOf(result: unknown): string | null {
	expect(result).toBeInstanceOf(Response);
	return (result as Response).headers.get("Location");
}

/** Walks a brand-new user through naming so leftover dates/place routes have an event. */
async function completeStepOne(cookie: string, name = "Devcon 2027") {
	const result = await settled(
		post(
			startAction,
			"/onboarding",
			{ ...NAME_FORM, conferenceName: name, slug: eventSlugBase(name) },
			cookie,
		),
	);
	expect(locationOf(result)).toBe(`/schedule/${eventSlugBase(name)}`);
	const [event] = await getDb(env).select().from(events);
	return event;
}

function renderNameStep(
	actionData?: Parameters<typeof OnboardingStart>[0]["actionData"],
) {
	const router = createMemoryRouter(
		[
			{
				path: "/onboarding",
				element: createElement(OnboardingLayout),
				children: [
					{
						index: true,
						element: createElement(OnboardingStart, {
							loaderData: {
								setupOrganizationId: SETUP_ORGANIZATION_ID,
								setupEventId: SETUP_EVENT_ID,
							},
							actionData,
						} as unknown as Parameters<typeof OnboardingStart>[0]),
					},
				],
			},
		],
		{ initialEntries: ["/onboarding"] },
	);
	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("onboarding step 1 — name your conference", () => {
	it("mints UUID setup IDs that the form can preserve across a replay", async () => {
		const { cookie } = await seedSessionUser();

		const data = await call(startLoader, "/onboarding", {}, cookie);

		expect(data.setupOrganizationId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(data.setupEventId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(data.setupOrganizationId).not.toBe(data.setupEventId);
	});

	it("turns one name into org + membership + event + templates and opens the public site", async () => {
		const { cookie, userId } = await seedSessionUser();

		const result = await settled(
			post(startAction, "/onboarding", NAME_FORM, cookie),
		);

		expect(locationOf(result)).toBe("/schedule/devcon-2027");

		const db = getDb(env);
		const orgs = await db.select().from(organizations);
		expect(orgs).toHaveLength(1);
		// The organization is named after the first conference — nobody is asked
		// twice on their first screen; /admin/settings/team renames it later.
		expect(orgs[0]?.name).toBe("Devcon 2027");

		const members = await db.select().from(organizationMembers);
		expect(members).toHaveLength(1);
		expect(members[0]?.organizationId).toBe(orgs[0]?.id);
		expect(members[0]?.userId).toBe(userId);

		const [event] = await db.select().from(events);
		expect(event?.organizationId).toBe(orgs[0]?.id);
		expect(event?.name).toBe("Devcon 2027");
		// Derived, never asked: the public URL falls out of the name.
		expect(event?.slug).toBe("devcon-2027");

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

	it("does not create an event when the tidy slug is taken until the organizer confirms a slug", async () => {
		const { cookie } = await seedSessionUser();
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_other", name: "Other" });
		await db.insert(events).values({
			id: "e_other",
			organizationId: "org_other",
			name: "Other Event",
			slug: "devcon-2027",
		});

		const result = await post(startAction, "/onboarding", NAME_FORM, cookie);

		expect(result).not.toBeInstanceOf(Response);
		expect(
			(result as { fieldErrors?: { slug?: string[] } }).fieldErrors?.slug?.[0],
		).toMatch(/taken/i);
		expect(await db.select().from(events)).toHaveLength(1);
	});

	it("creates the event under the slug the organizer confirmed", async () => {
		const { cookie } = await seedSessionUser();
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_other", name: "Other" });
		await db.insert(events).values({
			id: "e_other",
			organizationId: "org_other",
			name: "Other Event",
			slug: "devcon-2027",
		});

		const result = await settled(
			post(
				startAction,
				"/onboarding",
				{ ...NAME_FORM, slug: "devcon-2027-west" },
				cookie,
			),
		);

		expect(locationOf(result)).toBe("/schedule/devcon-2027-west");
		const [created] = await db
			.select()
			.from(events)
			.where(eq(events.id, SETUP_EVENT_ID));
		expect(created?.slug).toBe("devcon-2027-west");
	});

	it("falls back to a usable slug when the name has no URL-safe characters", async () => {
		const { cookie } = await seedSessionUser();

		const result = await settled(
			post(
				startAction,
				"/onboarding",
				{ ...NAME_FORM, conferenceName: "!!!", slug: "event" },
				cookie,
			),
		);

		expect(locationOf(result)).toBe("/schedule/event");
		const [created] = await getDb(env).select().from(events);
		expect(created?.slug).toBe("event");
		expect(created?.name).toBe("!!!");
	});

	it("rejects an empty name and creates nothing", async () => {
		const { cookie } = await seedSessionUser();

		const result = await post(
			startAction,
			"/onboarding",
			{ ...NAME_FORM, conferenceName: "   " },
			cookie,
		);

		expect(
			(result as { fieldErrors?: { conferenceName?: string[] } }).fieldErrors
				?.conferenceName?.[0],
		).toBeTruthy();
		expect(await getDb(env).select().from(organizations)).toHaveLength(0);
	});

	it("resumes a membership-only setup into the existing organization without renaming it", async () => {
		const { cookie } = await seedSessionUser({ withOrg: true });

		const result = await settled(
			post(startAction, "/onboarding", NAME_FORM, cookie),
		);

		expect(locationOf(result)).toBe("/schedule/devcon-2027");
		const db = getDb(env);
		const orgs = await db.select().from(organizations);
		expect(orgs).toHaveLength(1);
		expect(orgs[0]?.id).toBe("org1");
		// An invited member arriving here must not rename their colleagues' org.
		expect(orgs[0]?.name).toBe("Existing Org");

		const eventRows = await db.select().from(events);
		expect(eventRows).toHaveLength(1);
		expect(eventRows[0]?.organizationId).toBe("org1");
	});

	it("coalesces concurrent submissions into one organization and first event", async () => {
		const { cookie } = await seedSessionUser();

		const results = await Promise.all([
			settled(post(startAction, "/onboarding", NAME_FORM, cookie)),
			settled(post(startAction, "/onboarding", NAME_FORM, cookie)),
		]);

		for (const result of results) {
			expect(locationOf(result)).toBe("/schedule/devcon-2027");
		}
		const db = getDb(env);
		expect(await db.select().from(organizations)).toHaveLength(1);
		expect(await db.select().from(organizationMembers)).toHaveLength(1);
		expect(await db.select().from(events)).toHaveLength(1);
	});

	it("does not treat a reused setup ID with a different name as a successful replay", async () => {
		const { cookie } = await seedSessionUser();

		const results = await Promise.all([
			settled(post(startAction, "/onboarding", NAME_FORM, cookie)),
			settled(
				post(
					startAction,
					"/onboarding",
					{ ...NAME_FORM, conferenceName: "Different Event" },
					cookie,
				),
			),
		]);

		expect(results.filter((r) => r instanceof Response)).toHaveLength(1);
		expect(
			results.filter(
				(r) =>
					!(r instanceof Response) &&
					Boolean((r as { formError?: string }).formError),
			),
		).toHaveLength(1);
		const db = getDb(env);
		expect(await db.select().from(organizations)).toHaveLength(1);
		expect(await db.select().from(events)).toHaveLength(1);
	});

	it("asks only for the conference name and a public URL", () => {
		const html = renderNameStep();
		expect(html).toContain("What conference are you running?");
		expect(html).toContain(
			"This name goes on a public page you can send someone right now.",
		);
		expect(html).toContain("Open the site");
		expect(html).toContain("Go to admin instead");
		expect(html).toContain("/schedule/");
		expect(html).not.toContain("Dates");
		expect(html).not.toContain("Location");
		expect(html).not.toContain("Two short steps");
		expect(html).not.toContain("Continue");
	});

	it("opens admin instead when that is the posted intent", async () => {
		const { cookie } = await seedSessionUser();

		const result = await settled(
			post(
				startAction,
				"/onboarding",
				{ ...NAME_FORM, intent: "admin" },
				cookie,
			),
		);

		expect(locationOf(result)).toBe("/admin");
		expect(await getDb(env).select().from(events)).toHaveLength(1);
	});

	it("sends an organizer who already has an event to the dashboard, not back through setup", async () => {
		const { cookie } = await seedSessionUser();
		await completeStepOne(cookie);

		expect(
			locationOf(await settled(call(startLoader, "/onboarding", {}, cookie))),
		).toBe("/admin");
		expect(
			locationOf(
				await settled(post(startAction, "/onboarding", NAME_FORM, cookie)),
			),
		).toBe("/schedule/devcon-2027");
		const db = getDb(env);
		expect(await db.select().from(organizations)).toHaveLength(1);
		expect(await db.select().from(events)).toHaveLength(1);
	});

	it("refuses a setup form that lost its minted IDs instead of creating a second organization", async () => {
		const { cookie } = await seedSessionUser();

		const result = await post(
			startAction,
			"/onboarding",
			{ conferenceName: "Devcon 2027" },
			cookie,
		);

		expect((result as { formError?: string }).formError).toMatch(/expired/i);
		expect(await getDb(env).select().from(organizations)).toHaveLength(0);
	});

	it("uses the shared auth gate for anonymous visitors", async () => {
		expect(
			locationOf(await settled(call(startLoader, "/onboarding", {}))),
		).toBe("/login?redirectTo=%2Fonboarding");
	});
});

describe("leftover dates and place URLs are not first-run", () => {
	it("sends an organizer who already named a conference away from dates", async () => {
		const { cookie } = await seedSessionUser();
		await completeStepOne(cookie);

		expect(
			locationOf(
				await settled(call(datesLoader, "/onboarding/dates", {}, cookie)),
			),
		).toBe("/admin");
		expect(
			locationOf(
				await settled(
					post(datesAction, "/onboarding/dates", { intent: "skip" }, cookie),
				),
			),
		).toBe("/admin");
	});

	it("sends an organizer who already named a conference away from place", async () => {
		const { cookie } = await seedSessionUser();
		await completeStepOne(cookie);

		expect(
			locationOf(
				await settled(call(placeLoader, "/onboarding/place", {}, cookie)),
			),
		).toBe("/admin");
		expect(
			locationOf(
				await settled(
					post(placeAction, "/onboarding/place", { intent: "skip" }, cookie),
				),
			),
		).toBe("/admin");
	});

	it("restarts naming when there is no event to fill in yet", async () => {
		const { cookie } = await seedSessionUser();

		expect(
			locationOf(
				await settled(call(datesLoader, "/onboarding/dates", {}, cookie)),
			),
		).toBe("/onboarding");
		expect(
			locationOf(
				await settled(call(placeLoader, "/onboarding/place", {}, cookie)),
			),
		).toBe("/onboarding");
	});
});

describe("first-run leaves event basics for later", () => {
	it("reports an honest zero after naming the conference", async () => {
		const { cookie } = await seedSessionUser();
		const event = await completeStepOne(cookie);

		const [saved] = await getDb(env)
			.select()
			.from(events)
			.where(eq(events.id, event?.id ?? ""));
		const state = deriveGettingStarted({
			hasDates: Boolean(saved?.startsAt && saved?.endsAt),
			hasLocation: Boolean(saved?.location),
			trackCount: 0,
			formatCount: 0,
			publishedFormCount: 0,
			reviewerCount: 0,
			submissionCount: 0,
		});
		expect(state.doneCount).toBe(0);
		expect(state.steps.find((s) => s.id === "basics")?.done).toBe(false);
		expect(state.activeStepId).toBe("basics");
	});
});
