import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	portalForms,
	tasks,
	users,
} from "../app/db/schema";
import { action, loader } from "../app/routes/admin.portal-forms";
import {
	action as tasksAction,
	loader as tasksLoader,
} from "../app/routes/admin.tasks";
import { createSession, hashPassword } from "../app/lib/auth";
import {
	authedRequest,
	CONTEXT,
	postForm,
	seedTasksBaseline,
	unwrap,
} from "./tasks-fixtures";

const AV_FIELDS = [
	{
		name: "Microphone",
		type: "dropdown",
		required: true,
		options: ["Handheld", "Lavalier", "Podium"],
	},
	{ name: "Display notes", type: "textarea", required: false },
];

type ActionResult = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

type LoaderData = {
	eventName: string | null;
	forms: Array<{
		id: string;
		name: string;
		schema: Array<{ name: string }>;
		usedByTasks: number;
	}>;
};

async function post(
	fields: Record<string, string>,
	opts: Parameters<typeof authedRequest>[1] = {},
) {
	return action({
		context: CONTEXT,
		request: await authedRequest(
			"http://localhost/admin/portal-forms",
			opts,
			postForm(fields),
		),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

/** An org2 admin whose ACTIVE event is e2 — the cross-tenant probe identity. */
async function makeForeignAdmin(): Promise<string> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org2", name: "Other Org" });
	await db.insert(events).values({
		id: "e2",
		organizationId: "org2",
		name: "OtherConf",
		slug: "otherconf",
	});
	await db.insert(users).values({
		id: "u_foreign",
		email: "foreign-admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e2",
	});
	await db.insert(organizationMembers).values({
		organizationId: "org2",
		userId: "u_foreign",
	});
	const setCookie = await createSession(env, "u_foreign");
	return setCookie.split(";")[0] ?? "";
}

describe("portal-form builder — create", () => {
	it("creates a form whose stored schema matches the required field contract", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			name: "AV Requirements",
			title: "Tell us your AV needs",
			targetType: "contact",
			fieldsJson: JSON.stringify(AV_FIELDS),
		})) as Response;
		expect(result.status).toBe(302);

		const [row] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.name, "AV Requirements"));
		expect(row).toMatchObject({
			eventId: "e1",
			name: "AV Requirements",
			title: "Tell us your AV needs",
			targetType: "contact",
			sendConfirmationEmail: false,
			confirmationHtml: null,
		});
		expect(row?.schema).toEqual(AV_FIELDS);
	});

	it("offers the created form to task definitions and persists the reference", async () => {
		const db = await seedTasksBaseline();
		await post({
			intent: "save-form",
			name: "AV Requirements",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify(AV_FIELDS),
		});
		const [form] = await db
			.select({ id: portalForms.id })
			.from(portalForms)
			.where(eq(portalForms.name, "AV Requirements"));

		const definitions = unwrap<{
			portalFormOptions: Array<{ id: string; name: string }>;
		}>(
			await tasksLoader({
				context: CONTEXT,
				request: await authedRequest(
					"http://localhost/admin/tasks?view=definitions",
				),
				params: {},
			} as unknown as Parameters<typeof tasksLoader>[0]),
		);
		expect(definitions.portalFormOptions.map((f) => f.name)).toContain(
			"AV Requirements",
		);

		const created = (await tasksAction({
			context: CONTEXT,
			request: await authedRequest(
				"http://localhost/admin/tasks",
				{},
				postForm({
					intent: "create-task",
					name: "AV Requirements Check",
					type: "contact",
					description: "Tell us your microphone and display needs.",
					linkUrl: "",
					completion: `form:${form?.id}`,
					dueInDays: "",
					required: "yes",
					autoAssign: "no",
				}),
			),
			params: {},
		} as unknown as Parameters<typeof tasksAction>[0])) as Response;
		expect(created.status).toBe(302);
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.name, "AV Requirements Check"));
		expect(task?.portalFormId).toBe(form?.id);
	});

	it("stores the confirmation email toggle and message", async () => {
		const db = await seedTasksBaseline();
		await post({
			intent: "save-form",
			name: "Flight Reimbursement",
			title: "Submit your flight",
			targetType: "contact",
			sendConfirmationEmail: "yes",
			confirmationHtml: "Thanks — finance reimburses within 30 days.",
			fieldsJson: JSON.stringify([
				{ name: "Airline", type: "text", required: true },
			]),
		});
		const [row] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.name, "Flight Reimbursement"));
		expect(row?.sendConfirmationEmail).toBe(true);
		expect(row?.confirmationHtml).toBe(
			"Thanks — finance reimburses within 30 days.",
		);
	});
});

