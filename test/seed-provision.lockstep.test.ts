import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailTemplates,
	events,
	organizations,
	portals,
} from "../app/db/schema";
import {
	EVENT_EMAIL_TEMPLATE_KEYS,
	provisionEventDefaults,
} from "../app/domain/provisionEvent";
import seedSql from "../drizzle/seed.sql?raw";

// Senders resolve templates by (eventId, key): an event missing a key
// silently never sends that email. Two sources mint the template set — the
// seed (demo event) and provisionEventDefaults (every created event) — and
// nothing but this test forces them to stay in lockstep with the keys the
// senders look up (EVENT_EMAIL_TEMPLATE_KEYS).

/** Keys the seed grants the demo event, parsed from its email_templates insert. */
function seedTemplateKeys(): string[] {
	const block = seedSql
		.split(/INSERT INTO email_templates[^)]*\)\s*VALUES/i)[1]
		?.split(";")[0];
	if (!block) throw new Error("seed.sql lost its email_templates insert");
	// Row shape: ('et_x', 'e_demo', '<key>', ...) — key is the third literal.
	return [...block.matchAll(/\(\s*'[^']*'\s*,\s*'e_demo'\s*,\s*'([^']+)'/g)]
		.map((m) => m[1])
		.filter((k): k is string => k !== undefined)
		.sort();
}

describe("seed ↔ provisionEventDefaults lockstep", () => {
	it("the seed's demo-event template keys equal every provisioned event's", async () => {
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org1", name: "Org" });
		await db
			.insert(events)
			.values({ id: "e1", organizationId: "org1", name: "E", slug: "e" });
		await db.batch(
			provisionEventDefaults(db, "e1") as unknown as Parameters<
				typeof db.batch
			>[0],
		);

		const provisioned = (
			await db
				.select({ key: emailTemplates.key })
				.from(emailTemplates)
				.where(eq(emailTemplates.eventId, "e1"))
		)
			.map((r) => r.key)
			.sort();

		expect(provisioned.length).toBeGreaterThan(0);
		expect(seedTemplateKeys()).toEqual(provisioned);
		expect(provisioned).toEqual([...EVENT_EMAIL_TEMPLATE_KEYS].sort());

		// Same mandate for the portal: an event without one has no portal URL
		// for the CFP success redirect to resolve to.
		expect(
			await db.select().from(portals).where(eq(portals.eventId, "e1")),
		).toHaveLength(1);
		expect(seedSql).toMatch(/INSERT INTO portals/i);
	});
});
