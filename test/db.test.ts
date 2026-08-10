import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events, organizations, submissions } from "../app/db/schema";

// Proves Drizzle talks to D1 inside workerd against the real migrated schema.
describe("D1 + Drizzle (in workerd)", () => {
	it("inserts an event + submission and reads it back", async () => {
		const db = getDb(env);

		await db.insert(organizations).values({ id: "org_test", name: "Test Org" });
		await db.insert(events).values({
			id: "e_test",
			organizationId: "org_test",
			name: "Test Event",
			slug: "test-event",
		});
		await db.insert(submissions).values({
			id: "s_test",
			eventId: "e_test",
			title: "Hello from workerd",
			status: "pending",
		});

		const rows = await db
			.select()
			.from(submissions)
			.where(eq(submissions.eventId, "e_test"));

		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe("Hello from workerd");
		expect(rows[0]?.status).toBe("pending");
		expect(rows[0]?.createdAt).toBeInstanceOf(Date);
	});

	// Proves per-test isolation (test/setup.ts): reusing id "e_test" + slug here
	// would trip a UNIQUE constraint if state leaked from the test above.
	it("starts from a clean DB each test (same ids reused)", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_test", name: "Test Org" });
		await db.insert(events).values({
			id: "e_test",
			organizationId: "org_test",
			name: "Test Event",
			slug: "test-event",
		});
		const rows = await db.select().from(events);
		expect(rows).toHaveLength(1);
	});
});
