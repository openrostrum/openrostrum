import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contacts } from "../app/db/schema";
import { executeImportWrites } from "../app/domain/contact-import";
import type { RowResult } from "../app/lib/contact-import";
import { createTimings } from "../app/lib/track";
import CrmDirectory from "../app/routes/admin.crm.directory";
import ImportDirectory, {
	action,
} from "../app/routes/admin.crm.directory_.import";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";

const URL_IMPORT = "http://localhost/admin/crm/directory/import";

type Step = {
	step: string;
	formError?: string;
	targetEventId?: string | null;
	headers?: string[];
	rowCount?: number;
	guesses?: Record<string, number | null>;
	mapping?: Record<string, number | null>;
	probableDuplicates?: Array<{
		row: number;
		name: string;
		email: string;
		existingEmail: string;
	}>;
	added?: number;
	linked?: number;
	merged?: number;
	skipped?: number;
	results?: RowResult[];
};

async function runAction(userId: string, body: FormData): Promise<Step> {
	const request = await requestAs(userId, URL_IMPORT, {
		method: "POST",
		body,
	});
	const result = (await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0])) as unknown as
		| Step
		| { data: Step };
	return "data" in result ? result.data : result;
}

function upload(
	userId: string,
	csv: string,
	targetEventId: string | null,
): Promise<Step> {
	const form = new FormData();
	form.set("intent", "upload");
	if (targetEventId !== null) form.set("targetEventId", targetEventId);
	form.set("file", new File([csv], "people.csv", { type: "text/csv" }));
	return runAction(userId, form);
}

function importRows(
	userId: string,
	options: {
		csv: string;
		targetEventId: string | null;
		mapping: Record<string, string>;
		duplicatePolicy?: "skip" | "create";
	},
): Promise<Step> {
	const form = new FormData();
	form.set("intent", "import");
	form.set("csvB64", btoa(options.csv));
	if (options.targetEventId !== null)
		form.set("targetEventId", options.targetEventId);
	for (const [key, value] of Object.entries(options.mapping)) {
		form.set(`map_${key}`, value);
	}
	if (options.duplicatePolicy)
		form.set("duplicatePolicy", options.duplicatePolicy);
	return runAction(userId, form);
}

/** first,last,email,company,title — the mapping every fixture below uses. */
const MAPPING = {
	firstName: "0",
	lastName: "1",
	email: "2",
	companyName: "3",
	jobTitle: "4",
};

function csv(...rows: string[]): string {
	return ["First,Last,Email,Company,Job title", ...rows].join("\n");
}

function eventContacts(eventId: string) {
	return getDb(env)
		.select()
		.from(contacts)
		.where(eq(contacts.eventId, eventId));
}

function renderImport(loaderData: unknown, actionData?: unknown): string {
	const Import = ImportDirectory as unknown as ComponentType<{
		loaderData: unknown;
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/admin/crm/directory/import",
			Component: () => createElement(Import, { loaderData, actionData }),
		},
	]);
	return renderToString(
		createElement(RoutesStub, {
			initialEntries: ["/admin/crm/directory/import"],
		}),
	);
}

describe("org-level CSV import — choosing the target event", () => {
	it("guesses columns and carries the chosen event into the mapping step", async () => {
		await seedCrmBaseline();

		const result = await upload(
			"u_admin1",
			csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			"e2",
		);

		expect(result.step).toBe("map");
		expect(result.targetEventId).toBe("e2");
		expect(result.rowCount).toBe(1);
		expect(result.guesses?.email).toBe(2);
		expect(result.guesses?.firstName).toBe(0);
		expect(result.guesses?.companyName).toBe(3);
	});

	it("refuses an upload with no event picked", async () => {
		await seedCrmBaseline();

		const result = await upload(
			"u_admin1",
			csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			null,
		);

		expect(result.step).toBe("upload");
		expect(result.formError).toMatch(/event/i);
	});

	it("refuses another organization's event and writes nothing to it", async () => {
		await seedCrmBaseline();
		const before = await eventContacts("e3");

		const uploaded = await upload(
			"u_admin1",
			csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			"e3",
		);
		const imported = await importRows("u_admin1", {
			csv: csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			targetEventId: "e3",
			mapping: MAPPING,
		});

		expect(uploaded.step).toBe("upload");
		expect(uploaded.formError).toMatch(/does not belong to your organization/i);
		expect(imported.step).toBe("upload");
		expect(imported.formError).toMatch(/does not belong to your organization/i);
		expect(await eventContacts("e3")).toHaveLength(before.length);
	});
});