describe("portal-form builder — validation (nothing persists)", () => {
	it("rejects a blank form name", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			name: "   ",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify(AV_FIELDS),
		})) as ActionResult;
		expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});

	it("rejects an empty field list", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			name: "Empty",
			title: "",
			targetType: "contact",
			fieldsJson: "[]",
		})) as ActionResult;
		expect(result.fieldErrors?.fields?.[0]).toMatch(/at least one field/i);
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});

	it("rejects duplicate field names — answers are keyed by name", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			name: "Dupes",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "Airline", type: "text", required: true },
				{ name: "airline", type: "text", required: false },
			]),
		})) as ActionResult;
		expect(result.fieldErrors?.fields?.[0]).toMatch(/named/i);
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});

	it("rejects a dropdown without options and a nameless field", async () => {
		const db = await seedTasksBaseline();
		const noOptions = (await post({
			intent: "save-form",
			name: "Bad dropdown",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "Microphone", type: "dropdown", required: true },
			]),
		})) as ActionResult;
		expect(noOptions.fieldErrors?.fields?.[0]).toMatch(/option/i);

		const nameless = (await post({
			intent: "save-form",
			name: "Nameless",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([{ name: "", type: "text", required: true }]),
		})) as ActionResult;
		expect(nameless.fieldErrors?.fields?.[0]).toMatch(/needs a name/i);
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});

	it("rejects unparseable or unknown-typed field payloads", async () => {
		const db = await seedTasksBaseline();
		const garbage = (await post({
			intent: "save-form",
			name: "Garbage",
			title: "",
			targetType: "contact",
			fieldsJson: "not json",
		})) as ActionResult;
		expect(garbage.fieldErrors?.fields?.[0]).toBeTruthy();

		const badType = (await post({
			intent: "save-form",
			name: "Bad type",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "Payload", type: "wysiwyg", required: false },
			]),
		})) as ActionResult;
		expect(badType.fieldErrors?.fields?.[0]).toBeTruthy();
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});

	it("names the field that failed by its position in the list", async () => {
		// A builder with a dozen rows is useless if the error says only "invalid":
		// the number is how the admin finds the row to fix.
		await seedTasksBaseline();
		const rows = (bad: unknown) => [
			{ name: "One", type: "text", required: true },
			{ name: "Two", type: "text", required: false },
			{ name: "Three", type: "text", required: true },
			bad,
			{ name: "Five", type: "text", required: false },
		];
		const nameless = (await post({
			intent: "save-form",
			name: "Nameless four",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify(
				rows({ name: "  ", type: "text", required: true }),
			),
		})) as ActionResult;
		expect(nameless.fieldErrors?.fields?.[0]).toBe(
			"Field 4: every field needs a name.",
		);

		const notAField = (await post({
			intent: "save-form",
			name: "Junk four",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify(rows(42)),
		})) as ActionResult;
		expect(notAField.fieldErrors?.fields?.[0]).toMatch(/^Field 4: /);
	});

	it("refuses a field list past the cap without saving a truncated form", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			name: "Too many",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify(
				Array.from({ length: 51 }, (_, i) => ({
					name: `Field ${i}`,
					type: "text",
					required: false,
				})),
			),
		})) as ActionResult;
		expect(result.fieldErrors?.fields?.[0]).toMatch(/invalid/i);
		expect(await db.select().from(portalForms)).toHaveLength(1);
	});
});

