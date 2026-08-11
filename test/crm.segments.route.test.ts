import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { crmSegments } from "../app/db/schema";
import { action, loader } from "../app/routes/admin.crm.segments";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";

type LoaderResult = {
	data: {
		segments: Array<{
			id: string;
			name: string;
			members: number;
			url: string;
		}>;
		total: number;
	};
};

async function runLoader(userId: string): Promise<LoaderResult> {
	const request = await requestAs(
		userId,
		"http://localhost/admin/crm/segments",
	);
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
}

async function runDelete(userId: string, segmentId: string) {
	const request = await requestAs(
		userId,
		"http://localhost/admin/crm/segments",
		{
			method: "POST",
			body: new URLSearchParams({ intent: "delete", segmentId }),
		},
	);
	return action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

describe("CRM segments", () => {
	it("lists only the org's segments, with live member counts and reopen URLs", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(crmSegments).values([
			{
				id: "seg1",
				organizationId: "org1",
				name: "AI Experts",
				filters: { company: "lattice" },
			},
			{
				id: "seg2",
				organizationId: "org2",
				name: "Rival Segment",
				filters: { q: "priya" },
			},
		]);

		const { data } = await runLoader("u_admin1");
		expect(data.segments.map((s) => s.name)).toEqual(["AI Experts"]);
		// Dynamic membership: exactly the one org1 person at Latticework.
		expect(data.segments[0]?.members).toBe(1);
		expect(data.segments[0]?.url).toBe(
			"/admin/crm/directory?company=lattice&segment=seg1",
		);
	});

	it("recounts members when the directory changes — segments are dynamic", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(crmSegments).values({
			id: "seg1",
			organizationId: "org1",
			name: "Pending people",
			filters: { status: "pending" },
		});
		const before = await runLoader("u_admin1");
		// marcus + priya.alt + priya (whose e2 appearance is pending) = 3.
		expect(before.data.segments[0]?.members).toBe(3);

		const { contacts } = await import("../app/db/schema");
		const { eq } = await import("drizzle-orm");
		await db
			.update(contacts)
			.set({ status: "confirmed" })
			.where(eq(contacts.id, "c_marcus_e1"));

		const after = await runLoader("u_admin1");
		expect(after.data.segments[0]?.members).toBe(2);
	});

	it("deletes only inside the caller's org", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(crmSegments).values({
			id: "seg1",
			organizationId: "org1",
			name: "AI Experts",
			filters: { company: "lattice" },
		});

		const foreign = (await runDelete("u_admin2", "seg1")) as {
			formError?: string;
		};
		expect(foreign.formError).toMatch(/does not belong/i);
		expect(await db.select().from(crmSegments)).toHaveLength(1);

		await runDelete("u_admin1", "seg1");
		expect(await db.select().from(crmSegments)).toHaveLength(0);
	});
});