describe("org-level CSV import — outcomes", () => {
	it("adds strangers to the chosen event only", async () => {
		await seedCrmBaseline();

		const result = await importRows("u_admin1", {
			csv: csv("Ada,Byron,ada@example.com,Analytical Engines,Engineer"),
			targetEventId: "e2",
			mapping: MAPPING,
		});

		expect(result.step).toBe("done");
		expect(result.added).toBe(1);
		const onTarget = (await eventContacts("e2")).filter(
			(c) => c.email === "ada@example.com",
		);
		expect(onTarget).toHaveLength(1);
		expect(onTarget[0]?.companyName).toBe("Analytical Engines");
		expect(
			(await eventContacts("e1")).filter((c) => c.email === "ada@example.com"),
		).toHaveLength(0);
	});

	it("links a person already in the directory instead of creating a stranger", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		// Per-event workflow state must never ride along to the new appearance.
		await db
			.update(contacts)
			.set({ status: "confirmed" })
			.where(eq(contacts.id, "c_marcus_e1"));

		const result = await importRows("u_admin1", {
			csv: csv("Marcus,Okafor,MARCUS@example.com,BuildScale Cloud,CTO"),
			targetEventId: "e2",
			mapping: MAPPING,
		});

		expect(result.step).toBe("done");
		expect(result.linked).toBe(1);
		expect(result.added).toBe(0);
		expect(result.results?.[0]?.outcome).toBe("linked");
		const [linked] = (await eventContacts("e2")).filter(
			(c) => c.email === "marcus@example.com",
		);
		expect(linked).toBeDefined();
		// Carried from the existing profile…
		expect(linked?.bio).toBe("<p>Platform engineering.</p>");
		// …overlaid by the file…
		expect(linked?.companyName).toBe("BuildScale Cloud");
		// …and reset per event.
		expect(linked?.status).toBe("pending");
		const [source] = (await eventContacts("e1")).filter(
			(c) => c.id === "c_marcus_e1",
		);
		expect(source?.companyName).toBe("BuildScale");
		expect(source?.status).toBe("confirmed");
	});

	it("merges into the appearance that already exists on the chosen event", async () => {
		await seedCrmBaseline();

		const result = await importRows("u_admin1", {
			csv: csv(
				"Priya,Raman,priya@example.com,Latticework Systems,Staff Engineer",
			),
			targetEventId: "e2",
			mapping: MAPPING,
		});

		expect(result.step).toBe("done");
		expect(result.merged).toBe(1);
		expect(await eventContacts("e2")).toHaveLength(2);
		const [onE2] = (await eventContacts("e2")).filter(
			(c) => c.id === "c_priya_e2",
		);
		expect(onE2?.jobTitle).toBe("Staff Engineer");
		const [onE1] = (await eventContacts("e1")).filter(
			(c) => c.id === "c_priya_e1",
		);
		expect(onE1?.jobTitle).toBe("Principal Engineer");
	});

	it("never matches another organization's contact with the same email", async () => {
		await seedCrmBaseline();

		const result = await importRows("u_admin1", {
			csv: csv("Zara,Ito,zara@rival.com,Rival Co,Founder"),
			targetEventId: "e1",
			mapping: MAPPING,
		});

		expect(result.step).toBe("done");
		expect(result.added).toBe(1);
		expect(result.linked).toBe(0);
		expect(result.merged).toBe(0);
		const [foreign] = (await eventContacts("e3")).filter(
			(c) => c.id === "c_zara_org2",
		);
		expect(foreign?.jobTitle).toBeNull();
		expect(
			(await eventContacts("e1")).filter((c) => c.email === "zara@rival.com"),
		).toHaveLength(1);
	});

	it("accounts for duplicate and malformed rows without writing them", async () => {
		await seedCrmBaseline();

		const result = await importRows("u_admin1", {
			csv: csv(
				"Ada,Byron,ada@example.com,Analytical,Engineer",
				"Ada,Byron-Again,ADA@example.com,Analytical,Engineer",
				"Bob,Jones,not-an-email,,",
				"Jane,Doe,,,",
				",,orphan@example.com,,",
			),
			targetEventId: "e2",
			mapping: MAPPING,
		});

		expect(result.step).toBe("done");
		expect(result.added).toBe(1);
		expect(result.skipped).toBe(4);
		const reasons = (result.results ?? []).map((r) => r.reason);
		expect(reasons[1]).toMatch(/Duplicate of row 2 in this file/);
		expect(reasons[2]).toMatch(/Invalid email/);
		expect(reasons[3]).toMatch(/No email/);
		expect(reasons[4]).toMatch(/Missing a name/);
		expect(
			(await eventContacts("e2")).filter((c) => c.email.includes("ada")),
		).toHaveLength(1);
	});

	it("refuses a mapping with no email or no name column", async () => {
		await seedCrmBaseline();

		const noEmail = await importRows("u_admin1", {
			csv: csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			targetEventId: "e2",
			mapping: { firstName: "0", lastName: "1" },
		});
		const noName = await importRows("u_admin1", {
			csv: csv("Ada,Byron,ada@example.com,Analytical,Engineer"),
			targetEventId: "e2",
			mapping: { email: "2" },
		});

		expect(noEmail.step).toBe("map");
		expect(noEmail.formError).toMatch(/Map the Email column/);
		expect(noEmail.targetEventId).toBe("e2");
		expect(noName.step).toBe("map");
		expect(noName.formError).toMatch(/Map a name column/);
		expect(await eventContacts("e2")).toHaveLength(2);
	});

	it("caps the file size in rows", async () => {
		await seedCrmBaseline();
		const rows = Array.from(
			{ length: 1001 },
			(_, i) => `Ada,Byron${i},ada${i}@example.com,Analytical,Engineer`,
		);

		const result = await upload("u_admin1", csv(...rows), "e2");

		expect(result.step).toBe("upload");
		expect(result.formError).toMatch(/1000/);
	});
});

