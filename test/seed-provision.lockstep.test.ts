import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailTemplates,
	events,
	organizations,
	participants,
	portals,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { transitionSubmissions } from "../app/domain/accept";
import {
	EVENT_EMAIL_TEMPLATE_KEYS,
	provisionEventDefaults,
} from "../app/domain/provisionEvent";
import seedSql from "../drizzle/seed.sql?raw";

// Senders resolve templates by (eventId, key): an event missing a key
// silently never sends that email. Two sources mint the template set — the
// seed (demo event) and provisionEventDefaults (every created event) — and
// nothing but this test forces them to stay in lockstep with the keys the
// senders look up (EVENT_EMAIL_TEMPLATE_KEYS). The same lockstep mandate
// covers the onboarding task definitions: the accept spine mints assignments
// from `tasks.isOnboardingDefault`, so an event provisioned without them
// accepts speakers into an empty portal.

/** Third-column literals of a seed insert's e_demo rows ('id','e_demo','<v>',…). */
function seedThirdColumn(table: string): string[] {
	const block = seedSql
		.split(new RegExp(`INSERT INTO ${table}[^)]*\\)\\s*VALUES`, "i"))[1]
		?.split(";")[0];
	if (!block) throw new Error(`seed.sql lost its ${table} insert`);
	return [...block.matchAll(/\(\s*'[^']*'\s*,\s*'e_demo'\s*,\s*'([^']+)'/g)]
		.map((m) => m[1])
		.filter((k): k is string => k !== undefined)
		.sort();
}

const seedTemplateKeys = () => seedThirdColumn("email_templates");
const seedTaskNames = () => seedThirdColumn("tasks");

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

	it("the seed's onboarding task set equals every provisioned event's, portal forms attached", async () => {
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

		const provisioned = await db
			.select()
			.from(tasks)
			.where(eq(tasks.eventId, "e1"));
		expect(provisioned.map((t) => t.name).sort()).toEqual(seedTaskNames());
		expect(provisioned.every((t) => t.isOnboardingDefault)).toBe(true);
		// The hotel/flight tasks are portal-form tasks — a definition whose form
		// is missing renders an unfillable task in the speaker portal.
		const formBacked = provisioned.filter((t) => t.type === "contact");
		expect(formBacked.length).toBeGreaterThan(0);
		for (const task of formBacked) {
			const [form] = await db.query.portalForms.findMany({
				where: (f, { eq: e }) => e(f.id, task.portalFormId ?? ""),
			});
			expect(form?.eventId).toBe("e1");
			expect(form?.schema?.length).toBeGreaterThan(0);
		}
	});

	it("accepting a submission on a FRESH provisioned event mints the onboarding assignments", async () => {
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
		await db.insert(contacts).values({
			id: "c1",
			eventId: "e1",
			email: "sam@example.com",
			firstName: "Sam",
			lastName: "Okafor",
		});
		const [row] = await db
			.insert(submissions)
			.values({ eventId: "e1", title: "First Talk", status: "pending" })
			.returning();
		if (!row) throw new Error("insert failed");
		await db.insert(participants).values({
			submissionId: row.id,
			contactId: "c1",
			role: "speaker",
			isPrimary: true,
		});

		const results = await transitionSubmissions(db, [row], "accepted");
		expect(results[0]?.ok).toBe(true);

		const minted = await db
			.select({
				type: tasks.type,
				name: tasks.name,
				submissionId: taskAssignments.submissionId,
				status: taskAssignments.status,
			})
			.from(taskAssignments)
			.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
			.where(eq(taskAssignments.contactId, "c1"));
		// Two contact-scoped defaults + one submission-scoped default, all open.
		expect(minted.map((m) => m.name).sort()).toEqual(seedTaskNames());
		expect(minted.every((m) => m.status === "incomplete")).toBe(true);
		expect(
			minted.filter((m) => m.type === "submission").map((m) => m.submissionId),
		).toEqual([row.id]);
	});
});
