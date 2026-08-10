import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	forms,
	organizations,
	participants,
	submissions,
} from "../app/db/schema";

async function seedEvent() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Test Org" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "Test Event",
		slug: "test-event",
	});
	return db;
}

describe("participant role schema", () => {
	it("rejects the same role link but permits another role for the same contact", async () => {
		const db = await seedEvent();
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "speaker@example.com",
			firstName: "Test",
			lastName: "Speaker",
		});
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Role-aware session",
		});

		await db
			.insert(participants)
			.values({ submissionId: "s1", contactId: "c1", role: "speaker" });
		await expect(
			db
				.insert(participants)
				.values({ submissionId: "s1", contactId: "c1", role: "speaker" }),
		).rejects.toThrow();
		await expect(
			db
				.insert(participants)
				.values({ submissionId: "s1", contactId: "c1", role: "moderator" }),
		).resolves.toBeDefined();
	});

	it("defaults new forms to notifying existing contacts", async () => {
		const db = await seedEvent();
		await db.insert(forms).values({
			id: "f1",
			eventId: "e1",
			internalName: "Call for proposals",
		});

		const row = (await db.select().from(forms).where(eq(forms.id, "f1")))[0];
		expect(row?.notifyExistingContacts).toBe(true);
	});
});
