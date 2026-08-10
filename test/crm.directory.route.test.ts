import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
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
import { action, loader } from "../app/routes/admin.crm.directory";
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

describe("CRM directory", () => {
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
