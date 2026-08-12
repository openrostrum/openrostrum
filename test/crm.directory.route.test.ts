import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	crmSegments,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { hashPassword } from "../app/lib/auth";
import CrmDirectory, {
	action,
	loader,
} from "../app/routes/admin.crm.directory";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";

type LoaderResult = {
	data: {
		people: Array<{
			email: string;
			firstName: string;
			companyName: string | null;
			possibleDuplicate: boolean;
			appearances: Array<{ eventName: string; status: string }>;
		}>;
		total: number;
		page: number;
	};
};

async function runLoader(userId: string, url: string): Promise<LoaderResult> {
	const request = await requestAs(userId, url);
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
}

async function runAction(userId: string, url: string, body: URLSearchParams) {
	const request = await requestAs(userId, url, { method: "POST", body });
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function renderDirectory(actionData: unknown): string {
	const Directory = CrmDirectory as unknown as ComponentType<{
		loaderData: unknown;
		actionData: unknown;
	}>;
	const loaderData = {
		people: [],
		total: 0,
		page: 1,
		perPage: 50,
		filters: {},
		events: [{ id: "e1", name: "DevFlow" }],
		segment: null,
	};
	const RoutesStub = createRoutesStub([
		{
			path: "/admin/crm/directory",
			Component: () => createElement(Directory, { loaderData, actionData }),
		},
	]);
	return renderToString(
		createElement(RoutesStub, {
			initialEntries: ["/admin/crm/directory"],
		}),
	);
}

describe("CRM directory", () => {
	it("repopulates every add-person field after an error", () => {
		const html = renderDirectory({
			addPerson: true,
			fieldErrors: { email: ["Enter a valid email address"] },
			values: {
				firstName: "Priya",
				lastName: "Raman",
				email: "not-an-email",
				jobTitle: "Principal Engineer",
				companyName: "Latticework Systems",
				initialEventId: "e1",
			},
		});

		expect(html).toMatch(/name="firstName"[^>]*value="Priya"/);
		expect(html).toMatch(/name="lastName"[^>]*value="Raman"/);
		expect(html).toMatch(/name="email"[^>]*value="not-an-email"/);
		expect(html).toMatch(/name="jobTitle"[^>]*value="Principal Engineer"/);
		expect(html).toMatch(/name="companyName"[^>]*value="Latticework Systems"/);
		expect(html).toMatch(/<option value="e1" selected="">DevFlow<\/option>/);
	});

	it("unions appearances into one person per email and never crosses the org boundary", async () => {
		await seedCrmBaseline();

		const org1 = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory",
		);
		// org1 has exactly three PEOPLE (Priya's two rows collapse by email);
		// org2's rows — including the same priya@example.com — never appear.
		expect(org1.data.total).toBe(3);
		const priya = org1.data.people.find((p) => p.email === "priya@example.com");
		expect(priya?.appearances.map((a) => a.eventName).sort()).toEqual([
			"AI Summit 2026",
			"DevFlow 2026",
		]);
		expect(
			org1.data.people.flatMap((p) => p.appearances.map((a) => a.eventName)),
		).not.toContain("Rival Conf");

		const org2 = await runLoader(
			"u_admin2",
			"http://localhost/admin/crm/directory",
		);
		expect(org2.data.total).toBe(3);
		const org2Priya = org2.data.people.find(
			(p) => p.email === "priya@example.com",
		);
		// Same email, different tenant: org2 sees ONLY its own appearance.
		expect(org2Priya?.appearances.map((a) => a.eventName)).toEqual([
			"Rival Conf",
		]);
		expect(org2.data.people.map((p) => p.email)).not.toContain(
			"marcus@example.com",
		);
	});

	it("narrows by company, event, and status; no filters restores the full list", async () => {
		await seedCrmBaseline();

		const byCompany = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory?company=lattice",
		);
		expect(byCompany.data.people.map((p) => p.email)).toEqual([
			"priya@example.com",
		]);

		const byEvent = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory?event=e2",
		);
		expect(byEvent.data.people.map((p) => p.email).sort()).toEqual([
			"priya.alt@example.com",
			"priya@example.com",
		]);

		const byStatus = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory?status=confirmed",
		);
		expect(byStatus.data.people.map((p) => p.email)).toEqual([
			"priya@example.com",
		]);

		const cleared = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory",
		);
		expect(cleared.data.total).toBe(3);
	});

	it("flags same-name different-email people, scoped to the org", async () => {
		await seedCrmBaseline();
		const { data } = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory",
		);
		const byEmail = new Map(data.people.map((p) => [p.email, p]));
		// Priya Raman exists under two org1 emails → both flagged.
		expect(byEmail.get("priya@example.com")?.possibleDuplicate).toBe(true);
		expect(byEmail.get("priya.alt@example.com")?.possibleDuplicate).toBe(true);
		// Marcus Okafor's name twin lives in ANOTHER org — no flag inside org1.
		expect(byEmail.get("marcus@example.com")?.possibleDuplicate).toBe(false);
	});

	it("paginates past 50 people instead of rendering an unbounded table", async () => {
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_admin1",
			email: "admin1@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db
			.insert(organizationMembers)
			.values({ id: "om1", organizationId: "org1", userId: "u_admin1" });
		await db
			.insert(events)
			.values({ id: "e1", organizationId: "org1", name: "E", slug: "e" });
		const inserts = [];
		for (let i = 0; i < 60; i += 1) {
			inserts.push(
				db.insert(contacts).values({
					id: `bulk${i}`,
					eventId: "e1",
					email: `speaker${i}@example.com`,
					firstName: "Speaker",
					lastName: `Number${String(i).padStart(2, "0")}`,
				}),
			);
		}
		const [head, ...rest] = inserts;
		if (head) await db.batch([head, ...rest]);

		const page2 = await runLoader(
			"u_admin1",
			"http://localhost/admin/crm/directory?page=2",
		);
		expect(page2.data.total).toBe(60);
		expect(page2.data.page).toBe(2);
		expect(page2.data.people).toHaveLength(10);
	});

	it("add-to-event copies the profile, is idempotent, and summarizes a bulk mix", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		// Bulk mix: marcus is new to e2, priya is already there (fixture).
		const bulk = new URLSearchParams({
			intent: "add-to-event",
			targetEventId: "e2",
		});
		bulk.append("emails", "marcus@example.com");
		bulk.append("emails", "priya@example.com");

		const first = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			bulk,
		)) as { data?: { notice?: string } };
		expect(first.data?.notice).toContain("1 added to AI Summit 2026");
		expect(first.data?.notice).toContain("1 already there");
		const [copy] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.eventId, "e2"))
			.then((rows) => rows.filter((r) => r.email === "marcus@example.com"));
		expect(copy?.firstName).toBe("Marcus");
		expect(copy?.companyName).toBe("BuildScale");
		expect(copy?.bio).toBe("<p>Platform engineering.</p>");
		// Workflow state never carries over — the new event starts at pending.
		expect(copy?.status).toBe("pending");

		// A single re-add reads as one person, and never duplicates the row.
		const single = new URLSearchParams({
			intent: "add-to-event",
			targetEventId: "e2",
		});
		single.append("emails", "marcus@example.com");
		const second = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			single,
		)) as { data?: { notice?: string } };
		expect(second.data?.notice).toContain(
			"Already a contact in AI Summit 2026",
		);
		const marcusRows = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(eq(contacts.email, "marcus@example.com"));
		expect(marcusRows).toHaveLength(2); // e1 original + ONE e2 copy
	});

	it("refuses pushing a person into another organization's event", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const body = new URLSearchParams({
			intent: "add-to-event",
			targetEventId: "e3", // org2's event
		});
		body.append("emails", "marcus@example.com");

		const result = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			body,
		)) as { data?: { formError?: string } };
		expect(result.data?.formError).toMatch(/does not belong/i);
		// The refusal is load-bearing: no write happened in org2's event.
		const leaked = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(eq(contacts.eventId, "e3"));
		expect(leaked.map((r) => r.id).sort()).toEqual([
			"c_marcus_org2",
			"c_priya_org2",
			"c_zara_org2",
		]);
	});

	it("retains every add-person field after validation fails", async () => {
		await seedCrmBaseline();
		const body = new URLSearchParams({
			intent: "add-person",
			firstName: "",
			lastName: "Raman",
			email: "not-an-email",
			jobTitle: "Principal Engineer",
			companyName: "Latticework Systems",
			initialEventId: "e1",
		});

		const result = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			body,
		)) as { data?: { values?: Record<string, string> } };

		expect(result.data?.values).toEqual({
			firstName: "",
			lastName: "Raman",
			email: "not-an-email",
			jobTitle: "Principal Engineer",
			companyName: "Latticework Systems",
			initialEventId: "e1",
		});
	});

	it("creates a new organization person in the selected event and redirects to their CRM profile", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const result = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			new URLSearchParams({
				intent: "add-person",
				firstName: "Ada",
				lastName: "Lovelace",
				email: " Ada@Example.com ",
				jobTitle: "Researcher",
				companyName: "Analytical Engines",
				initialEventId: "e1",
			}),
		)) as Response;

		expect(result.status).toBe(302);
		expect(result.headers.get("Location")).toBe(
			"/admin/crm/person/ada%40example.com",
		);
		const created = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "ada@example.com"));
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			eventId: "e1",
			firstName: "Ada",
			lastName: "Lovelace",
			jobTitle: "Researcher",
			companyName: "Analytical Engines",
		});
	});

	it("blocks an exact organization email and warns before creating a same-name person", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const exact = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			new URLSearchParams({
				intent: "add-person",
				firstName: "Different",
				lastName: "Name",
				email: " PRIYA@EXAMPLE.COM ",
				initialEventId: "e1",
			}),
		)) as {
			data?: {
				existing?: { email: string };
				values?: Record<string, string>;
			};
		};
		expect(exact.data?.existing?.email).toBe("priya@example.com");
		expect(exact.data?.values).toMatchObject({
			firstName: "Different",
			lastName: "Name",
			email: " PRIYA@EXAMPLE.COM ",
			initialEventId: "e1",
		});
		expect(
			(
				await db
					.select({ id: contacts.id })
					.from(contacts)
					.where(eq(contacts.email, "priya@example.com"))
			).length,
		).toBe(2);

		const probableBody = new URLSearchParams({
			intent: "add-person",
			firstName: "Priya",
			lastName: "Raman",
			email: "priya.third@example.com",
			initialEventId: "e1",
		});
		const warning = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			probableBody,
		)) as {
			data?: {
				duplicate?: { name: string; email: string };
				values?: Record<string, string>;
			};
		};
		expect(warning.data?.duplicate).toEqual({
			name: "Priya Raman",
			email: "priya@example.com",
		});
		expect(warning.data?.values).toMatchObject({
			firstName: "Priya",
			lastName: "Raman",
			email: "priya.third@example.com",
			initialEventId: "e1",
		});
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "priya.third@example.com")),
		).toHaveLength(0);

		probableBody.set("confirmDuplicate", "1");
		const confirmed = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			probableBody,
		)) as Response;
		expect(confirmed.status).toBe(302);
		expect(confirmed.headers.get("Location")).toBe(
			"/admin/crm/person/priya.third%40example.com",
		);
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "priya.third@example.com")),
		).toHaveLength(1);
	});

	it("rejects incomplete people and another organization's initial event", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const incomplete = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			new URLSearchParams({
				intent: "add-person",
				firstName: "",
				lastName: "",
				email: "not-an-email",
				initialEventId: "",
			}),
		)) as { data?: { fieldErrors?: Record<string, string[]> } };
		expect(Object.keys(incomplete.data?.fieldErrors ?? {}).sort()).toEqual([
			"email",
			"firstName",
			"initialEventId",
			"lastName",
		]);

		const foreign = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			new URLSearchParams({
				intent: "add-person",
				firstName: "Grace",
				lastName: "Hopper",
				email: "grace@example.com",
				initialEventId: "e3",
			}),
		)) as {
			data?: {
				fieldErrors?: Record<string, string[]>;
				values?: Record<string, string>;
			};
		};
		expect(foreign.data?.fieldErrors?.initialEventId?.[0]).toMatch(
			/organization/i,
		);
		expect(foreign.data?.values).toMatchObject({
			firstName: "Grace",
			lastName: "Hopper",
			email: "grace@example.com",
			initialEventId: "e3",
		});
		expect(
			await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.email, "grace@example.com")),
		).toHaveLength(0);
	});

	it("retains every add-person field after a generic save failure", async () => {
		await seedCrmBaseline();
		const body = new URLSearchParams({
			intent: "add-person",
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada@example.com",
			jobTitle: "Researcher",
			companyName: "Analytical Engines",
			initialEventId: "e1",
		});
		await env.DB.prepare(`
			CREATE TRIGGER fail_crm_contact_insert
			BEFORE INSERT ON contacts
			BEGIN
				SELECT RAISE(ABORT, 'forced failure');
			END
		`).run();

		const result = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			body,
		)) as { data?: { formError?: string; values?: Record<string, string> } };
		await env.DB.prepare("DROP TRIGGER fail_crm_contact_insert").run();

		expect(result.data?.formError).toMatch(/could not add/i);
		expect(result.data?.values).toEqual({
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada@example.com",
			jobTitle: "Researcher",
			companyName: "Analytical Engines",
			initialEventId: "e1",
		});
	});

	it("saves the current filter set as a segment and rejects blank or duplicate saves", async () => {
		await seedCrmBaseline();
		const db = getDb(env);

		const saved = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory?company=lattice",
			new URLSearchParams({ intent: "save-segment", name: "AI Experts" }),
		)) as Response;
		expect(saved.status).toBe(302);
		expect(saved.headers.get("Location")).toBe("/admin/crm/segments");
		const [segment] = await db.select().from(crmSegments);
		expect(segment?.organizationId).toBe("org1");
		expect(segment?.filters).toEqual({ company: "lattice" });

		const unfiltered = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory",
			new URLSearchParams({ intent: "save-segment", name: "Everyone" }),
		)) as { formError?: string };
		expect(unfiltered.formError).toMatch(/at least one filter/i);

		const duplicate = (await runAction(
			"u_admin1",
			"http://localhost/admin/crm/directory?company=lattice",
			new URLSearchParams({ intent: "save-segment", name: "AI Experts" }),
		)) as { formError?: string };
		expect(duplicate.formError).toMatch(/already exists/i);
		expect(await db.select().from(crmSegments)).toHaveLength(1);
	});
});