describe("org-level CSV import — probable duplicates across the organization", () => {
	const DUPLICATE_CSV = () =>
		csv("Priya,Raman,priya.new@example.com,Latticework Systems,Engineer");

	it("holds a same-name-and-company row for review against the whole org", async () => {
		await seedCrmBaseline();

		const result = await importRows("u_admin1", {
			csv: DUPLICATE_CSV(),
			targetEventId: "e1",
			mapping: MAPPING,
		});

		expect(result.step).toBe("review");
		expect(result.probableDuplicates).toHaveLength(1);
		expect(result.probableDuplicates?.[0]?.existingEmail).toBe(
			"priya@example.com",
		);
		expect(
			(await eventContacts("e1")).filter(
				(c) => c.email === "priya.new@example.com",
			),
		).toHaveLength(0);
	});

	it("skips or creates the probable duplicate on the organizer's decision", async () => {
		await seedCrmBaseline();

		const skipped = await importRows("u_admin1", {
			csv: DUPLICATE_CSV(),
			targetEventId: "e1",
			mapping: MAPPING,
			duplicatePolicy: "skip",
		});
		expect(skipped.step).toBe("done");
		expect(skipped.skipped).toBe(1);
		expect(
			(await eventContacts("e1")).filter(
				(c) => c.email === "priya.new@example.com",
			),
		).toHaveLength(0);

		const created = await importRows("u_admin1", {
			csv: DUPLICATE_CSV(),
			targetEventId: "e1",
			mapping: MAPPING,
			duplicatePolicy: "create",
		});
		expect(created.step).toBe("done");
		expect(created.added).toBe(1);
		expect(
			(await eventContacts("e1")).filter(
				(c) => c.email === "priya.new@example.com",
			),
		).toHaveLength(1);
	});
});

