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
	portalForms,
	portals,
	submissions,
	taskAssignments,
	tasks,
} from "../app/db/schema";
import { transitionSubmissions } from "../app/domain/accept";
import { provisionEventDefaults } from "../app/domain/provisionEvent";
import seedSql from "../drizzle/seed.sql?raw";

const EXPECTED_EMAIL_TEMPLATE_KEYS = [
	"accept",
	"decline",
	"reminder_1day",
	"reminder_5day",
	"submission_confirmation",
];

const EXPECTED_PORTAL_FORMS = [
	{
		name: "Flight Reimbursement",
		title: "Submit your flight",
		targetType: "contact",
		schema: [
			{ name: "Airline", type: "text", required: true },
			{ name: "Amount (USD)", type: "number", required: true },
		],
	},
	{
		name: "Hotel Stay",
		title: "Book your hotel",
		targetType: "contact",
		schema: [
			{ name: "Hotel name", type: "text", required: true },
			{ name: "Check-in date", type: "date", required: true },
			{ name: "Check-out date", type: "date", required: true },
		],
	},
];

const EXPECTED_TASKS = [
	{
		name: "Flight Reimbursement",
		type: "contact",
		description: "Submit your flight for reimbursement.",
		portalFormName: "Flight Reimbursement",
		isFileRequest: false,
		isOnboardingDefault: true,
		required: true,
		dueInDays: null,
	},
	{
		name: "Hotel & Travel Reservations",
		type: "contact",
		description: "Book your hotel stay.",
		portalFormName: "Hotel Stay",
		isFileRequest: false,
		isOnboardingDefault: true,
		required: true,
		dueInDays: null,
	},
	{
		name: "Presentation Upload",
		type: "submission",
		description: "Upload your slides.",
		portalFormName: null,
		isFileRequest: true,
		isOnboardingDefault: true,
		required: false,
		dueInDays: null,
	},
];

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

function seedPortalFormDefinitions() {
	const block = seedSql
		.split(/INSERT INTO portal_forms[^)]*\)\s*VALUES/i)[1]
		?.split(";")[0];
	if (!block) throw new Error("seed.sql lost its portal_forms insert");
	return [
		...block.matchAll(
			/\(\s*'[^']+'\s*,\s*'e_demo'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*unixepoch\(\)\s*\)/g,
		),
	]
		.map((match) => {
			const [, name, title, targetType, schema] = match;
			if (!name || !title || !targetType || !schema) {
				throw new Error("seed.sql has an invalid portal_forms row");
			}
			return {
				name,
				title,
				targetType,
				schema: JSON.parse(schema) as Array<{
					name: string;
					type: string;
					required: boolean;
				}>,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
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

		expect(seedTemplateKeys()).toEqual(EXPECTED_EMAIL_TEMPLATE_KEYS);
		expect(provisioned).toEqual(EXPECTED_EMAIL_TEMPLATE_KEYS);

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

		const provisioned = (
			await db
				.select({
					name: tasks.name,
					type: tasks.type,
					description: tasks.description,
					portalFormName: portalForms.name,
					isFileRequest: tasks.isFileRequest,
					isOnboardingDefault: tasks.isOnboardingDefault,
					required: tasks.required,
					dueInDays: tasks.dueInDays,
				})
				.from(tasks)
				.leftJoin(portalForms, eq(tasks.portalFormId, portalForms.id))
				.where(eq(tasks.eventId, "e1"))
		).sort((a, b) => a.name.localeCompare(b.name));
		expect(seedTaskNames()).toEqual(EXPECTED_TASKS.map((task) => task.name));
		expect(provisioned).toEqual(EXPECTED_TASKS);

		const provisionedForms = (
			await db
				.select({
					name: portalForms.name,
					title: portalForms.title,
					targetType: portalForms.targetType,
					schema: portalForms.schema,
				})
				.from(portalForms)
				.where(eq(portalForms.eventId, "e1"))
		).sort((a, b) => a.name.localeCompare(b.name));
		expect(seedPortalFormDefinitions()).toEqual(EXPECTED_PORTAL_FORMS);
		expect(provisionedForms).toEqual(EXPECTED_PORTAL_FORMS);
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
		expect(minted.map((m) => m.name).sort()).toEqual(
			EXPECTED_TASKS.map((task) => task.name),
		);
		expect(minted.every((m) => m.status === "incomplete")).toBe(true);
		expect(
			minted.filter((m) => m.type === "submission").map((m) => m.submissionId),
		).toEqual([row.id]);
	});
});