describe("portal-form builder — update/delete/tenancy", () => {
	it("updates name and schema in place", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "save-form",
			formId: "pf_hotel",
			name: "Hotel & Travel",
			title: "Book your stay",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "Hotel name", type: "text", required: true },
				{ name: "Nights", type: "number", required: true },
			]),
		})) as Response;
		expect(result.status).toBe(302);
		const [row] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.id, "pf_hotel"));
		expect(row?.name).toBe("Hotel & Travel");
		expect(row?.schema?.map((f) => f.name)).toEqual(["Hotel name", "Nights"]);
	});

	it("keeps both tenants' forms isolated in both directions", async () => {
		const db = await seedTasksBaseline();
		const cookie = await makeForeignAdmin();
		await db.insert(portalForms).values({
			id: "pf_other",
			eventId: "e2",
			name: "Other Travel",
			title: "Other event only",
			schema: [{ name: "Carrier", type: "text", required: true }],
		});

		const data = unwrap<LoaderData>(
			await loader({
				context: CONTEXT,
				request: new Request("http://localhost/admin/portal-forms", {
					headers: { Cookie: cookie },
				}),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(data.forms.map((form) => form.id)).toEqual(["pf_other"]);

		const forged = (await action({
			context: CONTEXT,
			request: new Request("http://localhost/admin/portal-forms", {
				method: "POST",
				headers: { Cookie: cookie },
				body: new URLSearchParams({
					intent: "save-form",
					formId: "pf_hotel",
					name: "Hijacked",
					title: "",
					targetType: "contact",
					fieldsJson: JSON.stringify([
						{ name: "X", type: "text", required: false },
					]),
				}),
			}),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as ActionResult;
		expect(forged.formError).toMatch(/no longer exists/);

		const reverseForged = (await post({
			intent: "save-form",
			formId: "pf_other",
			name: "Also hijacked",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "X", type: "text", required: false },
			]),
		})) as ActionResult;
		expect(reverseForged.formError).toMatch(/no longer exists/);

		const [mine] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.id, "pf_hotel"));
		const [theirs] = await db
			.select()
			.from(portalForms)
			.where(eq(portalForms.id, "pf_other"));
		expect(mine?.name).toBe("Hotel Stay");
		expect(theirs?.name).toBe("Other Travel");
	});

	it("refuses deleting a form a task still points at — the task must never silently lose its form", async () => {
		const db = await seedTasksBaseline();
		const result = (await post({
			intent: "delete-form",
			formId: "pf_hotel",
		})) as ActionResult;
		expect(result.formError).toMatch(/In use by 1 task/);
		expect(
			await db.select().from(portalForms).where(eq(portalForms.id, "pf_hotel")),
		).toHaveLength(1);
		const [task] = await db.select().from(tasks).where(eq(tasks.id, "t_hotel"));
		expect(task?.portalFormId).toBe("pf_hotel");
	});

	it("deletes an unreferenced form", async () => {
		const db = await seedTasksBaseline();
		await post({
			intent: "save-form",
			name: "Scratch",
			title: "",
			targetType: "contact",
			fieldsJson: JSON.stringify([
				{ name: "X", type: "text", required: false },
			]),
		});
		const [scratch] = await db
			.select({ id: portalForms.id })
			.from(portalForms)
			.where(eq(portalForms.name, "Scratch"));
		const result = (await post({
			intent: "delete-form",
			formId: scratch?.id ?? "",
		})) as Response;
		expect(result.status).toBe(302);
		expect(
			await db
				.select()
				.from(portalForms)
				.where(eq(portalForms.name, "Scratch")),
		).toHaveLength(0);
	});

	it("refuses non-admins", async () => {
		await seedTasksBaseline();
		const thrown = await post(
			{ intent: "delete-form", formId: "pf_hotel" },
			{ role: "speaker" },
		).catch((e: unknown) => e);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});
});
