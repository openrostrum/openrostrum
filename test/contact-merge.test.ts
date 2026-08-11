import { env } from "cloudflare:test";
import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contactMerges,
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { buildContactMergePreview } from "../app/domain/contact-merge";
import { hashPassword } from "../app/lib/auth";

async function seedMergeBaseline() {
	const db = getDb(env);
	await db.insert(users).values([
		{
			id: "admin-a",
			email: "admin-a@example.com",
			passwordHash: await hashPassword("pw"),
			name: "Admin A",
			role: "admin",
		},
		{
			id: "admin-b",
			email: "admin-b@example.com",
			passwordHash: await hashPassword("pw"),
			name: "Admin B",
			role: "admin",
		},
	]);
	await db.insert(organizations).values([
		{ id: "org-a", name: "Org A" },
		{ id: "org-b", name: "Org B" },
	]);
	await db.insert(organizationMembers).values([
		{ id: "member-a", organizationId: "org-a", userId: "admin-a" },
		{ id: "member-b", organizationId: "org-b", userId: "admin-b" },
	]);
	await db.insert(events).values([
		{
			id: "event-a1",
			organizationId: "org-a",
			name: "Event A1",
			slug: "event-a1",
		},
		{
			id: "event-a2",
			organizationId: "org-a",
			name: "Event A2",
			slug: "event-a2",
		},
		{
			id: "event-b1",
			organizationId: "org-b",
			name: "Event B1",
			slug: "event-b1",
		},
	]);
	await db.insert(contacts).values([
		{
			id: "survivor-a1",
			eventId: "event-a1",
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			companyName: "Analytical Engines",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			id: "source-a1",
			eventId: "event-a1",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			jobTitle: "Researcher",
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
		{
			id: "source-a2",
			eventId: "event-a2",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			createdAt: new Date("2026-03-01T00:00:00Z"),
		},
		{
			id: "foreign-b1",
			eventId: "event-b1",
			email: "foreign@example.com",
			firstName: "Foreign",
			lastName: "Person",
		},
	]);
}

describe("contact merge", () => {
	it("enforces one audit per organization merge key", async () => {
		await seedMergeBaseline();
		const insert = env.DB.prepare(
			`INSERT INTO contact_merges
			 (id, organization_id, source_email, survivor_email, actor_id, actor_name,
			  idempotency_key, summary, retired_contacts, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
		);
		await insert
			.bind(
				"merge-1",
				"org-a",
				"ada.alt@example.com",
				"ada@example.com",
				"admin-a",
				"Admin A",
				"11111111-1111-4111-8111-111111111111",
				"{}",
				"[]",
			)
			.run();

		await expect(
			insert
				.bind(
					"merge-2",
					"org-a",
					"other@example.com",
					"ada@example.com",
					"admin-a",
					"Admin A",
					"11111111-1111-4111-8111-111111111111",
					"{}",
					"[]",
				)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it("previews each source event and whether the survivor row must be created", async () => {
		await seedMergeBaseline();
		const result = await buildContactMergePreview(
			getDb(env),
			"org-a",
			"ada.alt@example.com",
			"ada@example.com",
		);

		expect(result).toMatchObject({
			ok: true,
			preview: {
				source: { email: "ada.alt@example.com" },
				survivor: { email: "ada@example.com" },
				events: [
					{
						eventId: "event-a1",
						sourceContactId: "source-a1",
						survivorContactId: "survivor-a1",
						createsSurvivor: false,
					},
					{
						eventId: "event-a2",
						sourceContactId: "source-a2",
						survivorContactId: null,
						createsSurvivor: true,
					},
				],
				summary: {
					eventContactsCreated: 1,
					contactsRetired: 2,
					profileFieldsFilled: 1,
				},
			},
		});
	});

	it("treats a foreign source or survivor as missing without writing", async () => {
		await seedMergeBaseline();
		const db = getDb(env);

		expect(
			await buildContactMergePreview(
				db,
				"org-a",
				"foreign@example.com",
				"ada@example.com",
			),
		).toEqual({
			ok: false,
			code: "missing",
			reason: "Both contacts must exist in your organization.",
		});
		expect(
			await buildContactMergePreview(
				db,
				"org-a",
				"ada.alt@example.com",
				"foreign@example.com",
			),
		).toEqual({
			ok: false,
			code: "missing",
			reason: "Both contacts must exist in your organization.",
		});
		expect(await db.select({ n: count() }).from(contactMerges)).toEqual([
			{ n: 0 },
		]);
	});
});
