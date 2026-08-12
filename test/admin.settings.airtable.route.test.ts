import { env } from "cloudflare:test";
import { createElement, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	airtableLinks,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import AirtableSync, {
	action,
	loader,
} from "../app/routes/admin.settings.airtable";

// The admin sync surface: the Demo-org binding is enforced with an explicit
// "Airtable isn't configured for this organization" state (never a silent
// no-op), env config gates the controls, and Sync now runs out-of-band.

async function adminRequest(
	orgId: string,
	url = "http://localhost/admin/settings/airtable",
	init?: RequestInit,
): Promise<Request> {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: orgId, userId: "u_admin" });
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

async function seedOrg(orgId: string) {
	const db = getDb(env);
	await db.insert(organizations).values({ id: orgId, name: orgId });
	await db.insert(events).values({
		id: `e_${orgId}`,
		organizationId: orgId,
		name: "Conf",
		slug: `conf-${orgId}`,
	});
}

const CONFIGURED = {
	AIRTABLE_API_KEY: "pat_test",
	AIRTABLE_BASE_ID: "appTESTBASE",
};

function makeContext(overrides: Record<string, unknown> = {}) {
	const scheduled: Promise<unknown>[] = [];
	return {
		scheduled,
		context: {
			cloudflare: {
				env: { ...env, ...overrides },
				ctx: {
					waitUntil: (p: Promise<unknown>) => {
						scheduled.push(p);
					},
				},
			},
		},
	};
}

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

