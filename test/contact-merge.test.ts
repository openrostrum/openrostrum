import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { hashPassword } from "../app/lib/auth";

async function seedMergeBaseline() {
	const db = getDb(env);
	await db.insert(users).values({
		id: "admin-a",
		email: "admin-a@example.com",
		passwordHash: await hashPassword("pw"),
		name: "Admin A",
		role: "admin",
	});
	await db.insert(organizations).values({ id: "org-a", name: "Org A" });
	await db.insert(organizationMembers).values({
		id: "member-a",
		organizationId: "org-a",
		userId: "admin-a",
	});
	await db.insert(events).values({
		id: "event-a",
		organizationId: "org-a",
		name: "Event A",
		slug: "event-a",
	});
	await db.insert(contacts).values([
		{
			id: "contact-survivor",
			eventId: "event-a",
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
		},
		{
			id: "contact-source",
			eventId: "event-a",
			email: "ada.alt@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
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
});