describe("import writes that fail partway", () => {
	it("reports every unwritten row instead of leaving a silent half-import", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const results: RowResult[] = [];
		const writes = Array.from({ length: 60 }, (_, i) => {
			// Rows 51 and 52 collide on (event, email) — the second batch throws.
			const email =
				i === 50 || i === 51
					? "bulk-clash@example.com"
					: `bulk${i}@example.com`;
			results.push({
				row: i + 2,
				name: `Bulk ${i}`,
				email,
				outcome: "added",
				reason: "New contact",
			});
			return {
				rowIndex: i,
				insert: {
					eventId: "e1",
					email,
					firstName: "Bulk",
					lastName: String(i),
				},
			};
		});

		const failure = await executeImportWrites(
			db,
			{ results, probableDuplicates: [], writes },
			createTimings(),
		);

		expect(failure).not.toBeNull();
		expect(results.slice(0, 50).every((r) => r.outcome === "added")).toBe(true);
		expect(results.slice(50).every((r) => r.outcome === "skipped")).toBe(true);
		expect(results[50]?.reason).toMatch(/Not written/);
		const written = (await eventContacts("e1")).filter((c) =>
			c.email.startsWith("bulk"),
		);
		expect(written).toHaveLength(50);
	});
});

describe("org-level import surfaces", () => {
	it("sends an organizer with no events to create one first", () => {
		const html = renderImport({ events: [] });

		expect(html).toMatch(/\/admin\/events\/new/);
		expect(html).not.toMatch(/name="file"/);
	});

	it("offers the events of the organization on the upload step", () => {
		const html = renderImport({
			events: [
				{ id: "e1", name: "DevFlow 2026" },
				{ id: "e2", name: "AI Summit 2026" },
			],
		});

		expect(html).toMatch(/name="file"/);
		expect(html).toMatch(/name="targetEventId"/);
		expect(html).toMatch(/DevFlow 2026/);
		expect(html).toMatch(/AI Summit 2026/);
	});

	it("makes the organizer pick the event instead of pre-selecting one", () => {
		const html = renderImport({
			events: [
				{ id: "e1", name: "DevFlow 2026" },
				{ id: "e2", name: "AI Summit 2026" },
			],
		});

		// Dropping a thousand people onto whichever event happened to sort first
		// is expensive to undo, so nothing is chosen until someone chooses it.
		expect(html).toMatch(/<option value=""[^>]*selected/);
		expect(html).not.toMatch(/<option value="e[12]"[^>]*selected/);
	});

	it("keeps the chosen event selected once it has been picked", () => {
		const html = renderImport(
			{
				events: [
					{ id: "e1", name: "DevFlow 2026" },
					{ id: "e2", name: "AI Summit 2026" },
				],
			},
			{
				step: "upload",
				formError: "Choose a CSV file to upload.",
				targetEventId: "e2",
			},
		);

		expect(html).toMatch(/<option value="e2"[^>]*selected/);
	});

	it("links to the importer from the directory", () => {
		const Directory = CrmDirectory as unknown as ComponentType<{
			loaderData: unknown;
			actionData: unknown;
		}>;
		const RoutesStub = createRoutesStub([
			{
				path: "/admin/crm/directory",
				Component: () =>
					createElement(Directory, {
						loaderData: {
							people: [],
							total: 0,
							page: 1,
							perPage: 50,
							filters: {},
							events: [{ id: "e1", name: "DevFlow" }],
							segment: null,
						},
						actionData: undefined,
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/admin/crm/directory"] }),
		);

		expect(html).toMatch(/href="\/admin\/crm\/directory\/import"/);
	});
});
