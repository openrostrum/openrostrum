import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { fields } from "../app/db/schema";
import { action, loader } from "../app/routes/admin.crm.fields";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";

type LoaderResult = {
	data: { fields: Array<{ id: string; name: string; type: string }> };
};

async function runLoader(userId: string): Promise<LoaderResult> {
	return (await loader({
		context: CONTEXT,
		request: await requestAs(userId, "http://localhost/admin/crm/fields"),
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
}

async function runAction(userId: string, body: URLSearchParams) {
	return action({
		context: CONTEXT,
		request: await requestAs(userId, "http://localhost/admin/crm/fields", {
			method: "POST",
			body,
		}),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

describe("CRM person field definitions", () => {
	it("creates an organization-scoped contact field visible only to that organization", async () => {
		await seedCrmBaseline();
		await runAction(
			"u_admin1",
			new URLSearchParams({
				intent: "create",
				name: "Dietary requirements",
				type: "text",
				description: "Preferences shared across events",
			}),
		);

		const db = getDb(env);
		const [created] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Dietary requirements"));
		expect(created).toMatchObject({
			organizationId: "org1",
			eventId: null,
			recordType: "contact",
			type: "text",
		});
		expect((await runLoader("u_admin1")).data.fields.map((f) => f.id)).toEqual([
			created?.id,
		]);
		expect((await runLoader("u_admin2")).data.fields).toHaveLength(0);
	});

	it("refuses to update or delete another organization's field", async () => {
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

		const update = (await runAction(
			"u_admin1",
			new URLSearchParams({
				intent: "update",
				id: "org2-person-field",
				name: "Stolen rating",
				description: "",
				options: "",
			}),
		)) as { formError?: string };
		expect(update.formError).toBeTruthy();

		const remove = (await runAction(
			"u_admin1",
			new URLSearchParams({ intent: "delete", id: "org2-person-field" }),
		)) as { formError?: string };
		expect(remove.formError).toBeTruthy();
		const [untouched] = await db
			.select()
			.from(fields)
			.where(eq(fields.id, "org2-person-field"));
		expect(untouched?.name).toBe("Private rating");
	});
});
