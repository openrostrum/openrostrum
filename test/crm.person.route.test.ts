import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contactAnswers, crmNotes, fields } from "../app/db/schema";
import CrmPerson, {
	action,
	loader,
} from "../app/routes/admin.crm.person.$email";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";
import { catchThrown, thrownStatus } from "./thrown";

type LoaderResult = {
	data: {
		person: {
			firstName: string;
			companyName: string | null;
			appearances: Array<{ eventName: string; status: string }>;
			sameNamePeople: Array<{ email: string }>;
		};
		customFields: Array<{ id: string; name: string; value: string | null }>;
		notes: Array<{ body: string; authorName: string }>;
		noteCount: number;
		addableEvents: Array<{ id: string }>;
	};
};

async function runLoader(userId: string, email: string): Promise<LoaderResult> {
	const request = await requestAs(
		userId,
		`http://localhost/admin/crm/person/${encodeURIComponent(email)}`,
	);
	return (await loader({
		context: CONTEXT,
		request,
		params: { email },
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
}

function renderPerson(loaderData: unknown): string {
	const RouteComponent = CrmPerson as unknown as ComponentType<{
		loaderData: unknown;
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(RouteComponent, { loaderData }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("CRM person profile", () => {
	it("persists organization field values across profile reloads", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(fields).values({
			id: "person-field-diet",
			organizationId: "org1",
			eventId: null,
			recordType: "contact",
			name: "Dietary requirements",
			type: "text",
		});
		const email = "priya@example.com";
		const request = await requestAs(
			"u_admin1",
			`http://localhost/admin/crm/person/${encodeURIComponent(email)}`,
			{
				method: "POST",
				body: new URLSearchParams({
					intent: "save-custom-field",
					fieldId: "person-field-diet",
					value: "Vegetarian",
				}),
			},
		);
		const result = (await action({
			context: CONTEXT,
			request,
			params: { email },
		} as unknown as Parameters<typeof action>[0])) as {
			data?: { notice?: string };
		};
		expect(result.data?.notice).toMatch(/saved/i);

		const reloaded = await runLoader("u_admin1", email);
		expect(reloaded.data.customFields).toEqual([
			expect.objectContaining({
				id: "person-field-diet",
				name: "Dietary requirements",
				value: "Vegetarian",
			}),
		]);
	});

	it("rejects cross-organization custom-field and person writes", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(fields).values({
			id: "org2-person-field",
			organizationId: "org2",
			eventId: null,
			recordType: "contact",
			name: "Private rating",
			type: "number",
		});
		for (const [email, fieldId] of [
			["priya@example.com", "org2-person-field"],
			["zara@rival.com", "org2-person-field"],
		] as const) {
			const request = await requestAs(
				"u_admin1",
				`http://localhost/admin/crm/person/${encodeURIComponent(email)}`,
				{
					method: "POST",
					body: new URLSearchParams({
						intent: "save-custom-field",
						fieldId,
						value: "5",
					}),
				},
			);
			const result = (await action({
				context: CONTEXT,
				request,
				params: { email },
			} as unknown as Parameters<typeof action>[0])) as {
				customFieldError?: string;
			};
			expect(result.customFieldError).toBeTruthy();
		}
		expect(await db.select().from(contactAnswers)).toHaveLength(0);
	});

	it("shows the union of appearances, surfaces the same-name duplicate, and offers only missing events", async () => {
		await seedCrmBaseline();
		const { data } = await runLoader("u_admin1", "priya@example.com");
		expect(data.person.firstName).toBe("Priya");
		expect(data.person.appearances.map((a) => a.eventName).sort()).toEqual([
			"AI Summit 2026",
			"DevFlow 2026",
		]);
		// The other org1 Priya (different email) is the duplicate candidate;
		// org2's identically-named people never bleed in.
		expect(data.person.sameNamePeople.map((p) => p.email)).toEqual([
			"priya.alt@example.com",
		]);
		// Priya already appears in both org1 events — nothing left to add to.
		expect(data.addableEvents).toEqual([]);

		const marcus = await runLoader("u_admin1", "marcus@example.com");
		expect(marcus.data.addableEvents.map((e) => e.id)).toEqual(["e2"]);
	});

	it("explains an empty merge history and gives the next action", async () => {
		await seedCrmBaseline();
		const { data } = await runLoader("u_admin1", "priya@example.com");
		const html = renderPerson(data);

		expect(html).toContain("Merge history");
		expect(html).toContain("No completed merges");
		expect(html).toContain("Review possible duplicates");
	});

	it("persists internal notes across reloads", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		const email = "priya@example.com";
		const request = await requestAs(
			"u_admin1",
			`http://localhost/admin/crm/person/${encodeURIComponent(email)}`,
			{
				method: "POST",
				body: new URLSearchParams({
					intent: "add-note",
					body: "Met at DevFlow 2026 - strong on CI topics; shortlist for keynote.",
				}),
			},
		);
		await action({
			context: CONTEXT,
			request,
			params: { email },
		} as unknown as Parameters<typeof action>[0]);

		const [note] = await db.select().from(crmNotes);
		expect(note?.organizationId).toBe("org1");
		expect(note?.authorName).toBe("Org One Admin");

		// A fresh load — the "reload" — still carries the note.
		const reloaded = await runLoader("u_admin1", email);
		expect(reloaded.data.noteCount).toBe(1);
		expect(reloaded.data.notes[0]?.body).toBe(
			"Met at DevFlow 2026 - strong on CI topics; shortlist for keynote.",
		);
	});

	it("404s for a person who exists only in another organization", async () => {
		await seedCrmBaseline();
		// zara@rival.com is org2-only — org1's admin must not see her profile.
		const thrown = await catchThrown(() =>
			runLoader("u_admin1", "zara@rival.com"),
		);
		expect(thrownStatus(thrown)).toBe(404);
	});
});
