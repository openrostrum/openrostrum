import { env } from "cloudflare:test";
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
import { action, loader } from "../app/routes/admin.settings.airtable";

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
				webhookConfigured: boolean;
				tables: Array<{ table: string; linked: number }>;
			};
		};
		expect(result.data.state).toBe("ready");
		expect(result.data.webhookConfigured).toBe(false);
		expect(result.data.tables).toEqual([
			expect.objectContaining({ table: "submissions", linked: 2 }),
			expect.objectContaining({ table: "contacts", linked: 1 }),
			expect.objectContaining({ table: "task_assignments", linked: 0 }),
		]);
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