describe("/admin/settings/airtable", () => {
	it("shows the explicit not-configured state to an organization the base is not bound to", async () => {
		await seedOrg("org_acme");
		const request = await adminRequest("org_acme");
		const { context } = makeContext(CONFIGURED);
		const result = (await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs)) as unknown as { data: { state: string } };
		expect(result.data.state).toBe("org_unbound");
	});

	it("shows the env-unconfigured state to the Demo org when no base is bound", async () => {
		await seedOrg("org_demo");
		const request = await adminRequest("org_demo");
		const { context } = makeContext();
		const result = (await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs)) as unknown as { data: { state: string } };
		expect(result.data.state).toBe("env_unconfigured");
	});

	it("reports linked counts and webhook state for the bound Demo org", async () => {
		await seedOrg("org_demo");
		const db = getDb(env);
		await db.insert(airtableLinks).values([
			{ tableName: "submissions", recordId: "s1", airtableId: "rec1" },
			{ tableName: "submissions", recordId: "s2", airtableId: "rec2" },
			{ tableName: "contacts", recordId: "c1", airtableId: "rec3" },
		]);
		const request = await adminRequest("org_demo");
		const { context } = makeContext(CONFIGURED);
		const result = (await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs)) as unknown as {
			data: {
				state: string;
				webhook: {
					secretSet: boolean;
					refreshConfigured: boolean;
					lastPingAt: string | null;
				};
				tables: Array<{ table: string; linked: number }>;
			};
		};
		expect(result.data.state).toBe("ready");
		// Liveness is evidence-based: no ping received yet, whatever the config.
		expect(result.data.webhook).toEqual({
			secretSet: false,
			refreshConfigured: false,
			lastPingAt: null,
			lastPingLabel: null,
		});
		expect(result.data.tables).toEqual([
			expect.objectContaining({ table: "submissions", linked: 2 }),
			expect.objectContaining({ table: "contacts", linked: 1 }),
			expect.objectContaining({ table: "task_assignments", linked: 0 }),
		]);
	});

	// 10:00 in the seeded event's zone (America/Los_Angeles) — a different
	// calendar hour, and a different day, from the same instant read as UTC.
	const PACIFIC_MORNING = "2026-10-12T17:00:00.000Z";
	const PACIFIC_LABEL = "Oct 12, 2026, 10:00 AM PDT";

	it("stamps every sync timestamp in the event's timezone", async () => {
		await seedOrg("org_demo");
		const db = getDb(env);
		await db.insert(airtableLinks).values([
			{
				tableName: "$sync",
				recordId: "state",
				airtableId: "$sync:state",
				baseSnapshot: {
					lastRunAt: PACIFIC_MORNING,
					lastRunTrigger: "manual",
					lastRunStatus: "ok",
					pausedAt: PACIFIC_MORNING,
					pausedReason: "Airtable deleted 12 rows",
					recentConflicts: [
						{
							at: PACIFIC_MORNING,
							table: "submissions",
							recordId: "s1",
							field: "title",
						},
					],
				},
			},
			{
				tableName: "$sync",
				recordId: "webhook",
				airtableId: "$sync:webhook",
				baseSnapshot: { lastWebhookAt: PACIFIC_MORNING },
			},
		]);
		const request = await adminRequest("org_demo");
		const { context } = makeContext(CONFIGURED);
		const result = (await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs)) as unknown as {
			data: {
				webhook: { lastPingLabel: string | null };
				paused: { atLabel: string } | null;
				lastRun: { atLabel: string } | null;
				recentConflicts: Array<{ atLabel: string }>;
			};
		};
		expect(result.data.lastRun?.atLabel).toBe(PACIFIC_LABEL);
		expect(result.data.paused?.atLabel).toBe(PACIFIC_LABEL);
		expect(result.data.webhook.lastPingLabel).toBe(PACIFIC_LABEL);
		expect(result.data.recentConflicts[0]?.atLabel).toBe(PACIFIC_LABEL);
	});

	it("renders the server-formatted stamps, so hydration cannot shift them", async () => {
		await seedOrg("org_demo");
		const db = getDb(env);
		await db.insert(airtableLinks).values({
			tableName: "$sync",
			recordId: "state",
			airtableId: "$sync:state",
			baseSnapshot: {
				lastRunAt: PACIFIC_MORNING,
				lastRunTrigger: "manual",
				lastRunStatus: "ok",
			},
		});
		const request = await adminRequest("org_demo");
		const { context } = makeContext(CONFIGURED);
		const result = (await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs)) as unknown as { data: unknown };

		const RoutesStub = createRoutesStub([
			{
				path: "/",
				Component: () =>
					createElement(AirtableSync as ElementType, {
						loaderData: result.data,
						actionData: undefined,
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);
		expect(html).toContain(PACIFIC_LABEL);
	});

	it("refuses the sync action outside the Demo org and schedules nothing", async () => {
		await seedOrg("org_acme");
		const request = await adminRequest(
			"org_acme",
			"http://localhost/admin/settings/airtable",
			{ method: "POST", body: new URLSearchParams({ intent: "sync" }) },
		);
		const { context, scheduled } = makeContext(CONFIGURED);
		const result = (await action({
			context,
			request,
			params: {},
		} as unknown as ActionArgs)) as { formError?: string };
		expect(result.formError).toBe(
			"Airtable isn't configured for this organization.",
		);
		expect(scheduled).toHaveLength(0);
	});

	it("starts a background sync from the Demo org and redirects with feedback", async () => {
		await seedOrg("org_demo");
		const request = await adminRequest(
			"org_demo",
			"http://localhost/admin/settings/airtable",
			{ method: "POST", body: new URLSearchParams({ intent: "sync" }) },
		);
		const { context, scheduled } = makeContext(CONFIGURED);
		const response = (await action({
			context,
			request,
			params: {},
		} as unknown as ActionArgs)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(
			"/admin/settings/airtable?sync=started",
		);
		expect(scheduled).toHaveLength(1);
		// The tick's own behavior is pinned by the runner tests; here it only
		// matters that it was handed off and cannot reject the request.
		await expect(scheduled[0]).resolves.toHaveProperty("status");
	});

	it("gates the loader behind admin auth", async () => {
		await seedOrg("org_demo");
		const { context } = makeContext(CONFIGURED);
		const request = new Request("http://localhost/admin/settings/airtable");
		const thrown = await loader({
			context,
			request,
			params: {},
		} as unknown as LoaderArgs).catch((r: unknown) => r);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toContain("/login");
	});
});
