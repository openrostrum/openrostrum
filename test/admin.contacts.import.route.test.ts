import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import ImportContacts, { action } from "../app/routes/admin.contacts_.import";

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

async function seedEvent(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	await db
		.insert(events)
		.values({ id: "e1", organizationId: "org1", name: "E", slug: "e" });
}

const CONTEXT = { cloudflare: { env, ctx: {} } };

function run(request: Request) {
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function renderImport(actionData: unknown): string {
	const Import = ImportContacts as unknown as ComponentType<{
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(Import, { actionData }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

function importBody(csv: string, mapping: Record<string, string>): FormData {
	const form = new FormData();
	form.set("intent", "import");
	form.set("csvB64", btoa(csv));
	for (const [key, value] of Object.entries(mapping)) {
		form.set(`map_${key}`, value);
	}
	return form;
}

const FIXTURE_CSV = [
	"First,Surname,E-mail,Company,Status,Bio",
	"Dana,Kowalski,dana@example.com,Acme,invited,New person",
	"Priya,Raman,PRIYA@Example.com,Latticework,,Updated bio",
	"Bob,Jones,not-an-email,,,",
	"Jane,Doe,,,,",
	"Dana,Duplicate,dana@example.com,,,",
	",,orphan@example.com,,,",
	"Vip,Person,vip@example.com,,VIP,",
].join("\n");

const FIXTURE_MAPPING = {
	email: "2",
	firstName: "0",
	lastName: "1",
	companyName: "3",
	status: "4",
	bio: "5",
};

describe("CSV import", () => {
	it("maps uploaded headers with guesses before importing", async () => {
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File(["Email,First Name\na@b.co,Ann"], "roster.csv", {
				type: "text/csv",
			}),
		);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body: form },
		);
		await seedEvent();

		const result = (await run(request)) as {
			step: string;
			headers?: string[];
			rowCount?: number;
			guesses?: Record<string, number | null>;
		};

		expect(result.step).toBe("map");
		expect(result.headers).toEqual(["Email", "First Name"]);
		expect(result.rowCount).toBe(1);
		expect(result.guesses?.email).toBe(0);
		expect(result.guesses?.firstName).toBe(1);
	});

	it("accounts for every row: added, merged by email, or skipped with a reason", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body: importBody(FIXTURE_CSV, FIXTURE_MAPPING) },
		);
		await seedEvent();
		// Existing contact the file repeats (different case) → merge target.
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			status: "confirmed",
		});
		// Same email in ANOTHER org's event — dedupe is per event, so the file's
		// Dana must be ADDED here, never merged into the foreign row.
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db
			.insert(events)
			.values({ id: "e2", organizationId: "org2", name: "F", slug: "f" });
		await db.insert(contacts).values({
			id: "c_foreign",
			eventId: "e2",
			email: "dana@example.com",
			firstName: "Foreign",
			lastName: "Dana",
		});

		// The done step returns via data() so Server-Timing rides along.
		const result = (
			(await run(request)) as unknown as {
				data: {
					step: string;
					added: number;
					merged: number;
					skipped: number;
					results: Array<{ row: number; outcome: string; reason: string }>;
				};
			}
		).data;

		expect(result.step).toBe("done");
		expect(result.added).toBe(2); // Dana + Vip
		expect(result.merged).toBe(1); // Priya, case-insensitively
		expect(result.skipped).toBe(4);
		expect(result.results).toHaveLength(7);

		const byRow = new Map(result.results.map((r) => [r.row, r]));
		expect(byRow.get(4)?.reason).toMatch(/invalid email/i);
		expect(byRow.get(5)?.reason).toMatch(/no email/i);
		expect(byRow.get(6)?.reason).toMatch(/duplicate of row 2/i);
		expect(byRow.get(7)?.reason).toMatch(/missing a name/i);
		expect(byRow.get(8)?.outcome).toBe("added");
		expect(byRow.get(8)?.reason).toMatch(/unknown status "vip" ignored/i);

		// Dana landed in THIS event with her mapped fields and valid status.
		const [dana] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_foreign"));
		expect(dana?.firstName).toBe("Foreign"); // foreign row untouched
		const eventRows = await db
			.select()
			.from(contacts)
			.where(eq(contacts.eventId, "e1"));
		expect(eventRows).toHaveLength(3); // priya + dana + vip
		const newDana = eventRows.find((c) => c.email === "dana@example.com");
		expect(newDana?.companyName).toBe("Acme");
		expect(newDana?.status).toBe("invited");

		// Merge overwrote mapped non-empty fields and kept the rest.
		const [priya] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(priya?.bio).toBe("Updated bio");
		expect(priya?.companyName).toBe("Latticework");
		expect(priya?.status).toBe("confirmed"); // blank status column → unchanged

		// Unknown status never reaches the DB — the row lands as pending.
		const vip = eventRows.find((c) => c.email === "vip@example.com");
		expect(vip?.status).toBe("pending");
	});

	it("merges a full-name column as split first/last — never the whole name into first_name", async () => {
		const db = getDb(env);
		const csv = [
			"Name,Email,Company",
			"Samira Cole,SPEAKER@example.com,Agentic Labs",
			"Grace Hopper,grace@example.com,US Navy",
		].join("\n");
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody(csv, { email: "1", fullName: "0", companyName: "2" }),
			},
		);
		await seedEvent();
		await db.insert(contacts).values([
			{
				id: "c_sam",
				eventId: "e1",
				email: "speaker@example.com",
				firstName: "Sam",
				lastName: "Speaker",
			},
			// Stale last name in the DB — the split half must update it.
			{
				id: "c_grace",
				eventId: "e1",
				email: "grace@example.com",
				firstName: "Grace",
				lastName: "H",
			},
		]);

		const result = (
			(await run(request)) as unknown as {
				data: { step: string; merged: number; added: number };
			}
		).data;

		expect(result.step).toBe("done");
		expect(result.merged).toBe(2);
		expect(result.added).toBe(0);
		const [sam] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_sam"));
		expect(sam?.firstName).toBe("Samira");
		expect(sam?.lastName).toBe("Cole");
		expect(sam?.companyName).toBe("Agentic Labs");
		const [grace] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_grace"));
		expect(grace?.firstName).toBe("Grace");
		expect(grace?.lastName).toBe("Hopper");
	});

	it("splits full names on add: last space, 'Last, First', and mononyms", async () => {
		const db = getDb(env);
		const csv = [
			"Name,Email",
			"Ada Lovelace,ada@example.com",
			'"Watson, Mary Jane",mj@example.com',
			"Plato,plato@academy.gr",
		].join("\n");
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body: importBody(csv, { email: "1", fullName: "0" }) },
		);
		await seedEvent();

		const result = (
			(await run(request)) as unknown as {
				data: { step: string; added: number };
			}
		).data;

		expect(result.step).toBe("done");
		expect(result.added).toBe(3);
		const byEmail = new Map(
			(await db.select().from(contacts)).map((c) => [c.email, c]),
		);
		expect(byEmail.get("ada@example.com")).toMatchObject({
			firstName: "Ada",
			lastName: "Lovelace",
		});
		expect(byEmail.get("mj@example.com")).toMatchObject({
			firstName: "Mary Jane",
			lastName: "Watson",
		});
		expect(byEmail.get("plato@academy.gr")).toMatchObject({
			firstName: "Plato",
			lastName: "",
		});
	});

	it("merging a mononym full name never blanks the existing last name", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody("Name,Email\nSam,speaker@example.com", {
					email: "1",
					fullName: "0",
				}),
			},
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_sam",
			eventId: "e1",
			email: "speaker@example.com",
			firstName: "Sam",
			lastName: "Speaker",
		});

		await run(request);

		const [sam] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_sam"));
		expect(sam?.firstName).toBe("Sam");
		expect(sam?.lastName).toBe("Speaker");
	});

	it("reviews normalized name+company matches with a different email before writing", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody(
					[
						"First,Last,Email,Company",
						'" priya ",RAMAN,priya.alt@example.com,"  LATTICEWORK   SYSTEMS  "',
					].join("\n"),
					{
						email: "2",
						firstName: "0",
						lastName: "1",
						companyName: "3",
					},
				),
			},
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
		});

		const result = (await run(request)) as {
			step: string;
			probableDuplicates?: Array<{
				row: number;
				email: string;
				existingEmail: string;
			}>;
		};

		expect(result.step).toBe("review");
		expect(result.probableDuplicates).toEqual([
			{
				row: 2,
				name: "priya RAMAN",
				email: "priya.alt@example.com",
				existingEmail: "priya@example.com",
			},
		]);
		expect(await db.select().from(contacts)).toHaveLength(1);
	});

	it("reviews same-file name+company matches with different emails before any row is written", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody(
					[
						"First,Last,Email,Company",
						"Sam,Speaker,sam@example.com,Agentic Labs",
						" sam ,SPEAKER,sam.alt@example.com,  Agentic   Labs ",
					].join("\n"),
					{
						email: "2",
						firstName: "0",
						lastName: "1",
						companyName: "3",
					},
				),
			},
		);
		await seedEvent();

		const result = (await run(request)) as {
			step: string;
			probableDuplicates?: Array<{ row: number; existingEmail: string }>;
		};

		expect(result.step).toBe("review");
		expect(result.probableDuplicates).toEqual([
			expect.objectContaining({ row: 3, existingEmail: "sam@example.com" }),
		]);
		expect(await db.select().from(contacts)).toHaveLength(0);
	});

	it("reviews a later alias against identity changes planned by an exact-email merge", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody(
					[
						"First,Last,Email,Company",
						"Priya,Raman,old@example.com,Latticework Systems",
						"Priya,Raman,alias@example.com,Latticework Systems",
					].join("\n"),
					{
						email: "2",
						firstName: "0",
						lastName: "1",
						companyName: "3",
					},
				),
			},
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_old",
			eventId: "e1",
			email: "old@example.com",
			firstName: "Old",
			lastName: "Identity",
			companyName: "Old Company",
		});

		const result = (await run(request)) as {
			step: string;
			probableDuplicates?: Array<{ row: number; existingEmail: string }>;
		};

		expect(result.step).toBe("review");
		expect(result.probableDuplicates).toEqual([
			expect.objectContaining({ row: 3, existingEmail: "old@example.com" }),
		]);
		expect(await db.select().from(contacts)).toEqual([
			expect.objectContaining({
				email: "old@example.com",
				firstName: "Old",
				companyName: "Old Company",
			}),
		]);
	});

	it("adds the same normalized name at a different company without warning", async () => {
		const db = getDb(env);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody(
					"First,Last,Email,Company\nPriya,Raman,priya.alt@example.com,Other Company",
					{
						email: "2",
						firstName: "0",
						lastName: "1",
						companyName: "3",
					},
				),
			},
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
		});

		const result = (
			(await run(request)) as unknown as {
				data: { step: string; added: number; merged: number };
			}
		).data;

		expect(result).toMatchObject({ step: "done", added: 1, merged: 0 });
		expect(await db.select().from(contacts)).toHaveLength(2);
	});

	it("renders probable duplicate review with safe and explicit override actions", () => {
		const html = renderImport({
			step: "review",
			csvB64: "csv-payload",
			mapping: {
				email: 2,
				firstName: 0,
				lastName: 1,
				companyName: 3,
			},
			probableDuplicates: [
				{
					row: 2,
					name: "Priya Raman",
					email: "priya.alt@example.com",
					existingEmail: "priya@example.com",
				},
			],
		});

		expect(html).toContain("priya.alt@example.com");
		expect(html).toContain("priya@example.com");
		expect(html).toMatch(/<button[^>]*value="skip"[^>]*name="duplicatePolicy"/);
		expect(html).toMatch(
			/<button[^>]*value="create"[^>]*name="duplicatePolicy"/,
		);
		expect(html).toContain('name="csvB64" value="csv-payload"');
		expect(html).toContain('name="map_email" value="2"');
	});

	it("skips probable duplicates when the organizer chooses the safe import", async () => {
		const db = getDb(env);
		const body = importBody(
			"First,Last,Email,Company\nPriya,Raman,priya.alt@example.com,Latticework Systems",
			{
				email: "2",
				firstName: "0",
				lastName: "1",
				companyName: "3",
			},
		);
		body.set("duplicatePolicy", "skip");
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body },
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
		});

		const result = (
			(await run(request)) as unknown as {
				data: {
					step: string;
					added: number;
					skipped: number;
					results: Array<{ row: number; outcome: string }>;
				};
			}
		).data;

		expect(result.step).toBe("done");
		expect(result.added).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.results).toEqual([
			expect.objectContaining({ row: 2, outcome: "skipped" }),
		]);
		expect(await db.select().from(contacts)).toHaveLength(1);
	});

	it("creates a probable duplicate only after the organizer explicitly overrides the warning", async () => {
		const db = getDb(env);
		const body = importBody(
			"First,Last,Email,Company,Bio\nPriya,Raman,priya.alt@example.com,Latticework Systems,Imported bio",
			{
				email: "2",
				firstName: "0",
				lastName: "1",
				companyName: "3",
				bio: "4",
			},
		);
		body.set("duplicatePolicy", "create");
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body },
		);
		await seedEvent();
		await db.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
			bio: "Original bio",
		});

		const result = (
			(await run(request)) as unknown as {
				data: { added: number; merged: number };
			}
		).data;

		expect(result.added).toBe(1);
		expect(result.merged).toBe(0);
		const rows = await db.select().from(contacts);
		expect(rows).toHaveLength(2);
		expect(rows.find((row) => row.id === "c_priya")?.bio).toBe("Original bio");
		expect(rows.find((row) => row.email === "priya.alt@example.com")?.bio).toBe(
			"Imported bio",
		);
	});

	it("re-importing the same file merges every row and adds nothing", async () => {
		const db = getDb(env);
		const csv = [
			"Name,Email,Company",
			"Ada Lovelace,ADA@Example.com,Analytical Engines",
			"Grace Hopper,grace.hopper@example.com,US Navy",
		].join("\n");
		const mapping = { email: "1", fullName: "0", companyName: "2" };
		const first = await adminRequest("http://localhost/admin/contacts/import", {
			method: "POST",
			body: importBody(csv, mapping),
		});
		await seedEvent();
		await run(first);

		const setCookie = await createSession(env, "u_admin");
		const again = new Request("http://localhost/admin/contacts/import", {
			method: "POST",
			body: importBody(csv, mapping),
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		const result = (
			(await run(again)) as unknown as {
				data: { added: number; merged: number; skipped: number };
			}
		).data;

		expect(result.added).toBe(0);
		expect(result.merged).toBe(2);
		expect(result.skipped).toBe(0);
		const rows = await db.select().from(contacts);
		expect(rows).toHaveLength(2);
		expect(rows.map((c) => `${c.firstName}|${c.lastName}`).sort()).toEqual([
			"Ada|Lovelace",
			"Grace|Hopper",
		]);
	});

	it("guesses a bare 'name' header as the full-name column, unless split columns exist", async () => {
		const upload = (fileBody: string) => {
			const form = new FormData();
			form.set("intent", "upload");
			form.set(
				"file",
				new File([fileBody], "roster.csv", { type: "text/csv" }),
			);
			return form;
		};
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body: upload("Name,Email\nAda Lovelace,a@b.co") },
		);
		await seedEvent();
		const single = (await run(request)) as {
			guesses?: Record<string, number | null>;
		};
		expect(single.guesses?.fullName).toBe(0);

		const setCookie = await createSession(env, "u_admin");
		const both = (await run(
			new Request("http://localhost/admin/contacts/import", {
				method: "POST",
				body: upload("Name,First Name,Last Name,Email\nx,Ada,Lovelace,a@b.co"),
				headers: { Cookie: setCookie.split(";")[0] ?? "" },
			}),
		)) as { guesses?: Record<string, number | null> };
		expect(both.guesses?.firstName).toBe(1);
		expect(both.guesses?.lastName).toBe(2);
		// Guessing full name TOO would trip the exclusivity check on defaults.
		expect(both.guesses?.fullName).toBeNull();
	});

	it("refuses a mapping with no name column, and one with both name styles", async () => {
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody("a,b\nx,y@z.co", { email: "1" }),
			},
		);
		await seedEvent();
		const none = (await run(request)) as { step: string; formError?: string };
		expect(none.step).toBe("map");
		expect(none.formError).toMatch(/map a name column/i);

		const setCookie = await createSession(env, "u_admin");
		const both = (await run(
			new Request("http://localhost/admin/contacts/import", {
				method: "POST",
				body: importBody("name,first,email\nAda Lovelace,Ada,a@b.co", {
					email: "2",
					fullName: "0",
					firstName: "1",
				}),
				headers: { Cookie: setCookie.split(";")[0] ?? "" },
			}),
		)) as { step: string; formError?: string };
		expect(both.step).toBe("map");
		expect(both.formError).toMatch(/not both/i);
		expect(await getDb(env).select().from(contacts)).toHaveLength(0);
	});

	it("refuses an unmapped email column — dedupe would be meaningless", async () => {
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{
				method: "POST",
				body: importBody("a,b\nx,y", { firstName: "0" }),
			},
		);
		await seedEvent();

		const result = (await run(request)) as { step: string; formError?: string };
		expect(result.step).toBe("map");
		expect(result.formError).toMatch(/map the email column/i);
		expect(await getDb(env).select().from(contacts)).toHaveLength(0);
	});

	it("rejects files over the 1000-row limit outright", async () => {
		const rows = Array.from({ length: 1001 }, (_, i) => `P${i},L,p${i}@x.co`);
		const form = new FormData();
		form.set("intent", "upload");
		form.set(
			"file",
			new File([`first,last,email\n${rows.join("\n")}`], "big.csv", {
				type: "text/csv",
			}),
		);
		const request = await adminRequest(
			"http://localhost/admin/contacts/import",
			{ method: "POST", body: form },
		);
		await seedEvent();

		const result = (await run(request)) as { step: string; formError?: string };
		expect(result.step).toBe("upload");
		expect(result.formError).toMatch(/limit is 1000/i);
	});
});
